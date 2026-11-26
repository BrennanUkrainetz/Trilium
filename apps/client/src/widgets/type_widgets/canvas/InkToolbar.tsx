import "./InkToolbar.css";

import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import {
    applyStrokeColor, HIGHLIGHTER_STYLE, INK_COLORS, type InkStyle, inkStyleToAppState, readInkStyle
} from "./ink_tools";
import { INSERT_SPACE_TOOL, isInsertSpaceActive } from "./insert_space";
import { isHoldingLassoSelection, isLassoTool, LASSO_TOOL, releaseLassoSelection } from "./lasso";

/**
 * A tool of the ink toolbar. The pen and the highlighter are both Excalidraw's `freedraw`, and the
 * lasso is its `custom` tool, which `useLassoTool()` handles.
 */
export type InkTool = "selection" | "lasso" | "pen" | "highlighter" | "eraser" | "rectangle" | "ellipse" | "insert_space";

/** Which of the two pens draws while Excalidraw's tool is `freedraw`. */
type FreedrawMode = "pen" | "highlighter";

type HistoryAction = "undo" | "redo";

interface InkToolbarProps {
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    /** Whether new pen strokes turn into the shapes they look like. */
    isShapeSnapOn?: boolean;
    /** Turns snapping to shapes on or off. Without it, the toolbar has no snap button. */
    onShapeSnapChange?: (on: boolean) => void;
}

/**
 * A OneNote-like draw bar over a canvas: undo and redo, the selection tool, the lasso, a pen with
 * quick colors, a highlighter, the eraser, and the rectangle and ellipse tools. The pen and the
 * highlighter each keep their own color, width and opacity. Renders nothing in view mode.
 */
