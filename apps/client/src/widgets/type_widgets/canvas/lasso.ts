import "./Lasso.css";

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

import { INTERACTIVE_CANVAS_SELECTOR, viewportToScene } from "./click_to_type";

/** The share of an element's sample points that must lie inside the lasso to select it. */
export const LASSO_INSIDE_RATIO = 0.8;

/** How far, in screen pixels, the pointer moves before the lasso takes another point. */
const MIN_POINT_DISTANCE_PX = 2;

/** How far, in screen pixels, around the selection a press still grabs it. */
export const SELECTION_HIT_PADDING_PX = 16;

/** How many points of an ellipse's outline stand for it. */
const ELLIPSE_SAMPLES = 8;

const SECONDARY_BUTTONS_MASK = 2;
const ERASER_BUTTONS_MASK = 32;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** The ink toolbar's lasso, which is Excalidraw's `custom` tool as Excalidraw has no lasso. */
export const LASSO_TOOL = { type: "custom", customType: "lasso" } as const;

/** A point as `[x, y]`. */
export type Point = readonly [number, number];

/** The selection a lasso makes, in the shape of Excalidraw's app state. */
export interface LassoSelection {
    selectedElementIds: Record<string, true>;
    selectedGroupIds: Record<string, boolean>;
}

/** The APIs whose selection tool holds what the lasso tool selected, each with its `onChange` unsubscriber. */
const lassoHolds = new WeakMap<ExcalidrawImperativeAPI, () => void>();

/**
 * The lasso tool of the ink toolbar, for the pen, the mouse and one finger: a drag draws a lasso
 * and selects what lies mostly inside it, then switches to the selection tool, so that the
 * selection can be moved, resized and rotated as Excalidraw does. A press outside the selection
 * then comes back to the lasso and starts a new one. With Excalidraw's pen mode, fingers pan.
 */
export default function useLassoTool(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    { isEditable }: { isEditable: boolean }
) {
    useEffect(() => {
        const rootElement = rootRef.current;
        if (!rootElement) return;
        const root: HTMLElement = rootElement;

        const touches = new Set<number>();
        let session: { pointerId: number; pointerType: string; cancel: () => void } | null = null;
        let heldApi: ExcalidrawImperativeAPI | null = null;

        function begin(api: ExcalidrawImperativeAPI, e: PointerEvent) {
            e.preventDefault();
            e.stopPropagation();
            const cancel = startLasso(root, api, e, (selection) => {
                session = null;
                if (!selection || !hasSelection(selection)) return;

                holdLassoSelection(api);
                heldApi = api;
                applyLassoSelection(api, selection);
            });
            session = { pointerId: e.pointerId, pointerType: e.pointerType, cancel };
        }

        function onPointerDown(e: PointerEvent) {
            if (e.pointerType === "touch") touches.add(e.pointerId);
            if (session) {
                // A second finger cancels the lasso of the first one.
                if (e.pointerType === "touch" && session.pointerType === "touch") {
                    session.cancel();
                    session = null;
                }
                return;
            }

            const api = apiRef.current;
            const isCanvas = e.target instanceof Element && e.target.matches(INTERACTIVE_CANVAS_SELECTOR);
            if (!api || !isEditable || !isCanvas || e.defaultPrevented) return;
            if (e.button !== 0 || e.buttons & (SECONDARY_BUTTONS_MASK | ERASER_BUTTONS_MASK)) return;

            const state = api.getAppState();
            if (state.viewModeEnabled) return;
            if (e.pointerType === "touch" && (touches.size > 1 || state.penMode)) return;

            if (isLassoTool(state.activeTool)) {
                begin(api, e);
                return;
            }
            if (!isHoldingLassoSelection(api)) return;
            if (hitsSelection(api, state, e)) return;

            releaseLassoSelection(api);
            api.setActiveTool(LASSO_TOOL);
            begin(api, e);
        }

        function onPointerEnd(e: PointerEvent) {
            touches.delete(e.pointerId);
        }

        root.addEventListener("pointerdown", onPointerDown, { capture: true });
        window.addEventListener("pointerup", onPointerEnd, { capture: true });
        window.addEventListener("pointercancel", onPointerEnd, { capture: true });
        return () => {
            session?.cancel();
            if (heldApi) releaseLassoSelection(heldApi);
            root.removeEventListener("pointerdown", onPointerDown, { capture: true });
            window.removeEventListener("pointerup", onPointerEnd, { capture: true });
            window.removeEventListener("pointercancel", onPointerEnd, { capture: true });
        };
    }, [ rootRef, apiRef, isEditable ]);
}

/** Whether `activeTool` is the lasso of the ink toolbar. */
export function isLassoTool(activeTool: Pick<AppState["activeTool"], "type" | "customType">) {
    return activeTool.type === "custom" && activeTool.customType === LASSO_TOOL.customType;
}

