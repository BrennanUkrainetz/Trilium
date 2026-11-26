import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
    CANVAS_RICH_TEXT_KEY, CANVAS_RICH_TEXT_LINK, type CanvasRichTextData
} from "@triliumnext/commons/src/lib/canvas_rich_text.js";
import DOMPurify from "dompurify";

type CaptureUpdate = typeof CaptureUpdateAction[keyof typeof CaptureUpdateAction];

/** The data of a rich text box in its element's `customData`. */
export interface RichTextBoxData extends CanvasRichTextData {
    /** Whether the box widens with its longest line, as it does until the user resizes it. */
    autoWidth?: boolean;
}

/** The font size of the text of a box, in scene pixels: that of Excalidraw's default text. */
export const RICH_TEXT_FONT_SIZE = 20;
/** The line height of the text of a box, as a factor of the font size. */
export const RICH_TEXT_LINE_HEIGHT = 1.25;
/** The smallest box, in scene pixels. */
export const RICH_TEXT_MIN_WIDTH = 40;

/** The tags that formatted text keeps. Anything else is unwrapped, keeping its text. */
const ALLOWED_TAGS = [
    "p", "div", "br", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "span", "ul", "ol",
    "li"
];
/** The CSS properties that formatted text keeps in its `style` attributes. */
const ALLOWED_STYLES = new Set([
    "color", "background-color", "font-size", "font-weight", "font-style", "text-decoration",
    "text-decoration-line"
]);

const purifier = DOMPurify(window);
purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName !== "style") return;

    const kept = data.attrValue
        .split(";")
        .map((declaration) => declaration.trim())
        .filter((declaration) => {
            const property = declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase();
            return ALLOWED_STYLES.has(property) && !/url\s*\(|expression\s*\(/i.test(declaration);
        });
    if (kept.length) {
        data.attrValue = kept.join("; ");
    } else {
        data.keepAttr = false;
    }
});

/** `html` with only the tags and styles of formatted text, safe to show and to store. */
export function sanitizeRichTextHtml(html: string) {
    return purifier.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR: [ "style" ],
        KEEP_CONTENT: true
    });
}

/** The data of the rich text box `element`. */
export function getRichTextData(element: ExcalidrawElement): RichTextBoxData {
    const data = element.customData?.[CANVAS_RICH_TEXT_KEY] as Partial<RichTextBoxData> | undefined;
    return { html: typeof data?.html === "string" ? data.html : "", autoWidth: data?.autoWidth ?? true };
}

/**
 * `html` with all of its text in the color `color`, or in the default color for `null`. The
 * colors of its parts are removed, and the color of a previous call is replaced, not nested.
 */
export function colorRichTextHtml(html: string, color: string | null) {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const element of template.content.querySelectorAll<HTMLElement>("[style]")) {
        element.style.removeProperty("color");
        if (!element.style.length) element.removeAttribute("style");
    }

    const [ only ] = template.content.childNodes;
    if (template.content.childNodes.length === 1 && only instanceof HTMLDivElement && !only.attributes.length) {
        only.replaceWith(...only.childNodes);
    }

    if (!color) return template.innerHTML;

    // `html` is sanitized when it is saved, and the `color` setter takes only a valid color.
    const wrapper = document.createElement("div");
    wrapper.style.color = color;
    wrapper.append(template.content);
    return wrapper.outerHTML;
}

/**
 * A new, empty rich text box whose first line is centered on the scene point `x`, `y`. The box
 * has no stroke or fill: only its text shows.
 */
export function createRichTextElement(x: number, y: number): ExcalidrawEmbeddableElement {
    const lineHeight = RICH_TEXT_FONT_SIZE * RICH_TEXT_LINE_HEIGHT;
    const data: RichTextBoxData = { html: "", autoWidth: true };
    const partial = {
        type: "embeddable",
        x,
        y: y - lineHeight / 2,
        width: RICH_TEXT_MIN_WIDTH,
        height: lineHeight,
        link: CANVAS_RICH_TEXT_LINK,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        strokeWidth: 1,
        roughness: 0,
        roundness: null,
        customData: { [CANVAS_RICH_TEXT_KEY]: data }
    } as unknown as ExcalidrawEmbeddableElement;

    // `restoreElements()` fills in what Excalidraw's element factory would, as for dropped notes.
    const [ element ] = restoreElements([ partial ], null) as ExcalidrawEmbeddableElement[];
    return element;
}

/** Adds `element` to the scene, selected and open for typing, as its own undo step. */
export function insertRichTextElement(api: ExcalidrawImperativeAPI, element: ExcalidrawEmbeddableElement) {
    api.updateScene({
        elements: [ ...api.getSceneElementsIncludingDeleted(), element ],
        appState: {
            selectedElementIds: { [element.id]: true },
            activeEmbeddable: { element, state: "active" }
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
}

export interface RichTextUpdate {
    html?: string;
    autoWidth?: boolean;
    width?: number;
    height?: number;
    isDeleted?: boolean;
}

/**
 * Changes the rich text box with `elementId`, when the change differs from what it holds.
 * `captureUpdate` decides whether the change is an undo step of its own.
 */
export function updateRichTextElement(
    api: ExcalidrawImperativeAPI,
    elementId: string,
    update: RichTextUpdate,
    captureUpdate: CaptureUpdate = CaptureUpdateAction.EVENTUALLY
) {
    const elements = api.getSceneElementsIncludingDeleted();
    const current = elements.find((element) => element.id === elementId);
    if (!current) return;

    const data = getRichTextData(current);
    const nextData: RichTextBoxData = {
        html: update.html ?? data.html,
        autoWidth: update.autoWidth ?? data.autoWidth
    };
    const width = update.width ?? current.width;
    const height = update.height ?? current.height;
    const isDeleted = update.isDeleted ?? current.isDeleted;
    if (nextData.html === data.html && nextData.autoWidth === data.autoWidth
        && width === current.width && height === current.height && isDeleted === current.isDeleted) {
        return;
    }

    const updated = newElementWith(current, {
        width,
        height,
        isDeleted,
        customData: { ...current.customData, [CANVAS_RICH_TEXT_KEY]: nextData }
    });
    api.updateScene({
        elements: elements.map((element) => element.id === elementId ? updated : element),
        captureUpdate
    });
}
