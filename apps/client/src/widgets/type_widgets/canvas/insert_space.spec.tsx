import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERACTIVE_CANVAS_SELECTOR } from "./click_to_type";
import useInsertSpace, {
    getInsertSpaceDelta, getRotatedBounds, INSERT_SPACE_TOOL, InsertSpaceOverlay, isInsertSpaceActive,
    isPreviewingInsertSpace, planInsertSpace, setInsertSpaceTool
} from "./insert_space";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER" },
    newElementWith: (element: ExcalidrawElement, updates: object) => ({ ...element, ...updates, version: element.version + 1 })
}));

describe("planInsertSpace", () => {
    it("moves the elements whose top is at or below the line, keeping groups, labels and frames whole", () => {
        const elements = [
            box("above", 0, 0),
            box("straddling", 200, 80, { height: 60 }),
            box("on-line", 400, 100),
            box("below", 0, 150),
            box("deleted", 0, 300, { isDeleted: true }),
            box("locked", 0, 300, { locked: true }),
            box("group-top", 600, 90, { groupIds: [ "inner", "outer" ] }),
            box("group-bottom", 600, 200, { groupIds: [ "outer" ] }),
            box("group-low", 800, 120, { groupIds: [ "low" ] }),
            box("group-low-2", 800, 220, { groupIds: [ "low" ] }),
            box("container", 1000, 95),
            box("label", 1000, 105, { type: "text", containerId: "container" }),
            box("frame", 1200, 90, { type: "frame" }),
            box("frame-child", 1210, 300, { frameId: "frame" })
        ];
        expect([ ...planInsertSpace(elements, 100).elementIds ].sort()).toEqual([
            "below", "group-low", "group-low-2", "on-line"
        ]);
    });

    it("stops removing space at the line or at the content above, within the horizontal range", () => {
        const elements = [
            box("above-left", 0, 0, { height: 80 }),
            box("moving-left", 0, 150),
            box("above-right", 500, 0, { height: 130 }),
            box("moving-right", 500, 160)
        ];
        // The right column has 30 of room above it, the left one 50 down to the line at 100.
        const plan = planInsertSpace(elements, 100);
        expect(plan.maxUp).toBe(30);
        expect(getInsertSpaceDelta(plan, -200)).toBe(-30);
        expect(getInsertSpaceDelta(plan, -10)).toBe(-10);
        expect(getInsertSpaceDelta(plan, 250)).toBe(250);

        expect(planInsertSpace([ box("alone", 0, 140) ], 100).maxUp).toBe(40);
        expect(planInsertSpace([ box("above", 0, 0) ], 100)).toEqual({ elementIds: new Set(), maxUp: 0 });
    });

    it("measures rotated and point-based elements by what they cover", () => {
        const rotated = getRotatedBounds(box("r", 0, 0, { width: 100, height: 20, angle: Math.PI / 2 }));
        expect(rotated.top).toBeCloseTo(-40);
        expect(rotated.bottom).toBeCloseTo(60);
        expect(rotated.left).toBeCloseTo(40);

        const stroke = box("s", 10, 10, { type: "freedraw", points: [ [ 0, 0 ], [ 5, -8 ], [ 20, 30 ] ] });
        expect(getRotatedBounds(stroke)).toEqual({ left: 10, top: 2, right: 30, bottom: 40 });
    });
});

