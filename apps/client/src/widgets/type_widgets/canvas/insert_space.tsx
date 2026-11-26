import "./InsertSpace.css";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import { INTERACTIVE_CANVAS_SELECTOR, sceneToViewport, viewportToScene } from "./click_to_type";

/** The Excalidraw tool that inserts or removes space by dragging a line down or up. */
export const INSERT_SPACE_TOOL = { type: "custom", customType: "insertSpace" } as const;

/** How far, in screen pixels, the pointer must move for a release to change the drawing. */
const MIN_DRAG_PX = 2;

export interface InsertSpaceOptions {
    /** Whether the drawing can be edited. */
    enabled: boolean;
}

/** The two lines shown while dragging, in pixels from the top of the editor root. */
export interface InsertSpacePreview {
    /** Where the drag started. */
    lineTop: number;
    /** Where the moved content starts once the pointer is released, after clamping. */
    currentTop: number;
}

/** Which elements an insert space at a given line moves, and how far up they can go. */
export interface InsertSpacePlan {
    elementIds: Set<string>;
    /** How far, in scene units, the moved elements can go up before they reach other content or the line. */
    maxUp: number;
}

interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** The editors whose scene shows the preview of an insert space, which is not saved. */
const previewingApis = new WeakSet<ExcalidrawImperativeAPI>();

/**
 * OneNote-style Insert Space on a canvas, active while Excalidraw's tool is `INSERT_SPACE_TOOL`.
 * A press on the canvas sets a line; dragging down moves everything below it down by the drag
 * distance, dragging up moves it up until it reaches the line or the content above. The elements
 * follow the pointer as they will be placed. The move is one undo step; Escape cancels the drag.
 *
 * Each frame of the drag shows the elements with `CaptureUpdateAction.NEVER`, which moves the
 * snapshot of Excalidraw's store along with the scene and so records nothing. The release puts
 * back the elements of the press the same way, then moves them with
 * `CaptureUpdateAction.IMMEDIATELY`, which records the press-to-release change as one step.
 *
 * Returns the lines to show with `InsertSpaceOverlay` while a drag is in progress.
 */
export default function useInsertSpace(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    { enabled }: InsertSpaceOptions
) {
    const [ preview, setPreview ] = useState<InsertSpacePreview | null>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || !enabled) return;

        let subscribedApi: ExcalidrawImperativeAPI | null = null;
        let unsubscribe: (() => void) | null = null;
        let drag: DragState | null = null;

        function syncCursor(state: AppState) {
            if (!root) return;
            if (isInsertSpaceActive(state)) {
                root.dataset.insertSpace = "";
            } else {
                delete root.dataset.insertSpace;
                if (drag) end();
            }
        }

        /** Follows the app state of the editor, which mounts after this effect runs. */
        function subscribe() {
            const api = apiRef.current;
            if (!api || api === subscribedApi) return;

            unsubscribe?.();
            subscribedApi = api;
            unsubscribe = api.onChange((_elements, state) => syncCursor(state));
            syncCursor(api.getAppState());
        }

        function getDelta(current: DragState, clientY: number) {
            const deltaY = (clientY - current.startClientY) / current.zoom;
            return getInsertSpaceDelta(current.plan, deltaY);
        }

        function showPreview(current: DragState, delta: number) {
            if (!root) return;
            const rootTop = root.getBoundingClientRect().top;
            const toTop = (sceneY: number) => sceneToViewport({ sceneX: 0, sceneY }, current.view).clientY - rootTop;
            setPreview({ lineTop: toTop(current.lineY), currentTop: toTop(current.lineY + delta) });
        }

        function showElements(current: DragState) {
            current.frame = null;
            current.isMoved = true;
            current.api.updateScene({
                elements: moveElements(current.elements, current.plan.elementIds, current.delta),
                captureUpdate: CaptureUpdateAction.NEVER
            });
        }

        /** Ends the drag and puts back the elements as they were at the press. */
        function end() {
            if (!drag) return;
            const { target, pointerId, api, frame, isMoved, elements } = drag;
            drag = null;
            if (frame !== null) cancelAnimationFrame(frame);
            if (isMoved) api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
            previewingApis.delete(api);
            setPreview(null);
            try {
                if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
            } catch {
                // The pointer is already gone.
            }
        }

        function onPointerDown(e: PointerEvent) {
            subscribe();
            if (drag) {
                // A second finger cancels, so the press cannot turn into a pinch halfway.
                if (e.pointerId !== drag.pointerId) end();
                return;
            }

            const api = apiRef.current;
            const target = e.target;
            if (!api || !(target instanceof Element) || !target.matches(INTERACTIVE_CANVAS_SELECTOR)) return;
            if (e.button !== 0) return;

            const state = api.getAppState();
            if (!isInsertSpaceActive(state)) return;

            // Stopping the event in the capture phase keeps it from Excalidraw's own handlers.
            e.preventDefault();
            e.stopPropagation();

            const { sceneY: lineY } = viewportToScene(e, state);
            drag = {
                pointerId: e.pointerId,
                target,
                api,
                startClientY: e.clientY,
                lineY,
                zoom: state.zoom.value,
                view: pickView(state),
                plan: planInsertSpace(api.getSceneElements(), lineY),
                elements: api.getSceneElementsIncludingDeleted(),
                delta: 0,
                frame: null,
                isMoved: false
            };
            previewingApis.add(api);
            try {
                target.setPointerCapture(e.pointerId);
            } catch {
                // Synthetic events have no active pointer to capture.
            }
            showPreview(drag, 0);
        }

        function onPointerMove(e: PointerEvent) {
            if (!drag || e.pointerId !== drag.pointerId) return;
            e.stopPropagation();
            const current = drag;
            current.delta = getDelta(current, e.clientY);
            showPreview(current, current.delta);
            if (current.frame === null && current.plan.elementIds.size > 0) {
                current.frame = requestAnimationFrame(() => showElements(current));
            }
        }

        function onPointerUp(e: PointerEvent) {
            if (!drag || e.pointerId !== drag.pointerId) return;

            const current = drag;
            end();
            const { api } = current;
            if (e.type !== "pointerup" || Math.abs(e.clientY - current.startClientY) < MIN_DRAG_PX) return;

            const delta = getDelta(current, e.clientY);
            if (delta === 0 || current.plan.elementIds.size === 0) return;
            api.updateScene({
                elements: moveElements(api.getSceneElementsIncludingDeleted(), current.plan.elementIds, delta),
                captureUpdate: CaptureUpdateAction.IMMEDIATELY
            });
        }

        function onKeyDown(e: KeyboardEvent) {
            if (!drag || e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            end();
        }

        subscribe();
        root.addEventListener("pointerover", subscribe, { capture: true });
        root.addEventListener("pointerdown", onPointerDown, { capture: true });
        root.addEventListener("pointermove", onPointerMove, { capture: true });
        window.addEventListener("pointerup", onPointerUp, { capture: true });
        window.addEventListener("pointercancel", onPointerUp, { capture: true });
        window.addEventListener("keydown", onKeyDown, { capture: true });
        return () => {
            unsubscribe?.();
            end();
            delete root.dataset.insertSpace;
            root.removeEventListener("pointerover", subscribe, { capture: true });
            root.removeEventListener("pointerdown", onPointerDown, { capture: true });
            root.removeEventListener("pointermove", onPointerMove, { capture: true });
            window.removeEventListener("pointerup", onPointerUp, { capture: true });
            window.removeEventListener("pointercancel", onPointerUp, { capture: true });
            window.removeEventListener("keydown", onKeyDown, { capture: true });
        };
    }, [ rootRef, apiRef, enabled ]);

    return preview;
}

