import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { CANVAS_RICH_TEXT_KEY, isCanvasRichTextElement } from "@triliumnext/commons/src/lib/canvas_rich_text.js";

import { colorRichTextHtml, getRichTextData } from "./rich_text";

/** A quick ink color, offered by the ink toolbar and the touch menu. */
export interface InkColor {
    /** The key of the color's name under `canvas.ink_colors` in the client catalogue. */
    name: string;
    value: string;
}

/** The quick ink colors, in the order the ink toolbar and the touch menu show them. */
export const INK_COLORS: readonly InkColor[] = [
    { name: "black", value: "#1e1e1e" },
    { name: "red", value: "#e03131" },
    { name: "blue", value: "#1971c2" },
    { name: "green", value: "#2f9e44" }
];

/** The color of the highlighter. */
export const HIGHLIGHTER_COLOR = "#ffd43b";

/** The color of text and strokes without a color of their own, as in `RichTextBox.css`. */
export const DEFAULT_INK_COLOR = "#1e1e1e";

/**
 * Gives the selected elements the stroke color `color` and makes it the color of the next
 * element, as Excalidraw's own stroke picker does. One undo step reverts both. A rich text box
 * takes the color on its text rather than on its border. `null` restores the default color.
 */
export function applyStrokeColor(api: ExcalidrawImperativeAPI, color: string | null) {
    const { selectedElementIds } = api.getAppState();
    const strokeColor = color ?? DEFAULT_INK_COLOR;
    const elements = api.getSceneElements().map((element) => {
        if (!selectedElementIds[element.id]) return element;
        if (!isCanvasRichTextElement(element)) return newElementWith(element, { strokeColor });

        const data = getRichTextData(element);
        return newElementWith(element, {
            customData: { ...element.customData, [CANVAS_RICH_TEXT_KEY]: { ...data, html: colorRichTextHtml(data.html, color) } }
        });
    });
    api.updateScene({
        elements,
        appState: { currentItemStrokeColor: strokeColor },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
}

/** The stroke of a pen of the ink toolbar, kept for each pen while the other one draws. */
export interface InkStyle {
    color: string;
    /** Excalidraw's `strokeWidth`, which a freedraw stroke draws at about four times. */
    width: number;
    /** From 0 to 100. */
    opacity: number;
}

/** The stroke of the highlighter until the user changes it: wide, yellow and see-through. */
export const HIGHLIGHTER_STYLE: InkStyle = { color: HIGHLIGHTER_COLOR, width: 6, opacity: 40 };

/** The `currentItem*` properties that make the next element drawn in `style`, as a solid stroke. */
export function inkStyleToAppState(style: InkStyle): Pick<AppState,
    "currentItemStrokeColor" | "currentItemStrokeWidth" | "currentItemOpacity" | "currentItemStrokeStyle"> {
    return {
        currentItemStrokeColor: style.color,
        currentItemStrokeWidth: style.width,
        currentItemOpacity: style.opacity,
        currentItemStrokeStyle: "solid"
    };
}

/** The stroke that the next element of `appState` is drawn in. */
export function readInkStyle(appState: Pick<AppState,
    "currentItemStrokeColor" | "currentItemStrokeWidth" | "currentItemOpacity">): InkStyle {
    return {
        color: appState.currentItemStrokeColor,
        width: appState.currentItemStrokeWidth,
        opacity: appState.currentItemOpacity
    };
}
