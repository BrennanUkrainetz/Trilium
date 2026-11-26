import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
    ExcalidrawElement, ExcalidrawFreeDrawElement, ExcalidrawLinearElement
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

export type Point = readonly [number, number];

/** A clean shape recognized in a pen stroke, in the coordinates of the stroke's points. */
export type RecognizedShape =
    | { type: "line"; start: Point; end: Point }
    | { type: "rectangle"; x: number; y: number; width: number; height: number; angle: number }
    | { type: "ellipse"; x: number; y: number; width: number; height: number; angle: number }
    | { type: "triangle"; points: readonly [Point, Point, Point] };

export interface RecognizeOptions {
    /** The smallest diagonal of a closed shape's bounds, in the units of the points. */
    minSize?: number;
    /** The shortest line, in the units of the points. */
    minLineLength?: number;
}

export interface InkToShapeOptions {
    /** Whether holding the pen still at the end of a stroke snaps it to a shape. */
    enabled: boolean;
    /** Whether every finished stroke that reads as a shape snaps to it. */
    autoSnap: boolean;
}

/** How long, in milliseconds, the pen rests at the end of a stroke before the stroke snaps. */
export const HOLD_TO_SNAP_MS = 500;

/** How far, in screen pixels, the pen can drift while it rests. */
const HOLD_SLOP_PX = 4;

/** The smallest shapes, in screen pixels, that snap when the stroke ends. */
const AUTO_THRESHOLDS = { minSize: 30, minLineLength: 48 };

/** The smallest shapes, in screen pixels, that snap when the pen rests. */
const HOLD_THRESHOLDS = { minSize: 12, minLineLength: 16 };

/**
 * The ratio of a shape's stroke width to the width of the pen stroke it replaces. Excalidraw draws
 * a freedraw element `strokeWidth * 4.25` wide at full pressure, so a shape with the same
 * `strokeWidth` looks much thinner than the ink.
 */
const SHAPE_STROKE_WIDTH_RATIO = 3;

/** A freedraw element wider than this is a highlighter, which never snaps. */
const MAX_SNAPPABLE_STROKE_WIDTH = 8;

/** How many frames to wait for Excalidraw to finalize a stroke. */
const MAX_FINALIZE_WAIT_FRAMES = 5;

const LINE_MIN_STRAIGHTNESS = 0.9;
const LINE_MAX_DEVIATION_RATIO = 0.05;
const LINE_ANGLE_SNAP = degrees(6);

const CLOSED_MAX_GAP_RATIO = 0.1;
const CLOSED_MIN_ASPECT = 0.15;
const MAX_OVERSHOOT_RATIO = 0.15;
const LOOP_MAX_TURN_RATIO = 1.35;
const CORNER_MIN_TURN = degrees(35);
const MAX_MEAN_FIT_ERROR = 0.06;
const MAX_PEAK_FIT_ERROR = 0.15;
const ELLIPSE_MAX_RADIAL_ERROR = 0.25;
const SQUARE_SNAP_RATIO = 0.12;
const CIRCLE_SNAP_RATIO = 0.85;
const RECTANGLE_ANGLE_SNAP = degrees(8);
const ELLIPSE_ANGLE_SNAP = degrees(10);
const FIT_SAMPLE_COUNT = 64;

/**
 * OneNote-style ink to shape for freedraw strokes. Resting the pen for `HOLD_TO_SNAP_MS` at the
 * end of a stroke ends the stroke and replaces it with the line, rectangle, ellipse or triangle
 * it reads as. With `autoSnap`, every stroke that reads as one is replaced when the pen lifts.
 * Highlighter strokes are left alone.
 *
 * As Excalidraw has no API to end a stroke, a rest dispatches a `pointerup` on `window`, which
 * Excalidraw's pointer-down handler listens to. The pen's moves until it lifts are kept from
 * Excalidraw.
 */
