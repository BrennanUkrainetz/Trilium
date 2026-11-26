/**
 * Rich text boxes on a canvas: Excalidraw `embeddable` elements that Trilium renders itself, with
 * their formatted text as HTML in the element's `customData`. Shared by the client, which renders
 * and edits them, and core, which indexes their text for search.
 */

/** The `link` of an embeddable that is a rich text box. */
export const CANVAS_RICH_TEXT_LINK = "trilium:rich-text";

/** The key of the box's data in the element's `customData`. */
export const CANVAS_RICH_TEXT_KEY = "triliumRichText";

export interface CanvasRichTextData {
    /** The formatted text, as sanitized HTML. */
    html: string;
}

interface ElementLike {
    type?: string;
    link?: string | null;
    customData?: Record<string, unknown> | null;
}

/** Whether `element` is a rich text box. */
export function isCanvasRichTextElement(element: ElementLike | null | undefined) {
    return element?.type === "embeddable" && element.link === CANVAS_RICH_TEXT_LINK;
}

/** The HTML of the rich text box `element`, `""` for an empty box, or `null` when it is not one. */
export function getCanvasRichTextHtml(element: ElementLike | null | undefined): string | null {
    if (!isCanvasRichTextElement(element)) {
        return null;
    }

    const data = element?.customData?.[CANVAS_RICH_TEXT_KEY] as Partial<CanvasRichTextData> | undefined;
    return typeof data?.html === "string" ? data.html : "";
}

const BLOCK_END_RE = /<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi;
const TAG_RE = /<[^>]*>/g;
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi;
const NAMED_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " "
};

/**
 * The text of a rich text box, with a line break after each paragraph and list item. Written
 * without the DOM, as core also runs in a Web Worker.
 */
export function canvasRichTextToPlainText(html: string): string {
    return html
        .replace(BLOCK_END_RE, "\n")
        .replace(TAG_RE, "")
        .replace(ENTITY_RE, (_match, entity: string) => {
            const name = entity.toLowerCase();
            if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
            if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
            return NAMED_ENTITIES[name] ?? "";
        })
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
}
