import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import useRuleLines, {
    getRuleLineLayout, parseCanvasPaper, parseRuleLineStyle, type RuleLineStyle
} from "./rule_lines";

describe("parseRuleLineStyle", () => {
    it("reads the known styles and nothing else", () => {
        expect(parseRuleLineStyle("college")).toBe("college");
        expect(parseRuleLineStyle("wide")).toBe("wide");
        expect(parseRuleLineStyle("")).toBeNull();
        expect(parseRuleLineStyle("grid")).toBeNull();
        expect(parseRuleLineStyle(null)).toBeNull();
    });
});

describe("parseCanvasPaper", () => {
    it("reads the white page and nothing else", () => {
        expect(parseCanvasPaper("white")).toBe("white");
        expect(parseCanvasPaper("")).toBeNull();
        expect(parseCanvasPaper("blue")).toBeNull();
        expect(parseCanvasPaper(undefined)).toBeNull();
    });
});

describe("getRuleLineLayout", () => {
    it("scales the spacing by the zoom and keeps the offset within one line", () => {
        expect(getRuleLineLayout(25, 0, 1)).toEqual({ size: 25, offset: 0 });
        expect(getRuleLineLayout(25, 30, 2)).toEqual({ size: 50, offset: 10 });
        // Scrolled up past the origin, the offset stays positive.
        expect(getRuleLineLayout(25, -30, 1)).toEqual({ size: 25, offset: 20 });
    });
});

describe("useRuleLines", () => {
    let container: HTMLElement;
    let onScrollChange: ((scrollX: number, scrollY: number, zoom: AppState["zoom"]) => void) | null;
    const apiRef = {
        current: { getAppState: () => ({ scrollY: 10, zoom: { value: 1 } }) } as unknown as ExcalidrawImperativeAPI
    };

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        onScrollChange = null;
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
    });

    function Harness({ style, isWhitePage = false }: { style: RuleLineStyle | null; isWhitePage?: boolean }) {
        const rootRef = useRef<HTMLDivElement>(null);
        onScrollChange = useRuleLines(rootRef, apiRef, style, isWhitePage);
        return <div ref={rootRef} className="root" />;
    }

    function mount(style: RuleLineStyle | null, isWhitePage = false) {
        act(() => {
            render(<Harness style={style} isWhitePage={isWhitePage} />, container);
        });
        const root = container.querySelector<HTMLElement>(".root");
        if (!root) throw new Error("harness did not render");
        return root;
    }

    it("marks the editor with the style and follows the scroll and zoom", () => {
        const root = mount("college");
        expect(root.dataset.ruleLines).toBe("college");
        expect(root.style.getPropertyValue("--canvas-rule-size")).toBe("25px");
        expect(root.style.getPropertyValue("--canvas-rule-offset")).toBe("10px");

        onScrollChange?.(0, 30, { value: 2 } as AppState["zoom"]);
        expect(root.style.getPropertyValue("--canvas-rule-size")).toBe("50px");
        expect(root.style.getPropertyValue("--canvas-rule-offset")).toBe("10px");
    });

    it("removes the lines when the style goes back to none", () => {
        mount("wide");
        const root = mount(null);
        expect(root.dataset.ruleLines).toBeUndefined();

        onScrollChange?.(0, 30, { value: 2 } as AppState["zoom"]);
        expect(root.style.getPropertyValue("--canvas-rule-size")).toBe("35px");
    });

    it("marks the editor with a white page, with or without rule lines", () => {
        expect(mount(null, true).dataset.canvasPage).toBe("white");
        const root = mount("narrow", true);
        expect(root.dataset.canvasPage).toBe("white");
        expect(root.dataset.ruleLines).toBe("narrow");
        expect(mount("narrow").dataset.canvasPage).toBeUndefined();
    });
});