/**
 * The full-width line where the drag started, a dashed line where the moved content will start
 * and an arrow between them. Renders nothing while no drag is in progress.
 */
export function InsertSpaceOverlay({ preview }: { preview: InsertSpacePreview | null }) {
    if (!preview) return null;

    const { lineTop, currentTop } = preview;
    const isRemoving = currentTop < lineTop;
    return (
        <div className="canvas-insert-space" aria-hidden="true">
            <div
                className={`canvas-insert-space-band ${isRemoving ? "removing" : ""}`}
                style={{ top: Math.min(lineTop, currentTop), height: Math.abs(currentTop - lineTop) }}
            />
            <div className="canvas-insert-space-line" style={{ top: lineTop }} />
            <div className="canvas-insert-space-line current" style={{ top: currentTop }}>
                <span className={`bx ${isRemoving ? "bx-up-arrow-alt" : "bx-down-arrow-alt"}`} />
            </div>
        </div>
    );
}

/** Switches the editor to the Insert Space tool. */
export function setInsertSpaceTool(api: ExcalidrawImperativeAPI) {
    api.setActiveTool(INSERT_SPACE_TOOL);
}

/** Whether the Insert Space tool is active and the drawing can be edited. */
export function isInsertSpaceActive(state: Pick<AppState, "activeTool" | "viewModeEnabled">) {
    return state.activeTool.type === INSERT_SPACE_TOOL.type
        && state.activeTool.customType === INSERT_SPACE_TOOL.customType
        && !state.viewModeEnabled;
}

/**
 * Works out which elements an insert space at `lineY` moves: every one whose top is at or below
 * the line. A group, a container with its bound text and a frame with its children move as one,
 * decided by the top of the whole. Deleted and locked elements stay put.
 *
 * Moving up is limited so that no moved element goes above the line, nor above the bottom of a
 * content that stays and overlaps it horizontally, as OneNote only removes empty space.
 */
