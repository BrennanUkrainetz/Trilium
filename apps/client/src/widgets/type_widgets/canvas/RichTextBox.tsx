import "./RichTextBox.css";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { NonDeleted, ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasRichTextToPlainText } from "@triliumnext/commons/src/lib/canvas_rich_text.js";
import clsx from "clsx";
import type { RefObject, TargetedClipboardEvent, TargetedKeyboardEvent } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import {
    getRichTextData, RICH_TEXT_FONT_SIZE, RICH_TEXT_LINE_HEIGHT, RICH_TEXT_MIN_WIDTH,
    sanitizeRichTextHtml, updateRichTextElement
} from "./rich_text";

interface RichTextBoxProps {
    element: NonDeleted<ExcalidrawEmbeddableElement>;
    /** Whether Excalidraw made the box the active embeddable, which lets pointers into it. */
    isActive: boolean;
    isEditable: boolean;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    /** Whether Ctrl+., Ctrl+/, Tab and autoformatting edit lists. */
    smartLists: boolean;
    /** Reports the editor while the box is edited, and `null` once it is not. */
    onEditorChange(editor: HTMLElement | null): void;
}

/**
 * A rich text box on a canvas: formatted text that Trilium renders over Excalidraw's canvas in place
 * of an `embeddable` element, and edits in place once the box is active. The box resizes its
 * element to its text: it grows wider with its longest line until the user resizes it, and taller
 * with each line.
 */
export default function RichTextBox({ element, isActive, isEditable, apiRef, smartLists, onEditorChange }: RichTextBoxProps) {
    const ref = useRef<HTMLDivElement>(null);
    const { html, autoWidth } = getRichTextData(element);
    const isEditing = isActive && isEditable;
    /** The size this box gave its element last, which tells a resize by the user from its own. */
    const ownSizeRef = useRef<{ width: number; height: number } | null>(null);
    const frameRef = useRef<number | null>(null);
    const wasEditingRef = useRef(false);

    // The stored text is shown unless the user is typing into the box, which must keep the caret.
    useLayoutEffect(() => {
        const editor = ref.current;
        if (!editor || (isEditing && editor.contains(document.activeElement))) return;

        const clean = sanitizeRichTextHtml(html);
        if (editor.innerHTML !== clean) {
            editor.innerHTML = clean;
        }
    }, [ html, isEditing ]);

    // A width that this box did not set comes from the user resizing it, and stays.
    useEffect(() => {
        const ownSize = ownSizeRef.current;
        const api = apiRef.current;
        if (!api || !isEditable || !autoWidth || !ownSize || Math.abs(element.width - ownSize.width) < 1) return;
        updateRichTextElement(api, element.id, { autoWidth: false });
    }, [ apiRef, element.id, element.width, autoWidth, isEditable ]);

    useEffect(() => {
        const editor = ref.current;
        if (!editor || !isEditable) return;

        const measure = () => {
            const api = apiRef.current;
            if (!api) return;

            const padding = 2 * element.strokeWidth;
            const width = autoWidth
                ? Math.max(RICH_TEXT_MIN_WIDTH, Math.ceil(editor.offsetWidth) + padding)
                : element.width;
            const height = Math.max(RICH_TEXT_FONT_SIZE * RICH_TEXT_LINE_HEIGHT, Math.ceil(editor.offsetHeight) + padding);
            ownSizeRef.current = { width, height };
            updateRichTextElement(api, element.id, { width, height });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(editor);
        return () => observer.disconnect();
    }, [ apiRef, element.id, element.width, element.strokeWidth, autoWidth, isEditable ]);

    useLayoutEffect(() => {
        const editor = ref.current;
        if (!editor || !isEditing) return;

        document.execCommand("defaultParagraphSeparator", false, "p");
        document.execCommand("styleWithCSS", false, "true");
        if (!editor.contains(document.activeElement)) {
            editor.focus();
            placeCaretAtEnd(editor);
        }
        onEditorChange(editor);
        return () => onEditorChange(null);
    }, [ isEditing, onEditorChange ]);

    // Leaving an empty box removes it, as OneNote does.
    useEffect(() => {
        const wasEditing = wasEditingRef.current;
        wasEditingRef.current = isEditing;
        const api = apiRef.current;
        const editor = ref.current;
        if (!wasEditing || isEditing || !api || !editor) return;

        const finalHtml = sanitizeRichTextHtml(editor.innerHTML);
        const isEmpty = !canvasRichTextToPlainText(finalHtml);
        updateRichTextElement(api, element.id, { html: finalHtml, isDeleted: isEmpty || undefined },
            CaptureUpdateAction.IMMEDIATELY);
    }, [ apiRef, element.id, isEditing ]);

    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }, []);

    function save() {
        frameRef.current = null;
        const api = apiRef.current;
        const editor = ref.current;
        if (!api || !editor) return;
        updateRichTextElement(api, element.id, { html: sanitizeRichTextHtml(editor.innerHTML) });
    }

    function onInput() {
        if (frameRef.current === null) {
            frameRef.current = requestAnimationFrame(save);
        }
    }

    function onKeyDown(e: TargetedKeyboardEvent<HTMLDivElement>) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            apiRef.current?.updateScene({ appState: { activeEmbeddable: null } });
            return;
        }

        if (smartLists && handleListKey(e.currentTarget, e)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function onPaste(e: TargetedClipboardEvent<HTMLDivElement>) {
        const data = e.clipboardData;
        if (!data) return;

        e.preventDefault();
        const pastedHtml = data.getData("text/html");
        if (pastedHtml) {
            document.execCommand("insertHTML", false, sanitizeRichTextHtml(pastedHtml));
        } else {
            document.execCommand("insertText", false, data.getData("text/plain"));
        }
    }

    return (
        <div className="canvas-rich-text-box">
            <div
                ref={ref}
                className={clsx("canvas-rich-text", { "auto-width": autoWidth, editing: isEditing })}
                data-rich-text-id={element.id}
                // Excalidraw leaves the keys of an element with this type to it, as in its own text editor.
                data-type="wysiwyg"
                contentEditable={isEditing}
                spellcheck={isEditing}
                onInput={onInput}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
            />
        </div>
    );
}

