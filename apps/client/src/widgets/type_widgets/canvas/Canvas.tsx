import { Excalidraw } from "@excalidraw/excalidraw";
import { TypeWidgetProps } from "../type_widget";
import "@excalidraw/excalidraw/index.css";
import { useColorScheme, useTriliumOption, useTriliumOptionBool } from "../../react/hooks/options";
import { useEffectiveReadOnly } from "../../react/hooks/note_context";
import { useNoteLabel } from "../../react/hooks/note";
import type { ComponentChildren, RefObject } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";
import {
    type AppState,
    type ExcalidrawImperativeAPI,
    type ExcalidrawProps,
    type UIOptions
} from "@excalidraw/excalidraw/types";
import options from "../../../services/options";
import "./Canvas.css";
import {
    NonDeleted, NonDeletedExcalidrawElement, ExcalidrawEmbeddableElement
} from "@excalidraw/excalidraw/element/types";
import { goToLinkExt } from "../../../services/link";
import { CanvasNoteMenu } from "./CanvasDrawingMenu";
import useCanvasPersistence from "./persistence";
import useCanvasNoteDrop from "./useCanvasNoteDrop";
import { LANGUAGE_MAPPINGS } from "./i18n";
import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import tree from "../../../services/tree";
import NoteEmbeddable from "./NoteEmbeddable";
import usePageLayout from "./page_layout";
import useInkProperties from "./ink_properties";
import useInkToShape from "./ink_to_shape";
import useImageInk from "./image_ink";
import InkToolbar from "./InkToolbar";
import useInsertSpace, { InsertSpaceOverlay } from "./insert_space";
import useLassoTool from "./lasso";
import usePenInput from "./pen_input";
import useClickToType from "./click_to_type";
import RichTextBox from "./RichTextBox";
import RichTextToolbar from "./RichTextToolbar";
import TouchMenu from "./TouchMenu";
import { CANVAS_RICH_TEXT_LINK, isCanvasRichTextElement } from "@triliumnext/commons/src/lib/canvas_rich_text.js";
import useRuleLines, { parseCanvasPaper, parseRuleLineStyle, type RuleLineStyle } from "./rule_lines";

// currently required by excalidraw, in order to allows self-hosting fonts locally.
// this avoids making excalidraw load the fonts from an external CDN.
window.EXCALIDRAW_ASSET_PATH = getExcalidrawAssetPath(window.location.pathname);

export default function Canvas({ note, noteContext }: TypeWidgetProps) {
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ ruleLinesLabel, setRuleLinesLabel ] = useNoteLabel(note, "canvasRuleLines");
    const ruleLines = parseRuleLineStyle(ruleLinesLabel);
    const [ paperLabel, setPaperLabel ] = useNoteLabel(note, "canvasPaper");
    const paper = parseCanvasPaper(paperLabel);
    // A white page draws in Excalidraw's light theme, which shows images and exports as they are.
    // `Canvas.css` shows the UI over it in light colors, also in the dark theme of Trilium.
    const uiColorScheme = useColorScheme();
    const colorScheme = paper === "white" ? "light" : uiColorScheme;
    const [ isPageMode ] = useTriliumOptionBool("canvasPageMode");
    const persistence = useCanvasPersistence(note, noteContext, apiRef, colorScheme, isReadOnly, isPageMode);

    return (
        <CanvasEditor
            apiRef={apiRef}
            isReadOnly={isReadOnly}
            colorScheme={colorScheme}
            persistence={persistence}
            ruleLines={ruleLines}
            isWhitePage={paper === "white"}
            pageMode={isPageMode}
        >
            <CanvasNoteMenu
                ruleLines={ruleLines}
                onRuleLinesChange={isReadOnly ? undefined : (style) => setRuleLinesLabel(style)}
                paper={paper}
                onPaperChange={isReadOnly ? undefined : (value) => setPaperLabel(value)}
            />
        </CanvasEditor>
    );
}

export interface CanvasEditorProps {
    apiRef: RefObject<ExcalidrawImperativeAPI | null>;
    isReadOnly: boolean;
    colorScheme: AppState["theme"];
    persistence: Partial<ExcalidrawProps>;
    /** Whether the editor moves on the page, as inside a text note that scrolls. */
    isEmbedded?: boolean;
    /** Whether Excalidraw keeps its desktop layout however small the editor is. */
    isDesktopLayout?: boolean;
    /** Limits the pans and zooms of the user. Excalidraw compares it by identity. */
    constrainView?: UIOptions["constrainView"];
    /** The rule lines shown on the page, or `null` for none. */
    ruleLines?: RuleLineStyle | null;
    /** Whether the drawing shows in its own colors on a white page, also in the dark theme. */
    isWhitePage?: boolean;
    /** Whether the drawing is a page with a top and left edge, opened at its top. */
    pageMode?: boolean;
    /** Rendered inside Excalidraw, where its hooks such as `useI18n()` work. */
    children?: ComponentChildren;
}

