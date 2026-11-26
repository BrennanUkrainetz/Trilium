import "./TouchMenu.css";

import { getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import clsx from "clsx";
import type { RefObject, TargetedPointerEvent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import { isMac } from "../../../services/utils";
import Button from "../../react/Button";
import ColorPicker from "../../react/ColorPicker";
import Popover from "../../react/Popover";
import { INTERACTIVE_CANVAS_SELECTOR, viewportToScene } from "./click_to_type";
import { applyStrokeColor, DEFAULT_INK_COLOR, INK_COLORS } from "./ink_tools";
import useTouchLongPress, { type LongPress } from "./touch_long_press";

/** How far, in pixels, the menu keeps from the pressed spot, so the finger does not cover it. */
const FINGER_CLEARANCE_PX = 28;

/** How far, in screen pixels, a press can land outside an element and still pick it. */
const HIT_TOLERANCE_PX = 10;

/** The MIME types that Excalidraw's `readSystemClipboard()` takes from the clipboard. */
const TEXT_MIME_TYPES = [ "text/plain", "text/html" ];

const EXCALIDRAW_CONTAINER_SELECTOR = ".excalidraw-container";

export interface TouchMenuProps {
    /** The root of the canvas editor, which the long press is detected on. */
    rootRef: RefObject<HTMLElement | null>;
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    /** The text editor of the rich text box being edited, or `null` when none is. */
    richTextEditor: HTMLElement | null;
    isReadOnly: boolean;
}

interface OpenMenu {
    clientX: number;
    clientY: number;
    /** The rich text editor that was pressed, whose selected text the menu acts on. */
    editor: HTMLElement | null;
    /** The selection the press made, restored after Excalidraw's `pointerup` changes it. */
    selection: SceneSelection | null;
    hasSelection: boolean;
}

/**
 * The menu of a finger held on the canvas, as in OneNote: a floating bar beside the finger with
 * Paste, Cut, Copy, Delete and Duplicate, and the quick colors, which color the selected strokes
 * and text. A press on an element selects it first. The mouse's right click and the pen keep
 * Excalidraw's own context menu.
 *
 * Inside a rich text box being edited, the actions and colors apply to the selected text.
 */
export default function TouchMenu({ rootRef, apiRef, richTextEditor, isReadOnly }: TouchMenuProps) {
    const [ menu, setMenu ] = useState<OpenMenu | null>(null);
    const menuRef = useRef(menu);
    menuRef.current = menu;
    const editorRef = useRef(richTextEditor);
    editorRef.current = richTextEditor;
    const savedRangeRef = useRef<Range | null>(null);

    const close = useCallback(() => setMenu(null), []);

    useTouchLongPress(rootRef, {
        onLongPress(press) {
            const api = apiRef.current;
            if (!api || isReadOnly) return false;

            const next = openMenuFor(api, press, editorRef.current);
            if (!next) return false;

            if (next.selection) {
                api.updateScene({ appState: next.selection });
            }
            setMenu(next);
        },
        onRelease() {
            const api = apiRef.current;
            const selection = menuRef.current?.selection;
            if (api && selection) {
                api.updateScene({ appState: selection });
            }
        }
    });

    // The finger's own long press selects a word in a rich text box, after the menu opens, and a
    // press on the menu's color input moves the focus out of the box.
    useEffect(() => {
        const editor = menu?.editor;
        savedRangeRef.current = null;
        if (!editor) return;

        const saveRange = () => {
            const selection = window.getSelection();
            if (!selection?.rangeCount) return;

            const range = selection.getRangeAt(0);
            if (editor.contains(range.commonAncestorContainer)) {
                savedRangeRef.current = range.cloneRange();
            }
        };
        saveRange();
        document.addEventListener("selectionchange", saveRange);
        return () => document.removeEventListener("selectionchange", saveRange);
    }, [ menu?.editor ]);

    useEffect(() => {
        if (!menu) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ menu, close ]);

    if (!menu) return null;

    const { editor } = menu;

    function focusEditor() {
        if (!editor) return;

        editor.focus();
        const range = savedRangeRef.current;
        const selection = window.getSelection();
        if (range && selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    /** Focuses Excalidraw, whose copy, paste and key handlers act only while it has the focus. */
    function focusCanvas() {
        const container = rootRef.current?.querySelector<HTMLElement>(EXCALIDRAW_CONTAINER_SELECTOR);
        container?.focus({ preventScroll: true });
        return container ?? null;
    }

    function run(action: () => void) {
        close();
        action();
    }

    function copy() {
        if (editor) {
            focusEditor();
        } else {
            focusCanvas();
        }
        document.execCommand("copy");
    }

    function remove() {
        if (editor) {
            focusEditor();
            document.execCommand("delete");
        } else {
            pressKey(focusCanvas(), "Delete");
        }
    }

    async function paste() {
        if (!menu) return;

        const { clientX, clientY } = menu;
        close();
        const event = await readClipboardAsPasteEvent();
        if (!event) {
            toast.showError(t("canvas.touch_menu.paste_failed"));
            return;
        }

        if (editor) {
            focusEditor();
            editor.dispatchEvent(event);
            return;
        }

        const container = focusCanvas();
        // Excalidraw pastes at the pointer position it read last from a `pointermove` on the document.
        document.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY }));
        container?.dispatchEvent(event);
    }

    function applyColor(color: string | null) {
        close();
        if (editor) {
            focusEditor();
            document.execCommand("styleWithCSS", false, "true");
            document.execCommand("foreColor", false, color ?? DEFAULT_INK_COLOR);
            return;
        }

        const api = apiRef.current;
        if (api) applyStrokeColor(api, color);
    }

    return (
        <Popover
            className={clsx("canvas-touch-menu", rootRef.current?.dataset.canvasPage === "white" && "canvas-white-page")}
            placement="top"
            getAnchorRect={() => new DOMRect(menu.clientX, menu.clientY - FINGER_CLEARANCE_PX, 0, 2 * FINGER_CLEARANCE_PX)}
            updateKey={menu}
            onDismiss={close}
        >
            <div
                className="canvas-touch-menu-actions"
                role="toolbar"
                aria-label={t("canvas.touch_menu.label")}
                onPointerDown={keepFocus}
            >
                <Button kind="lowProfile" icon="bx-paste" text={t("canvas.touch_menu.paste")} onClick={() => void paste()} />
                {menu.hasSelection && <>
                    <Button kind="lowProfile" icon="bx-cut" text={t("canvas.touch_menu.cut")}
                        onClick={() => run(() => {
                            copy();
                            remove();
                        })} />
                    <Button kind="lowProfile" icon="bx-copy" text={t("canvas.touch_menu.copy")} onClick={() => run(copy)} />
                    <Button kind="lowProfile" icon="bx-trash" text={t("canvas.touch_menu.delete")} onClick={() => run(remove)} />
                    {!editor && (
                        <Button kind="lowProfile" icon="bx-duplicate" text={t("canvas.touch_menu.duplicate")}
                            onClick={() => run(() => pressKey(focusCanvas(), "d", isMac() ? { metaKey: true } : { ctrlKey: true }))} />
                    )}
                </>}
            </div>
            <div className="canvas-touch-menu-colors" onPointerDown={keepFocus}>
                <ColorPicker
                    currentValue={null}
                    presets={INK_COLORS.map((color) => color.value)}
                    onChange={applyColor}
                    tooltips={{ clear: t("canvas.touch_menu.default_color") }}
                />
            </div>
        </Popover>
    );
}

/** The selection of the scene, as Excalidraw keeps it in its app state. */
export interface SceneSelection {
    selectedElementIds: Record<string, true>;
    selectedGroupIds: Record<string, true>;
}

/**
 * The selection that a press at the scene point `x`, `y` makes. A press within the bounds of the
 * selection keeps it, a press on an element selects the element (its container for the text of a
 * shape, its outermost group for a grouped element) and a press on an empty spot selects nothing.
 */
export function getPressSelection(
    elements: readonly ExcalidrawElement[],
    state: Pick<AppState, "selectedElementIds" | "selectedGroupIds" | "zoom">,
    x: number,
    y: number
): SceneSelection {
    const tolerance = HIT_TOLERANCE_PX / state.zoom.value;
    const isHit = (candidates: readonly ExcalidrawElement[]) => {
        const [ minX, minY, maxX, maxY ] = getCommonBounds(candidates);
        return x >= minX - tolerance && x <= maxX + tolerance && y >= minY - tolerance && y <= maxY + tolerance;
    };

    const live = elements.filter((element) => !element.isDeleted);
    const selected = live.filter((element) => state.selectedElementIds[element.id]);
    if (selected.length && isHit(selected)) {
        return {
            selectedElementIds: toIdSet(selected.map((element) => element.id)),
            selectedGroupIds: toIdSet(Object.keys(state.selectedGroupIds).filter((id) => state.selectedGroupIds[id]))
        };
    }

    const hit = live.findLast((element) => !element.locked && isHit([ element ]));
    const target = hit && "containerId" in hit && hit.containerId
        ? live.find((element) => element.id === hit.containerId) ?? hit
        : hit;
    if (!target) {
        return { selectedElementIds: {}, selectedGroupIds: {} };
    }

    const groupId = target.groupIds.at(-1);
    if (!groupId) {
        return { selectedElementIds: { [target.id]: true }, selectedGroupIds: {} };
    }

    return {
        selectedElementIds: toIdSet(live.filter((element) => element.groupIds.includes(groupId)).map((element) => element.id)),
        selectedGroupIds: { [groupId]: true }
    };
}

/**
 * The clipboard as a `paste` event, as Excalidraw's own Paste builds it from
 * `navigator.clipboard.read()`, or `null` when the clipboard cannot be read.
 */
export async function readClipboardAsPasteEvent() {
    const data = new DataTransfer();
    try {
        for (const item of await navigator.clipboard.read()) {
            for (const type of item.types) {
                const blob = await item.getType(type);
                if (TEXT_MIME_TYPES.includes(type)) {
                    data.setData(type, await blob.text());
                } else if (type.startsWith("image/")) {
                    data.items.add(new File([ blob ], "pasted", { type }));
                }
            }
        }
    } catch {
        try {
            data.setData("text/plain", await navigator.clipboard.readText());
        } catch {
            return null;
        }
    }

    return new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
}

function openMenuFor(api: ExcalidrawImperativeAPI, { clientX, clientY, target }: LongPress, editor: HTMLElement | null): OpenMenu | null {
    if (editor?.contains(target)) {
        return { clientX, clientY, editor, selection: null, hasSelection: true };
    }
    if (!target.matches(INTERACTIVE_CANVAS_SELECTOR)) return null;

    const state = api.getAppState();
    // With another tool, a finger draws unless the pen took over drawing.
    if (state.viewModeEnabled || (state.activeTool.type !== "selection" && !state.penMode)) return null;

    const { sceneX, sceneY } = viewportToScene({ clientX, clientY }, state);
    const selection = getPressSelection(api.getSceneElements(), state, sceneX, sceneY);
    return {
        clientX, clientY, editor: null, selection,
        hasSelection: Object.keys(selection.selectedElementIds).length > 0
    };
}

function pressKey(target: HTMLElement | null, key: string, modifiers: KeyboardEventInit = {}) {
    target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
}

/** Keeps the focus, and the selected text of a rich text box, where it is while the menu is pressed. */
function keepFocus(e: TargetedPointerEvent<HTMLElement>) {
    if (!(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
    }
}

function toIdSet(ids: string[]): Record<string, true> {
    return Object.fromEntries(ids.map((id) => [ id, true as const ]));
}
