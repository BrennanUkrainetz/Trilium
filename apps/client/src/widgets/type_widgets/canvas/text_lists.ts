/**
 * OneNote-style list editing for the plain text of a canvas text element: bullets and numbered
 * lists that continue on Enter, end on Enter in an empty item, and toggle with a shortcut.
 *
 * Excalidraw's text editor is a `<textarea>`, so a list is plain text: a marker (`•`, `-`, `1.`,
 * `a)`) at the start of a line, after the indentation that Tab inserts.
 */

/** A change to the text of the editor: `text` replaces `start`–`end`, then the caret goes to `caret`. */
export interface TextEdit {
    start: number;
    end: number;
    text: string;
    /** The selection after the edit, as offsets into the new value. */
    selectionStart: number;
    selectionEnd: number;
}

export const BULLET = "•";

/** The bullet markers that a list continues with. `*` is turned into `•` as it is typed. */
const BULLET_MARKERS = [ BULLET, "-", "–", "*" ];

/** Leading indentation, a marker, then the space after it. */
const LIST_ITEM_RE = /^([ \t]*)(•|-|–|\*|\d{1,4}[.)]|[a-zA-Z][.)])( +)/;

export interface ListItem {
    indent: string;
    marker: string;
    /** Indentation, marker and the spaces after it. */
    prefixLength: number;
}

/** The list item that `line` starts, or `null` when it is not one. */
export function parseListItem(line: string): ListItem | null {
    const match = LIST_ITEM_RE.exec(line);
    if (!match) {
        return null;
    }

    const [ prefix, indent, marker ] = match;
    return { indent, marker, prefixLength: prefix.length };
}

/** The marker of the item after one with `marker`: the same bullet, or the next number or letter. */
export function nextMarker(marker: string): string {
    if (BULLET_MARKERS.includes(marker)) {
        return marker === "*" ? BULLET : marker;
    }

    const suffix = marker.slice(-1);
    const body = marker.slice(0, -1);
    if (/^\d+$/.test(body)) {
        return `${Number(body) + 1}${suffix}`;
    }

    // A letter past `z` stays at `z` rather than running into punctuation.
    const code = body.charCodeAt(0);
    const isLast = body === "z" || body === "Z";
    return `${isLast ? body : String.fromCharCode(code + 1)}${suffix}`;
}

function getLineStart(value: string, index: number) {
    return value.lastIndexOf("\n", index - 1) + 1;
}

function getLineEnd(value: string, index: number) {
    const end = value.indexOf("\n", index);
    return end === -1 ? value.length : end;
}

/**
 * What Enter does at the caret: continue the list of the current line, or end the list when the
 * item is empty. `null` when the caret is not in a list item and Enter should insert a line break.
 */
export function getEnterEdit(value: string, selectionStart: number, selectionEnd: number): TextEdit | null {
    const lineStart = getLineStart(value, selectionStart);
    const lineEnd = getLineEnd(value, selectionEnd);
    const line = value.slice(lineStart, lineEnd);
    const item = parseListItem(line);
    if (!item || selectionStart < lineStart + item.prefixLength) {
        return null;
    }

    const isEmptyItem = line.slice(item.prefixLength).trim() === "" && selectionStart === selectionEnd;
    if (isEmptyItem) {
        // Enter in an empty item ends the list, as in OneNote: the marker goes, the line stays.
        return {
            start: lineStart,
            end: lineEnd,
            text: item.indent,
            selectionStart: lineStart + item.indent.length,
            selectionEnd: lineStart + item.indent.length
        };
    }

    const insertion = `\n${item.indent}${nextMarker(item.marker)} `;
    const caret = selectionStart + insertion.length;
    return { start: selectionStart, end: selectionEnd, text: insertion, selectionStart: caret, selectionEnd: caret };
}

/**
 * What Backspace does at the caret: remove the marker when the caret sits right after it, so the
 * item becomes plain text. `null` otherwise.
 */
export function getBackspaceEdit(value: string, selectionStart: number, selectionEnd: number): TextEdit | null {
    if (selectionStart !== selectionEnd) {
        return null;
    }

    const lineStart = getLineStart(value, selectionStart);
    const item = parseListItem(value.slice(lineStart, getLineEnd(value, selectionStart)));
    if (!item || selectionStart !== lineStart + item.prefixLength) {
        return null;
    }

    const caret = lineStart + item.indent.length;
    return { start: caret, end: selectionStart, text: "", selectionStart: caret, selectionEnd: caret };
}

