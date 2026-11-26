import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERACTIVE_CANVAS_SELECTOR } from "./click_to_type";
import useLassoTool, {
    getLassoSelection, getSamplePoints, isHoldingLassoSelection, isPointInPolygon, LASSO_TOOL, type Point
} from "./lasso";

// `click_to_type` reaches Excalidraw through `rich_text`, which the lasso never calls.
vi.mock("@excalidraw/excalidraw", () => ({}));

/** A square lasso from (0, 0) to (100, 100). */
const SQUARE: Point[] = [ [ 0, 0 ], [ 100, 0 ], [ 100, 100 ], [ 0, 100 ] ];

function element(props: Partial<ExcalidrawElement> & { id: string } & Record<string, unknown>) {
    return {
        type: "rectangle",
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        angle: 0,
        isDeleted: false,
        locked: false,
        groupIds: [],
        ...props
    } as unknown as ExcalidrawElement;
}

function stroke(id: string, points: Point[], props: Record<string, unknown> = {}) {
    return element({ id, type: "freedraw", x: 0, y: 0, width: 0, height: 0, points, ...props });
}

describe("isPointInPolygon", () => {
    it("closes the polygon and follows the even-odd rule", () => {
        expect(isPointInPolygon([ 50, 50 ], SQUARE)).toBe(true);
        expect(isPointInPolygon([ 150, 50 ], SQUARE)).toBe(false);
        expect(isPointInPolygon([ 50, -1 ], SQUARE)).toBe(false);

        // A concave "U": the notch between its arms is outside.
        const u: Point[] = [ [ 0, 0 ], [ 30, 0 ], [ 30, 70 ], [ 70, 70 ], [ 70, 0 ], [ 100, 0 ], [ 100, 100 ], [ 0, 100 ] ];
        expect(isPointInPolygon([ 50, 30 ], u)).toBe(false);
        expect(isPointInPolygon([ 15, 30 ], u)).toBe(true);

        // A figure eight crossing itself leaves the overlap out.
        const bowtie: Point[] = [ [ 0, 0 ], [ 100, 100 ], [ 100, 0 ], [ 0, 100 ] ];
        expect(isPointInPolygon([ 50, 20 ], bowtie)).toBe(false);
        expect(isPointInPolygon([ 80, 50 ], bowtie)).toBe(true);
    });
});

describe("getSamplePoints", () => {
    it("takes a stroke's own points, offset and turned about their center", () => {
        expect(getSamplePoints(stroke("s", [ [ 0, 0 ], [ 10, 0 ] ], { x: 5, y: 7 }))).toEqual([ [ 5, 7 ], [ 15, 7 ] ]);

        const turned = getSamplePoints(stroke("s", [ [ 0, 0 ], [ 10, 0 ] ], { x: 5, y: 7, angle: Math.PI / 2 }));
        expect(turned.map(([ x, y ]) => [ Math.round(x), Math.round(y) ])).toEqual([ [ 10, 2 ], [ 10, 12 ] ]);
    });

    it("takes the outline of a shape and its center", () => {
        expect(getSamplePoints(element({ id: "r" }))).toEqual([ [ 10, 10 ], [ 30, 10 ], [ 30, 30 ], [ 10, 30 ], [ 20, 20 ] ]);
        expect(getSamplePoints(element({ id: "d", type: "diamond" })))
            .toEqual([ [ 20, 10 ], [ 30, 20 ], [ 20, 30 ], [ 10, 20 ], [ 20, 20 ] ]);
        const ellipse = getSamplePoints(element({ id: "e", type: "ellipse" }));
        expect(ellipse).toHaveLength(9);
        expect(ellipse[0]).toEqual([ 30, 20 ]);
    });
});

