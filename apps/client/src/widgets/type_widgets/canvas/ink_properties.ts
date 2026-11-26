import "./InkProperties.css";

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

/** The tools whose next shape takes the background and the fill of the panel. */
const FILLED_TOOLS = new Set([ "rectangle", "diamond", "ellipse", "line", "iframe", "embeddable" ]);

type InkState = Pick<AppState, "activeTool" | "selectedElementIds">;

/**
 * Marks the `.canvas-render` root with `data-ink-selection` while the properties panel applies to
 * pen strokes only, on which `InkProperties.css` hides the background, the fill and the alignment.
 * Excalidraw's `hasBackground()` counts `freedraw` in, though an open stroke draws no fill.
 */
export default function useInkProperties(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>
) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        let subscribedApi: ExcalidrawImperativeAPI | null = null;
        let unsubscribe: (() => void) | null = null;
        let lastSelection: AppState["selectedElementIds"] | null = null;
        let lastTool: string | null = null;

        function sync(elements: readonly ExcalidrawElement[], state: AppState) {
            if (!root) return;
            // An element keeps its type, so the answer changes only with the selection or the tool.
            if (state.selectedElementIds === lastSelection && state.activeTool.type === lastTool) return;
            lastSelection = state.selectedElementIds;
            lastTool = state.activeTool.type;

            if (isInkSelection(state, elements)) {
                root.dataset.inkSelection = "";
            } else {
                delete root.dataset.inkSelection;
            }
        }

        /** Follows the app state of the editor, which mounts after this effect runs. */
        function subscribe() {
            const api = apiRef.current;
            if (!api || api === subscribedApi) return;

            unsubscribe?.();
            subscribedApi = api;
            lastSelection = null;
            unsubscribe = api.onChange(sync);
            sync(api.getSceneElementsIncludingDeleted(), api.getAppState());
        }

        subscribe();
        root.addEventListener("pointerover", subscribe, { capture: true });
        return () => {
            unsubscribe?.();
            delete root.dataset.inkSelection;
            root.removeEventListener("pointerover", subscribe, { capture: true });
        };
    }, [ rootRef, apiRef ]);
}

/**
 * Whether the properties panel applies to pen strokes only: every selected element is a
 * `freedraw` one, or nothing is selected and the pen tool is active. A tool that draws a filled
 * shape keeps the panel whole, since its next shape takes the background.
 */
export function isInkSelection(state: InkState, elements: readonly ExcalidrawElement[]) {
    const tool = state.activeTool.type;
    if (FILLED_TOOLS.has(tool)) return false;

    const selected = state.selectedElementIds;
    let hasSelection = false;
    for (const element of elements) {
        if (!selected[element.id] || element.isDeleted) continue;
        if (element.type !== "freedraw") return false;
        hasSelection = true;
    }
    return hasSelection || tool === "freedraw";
}
