import { describe, expect, it } from "vitest";

import {
    applyTextEdit, BULLET, getBackspaceEdit, getEnterEdit, getListEditForKey, getSpaceEdit,
    getToggleListEdit, nextMarker, parseListItem, type TextEdit
} from "./text_lists";

/** Applies `edit` to `value`, marking the selection with `|` (caret) or `[` `]` (range). */
function apply(value: string, edit: TextEdit | null) {
    expect(edit).not.toBeNull();
    if (!edit) return value;

    const result = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
    if (edit.selectionStart === edit.selectionEnd) {
        return `${result.slice(0, edit.selectionStart)}|${result.slice(edit.selectionStart)}`;
    }
    return `${result.slice(0, edit.selectionStart)}[${result.slice(edit.selectionStart, edit.selectionEnd)}]${result.slice(edit.selectionEnd)}`;
}

/** Splits `value` with a `|` caret into the text and the caret offset. */
function caret(value: string): [ string, number ] {
    const index = value.indexOf("|");
    return [ value.replace("|", ""), index ];
}

describe("parseListItem", () => {
    it("reads bullets, numbers and letters after the indentation, and nothing else", () => {
        expect(parseListItem("• one")).toEqual({ indent: "", marker: "•", prefixLength: 2 });
        expect(parseListItem("    12. twelve")).toEqual({ indent: "    ", marker: "12.", prefixLength: 8 });
        expect(parseListItem("a) first")?.marker).toBe("a)");
        expect(parseListItem("-no space")).toBeNull();
        expect(parseListItem("plain text")).toBeNull();
        expect(parseListItem("1.5 is a number")).toBeNull();
    });
});

describe("nextMarker", () => {
    it("keeps bullets, counts numbers and letters, and turns * into •", () => {
        expect(nextMarker("•")).toBe("•");
        expect(nextMarker("-")).toBe("-");
        expect(nextMarker("*")).toBe(BULLET);
        expect(nextMarker("9.")).toBe("10.");
        expect(nextMarker("3)")).toBe("4)");
        expect(nextMarker("b.")).toBe("c.");
        expect(nextMarker("z)")).toBe("z)");
    });
});

describe("getEnterEdit", () => {
    it("continues the list of the current line with its indentation", () => {
        expect(apply("• one", getEnterEdit("• one", 5, 5))).toBe("• one\n• |");
        expect(apply("    1. one", getEnterEdit("    1. one", 10, 10))).toBe("    1. one\n    2. |");
        const [ value, index ] = caret("a) fi|rst");
        expect(apply(value, getEnterEdit(value, index, index))).toBe("a) fi\nb) |rst");
    });

    it("ends the list on an empty item and leaves plain lines to Excalidraw", () => {
        expect(apply("• one\n• ", getEnterEdit("• one\n• ", 8, 8))).toBe("• one\n|");
        expect(apply("    - ", getEnterEdit("    - ", 6, 6))).toBe("    |");
        expect(getEnterEdit("plain", 5, 5)).toBeNull();
        // A caret inside the marker is not in the item's text.
        expect(getEnterEdit("• one", 0, 0)).toBeNull();
    });
});

describe("getBackspaceEdit", () => {
    it("removes the marker when the caret is right after it, and only then", () => {
        expect(apply("    • one", getBackspaceEdit("    • one", 6, 6))).toBe("    |one");
        expect(apply("10. x", getBackspaceEdit("10. x", 4, 4))).toBe("|x");
        expect(getBackspaceEdit("• one", 3, 3)).toBeNull();
        expect(getBackspaceEdit("• one", 2, 4)).toBeNull();
        expect(getBackspaceEdit("plain", 1, 1)).toBeNull();
    });
});

describe("getSpaceEdit", () => {
    it("turns a lone * at the start of a line into a bullet", () => {
        expect(apply("x\n  *", getSpaceEdit("x\n  *", 5, 5))).toBe("x\n  • |");
        expect(getSpaceEdit("a *", 3, 3)).toBeNull();
        expect(getSpaceEdit("-", 1, 1)).toBeNull();
    });
});

describe("getToggleListEdit", () => {
    it("bullets and numbers the selected lines, skipping blank ones and keeping indentation", () => {
        const value = "one\n\n  two\nthree";
        expect(apply(value, getToggleListEdit(value, 0, value.length, "bullet"))).toBe("[• one\n\n  • two\n• three]");
        expect(apply(value, getToggleListEdit(value, 0, value.length, "number"))).toBe("[1. one\n\n  2. two\n3. three]");
    });

    it("removes the list when every line already is one, and switches between kinds", () => {
        expect(apply("• one\n• two", getToggleListEdit("• one\n• two", 0, 11, "bullet"))).toBe("[one\ntwo]");
        expect(apply("1. one\n- two", getToggleListEdit("1. one\n- two", 0, 12, "number"))).toBe("[1. one\n2. two]");
    });

    it("acts on the caret's line only, leaving the caret at its end", () => {
        const value = "one\ntwo\nthree";
        expect(apply(value, getToggleListEdit(value, 5, 5, "bullet"))).toBe("one\n• two|\nthree");
        // A selection that ends right after a line break leaves the next line alone.
        expect(apply(value, getToggleListEdit(value, 0, 4, "bullet"))).toBe("[• one]\ntwo\nthree");
    });
});

describe("getListEditForKey", () => {
    function textarea(value: string, selectionStart: number, selectionEnd = selectionStart) {
        const editable = document.createElement("textarea");
        editable.value = value;
        editable.setSelectionRange(selectionStart, selectionEnd);
        return editable;
    }

    it("maps Enter, Backspace, Space and OneNote's shortcuts to their edits", () => {
        const editable = textarea("• one", 5);
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "Enter" }), editable)?.text).toBe("\n• ");
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }), editable)).toBeNull();
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "Backspace" }), textarea("• one", 2))?.text).toBe("");
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: " " }), textarea("*", 1))?.text).toBe("• ");
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: ".", ctrlKey: true }), textarea("one", 3))?.text).toBe("• one");
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "/", metaKey: true }), textarea("one", 3))?.text).toBe("1. one");
    });

    it("leaves other keys, other shortcuts and composition to Excalidraw", () => {
        const editable = textarea("• one", 5);
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "a" }), editable)).toBeNull();
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }), editable)).toBeNull();
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "Enter", altKey: true }), editable)).toBeNull();
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: ".", ctrlKey: true, shiftKey: true }), editable)).toBeNull();
        expect(getListEditForKey(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }), editable)).toBeNull();
    });
});

describe("applyTextEdit", () => {
    it("replaces the range, places the selection and fires input for Excalidraw", () => {
        const editable = document.createElement("textarea");
        editable.value = "• one";
        let inputValue: string | null = null;
        editable.addEventListener("input", () => {
            inputValue = editable.value;
        });

        applyTextEdit(editable, { start: 5, end: 5, text: "\n• ", selectionStart: 8, selectionEnd: 8 });

        expect(inputValue).toBe("• one\n• ");
        expect([ editable.selectionStart, editable.selectionEnd ]).toEqual([ 8, 8 ]);
    });
});