export default function useInkToShape(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    { enabled, autoSnap }: InkToShapeOptions
) {
    const autoSnapRef = useRef(autoSnap);
    autoSnapRef.current = autoSnap;

    useEffect(() => {
        const root = rootRef.current;
        if (!root || !enabled) {
            return;
        }

        let stroke: StrokeState | null = null;
        let isDispatching = false;
        let isUnmounted = false;

        function clearHold() {
            if (stroke?.holdTimer) {
                clearTimeout(stroke.holdTimer);
                stroke.holdTimer = null;
            }
        }

        function armHold() {
            clearHold();
            if (stroke) {
                stroke.holdTimer = setTimeout(onHold, HOLD_TO_SNAP_MS);
            }
        }

        function trackElement() {
            const element = apiRef.current?.getAppState().newElement;
            if (stroke && element?.type === "freedraw") {
                stroke.elementId = element.id;
            }
        }

        function scheduleSnap(elementId: string, thresholds: RecognizeOptions, framesLeft = MAX_FINALIZE_WAIT_FRAMES) {
            requestAnimationFrame(() => {
                const api = apiRef.current;
                if (isUnmounted || !api) {
                    return;
                }
                if (api.getAppState().newElement?.id === elementId) {
                    if (framesLeft > 0) {
                        scheduleSnap(elementId, thresholds, framesLeft - 1);
                    }
                    return;
                }
                snapStrokeToShape(api, elementId, thresholds);
            });
        }

        function onHold() {
            const api = apiRef.current;
            const current = stroke;
            if (!api || !current) {
                return;
            }
            current.holdTimer = null;
            trackElement();
            const element = api.getAppState().newElement;
            if (element?.type !== "freedraw" || element.id !== current.elementId || !isSnappableStroke(element)) {
                return;
            }
            const thresholds = toSceneThresholds(HOLD_THRESHOLDS, api.getAppState().zoom.value);
            if (!recognizeShape(getAbsolutePoints(element), thresholds)) {
                return;
            }

            current.isSnapped = true;
            isDispatching = true;
            try {
                window.dispatchEvent(new PointerEvent("pointerup", {
                    bubbles: true,
                    pointerId: current.pointerId,
                    pointerType: current.pointerType,
                    isPrimary: true,
                    clientX: current.clientX,
                    clientY: current.clientY,
                    pressure: current.pressure
                }));
            } finally {
                isDispatching = false;
            }
            scheduleSnap(element.id, thresholds);
        }

        function onPointerDown(e: PointerEvent) {
            if (stroke) {
                // A second pointer is a pinch or a palm, not a pen stroke.
                clearHold();
                stroke = null;
                return;
            }
            const api = apiRef.current;
            if (!api || e.button !== 0 || api.getAppState().activeTool.type !== "freedraw") {
                return;
            }
            stroke = {
                pointerId: e.pointerId,
                pointerType: e.pointerType,
                anchorX: e.clientX,
                anchorY: e.clientY,
                clientX: e.clientX,
                clientY: e.clientY,
                pressure: e.pressure,
                elementId: null,
                holdTimer: null,
                isSnapped: false
            };
            armHold();
        }

        function onPointerMove(e: PointerEvent) {
            if (!stroke || e.pointerId !== stroke.pointerId) {
                return;
            }
            if (stroke.isSnapped) {
                e.stopPropagation();
                return;
            }
            stroke.clientX = e.clientX;
            stroke.clientY = e.clientY;
            stroke.pressure = e.pressure;
            trackElement();
            if (Math.hypot(e.clientX - stroke.anchorX, e.clientY - stroke.anchorY) > HOLD_SLOP_PX) {
                stroke.anchorX = e.clientX;
                stroke.anchorY = e.clientY;
                armHold();
            }
        }

        function onPointerUp(e: PointerEvent) {
            if (isDispatching || !stroke || e.pointerId !== stroke.pointerId) {
                return;
            }
            const finished = stroke;
            clearHold();
            stroke = null;
            const api = apiRef.current;
            if (api && e.type === "pointerup" && !finished.isSnapped && autoSnapRef.current && finished.elementId) {
                scheduleSnap(finished.elementId, toSceneThresholds(AUTO_THRESHOLDS, api.getAppState().zoom.value));
            }
        }

        root.addEventListener("pointerdown", onPointerDown, true);
        root.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("pointercancel", onPointerUp, true);
        return () => {
            isUnmounted = true;
            clearHold();
            root.removeEventListener("pointerdown", onPointerDown, true);
            root.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", onPointerUp, true);
            window.removeEventListener("pointercancel", onPointerUp, true);
        };
    }, [ rootRef, apiRef, enabled ]);
}

