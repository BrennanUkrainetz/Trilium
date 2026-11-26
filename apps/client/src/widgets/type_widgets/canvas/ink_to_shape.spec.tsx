import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawFreeDrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useInkToShape, {
    HOLD_TO_SNAP_MS, type InkToShapeOptions, isSnappableStroke, type Point, recognizeShape,
    type RecognizedShape, shapeToSkeleton
} from "./ink_to_shape";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY" },
    convertToExcalidrawElements: (skeletons: object[]) => skeletons.map((skeleton) => ({ ...skeleton, id: "shape" })),
    newElementWith: (element: ExcalidrawElement, updates: object) => ({ ...element, ...updates })
}));

describe("recognizeShape", () => {
    it("snaps near-horizontal, near-vertical and near-diagonal lines to the axis", () => {
        const horizontal = expectShape(recognizeShape(lineStroke([ 10, 50 ], 3, 200, 1)), "line");
        expect(horizontal.start[1]).toBeCloseTo(horizontal.end[1], 6);
        expect(horizontal.start[0]).toBeLessThan(horizontal.end[0]);
        expect(Math.abs(horizontal.end[0] - horizontal.start[0])).toBeGreaterThan(190);

        const vertical = expectShape(recognizeShape(lineStroke([ 40, 300 ], -88, 150, 2)), "line");
        expect(vertical.start[0]).toBeCloseTo(vertical.end[0], 6);
        expect(vertical.start[1]).toBeGreaterThan(vertical.end[1]);

        const diagonal = expectShape(recognizeShape(lineStroke([ 0, 0 ], 49, 180, 3)), "line");
        expect(angleOf(diagonal)).toBeCloseTo(45, 6);
    });

    it("keeps the angle of a line far from the axes", () => {
        const line = expectShape(recognizeShape(lineStroke([ 0, 0 ], 20, 160, 4)), "line");
        expect(angleOf(line)).toBeGreaterThan(17);
        expect(angleOf(line)).toBeLessThan(23);
    });

    it("recognizes an axis-aligned rectangle that starts mid-edge and overshoots its start", () => {
        const stroke = jitter(polyline([
            [ 100, 0 ], [ 200, 3 ], [ 198, 100 ], [ 2, 98 ], [ 0, 2 ], [ 125, 0 ]
        ]), 1.5, 5);
        const rectangle = expectShape(recognizeShape(stroke), "rectangle");
        expect(rectangle.angle).toBe(0);
        expect(rectangle.width).toBeGreaterThan(190);
        expect(rectangle.width).toBeLessThan(205);
        expect(rectangle.height).toBeGreaterThan(92);
        expect(rectangle.height).toBeLessThan(105);
        expect(rectangle.x).toBeGreaterThan(-5);
        expect(rectangle.x).toBeLessThan(5);
    });

    it("snaps a rectangle with nearly equal sides to a square", () => {
        const stroke = jitter(polyline([ [ 0, 0 ], [ 120, 0 ], [ 120, 110 ], [ 0, 110 ], [ 0, 4 ] ]), 1.5, 6);
        const square = expectShape(recognizeShape(stroke), "rectangle");
        expect(square.width).toBe(square.height);
        expect(square.width).toBeGreaterThan(108);
        expect(square.width).toBeLessThan(122);
    });

    it("keeps the rotation of a rotated rectangle", () => {
        const corners = [ [ 0, 0 ], [ 160, 0 ], [ 160, 80 ], [ 0, 80 ], [ 0, 3 ] ] as Point[];
        const stroke = jitter(polyline(corners.map((corner) => rotateAround(corner, [ 80, 40 ], 30))), 1.5, 7);
        const rectangle = expectShape(recognizeShape(stroke), "rectangle");
        expect(rectangle.angle * 180 / Math.PI).toBeCloseTo(30, 0);
        expect(rectangle.width).toBeGreaterThan(150);
        expect(rectangle.height).toBeGreaterThan(72);
        expect(rectangle.x + rectangle.width / 2).toBeCloseTo(80, -1);
        expect(rectangle.y + rectangle.height / 2).toBeCloseTo(40, -1);
    });

    it("snaps a round loop to a circle and keeps an oval an ellipse", () => {
        const circle = expectShape(recognizeShape(ellipseStroke([ 100, 100 ], 60, 57, 0, 10, 355, 8)), "ellipse");
        expect(circle.width).toBe(circle.height);
        expect(circle.angle).toBe(0);
        expect(circle.x + circle.width / 2).toBeCloseTo(100, -1);
        expect(circle.width).toBeGreaterThan(110);
        expect(circle.width).toBeLessThan(126);

        const oval = expectShape(recognizeShape(ellipseStroke([ 0, 0 ], 90, 40, 4, -90, 365, 9)), "ellipse");
        expect(oval.angle).toBe(0);
        expect(oval.width).toBeGreaterThan(170);
        expect(oval.height).toBeGreaterThan(72);
        expect(oval.height).toBeLessThan(90);

        const tilted = expectShape(recognizeShape(ellipseStroke([ 0, 0 ], 90, 40, 35, 0, 360, 10)), "ellipse");
        expect(tilted.angle * 180 / Math.PI).toBeCloseTo(35, -1);
    });

    it("recognizes a triangle", () => {
        const stroke = jitter(polyline([ [ 0, 120 ], [ 70, 0 ], [ 140, 120 ], [ 3, 118 ] ]), 1.5, 11);
        const triangle = expectShape(recognizeShape(stroke), "triangle");
        const xs = triangle.points.map(([ x ]) => x).sort((a, b) => a - b);
        expect(xs[0]).toBeLessThan(8);
        expect(xs[1]).toBeCloseTo(70, -1);
        expect(xs[2]).toBeGreaterThan(132);
    });

    it("leaves short strokes, taps and small letters alone", () => {
        expect(recognizeShape([ [ 0, 0 ] ])).toBeNull();
        expect(recognizeShape([ [ 0, 0 ], [ 0, 0 ], [ 0.5, 0.5 ] ])).toBeNull();
        expect(recognizeShape(lineStroke([ 0, 0 ], 90, 30, 12))).toBeNull();
        expect(recognizeShape(ellipseStroke([ 0, 0 ], 9, 9, 0, 0, 360, 13))).toBeNull();
        expect(expectShape(recognizeShape(lineStroke([ 0, 0 ], 90, 30, 12), { minLineLength: 16 }), "line")).toBeTruthy();
    });

    it("leaves handwriting and scribbles alone, at any size", () => {
        for (const scale of [ 1, 3 ]) {
            for (const [ name, letter ] of Object.entries(HANDWRITING)) {
                const stroke = jitter(letter.map(([ x, y ]) => [ x * 40 * scale, y * 40 * scale ] as const), 1, name.length * 17 + scale);
                expect(recognizeShape(stroke), `${name} at ${scale}x`).toBeNull();
            }
        }
    });

    it("leaves a stroke drawn back over itself, a double loop and a D shape alone", () => {
        expect(recognizeShape(jitter(polyline([ [ 0, 0 ], [ 200, 0 ], [ 5, 2 ] ]), 1, 14))).toBeNull();
        expect(recognizeShape(jitter(polyline([ [ 0, 0 ], [ 200, 0 ], [ 100, 1 ] ]), 1, 17))).toBeNull();
        expect(recognizeShape(ellipseStroke([ 0, 0 ], 60, 60, 0, 0, 720, 15))).toBeNull();
        const d = [ ...polyline([ [ 0, 100 ], [ 0, 0 ], [ 30, 0 ] ]), ...arc([ 30, 50 ], 50, 50, -90, 180) ];
        expect(recognizeShape(jitter(d, 1, 16))).toBeNull();
    });
});