export default function InkToolbar({ apiRef, isShapeSnapOn, onShapeSnapChange }: InkToolbarProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const api = useExcalidrawApi(apiRef);
    const [ appState, setAppState ] = useState<InkAppState | null>(null);
    const [ freedrawMode, setFreedrawMode ] = useState<FreedrawMode>("pen");
    const modeRef = useRef<FreedrawMode>("pen");
    const penStyleRef = useRef<InkStyle | null>(null);
    const highlighterStyleRef = useRef<InkStyle>(HIGHLIGHTER_STYLE);
    // Set while the toolbar changes the tool and the stroke, which Excalidraw can report in between.
    const isApplyingRef = useRef(false);
    const history = useHistoryButtons(rootRef, api);

    const changeMode = useCallback((mode: FreedrawMode) => {
        modeRef.current = mode;
        setFreedrawMode(mode);
    }, []);

    useEffect(() => {
        if (!api) return;

        const initial = api.getAppState();
        penStyleRef.current = { ...readInkStyle(initial), opacity: 100 };
        const update = (state: AppState) => {
            setAppState((current) => pickInkAppState(api, state, current));
            if (isApplyingRef.current) return;

            if (state.activeTool.type === "freedraw") {
                // Keeps what the user changes in Excalidraw's properties panel for this pen.
                if (modeRef.current === "highlighter") {
                    highlighterStyleRef.current = readInkStyle(state);
                } else {
                    penStyleRef.current = readInkStyle(state);
                }
            } else if (modeRef.current === "highlighter") {
                // Another tool, as from the keyboard, draws with the pen's stroke again.
                changeMode("pen");
                if (penStyleRef.current) {
                    api.updateScene({ appState: inkStyleToAppState(penStyleRef.current) });
                }
            }
        };
        update(initial);
        return api.onChange((_elements, state) => update(state));
    }, [ api, changeMode ]);

    if (!api || !appState || appState.viewModeEnabled) {
        return <div ref={rootRef} className="canvas-ink-toolbar" />;
    }

    const activeTool = appState.isLasso ? "lasso"
        : appState.isInsertSpace ? "insert_space"
            : getActiveInkTool(appState.toolType, freedrawMode);
    const penColor = appState.strokeColor;

    /** Changes the tool and the stroke of the next element as one step. */
    const apply = (tool: Parameters<ExcalidrawImperativeAPI["setActiveTool"]>[0], style?: InkStyle) => {
        isApplyingRef.current = true;
        try {
            api.setActiveTool(tool);
            if (style) {
                api.updateScene({ appState: inkStyleToAppState(style) });
            }
        } finally {
            isApplyingRef.current = false;
        }
        setAppState((current) => pickInkAppState(api, api.getAppState(), current));
    };

    const selectPen = () => {
        changeMode("pen");
        apply({ type: "freedraw" }, penStyleRef.current ?? undefined);
    };

    const selectHighlighter = () => {
        changeMode("highlighter");
        apply({ type: "freedraw" }, highlighterStyleRef.current);
    };

    /** Selects a tool other than the two pens, which draws with the pen's stroke. */
    const selectTool = (type: "selection" | "lasso" | "eraser" | "rectangle" | "ellipse" | "insert_space") => {
        const wasHighlighter = modeRef.current === "highlighter";
        changeMode("pen");
        releaseLassoSelection(api);
        const tool = type === "lasso" ? LASSO_TOOL : type === "insert_space" ? INSERT_SPACE_TOOL : { type };
        apply(tool, wasHighlighter ? penStyleRef.current ?? undefined : undefined);
    };

    const pickColor = (color: string) => {
        if (Object.values(api.getAppState().selectedElementIds).some(Boolean)) {
            applyStrokeColor(api, color);
        }
        const penStyle = { ...(penStyleRef.current ?? readInkStyle(api.getAppState())), color };
        penStyleRef.current = penStyle;
        if (activeTool === "rectangle" || activeTool === "ellipse") {
            // A shape tool stays picked and draws in the new color.
            api.updateScene({ appState: inkStyleToAppState(penStyle) });
            setAppState((current) => pickInkAppState(api, api.getAppState(), current));
        } else {
            selectPen();
        }
    };

    return (
        <div ref={rootRef} className="canvas-ink-toolbar">
            <OverlayControlGroup placement="top-center" className="canvas-ink-toolbar-group" overCanvas>
                <OverlayControlButton
                    title={t("canvas.ink_toolbar.undo")}
                    icon="bx-undo"
                    shortcut="CommandOrControl+Z"
                    disabled={!history.undo}
                    onClick={() => clickHistoryButton(rootRef.current, "undo")}
                />
                <OverlayControlButton
                    title={t("canvas.ink_toolbar.redo")}
                    icon="bx-redo"
                    shortcut="CommandOrControl+Shift+Z"
                    disabled={!history.redo}
                    onClick={() => clickHistoryButton(rootRef.current, "redo")}
                />
                <ToolButton tool="selection" icon="bx-pointer" shortcut="V" activeTool={activeTool} onClick={() => selectTool("selection")} />
                <ToolButton tool="lasso" icon="bx-selection" activeTool={activeTool} onClick={() => selectTool("lasso")} />
                <ToolButton tool="pen" icon="bx-pen" shortcut="P" activeTool={activeTool} onClick={selectPen} />
                {INK_COLORS.map(({ name, value }) => {
                    const label = t("canvas.ink_toolbar.pen_color", { color: t(`canvas.ink_colors.${name}`) });
                    const isPicked = penColor.toLowerCase() === value.toLowerCase();
                    return (
                        <OverlayControlButton
                            key={value}
                            className="canvas-ink-swatch-button"
                            title={label}
                            aria-label={label}
                            aria-pressed={activeTool === "pen" && isPicked}
                            active={activeTool === "pen" && isPicked}
                            text={<span
                                className="canvas-ink-swatch"
                                aria-hidden="true"
                                // The color comes from `INK_COLORS`.
                                style={{ "--canvas-ink-color": value }}
                            />}
                            onClick={() => pickColor(value)}
                        />
                    );
                })}
                <ToolButton tool="highlighter" icon="bx-highlight" activeTool={activeTool} onClick={selectHighlighter} />
                <ToolButton tool="eraser" icon="bx-eraser" shortcut="E" activeTool={activeTool} onClick={() => selectTool("eraser")} />
                <ToolButton tool="rectangle" icon="bx-rectangle" shortcut="R" activeTool={activeTool} onClick={() => selectTool("rectangle")} />
                <ToolButton tool="ellipse" icon="bx-circle" shortcut="O" activeTool={activeTool} onClick={() => selectTool("ellipse")} />
                <ToolButton tool="insert_space" icon="bx-move-vertical" activeTool={activeTool} onClick={() => selectTool("insert_space")} />
                {onShapeSnapChange && (
                    <OverlayControlButton
                        title={t("canvas.ink_toolbar.snap_shapes")}
                        icon="bx-shape-polygon"
                        aria-pressed={!!isShapeSnapOn}
                        active={isShapeSnapOn}
                        onClick={() => onShapeSnapChange(!isShapeSnapOn)}
                    />
                )}
            </OverlayControlGroup>
        </div>
    );
}

