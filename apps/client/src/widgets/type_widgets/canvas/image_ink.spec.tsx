import type { ExcalidrawElement, ExcalidrawFreeDrawElement, ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI, PointerDownState } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useImageInk, {
    DOUBLE_CLICK_MS, findImageUnderStroke, getCoverage, getImageOnlySelection, getInkGroupId, INK_GROUP_KEY,
    planInkAttachment
} from "./image_ink";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY" },
    mutateElement: (element: Record<string, unknown>, updates: object) => {
        Object.assign(element, updates, { version: Number(element.version ?? 0) + 1 });
        return element;
    }
}));

describe("getCoverage", () => {
    it("counts the points inside the bounds, rotation included", () => {
        const box = image({ x: 0, y: 0, width: 100, height: 20 });
        expect(getCoverage([ [ 10, 10 ], [ 90, 10 ], [ 50, 30 ], [ 50, -5 ] ], box)).toBe(0.5);

        // Turned a quarter, the 100 × 20 box spans x 40–60 and y −40–60.
        const turned = image({ x: 0, y: 0, width: 100, height: 20, angle: Math.PI / 2 });
        expect(getCoverage([ [ 50, -30 ], [ 50, 55 ], [ 10, 10 ], [ 90, 10 ] ], turned)).toBe(0.5);
        expect(getCoverage([], box)).toBe(0);
    });
});

describe("findImageUnderStroke", () => {
    it("picks the topmost unlocked image under most of the stroke", () => {
        const lower = image({ id: "lower" });
        const upper = image({ id: "upper", x: 50 });
        const stroke = freedraw({ x: 60, y: 10, points: line(2, 10) });
        expect(findImageUnderStroke(stroke, [ lower, upper, stroke ])?.id).toBe("upper");
        expect(findImageUnderStroke(stroke, [ lower, { ...upper, locked: true }, stroke ])?.id).toBe("lower");
        expect(findImageUnderStroke(stroke, [ lower, { ...upper, isDeleted: true }, stroke ])?.id).toBe("lower");
    });

    it("leaves a stroke that runs mostly off the image alone", () => {
        const picture = image({ width: 100 });
        // 2 of the 6 points lie past the right edge.
        const stroke = freedraw({ x: 64, y: 10, points: line(10, 6) });
        expect(findImageUnderStroke(stroke, [ picture, stroke ])).toBeNull();
        expect(findImageUnderStroke(freedraw({ x: 70, y: 10, points: line(10, 3) }), [ picture ])?.id).toBe(picture.id);
    });
});

describe("getInkGroupId", () => {
    it("reads the innermost group marked in customData", () => {
        const marked = image({ groupIds: [ "ink", "outer" ], customData: { [INK_GROUP_KEY]: "ink" } });
        expect(getInkGroupId(marked, [ marked ])).toBe("ink");
        expect(getInkGroupId(image({ groupIds: [ "user" ] }), [])).toBeNull();
        // After an ungroup, the mark names a group the image left.
        const ungrouped = image({ groupIds: [ "outer" ], customData: { [INK_GROUP_KEY]: "ink" } });
        const shape = freedraw({ groupIds: [ "outer" ] });
        expect(getInkGroupId(ungrouped, [ ungrouped, shape ])).toBeNull();
        expect(getInkGroupId(image({ customData: { [INK_GROUP_KEY]: "ink" } }), [])).toBeNull();
    });

    it("recognizes the ink group of a copy, whose members keep the old mark", () => {
        const copy = image({ id: "copy", groupIds: [ "new" ], customData: { [INK_GROUP_KEY]: "old" } });
        const ink = freedraw({ groupIds: [ "new" ], customData: { [INK_GROUP_KEY]: "old" } });
        expect(getInkGroupId(copy, [ copy, ink ])).toBe("new");
        const otherImage = image({ id: "other", groupIds: [ "new" ], customData: { [INK_GROUP_KEY]: "old" } });
        expect(getInkGroupId(copy, [ copy, ink, otherImage ])).toBeNull();
        expect(getInkGroupId(copy, [ copy, ink, freedraw({ groupIds: [ "new" ] }) ])).toBeNull();
    });
});

