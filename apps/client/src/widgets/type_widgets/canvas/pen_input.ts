import "./PenInput.css";

import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { flushSync } from "preact/compat";
import { useEffect } from "preact/hooks";

import { INTERACTIVE_CANVAS_SELECTOR } from "./click_to_type";
import { applyLassoSelection, hasSelection, hitsSelection, isLassoTool, startLasso } from "./lasso";

/** How long after the barrel button is released a `contextmenu` event is still swallowed. */
const CONTEXT_MENU_GRACE_MS = 600;

const SECONDARY_BUTTON = 2;
const ERASER_BUTTON = 5;
const SECONDARY_BUTTONS_MASK = 2;
const ERASER_BUTTONS_MASK = 32;

/** The CSS custom property that holds the dot cursor of the pen tools. */
export const PEN_CURSOR_PROPERTY = "--canvas-pen-cursor";

type ToolSpec = Parameters<ExcalidrawImperativeAPI["setActiveTool"]>[0];

export interface PenInputOptions {
    /** Whether the drawing can be edited, which enables selecting with the pen's barrel button. */
    isEditable: boolean;
}

/**
 * OneNote-style pen input on a canvas:
 *
 * - The pen tools (`freedraw`, which the highlighter uses too) show a small dot in the stroke
 *   color instead of Excalidraw's crosshair, and the lasso of `useLassoTool()` a crosshair.
 *   `PenInput.css` applies it over the inline cursor that `setCursorForShape()` writes on the
 *   interactive canvas.
 * - Dragging with the barrel button of a pen held draws a lasso, which Excalidraw never sees, and
 *   selects what lies mostly inside it with the selection tool. The previous tool comes back on
 *   the next pen press outside the selection, so the selection can first be moved with the tip.
 *   When the lasso selects nothing, the tool stays as it was. The `contextmenu` event that Windows
 *   sends for the barrel button is swallowed.
 *
 * The tail eraser (`button` 5) passes through untouched, as Excalidraw handles it itself.
 */
export default function usePenInput(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    { isEditable }: PenInputOptions
) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const relayedEvents = new WeakSet<Event>();
        let subscribedApi: ExcalidrawImperativeAPI | null = null;
        let unsubscribe: (() => void) | null = null;
        let cursor: string | null = null;
        let cancelLasso: (() => void) | null = null;
        let pendingRestoreTool: ToolSpec | null = null;
        let suppressMenuUntil = 0;

        function syncCursor(state: AppState) {
            if (!root) return;
            const next = getPenCursor(state);
            if (next === cursor) return;

            cursor = next;
            if (next) {
                root.dataset.penCursor = "";
                root.style.setProperty(PEN_CURSOR_PROPERTY, next);
            } else {
                delete root.dataset.penCursor;
                root.style.removeProperty(PEN_CURSOR_PROPERTY);
            }
        }

        /** Follows the app state of the editor, which mounts after this effect runs. */
        function subscribe() {
            const api = apiRef.current;
            if (!api || api === subscribedApi) return;

            unsubscribe?.();
            subscribedApi = api;
            unsubscribe = api.onChange((_elements, state) => syncCursor(state));
            syncCursor(api.getAppState());
        }

        /** Keeps `event` from Excalidraw, switches the tool, then hands Excalidraw a copy of it. */
        function relay(event: PointerEvent, switchTool: () => void, overrides: PointerEventInit = {}) {
            const target = event.target;
            if (!target) return;

            event.preventDefault();
            event.stopPropagation();
            // `App.handleCanvasPointerDown()` reads the tool from its state, so it must be rendered first.
            flushSync(switchTool);
            const copy = copyPointerEvent(event, overrides);
            relayedEvents.add(copy);
            target.dispatchEvent(copy);
        }

        function onPointerDown(e: PointerEvent) {
            if (relayedEvents.has(e)) return;
            subscribe();

            const api = apiRef.current;
            const isCanvas = e.target instanceof Element && e.target.matches(INTERACTIVE_CANVAS_SELECTOR);
            if (!api || !isEditable || !isCanvas) return;
            if (e.pointerType !== "pen") {
                pendingRestoreTool = null;
                return;
            }
            if (e.button === ERASER_BUTTON || e.buttons & ERASER_BUTTONS_MASK) return;

            const state = api.getAppState();
            if (state.viewModeEnabled) return;

            if (isBarrelPress(e)) {
                e.preventDefault();
                e.stopPropagation();
                if (!root || cancelLasso) return;

                const isSelecting = state.activeTool.type === "selection";
                const restoreTool = isSelecting ? pendingRestoreTool : toToolSpec(state.activeTool);
                pendingRestoreTool = null;
                cancelLasso = startLasso(root, api, e, (selection) => {
                    cancelLasso = null;
                    suppressMenuUntil = performance.now() + CONTEXT_MENU_GRACE_MS;
                    if (selection && hasSelection(selection)) {
                        applyLassoSelection(api, selection);
                        pendingRestoreTool = restoreTool;
                    } else if (isSelecting && restoreTool) {
                        api.setActiveTool(restoreTool);
                    }
                });
                return;
            }

            const restoreTool = pendingRestoreTool;
            if (e.button !== 0 || !restoreTool) return;
            if (state.activeTool.type !== "selection") {
                pendingRestoreTool = null;
                return;
            }
            if (hitsSelection(api, state, e)) return;

            pendingRestoreTool = null;
            relay(e, () => api.setActiveTool(restoreTool));
        }

        function onContextMenu(e: MouseEvent) {
            const isPenSecondary = "pointerType" in e && e.pointerType === "pen" && e.button === SECONDARY_BUTTON;
            if (cancelLasso || performance.now() < suppressMenuUntil || (isEditable && isPenSecondary)) {
                e.preventDefault();
                e.stopPropagation();
            }
        }

        subscribe();
        root.addEventListener("pointerover", subscribe, { capture: true });
        root.addEventListener("pointerdown", onPointerDown, { capture: true });
        root.addEventListener("contextmenu", onContextMenu, { capture: true });
        return () => {
            unsubscribe?.();
            cancelLasso?.();
            delete root.dataset.penCursor;
            root.style.removeProperty(PEN_CURSOR_PROPERTY);
            root.removeEventListener("pointerover", subscribe, { capture: true });
            root.removeEventListener("pointerdown", onPointerDown, { capture: true });
            root.removeEventListener("contextmenu", onContextMenu, { capture: true });
        };
    }, [ rootRef, apiRef, isEditable ]);
}

