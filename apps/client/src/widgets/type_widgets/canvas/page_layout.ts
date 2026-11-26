import "./PageLayout.css";

import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
    AppState, ExcalidrawImperativeAPI, NormalizedZoomValue
} from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useCallback, useEffect } from "preact/hooks";

import type { DrawingView } from "./drawing_view";

/** The space between the page origin and the top and left edges of the page, in scene pixels. */
export const PAGE_PADDING = 16;

/** The scene x of the margin line of a ruled page, about an inch from its left edge at 100%. */
export const MARGIN_LINE_X = 64;

/**
 * Gives a canvas note the top and left edges of a page: the user cannot pan above or left of
 * them, and the editor shows the margin line of a ruled page and a faint top edge. Returns the
 * `constrainView` and the `onScrollChange` handler to pass to Excalidraw, `constrainView` being
 * `undefined` outside page mode.
 *
 * The margin line and the top edge are a layer of `rootRef` (`::before` in `PageLayout.css`). The
 * handler writes CSS custom properties directly, so a pan does not render the editor again.
 */
export default function usePageLayout(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    isPageMode: boolean
) {
    const update = useCallback((scrollX: number, scrollY: number, zoom: AppState["zoom"]) => {
        const root = rootRef.current;
        const api = apiRef.current;
        if (!root || !api || !isPageMode) return;

        const { marginX, top } = getPageLayout(api.getSceneElements(), scrollX, scrollY, zoom.value);
        root.style.setProperty("--canvas-margin-x", `${marginX}px`);
        root.style.setProperty("--canvas-page-top", `${top}px`);
    }, [ rootRef, apiRef, isPageMode ]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        if (!isPageMode) {
            delete root.dataset.pageLayout;
            return;
        }

        root.dataset.pageLayout = "";
        const api = apiRef.current;
        if (!api) return;

        // Moves a view left above or beside the page, as when page mode is turned on, onto it.
        const state = api.getAppState();
        const view = getPageView(api.getSceneElements(), state);
        if (view) {
            api.updateScene({ appState: view, captureUpdate: CaptureUpdateAction.NEVER });
        }
        const { scrollX, scrollY, zoom } = view ?? state;
        update(scrollX, scrollY, zoom);
    }, [ rootRef, apiRef, isPageMode, update ]);

    return {
        constrainView: isPageMode ? getPageView : undefined,
        onScrollChange: update
    };
}

/** The top and left edges of the page of a drawing, in scene pixels. */
export interface PageEdges {
    left: number;
    top: number;
}

const pageEdgesCache = new WeakMap<readonly ExcalidrawElement[], PageEdges>();

/**
 * The edges of the page that holds `elements`: {@link PAGE_PADDING} above and left of the scene
 * origin, or of the content where it reaches further, so that no shape is out of reach.
 * Excalidraw keeps the array of the scene until the scene changes, so the edges are kept by it.
 */
export function getPageEdges(elements: readonly ExcalidrawElement[]): PageEdges {
    const cached = pageEdgesCache.get(elements);
    if (cached) return cached;

    const shown = elements.filter((element) => !element.isDeleted);
    const [ minX, minY ] = shown.length ? getCommonBounds(shown) : [ 0, 0 ];
    const edges = {
        left: Math.min(minX, 0) - PAGE_PADDING,
        top: Math.min(minY, 0) - PAGE_PADDING
    };
    pageEdgesCache.set(elements, edges);
    return edges;
}

/**
 * The view that keeps the top-left corner of the editor on or below and right of the page edges,
 * at the same zoom, or `null` when `appState` is on the page already. Only the top and the left
 * edge bound the view.
 */
export function getPageView(
    elements: readonly ExcalidrawElement[],
    { zoom, scrollX, scrollY }: DrawingView
): DrawingView | null {
    const { left, top } = getPageEdges(elements);
    // Excalidraw shows the scene x `-scrollX` at the left edge of the editor.
    if (scrollX <= -left && scrollY <= -top) return null;

    return {
        zoom,
        scrollX: Math.min(scrollX, -left),
        scrollY: Math.min(scrollY, -top)
    };
}

/** The view that shows the top-left corner of the page of `elements` at `zoom`, or 100%. */
export function getPageStartView(
    elements: readonly ExcalidrawElement[],
    zoom: AppState["zoom"] = { value: 1 as NormalizedZoomValue }
): DrawingView {
    const { left, top } = getPageEdges(elements);
    return { zoom, scrollX: -left, scrollY: -top };
}

/**
 * The app state of a canvas note that opens in page mode from its saved `appState`: at the page
 * corner and the saved zoom, or, on a reload of the note that shows, at the view that shows.
 */
export function getOpenedAppState(
    appState: Partial<AppState>,
    elements: readonly ExcalidrawElement[],
    isReload: boolean
): Partial<AppState> {
    if (!isReload) return { ...appState, ...getPageStartView(elements, appState.zoom) };

    const kept = { ...appState };
    delete kept.scrollX;
    delete kept.scrollY;
    delete kept.zoom;
    return kept;
}

/**
 * Where the margin line and the top edge of the page fall on screen, in pixels from the left and
 * the top of the editor. Excalidraw shows a scene point at `(x + scrollX) * zoom`.
 */
export function getPageLayout(
    elements: readonly ExcalidrawElement[],
    scrollX: number,
    scrollY: number,
    zoom: number
) {
    const { top } = getPageEdges(elements);
    return {
        marginX: (MARGIN_LINE_X + scrollX) * zoom,
        top: (top + scrollY) * zoom
    };
}