describe("planInkAttachment", () => {
    const createId = () => "new-group";

    it("creates an ink group innermost on the image and puts the stroke in it", () => {
        const picture = image({ groupIds: [ "outer" ], customData: { caption: "x" } });
        const stroke = freedraw({ x: 10, y: 10, points: line(5, 5) });
        expect(planInkAttachment(stroke, [ picture, stroke ], createId)).toEqual({
            image: picture,
            imageUpdates: { groupIds: [ "new-group", "outer" ], customData: { caption: "x", [INK_GROUP_KEY]: "new-group" } },
            strokeUpdates: { groupIds: [ "new-group", "outer" ], customData: { [INK_GROUP_KEY]: "new-group" } }
        });
    });

    it("reuses the image's ink group", () => {
        const picture = image({ groupIds: [ "ink" ], customData: { [INK_GROUP_KEY]: "ink" } });
        const stroke = freedraw({ x: 10, y: 10, points: line(5, 5) });
        expect(planInkAttachment(stroke, [ picture, stroke ], createId)).toMatchObject({
            imageUpdates: null,
            strokeUpdates: { groupIds: [ "ink" ] }
        });
    });

    it("leaves taps, strokes off images and strokes of other groups or frames alone", () => {
        const picture = image({});
        const strokeOn = { x: 10, y: 10, points: line(5, 5) };
        expect(planInkAttachment(freedraw(strokeOn), [ picture ], createId)).not.toBeNull();
        expect(planInkAttachment(freedraw({ x: 10, y: 10, points: [ [ 0, 0 ] ] }), [ picture ], createId)).toBeNull();
        expect(planInkAttachment(freedraw({ x: 500, y: 500, points: line(5, 5) }), [ picture ], createId)).toBeNull();
        expect(planInkAttachment(freedraw({ ...strokeOn, groupIds: [ "user" ] }), [ picture ], createId)).toBeNull();
        expect(planInkAttachment(freedraw({ ...strokeOn, frameId: "frame" }), [ picture ], createId)).toBeNull();
        expect(planInkAttachment(freedraw({ ...strokeOn, locked: true }), [ picture ], createId)).toBeNull();
    });
});

describe("getImageOnlySelection", () => {
    const picture = image({ id: "picture", groupIds: [ "ink", "outer" ], customData: { [INK_GROUP_KEY]: "ink" } });
    const stroke = freedraw({ id: "stroke", groupIds: [ "ink", "outer" ] });
    const elements = [ picture, stroke ];
    const groupSelected = {
        selectedGroupIds: { ink: true }, selectedElementIds: { picture: true, stroke: true }, editingGroupId: "outer"
    } as Pick<AppState, "selectedGroupIds" | "selectedElementIds" | "editingGroupId">;

    it("enters the ink group and selects only the image when the group is the selection", () => {
        expect(getImageOnlySelection(picture, groupSelected, elements)).toEqual({
            editingGroupId: "ink", selectedElementIds: { picture: true }, selectedGroupIds: {}
        });
    });

    it("leaves other clicks to Excalidraw", () => {
        expect(getImageOnlySelection(stroke, groupSelected, elements)).toBeNull();
        expect(getImageOnlySelection(picture, { ...groupSelected, editingGroupId: "ink", selectedGroupIds: {} }, elements)).toBeNull();
        expect(getImageOnlySelection(picture, { ...groupSelected, selectedGroupIds: { outer: true } }, elements)).toBeNull();
        const other = freedraw({ id: "other" });
        const withOther = { ...groupSelected, selectedElementIds: { ...groupSelected.selectedElementIds, other: true as const } };
        expect(getImageOnlySelection(picture, withOther, [ ...elements, other ])).toBeNull();
        const userGroup = image({ id: "picture", groupIds: [ "user" ] });
        expect(getImageOnlySelection(userGroup, { ...groupSelected, selectedGroupIds: { user: true } }, [ userGroup ])).toBeNull();
    });
});