/**
 * Returns the CSS `cursor` value shown while the pen tools or the lasso are active, or `null` for
 * the other tools. In the dark theme, Excalidraw shows the drawing through `--theme-filter`, so the
 * dot of the pen tools takes the color the stroke is shown in rather than the one it is saved with.
 */
export function getPenCursor(state: Pick<AppState, "activeTool" | "viewModeEnabled" | "theme" | "currentItemStrokeColor">) {
    if (state.viewModeEnabled) return null;
    if (isLassoTool(state.activeTool)) return "crosshair";
    if (state.activeTool.type !== "freedraw") return null;

    const color = state.theme === "dark"
        ? applyDarkThemeFilter(state.currentItemStrokeColor)
        : state.currentItemStrokeColor;
    // The gray ring keeps the dot visible on both themes and for an ink that matches the background.
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'>"
        + `<circle cx='4' cy='4' r='2.5' fill='${color}' stroke='rgba(128,128,128,0.85)' stroke-width='1'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 4, crosshair`;
}

/**
 * Applies Excalidraw's dark theme filter, `invert(93%) hue-rotate(180deg)`, to a hex color, with
 * the matrices of the Filter Effects specification. Returns other colors unchanged.
 */
export function applyDarkThemeFilter(color: string) {
    const rgb = parseHexColor(color);
    if (!rgb) return color;

    const [ r, g, b ] = rgb.map((channel) => channel * 0.07 + (1 - channel) * 0.93);
    const rotated = [
        -0.574 * r + 1.43 * g + 0.144 * b,
        0.426 * r + 0.43 * g + 0.144 * b,
        0.426 * r + 1.43 * g - 0.856 * b
    ];
    return `#${rotated.map((channel) => toHexByte(channel)).join("")}`;
}

/**
 * Whether `event` presses the barrel button of a pen, which Windows Ink reports as the secondary
 * button, alone or together with the tip.
 */
function isBarrelPress(event: PointerEvent) {
    return event.button === SECONDARY_BUTTON || (event.button === 0 && (event.buttons & SECONDARY_BUTTONS_MASK) !== 0);
}

function toToolSpec(activeTool: AppState["activeTool"]): ToolSpec {
    if (activeTool.type === "custom" && activeTool.customType) {
        return { type: "custom", customType: activeTool.customType, locked: activeTool.locked };
    }
    return { type: activeTool.type, locked: activeTool.locked } as ToolSpec;
}

function copyPointerEvent(event: PointerEvent, overrides: PointerEventInit) {
    return new PointerEvent(event.type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        width: event.width,
        height: event.height,
        pressure: event.pressure,
        tangentialPressure: event.tangentialPressure,
        tiltX: event.tiltX,
        tiltY: event.tiltY,
        twist: event.twist,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        button: event.button,
        buttons: event.buttons,
        ...overrides
    });
}

function parseHexColor(color: string) {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!match) return null;

    const hex = match[1].length === 3 ? [ ...match[1] ].map((digit) => digit + digit).join("") : match[1];
    return [ 0, 2, 4 ].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
}

function toHexByte(channel: number) {
    return Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0");
}
