import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { getCanvasRichTextHtml } from "@triliumnext/commons/src/lib/canvas_rich_text.js";

import { createRichTextElement, insertRichTextElement } from "./rich_text";
import { applyTextEdit, getListEditForKey } from "./text_lists";

/** How far, in pixels, the pointer can move between press and release for a click. */
const CLICK_SLOP_PX = 4;

/** How many frames to wait for Excalidraw's text editor to show after the double click. */
const MAX_EDITOR_WAIT_FRAMES = 30;

export const INTERACTIVE_CANVAS_SELECTOR = "canvas.excalidraw__canvas.interactive";
export const TEXT_EDITOR_SELECTOR = "textarea.excalidraw-wysiwyg";

const MODIFIER_KEYS = [ "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock" ];

/** Where the caret blinks after a click on an empty spot, relative to the editor root. */
export interface CaretPosition {
    left: number;
    top: number;
    height: number;
}

export interface ClickToTypeOptions {
    /** Whether a click on an empty spot followed by typing creates a text element there. */
    clickToType: boolean;
    /** Whether Enter, Backspace, Space, Ctrl+. and Ctrl+/ edit lists in a text element. */
    smartLists: boolean;
    /**
     * Whether typing at a spot creates a rich text box, which takes formatting, rather than one of
     * Excalidraw's text elements.
     */
    richText?: boolean;
}

/**
 * OneNote-style typing on a canvas: a click on an empty spot followed by typing puts text there,
 * without the text tool or a double click, and lists in text elements behave as in OneNote.
 * Typing while a single rich text box is selected types into it.
 *
 * With `richText`, the first key creates a rich text box at the spot. Otherwise, as Excalidraw has
 * no API to start editing text at a point, it dispatches a `dblclick` on the spot, which
 * `handleCanvasDoubleClick()` answers with a new text element. Keys typed before either editor
 * mounts are buffered and inserted once it does.
 */
export default function useClickToType(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    { clickToType, smartLists, richText = false }: ClickToTypeOptions
) {
    const [ caret, setCaret ] = useState<CaretPosition | null>(null);
    const armedRef = useRef<ScenePoint | null>(null);
    const pressRef = useRef<{ clientX: number; clientY: number } | null>(null);
    /** The characters typed while the editor mounts, or `null` when no editor is pending. */
    const pendingTextRef = useRef<string | null>(null);

    const disarm = useCallback(() => {
        armedRef.current = null;
        setCaret(null);
    }, []);

    useEffect(() => {
        if (!clickToType) {
            disarm();
        }
    }, [ clickToType, disarm ]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || (!clickToType && !smartLists)) {
            return;
        }

        let frame: number | null = null;
        let isUnmounted = false;

        function arm(clientX: number, clientY: number) {
            const api = apiRef.current;
            if (!api || !root) return;

            const state = api.getAppState();
            if (!isIdleOnEmptySpot(state)) {
                disarm();
                return;
            }

            armedRef.current = viewportToScene({ clientX, clientY }, state);
            const rootRect = root.getBoundingClientRect();
            setCaret({
                left: clientX - rootRect.left,
                top: clientY - rootRect.top,
                height: Math.max(8, state.currentItemFontSize * state.zoom.value * 1.25)
            });
        }

        function flushPendingText(editor: HTMLElement) {
            const text = pendingTextRef.current ?? "";
            pendingTextRef.current = null;
            editor.focus();
            if (!text) return;

            if (editor instanceof HTMLTextAreaElement) {
                const end = editor.value.length;
                const caretIndex = end + text.length;
                applyTextEdit(editor, { start: end, end, text, selectionStart: caretIndex, selectionEnd: caretIndex });
            } else {
                document.execCommand("insertText", false, text);
            }
        }

        function waitForEditor(selector: string, framesLeft: number) {
            frame = null;
            if (isUnmounted || !root) return;

            const editor = root.querySelector<HTMLElement>(selector);
            if (editor) {
                flushPendingText(editor);
            } else if (framesLeft > 0) {
                frame = requestAnimationFrame(() => waitForEditor(selector, framesLeft - 1));
            } else {
                pendingTextRef.current = null;
            }
        }

        function typeIntoRichText(elementId: string, firstCharacter: string) {
            pendingTextRef.current = firstCharacter;
            waitForEditor(getRichTextEditorSelector(elementId), MAX_EDITOR_WAIT_FRAMES);
        }

        function startTyping(firstCharacter: string) {
            const api = apiRef.current;
            const point = armedRef.current;
            const canvas = root?.querySelector(INTERACTIVE_CANVAS_SELECTOR);
            disarm();
            if (!api || !point || !canvas) return;

            const state = api.getAppState();
            if (!isIdleOnEmptySpot(state)) return;

            if (richText) {
                const element = createRichTextElement(point.sceneX, point.sceneY);
                insertRichTextElement(api, element);
                typeIntoRichText(element.id, firstCharacter);
                return;
            }

            // The spot is converted back from scene coordinates, so it follows a pan since the click.
            const { clientX, clientY } = sceneToViewport(point, state);
            pendingTextRef.current = firstCharacter;
            canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY }));
            waitForEditor(TEXT_EDITOR_SELECTOR, MAX_EDITOR_WAIT_FRAMES);
        }

        /** Opens the single selected rich text box for typing. Returns whether there was one. */
        function startTypingIntoSelection(firstCharacter: string) {
            const api = apiRef.current;
            if (!api) return false;

            const state = api.getAppState();
            const selectedIds = Object.keys(state.selectedElementIds).filter((id) => state.selectedElementIds[id]);
            if (selectedIds.length !== 1 || state.activeEmbeddable || state.editingTextElement) return false;

            const element = api.getSceneElements().find((candidate) => candidate.id === selectedIds[0]);
            if (!element || element.type !== "embeddable" || getCanvasRichTextHtml(element) === null) return false;

            api.updateScene({ appState: { activeEmbeddable: { element, state: "active" } } });
            typeIntoRichText(element.id, firstCharacter);
            return true;
        }

        function onPointerDown(e: PointerEvent) {
            disarm();
            const isCanvas = e.target instanceof Element && e.target.matches(INTERACTIVE_CANVAS_SELECTOR);
            const isPlainClick = e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
            pressRef.current = clickToType && isCanvas && isPlainClick
                ? { clientX: e.clientX, clientY: e.clientY }
                : null;
        }

        function onPointerUp(e: PointerEvent) {
            const press = pressRef.current;
            pressRef.current = null;
            if (!press || Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) > CLICK_SLOP_PX) {
                return;
            }

            // Excalidraw updates the selection in its own `pointerup` handler, which runs after this one.
            const { clientX, clientY } = e;
            setTimeout(() => {
                if (!isUnmounted) arm(clientX, clientY);
            });
        }

        function onKeyDown(e: KeyboardEvent) {
            if (e.target instanceof HTMLTextAreaElement && e.target.matches(TEXT_EDITOR_SELECTOR)) {
                const edit = smartLists ? getListEditForKey(e, e.target) : null;
                if (edit) {
                    // Stopping the event in the capture phase keeps it from the editor's `onkeydown`.
                    e.preventDefault();
                    e.stopPropagation();
                    applyTextEdit(e.target, edit);
                }
                return;
            }

            if (pendingTextRef.current !== null) {
                if (isTypingKey(e) || e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    pendingTextRef.current += e.key === "Enter" ? "\n" : e.key;
                }
                return;
            }

            if (isEditableTarget(e.target)) {
                return;
            }

            if (!armedRef.current) {
                if (clickToType && isTypingKey(e) && startTypingIntoSelection(e.key)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }

            if (isTypingKey(e)) {
                // Stopping the event keeps Excalidraw from reading the letter as a tool shortcut.
                e.preventDefault();
                e.stopPropagation();
                startTyping(e.key);
            } else if (!MODIFIER_KEYS.includes(e.key)) {
                disarm();
            }
        }

        root.addEventListener("pointerdown", onPointerDown, { capture: true });
        root.addEventListener("pointerup", onPointerUp, { capture: true });
        root.addEventListener("wheel", disarm, { capture: true, passive: true });
        root.addEventListener("keydown", onKeyDown, { capture: true });
        return () => {
            isUnmounted = true;
            if (frame !== null) cancelAnimationFrame(frame);
            pendingTextRef.current = null;
            root.removeEventListener("pointerdown", onPointerDown, { capture: true });
            root.removeEventListener("pointerup", onPointerUp, { capture: true });
            root.removeEventListener("wheel", disarm, { capture: true });
            root.removeEventListener("keydown", onKeyDown, { capture: true });
        };
    }, [ rootRef, apiRef, clickToType, smartLists, richText, disarm ]);

    return caret;
}

