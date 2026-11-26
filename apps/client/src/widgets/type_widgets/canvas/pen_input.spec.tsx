import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERACTIVE_CANVAS_SELECTOR } from "./click_to_type";
import usePenInput, { applyDarkThemeFilter, getPenCursor, PEN_CURSOR_PROPERTY } from "./pen_input";

// `click_to_type` reaches Excalidraw through `rich_text`, which the hook never calls.
vi.mock("@excalidraw/excalidraw", () => ({}));

describe("getPenCursor", () => {
    const base = {
        activeTool: { type: "freedraw" },
        viewModeEnabled: false,
        theme: "light",
        currentItemStrokeColor: "#e03131"
    } as Pick<AppState, "activeTool" | "viewModeEnabled" | "theme" | "currentItemStrokeColor">;

    it("shows a dot in the stroke color for the pen tools only", () => {
        const cursor = getPenCursor(base);
        expect(cursor).toContain(encodeURIComponent("fill='#e03131'"));
        expect(cursor).toMatch(/^url\("data:image\/svg\+xml,.*"\) 4 4, crosshair$/);

        expect(getPenCursor({ ...base, activeTool: { type: "selection" } } as typeof base)).toBeNull();
        expect(getPenCursor({ ...base, viewModeEnabled: true })).toBeNull();
    });

    it("shows a crosshair for the lasso", () => {
        expect(getPenCursor({ ...base, activeTool: { type: "custom", customType: "lasso" } } as typeof base)).toBe("crosshair");
        expect(getPenCursor({ ...base, activeTool: { type: "custom", customType: "other" } } as typeof base)).toBeNull();
    });

    it("shows the color a stroke takes in the dark theme", () => {
        expect(applyDarkThemeFilter("#1e1e1e")).toBe("#d3d3d3");
        expect(applyDarkThemeFilter("#fff")).toBe("#121212");
        expect(applyDarkThemeFilter("transparent")).toBe("transparent");
        expect(getPenCursor({ ...base, theme: "dark", currentItemStrokeColor: "#1e1e1e" }))
            .toContain(encodeURIComponent("fill='#d3d3d3'"));
    });
});

