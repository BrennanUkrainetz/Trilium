import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useClickToType, {
    type ClickToTypeOptions, INTERACTIVE_CANVAS_SELECTOR, isTypingKey, sceneToViewport,
    TEXT_EDITOR_SELECTOR, viewportToScene
} from "./click_to_type";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", EVENTUALLY: "EVENTUALLY", NEVER: "NEVER" },
    newElementWith: (element: object, updates: object) => ({ ...element, ...updates }),
    restoreElements: (elements: object[]) => elements
}));

const VIEW = { scrollX: 10, scrollY: -20, zoom: { value: 2 }, offsetLeft: 100, offsetTop: 50 } as Pick<AppState, "scrollX" | "scrollY" | "zoom" | "offsetLeft" | "offsetTop">;

describe("coordinates", () => {
    it("converts between the screen and the scene both ways", () => {
        const scene = viewportToScene({ clientX: 300, clientY: 250 }, VIEW);
        expect(scene).toEqual({ sceneX: 90, sceneY: 120 });
        expect(sceneToViewport(scene, VIEW)).toEqual({ clientX: 300, clientY: 250 });
    });
});

describe("isTypingKey", () => {
    it("takes one printable character without Ctrl, Cmd or Alt, or with AltGr", () => {
        expect(isTypingKey(new KeyboardEvent("keydown", { key: "a" }))).toBe(true);
        expect(isTypingKey(new KeyboardEvent("keydown", { key: "É", shiftKey: true }))).toBe(true);
        expect(isTypingKey(new KeyboardEvent("keydown", { key: "😀" }))).toBe(true);
        expect(isTypingKey(new KeyboardEvent("keydown", { key: " " }))).toBe(false);
        expect(isTypingKey(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false);
        expect(isTypingKey(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }))).toBe(false);
        expect(isTypingKey(new KeyboardEvent("keydown", { key: "a", isComposing: true }))).toBe(false);

        const altGr = new KeyboardEvent("keydown", { key: "@", ctrlKey: true, altKey: true });
        vi.spyOn(altGr, "getModifierState").mockImplementation((key) => key === "AltGraph");
        expect(isTypingKey(altGr)).toBe(true);
    });
});