interface ToolButtonProps {
    tool: InkTool;
    icon: string;
    shortcut?: string;
    activeTool: InkTool | null;
    onClick: () => void;
}

function ToolButton({ tool, icon, shortcut, activeTool, onClick }: ToolButtonProps) {
    const isActive = activeTool === tool;
    return (
        <OverlayControlButton
            title={t(`canvas.ink_toolbar.${tool}`)}
            icon={icon}
            shortcut={shortcut}
            aria-pressed={isActive}
            active={isActive}
            onClick={onClick}
        />
    );
}

/** What the toolbar shows of Excalidraw's state. */
interface InkAppState {
    viewModeEnabled: boolean;
    toolType: AppState["activeTool"]["type"];
    /** Whether the lasso is picked, or the selection tool holds what it selected. */
    isLasso: boolean;
    /** Whether the insert space tool is picked. */
    isInsertSpace: boolean;
    strokeColor: string;
}

/**
 * The part of `state` that the toolbar shows, or `current` while that part is unchanged, so that
 * the toolbar renders again only when what it shows changes and not on each move of a stroke.
 */
function pickInkAppState(api: ExcalidrawImperativeAPI, state: AppState, current: InkAppState | null): InkAppState {
    const next = {
        viewModeEnabled: state.viewModeEnabled,
        toolType: state.activeTool.type,
        isLasso: isLassoTool(state.activeTool) || (state.activeTool.type === "selection" && isHoldingLassoSelection(api)),
        isInsertSpace: isInsertSpaceActive(state),
        strokeColor: state.currentItemStrokeColor
    };
    return current && current.viewModeEnabled === next.viewModeEnabled && current.toolType === next.toolType
        && current.isLasso === next.isLasso && current.isInsertSpace === next.isInsertSpace
        && current.strokeColor === next.strokeColor
        ? current : next;
}

/** The toolbar's tool that Excalidraw's tool `type` stands for, or `null` for one it lacks. */
export function getActiveInkTool(type: AppState["activeTool"]["type"], freedrawMode: FreedrawMode): InkTool | null {
    switch (type) {
        case "freedraw":
            return freedrawMode;
        case "selection":
        case "eraser":
        case "rectangle":
        case "ellipse":
            return type;
        default:
            return null;
    }
}

/** The API in `apiRef`, once Excalidraw has set it. */
function useExcalidrawApi(apiRef: RefObject<ExcalidrawImperativeAPI | null>) {
    const [ api, setApi ] = useState(apiRef.current);
    useEffect(() => {
        if (api) return;

        let frame = 0;
        const poll = () => {
            if (apiRef.current) {
                setApi(apiRef.current);
            } else {
                frame = requestAnimationFrame(poll);
            }
        };
        poll();
        return () => cancelAnimationFrame(frame);
    }, [ api, apiRef ]);
    return api;
}

/** Whether Excalidraw's own undo and redo buttons, which the toolbar clicks, are enabled. */
function useHistoryButtons(rootRef: RefObject<HTMLElement | null>, api: ExcalidrawImperativeAPI | null) {
    const [ state, setState ] = useState({ undo: false, redo: false });
    useEffect(() => {
        const host = getEditorRoot(rootRef.current);
        if (!host || !api) return;

        const update = () => {
            const undo = isEnabled(findHistoryButton(host, "undo"));
            const redo = isEnabled(findHistoryButton(host, "redo"));
            setState((current) => (current.undo === undo && current.redo === redo ? current : { undo, redo }));
        };
        const observer = new MutationObserver(update);
        observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: [ "disabled" ] });
        update();
        return () => observer.disconnect();
    }, [ rootRef, api ]);
    return state;
}

/** The editor that holds the toolbar, where Excalidraw renders its own buttons. */
function getEditorRoot(element: HTMLElement | null) {
    return element?.closest<HTMLElement>(".canvas-render, .excalidraw") ?? null;
}

function findHistoryButton(host: HTMLElement, action: HistoryAction) {
    return host.querySelector<HTMLButtonElement>(`[data-testid="button-${action}"]`);
}

function isEnabled(button: HTMLButtonElement | null) {
    return !!button && !button.disabled;
}

/**
 * Clicks Excalidraw's undo or redo button. In a text note, that button undoes the changes of the
 * note (`DrawingHistory`), which the API has no call for.
 */
function clickHistoryButton(element: HTMLElement | null, action: HistoryAction) {
    const host = getEditorRoot(element);
    if (host) {
        findHistoryButton(host, action)?.click();
    }
}