describe("shapeToSkeleton", () => {
    it("styles the shape as the stroke and makes triangles closed lines", () => {
        const source = freedraw({
            strokeColor: "#e03131", strokeWidth: 2, groupIds: [ "g" ], frameId: "f", customData: { "trilium-ink-group": "g" }
        });
        expect(shapeToSkeleton({ type: "ellipse", x: 1, y: 2, width: 30, height: 40, angle: 0.5 }, source)).toMatchObject({
            type: "ellipse", x: 1, y: 2, width: 30, height: 40, angle: 0.5,
            strokeColor: "#e03131", strokeWidth: 6, opacity: 100, roughness: 0,
            backgroundColor: "transparent", groupIds: [ "g" ], frameId: "f", customData: { "trilium-ink-group": "g" }
        });
        expect(shapeToSkeleton({ type: "triangle", points: [ [ 10, 20 ], [ 30, 0 ], [ 50, 20 ] ] }, source)).toMatchObject({
            type: "line", x: 10, y: 20, points: [ [ 0, 0 ], [ 20, -20 ], [ 40, 0 ], [ 0, 0 ] ]
        });
    });

    it("tells ink from highlighter strokes", () => {
        expect(isSnappableStroke(freedraw({}))).toBe(true);
        expect(isSnappableStroke(freedraw({ opacity: 40 }))).toBe(false);
        expect(isSnappableStroke(freedraw({ strokeWidth: 16 }))).toBe(false);
    });
});

