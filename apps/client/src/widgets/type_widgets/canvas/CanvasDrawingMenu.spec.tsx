import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Renders Excalidraw's own entries by name, and ours as buttons. */
const MainMenu = vi.hoisted(() => Object.assign(
    ({ children }: { children: ComponentChildren }) => <div className="menu">{children}</div>,
    {
        Item: ({ onSelect, children, selected, className }: {
            onSelect: () => void; children: ComponentChildren; selected?: boolean; className?: string;
        }) => (
            <button
                type="button"
                className={[ className, selected && "selected" ].filter(Boolean).join(" ") || undefined}
                onClick={onSelect}
            >{children}</button>
        ),
        Group: ({ title, children }: { title: string; children: ComponentChildren }) => (
            <section data-title={title}>{children}</section>
        ),
        Separator: () => <hr />,
        DefaultItems: Object.fromEntries([
            "LoadScene", "SaveAsImage", "SearchMenu", "Help", "ClearCanvas",
            "ChangeCanvasBackground", "Socials"
        ]
            .map((name) => [ name, () => <span>{name}</span> ]))
    }
));
vi.mock("@excalidraw/excalidraw", () => ({
    MainMenu,
    useI18n: () => ({ t: (key: string) => `t:${key}`, langCode: "en" })
}));

const { default: CanvasDrawingMenu, CanvasNoteMenu } = await import("./CanvasDrawingMenu");

describe("CanvasDrawingMenu", () => {
    let container: HTMLElement;
    let toggleSidebar: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        toggleSidebar = vi.fn();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(isEditable: boolean) {
        const apiRef = { current: { toggleSidebar } as unknown as ExcalidrawImperativeAPI };
        await act(async () => {
            render(<CanvasDrawingMenu apiRef={apiRef} isEditable={isEditable} />, container);
        });
        return [ ...container.querySelector(".menu")?.children ?? [] ]
            .map((item) => item.tagName === "HR" ? "|" : item.textContent);
    }

    it("offers opening, exporting, finding, the library and help", async () => {
        expect(await mount(true)).toEqual([
            "LoadScene", "SaveAsImage", "|", "t:search.title", "t:toolBar.library", "Help"
        ]);

        // Its own search entry shows no Ctrl+F, which "Search in note" takes in a drawing.
        const [ search, library ] = container.querySelectorAll("button");
        search?.click();
        expect(toggleSidebar).toHaveBeenLastCalledWith({
            name: "default", tab: "search", force: true
        });
        library?.click();
        expect(toggleSidebar).toHaveBeenLastCalledWith({ name: "default" });
    });

    it("leaves the library out of a drawing that cannot change", async () => {
        expect(await mount(false))
            .toEqual([ "LoadScene", "SaveAsImage", "|", "t:search.title", "Help" ]);
    });
});

describe("CanvasNoteMenu", () => {
    it("offers Excalidraw's default entries without its links", async () => {
        const container = document.createElement("div");
        await act(async () => {
            render(<CanvasNoteMenu />, container);
        });
        const items = [ ...container.querySelector(".menu")?.children ?? [] ]
            .map((item) => item.tagName === "HR" ? "|" : item.textContent);
        render(null, container);

        expect(items).toEqual([
            "LoadScene", "SaveAsImage", "SearchMenu", "Help", "ClearCanvas",
            "ChangeCanvasBackground"
        ]);
    });

    it("offers the rule lines of a note that can change, marking the current ones", async () => {
        const container = document.createElement("div");
        const onRuleLinesChange = vi.fn();
        await act(async () => {
            render(<CanvasNoteMenu ruleLines="college" onRuleLinesChange={onRuleLinesChange} />, container);
        });
        const buttons = [ ...container.querySelectorAll<HTMLButtonElement>("section button") ];
        const selected = [ ...container.querySelectorAll("section button.selected") ];

        expect(buttons).toHaveLength(4);
        expect(selected).toEqual([ buttons[2] ]);
        buttons[0]?.click();
        buttons[3]?.click();
        expect(onRuleLinesChange.mock.calls).toEqual([ [ null ], [ "wide" ] ]);
        render(null, container);
    });

    it("toggles the white page of a note that can change", async () => {
        const container = document.createElement("div");
        const onPaperChange = vi.fn();
        await act(async () => {
            render(<CanvasNoteMenu paper="white" onPaperChange={onPaperChange} />, container);
        });
        const button = container.querySelector<HTMLButtonElement>("button.canvas-paper-white");
        expect(button?.classList.contains("selected")).toBe(true);
        button?.click();

        await act(async () => {
            render(<CanvasNoteMenu paper={null} onPaperChange={onPaperChange} />, container);
        });
        const unselected = container.querySelector<HTMLButtonElement>("button.canvas-paper-white");
        expect(unselected?.classList.contains("selected")).toBe(false);
        unselected?.click();
        expect(onPaperChange.mock.calls).toEqual([ [ null ], [ "white" ] ]);
        render(null, container);
    });
});