describe("getLassoSelection", () => {
    it("selects a stroke when most of it lies inside", () => {
        const inside = [ ...Array(9).keys() ].map((index) => [ 10 + index * 10, 50 ] as const);
        const mostly = stroke("mostly", [ ...inside, [ 150, 50 ] ]);
        const half = stroke("half", [ [ 50, 60 ], [ 90, 60 ], [ 130, 60 ], [ 170, 60 ] ]);
        const outside = stroke("outside", [ [ 200, 200 ], [ 210, 210 ] ]);
        expect(getLassoSelection(SQUARE, [ mostly, half, outside ]))
            .toEqual({ selectedElementIds: { mostly: true }, selectedGroupIds: {} });
    });

    it("selects a shape by its turned outline", () => {
        const inside = element({ id: "inside" });
        const twoCornersOut = element({ id: "two-corners-out", x: 85, y: 10, width: 20, height: 5 });
        const wide = element({ id: "wide", x: 40, y: 40, width: 100, height: 10 });
        // Turned upright, the long bar fits inside.
        const turned = element({ id: "turned", x: 10, y: 45, width: 80, height: 10, angle: Math.PI / 2 });
        const ellipse = element({ id: "ellipse", type: "ellipse", x: 2, y: 2, width: 96, height: 96 });
        expect(Object.keys(getLassoSelection(SQUARE, [ inside, twoCornersOut, wide, turned, ellipse ]).selectedElementIds))
            .toEqual([ "inside", "turned", "ellipse" ]);

        const tightCircle: Point[] = [ ...Array(32).keys() ].map((index) => {
            const theta = (index / 32) * 2 * Math.PI;
            return [ 50 + 50 * Math.cos(theta), 50 + 50 * Math.sin(theta) ] as const;
        });
        expect(getLassoSelection(tightCircle, [ ellipse ]).selectedElementIds).toEqual({ ellipse: true });
    });

    it("skips deleted and locked elements and selects containers, not their text", () => {
        const elements = [
            element({ id: "deleted", isDeleted: true }),
            element({ id: "locked", locked: true }),
            element({ id: "box", x: 200, y: 200 }),
            element({ id: "label", type: "text", containerId: "box" }),
            element({ id: "lockedBox", x: 200, y: 200, locked: true }),
            element({ id: "lockedLabel", type: "text", containerId: "lockedBox" }),
            element({ id: "orphan", type: "text", containerId: "missing" })
        ];
        expect(getLassoSelection(SQUARE, elements).selectedElementIds).toEqual({ box: true, orphan: true });
    });

    it("selects the whole outermost group", () => {
        const elements = [
            element({ id: "a", groupIds: [ "inner", "outer" ] }),
            element({ id: "b", x: 500, groupIds: [ "inner", "outer" ] }),
            element({ id: "c", x: 600, groupIds: [ "outer" ] }),
            element({ id: "d", x: 700, groupIds: [ "other" ] })
        ];
        expect(getLassoSelection(SQUARE, elements)).toEqual({
            selectedElementIds: { a: true, b: true, c: true },
            selectedGroupIds: { outer: true }
        });
    });

    it("selects nothing without an area", () => {
        expect(getLassoSelection([ [ 0, 0 ], [ 100, 100 ] ], [ element({ id: "a" }) ]).selectedElementIds).toEqual({});
    });
});