describe("useInkToShape", () => {
    let container: HTMLElement;
    let state: AppState;
    let elements: ExcalidrawElement[];
    let updateScene: ReturnType<typeof vi.fn>;
    let apiRef: { current: ExcalidrawImperativeAPI | null };
    let syntheticUps: PointerEvent[];
    let strokeElement: ExcalidrawFreeDrawElement;

    const SQUARE = polyline([ [ 0, 0 ], [ 100, 0 ], [ 100, 100 ], [ 0, 100 ], [ 0, 2 ] ]);

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame" ] });
        state = { activeTool: { type: "freedraw" }, newElement: null, zoom: { value: 1 } } as unknown as AppState;
        elements = [];
        updateScene = vi.fn();
        apiRef = {
            current: {
                getAppState: () => state,
                getSceneElementsIncludingDeleted: () => elements,
                updateScene
            } as unknown as ExcalidrawImperativeAPI
        };
        syntheticUps = [];
        window.addEventListener("pointerup", recordSyntheticUp);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
        window.removeEventListener("pointerup", recordSyntheticUp);
        vi.useRealTimers();
    });

    /** Stands in for Excalidraw, which ends the stroke on a `pointerup` on `window`. */
    function recordSyntheticUp(e: PointerEvent) {
        syntheticUps.push(e);
        finalize();
    }

    function finalize() {
        if (state.newElement) {
            elements = [ ...elements, state.newElement ];
            state = { ...state, newElement: null };
        }
    }

    function Harness(options: InkToShapeOptions) {
        const rootRef = useRef<HTMLDivElement>(null);
        useInkToShape(rootRef, apiRef, options);
        return <div ref={rootRef}><canvas className="target" /></div>;
    }

    function mount(options: InkToShapeOptions) {
        act(() => {
            render(<Harness {...options} />, container);
        });
        const target = container.querySelector("canvas");
        if (!target) {
            throw new Error("No canvas");
        }
        return target;
    }

    /** Presses the pen, lets "Excalidraw" start a freedraw element with `points`, and moves along them. */
    function drawStroke(target: Element, points: Point[], overrides: Partial<ExcalidrawFreeDrawElement> = {}) {
        target.dispatchEvent(pointer("pointerdown", points[0]));
        strokeElement = freedraw({ points: points as ExcalidrawFreeDrawElement["points"], ...overrides });
        state = { ...state, newElement: strokeElement };
        for (const point of points.filter((_, index) => index % 10 === 0)) {
            target.dispatchEvent(pointer("pointermove", point));
        }
        target.dispatchEvent(pointer("pointermove", points[points.length - 1]));
    }

    function snappedElements() {
        const [ scene ] = updateScene.mock.calls.at(-1) ?? [];
        return scene;
    }

    it("ends and snaps a stroke when the pen rests, and keeps the pen's moves from Excalidraw", () => {
        const target = mount({ enabled: true, autoSnap: false });
        drawStroke(target, SQUARE);

        vi.advanceTimersByTime(HOLD_TO_SNAP_MS - 1);
        expect(syntheticUps).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(syntheticUps).toHaveLength(1);
        expect(syntheticUps[0]).toMatchObject({ pointerId: 1, clientX: 0, clientY: 2 });

        vi.runOnlyPendingTimers();
        expect(updateScene).toHaveBeenCalledTimes(1);
        const scene = snappedElements();
        expect(scene.captureUpdate).toBe(CaptureUpdateAction.IMMEDIATELY);
        expect(scene.elements).toHaveLength(2);
        expect(scene.elements[0]).toMatchObject({ id: strokeElement.id, isDeleted: true });
        expect(scene.elements[1]).toMatchObject({ type: "rectangle", angle: 0, strokeColor: "#1e1e1e", strokeWidth: 3 });
        expect(scene.elements[1].width).toBeCloseTo(100, 6);
        expect(scene.elements[1].height).toBeCloseTo(100, 6);

        const onMove = vi.fn();
        target.addEventListener("pointermove", onMove);
        target.dispatchEvent(pointer("pointermove", [ 50, 50 ]));
        expect(onMove).not.toHaveBeenCalled();
        window.dispatchEvent(pointer("pointerup", [ 50, 50 ]));
        target.dispatchEvent(pointer("pointermove", [ 60, 60 ]));
        expect(onMove).toHaveBeenCalledTimes(1);
        expect(updateScene).toHaveBeenCalledTimes(1);
    });

    it("restarts the rest when the pen moves past a few pixels, but not when it drifts", () => {
        const target = mount({ enabled: true, autoSnap: false });
        drawStroke(target, SQUARE);
        vi.advanceTimersByTime(HOLD_TO_SNAP_MS - 100);
        target.dispatchEvent(pointer("pointermove", [ 2, 4 ]));
        vi.advanceTimersByTime(100);
        expect(syntheticUps).toHaveLength(1);
        window.dispatchEvent(pointer("pointerup", [ 2, 4 ]));

        drawStroke(target, SQUARE);
        vi.advanceTimersByTime(HOLD_TO_SNAP_MS - 100);
        target.dispatchEvent(pointer("pointermove", [ 0, 10 ]));
        vi.advanceTimersByTime(HOLD_TO_SNAP_MS - 1);
        expect(syntheticUps).toHaveLength(2);
        vi.advanceTimersByTime(1);
        expect(syntheticUps).toHaveLength(3);
    });

    it("does not end handwriting, highlighter strokes or strokes of other tools on a rest", () => {
        const target = mount({ enabled: true, autoSnap: false });
        drawStroke(target, HANDWRITING.s.map(([ x, y ]) => [ x * 100, y * 100 ] as const));
        vi.advanceTimersByTime(HOLD_TO_SNAP_MS);
        window.dispatchEvent(pointer("pointerup", [ 0, 0 ]));

        drawStroke(target, SQUARE, { opacity: 40 });
        vi.advanceTimersByTime(HOLD_TO_SNAP_MS);
        window.dispatchEvent(pointer("pointerup", [ 0, 0 ]));

        state = { ...state, activeTool: { type: "selection" } as AppState["activeTool"] };
        drawStroke(target, SQUARE);
        vi.advanceTimersByTime(HOLD_TO_SNAP_MS);

        // Only the two pointerups the test dispatched reached Excalidraw.
        expect(syntheticUps).toHaveLength(2);
        vi.runOnlyPendingTimers();
        expect(updateScene).not.toHaveBeenCalled();
    });

    it("snaps every finished stroke that reads as a shape only with auto snap", () => {
        const target = mount({ enabled: true, autoSnap: false });
        drawStroke(target, SQUARE);
        window.dispatchEvent(pointer("pointerup", [ 0, 2 ]));
        vi.runOnlyPendingTimers();
        expect(updateScene).not.toHaveBeenCalled();

        act(() => {
            render(<Harness enabled autoSnap />, container);
        });
        drawStroke(target, SQUARE);
        window.dispatchEvent(pointer("pointerup", [ 0, 2 ]));
        vi.runOnlyPendingTimers();
        expect(updateScene).toHaveBeenCalledTimes(1);
        expect(snappedElements().elements.at(-1)).toMatchObject({ type: "rectangle" });

        drawStroke(target, HANDWRITING.m.map(([ x, y ]) => [ x * 100, y * 100 ] as const));
        window.dispatchEvent(pointer("pointerup", [ 0, 0 ]));
        vi.runOnlyPendingTimers();
        expect(updateScene).toHaveBeenCalledTimes(1);
    });

    it("does nothing when disabled", () => {
        const target = mount({ enabled: false, autoSnap: true });
        drawStroke(target, SQUARE);
        vi.advanceTimersByTime(HOLD_TO_SNAP_MS);
        window.dispatchEvent(pointer("pointerup", [ 0, 2 ]));
        vi.runOnlyPendingTimers();
        expect(syntheticUps).toHaveLength(1);
        expect(updateScene).not.toHaveBeenCalled();
    });
});