describe("useImageInk", () => {
    let container: HTMLElement;
    let state: AppState;
    let elements: ExcalidrawElement[];
    let updateScene: ReturnType<typeof vi.fn>;
    let pointerUp: ((tool: AppState["activeTool"], down: PointerDownState, event: PointerEvent) => void) | null;
    let apiRef: { current: ExcalidrawImperativeAPI | null };

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        state = {
            activeTool: { type: "freedraw" }, newElement: null, selectedGroupIds: {}, selectedElementIds: {}, editingGroupId: null
        } as unknown as AppState;
        elements = [];
        updateScene = vi.fn();
        pointerUp = null;
        apiRef = {
            current: {
                getAppState: () => state,
                getSceneElements: () => elements,
                updateScene,
                onPointerUp: (callback: typeof pointerUp) => {
                    pointerUp = callback;
                    return () => {
                        pointerUp = null;
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

    function Harness({ enabled }: { enabled: boolean }) {
        const rootRef = useRef<HTMLDivElement>(null);
        useImageInk(rootRef, apiRef, { enabled });
        return <div ref={rootRef} />;
    }

    function mount(enabled = true) {
        act(() => {
            render(<Harness enabled={enabled} />, container);
        });
    }

    function excalidrawPointerUp(tool: string, down: { hit?: ExcalidrawElement | null; drag?: boolean; added?: boolean }, event: PointerEventInit & { timeStamp?: number } = {}) {
        const pointerDownState = {
            hit: { element: down.hit ?? null, wasAddedToSelection: down.added ?? false },
            drag: { hasOccurred: down.drag ?? false }
        } as unknown as PointerDownState;
        const pointerEvent = new PointerEvent("pointerup", { button: 0, ...event });
        Object.defineProperty(pointerEvent, "timeStamp", { value: event.timeStamp ?? 10_000 });
        pointerUp?.({ type: tool } as AppState["activeTool"], pointerDownState, pointerEvent);
    }

    it("puts a finished stroke on an image into the image's ink group, before Excalidraw ends it", () => {
        mount();
        const picture = image({ groupIds: [] });
        const stroke = freedraw({ x: 10, y: 10, points: line(5, 5) });
        elements = [ picture, stroke ];
        state = { ...state, newElement: stroke } as AppState;
        excalidrawPointerUp("freedraw", {});

        const [ groupId ] = picture.groupIds;
        expect(groupId).toHaveLength(21);
        expect(stroke.groupIds).toEqual([ groupId ]);
        expect(picture.customData?.[INK_GROUP_KEY]).toBe(groupId);
        expect(stroke.customData?.[INK_GROUP_KEY]).toBe(groupId);
        expect(updateScene).not.toHaveBeenCalled();
    });

    it("selects only the image on a plain click once its ink group is selected", () => {
        mount();
        const picture = image({ id: "picture", groupIds: [ "ink" ], customData: { [INK_GROUP_KEY]: "ink" } });
        const stroke = freedraw({ id: "stroke", groupIds: [ "ink" ] });
        elements = [ picture, stroke ];
        state = {
            ...state, activeTool: { type: "selection" }, selectedGroupIds: { ink: true },
            selectedElementIds: { picture: true, stroke: true }
        } as unknown as AppState;

        // The click that selects the group, a double-click, a drag and a click with Shift stay Excalidraw's.
        excalidrawPointerUp("selection", { hit: picture, added: true }, { timeStamp: 1000 });
        excalidrawPointerUp("selection", { hit: picture }, { timeStamp: 1000 + DOUBLE_CLICK_MS / 2 });
        excalidrawPointerUp("selection", { hit: picture, drag: true }, { timeStamp: 5000 });
        excalidrawPointerUp("selection", { hit: picture }, { timeStamp: 10_000, shiftKey: true });
        excalidrawPointerUp("selection", { hit: stroke }, { timeStamp: 15_000 });
        vi.runAllTimers();
        expect(updateScene).not.toHaveBeenCalled();

        excalidrawPointerUp("selection", { hit: picture }, { timeStamp: 20_000 });
        expect(updateScene).not.toHaveBeenCalled();
        vi.runAllTimers();
        expect(updateScene).toHaveBeenCalledWith({
            appState: { editingGroupId: "ink", selectedElementIds: { picture: true }, selectedGroupIds: {}, selectedLinearElement: null },
            captureUpdate: "IMMEDIATELY"
        });
    });

    it("does nothing when disabled", () => {
        mount(false);
        expect(pointerUp).toBeNull();
        mount(true);
        expect(pointerUp).not.toBeNull();
    });
});

function image(overrides: Partial<ExcalidrawImageElement>): ExcalidrawImageElement {
    return {
        id: "image", type: "image", x: 0, y: 0, width: 100, height: 100, angle: 0, groupIds: [], frameId: null,
        isDeleted: false, locked: false, version: 1, ...overrides
    } as ExcalidrawImageElement;
}

function freedraw(overrides: Partial<ExcalidrawFreeDrawElement>): ExcalidrawFreeDrawElement {
    return {
        id: "stroke", type: "freedraw", x: 0, y: 0, width: 0, height: 0, angle: 0, groupIds: [], frameId: null,
        isDeleted: false, locked: false, version: 1, points: [], ...overrides
    } as unknown as ExcalidrawFreeDrawElement;
}

/** `count` points along a horizontal line, `step` apart. */
function line(step: number, count: number) {
    return Array.from({ length: count }, (_, index) => [ index * step, 0 ]) as unknown as ExcalidrawFreeDrawElement["points"];
}