describe("useInsertSpace", () => {
    let container: HTMLElement;
    let state: AppState;
    let elements: ExcalidrawElement[];
    let changeListeners: ((elements: readonly ExcalidrawElement[], state: AppState) => void)[];
    let apiRef: { current: ExcalidrawImperativeAPI | null };
    let updateScene: ReturnType<typeof vi.fn>;
    let canvasEvents: string[];
    let frames: Map<number, FrameRequestCallback>;
    let nextFrame: number;

    beforeEach(() => {
        frames = new Map();
        nextFrame = 1;
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            frames.set(nextFrame, callback);
            return nextFrame++;
        });
        vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
        state = {
            activeTool: { type: "custom", customType: "insertSpace", locked: false, lastActiveTool: null },
            viewModeEnabled: false,
            scrollX: 0,
            scrollY: 0,
            zoom: { value: 2 },
            offsetLeft: 0,
            offsetTop: 0
        } as unknown as AppState;
        elements = [ box("above", 0, 0, { height: 40 }), box("below", 0, 100), box("gone", 0, 200, { isDeleted: true }) ];
        changeListeners = [];
        canvasEvents = [];
        updateScene = vi.fn(({ elements: next }: { elements?: ExcalidrawElement[] }) => {
            if (next) elements = next;
        });
        apiRef = {
            current: {
                getAppState: () => state,
                getSceneElements: () => elements.filter((element) => !element.isDeleted),
                getSceneElementsIncludingDeleted: () => elements,
                updateScene,
                setActiveTool: vi.fn(),
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
        vi.unstubAllGlobals();
    });

    function flushFrames() {
        const callbacks = [ ...frames.values() ];
        frames.clear();
        act(() => {
            for (const callback of callbacks) callback(0);
        });
    }

    /** The calls to `updateScene` as `[captureUpdate, y of "below"]`. */
    function sceneUpdates() {
        return updateScene.mock.calls.map(([ { elements: next, captureUpdate } ]) =>
            [ captureUpdate, next.find((element: ExcalidrawElement) => element.id === "below")?.y ]);
    }

    function Harness({ enabled = true }: { enabled?: boolean }) {
        const rootRef = useRef<HTMLDivElement>(null);
        const preview = useInsertSpace(rootRef, apiRef, { enabled });
        return (
            <div ref={rootRef} className="root">
                <canvas className="excalidraw__canvas interactive" />
                <InsertSpaceOverlay preview={preview} />
            </div>
        );
    }

    function mount(enabled = true) {
        act(() => {
            render(<Harness enabled={enabled} />, container);
        });
        const root = container.querySelector<HTMLElement>(".root");
        const canvas = container.querySelector(INTERACTIVE_CANVAS_SELECTOR);
        if (!root || !canvas) throw new Error("harness did not render");
        for (const type of [ "pointerdown", "pointermove" ]) {
            canvas.addEventListener(type, () => canvasEvents.push(type));
        }
        return { root, canvas };
    }

    function pointer(target: EventTarget, type: string, init: PointerEventInit = {}) {
        const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, clientX: 50, button: 0, ...init });
        act(() => {
            target.dispatchEvent(event);
        });
        return event;
    }

    function lines() {
        return [ ...container.querySelectorAll<HTMLElement>(".canvas-insert-space-line") ].map((line) => line.style.top);
    }

    it("shows the row cursor only while the tool is active", () => {
        const { root } = mount();
        expect(root.hasAttribute("data-insert-space")).toBe(true);

        state = { ...state, activeTool: { ...state.activeTool, type: "selection", customType: null } } as AppState;
        act(() => {
            for (const listener of changeListeners) listener(elements, state);
        });
        expect(root.hasAttribute("data-insert-space")).toBe(false);
    });

    it("previews the move live and inserts space below the press line in one undo step", () => {
        const { canvas } = mount();
        const api = apiRef.current;
        const original = [ ...elements ];
        // At zoom 2, the press at y 120 is the scene line 60; a drag of 40 px moves by 20.
        const down = pointer(canvas, "pointerdown", { clientY: 120 });
        expect(down.defaultPrevented).toBe(true);
        pointer(canvas, "pointermove", { clientY: 200 });
        pointer(canvas, "pointermove", { clientY: 160 });
        expect(canvasEvents).toEqual([]);
        expect(lines()).toEqual([ "120px", "160px" ]);
        expect(updateScene).not.toHaveBeenCalled();

        // One frame shows the latest move, measured from where the elements were at the press.
        flushFrames();
        expect(sceneUpdates()).toEqual([ [ "NEVER", 120 ] ]);
        expect(elements[0]).toBe(original[0]);
        expect(api && isPreviewingInsertSpace(api)).toBe(true);

        pointer(canvas, "pointerup", { clientY: 160 });
        expect(lines()).toEqual([]);
        expect(api && isPreviewingInsertSpace(api)).toBe(false);
        // The scene goes back to the press without a history step, then moves in one.
        expect(sceneUpdates()).toEqual([ [ "NEVER", 120 ], [ "NEVER", 100 ], [ "IMMEDIATELY", 120 ] ]);
        expect(updateScene.mock.calls[1][0].elements).toEqual(original);
        expect(elements.map((element) => [ element.id, element.y ])).toEqual([
            [ "above", 0 ], [ "below", 120 ], [ "gone", 200 ]
        ]);
        flushFrames();
        expect(updateScene).toHaveBeenCalledTimes(3);
    });

    it("removes space only down to the press line", () => {
        const { canvas } = mount();
        pointer(canvas, "pointerdown", { clientY: 120 });
        pointer(canvas, "pointermove", { clientY: 0 });
        // The element at 100 can go up by 40, to the line at 60, shown at 120 - 80 px.
        expect(lines()).toEqual([ "120px", "40px" ]);
        flushFrames();
        pointer(canvas, "pointerup", { clientY: 0 });
        expect(sceneUpdates()).toEqual([ [ "NEVER", 60 ], [ "NEVER", 100 ], [ "IMMEDIATELY", 60 ] ]);
    });

    it("restores the scene without a history step on Escape, a second finger or a tool change", () => {
        const { canvas } = mount();
        const original = [ ...elements ];
        const expectRestored = () => {
            expect(sceneUpdates()).toEqual([ [ "NEVER", 120 ], [ "NEVER", 100 ] ]);
            expect(elements).toEqual(original);
            expect(apiRef.current && isPreviewingInsertSpace(apiRef.current)).toBe(false);
            expect(lines()).toEqual([]);
            updateScene.mockClear();
        };
        const preview = (pointerType = "mouse") => {
            pointer(canvas, "pointerdown", { clientY: 120, pointerType });
            pointer(canvas, "pointermove", { clientY: 160, pointerType });
            flushFrames();
        };

        preview();
        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        act(() => {
            canvas.dispatchEvent(escape);
        });
        expect(escape.defaultPrevented).toBe(true);
        expectRestored();
        pointer(canvas, "pointerup", { clientY: 200 });
        expect(updateScene).not.toHaveBeenCalled();

        preview("touch");
        pointer(canvas, "pointerdown", { clientY: 130, pointerType: "touch", pointerId: 4 });
        expectRestored();
        pointer(canvas, "pointerup", { clientY: 200 });

        preview();
        state = { ...state, activeTool: { ...state.activeTool, type: "selection", customType: null } } as AppState;
        act(() => {
            for (const listener of changeListeners) listener(elements, state);
        });
        expectRestored();

        // A move that waits for its frame is dropped.
        state = { ...state, activeTool: INSERT_SPACE_TOOL } as unknown as AppState;
        pointer(canvas, "pointerdown", { clientY: 120 });
        pointer(canvas, "pointermove", { clientY: 160 });
        pointer(canvas, "pointercancel", { clientY: 160 });
        flushFrames();
        expect(updateScene).not.toHaveBeenCalled();
    });

    it("leaves other tools and read-only drawings alone", () => {
        const { canvas } = mount();
        state = { ...state, activeTool: { ...state.activeTool, type: "freedraw", customType: null } } as AppState;
        expect(pointer(canvas, "pointerdown", { clientY: 120, pointerId: 5 }).defaultPrevented).toBe(false);
        pointer(canvas, "pointerup", { clientY: 200, pointerId: 5 });

        act(() => {
            render(null, container);
        });
        state = { ...state, activeTool: INSERT_SPACE_TOOL } as unknown as AppState;
        const readOnly = mount(false);
        expect(pointer(readOnly.canvas, "pointerdown", { clientY: 120, pointerId: 6 }).defaultPrevented).toBe(false);
        expect(updateScene).not.toHaveBeenCalled();
    });

    it("switches to the tool and recognizes it", () => {
        const setActiveTool = vi.fn();
        setInsertSpaceTool({ setActiveTool } as unknown as ExcalidrawImperativeAPI);
        expect(setActiveTool).toHaveBeenCalledWith({ type: "custom", customType: "insertSpace" });
        const isActive = (customType: string, viewModeEnabled: boolean) =>
            isInsertSpaceActive({ activeTool: { type: "custom", customType }, viewModeEnabled } as unknown as AppState);
        expect(isActive("insertSpace", false)).toBe(true);
        expect(isActive("lasso", false)).toBe(false);
        expect(isActive("insertSpace", true)).toBe(false);
    });
});

function box(id: string, x: number, y: number, overrides: Record<string, unknown> = {}) {
    return {
        id, x, y, width: 100, height: 20, angle: 0, type: "rectangle", groupIds: [], frameId: null,
        isDeleted: false, locked: false, version: 1, ...overrides
    } as unknown as ExcalidrawElement;
}