/** The Excalidraw editor of a canvas note or drawing, loaded and saved by `persistence`. */
export function CanvasEditor({
    apiRef, isReadOnly, colorScheme, persistence, isEmbedded = false, isDesktopLayout = false,
    constrainView, ruleLines = null, isWhitePage = false, pageMode = false, children
}: CanvasEditorProps) {
    const [ locale ] = useTriliumOption("locale");
    const [ isThinStroke ] = useTriliumOptionBool("canvasThinStroke");
    const [ isClickToType ] = useTriliumOptionBool("canvasClickToType");
    const [ isSmartLists ] = useTriliumOptionBool("canvasSmartLists");
    const [ isRichText ] = useTriliumOptionBool("canvasRichText");
    const [ isInkToolbar ] = useTriliumOptionBool("canvasInkToolbar");
    const [ isInkToShape, setInkToShape ] = useTriliumOptionBool("canvasInkToShape");
    const [ richTextEditor, setRichTextEditor ] = useState<HTMLElement | null>(null);
    const noteDrop = useCanvasNoteDrop(apiRef, isReadOnly);
    const rootRef = useRef<HTMLDivElement>(null);
    const caret = useClickToType(rootRef, apiRef, {
        clickToType: isClickToType && !isReadOnly,
        smartLists: isSmartLists && !isReadOnly,
        richText: isRichText
    });
    const pageLayout = usePageLayout(rootRef, apiRef, pageMode);
    const onRuleLinesScroll = useRuleLines(rootRef, apiRef, ruleLines, isWhitePage);
    const onPageScroll = pageLayout.onScrollChange;
    const onScrollChange = useCallback((scrollX: number, scrollY: number, zoom: AppState["zoom"]) => {
        onRuleLinesScroll(scrollX, scrollY, zoom);
        onPageScroll(scrollX, scrollY, zoom);
    }, [ onRuleLinesScroll, onPageScroll ]);
    usePenInput(rootRef, apiRef, { isEditable: !isReadOnly });
    useLassoTool(rootRef, apiRef, { isEditable: !isReadOnly });
    useInkProperties(rootRef, apiRef);
    const insertSpacePreview = useInsertSpace(rootRef, apiRef, { enabled: !isReadOnly });
    useInkToShape(rootRef, apiRef, { enabled: !isReadOnly, autoSnap: isInkToShape });
    useImageInk(rootRef, apiRef, { enabled: !isReadOnly });

    // Excalidraw maps the pointer with the container position it read last. An embedded editor
    // moves with the note, so it reads the position again before the pointer acts or something
    // drops, and not on each scroll as `detectScroll` would. `refresh()` renders all of
    // Excalidraw, the drawing included, so it runs only once the position changed.
    const refreshPosition = useCallback((e: Event) => {
        const api = apiRef.current;
        const container = (e.currentTarget as HTMLElement).querySelector(".excalidraw-container");
        if (!api || !container) return;

        const { left, top } = container.getBoundingClientRect();
        const { offsetLeft, offsetTop } = api.getAppState();
        if (left !== offsetLeft || top !== offsetTop) {
            api.refresh();
        }
    }, [ apiRef ]);

    /** Use excalidraw's native zoom instead of the global zoom. */
    const onWheel = useCallback((e: MouseEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, []);

    const onLinkOpen = useCallback((element: NonDeletedExcalidrawElement, event: CustomEvent) => {
        let link = element.link;
        if (!link) {
            return false;
        }

        if (link.startsWith("root/")) {
            link = "#" + link;
        }

        const { nativeEvent } = event.detail;
        event.preventDefault();
        return goToLinkExt(nativeEvent, link, null);
    }, []);

    // Allow embeddables that point at a Trilium note (e.g. `root/<noteId>`), which Excalidraw would
    // otherwise reject as an unrecognized provider. Returning `undefined` defers to the default
    // whitelist so normal web embeds keep working.
    const validateEmbeddable = useCallback((link: string) => (
        link === CANVAS_RICH_TEXT_LINK || getNoteIdFromEmbeddableLink(link) ? true : undefined
    ), []);

    // Render the note's content via the shared content renderer instead of the default iframe.
    // Returning `null` falls back to Excalidraw's built-in embeddable rendering.
    const renderEmbeddable = useCallback((element: NonDeleted<ExcalidrawEmbeddableElement>, appState: AppState) => {
        if (isCanvasRichTextElement(element)) {
            const { activeEmbeddable } = appState;
            return (
                <RichTextBox
                    element={element}
                    isActive={activeEmbeddable?.element.id === element.id && activeEmbeddable.state === "active"}
                    isEditable={!isReadOnly}
                    apiRef={apiRef}
                    smartLists={isSmartLists}
                    onEditorChange={setRichTextEditor}
                />
            );
        }

        const noteId = getNoteIdFromEmbeddableLink(element.link);
        return noteId ? <NoteEmbeddable noteId={noteId} /> : null;
    }, [ apiRef, isReadOnly, isSmartLists ]);

    return (
        <div
            ref={rootRef}
            className="canvas-render"
            onWheel={onWheel}
            onPointerOverCapture={isEmbedded ? refreshPosition : undefined}
            onPointerMoveCapture={isEmbedded ? refreshPosition : undefined}
            onPointerDownCapture={isEmbedded ? refreshPosition : undefined}
            onDragOverCapture={isEmbedded ? refreshPosition : undefined}
        >
            <div className="excalidraw-wrapper" {...noteDrop}>
                <Excalidraw
                    theme={colorScheme}
                    viewModeEnabled={isReadOnly || options.is("databaseReadonly")}
                    zenModeEnabled={false}
                    isCollaborating={false}
                    detectScroll={false}
                    handleKeyboardGlobally={false}
                    autoFocus={false}
                    langCode={LANGUAGE_MAPPINGS[locale as DISPLAYABLE_LOCALE_IDS] ?? undefined}
                    UIOptions={{
                        canvasActions: {
                            saveToActiveFile: false,
                            export: false
                        },
                        getFormFactor: isDesktopLayout ? getDesktopFormFactor : undefined,
                        constrainView: constrainView ?? pageLayout.constrainView,
                        freedrawStrokeWidthFactor: isThinStroke ? THIN_STROKE_WIDTH_FACTOR : 1
                    }}
                    onLinkOpen={onLinkOpen}
                    onScrollChange={onScrollChange}
                    validateEmbeddable={validateEmbeddable}
                    renderEmbeddable={renderEmbeddable}
                    {...persistence}
                >
                    {isInkToolbar && (
                        <InkToolbar apiRef={apiRef} isShapeSnapOn={isInkToShape} onShapeSnapChange={setInkToShape} />
                    )}
                    {children}
                </Excalidraw>
            </div>
            <RichTextToolbar editor={richTextEditor} />
            <TouchMenu rootRef={rootRef} apiRef={apiRef} richTextEditor={richTextEditor} isReadOnly={isReadOnly} />
            <InsertSpaceOverlay preview={insertSpacePreview} />
            {caret && (
                <div
                    className="canvas-type-caret"
                    aria-hidden="true"
                    // Placed at the clicked spot, which only the pointer knows.
                    style={{ left: caret.left, top: caret.top - caret.height / 2, height: caret.height }}
                />
            )}
        </div>
    )
}

/**
 * The width of a pen stroke while thin strokes are on, as a factor of the picked width. Excalidraw
 * after 0.18.1 draws its pen at the same widths.
 */
const THIN_STROKE_WIDTH_FACTOR = 0.5;

/** The form factor of Excalidraw's desktop layout, for an editor of any size. */
function getDesktopFormFactor() {
    return "desktop" as const;
}

/**
 * Extracts a Trilium note ID from an embeddable's link, accepting the canonical note-path form
 * (`root/<noteId>` or `#root/<noteId>`). Returns `null` for anything else so non-note embeds are
 * left to Excalidraw's default handling.
 */
function getNoteIdFromEmbeddableLink(link: string | null) {
    if (!link) {
        return null;
    }

    const cleaned = link.replace(/^#/, "");
    if (!cleaned.startsWith("root/")) {
        return null;
    }

    return tree.getNoteIdFromUrl(cleaned);
}

/** Where Excalidraw downloads its fonts from, for a page served at `pathname`. */
export function getExcalidrawAssetPath(pathname: string) {
    return `${pathname.replace(/\/+$/, "")}/node_modules/@excalidraw/excalidraw/dist/prod`;
}