/**
 * Marks the selection tool of `api` as holding what the lasso tool selected, so that the ink
 * toolbar still shows the lasso and a press outside the selection starts a new lasso. Call it
 * before `applyLassoSelection()`. The hold ends once a tool other than these two is picked.
 */
export function holdLassoSelection(api: ExcalidrawImperativeAPI) {
    releaseLassoSelection(api);
    const unsubscribe = api.onChange((_elements, state) => {
        if (state.activeTool.type !== "selection" && !isLassoTool(state.activeTool)) releaseLassoSelection(api);
    });
    lassoHolds.set(api, unsubscribe);
}

/** Whether the selection tool of `api` holds what the lasso tool selected. */
export function isHoldingLassoSelection(api: ExcalidrawImperativeAPI) {
    return lassoHolds.has(api) && api.getAppState().activeTool.type === "selection";
}

/** Ends the hold of `holdLassoSelection()`, as when the selection tool is picked. */
export function releaseLassoSelection(api: ExcalidrawImperativeAPI) {
    lassoHolds.get(api)?.();
    lassoHolds.delete(api);
}

/**
 * Draws a lasso from the press `start` until its pointer is released, and calls `onEnd` with the
 * selection it makes, or with `null` when the pointer is canceled. The lasso shows as a dashed line
 * over `root`. Returns a function that removes the lasso without calling `onEnd`.
 */
export function startLasso(
    root: HTMLElement,
    api: ExcalidrawImperativeAPI,
    start: PointerEvent,
    onEnd: (selection: LassoSelection | null) => void
) {
    const state = api.getAppState();
    const rootRect = root.getBoundingClientRect();
    const screenPoints: Point[] = [];
    const scenePoints: Point[] = [];

    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.classList.add("canvas-lasso");
    svg.setAttribute("aria-hidden", "true");
    const halo = document.createElementNS(SVG_NAMESPACE, "polyline");
    halo.classList.add("canvas-lasso-halo");
    const line = document.createElementNS(SVG_NAMESPACE, "polyline");
    line.classList.add("canvas-lasso-line");
    svg.append(halo, line);
    root.append(svg);

    function addPoint({ clientX, clientY }: { clientX: number; clientY: number }) {
        const screenPoint: Point = [ clientX - rootRect.left, clientY - rootRect.top ];
        const last = screenPoints.at(-1);
        if (last && Math.hypot(screenPoint[0] - last[0], screenPoint[1] - last[1]) < MIN_POINT_DISTANCE_PX) return;

        screenPoints.push(screenPoint);
        const { sceneX, sceneY } = viewportToScene({ clientX, clientY }, state);
        scenePoints.push([ sceneX, sceneY ]);
        const attribute = screenPoints.map(([ x, y ]) => `${x},${y}`).join(" ");
        halo.setAttribute("points", attribute);
        line.setAttribute("points", attribute);
    }

    function onPointerMove(e: PointerEvent) {
        if (e.pointerId !== start.pointerId) return;
        const coalesced = e.getCoalescedEvents?.();
        for (const event of coalesced?.length ? coalesced : [ e ]) {
            addPoint(event);
        }
    }

    function onPointerUp(e: PointerEvent) {
        if (e.pointerId !== start.pointerId) return;
        addPoint(e);
        stop();
        onEnd(getLassoSelection(scenePoints, api.getSceneElements()));
    }

    function onPointerCancel(e: PointerEvent) {
        if (e.pointerId !== start.pointerId) return;
        stop();
        onEnd(null);
    }

    function stop() {
        svg.remove();
        window.removeEventListener("pointermove", onPointerMove, { capture: true });
        window.removeEventListener("pointerup", onPointerUp, { capture: true });
        window.removeEventListener("pointercancel", onPointerCancel, { capture: true });
    }

    addPoint(start);
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    window.addEventListener("pointercancel", onPointerCancel, { capture: true });
    return stop;
}

/** Selects `selection` with Excalidraw's selection tool, which can then move it. */
export function applyLassoSelection(api: ExcalidrawImperativeAPI, selection: LassoSelection) {
    api.setActiveTool({ type: "selection" });
    api.updateScene({
        appState: {
            selectedElementIds: selection.selectedElementIds,
            selectedGroupIds: selection.selectedGroupIds,
            editingGroupId: null
        }
    });
}

export function hasSelection(selection: LassoSelection) {
    return Object.keys(selection.selectedElementIds).length > 0;
}

/**
 * The elements that the lasso `polygon`, in scene coordinates and closed implicitly, selects, as
 * OneNote does: those with at least `LASSO_INSIDE_RATIO` of their sample points inside it. Deleted
 * and locked elements are left out. A text bound to a container selects the container, and an
 * element of a group selects its outermost group, as Excalidraw's selection box does.
 */