describe("useClickToType", () => {
    let container: HTMLElement;
    let state: AppState;
    let apiRef: { current: ExcalidrawImperativeAPI | null };
    let dblclicks: MouseEvent[];

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "requestAnimationFrame", "cancelAnimationFrame" ] });
        state = {
            ...VIEW,
            activeTool: { type: "selection" },
            viewModeEnabled: false,
            editingTextElement: null,
            newElement: null,
            multiElement: null,
            selectedElementIds: {},
            currentItemFontSize: 20
        } as unknown as AppState;
        apiRef = { current: { getAppState: () => state } as unknown as ExcalidrawImperativeAPI };
        dblclicks = [];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
        vi.useRealTimers();
    });

    function Harness(options: ClickToTypeOptions) {
        const rootRef = useRef<HTMLDivElement>(null);
        const caret = useClickToType(rootRef, apiRef, options);
        return (
            <div ref={rootRef} className="root">
                <div className="excalidraw-container" tabIndex={0}>
                    <canvas className="excalidraw__canvas interactive" />
                    <div className="excalidraw-textEditorContainer" />
                </div>
                {caret && <div className="caret" data-left={caret.left} data-top={caret.top} data-height={caret.height} />}
            </div>
        );
    }

    function mount(options: ClickToTypeOptions = { clickToType: true, smartLists: true }) {
        act(() => {
            render(<Harness {...options} />, container);
        });
        const canvas = container.querySelector(INTERACTIVE_CANVAS_SELECTOR);
        const focusTarget = container.querySelector(".excalidraw-container");
        if (!canvas || !(focusTarget instanceof HTMLElement)) throw new Error("harness did not render");

        // Excalidraw answers a double click on an empty spot with a text editor, mounted here a
        // frame later so the keys typed in between are buffered.
        canvas.addEventListener("dblclick", (e) => {
            dblclicks.push(e as MouseEvent);
            requestAnimationFrame(() => {
                const editable = document.createElement("textarea");
                editable.className = "excalidraw-wysiwyg";
                container.querySelector(".excalidraw-textEditorContainer")?.appendChild(editable);
            });
        });
        return { canvas, focusTarget };
    }

    function click(canvas: Element, { clientX = 300, clientY = 250, moveBy = 0 } = {}) {
        act(() => {
            canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX, clientY }));
            canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: clientX + moveBy, clientY }));
            vi.runOnlyPendingTimers();
        });
    }

    function press(target: Element, key: string, init: KeyboardEventInit = {}) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
        act(() => {
            target.dispatchEvent(event);
        });
        return event;
    }

    function getEditor() {
        return container.querySelector<HTMLTextAreaElement>(TEXT_EDITOR_SELECTOR);
    }

    it("shows a caret at an empty spot and types into a text element created there", () => {
        const { canvas, focusTarget } = mount();
        click(canvas);
        expect(container.querySelector(".caret")?.getAttribute("data-height")).toBe("50");

        // The view pans before the first key: the text still goes to the clicked spot of the scene.
        state = { ...state, scrollX: state.scrollX + 5 };
        const first = press(focusTarget, "H", { shiftKey: true });
        expect(first.defaultPrevented).toBe(true);
        expect(dblclicks).toHaveLength(1);
        expect([ dblclicks[0].clientX, dblclicks[0].clientY ]).toEqual([ 310, 250 ]);
        expect(container.querySelector(".caret")).toBeNull();

        // Keys typed before the editor takes them are kept in order.
        press(focusTarget, "i");
        press(focusTarget, " ");
        expect(getEditor()).toBeNull();
        let inputs = 0;
        container.addEventListener("input", () => inputs++, { capture: true });
        act(() => {
            vi.runAllTimers();
        });

        expect(getEditor()?.value).toBe("Hi ");
        expect(inputs).toBe(1);
    });

    it("leaves clicks on elements, drags, shortcuts and other tools alone", () => {
        const { canvas, focusTarget } = mount();

        click(canvas, { moveBy: 20 });
        expect(container.querySelector(".caret")).toBeNull();

        state = { ...state, selectedElementIds: { a: true } } as AppState;
        click(canvas);
        expect(container.querySelector(".caret")).toBeNull();

        state = { ...state, selectedElementIds: {}, activeTool: { type: "rectangle" } } as AppState;
        click(canvas);
        expect(container.querySelector(".caret")).toBeNull();

        state = { ...state, activeTool: { type: "selection" } } as AppState;
        click(canvas);
        expect(container.querySelector(".caret")).not.toBeNull();
        const shortcut = press(focusTarget, "z", { ctrlKey: true });
        expect(shortcut.defaultPrevented).toBe(false);
        expect(container.querySelector(".caret")).toBeNull();

        expect(press(focusTarget, "r").defaultPrevented).toBe(false);
        expect(dblclicks).toHaveLength(0);
    });

    it("does nothing when click to type is off", () => {
        const { canvas, focusTarget } = mount({ clickToType: false, smartLists: true });
        click(canvas);
        expect(container.querySelector(".caret")).toBeNull();
        expect(press(focusTarget, "a").defaultPrevented).toBe(false);
        expect(dblclicks).toHaveLength(0);
    });

    it("edits lists in Excalidraw's text editor before its own key handler", () => {
        const { canvas } = mount();
        act(() => {
            canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
            vi.runOnlyPendingTimers();
        });
        const editable = getEditor();
        if (!editable) throw new Error("no editor");
        const ownHandler = vi.fn();
        editable.onkeydown = ownHandler;
        editable.value = "• one";
        editable.setSelectionRange(5, 5);

        expect(press(editable, "Enter").defaultPrevented).toBe(true);
        expect(editable.value).toBe("• one\n• ");
        expect(ownHandler).not.toHaveBeenCalled();

        press(editable, "x");
        expect(ownHandler).toHaveBeenCalledTimes(1);
    });

    it("leaves Enter in the text editor alone when lists are off", () => {
        const { canvas } = mount({ clickToType: true, smartLists: false });
        act(() => {
            canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
            vi.runOnlyPendingTimers();
        });
        const editable = getEditor();
        if (!editable) throw new Error("no editor");
        editable.value = "• one";
        editable.setSelectionRange(5, 5);

        expect(press(editable, "Enter").defaultPrevented).toBe(false);
        expect(editable.value).toBe("• one");
    });
});
