import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useCallback, useEffect } from "preact/hooks";

/** The rule lines a canvas note can show behind its drawing, as named by `#canvasRuleLines`. */
export const RULE_LINE_STYLES = [ "narrow", "college", "wide" ] as const;
export type RuleLineStyle = typeof RULE_LINE_STYLES[number];

/**
 * The distance between two rule lines, in scene pixels. `college` matches the line height of
 * Excalidraw's default text (20 px at a line height of 1.25), so lines of text follow the rules.
 */
export const RULE_LINE_SPACING: Record<RuleLineStyle, number> = {
    narrow: 20,
    college: 25,
    wide: 35
};

/** The rule line style that a `#canvasRuleLines` value names, or `null` for none or an unknown one. */
export function parseRuleLineStyle(value: string | null | undefined): RuleLineStyle | null {
    return RULE_LINE_STYLES.find((style) => style === value) ?? null;
}

/** The pages a canvas note can show its drawing on, as named by `#canvasPaper`. */
export const CANVAS_PAPERS = [ "white" ] as const;
export type CanvasPaper = typeof CANVAS_PAPERS[number];

/** The page that a `#canvasPaper` value names, or `null` for the theme's own or an unknown one. */
export function parseCanvasPaper(value: string | null | undefined): CanvasPaper | null {
    return CANVAS_PAPERS.find((paper) => paper === value) ?? null;
}

/**
 * Keeps the rule lines of a canvas in step with its scroll and zoom, and marks a white page.
 * Returns the `onScrollChange` handler to pass to Excalidraw.
 *
 * The lines are a layer of `rootRef` (`::after` in `Canvas.css`) stacked over Excalidraw's static
 * canvas, which paints the background color, and under its interactive canvas and UI. The handler
 * writes CSS custom properties directly, so a pan does not render the editor again.
 */
export default function useRuleLines(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    style: RuleLineStyle | null,
    isWhitePage = false
) {
    const update = useCallback((scrollY: number, zoom: AppState["zoom"]) => {
        const root = rootRef.current;
        if (!root || !style) return;

        const { size, offset } = getRuleLineLayout(RULE_LINE_SPACING[style], scrollY, zoom.value);
        root.style.setProperty("--canvas-rule-size", `${size}px`);
        root.style.setProperty("--canvas-rule-offset", `${offset}px`);
    }, [ rootRef, style ]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        if (isWhitePage) {
            root.dataset.canvasPage = "white";
        } else {
            delete root.dataset.canvasPage;
        }
    }, [ rootRef, isWhitePage ]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        if (!style) {
            delete root.dataset.ruleLines;
            return;
        }

        root.dataset.ruleLines = style;
        const state = apiRef.current?.getAppState();
        update(state?.scrollY ?? 0, state?.zoom ?? { value: 1 as AppState["zoom"]["value"] });
    }, [ rootRef, apiRef, style, update ]);

    return useCallback((_scrollX: number, scrollY: number, zoom: AppState["zoom"]) => {
        update(scrollY, zoom);
    }, [ update ]);
}

/**
 * Where the rule lines fall on screen: their distance `size` and the `offset` of the first one
 * from the top of the editor, both in screen pixels. A line lies at every scene y that is a
 * multiple of `spacing`, which Excalidraw shows at `(y + scrollY) * zoom`.
 */
export function getRuleLineLayout(spacing: number, scrollY: number, zoom: number) {
    const size = spacing * zoom;
    const offset = ((scrollY * zoom) % size + size) % size;
    return { size, offset };
}