describe("useLassoTool", () => {
    let container: HTMLElement;
    let state: AppState;
    let elements: ExcalidrawElement[];
    let changeListeners: ((elements: readonly ExcalidrawElement[], state: AppState) => void)[];
    let api: ExcalidrawImperativeAPI;
    let setActiveTool: ReturnType<typeof vi.fn>;
    let updateScene: ReturnType<typeof vi.fn>;
    let canvasPresses: PointerEvent[];

    beforeEach(() => {
        state = {
            activeTool: { type: "custom", customType: "lasso", locked: false },
            viewModeEnabled: false,
            penMode: false,
            selectedElementIds: {},
            selectedGroupIds: {},
            scrollX: 0,
            scrollY: 0,
            zoom: { value: 1 },
            offsetLeft: 0,
            offsetTop: 0
        } as unknown as AppState;
        elements = [ element({ id: "a" }), element({ id: "far", x: 500 }) ];
        changeListeners = [];
        canvasPresses = [];
        const emit = () => {
            for (const listener of changeListeners) listener(elements, state);
        };
        setActiveTool = vi.fn((tool: { type: AppState["activeTool"]["type"]; customType?: string }) => {
            const selectedElementIds = tool.type === "selection" ? state.selectedElementIds : {};
            state = { ...state, activeTool: { customType: null, ...tool }, selectedElementIds } as AppState;
            emit();
        });
        updateScene = vi.fn(({ appState }: { appState: Partial<AppState> }) => {
            state = { ...state, ...appState };
            emit();
        });
        api = {
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
        } as unknown as ExcalidrawImperativeAPI;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
    });

    function Harness({ isEditable }: { isEditable: boolean }) {
        const rootRef = useRef<HTMLDivElement>(null);
        useLassoTool(rootRef, { current: api }, { isEditable });
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
        const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, button: 0, buttons: 1, ...init });
        act(() => {
            target.dispatchEvent(event);
        });
        return event;
    }

    /** Draws a lasso through `points`, in client coordinates, with one pointer. */
    function drawLasso(canvas: Element, points: Point[], init: PointerEventInit = {}) {
        const [ [ startX, startY ], ...rest ] = points;
        const press = pointer(canvas, "pointerdown", { clientX: startX, clientY: startY, ...init });
        for (const [ clientX, clientY ] of rest) {
            pointer(canvas, "pointermove", { clientX, clientY, ...init });
        }
        return press;
    }

    it("draws a dashed lasso, selects with it and hands the selection to the selection tool", () => {
        const { root, canvas } = mount();
        const press = drawLasso(canvas, SQUARE, { pointerType: "pen" });
        expect(press.defaultPrevented).toBe(true);
        expect(canvasPresses).toEqual([]);
        const line = root.querySelector("svg.canvas-lasso polyline.canvas-lasso-line");
        expect(line?.getAttribute("points")).toBe("0,0 100,0 100,100 0,100");

        pointer(window, "pointerup", { pointerType: "pen", clientX: 0, clientY: 100, buttons: 0 });
        expect(root.querySelector(".canvas-lasso")).toBeNull();
        expect(setActiveTool).toHaveBeenCalledWith({ type: "selection" });
        expect(state).toMatchObject({ activeTool: { type: "selection" }, selectedElementIds: { a: true }, selectedGroupIds: {} });
        expect(isHoldingLassoSelection(api)).toBe(true);
    });

    it("moves the selection on a press inside it and lassos again elsewhere", () => {
        const { canvas } = mount();
        drawLasso(canvas, SQUARE, { pointerType: "mouse" });
        pointer(window, "pointerup", { pointerType: "mouse", buttons: 0 });

        const onSelection = pointer(canvas, "pointerdown", { pointerType: "touch", clientX: 20, clientY: 20 });
        expect(onSelection.defaultPrevented).toBe(false);
        expect(canvasPresses).toEqual([ onSelection ]);
        pointer(window, "pointerup", { pointerType: "touch", buttons: 0 });

        const away = pointer(canvas, "pointerdown", { pointerType: "mouse", clientX: 300, clientY: 300 });
        expect(away.defaultPrevented).toBe(true);
        expect(setActiveTool).toHaveBeenLastCalledWith(LASSO_TOOL);
        expect(isHoldingLassoSelection(api)).toBe(false);
        pointer(window, "pointerup", { pointerType: "mouse", clientX: 301, clientY: 300, buttons: 0 });
        expect(state.activeTool).toMatchObject(LASSO_TOOL);
    });

    it("stays the lasso when it selects nothing, and lets go once another tool is picked", () => {
        const { canvas } = mount();
        drawLasso(canvas, [ [ 200, 200 ], [ 300, 200 ], [ 300, 300 ] ]);
        pointer(window, "pointerup", { buttons: 0 });
        expect(setActiveTool).not.toHaveBeenCalled();
        expect(updateScene).not.toHaveBeenCalled();

        drawLasso(canvas, SQUARE);
        pointer(window, "pointerup", { buttons: 0 });
        act(() => api.setActiveTool({ type: "rectangle" }));
        act(() => api.setActiveTool({ type: "selection" }));
        expect(isHoldingLassoSelection(api)).toBe(false);
        const press = pointer(canvas, "pointerdown", { clientX: 300, clientY: 300 });
        expect(press.defaultPrevented).toBe(false);
    });

    it("cancels on a second finger and leaves fingers to pan in pen mode", () => {
        const { root, canvas } = mount();
        drawLasso(canvas, SQUARE.slice(0, 2), { pointerType: "touch", pointerId: 1 });
        const second = pointer(canvas, "pointerdown", { pointerType: "touch", pointerId: 2 });
        expect(second.defaultPrevented).toBe(false);
        expect(root.querySelector(".canvas-lasso")).toBeNull();
        pointer(window, "pointerup", { pointerType: "touch", pointerId: 1, buttons: 0 });
        pointer(window, "pointerup", { pointerType: "touch", pointerId: 2, buttons: 0 });
        expect(updateScene).not.toHaveBeenCalled();

        state = { ...state, penMode: true } as AppState;
        expect(pointer(canvas, "pointerdown", { pointerType: "touch", pointerId: 4 }).defaultPrevented).toBe(false);
        pointer(window, "pointerup", { pointerType: "touch", pointerId: 4, buttons: 0 });
        expect(pointer(canvas, "pointerdown", { pointerType: "pen" }).defaultPrevented).toBe(true);
    });

    it("leaves other tools, the eraser, read-only drawings and the barrel button alone", () => {
        const { canvas } = mount();
        expect(pointer(canvas, "pointerdown", { pointerType: "pen", button: 5, buttons: 32 }).defaultPrevented).toBe(false);
        expect(pointer(canvas, "pointerdown", { pointerType: "pen", button: 2, buttons: 2 }).defaultPrevented).toBe(false);

        state = { ...state, activeTool: { type: "freedraw" } } as AppState;
        expect(pointer(canvas, "pointerdown", { pointerType: "pen" }).defaultPrevented).toBe(false);

        act(() => render(null, container));
        state = { ...state, activeTool: { type: "custom", customType: "lasso" } } as AppState;
        const { canvas: readOnly } = mount(false);
        expect(pointer(readOnly, "pointerdown", { pointerType: "pen" }).defaultPrevented).toBe(false);
    });
});
