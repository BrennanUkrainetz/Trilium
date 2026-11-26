import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import useInkProperties, { isInkSelection } from "./ink_properties";

type InkState = Pick<AppState, "activeTool" | "selectedElementIds">;

describe("isInkSelection", () => {
    const elements = [
        createElement("a", "freedraw"),
        createElement("b", "freedraw"),
        createElement("c", "rectangle"),
        createElement("d", "freedraw", true)
    ];

    it("holds for a selection of pen strokes only", () => {
        expect(isInkSelection(createState("selection", [ "a" ]), elements)).toBe(true);
        expect(isInkSelection(createState("selection", [ "a", "b" ]), elements)).toBe(true);
        expect(isInkSelection(createState("freedraw", [ "a", "b" ]), elements)).toBe(true);
        // A deleted element keeps no place in the panel.
        expect(isInkSelection(createState("selection", [ "a", "d" ]), elements)).toBe(true);

        expect(isInkSelection(createState("selection", [ "a", "c" ]), elements)).toBe(false);
        expect(isInkSelection(createState("selection", [ "c" ]), elements)).toBe(false);
        expect(isInkSelection(createState("selection", [ "d" ]), elements)).toBe(false);
        // The rectangle tool fills the shape it draws next.
        expect(isInkSelection(createState("rectangle", [ "a" ]), elements)).toBe(false);
    });

    it("holds for the pen tool with nothing selected", () => {
        expect(isInkSelection(createState("freedraw", []), elements)).toBe(true);
        expect(isInkSelection({
            activeTool: { type: "freedraw" },
            selectedElementIds: { a: false }
        } as unknown as InkState, elements)).toBe(true);

        expect(isInkSelection(createState("selection", []), elements)).toBe(false);
        expect(isInkSelection(createState("ellipse", []), elements)).toBe(false);
    });
});

describe("useInkProperties", () => {
    let container: HTMLElement;
    let state: InkState;
    let elements: ExcalidrawElement[];
    let listeners: ((elements: readonly ExcalidrawElement[], state: AppState) => void)[];
    let apiRef: { current: ExcalidrawImperativeAPI | null };

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        elements = [ createElement("a", "freedraw"), createElement("c", "rectangle") ];
        state = createState("selection", []);
        listeners = [];
        apiRef = { current: null };
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    function createApi() {
        return {
            getAppState: () => state,
            getSceneElementsIncludingDeleted: () => elements,
            onChange: (listener: (typeof listeners)[number]) => {
                listeners.push(listener);
                return () => {
                    listeners = listeners.filter((other) => other !== listener);
                };
            }
        } as unknown as ExcalidrawImperativeAPI;
    }

    function change(next: InkState) {
        state = next;
        for (const listener of listeners) {
            listener(elements, state as AppState);
        }
    }

    function mount() {
        function Harness() {
            const rootRef = useRef<HTMLDivElement>(null);
            useInkProperties(rootRef, apiRef);
            return <div ref={rootRef} className="canvas-render" />;
        }
        act(() => render(<Harness />, container));
        const root = container.querySelector<HTMLElement>(".canvas-render");
        if (!root) throw new Error("The root did not render.");
        return root;
    }

    it("marks the root while the selection holds only pen strokes", () => {
        apiRef.current = createApi();
        state = createState("freedraw", []);
        const root = mount();
        expect(root.dataset.inkSelection).toBe("");

        change(createState("selection", [ "c" ]));
        expect(root.dataset.inkSelection).toBeUndefined();
        change(createState("selection", [ "a" ]));
        expect(root.dataset.inkSelection).toBe("");
        change(createState("selection", [ "a", "c" ]));
        expect(root.dataset.inkSelection).toBeUndefined();

        change(createState("selection", [ "a" ]));
        act(() => render(null, container));
        expect(listeners).toHaveLength(0);
        expect(root.dataset.inkSelection).toBeUndefined();
    });

    it("follows the editor that mounts after the hook", () => {
        const root = mount();
        expect(listeners).toHaveLength(0);

        apiRef.current = createApi();
        state = createState("selection", [ "a" ]);
        root.dispatchEvent(new Event("pointerover", { bubbles: true }));
        expect(listeners).toHaveLength(1);
        expect(root.dataset.inkSelection).toBe("");

        // A second pointer over the root keeps the one subscription.
        root.dispatchEvent(new Event("pointerover", { bubbles: true }));
        expect(listeners).toHaveLength(1);
    });
});

/**
 * Checks `InkProperties.css` against Excalidraw's properties panel as `SelectedShapeActions`
 * renders it for two pen strokes with a fill: beside the drawing and in the phone layout's sheet.
 * The Next theme and Excalidraw's own stylesheet load after it, as they can in the app.
 */