export function getLassoSelection(polygon: readonly Point[], elements: readonly ExcalidrawElement[]): LassoSelection {
    const selection: LassoSelection = { selectedElementIds: {}, selectedGroupIds: {} };
    if (polygon.length < 3) return selection;

    const live = elements.filter((element) => !element.isDeleted);
    const byId = new Map(live.map((element) => [ element.id, element ]));
    const picked = new Set<ExcalidrawElement>();
    for (const element of live) {
        if (element.locked || !isMostlyInside(getSamplePoints(element), polygon)) continue;

        const container = getContainer(element, byId);
        const target = container ?? element;
        if (!target.locked) picked.add(target);
    }

    for (const element of picked) {
        const groupId = element.groupIds.at(-1);
        if (!groupId) {
            selection.selectedElementIds[element.id] = true;
            continue;
        }
        selection.selectedGroupIds[groupId] = true;
        for (const member of live) {
            if (member.groupIds.includes(groupId)) selection.selectedElementIds[member.id] = true;
        }
    }
    return selection;
}

/**
 * The points in scene coordinates that stand for `element` when it is tested against a lasso:
 * the points of a stroke or a line, the outline of an ellipse, the corners of a diamond, or else
 * the corners of the bounding box, each with the center, and turned by the element's `angle`.
 */
export function getSamplePoints(element: ExcalidrawElement): Point[] {
    const { x, y, width, height, angle } = element;
    let points: Point[];
    let center: Point;
    if ("points" in element && element.points.length) {
        points = element.points.map(([ px, py ]) => [ x + px, y + py ] as const);
        const xs = points.map(([ px ]) => px);
        const ys = points.map(([ , py ]) => py);
        center = [ (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2 ];
    } else {
        center = [ x + width / 2, y + height / 2 ];
        if (element.type === "ellipse") {
            points = Array.from({ length: ELLIPSE_SAMPLES }, (_, index) => {
                const theta = (index / ELLIPSE_SAMPLES) * 2 * Math.PI;
                return [ center[0] + (width / 2) * Math.cos(theta), center[1] + (height / 2) * Math.sin(theta) ] as const;
            });
        } else if (element.type === "diamond") {
            points = [ [ center[0], y ], [ x + width, center[1] ], [ center[0], y + height ], [ x, center[1] ] ];
        } else {
            points = [ [ x, y ], [ x + width, y ], [ x + width, y + height ], [ x, y + height ] ];
        }
        points.push(center);
    }
    return angle ? points.map((point) => rotate(point, center, angle)) : points;
}

/** Whether `point` lies inside `polygon`, closed implicitly, by the even-odd rule. */
export function isPointInPolygon([ px, py ]: Point, polygon: readonly Point[]) {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [ xi, yi ] = polygon[i];
        const [ xj, yj ] = polygon[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            isInside = !isInside;
        }
    }
    return isInside;
}

/** Whether `event` lands on the bounding box of the selected elements or near its handles. */
export function hitsSelection(api: ExcalidrawImperativeAPI, state: AppState, event: { clientX: number; clientY: number }) {
    const selected = api.getSceneElements().filter((element) => state.selectedElementIds[element.id]);
    if (!selected.length) return false;

    const [ minX, minY, maxX, maxY ] = getRotatedBounds(selected);
    const { sceneX, sceneY } = viewportToScene(event, state);
    const padding = SELECTION_HIT_PADDING_PX / state.zoom.value;
    return sceneX >= minX - padding && sceneX <= maxX + padding
        && sceneY >= minY - padding && sceneY <= maxY + padding;
}

/** The axis-aligned bounds of `elements`, each turned about its center by its `angle`. */
export function getRotatedBounds(elements: readonly ExcalidrawElement[]) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { x, y, width, height, angle } of elements) {
        const center: Point = [ x + width / 2, y + height / 2 ];
        for (const corner of [ [ x, y ], [ x + width, y ], [ x, y + height ], [ x + width, y + height ] ] as const) {
            const [ cornerX, cornerY ] = rotate(corner, center, angle);
            minX = Math.min(minX, cornerX);
            minY = Math.min(minY, cornerY);
            maxX = Math.max(maxX, cornerX);
            maxY = Math.max(maxY, cornerY);
        }
    }
    return [ minX, minY, maxX, maxY ];
}

function isMostlyInside(points: readonly Point[], polygon: readonly Point[]) {
    let inside = 0;
    for (const point of points) {
        if (isPointInPolygon(point, polygon)) inside++;
    }
    return inside >= points.length * LASSO_INSIDE_RATIO;
}

function getContainer(element: ExcalidrawElement, byId: Map<string, ExcalidrawElement>) {
    if (element.type !== "text" || !element.containerId) return null;
    return byId.get(element.containerId) ?? null;
}

function rotate([ px, py ]: Point, [ cx, cy ]: Point, angle: number): Point {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = px - cx;
    const dy = py - cy;
    return [ cx + dx * cos - dy * sin, cy + dx * sin + dy * cos ];
}
