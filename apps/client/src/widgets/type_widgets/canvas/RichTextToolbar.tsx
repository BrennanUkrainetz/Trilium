import "./RichTextToolbar.css";

import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import ColorPicker from "../../react/ColorPicker";
import { FormListItem } from "../../react/FormList";
import OverlayControlGroup, { OverlayControlButton, OverlayControlDropdown } from "../../react/OverlayControlGroup";
import { RICH_TEXT_FONT_SIZE } from "./rich_text";

/** The font sizes offered for the text of a box, in scene pixels. */
export const RICH_TEXT_FONT_SIZES = [ 12, 16, RICH_TEXT_FONT_SIZE, 24, 32, 40 ];

/** The color of text without a color of its own, as in `RichTextBox.css`. */
const DEFAULT_TEXT_COLOR = "#1e1e1e";

/** The formatting commands that show whether they apply to the selection. */
const STATE_COMMANDS = [
    "bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"
] as const;
type StateCommand = typeof STATE_COMMANDS[number];

interface RichTextToolbarProps {
    /** The text editor of the rich text box being edited, or `null` when none is. */
    editor: HTMLElement | null;
}

/**
 * The formatting toolbar of the rich text box being edited, at the foot of the canvas: bold, italic,
 * underline, strikethrough, lists, font size, text color, highlight and clearing the formatting.
 *
 * Pressing a button moves the focus out of the box, so the toolbar keeps the last selection in the
 * box and selects it again before it formats.
 */
export default function RichTextToolbar({ editor }: RichTextToolbarProps) {
    const savedRangeRef = useRef<Range | null>(null);
    const [ states, setStates ] = useState<Partial<Record<StateCommand, boolean>>>({});

    useEffect(() => {
        savedRangeRef.current = null;
        if (!editor) return;

        const onSelectionChange = () => {
            const selection = window.getSelection();
            if (!selection?.rangeCount) return;

            const range = selection.getRangeAt(0);
            if (!editor.contains(range.commonAncestorContainer)) return;
            savedRangeRef.current = range.cloneRange();
            setStates(Object.fromEntries(STATE_COMMANDS.map((command) => [ command, document.queryCommandState(command) ])));
        };
        document.addEventListener("selectionchange", onSelectionChange);
        return () => document.removeEventListener("selectionchange", onSelectionChange);
    }, [ editor ]);

    if (!editor) return null;

    function restoreSelection() {
        editor?.focus();
        const range = savedRangeRef.current;
        const selection = window.getSelection();
        if (range && selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    function format(command: string, value?: string) {
        restoreSelection();
        document.execCommand("styleWithCSS", false, "true");
        document.execCommand(command, false, value);
    }

    function setFontSize(size: number) {
        if (!editor) return;

        // `fontSize` takes only the seven sizes of `<font>`, so the largest one marks the text,
        // which then gets the size in pixels instead.
        restoreSelection();
        document.execCommand("styleWithCSS", false, "false");
        document.execCommand("fontSize", false, "7");
        for (const font of editor.querySelectorAll("font[size='7']")) {
            const span = document.createElement("span");
            span.style.fontSize = `${size}px`;
            span.append(...font.childNodes);
            font.replaceWith(span);
        }
        editor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    return (
        <OverlayControlGroup placement="bottom-center" className="canvas-rich-text-toolbar" titlePosition="top" overCanvas>
            <OverlayControlButton icon="bx-bold" title={t("canvas.rich_text_bold")} shortcut="Ctrl+B"
                active={states.bold} onClick={() => format("bold")} />
            <OverlayControlButton icon="bx-italic" title={t("canvas.rich_text_italic")} shortcut="Ctrl+I"
                active={states.italic} onClick={() => format("italic")} />
            <OverlayControlButton icon="bx-underline" title={t("canvas.rich_text_underline")} shortcut="Ctrl+U"
                active={states.underline} onClick={() => format("underline")} />
            <OverlayControlButton icon="bx-strikethrough" title={t("canvas.rich_text_strikethrough")}
                active={states.strikeThrough} onClick={() => format("strikeThrough")} />
            <OverlayControlButton icon="bx-list-ul" title={t("canvas.rich_text_bulleted_list")} shortcut="Ctrl+."
                active={states.insertUnorderedList} onClick={() => format("insertUnorderedList")} />
            <OverlayControlButton icon="bx-list-ol" title={t("canvas.rich_text_numbered_list")} shortcut="Ctrl+/"
                active={states.insertOrderedList} onClick={() => format("insertOrderedList")} />
            <OverlayControlDropdown icon="bx-font-size" title={t("canvas.rich_text_font_size")}>
                {RICH_TEXT_FONT_SIZES.map((size) => (
                    <FormListItem key={size} onClick={() => setFontSize(size)}>{size}</FormListItem>
                ))}
            </OverlayControlDropdown>
            <OverlayControlDropdown icon="bx-font-color" title={t("canvas.rich_text_color")} panel>
                <ColorPicker currentValue={null} onChange={(color) => format("foreColor", color ?? DEFAULT_TEXT_COLOR)} />
            </OverlayControlDropdown>
            <OverlayControlDropdown icon="bx-highlight" title={t("canvas.rich_text_highlight")} panel>
                <ColorPicker currentValue={null} onChange={(color) => format("hiliteColor", color ?? "transparent")} />
            </OverlayControlDropdown>
            <OverlayControlButton icon="bx-eraser" title={t("canvas.rich_text_clear_formatting")}
                onClick={() => format("removeFormat")} />
        </OverlayControlGroup>
    );
}
