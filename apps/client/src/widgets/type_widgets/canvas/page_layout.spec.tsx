import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import usePageLayout, {
    getOpenedAppState, getPageEdges, getPageLayout, getPageStartView, getPageView,
    MARGIN_LINE_X, PAGE_PADDING
} from "./page_layout";

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { NEVER: "NEVER" },
    getCommonBounds: (elements: { x: number; y: number; width: number; height: number }[]) => [
        Math.min(...elements.map(({ x }) => x)),
        Math.min(...elements.map(({ y }) => y)),
        Math.max(...elements.map(({ x, width }) => x + width)),
        Math.max(...elements.map(({ y, height }) => y + height))
    ]
}));

type Zoom = AppState["zoom"];

function zoomOf(value: number) {
    return { value } as Zoom;
}

function box(x: number, y: number, isDeleted = false) {
    return { id: `${x}:${y}`, type: "rectangle", x, y, width: 10, height: 10, angle: 0, isDeleted } as
        unknown as ExcalidrawElement;
}

describe("getPageEdges", () => {
    it("puts the edges a padding above and left of the origin, or of content beyond it", () => {
        expect(getPageEdges([])).toEqual({ left: -PAGE_PADDING, top: -PAGE_PADDING });
        expect(getPageEdges([ box(100, 200) ])).toEqual({ left: -PAGE_PADDING, top: -PAGE_PADDING });
        expect(getPageEdges([ box(-40, 50), box(30, -30) ]))
            .toEqual({ left: -40 - PAGE_PADDING, top: -30 - PAGE_PADDING });
        // A deleted shape does not move the page.
        expect(getPageEdges([ box(-400, -400, true) ])).toEqual({ left: -PAGE_PADDING, top: -PAGE_PADDING });
    });
});

describe("getPageView", () => {
    it("bounds the view at the top and the left edge only, at any zoom", () => {
        const elements: ExcalidrawElement[] = [];
        const zoom = zoomOf(2);
        // Down and right of the page corner the view is free.
        expect(getPageView(elements, { zoom, scrollX: -3000, scrollY: -5000 })).toBeNull();
        expect(getPageView(elements, { zoom, scrollX: PAGE_PADDING, scrollY: PAGE_PADDING })).toBeNull();
        expect(getPageView(elements, { zoom, scrollX: 200, scrollY: -50 }))
            .toEqual({ zoom, scrollX: PAGE_PADDING, scrollY: -50 });
        expect(getPageView(elements, { zoom, scrollX: -50, scrollY: 200 }))
            .toEqual({ zoom, scrollX: -50, scrollY: PAGE_PADDING });
        expect(getPageView([ box(-100, -100) ], { zoom, scrollX: 500, scrollY: 500 }))
            .toEqual({ zoom, scrollX: 100 + PAGE_PADDING, scrollY: 100 + PAGE_PADDING });
    });
});

describe("getPageStartView", () => {
    it("shows the page corner at the zoom given, or 100%", () => {
        expect(getPageStartView([])).toEqual({ zoom: zoomOf(1), scrollX: PAGE_PADDING, scrollY: PAGE_PADDING });
        expect(getPageStartView([ box(-20, 0) ], zoomOf(1.5)))
            .toEqual({ zoom: zoomOf(1.5), scrollX: 20 + PAGE_PADDING, scrollY: PAGE_PADDING });
    });
});

describe("getOpenedAppState", () => {
    it("opens a note at its page corner, and keeps the view shown on a reload", () => {
        const saved = { scrollX: -500, scrollY: -900, zoom: zoomOf(2), viewBackgroundColor: "#fff" };
        expect(getOpenedAppState(saved, [ box(-20, 0) ], false)).toEqual({
            scrollX: 20 + PAGE_PADDING, scrollY: PAGE_PADDING, zoom: zoomOf(2), viewBackgroundColor: "#fff"
        });
        expect(getOpenedAppState({ viewBackgroundColor: "#fff" }, [], false))
            .toMatchObject({ zoom: zoomOf(1), scrollX: PAGE_PADDING });
        expect(getOpenedAppState(saved, [], true)).toEqual({ viewBackgroundColor: "#fff" });
    });
});

describe("getPageLayout", () => {
    it("places the margin line and the top edge on screen by the scroll and zoom", () => {
        expect(getPageLayout([], PAGE_PADDING, PAGE_PADDING, 1))
            .toEqual({ marginX: MARGIN_LINE_X + PAGE_PADDING, top: 0 });
        expect(getPageLayout([], -100, -300, 2))
            .toEqual({ marginX: (MARGIN_LINE_X - 100) * 2, top: (-PAGE_PADDING - 300) * 2 });
    });
});

describe("usePageLayout", () => {
    let container: HTMLElement;
    let layout: ReturnType<typeof usePageLayout> | null;
    let appState: Pick<AppState, "scrollX" | "scrollY" | "zoom">;
    const updateScene = vi.fn();
    const apiRef = {
        current: {
            getAppState: () => appState,
            getSceneElements: () => [],
            updateScene
        } as unknown as ExcalidrawImperativeAPI
    };

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        layout = null;
        updateScene.mockClear();
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
    });

    function Harness({ isPageMode }: { isPageMode: boolean }) {
        const rootRef = useRef<HTMLDivElement>(null);
        layout = usePageLayout(rootRef, apiRef, isPageMode);
        return <div ref={rootRef} className="canvas-render" />;
    }

    function root() {
        const element = container.querySelector<HTMLElement>(".canvas-render");
        if (!element) throw new Error("No root");
        return element;
    }

    it("marks the page, moves a view above it onto it, and follows the scroll", () => {
        appState = { scrollX: 0, scrollY: 300, zoom: zoomOf(1) };
        act(() => render(<Harness isPageMode />, container));

        expect(root().dataset.pageLayout).toBe("");
        expect(layout?.constrainView).toBe(getPageView);
        expect(updateScene).toHaveBeenCalledExactlyOnceWith({
            appState: { zoom: zoomOf(1), scrollX: 0, scrollY: PAGE_PADDING }, captureUpdate: "NEVER"
        });
        expect(root().style.getPropertyValue("--canvas-margin-x")).toBe(`${MARGIN_LINE_X}px`);
        expect(root().style.getPropertyValue("--canvas-page-top")).toBe("0px");

        act(() => layout?.onScrollChange(-10, -100, zoomOf(2)));
        expect(root().style.getPropertyValue("--canvas-margin-x")).toBe(`${(MARGIN_LINE_X - 10) * 2}px`);
        expect(root().style.getPropertyValue("--canvas-page-top")).toBe(`${(-PAGE_PADDING - 100) * 2}px`);
    });

    it("leaves the view and the page alone outside page mode", () => {
        appState = { scrollX: 0, scrollY: 300, zoom: zoomOf(1) };
        act(() => render(<Harness isPageMode />, container));
        act(() => render(<Harness isPageMode={false} />, container));
        updateScene.mockClear();

        expect(root().dataset.pageLayout).toBeUndefined();
        expect(layout?.constrainView).toBeUndefined();
        act(() => layout?.onScrollChange(-10, -100, zoomOf(2)));
        expect(root().style.getPropertyValue("--canvas-margin-x")).toBe(`${MARGIN_LINE_X}px`);
        expect(updateScene).not.toHaveBeenCalled();
    });
});