interface StrokeState {
    pointerId: number;
    pointerType: string;
    /** Where the pen came to rest, which moves when the pen drifts past `HOLD_SLOP_PX`. */
    anchorX: number;
    anchorY: number;
    clientX: number;
    clientY: number;
    pressure: number;
    elementId: string | null;
    holdTimer: ReturnType<typeof setTimeout> | null;
    isSnapped: boolean;
}

/** Whether a freedraw element is ink that can snap, as opposed to a highlighter stroke. */
export function isSnappableStroke(element: ExcalidrawFreeDrawElement) {
    return element.opacity >= 100 && element.strokeWidth <= MAX_SNAPPABLE_STROKE_WIDTH && !element.locked;
}

/**
 * Replaces the freedraw element `elementId` with the shape it reads as, in one undo step.
 * Returns whether it did.
 */
export function snapStrokeToShape(api: ExcalidrawImperativeAPI, elementId: string, thresholds: RecognizeOptions) {
    const elements = api.getSceneElementsIncludingDeleted();
    const index = elements.findIndex((element) => element.id === elementId);
    const source = elements[index];
    if (!source || source.isDeleted || source.type !== "freedraw" || !isSnappableStroke(source)) {
        return false;
    }
    const shape = recognizeShape(getAbsolutePoints(source), thresholds);
    if (!shape) {
        return false;
    }
    const [ replacement ] = convertToExcalidrawElements([ shapeToSkeleton(shape, source) ]);
    if (!replacement) {
        return false;
    }
    api.updateScene({
        elements: [
            ...elements.slice(0, index),
            newElementWith(source, { isDeleted: true }),
            replacement,
            ...elements.slice(index + 1)
        ],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
    return true;
}

/** Builds the Excalidraw element for `shape`, styled as the pen stroke `source`. */
export function shapeToSkeleton(shape: RecognizedShape, source: ExcalidrawFreeDrawElement): ExcalidrawElementSkeleton {
    const style = {
        strokeColor: source.strokeColor,
        backgroundColor: "transparent",
        fillStyle: source.fillStyle,
        strokeWidth: source.strokeWidth * SHAPE_STROKE_WIDTH_RATIO,
        strokeStyle: source.strokeStyle,
        roughness: 0,
        opacity: source.opacity,
        groupIds: [ ...source.groupIds ],
        frameId: source.frameId,
        customData: source.customData,
        roundness: null
    };

    switch (shape.type) {
        case "rectangle":
        case "ellipse":
            return {
                ...style,
                type: shape.type,
                x: shape.x,
                y: shape.y,
                width: shape.width,
                height: shape.height,
                angle: shape.angle as ExcalidrawElement["angle"]
            };
        case "line":
            return linearSkeleton(style, [ shape.start, shape.end ]);
        case "triangle":
            return linearSkeleton(style, [ ...shape.points, shape.points[0] ]);
    }
}

function linearSkeleton(style: Partial<ExcalidrawLinearElement>, points: readonly Point[]): ExcalidrawElementSkeleton {
    const [ originX, originY ] = points[0];
    return {
        ...style,
        type: "line",
        x: originX,
        y: originY,
        points: points.map(([ x, y ]) => [ x - originX, y - originY ]) as unknown as ExcalidrawLinearElement["points"]
    };
}

function getAbsolutePoints(element: ExcalidrawFreeDrawElement): Point[] {
    return element.points.map(([ x, y ]) => [ x + element.x, y + element.y ] as const);
}

function toSceneThresholds(screen: Required<RecognizeOptions>, zoom: number): RecognizeOptions {
    return { minSize: screen.minSize / zoom, minLineLength: screen.minLineLength / zoom };
}

/**
 * Recognizes a straight line, a rectangle or square, an ellipse or circle, or a triangle in a
 * pen stroke. Returns `null` for anything else, such as handwriting, so it errs towards leaving
 * the ink alone.
 *
 * A line is a stroke whose endpoints are nearly as far apart as the stroke is long and whose
 * points stay close to the line through them. A closed stroke is simplified with
 * Ramer–Douglas–Peucker to find its corners: three or four make a triangle or rectangle
 * candidate, and every closed stroke is also fitted with an ellipse. The candidate whose outline
 * lies closest to the stroke wins, if it is close enough.
 */
export function recognizeShape(points: readonly Point[], { minSize = 30, minLineLength = 48 }: RecognizeOptions = {}): RecognizedShape | null {
    const path = removeDuplicates(points);
    if (path.length < 3) {
        return null;
    }
    return recognizeLine(path, minLineLength) ?? recognizeClosedShape(path, minSize);
}

function recognizeLine(path: Point[], minLength: number): RecognizedShape | null {
    const first = path[0];
    const last = path[path.length - 1];
    const chord = distance(first, last);
    if (chord < minLength) {
        return null;
    }
    const smoothLength = pathLength(simplify(path, Math.max(2, 0.03 * chord)));
    if (chord / smoothLength < LINE_MIN_STRAIGHTNESS) {
        return null;
    }

    const { center, angle } = principalAxis(path);
    const direction: Point = [ Math.cos(angle), Math.sin(angle) ];
    const maxDeviation = Math.max(...path.map((point) => Math.abs(cross(direction, subtract(point, center)))));
    if (maxDeviation > Math.max(3, LINE_MAX_DEVIATION_RATIO * chord)) {
        return null;
    }

    // The endpoints are projected onto the fitted line, keeping the direction of the stroke.
    const startT = dot(direction, subtract(first, center));
    const endT = dot(direction, subtract(last, center));
    let lineAngle = Math.atan2(direction[1], direction[0]) + (endT < startT ? Math.PI : 0);
    const length = Math.abs(endT - startT);
    const midT = (startT + endT) / 2;
    const middle: Point = [ center[0] + direction[0] * midT, center[1] + direction[1] * midT ];

    const step = Math.PI / 4;
    const snapped = Math.round(lineAngle / step) * step;
    if (Math.abs(snapped - lineAngle) <= LINE_ANGLE_SNAP) {
        lineAngle = snapped;
    }
    const half: Point = [ Math.cos(lineAngle) * length / 2, Math.sin(lineAngle) * length / 2 ];
    return {
        type: "line",
        start: [ middle[0] - half[0], middle[1] - half[1] ],
        end: [ middle[0] + half[0], middle[1] + half[1] ]
    };
}

function recognizeClosedShape(path: Point[], minSize: number): RecognizedShape | null {
    const trimmed = trimOvershoot(path);
    const length = pathLength(trimmed);
    if (distance(trimmed[0], trimmed[trimmed.length - 1]) > CLOSED_MAX_GAP_RATIO * length) {
        return null;
    }
    const box = bounds(trimmed);
    const diagonal = Math.hypot(box.width, box.height);
    if (diagonal < minSize || Math.min(box.width, box.height) < CLOSED_MIN_ASPECT * Math.max(box.width, box.height)) {
        return null;
    }

    // A simple loop turns once around in one direction; a figure eight, a spiral or a scribble does not.
    const outline = simplifyClosed(trimmed, Math.max(1.5, 0.025 * diagonal));
    if (outline.length < 3) {
        return null;
    }
    const turns = turningAngles(outline);
    const totalTurn = Math.abs(sum(turns));
    const absoluteTurn = sum(turns.map(Math.abs));
    if (Math.abs(totalTurn - 2 * Math.PI) > 0.5 || absoluteTurn > LOOP_MAX_TURN_RATIO * 2 * Math.PI) {
        return null;
    }

    const samples = resampleClosed(trimmed, FIT_SAMPLE_COUNT);
    const candidates: { shape: RecognizedShape; error: number }[] = [];
    const ellipse = fitEllipse(samples);
    if (ellipse) {
        candidates.push(ellipse);
    }

    const corners = mergeShallowCorners(simplifyClosed(trimmed, Math.max(2, 0.06 * diagonal)));
    const cornerTurns = turningAngles(corners);
    const isConvex = cornerTurns.every((turn) => Math.sign(turn) === Math.sign(cornerTurns[0]));
    if (isConvex && corners.length === 4 && cornerTurns.every((turn) => isBetween(Math.abs(turn), degrees(50), degrees(130)))) {
        const rectangle = fitRectangle(corners, samples);
        if (rectangle) {
            candidates.push(rectangle);
        }
    }
    if (isConvex && corners.length === 3 && cornerTurns.every((turn) => isBetween(Math.abs(turn), degrees(45), degrees(165)))) {
        candidates.push(fitTriangle(corners, samples));
    }

    let best: { shape: RecognizedShape; error: number } | null = null;
    for (const candidate of candidates) {
        if (candidate.error <= MAX_MEAN_FIT_ERROR && (!best || candidate.error < best.error)) {
            best = candidate;
        }
    }
    return best?.shape ?? null;
}

function fitRectangle(corners: Point[], samples: Point[]) {
    // The orientation is the mean direction of the edges, modulo a quarter turn.
    let sinSum = 0;
    let cosSum = 0;
    for (const [ index, corner ] of corners.entries()) {
        const next = corners[(index + 1) % corners.length];
        const edge = subtract(next, corner);
        const weight = Math.hypot(edge[0], edge[1]);
        const edgeAngle = Math.atan2(edge[1], edge[0]);
        sinSum += weight * Math.sin(4 * edgeAngle);
        cosSum += weight * Math.cos(4 * edgeAngle);
    }
    const angle = Math.atan2(sinSum, cosSum) / 4;

    const rotated = corners.map((corner) => rotate(corner, -angle));
    const us = rotated.map(([ u ]) => u).sort((a, b) => a - b);
    const vs = rotated.map(([ , v ]) => v).sort((a, b) => a - b);
    const left = (us[0] + us[1]) / 2;
    const right = (us[2] + us[3]) / 2;
    const top = (vs[0] + vs[1]) / 2;
    const bottom = (vs[2] + vs[3]) / 2;
    let width = right - left;
    let height = bottom - top;
    if (width <= 0 || height <= 0) {
        return null;
    }

    const scale = (width + height) / 2;
    const distances = samples.map((sample) => distanceToBoxOutline(rotate(sample, -angle), left, top, right, bottom));
    if (Math.max(...distances) > MAX_PEAK_FIT_ERROR * scale) {
        return null;
    }

    if (Math.abs(width - height) <= SQUARE_SNAP_RATIO * Math.max(width, height)) {
        width = height = (width + height) / 2;
    }
    const [ centerX, centerY ] = rotate([ (left + right) / 2, (top + bottom) / 2 ], angle);
    const shape: RecognizedShape = {
        type: "rectangle",
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
        angle: normalizeAngle(Math.abs(angle) <= RECTANGLE_ANGLE_SNAP ? 0 : angle)
    };
    return { shape, error: mean(distances) / scale };
}

function fitEllipse(samples: Point[]) {
    const { angle: axisAngle } = principalAxis(samples);
    // Turning the frame so that the angle is within an eighth turn of the axes swaps the sides.
    const angle = axisAngle - Math.round(axisAngle / (Math.PI / 2)) * (Math.PI / 2);
    const rotated = samples.map((sample) => rotate(sample, -angle));
    const box = bounds(rotated);
    let radiusX = box.width / 2;
    let radiusY = box.height / 2;
    if (radiusX <= 0 || radiusY <= 0) {
        return null;
    }
    const centerU = box.minX + radiusX;
    const centerV = box.minY + radiusY;

    let errorSum = 0;
    for (const [ u, v ] of rotated) {
        const du = u - centerU;
        const dv = v - centerV;
        const radius = Math.hypot(du / radiusX, dv / radiusY);
        if (radius === 0 || Math.abs(radius - 1) > ELLIPSE_MAX_RADIAL_ERROR) {
            return null;
        }
        errorSum += Math.abs(radius - 1) * Math.hypot(du, dv) / radius;
    }

    const scale = radiusX + radiusY;
    if (Math.min(radiusX, radiusY) >= CIRCLE_SNAP_RATIO * Math.max(radiusX, radiusY)) {
        radiusX = radiusY = (radiusX + radiusY) / 2;
    }
    const isAxisAligned = radiusX === radiusY || Math.abs(angle) <= ELLIPSE_ANGLE_SNAP;
    const [ centerX, centerY ] = rotate([ centerU, centerV ], angle);
    const shape: RecognizedShape = {
        type: "ellipse",
        x: centerX - radiusX,
        y: centerY - radiusY,
        width: 2 * radiusX,
        height: 2 * radiusY,
        angle: normalizeAngle(isAxisAligned ? 0 : angle)
    };
    return { shape, error: errorSum / samples.length / scale };
}

function fitTriangle(corners: Point[], samples: Point[]) {
    const [ a, b, c ] = corners;
    const scale = (distance(a, b) + distance(b, c) + distance(c, a)) / 3;
    const distances = samples.map((sample) => Math.min(
        distanceToSegment(sample, a, b), distanceToSegment(sample, b, c), distanceToSegment(sample, c, a)
    ));
    const shape: RecognizedShape = { type: "triangle", points: [ a, b, c ] };
    const error = Math.max(...distances) > MAX_PEAK_FIT_ERROR * scale ? Infinity : mean(distances) / scale;
    return { shape, error };
}

/** Cuts the part of a closed stroke that runs past its own start, at either end. */
function trimOvershoot(path: Point[]): Point[] {
    const length = pathLength(path);
    const cumulative = cumulativeLengths(path);

    let end = path.length - 1;
    let bestEnd = distance(path[0], path[end]);
    for (let index = path.length - 1; index > 0 && cumulative[index] >= (1 - MAX_OVERSHOOT_RATIO) * length; index--) {
        const gap = distance(path[0], path[index]);
        if (gap < bestEnd) {
            bestEnd = gap;
            end = index;
        }
    }

    let start = 0;
    let bestStart = distance(path[0], path[end]);
    for (let index = 1; index < end && cumulative[index] <= MAX_OVERSHOOT_RATIO * length; index++) {
        const gap = distance(path[index], path[end]);
        if (gap < bestStart) {
            bestStart = gap;
            start = index;
        }
    }
    return path.slice(start, end + 1);
}

/** Removes corners that turn less than `CORNER_MIN_TURN`, shallowest first. */
function mergeShallowCorners(polygon: Point[]): Point[] {
    const result = [ ...polygon ];
    while (result.length > 3) {
        const turns = turningAngles(result);
        let shallowest = 0;
        for (const [ index, turn ] of turns.entries()) {
            if (Math.abs(turn) < Math.abs(turns[shallowest])) {
                shallowest = index;
            }
        }
        if (Math.abs(turns[shallowest]) >= CORNER_MIN_TURN) {
            break;
        }
        result.splice(shallowest, 1);
    }
    return result;
}

/** The signed turn at each vertex of a closed polygon, positive clockwise on screen. */
function turningAngles(polygon: Point[]): number[] {
    const turns: number[] = [];
    for (const [ index, point ] of polygon.entries()) {
        const previous = polygon[(index + polygon.length - 1) % polygon.length];
        const next = polygon[(index + 1) % polygon.length];
        const incoming = subtract(point, previous);
        const outgoing = subtract(next, point);
        turns.push(Math.atan2(cross(incoming, outgoing), dot(incoming, outgoing)));
    }
    return turns;
}

/** Simplifies a closed path into a polygon without the closing vertex. */
function simplifyClosed(path: Point[], epsilon: number): Point[] {
    const first = path[0];
    let farthest = 0;
    for (const [ index, point ] of path.entries()) {
        if (distance(first, point) > distance(first, path[farthest])) {
            farthest = index;
        }
    }
    const firstHalf = simplify(path.slice(0, farthest + 1), epsilon);
    const secondHalf = simplify([ ...path.slice(farthest), first ], epsilon);
    return removeDuplicates([ ...firstHalf, ...secondHalf.slice(1, -1) ]);
}

/** Ramer–Douglas–Peucker simplification of an open path. */
function simplify(path: readonly Point[], epsilon: number): Point[] {
    if (path.length < 3) {
        return [ ...path ];
    }
    const keep = new Array<boolean>(path.length).fill(false);
    keep[0] = keep[path.length - 1] = true;
    const ranges: [number, number][] = [ [ 0, path.length - 1 ] ];
    let range = ranges.pop();
    while (range) {
        const [ from, to ] = range;
        let farthest = -1;
        let farthestDistance = epsilon;
        for (let index = from + 1; index < to; index++) {
            const gap = distanceToSegment(path[index], path[from], path[to]);
            if (gap > farthestDistance) {
                farthest = index;
                farthestDistance = gap;
            }
        }
        if (farthest >= 0) {
            keep[farthest] = true;
            ranges.push([ from, farthest ], [ farthest, to ]);
        }
        range = ranges.pop();
    }
    return path.filter((_, index) => keep[index]);
}

/** Takes `count` points evenly spaced along a closed path, including the closing segment. */
function resampleClosed(path: Point[], count: number): Point[] {
    const ring = [ ...path, path[0] ];
    const cumulative = cumulativeLengths(ring);
    const total = cumulative[cumulative.length - 1];
    const samples: Point[] = [];
    let segment = 0;
    for (let index = 0; index < count; index++) {
        const target = (index / count) * total;
        while (segment < ring.length - 2 && cumulative[segment + 1] < target) {
            segment++;
        }
        const segmentLength = cumulative[segment + 1] - cumulative[segment];
        const t = segmentLength > 0 ? (target - cumulative[segment]) / segmentLength : 0;
        const [ ax, ay ] = ring[segment];
        const [ bx, by ] = ring[segment + 1];
        samples.push([ ax + (bx - ax) * t, ay + (by - ay) * t ]);
    }
    return samples;
}

/** The centroid of the points and the angle of the axis along which they spread most. */
function principalAxis(points: readonly Point[]) {
    const center: Point = [ mean(points.map(([ x ]) => x)), mean(points.map(([ , y ]) => y)) ];
    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (const [ x, y ] of points) {
        const dx = x - center[0];
        const dy = y - center[1];
        xx += dx * dx;
        yy += dy * dy;
        xy += dx * dy;
    }
    return { center, angle: Math.atan2(2 * xy, xx - yy) / 2 };
}

function distanceToBoxOutline([ u, v ]: Point, left: number, top: number, right: number, bottom: number) {
    const outsideX = Math.max(left - u, 0, u - right);
    const outsideY = Math.max(top - v, 0, v - bottom);
    if (outsideX > 0 || outsideY > 0) {
        return Math.hypot(outsideX, outsideY);
    }
    return Math.min(u - left, right - u, v - top, bottom - v);
}

function distanceToSegment(point: Point, a: Point, b: Point) {
    const segment = subtract(b, a);
    const lengthSquared = dot(segment, segment);
    const t = lengthSquared > 0 ? Math.min(1, Math.max(0, dot(subtract(point, a), segment) / lengthSquared)) : 0;
    return distance(point, [ a[0] + segment[0] * t, a[1] + segment[1] * t ]);
}

function removeDuplicates(points: readonly Point[]): Point[] {
    const result: Point[] = [];
    for (const point of points) {
        const previous = result[result.length - 1];
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
            result.push(point);
        }
    }
    return result;
}

function cumulativeLengths(path: readonly Point[]) {
    const lengths = [ 0 ];
    for (let index = 1; index < path.length; index++) {
        lengths.push(lengths[index - 1] + distance(path[index - 1], path[index]));
    }
    return lengths;
}

function pathLength(path: readonly Point[]) {
    return cumulativeLengths(path)[path.length - 1] ?? 0;
}

function bounds(points: readonly Point[]) {
    const xs = points.map(([ x ]) => x);
    const ys = points.map(([ , y ]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

function rotate([ x, y ]: Point, angle: number): Point {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [ x * cos - y * sin, x * sin + y * cos ];
}

/** Brings an angle into `[0, 2π)`, the range Excalidraw stores. */
function normalizeAngle(angle: number) {
    const full = 2 * Math.PI;
    const normalized = ((angle % full) + full) % full;
    return normalized < 1e-9 || full - normalized < 1e-9 ? 0 : normalized;
}

function distance(a: Point, b: Point) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function subtract(a: Point, b: Point): Point {
    return [ a[0] - b[0], a[1] - b[1] ];
}

function dot(a: Point, b: Point) {
    return a[0] * b[0] + a[1] * b[1];
}

function cross(a: Point, b: Point) {
    return a[0] * b[1] - a[1] * b[0];
}

function sum(values: readonly number[]) {
    let total = 0;
    for (const value of values) {
        total += value;
    }
    return total;
}

function mean(values: readonly number[]) {
    return values.length ? sum(values) / values.length : 0;
}

function isBetween(value: number, min: number, max: number) {
    return value >= min && value <= max;
}

function degrees(value: number) {
    return value * Math.PI / 180;
}
