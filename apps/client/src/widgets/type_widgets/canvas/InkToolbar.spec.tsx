import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY" },
    newElementWith: (element: object, updates: object) => ({ ...element, ...updates })
}));
vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: { color?: string }) => (options?.color ? `${key}:${options.color}` : key)
}));

const { default: InkToolbar, getActiveInkTool } = await import("./InkToolbar");
const { HIGHLIGHTER_COLOR, HIGHLIGHTER_STYLE, INK_COLORS } = await import("./ink_tools");
const { applyLassoSelection, holdLassoSelection, isHoldingLassoSelection, LASSO_TOOL } = await import("./lasso");
const { INSERT_SPACE_TOOL } = await import("./insert_space");

interface MockElement {
    id: string;
    strokeColor: string;
}

/** An Excalidraw API that keeps its state and reports each change at once, as the strictest case. */
function createApi(initial: Partial<AppState> = {}) {
    let state = {
        activeTool: { type: "selection" },
        viewModeEnabled: false,
        selectedElementIds: {},
        currentItemStrokeColor: "#1e1e1e",
        currentItemStrokeWidth: 2,
        currentItemOpacity: 100,
        currentItemStrokeStyle: "solid",
        ...initial
    } as unknown as AppState;
    let elements: MockElement[] = [ { id: "a", strokeColor: "#1e1e1e" }, { id: "b", strokeColor: "#1e1e1e" } ];
    const listeners = new Set<(elements: unknown, state: AppState) => void>();
    const emit = () => {
        for (const listener of listeners) {
            listener(elements, state);
        }
    };
    const api = {
        getAppState: () => state,
        getSceneElements: () => elements,
        onChange: (listener: (elements: unknown, state: AppState) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setActiveTool: vi.fn((tool: { type: string; customType?: string }) => {
            state = { ...state, activeTool: { ...state.activeTool, customType: null, ...tool } } as AppState;
            emit();
        }),
        updateScene: vi.fn((scene: { elements?: MockElement[]; appState?: Partial<AppState> }) => {
            if (scene.elements) elements = scene.elements;
            if (scene.appState) state = { ...state, ...scene.appState };
            emit();
        })
    };
    return { api: api as unknown as ExcalidrawImperativeAPI, mock: api, getElements: () => elements };
}

describe("InkToolbar", () => {
    let container: HTMLElement;
    let undoButton: HTMLButtonElement;
    let redoButton: HTMLButtonElement;

    beforeEach(() => {
        container = document.createElement("div");
        container.className = "canvas-render";
        undoButton = document.createElement("button");
        undoButton.dataset.testid = "button-undo";
        undoButton.disabled = true;
        redoButton = document.createElement("button");
        redoButton.dataset.testid = "button-redo";
        redoButton.disabled = true;
        container.append(undoButton, redoButton);
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    function renderToolbar(api: ExcalidrawImperativeAPI, props: { isShapeSnapOn?: boolean; onShapeSnapChange?: (on: boolean) => void } = {}) {
        act(() => render(<InkToolbar apiRef={{ current: api }} {...props} />, container));
    }

    function button(label: string) {
        const found = [ ...container.querySelectorAll<HTMLButtonElement>(".canvas-ink-toolbar button") ]
            .find((candidate) => candidate.getAttribute("aria-label") === label);
        if (!found) throw new Error(`No button "${label}"`);
        return found;
    }

    function click(label: string) {
        act(() => button(label).click());
    }

    function swatch(name: string) {
        return `canvas.ink_toolbar.pen_color:canvas.ink_colors.${name}`;
    }

    function pressed() {
        return [ ...container.querySelectorAll(".canvas-ink-toolbar button[aria-pressed=\"true\"]") ]
            .map((pressedButton) => pressedButton.getAttribute("aria-label"));
    }

    it("shows Excalidraw's tool, also when the keyboard changes it", () => {
        const { api } = createApi();
        renderToolbar(api);
        expect(pressed()).toEqual([ "canvas.ink_toolbar.selection" ]);

        act(() => api.setActiveTool({ type: "eraser" }));
        expect(pressed()).toEqual([ "canvas.ink_toolbar.eraser" ]);

        act(() => api.setActiveTool({ type: "freedraw" }));
        expect(pressed()).toEqual([ "canvas.ink_toolbar.pen", swatch("black") ]);

        act(() => api.setActiveTool({ type: "arrow" }));
        expect(pressed()).toEqual([]);

        act(() => api.setActiveTool({ type: "custom", customType: "other" }));
        expect(pressed()).toEqual([]);
    });

    it("picks the lasso, and shows it while the selection tool holds what it selected", () => {
        const { api, mock } = createApi();
        renderToolbar(api);
        click("canvas.ink_toolbar.lasso");
        expect(mock.setActiveTool).toHaveBeenLastCalledWith(LASSO_TOOL);
        expect(pressed()).toEqual([ "canvas.ink_toolbar.lasso" ]);
        const labels = [ ...container.querySelectorAll(".canvas-ink-toolbar button") ].map((b) => b.getAttribute("aria-label"));
        expect(labels.slice(2, 5)).toEqual([ "canvas.ink_toolbar.selection", "canvas.ink_toolbar.lasso", "canvas.ink_toolbar.pen" ]);

        // `useLassoTool()` hands what the lasso selects to the selection tool.
        act(() => {
            holdLassoSelection(api);
            applyLassoSelection(api, { selectedElementIds: { a: true }, selectedGroupIds: {} });
        });
        expect(api.getAppState().activeTool.type).toBe("selection");
        expect(pressed()).toEqual([ "canvas.ink_toolbar.lasso" ]);

        click("canvas.ink_toolbar.selection");
        expect(isHoldingLassoSelection(api)).toBe(false);
        expect(pressed()).toEqual([ "canvas.ink_toolbar.selection" ]);
    });

    it("picks Insert Space, and shows it while it is Excalidraw's tool", () => {
        const { api, mock } = createApi();
        renderToolbar(api);
        click("canvas.ink_toolbar.insert_space");
        expect(mock.setActiveTool).toHaveBeenLastCalledWith(INSERT_SPACE_TOOL);
        expect(pressed()).toEqual([ "canvas.ink_toolbar.insert_space" ]);

        act(() => api.setActiveTool({ type: "eraser" }));
        expect(pressed()).toEqual([ "canvas.ink_toolbar.eraser" ]);
    });

    it("draws with a solid, opaque pen in the picked color", () => {
        const { api, mock } = createApi({ currentItemOpacity: 60, currentItemStrokeStyle: "dashed" });
        renderToolbar(api);

        click("canvas.ink_toolbar.pen");
        expect(mock.setActiveTool).toHaveBeenLastCalledWith({ type: "freedraw" });
        expect(api.getAppState()).toMatchObject({ currentItemOpacity: 100, currentItemStrokeStyle: "solid" });

        const red = INK_COLORS[1];
        click(swatch(red.name));
        expect(api.getAppState().currentItemStrokeColor).toBe(red.value);
        expect(pressed()).toEqual([ "canvas.ink_toolbar.pen", swatch(red.name) ]);
    });

    it("keeps the stroke of the pen and of the highlighter apart", () => {
        const { api, mock } = createApi({ currentItemStrokeWidth: 1 });
        renderToolbar(api);
        click(swatch("blue"));

        click("canvas.ink_toolbar.highlighter");
        expect(api.getAppState()).toMatchObject({
            activeTool: { type: "freedraw" },
            currentItemStrokeColor: HIGHLIGHTER_COLOR,
            currentItemStrokeWidth: HIGHLIGHTER_STYLE.width,
            currentItemOpacity: HIGHLIGHTER_STYLE.opacity
        });
        expect(pressed()).toEqual([ "canvas.ink_toolbar.highlighter" ]);

        // The width picked in Excalidraw's properties panel stays the highlighter's.
        act(() => mock.updateScene({ appState: { currentItemStrokeWidth: 8 } }));

        click("canvas.ink_toolbar.pen");
        expect(api.getAppState()).toMatchObject({
            currentItemStrokeColor: INK_COLORS[2].value,
            currentItemStrokeWidth: 1,
            currentItemOpacity: 100
        });
        expect(pressed()).toEqual([ "canvas.ink_toolbar.pen", swatch("blue") ]);

        click("canvas.ink_toolbar.highlighter");
        expect(api.getAppState().currentItemStrokeWidth).toBe(8);
    });

    it("gives another tool the pen's stroke as it replaces the highlighter", () => {
        const { api } = createApi();
        renderToolbar(api);
        click("canvas.ink_toolbar.highlighter");

        act(() => api.setActiveTool({ type: "selection" }));
        expect(api.getAppState()).toMatchObject({ currentItemStrokeColor: "#1e1e1e", currentItemOpacity: 100 });

        click("canvas.ink_toolbar.highlighter");
        click("canvas.ink_toolbar.rectangle");
        expect(api.getAppState()).toMatchObject({
            activeTool: { type: "rectangle" },
            currentItemStrokeColor: "#1e1e1e",
            currentItemOpacity: 100
        });

        act(() => api.setActiveTool({ type: "freedraw" }));
        expect(pressed()).toEqual([ "canvas.ink_toolbar.pen", swatch("black") ]);
    });

    it("recolors the selection and keeps a shape tool on a color pick", () => {
        const { api, mock, getElements } = createApi({ selectedElementIds: { b: true } } as Partial<AppState>);
        renderToolbar(api);

        click(swatch("green"));
        expect(getElements()).toEqual([
            { id: "a", strokeColor: "#1e1e1e" },
            { id: "b", strokeColor: INK_COLORS[3].value }
        ]);
        expect(mock.setActiveTool).toHaveBeenLastCalledWith({ type: "freedraw" });

        click("canvas.ink_toolbar.ellipse");
        click(swatch("red"));
        expect(api.getAppState()).toMatchObject({
            activeTool: { type: "ellipse" },
            currentItemStrokeColor: INK_COLORS[1].value
        });
        expect(pressed()).toEqual([ "canvas.ink_toolbar.ellipse" ]);
    });

    it("clicks Excalidraw's undo and redo while they are enabled", async () => {
        const { api } = createApi();
        renderToolbar(api);
        expect(button("canvas.ink_toolbar.undo").disabled).toBe(true);
        expect(button("canvas.ink_toolbar.redo").disabled).toBe(true);

        undoButton.disabled = false;
        await act(() => new Promise((resolve) => setTimeout(resolve)));
        expect(button("canvas.ink_toolbar.undo").disabled).toBe(false);
        expect(button("canvas.ink_toolbar.redo").disabled).toBe(true);

        const onUndo = vi.fn();
        undoButton.addEventListener("click", onUndo);
        click("canvas.ink_toolbar.undo");
        expect(onUndo).toHaveBeenCalledOnce();
    });

    it("offers snapping to shapes only when it can be turned on, and hides in view mode", () => {
        const onShapeSnapChange = vi.fn();
        renderToolbar(createApi().api);
        expect(() => button("canvas.ink_toolbar.snap_shapes")).toThrow();

        renderToolbar(createApi().api, { isShapeSnapOn: true, onShapeSnapChange });
        expect(button("canvas.ink_toolbar.snap_shapes").getAttribute("aria-pressed")).toBe("true");
        click("canvas.ink_toolbar.snap_shapes");
        expect(onShapeSnapChange).toHaveBeenCalledWith(false);

        act(() => render(null, container));
        renderToolbar(createApi({ viewModeEnabled: true }).api);
        expect(container.querySelector(".canvas-ink-toolbar")).not.toBeNull();
        expect(container.querySelectorAll(".canvas-ink-toolbar button")).toHaveLength(0);
    });

    it("waits for Excalidraw to set its API", () => {
        vi.useFakeTimers({ toFake: [ "requestAnimationFrame", "cancelAnimationFrame" ] });
        try {
            const apiRef: { current: ExcalidrawImperativeAPI | null } = { current: null };
            act(() => render(<InkToolbar apiRef={apiRef} />, container));
            expect(container.querySelectorAll(".canvas-ink-toolbar button")).toHaveLength(0);

            apiRef.current = createApi().api;
            act(() => { vi.advanceTimersToNextFrame(); });
            expect(pressed()).toEqual([ "canvas.ink_toolbar.selection" ]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("getActiveInkTool", () => {
    it("tells the pen from the highlighter and has no button for other tools", () => {
        expect(getActiveInkTool("freedraw", "highlighter")).toBe("highlighter");
        expect(getActiveInkTool("freedraw", "pen")).toBe("pen");
        expect(getActiveInkTool("rectangle", "highlighter")).toBe("rectangle");
        expect(getActiveInkTool("text", "pen")).toBeNull();
    });
});