describe("InkProperties.css", () => {
    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    it("hides the background, the fill and the alignment of a selection of pen strokes", () => {
        const panels = renderPanels(true);
        for (const panel of panels) {
            expect(getShownGroups(panel)).toEqual([
                "stroke", "strokeWidth", "opacity", "layers", "actions"
            ]);
        }
    });

    it("shows every group for any other selection", () => {
        for (const panel of renderPanels(false)) {
            expect(getShownGroups(panel)).toEqual([
                "stroke", "background", "fill", "strokeWidth", "opacity", "layers", "align",
                "actions"
            ]);
        }
    });
});

function createElement(id: string, type: ExcalidrawElement["type"], isDeleted = false) {
    return { id, type, isDeleted } as ExcalidrawElement;
}

function createState(tool: string, selected: string[]) {
    return {
        activeTool: { type: tool },
        selectedElementIds: Object.fromEntries(selected.map((id) => [ id, true ]))
    } as unknown as InkState;
}

function renderPanels(isInk: boolean) {
    const entry = createRequire(import.meta.url).resolve("@excalidraw/excalidraw");
    const excalidrawStyles = readFileSync(join(dirname(entry), "..", "prod", "index.css"), "utf8");
    // Vitest gives an empty string for a stylesheet imported with `?raw`.
    const inkStyles = readFileSync(join(__dirname, "InkProperties.css"), "utf8");
    const themeStyles = readFileSync(
        join(__dirname, "../../../stylesheets/theme-next/notes/canvas.css"), "utf8");
    document.head.innerHTML = `<style>${inkStyles}</style><style>${themeStyles}</style>
        <style>${excalidrawStyles}</style>`;

    const groups = getGroups();
    document.body.innerHTML = `<div class="canvas-render"${isInk ? " data-ink-selection" : ""}>
        <div class="excalidraw">
            <div class="Island App-menu__left">${groups}</div>
            <div class="App-bottom-bar">
                <div class="Island">
                    <section class="App-mobile-menu">
                        <h2 class="visually-hidden">Selected shape actions</h2>
                        ${groups}
                    </section>
                </div>
            </div>
        </div>
    </div>`;
    return [ ...document.querySelectorAll(".App-menu__left, .App-mobile-menu") ];
}

/** The groups of `SelectedShapeActions`, each named in `data-group` for the assertions. */
function getGroups() {
    const picker = (picks: string[]) => `<div role="dialog" aria-modal="true"
            class="color-picker-container">
        <div class="color-picker__top-picks">
            ${picks.map((color) => `<button class="color-picker__button" type="button"
                data-testid="color-top-pick-${color}"></button>`).join("")}
        </div>
        <div></div>
        <button type="button" class="color-picker__button active-color properties-trigger">
        </button>
    </div>`;
    const button = (title: string) => `<button type="button"
        class="ToolIcon_type_button ToolIcon_size_medium ToolIcon_type_button--show ToolIcon"
        title="${title}" aria-label="${title}"></button>`;
    return `<div class="panelColumn">
        <div data-group="stroke"><h3 aria-hidden="true">Stroke</h3>
            <div>${picker([ "#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00" ])}</div>
        </div>
        <div data-group="background"><h3 aria-hidden="true">Background</h3>
            <div>${picker([ "transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99" ])}</div>
        </div>
        <fieldset data-group="fill"><legend>Fill</legend><div class="buttonList">
            <button type="button" data-testid="fill-hachure"></button>
            <button type="button" data-testid="fill-cross-hatch"></button>
            <button type="button" data-testid="fill-solid"></button>
        </div></fieldset>
        <fieldset data-group="strokeWidth"><legend>Stroke width</legend><div class="buttonList">
            <button type="button" data-testid="strokeWidth-thin"></button>
        </div></fieldset>
        <label data-group="opacity" class="control-label">Opacity<div class="range-wrapper">
        </div></label>
        <fieldset data-group="layers"><legend>Layers</legend><div class="buttonList">
            <button type="button" class="zIndexButton"></button>
            <button type="button" class="zIndexButton"></button>
        </div></fieldset>
        <fieldset data-group="align"><legend>Align</legend><div class="buttonList">
            ${button("Align left")}${button("Center horizontally")}${button("Align right")}
            <div style="flex-basis: 100%; height: 0px;"></div>
            <div style="display: flex; flex-wrap: wrap; gap: .5rem; margin-top: -0.5rem;">
                ${button("Align top")}${button("Center vertically")}${button("Align bottom")}
            </div>
        </div></fieldset>
        <fieldset data-group="actions"><legend>Actions</legend><div class="buttonList">
            ${button("Duplicate")}${button("Delete")}${button("Group selection")}
        </div></fieldset>
    </div>`;
}

function getShownGroups(panel: Element) {
    return [ ...panel.querySelectorAll<HTMLElement>(".panelColumn > [data-group]") ]
        .filter((group) => getComputedStyle(group).display !== "none")
        .map((group) => group.dataset.group);
}