function placeCaretAtEnd(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

/** Bullet markers that start a bulleted list when typed at the start of a line and followed by a space. */
const BULLET_MARKER_RE = /^[*\-•]$/;
/** Number markers that start a numbered list when typed at the start of a line and followed by a space. */
const NUMBER_MARKER_RE = /^1[.)]$/;

/**
 * Applies a list key of OneNote to `editor`: Ctrl+. and Ctrl+/ toggle a bulleted and a numbered
 * list, Tab and Shift+Tab nest a list item, and `*`, `-` or `1.` followed by a space start a list.
 * Returns whether the key was one of these.
 */
export function handleListKey(editor: HTMLElement, e: KeyboardEvent) {
    if (e.isComposing) return false;

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && !e.shiftKey && !e.altKey && (e.key === "." || e.key === "/")) {
        document.execCommand(e.key === "." ? "insertUnorderedList" : "insertOrderedList");
        return true;
    }
    if (isCtrlOrCmd || e.altKey) return false;

    if (e.key === "Tab") {
        if (!getSelectionElement(editor)?.closest("li")) return false;
        document.execCommand(e.shiftKey ? "outdent" : "indent");
        return true;
    }

    if (e.key === " " && !e.shiftKey) {
        return startListFromMarker(editor);
    }
    return false;
}

function getSelectionElement(editor: HTMLElement) {
    const node = window.getSelection()?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return element && editor.contains(element) ? element : null;
}

/** Turns a list marker typed at the start of a line into a list. Returns whether there was one. */
function startListFromMarker(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;

    const caret = selection.getRangeAt(0);
    const anchor = getSelectionElement(editor);
    if (!anchor || anchor.closest("li")) return false;

    const block = anchor.closest("p, div:not(.canvas-rich-text)") ?? editor;
    const beforeCaret = document.createRange();
    beforeCaret.setStart(block, 0);
    beforeCaret.setEnd(caret.startContainer, caret.startOffset);
    const marker = beforeCaret.toString();

    const command = BULLET_MARKER_RE.test(marker) ? "insertUnorderedList"
        : NUMBER_MARKER_RE.test(marker) ? "insertOrderedList"
            : null;
    if (!command) return false;

    selection.removeAllRanges();
    selection.addRange(beforeCaret);
    document.execCommand("delete");
    document.execCommand(command);
    return true;
}
