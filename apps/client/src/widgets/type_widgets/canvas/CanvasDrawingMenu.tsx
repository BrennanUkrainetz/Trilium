import { MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";

import { t as tTrilium } from "../../../services/i18n";
import Icon from "../../react/Icon";
import { DEFAULT_SIDEBAR, SEARCH_TAB, useExcalidrawTranslation } from "./CanvasEmbedTools";
import { type CanvasPaper, RULE_LINE_STYLES, type RuleLineStyle } from "./rule_lines";

interface CanvasDrawingMenuProps {
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    isEditable: boolean;
}

/** The main menu of Excalidraw in a canvas drawing. Renders inside `<Excalidraw>`. */
export default function CanvasDrawingMenu({ apiRef, isEditable }: CanvasDrawingMenuProps) {
    const { t } = useExcalidrawTranslation();

    return (
        <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Separator />
            <MainMenu.Item
                icon={<Icon icon="bx bx-search" />}
                onSelect={() => apiRef.current?.toggleSidebar({
                    name: DEFAULT_SIDEBAR, tab: SEARCH_TAB, force: true
                })}
            >
                {t("search.title")}
            </MainMenu.Item>
            {isEditable && (
                <MainMenu.Item
                    icon={<Icon icon="bx bx-library" />}
                    onSelect={() => apiRef.current?.toggleSidebar({ name: DEFAULT_SIDEBAR })}
                >
                    {t("toolBar.library")}
                </MainMenu.Item>
            )}
            <MainMenu.DefaultItems.Help />
        </MainMenu>
    );
}

const RULE_LINE_LABELS: Record<RuleLineStyle | "none", string> = {
    none: "canvas.rule_lines_none",
    narrow: "canvas.rule_lines_narrow",
    college: "canvas.rule_lines_college",
    wide: "canvas.rule_lines_wide"
};

interface CanvasNoteMenuProps {
    /** The rule lines the note shows, or `null` for none. */
    ruleLines?: RuleLineStyle | null;
    /** Changes the rule lines of the note. Without it, the menu offers no rule lines. */
    onRuleLinesChange?: (style: RuleLineStyle | null) => void;
    /** The page the note shows its drawing on, or `null` for the one of the theme. */
    paper?: CanvasPaper | null;
    /** Changes the page of the note. Without it, the menu offers no white page. */
    onPaperChange?: (paper: CanvasPaper | null) => void;
}

/** The main menu of Excalidraw in a canvas note or a canvas slide. Renders inside `<Excalidraw>`. */
export function CanvasNoteMenu({
    ruleLines = null, onRuleLinesChange, paper = null, onPaperChange
}: CanvasNoteMenuProps = {}) {
    return (
        <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            {onPaperChange && (
                <MainMenu.Item
                    className="canvas-paper-white"
                    icon={<Icon icon={paper === "white" ? "bx bx-check" : "bx bx-empty"} />}
                    selected={paper === "white"}
                    onSelect={() => onPaperChange(paper === "white" ? null : "white")}
                >
                    {tTrilium("canvas.paper_white")}
                </MainMenu.Item>
            )}
            {onRuleLinesChange && (
                <MainMenu.Group title={tTrilium("canvas.rule_lines")} className="canvas-rule-lines-menu">
                    {[ null, ...RULE_LINE_STYLES ].map((style) => (
                        <MainMenu.Item
                            key={style ?? "none"}
                            icon={<Icon icon={style === ruleLines ? "bx bx-check" : "bx bx-empty"} />}
                            selected={style === ruleLines}
                            data-rule-lines={style ?? "none"}
                            onSelect={() => onRuleLinesChange(style)}
                        >
                            {tTrilium(RULE_LINE_LABELS[style ?? "none"])}
                        </MainMenu.Item>
                    ))}
                </MainMenu.Group>
            )}
        </MainMenu>
    );
}
