import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { CANVAS_RICH_TEXT_KEY, CANVAS_RICH_TEXT_LINK } from "@triliumnext/commons/src/lib/canvas_rich_text.js";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", EVENTUALLY: "EVENTUALLY", NEVER: "NEVER" },
    newElementWith: (element: object, updates: object) => ({ ...element, ...updates }),
    restoreElements: (elements: unknown[]) => elements,
    getCommonBounds: (elements: ExcalidrawElement[]) => [
        Math.min(...elements.map((e) => e.x)),
        Math.min(...elements.map((e) => e.y)),
        Math.max(...elements.map((e) => e.x + e.width)),
        Math.max(...elements.map((e) => e.y + e.height))
    ]
}));
const showError = vi.hoisted(() => vi.fn());
vi.mock("../../../services/toast", () => ({ default: { showError } }));

const { default: TouchMenu, getPressSelection } = await import("./TouchMenu");
const { colorRichTextHtml } = await import("./rich_text");
const { LONG_PRESS_DELAY_MS } = await import("./touch_long_press");

function element(id: string, x: number, y: number, extra: Partial<Record<string, unknown>> = {}) {
    return {
        id, type: "rectangle", x, y, width: 100, height: 50, isDeleted: false, locked: false,
        groupIds: [], strokeColor: "#000000", ...extra
    } as unknown as ExcalidrawElement;
}

const VIEW = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 };

describe("getPressSelection", () => {
    const shape = element("shape", 0, 0);
    const label = element("label", 10, 10, { type: "text", width: 50, height: 20, containerId: "shape" });
    const first = element("first", 200, 0, { groupIds: [ "inner", "outer" ] });
    const second = element("second", 400, 0, { groupIds: [ "outer" ] });
    const locked = element("locked", 0, 300, { locked: true });
    const elements = [ shape, label, first, second, locked ];
    const none = { selectedElementIds: {}, selectedGroupIds: {}, zoom: { value: 1 } } as unknown as AppState;

    it("selects what is pressed: a shape for its text, a whole group, nothing for an empty spot", () => {
        expect(getPressSelection(elements, none, 20, 15)).toEqual({ selectedElementIds: { shape: true }, selectedGroupIds: {} });
        expect(getPressSelection(elements, none, 250, 20)).toEqual({
            selectedElementIds: { first: true, second: true }, selectedGroupIds: { outer: true }
        });
        expect(getPressSelection(elements, none, 105, 55)).toEqual({ selectedElementIds: { shape: true }, selectedGroupIds: {} });
        expect(getPressSelection(elements, none, 150, 200)).toEqual({ selectedElementIds: {}, selectedGroupIds: {} });
        expect(getPressSelection(elements, none, 20, 320)).toEqual({ selectedElementIds: {}, selectedGroupIds: {} });
    });

    it("keeps the selection for a press within its bounds", () => {
        const state = { ...none, selectedElementIds: { shape: true, second: true } } as unknown as AppState;
        expect(getPressSelection(elements, state, 250, 20)).toEqual({
            selectedElementIds: { shape: true, second: true }, selectedGroupIds: {}
        });
    });
});

describe("colorRichTextHtml", () => {
    it("colors all of the text once, replacing the colors of its parts", () => {
        const html = `<p>a <span style="color: red; font-weight: bold">b</span></p>`;
        const blue = colorRichTextHtml(html, "#1971c2");
        expect(blue).toMatch(/^<div style="color: [^"]+"><p>a <span style="font-weight: bold;?">b<\/span><\/p><\/div>$/);
        expect(blue).not.toContain("red");

        const black = colorRichTextHtml(blue, "#1e1e1e");
        expect(black.match(/<div/g)).toHaveLength(1);
        expect(colorRichTextHtml(black, null)).toMatch(/^<p>a <span style="font-weight: bold;?">b<\/span><\/p>$/);
    });
});