export function planInsertSpace(elements: readonly ExcalidrawElement[], lineY: number): InsertSpacePlan {
    const live = elements.filter((element) => !element.isDeleted && !element.locked);
    const unitOf = getUnits(live);

    const bounds = new Map<string, Bounds>();
    const unitTops = new Map<string, number>();
    for (const element of live) {
        const elementBounds = getRotatedBounds(element);
        bounds.set(element.id, elementBounds);
        const unit = unitOf(element.id);
        unitTops.set(unit, Math.min(unitTops.get(unit) ?? Infinity, elementBounds.top));
    }

    const moving: Bounds[] = [];
    const staying: Bounds[] = [];
    const elementIds = new Set<string>();
    for (const element of live) {
        const elementBounds = bounds.get(element.id);
        if (!elementBounds) continue;
        if ((unitTops.get(unitOf(element.id)) ?? -Infinity) >= lineY) {
            elementIds.add(element.id);
            moving.push(elementBounds);
        } else {
            staying.push(elementBounds);
        }
    }

    let maxUp = Infinity;
    for (const element of moving) {
        let floor = lineY;
        for (const other of staying) {
            const overlapsHorizontally = other.left < element.right && other.right > element.left;
            if (overlapsHorizontally && other.bottom <= element.top) floor = Math.max(floor, other.bottom);
        }
        maxUp = Math.min(maxUp, element.top - floor);
    }

    return { elementIds, maxUp: Number.isFinite(maxUp) ? Math.max(0, maxUp) : 0 };
}

/** Clamps a vertical drag, in scene units, to what `plan` allows. */
export function getInsertSpaceDelta(plan: InsertSpacePlan, deltaY: number) {
    return Math.max(deltaY, -plan.maxUp);
}

/** Returns `elements` with the ones in `elementIds` moved down by `delta`. */
export function moveElements(elements: readonly ExcalidrawElement[], elementIds: Set<string>, delta: number) {
    return elements.map((element) => elementIds.has(element.id)
        ? newElementWith(element, { y: element.y + delta })
        : element);
}

/** The axis-aligned box around `element` once rotated, as Excalidraw draws it. */
export function getRotatedBounds(element: ExcalidrawElement): Bounds {
    const points: [number, number][] = "points" in element && element.points.length > 0
        ? element.points.map(([ x, y ]): [number, number] => [ element.x + x, element.y + y ])
        : [
            [ element.x, element.y ],
            [ element.x + element.width, element.y ],
            [ element.x + element.width, element.y + element.height ],
            [ element.x, element.y + element.height ]
        ];

    const xs = points.map(([ x ]) => x);
    const ys = points.map(([ , y ]) => y);
    const unrotated = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    if (!element.angle) return unrotated;

    const cx = (unrotated.left + unrotated.right) / 2;
    const cy = (unrotated.top + unrotated.bottom) / 2;
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    const rotated = points.map(([ x, y ]) => [
        cx + (x - cx) * cos - (y - cy) * sin,
        cy + (x - cx) * sin + (y - cy) * cos
    ]);
    const rxs = rotated.map(([ x ]) => x);
    const rys = rotated.map(([ , y ]) => y);
    return { left: Math.min(...rxs), top: Math.min(...rys), right: Math.max(...rxs), bottom: Math.max(...rys) };
}

/** Whether the scene of `api` shows the preview of an insert space, which must not be saved. */
export function isPreviewingInsertSpace(api: ExcalidrawImperativeAPI | null) {
    return !!api && previewingApis.has(api);
}

interface DragState {
    pointerId: number;
    target: Element;
    api: ExcalidrawImperativeAPI;
    startClientY: number;
    /** The press line, in scene coordinates. */
    lineY: number;
    zoom: number;
    view: Pick<AppState, "scrollX" | "scrollY" | "zoom" | "offsetLeft" | "offsetTop">;
    plan: InsertSpacePlan;
    /** The scene at the press, deleted elements included, which each frame of the preview moves. */
    elements: readonly ExcalidrawElement[];
    /** The clamped move of the latest pointer position, in scene units. */
    delta: number;
    /** The animation frame that shows `delta`, while one is pending. */
    frame: number | null;
    /** Whether the scene shows a frame of the preview. */
    isMoved: boolean;
}

function pickView({ scrollX, scrollY, zoom, offsetLeft, offsetTop }: AppState) {
    return { scrollX, scrollY, zoom, offsetLeft, offsetTop };
}

/**
 * Joins the elements that must move together, with a union-find over their outermost group, the
 * container of a bound text and the frame of a child. Returns the unit id of an element id.
 */
function getUnits(elements: readonly ExcalidrawElement[]) {
    const parent = new Map<string, string>();
    const find = (id: string): string => {
        let root = id;
        let next = parent.get(root);
        while (next !== undefined && next !== root) {
            root = next;
            next = parent.get(root);
        }
        parent.set(id, root);
        return root;
    };
    const union = (a: string, b: string) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(rootA, rootB);
    };

    const ids = new Set(elements.map((element) => element.id));
    for (const element of elements) {
        parent.set(element.id, parent.get(element.id) ?? element.id);
        const outermostGroup = element.groupIds.at(-1);
        if (outermostGroup) union(element.id, `group:${outermostGroup}`);
        if ("containerId" in element && element.containerId && ids.has(element.containerId)) {
            union(element.id, element.containerId);
        }
        if (element.frameId && ids.has(element.frameId)) union(element.id, element.frameId);
    }
    return find;
}
