import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({}));

const { default: useTouchLongPress, LONG_PRESS_DELAY_MS } = await import("./touch_long_press");
type LongPress = import("./touch_long_press").LongPress;
type TouchLongPressHandlers = import("./touch_long_press").TouchLongPressHandlers;

describe("useTouchLongPress", () => {
    let container: HTMLElement;
    let onLongPress: ReturnType<typeof vi.fn<(press: LongPress) => boolean | void>>;
    let onRelease: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        onLongPress = vi.fn<(press: LongPress) => boolean | void>();
        onRelease = vi.fn<() => void>();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
        vi.useRealTimers();
    });

    function Harness(handlers: TouchLongPressHandlers) {
        const rootRef = useRef<HTMLDivElement>(null);
        useTouchLongPress(rootRef, handlers);
        return (
            <div ref={rootRef}>
                <canvas className="excalidraw__canvas interactive" />
            </div>
        );
    }

    function mount() {
        act(() => {
            render(<Harness onLongPress={onLongPress} onRelease={onRelease} />, container);
        });
        const canvas = container.querySelector("canvas");
        if (!canvas) throw new Error("harness did not render");
        return canvas;
    }

    function pointer(target: Element, type: string, init: PointerEventInit) {
        act(() => {
            target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }));
        });
    }

    function wait(ms: number) {
        act(() => {
            vi.advanceTimersByTime(ms);
        });
    }

    it("reports a held finger once, then its release, and keeps Excalidraw's own menu shut", () => {
        const canvas = mount();
        const touchMoves = vi.fn();
        canvas.addEventListener("touchmove", touchMoves);

        pointer(canvas, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 80 });
        pointer(canvas, "pointermove", { pointerType: "touch", clientX: 104, clientY: 83 });
        wait(LONG_PRESS_DELAY_MS - 1);
        expect(onLongPress).not.toHaveBeenCalled();

        wait(1);
        expect(onLongPress).toHaveBeenCalledOnce();
        expect(onLongPress.mock.calls[0]?.[0]).toMatchObject({ clientX: 100, clientY: 80, target: canvas });
        expect(touchMoves).toHaveBeenCalledOnce();

        const menuEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        const excalidrawMenu = vi.fn();
        canvas.addEventListener("contextmenu", excalidrawMenu);
        act(() => {
            canvas.dispatchEvent(menuEvent);
        });
        expect(menuEvent.defaultPrevented).toBe(true);
        expect(excalidrawMenu).not.toHaveBeenCalled();

        pointer(canvas, "pointerup", { pointerType: "touch", clientX: 104, clientY: 83 });
        expect(onRelease).not.toHaveBeenCalled();
        wait(0);
        expect(onRelease).toHaveBeenCalledOnce();
        wait(LONG_PRESS_DELAY_MS * 4);
        expect(onLongPress).toHaveBeenCalledOnce();
    });

    it("ignores the mouse and the pen, a finger that moves and a second finger", () => {
        const canvas = mount();

        for (const pointerType of [ "mouse", "pen" ]) {
            pointer(canvas, "pointerdown", { pointerType, clientX: 10, clientY: 10 });
            wait(LONG_PRESS_DELAY_MS * 2);
            pointer(canvas, "pointerup", { pointerType, clientX: 10, clientY: 10 });
        }

        pointer(canvas, "pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
        pointer(canvas, "pointermove", { pointerType: "touch", clientX: 19, clientY: 10 });
        wait(LONG_PRESS_DELAY_MS * 2);
        pointer(canvas, "pointerup", { pointerType: "touch", clientX: 19, clientY: 10 });

        pointer(canvas, "pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
        pointer(canvas, "pointerdown", { pointerType: "touch", pointerId: 2, clientX: 60, clientY: 10 });
        wait(LONG_PRESS_DELAY_MS * 2);
        pointer(canvas, "pointerup", { pointerType: "touch", pointerId: 2, clientX: 60, clientY: 10 });
        pointer(canvas, "pointerup", { pointerType: "touch", clientX: 10, clientY: 10 });
        wait(0);

        expect(onLongPress).not.toHaveBeenCalled();
        expect(onRelease).not.toHaveBeenCalled();

        const menuEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        act(() => {
            canvas.dispatchEvent(menuEvent);
        });
        expect(menuEvent.defaultPrevented).toBe(false);
    });

    it("leaves the gesture alone when the press is declined", () => {
        const canvas = mount();
        const touchMoves = vi.fn();
        canvas.addEventListener("touchmove", touchMoves);
        onLongPress.mockReturnValue(false);

        pointer(canvas, "pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
        wait(LONG_PRESS_DELAY_MS);
        pointer(canvas, "pointerup", { pointerType: "touch", clientX: 10, clientY: 10 });
        wait(0);

        expect(onLongPress).toHaveBeenCalledOnce();
        expect(touchMoves).not.toHaveBeenCalled();
        expect(onRelease).not.toHaveBeenCalled();
    });
});