/** Letters and scribbles in a unit box, drawn as one stroke each. */
const HANDWRITING: Record<string, Point[]> = {
    s: [ ...arc([ 0.5, 0.25 ], 0.4, 0.25, -20, -250), ...arc([ 0.5, 0.75 ], 0.4, 0.25, -90, 250) ],
    e: [ ...polyline([ [ 0, 0.5 ], [ 1, 0.5 ] ]), ...arc([ 0.5, 0.5 ], 0.5, 0.5, 0, -320) ],
    a: [ ...arc([ 0.5, 0.5 ], 0.45, 0.45, -30, -360), ...polyline([ [ 0.9, 0.27 ], [ 0.95, 1.1 ] ]) ],
    c: arc([ 0.5, 0.5 ], 0.5, 0.5, -45, -270),
    u: [ ...polyline([ [ 0, 0 ], [ 0, 0.6 ] ]), ...arc([ 0.5, 0.6 ], 0.5, 0.4, 180, -180), ...polyline([ [ 1, 0.6 ], [ 1, 0 ] ]) ],
    m: polyline([ [ 0, 1 ], [ 0, 0.2 ], [ 0.3, 0 ], [ 0.5, 0.2 ], [ 0.5, 1 ], [ 0.5, 0.2 ], [ 0.7, 0 ], [ 1, 0.2 ], [ 1, 1 ] ]),
    z: polyline([ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ] ]),
    w: polyline([ [ 0, 0 ], [ 0.25, 1 ], [ 0.5, 0.3 ], [ 0.75, 1 ], [ 1, 0 ] ]),
    eight: [ ...arc([ 0.5, 0.25 ], 0.25, 0.25, 90, 360), ...arc([ 0.5, 0.75 ], 0.25, 0.25, -90, -360) ],
    spiral: Array.from({ length: 120 }, (_, index) => {
        const t = index / 119;
        return [ 0.5 + 0.5 * t * Math.cos(t * 4 * Math.PI), 0.5 + 0.5 * t * Math.sin(t * 4 * Math.PI) ] as const;
    }),
    shading: polyline([ [ 0, 0 ], [ 1, 0.1 ], [ 0, 0.2 ], [ 1, 0.3 ], [ 0, 0.4 ], [ 1, 0.5 ], [ 0, 0.6 ] ]),
    cursive: Array.from({ length: 160 }, (_, index) => {
        const t = index / 159;
        return [ 2 * t + 0.15 * Math.sin(t * 6 * 2 * Math.PI), 0.5 - 0.4 * Math.cos(t * 6 * 2 * Math.PI) ] as const;
    })
};