interface ScenePoint {
    sceneX: number;
    sceneY: number;
}

type ViewState = Pick<AppState, "scrollX" | "scrollY" | "zoom" | "offsetLeft" | "offsetTop">;

/** Converts a point on the screen into scene coordinates, as Excalidraw's `viewportCoordsToSceneCoords()` does. */
export function viewportToScene({ clientX, clientY }: { clientX: number; clientY: number }, state: ViewState): ScenePoint {
    return {
        sceneX: (clientX - state.offsetLeft) / state.zoom.value - state.scrollX,
        sceneY: (clientY - state.offsetTop) / state.zoom.value - state.scrollY
    };
}

/** Converts a point of the scene into screen coordinates, the inverse of `viewportToScene()`. */
export function sceneToViewport({ sceneX, sceneY }: ScenePoint, state: ViewState) {
    return {
        clientX: (sceneX + state.scrollX) * state.zoom.value + state.offsetLeft,
        clientY: (sceneY + state.scrollY) * state.zoom.value + state.offsetTop
    };
}

/**
 * Whether `event` types one printable character with no Ctrl, Cmd or Alt. AltGr, which Windows
 * reports as Ctrl and Alt, counts as typing. Space is excluded because Excalidraw pans while it is
 * held.
 */
export function isTypingKey(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229 || event.key === " ") {
        return false;
    }
    if ([ ...event.key ].length !== 1) {
        return false;
    }
    if (event.getModifierState?.("AltGraph")) {
        return true;
    }
    return !event.ctrlKey && !event.metaKey && !event.altKey;
}

function getRichTextEditorSelector(elementId: string) {
    return `.canvas-rich-text[data-rich-text-id="${CSS.escape(elementId)}"][contenteditable="true"]`;
}

function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable='true']");
}

/** Whether nothing is selected, drawn or edited, which means a click landed on an empty spot. */
function isIdleOnEmptySpot(state: AppState) {
    return state.activeTool.type === "selection"
        && !state.viewModeEnabled
        && !state.editingTextElement
        && !state.newElement
        && !state.multiElement
        && !Object.values(state.selectedElementIds).some(Boolean);
}