/**
 * What a space does at the caret: `*` alone at the start of a line becomes a bullet, as in OneNote.
 * `null` otherwise.
 */
export function getSpaceEdit(value: string, selectionStart: number, selectionEnd: number): TextEdit | null {
    if (selectionStart !== selectionEnd) {
        return null;
    }

    const lineStart = getLineStart(value, selectionStart);
    const beforeCaret = value.slice(lineStart, selectionStart);
    const match = /^([ \t]*)\*$/.exec(beforeCaret);
    if (!match) {
        return null;
    }

    const text = `${match[1]}${BULLET} `;
    const caret = lineStart + text.length;
    return { start: lineStart, end: selectionStart, text, selectionStart: caret, selectionEnd: caret };
}

export type ListKind = "bullet" | "number";

function isKind(item: ListItem, kind: ListKind) {
    const isBullet = BULLET_MARKERS.includes(item.marker);
    return kind === "bullet" ? isBullet : !isBullet;
}

/**
 * Turns the lines of the selection into a list of `kind`, or back into plain lines when all of them
 * already are one. Blank lines are left alone and numbering skips them.
 */
export function getToggleListEdit(value: string, selectionStart: number, selectionEnd: number, kind: ListKind): TextEdit {
    const start = getLineStart(value, selectionStart);
    // A selection that ends right after a line break does not take in the next line.
    const lastIndex = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
    const end = getLineEnd(value, lastIndex);
    const lines = value.slice(start, end).split("\n");

    const contentLines = lines.filter((line) => line.trim());
    const removing = contentLines.length > 0 && contentLines.every((line) => {
        const item = parseListItem(line);
        return item && isKind(item, kind);
    });

    let number = 1;
    const newLines = lines.map((line) => {
        if (!line.trim()) {
            return line;
        }

        const item = parseListItem(line);
        const indent = item?.indent ?? /^[ \t]*/.exec(line)?.[0] ?? "";
        const body = line.slice(item ? item.prefixLength : indent.length);
        if (removing) {
            return `${indent}${body}`;
        }

        const marker = kind === "bullet" ? BULLET : `${number++}.`;
        return `${indent}${marker} ${body}`;
    });

    const text = newLines.join("\n");
    return {
        start,
        end,
        text,
        // A single caret stays at the end of its line, a selection keeps covering the lines.
        selectionStart: selectionStart === selectionEnd ? start + text.length : start,
        selectionEnd: start + text.length
    };
}

/** Applies `edit` to a text editor and tells Excalidraw that its value changed. */
export function applyTextEdit(editable: HTMLTextAreaElement, edit: TextEdit) {
    editable.setRangeText(edit.text, edit.start, edit.end);
    editable.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    // Excalidraw reads the value in its `oninput` handler, which resizes and saves the element.
    editable.dispatchEvent(new Event("input"));
}

/**
 * The list edit that `event` asks for in a text editor, or `null` when the key is not one of the
 * list keys and should reach Excalidraw as usual.
 */
export function getListEditForKey(event: KeyboardEvent, editable: HTMLTextAreaElement): TextEdit | null {
    if (event.isComposing || event.keyCode === 229) {
        return null;
    }

    const { value, selectionStart, selectionEnd } = editable;
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    if (isCtrlOrCmd && !event.altKey && !event.shiftKey) {
        // OneNote's shortcuts: Ctrl+. for bullets, Ctrl+/ for numbering.
        if (event.key === ".") {
            return getToggleListEdit(value, selectionStart, selectionEnd, "bullet");
        }
        if (event.key === "/") {
            return getToggleListEdit(value, selectionStart, selectionEnd, "number");
        }
        return null;
    }

    if (isCtrlOrCmd || event.altKey) {
        return null;
    }

    switch (event.key) {
        case "Enter":
            // Shift+Enter is a plain line break inside the item, as in OneNote.
            return event.shiftKey ? null : getEnterEdit(value, selectionStart, selectionEnd);
        case "Backspace":
            return event.shiftKey ? null : getBackspaceEdit(value, selectionStart, selectionEnd);
        case " ":
            return getSpaceEdit(value, selectionStart, selectionEnd);
        default:
            return null;
    }
}