function expectShape<T extends RecognizedShape["type"]>(shape: RecognizedShape | null, type: T) {
    expect(shape?.type).toBe(type);
    return shape as Extract<RecognizedShape, { type: T }>;
}

function angleOf({ start, end }: { start: Point; end: Point }) {
    return Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
}

/** Points about two pixels apart along straight segments through `vertices`. */
function polyline(vertices: Point[], spacing = 2): Point[] {
    const points: Point[] = [ vertices[0] ];
    for (let index = 1; index < vertices.length; index++) {
        const [ ax, ay ] = vertices[index - 1];
        const [ bx, by ] = vertices[index];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
        for (let step = 1; step <= steps; step++) {
            points.push([ ax + (bx - ax) * step / steps, ay + (by - ay) * step / steps ]);
        }
    }
    return points;
}

/** Points along an elliptical arc from `startDegrees`, sweeping `sweepDegrees` (negative is counterclockwise). */
function arc(center: Point, radiusX: number, radiusY: number, startDegrees: number, sweepDegrees: number, count = 60): Point[] {
    return Array.from({ length: count + 1 }, (_, index) => {
        const angle = (startDegrees + sweepDegrees * index / count) * Math.PI / 180;
        return [ center[0] + radiusX * Math.cos(angle), center[1] + radiusY * Math.sin(angle) ] as const;
    });
}

