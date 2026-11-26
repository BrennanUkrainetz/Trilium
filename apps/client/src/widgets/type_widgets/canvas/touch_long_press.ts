import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

import { INTERACTIVE_CANVAS_SELECTOR } from "./click_to_type";

/**
 * How long, in milliseconds, a finger is held still for a long press. Shorter than Excalidraw's
 * `TOUCH_CTX_MENU_TIMEOUT` (500 ms), so the press is reported before Excalidraw opens its own
 * context menu.
 */
export const LONG_PRESS_DELAY_MS = 450;

/** How far, in pixels, a finger can move during a long press. */
export const LONG_PRESS_SLOP_PX = 8;

/** How long, in milliseconds, after the release the browser's `contextmenu` is still blocked. */
const CONTEXT_MENU_GRACE_MS = 1000;

/** A finger held still on the editor. */
export interface LongPress {
    clientX: number;
    clientY: number;
    target: Element;
}

export interface TouchLongPressHandlers {
    /**
     * Called once a single finger is held still. Returning `false` declines the press, which then
     * goes on as Excalidraw handles it.
     */
    onLongPress(press: LongPress): boolean | void;
    /** Called after the finger of an accepted press lifts, once Excalidraw handled the `pointerup`. */
    onRelease?(): void;
}

/**
 * Reports a single finger held still on the element of `rootRef`. The mouse and the pen are left
 * alone, as is a finger that moves or is joined by another, as in a pinch.
 *
 * For an accepted press, it keeps Excalidraw's touch context menu from opening, by dispatching
 * the `touchmove` that Excalidraw's `handleTouchMove()` reads as a moving finger, and blocks the
 * `contextmenu` event that the browser sends for the same press.
 */
export default function useTouchLongPress(rootRef: RefObject<HTMLElement | null>, handlers: TouchLongPressHandlers) {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const touches = new Set<number>();
        let pending: { pointerId: number; press: LongPress; timer: ReturnType<typeof setTimeout> } | null = null;
        let acceptedPointerId: number | null = null;
        let blockContextMenuUntil = 0;

        function cancelPending() {
            if (pending) clearTimeout(pending.timer);
            pending = null;
        }

        function fire() {
            if (!pending) return;

            const { pointerId, press } = pending;
            pending = null;
            if (handlersRef.current.onLongPress(press) === false) return;

            acceptedPointerId = pointerId;
            blockContextMenuUntil = Number.POSITIVE_INFINITY;
            root?.querySelector(INTERACTIVE_CANVAS_SELECTOR)?.dispatchEvent(new Event("touchmove", { bubbles: true }));
        }

        function onPointerDown(e: PointerEvent) {
            if (e.pointerType !== "touch") return;

            touches.add(e.pointerId);
            cancelPending();
            if (touches.size > 1 || !(e.target instanceof Element)) return;

            pending = {
                pointerId: e.pointerId,
                press: { clientX: e.clientX, clientY: e.clientY, target: e.target },
                timer: setTimeout(fire, LONG_PRESS_DELAY_MS)
            };
        }

        function onPointerMove(e: PointerEvent) {
            if (!pending || e.pointerId !== pending.pointerId) return;

            const { press } = pending;
            if (Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) > LONG_PRESS_SLOP_PX) {
                cancelPending();
            }
        }

        function onPointerEnd(e: PointerEvent) {
            if (e.pointerType !== "touch") return;

            touches.delete(e.pointerId);
            if (pending?.pointerId === e.pointerId) cancelPending();
            if (acceptedPointerId !== e.pointerId) return;

            acceptedPointerId = null;
            blockContextMenuUntil = Date.now() + CONTEXT_MENU_GRACE_MS;
            // Excalidraw changes the selection in its own `pointerup` handler, which runs after this one.
            setTimeout(() => handlersRef.current.onRelease?.());
        }

        function onContextMenu(e: Event) {
            if (Date.now() > blockContextMenuUntil) return;

            e.preventDefault();
            e.stopPropagation();
        }

        root.addEventListener("pointerdown", onPointerDown, { capture: true });
        root.addEventListener("pointermove", onPointerMove, { capture: true });
        root.addEventListener("contextmenu", onContextMenu, { capture: true });
        window.addEventListener("pointerup", onPointerEnd, { capture: true });
        window.addEventListener("pointercancel", onPointerEnd, { capture: true });
        return () => {
            cancelPending();
            root.removeEventListener("pointerdown", onPointerDown, { capture: true });
            root.removeEventListener("pointermove", onPointerMove, { capture: true });
            root.removeEventListener("contextmenu", onContextMenu, { capture: true });
            window.removeEventListener("pointerup", onPointerEnd, { capture: true });
            window.removeEventListener("pointercancel", onPointerEnd, { capture: true });
        };
    }, [ rootRef ]);
}