describe("TouchMenu", () => {
    let container: HTMLElement;
    let state: AppState;
    let elements: ExcalidrawElement[];
    let api: ExcalidrawImperativeAPI;
    let updateScene: ReturnType<typeof vi.fn>;
    let execCommand: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        state = {
            ...VIEW,
            activeTool: { type: "selection" },
            viewModeEnabled: false,
            penMode: false,
            selectedElementIds: {},
            selectedGroupIds: {}
        } as unknown as AppState;
        elements = [
            element("shape", 0, 0),
            element("box", 300, 0, {
                type: "embeddable", link: CANVAS_RICH_TEXT_LINK, strokeColor: "transparent",
                customData: { [CANVAS_RICH_TEXT_KEY]: { html: "<p>hi</p>", autoWidth: true } }
            })
        ];
        updateScene = vi.fn((scene: { elements?: ExcalidrawElement[]; appState?: Partial<AppState> }) => {
            if (scene.elements) elements = scene.elements;
            if (scene.appState) state = { ...state, ...scene.appState };
        });
        api = {
            getAppState: () => state,
            getSceneElements: () => elements,
            updateScene
        } as unknown as ExcalidrawImperativeAPI;
        execCommand = vi.fn(() => true);
        document.execCommand = execCommand as unknown as typeof document.execCommand;
        showError.mockReset();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function Harness({ editor }: { editor: boolean }) {
        const rootRef = useRef<HTMLDivElement>(null);
        const editorRef = useRef<HTMLDivElement>(null);
        return (
            <div ref={rootRef}>
                <div className="excalidraw-container" tabIndex={0}>
                    <canvas className="excalidraw__canvas interactive" />
                    <div ref={editorRef} className="canvas-rich-text" contentEditable>rich text</div>
                </div>
                <TouchMenu rootRef={rootRef} apiRef={{ current: api }} isReadOnly={false}
                    richTextEditor={editor ? container.querySelector<HTMLElement>(".canvas-rich-text") : null} />
            </div>
        );
    }

    function mount(editor = false) {
        act(() => {
            render(<Harness editor={false} />, container);
        });
        if (editor) {
            act(() => {
                render(<Harness editor />, container);
            });
        }
        const canvas = container.querySelector("canvas");
        const excalidraw = container.querySelector<HTMLElement>(".excalidraw-container");
        const richText = container.querySelector<HTMLElement>(".canvas-rich-text");
        if (!canvas || !excalidraw || !richText) throw new Error("harness did not render");
        return { canvas, excalidraw, richText };
    }

    function longPress(target: Element, clientX: number, clientY: number, pointerType = "touch") {
        act(() => {
            target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType, clientX, clientY }));
            vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
        });
        act(() => {
            target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType, clientX, clientY }));
            vi.runOnlyPendingTimers();
        });
    }

    function menu() {
        return document.querySelector(".canvas-touch-menu");
    }

    function labels() {
        return [ ...document.querySelectorAll(".canvas-touch-menu-actions .btn .bx") ]
            .map((icon) => [ ...icon.classList ].find((name) => name.startsWith("bx-")));
    }

    function tap(selector: string) {
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) throw new Error(`no ${selector}`);
        act(() => {
            target.click();
        });
    }

    it("selects the pressed element, keeps the selection after the release and acts on it", () => {
        const { canvas, excalidraw } = mount();
        const keys: KeyboardEvent[] = [];
        excalidraw.addEventListener("keydown", (e) => keys.push(e));
        // Excalidraw's own `pointerup` clears the selection that the press made.
        canvas.addEventListener("pointerup", () => {
            state = { ...state, selectedElementIds: {} };
        });

        longPress(canvas, 20, 20);
        expect(state.selectedElementIds).toEqual({ shape: true });
        expect(labels()).toEqual([ "bx-paste", "bx-cut", "bx-copy", "bx-trash", "bx-duplicate" ]);

        tap(".canvas-touch-menu .bx-trash");
        expect(menu()).toBeNull();
        expect(keys.map((e) => e.key)).toEqual([ "Delete" ]);
        expect(document.activeElement).toBe(excalidraw);

        longPress(canvas, 20, 20);
        tap(".canvas-touch-menu .bx-cut");
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(keys.map((e) => e.key)).toEqual([ "Delete", "Delete" ]);

        longPress(canvas, 20, 20);
        tap(".canvas-touch-menu .bx-duplicate");
        expect(keys.at(-1)).toMatchObject({ key: "d", ctrlKey: true });
    });

    it("offers only Paste on an empty spot, and closes on Escape or a press elsewhere", () => {
        const { canvas } = mount();

        longPress(canvas, 20, 20, "mouse");
        expect(menu()).toBeNull();

        longPress(canvas, 150, 200);
        expect(labels()).toEqual([ "bx-paste" ]);
        expect(menu()?.classList.contains("canvas-white-page")).toBe(false);
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect(menu()).toBeNull();

        const root = container.firstElementChild;
        if (!(root instanceof HTMLElement)) throw new Error("no root");
        root.dataset.canvasPage = "white";
        longPress(canvas, 150, 200);
        expect(menu()?.classList.contains("canvas-white-page")).toBe(true);
        act(() => {
            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        });
        expect(menu()).toBeNull();
    });

    it("colors the strokes of shapes and the text of rich text boxes", () => {
        const { canvas } = mount();
        state = { ...state, selectedElementIds: { shape: true, box: true } };

        longPress(canvas, 20, 20);
        const red = [ ...document.querySelectorAll<HTMLElement>(".canvas-touch-menu .color-cell") ]
            .find((cell) => cell.style.getPropertyValue("--color") === "#e03131");
        if (!red) throw new Error("no red swatch");
        act(() => {
            red.click();
        });

        expect(menu()).toBeNull();
        const [ shape, box ] = elements;
        expect(shape).toMatchObject({ strokeColor: "#e03131" });
        expect(box).toMatchObject({ strokeColor: "transparent" });
        expect((box?.customData?.[CANVAS_RICH_TEXT_KEY] as { html: string }).html).toMatch(/^<div style="color: [^"]+"><p>hi<\/p><\/div>$/);
        expect(state.currentItemStrokeColor).toBe("#e03131");
    });

    it("pastes the clipboard at the pressed spot, or says that it cannot read it", async () => {
        const { canvas, excalidraw } = mount();
        const read = vi.fn(async () => [ {
            types: [ "text/plain" ],
            getType: async () => new Blob([ "pasted" ], { type: "text/plain" })
        } ]);
        const readText = vi.fn(async () => {
            throw new DOMException("denied", "NotAllowedError");
        });
        vi.stubGlobal("navigator", { ...navigator, clipboard: { read, readText } });
        const moves: PointerEvent[] = [];
        const pastes: ClipboardEvent[] = [];
        document.addEventListener("pointermove", (e) => moves.push(e), { once: true });
        excalidraw.addEventListener("paste", (e) => pastes.push(e as ClipboardEvent));

        longPress(canvas, 150, 200);
        await act(async () => {
            document.querySelector<HTMLElement>(".canvas-touch-menu .bx-paste")?.click();
            await vi.waitFor(() => expect(pastes).toHaveLength(1));
        });
        expect(menu()).toBeNull();
        expect(moves[0]).toMatchObject({ clientX: 150, clientY: 200 });
        expect(pastes[0]?.clipboardData?.getData("text/plain")).toBe("pasted");

        read.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
        longPress(canvas, 150, 200);
        await act(async () => {
            document.querySelector<HTMLElement>(".canvas-touch-menu .bx-paste")?.click();
            await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce());
        });
        expect(pastes).toHaveLength(1);
    });

    it("acts on the selected text of the rich text box being edited", () => {
        const { richText } = mount(true);

        longPress(richText, 20, 20);
        expect(labels()).toEqual([ "bx-paste", "bx-cut", "bx-copy", "bx-trash" ]);
        expect(updateScene).not.toHaveBeenCalled();

        const black = document.querySelector<HTMLElement>(".canvas-touch-menu .color-cell:not(.color-cell-reset)");
        act(() => {
            black?.click();
        });
        expect(execCommand).toHaveBeenCalledWith("foreColor", false, "#1e1e1e");
        expect(document.activeElement).toBe(richText);
        expect(updateScene).not.toHaveBeenCalled();
    });
});