function lineStroke(start: Point, angleDegrees: number, length: number, seed: number) {
    const angle = angleDegrees * Math.PI / 180;
    return jitter(polyline([ start, [ start[0] + length * Math.cos(angle), start[1] + length * Math.sin(angle) ] ]), 1.5, seed);
}

/** A hand-drawn ellipse: wobbling radius, rotated by `rotationDegrees`, jittered. */
function ellipseStroke(center: Point, radiusX: number, radiusY: number, rotationDegrees: number, startDegrees: number, sweepDegrees: number, seed: number) {
    const count = Math.max(40, Math.ceil(Math.abs(sweepDegrees) / 3));
    const points = arc([ 0, 0 ], radiusX, radiusY, startDegrees, sweepDegrees, count).map(([ x, y ], index) => {
        const wobble = 1 + 0.03 * Math.sin(index / count * 5 * Math.PI);
        return rotateAround([ center[0] + x * wobble, center[1] + y * wobble ], center, rotationDegrees);
    });
    return jitter(points, 1.5, seed);
}

function rotateAround([ x, y ]: Point, [ cx, cy ]: Point, degrees: number): Point {
    const angle = degrees * Math.PI / 180;
    const dx = x - cx;
    const dy = y - cy;
    return [ cx + dx * Math.cos(angle) - dy * Math.sin(angle), cy + dx * Math.sin(angle) + dy * Math.cos(angle) ];
}

/** Moves every point by up to `amount` in each direction, reproducibly for a `seed`. */
function jitter(points: readonly Point[], amount: number, seed: number): Point[] {
    let value = seed * 2654435761 % 4294967296;
    const random = () => {
        value = (value * 1664525 + 1013904223) % 4294967296;
        return value / 4294967296;
    };
    return points.map(([ x, y ]) => [ x + (random() * 2 - 1) * amount, y + (random() * 2 - 1) * amount ] as const);
}

function pointer(type: string, [ clientX, clientY ]: Point) {
    return new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: "touch", button: 0, clientX, clientY, pressure: 0.5 });
}

function freedraw(overrides: Partial<ExcalidrawFreeDrawElement>): ExcalidrawFreeDrawElement {
    return {
        id: `stroke-${Math.random()}`,
        type: "freedraw",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        angle: 0,
        points: [],
        pressures: [],
        simulatePressure: true,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        locked: false,
        isDeleted: false,
        ...overrides
    } as unknown as ExcalidrawFreeDrawElement;
}