describe("usePenInput", () => {
    let container: HTMLElement;
    let state: AppState;
    let elements: ExcalidrawElement[];
    let changeListeners: ((elements: readonly ExcalidrawElement[], state: AppState) => void)[];
    let apiRef: { current: ExcalidrawImperativeAPI | null };
    let setActiveTool: ReturnType<typeof vi.fn>;
    let updateScene: ReturnType<typeof vi.fn>;
    /** The pointer events that reach the canvas, as Excalidraw's `onPointerDown` would see them. */
    let canvasPresses: PointerEvent[];

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout", "performance" ] });
        state = {
            activeTool: { type: "freedraw", locked: false },
            viewModeEnabled: false,
            theme: "light",
            currentItemStrokeColor: "#1e1e1e",
            selectedElementIds: {},
            selectedGroupIds: {},
            scrollX: 0,
            scrollY: 0,
            zoom: { value: 1 },
            offsetLeft: 0,
            offsetTop: 0
        } as unknown as AppState;
        elements = [];
        changeListeners = [];
        canvasPresses = [];
        setActiveTool = vi.fn((tool: { type: AppState["activeTool"]["type"] }) => {
            const selectedElementIds = tool.type === "selection" ? state.selectedElementIds : {};
            state = { ...state, activeTool: { ...state.activeTool, ...tool }, selectedElementIds } as AppState;
        });
        updateScene = vi.fn(({ appState }: { appState: Partial<AppState> }) => {
            state = { ...state, ...appState };
        });
        apiRef = {
            current: {
                getAppState: () => state,
                getSceneElements: () => elements,
                setActiveTool,
                updateScene,
                onChange: (listener: (typeof changeListeners)[number]) => {
                    changeListeners.push(listener);
                    return () => {
                        changeListeners = changeListeners.filter((candidate) => candidate !== listener);
                    };
                }
            } as unknown as ExcalidrawImperativeAPI
        };
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

    function Harness({ isEditable = true }: { isEditable?: boolean }) {
        const rootRef = useRef<HTMLDivElement>(null);
        usePenInput(rootRef, apiRef, { isEditable });
        return (
            <div ref={rootRef} className="root">
                <canvas className="excalidraw__canvas interactive" />
            </div>
        );
    }

    function mount(isEditable = true) {
        act(() => {
            render(<Harness isEditable={isEditable} />, container);
        });
        const root = container.querySelector<HTMLElement>(".root");
        const canvas = container.querySelector(INTERACTIVE_CANVAS_SELECTOR);
        if (!root || !canvas) throw new Error("harness did not render");

        canvas.addEventListener("pointerdown", (e) => {
            canvasPresses.push(e as PointerEvent);
        });
        return { root, canvas };
    }

    function pointer(target: EventTarget, type: string, init: PointerEventInit) {
        const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: 50, clientY: 60, ...init });
        act(() => {
            target.dispatchEvent(event);
        });
        return event;
    }

    function contextMenu(target: EventTarget, init: PointerEventInit) {
        const event = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, ...init });
        act(() => {
            target.dispatchEvent(event);
        });
        return event;
    }

    function changeState(next: Partial<AppState>) {
        state = { ...state, ...next };
        act(() => {
            for (const listener of changeListeners) listener(elements, state);
        });
    }

    it("shows the dot cursor while a pen tool is active", () => {
        const { root } = mount();
        expect(root.hasAttribute("data-pen-cursor")).toBe(true);
        expect(root.style.getPropertyValue(PEN_CURSOR_PROPERTY)).toContain(encodeURIComponent("fill='#1e1e1e'"));

        changeState({ currentItemStrokeColor: "#1971c2" });
        expect(root.style.getPropertyValue(PEN_CURSOR_PROPERTY)).toContain(encodeURIComponent("fill='#1971c2'"));

        changeState({ activeTool: { ...state.activeTool, type: "selection", customType: null } });
        expect(root.hasAttribute("data-pen-cursor")).toBe(false);
        expect(root.style.getPropertyValue(PEN_CURSOR_PROPERTY)).toBe("");
    });

    /** Drags the barrel button around (0, 0) to (100, 100), in client coordinates. */
    function barrelLasso(canvas: Element) {
        const press = pointer(canvas, "pointerdown", { pointerType: "pen", button: 2, buttons: 2, clientX: 0, clientY: 0 });
        for (const [ clientX, clientY ] of [ [ 100, 0 ], [ 100, 100 ], [ 0, 100 ] ]) {
            pointer(canvas, "pointermove", { pointerType: "pen", button: -1, buttons: 2, clientX, clientY });
        }
        pointer(canvas, "pointerup", { pointerType: "pen", button: 2, buttons: 0, clientX: 0, clientY: 100 });
        return press;
    }

    function rectangle(id: string, x: number) {
        return { id, type: "rectangle", x, y: x, width: 40, height: 40, angle: 0, groupIds: [] } as unknown as ExcalidrawElement;
    }

    it("lassos with a barrel drag and keeps inking when nothing is selected", () => {
        const { root, canvas } = mount();
        const press = pointer(canvas, "pointerdown", { pointerType: "pen", button: 2, buttons: 2, clientX: 0, clientY: 0 });
        expect(press.defaultPrevented).toBe(true);
        expect(canvasPresses).toEqual([]);
        expect(root.querySelector("svg.canvas-lasso")).not.toBeNull();

        pointer(canvas, "pointermove", { pointerType: "pen", button: -1, buttons: 2, clientX: 100, clientY: 100 });
        pointer(canvas, "pointerup", { pointerType: "pen", button: 2, buttons: 0, clientX: 0, clientY: 100 });
        expect(root.querySelector("svg.canvas-lasso")).toBeNull();
        expect(contextMenu(canvas, { pointerType: "pen" }).defaultPrevented).toBe(true);
        expect(setActiveTool).not.toHaveBeenCalled();
        expect(updateScene).not.toHaveBeenCalled();
        expect(state.activeTool.type).toBe("freedraw");

        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(contextMenu(canvas, { pointerType: "mouse" }).defaultPrevented).toBe(false);
    });

    it("keeps a barrel selection for the tip to move, then inks outside it", () => {
        const { canvas } = mount();
        elements = [ rectangle("a", 10), rectangle("far", 500) ];

        barrelLasso(canvas);
        expect(setActiveTool).toHaveBeenCalledExactlyOnceWith({ type: "selection" });
        expect(state).toMatchObject({ activeTool: { type: "selection" }, selectedElementIds: { a: true } });
        expect(canvasPresses).toEqual([]);

        // A tip press on the selection drags it with the selection tool.
        const onSelection = pointer(canvas, "pointerdown", { pointerType: "pen", button: 0, buttons: 1, clientX: 30, clientY: 30 });
        expect(onSelection.defaultPrevented).toBe(false);
        expect(canvasPresses.at(-1)).toBe(onSelection);
        pointer(canvas, "pointerup", { pointerType: "pen", button: 0, buttons: 0 });

        // A tip press away from it brings the pen back before Excalidraw sees the press.
        const away = pointer(canvas, "pointerdown", { pointerType: "pen", button: 0, buttons: 1, clientX: 300, clientY: 300 });
        expect(away.defaultPrevented).toBe(true);
        expect(setActiveTool).toHaveBeenLastCalledWith({ type: "freedraw", locked: false });
        const relayed = canvasPresses.at(-1);
        expect(relayed).not.toBe(away);
        expect([ relayed?.button, relayed?.clientX ]).toEqual([ 0, 300 ]);
        expect(setActiveTool).toHaveBeenCalledTimes(2);
    });

    it("brings the pen back when a second barrel lasso selects nothing", () => {
        const { canvas } = mount();
        elements = [ rectangle("a", 10) ];
        barrelLasso(canvas);
        expect(state.activeTool.type).toBe("selection");

        elements = [];
        barrelLasso(canvas);
        expect(setActiveTool).toHaveBeenLastCalledWith({ type: "freedraw", locked: false });
    });

    it("leaves the tip, the tail eraser, mouse and touch alone", () => {
        const { canvas } = mount();
        const presses = [
            pointer(canvas, "pointerdown", { pointerType: "pen", button: 0, buttons: 1 }),
            pointer(canvas, "pointerdown", { pointerType: "pen", button: 5, buttons: 32 }),
            pointer(canvas, "pointerdown", { pointerType: "mouse", button: 2, buttons: 2 }),
            pointer(canvas, "pointerdown", { pointerType: "touch", button: 0, buttons: 1 })
        ];

        expect(presses.map((press) => press.defaultPrevented)).toEqual([ false, false, false, false ]);
        expect(canvasPresses).toEqual(presses);
        expect(setActiveTool).not.toHaveBeenCalled();
        expect(contextMenu(canvas, { pointerType: "mouse" }).defaultPrevented).toBe(false);
    });

    it("does not select with the barrel button when the drawing is read-only", () => {
        const { root, canvas } = mount(false);
        const press = pointer(canvas, "pointerdown", { pointerType: "pen", button: 2, buttons: 2 });
        expect(press.defaultPrevented).toBe(false);
        expect(canvasPresses).toEqual([ press ]);
        expect(root.querySelector("svg.canvas-lasso")).toBeNull();
        expect(setActiveTool).not.toHaveBeenCalled();
    });
});
