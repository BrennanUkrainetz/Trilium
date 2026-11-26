import { CaptureUpdateAction, mutateElement } from "@excalidraw/excalidraw";
import type {
    ExcalidrawElement, ExcalidrawFreeDrawElement, ExcalidrawImageElement
} from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI, PointerDownState } from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

import { randomString } from "../../../services/utils";

type Point = readonly [number, number];

export interface ImageInkOptions {
    /** Whether strokes attach to images and a second click selects only the image. */
    enabled: boolean;
}

/** The `customData` key that holds the id of the ink group of an image and of its strokes. */
export const INK_GROUP_KEY = "trilium-ink-group";

/** The share of a stroke's points that must lie on an image for the stroke to attach to it. */
export const MIN_INK_COVERAGE = 0.8;

/**
 * How long, in milliseconds, after a click a second one makes a double-click, which Excalidraw
 * handles itself.
 */
export const DOUBLE_CLICK_MS = 500;

/** The length of a new group id, as long as Excalidraw's own `randomId()`. */
const GROUP_ID_LENGTH = 21;

/**
 * OneNote-style ink on images. A pen or highlighter stroke that lies mostly on an image joins
 * the image's ink group, an Excalidraw group innermost on the image, so the ink moves, resizes
 * and rotates with the image. A click on an image whose ink group is selected enters the group
 * and selects only the image, as Excalidraw's double-click does, so the image can then move
 * without its ink.
 *
 * Strokes attach in `onPointerUp()` of the imperative API, which Excalidraw calls before it ends
 * the stroke, so the group change lands in the same undo step as the stroke.
 */
export default function useImageInk(
    rootRef: RefObject<HTMLElement | null>,
    apiRef: RefObject<ExcalidrawImperativeAPI | null>,
    { enabled }: ImageInkOptions
) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root || !enabled) {
            return;
        }

        let subscribedApi: ExcalidrawImperativeAPI | null = null;
        let unsubscribe: (() => void) | null = null;
        let selectTimer: ReturnType<typeof setTimeout> | null = null;
        let lastPointerUpAt = -Infinity;

        function subscribe() {
            const api = apiRef.current;
            if (!api || api === subscribedApi) {
                return;
            }
            unsubscribe?.();
            subscribedApi = api;
            unsubscribe = api.onPointerUp((activeTool, pointerDownState, event) => {
                onExcalidrawPointerUp(api, activeTool, pointerDownState, event);
            });
        }

        function onExcalidrawPointerUp(
            api: ExcalidrawImperativeAPI,
            activeTool: AppState["activeTool"],
            pointerDownState: PointerDownState,
            event: PointerEvent
        ) {
            const sincePreviousUp = event.timeStamp - lastPointerUpAt;
            lastPointerUpAt = event.timeStamp;
            if (activeTool.type === "freedraw") {
                attachNewStroke(api);
                return;
            }

            const hit = pointerDownState.hit.element;
            const isPlainClick = activeTool.type === "selection" && event.button === 0
                && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
                && !pointerDownState.drag.hasOccurred && !pointerDownState.hit.wasAddedToSelection
                && sincePreviousUp > DOUBLE_CLICK_MS;
            if (!hit || !isPlainClick || !getImageOnlySelection(hit, api.getAppState(), api.getSceneElements())) {
                return;
            }

            // Excalidraw selects the clicked group again after this callback, in the same handler.
            if (selectTimer) {
                clearTimeout(selectTimer);
            }
            selectTimer = setTimeout(() => {
                selectTimer = null;
                const elements = api.getSceneElements();
                const image = elements.find((element) => element.id === hit.id);
                const selection = image && getImageOnlySelection(image, api.getAppState(), elements);
                if (selection) {
                    api.updateScene({
                        appState: { ...selection, selectedLinearElement: null },
                        captureUpdate: CaptureUpdateAction.IMMEDIATELY
                    });
                }
            });
        }

        subscribe();
        root.addEventListener("pointerover", subscribe, { capture: true });
        root.addEventListener("pointerdown", subscribe, { capture: true });
        return () => {
            unsubscribe?.();
            if (selectTimer) {
                clearTimeout(selectTimer);
            }
            root.removeEventListener("pointerover", subscribe, { capture: true });
            root.removeEventListener("pointerdown", subscribe, { capture: true });
        };
    }, [ rootRef, apiRef, enabled ]);
}

/**
 * Puts the stroke Excalidraw is about to end into the ink group of the image under it. The
 * elements are changed in place, which Excalidraw's store records with the end of the stroke.
 */
function attachNewStroke(api: ExcalidrawImperativeAPI) {
    const stroke = api.getAppState().newElement;
    if (stroke?.type !== "freedraw") {
        return;
    }
    const attachment = planInkAttachment(stroke, api.getSceneElements(), () => randomString(GROUP_ID_LENGTH));
    if (!attachment) {
        return;
    }
    if (attachment.imageUpdates) {
        mutateElement(attachment.image, attachment.imageUpdates);
    }
    mutateElement(stroke, attachment.strokeUpdates);
}

type GroupUpdates = Pick<ExcalidrawElement, "groupIds" | "customData">;

export interface InkAttachment {
    image: ExcalidrawImageElement;
    /** The changes to the image, or `null` when it already has the ink group. */
    imageUpdates: GroupUpdates | null;
    strokeUpdates: GroupUpdates;
}

/**
 * Plans how `stroke` joins the ink group of the topmost image under it: the image's existing ink
 * group, or a new one from `createGroupId()` put innermost on the image. Returns `null` when no
 * image lies under the stroke, or when the stroke belongs to another group or frame than the
 * image.
 */
export function planInkAttachment(
    stroke: ExcalidrawFreeDrawElement,
    elements: readonly ExcalidrawElement[],
    createGroupId: () => string
): InkAttachment | null {
    if (stroke.isDeleted || stroke.locked || stroke.points.length < 2) {
        return null;
    }
    const image = findImageUnderStroke(stroke, elements);
    if (!image || image.frameId !== stroke.frameId) {
        return null;
    }

    const existingGroupId = getInkGroupId(image, elements);
    const outerGroupIds = existingGroupId ? image.groupIds.slice(1) : image.groupIds;
    if (stroke.groupIds.length > 0 && !isSameList(stroke.groupIds, outerGroupIds)) {
        return null;
    }

    const groupId = existingGroupId ?? createGroupId();
    const hasMarker = image.customData?.[INK_GROUP_KEY] === groupId;
    return {
        image,
        imageUpdates: existingGroupId && hasMarker ? null : {
            groupIds: existingGroupId ? image.groupIds : [ groupId, ...image.groupIds ],
            customData: { ...image.customData, [INK_GROUP_KEY]: groupId }
        },
        strokeUpdates: {
            groupIds: [ groupId, ...outerGroupIds ],
            customData: { ...stroke.customData, [INK_GROUP_KEY]: groupId }
        }
    };
}

/**
 * The topmost unlocked image on which at least `MIN_INK_COVERAGE` of the stroke's points lie,
 * taking the image's rotation into account.
 */
export function findImageUnderStroke(stroke: ExcalidrawFreeDrawElement, elements: readonly ExcalidrawElement[]) {
    const points = stroke.points.map(([ x, y ]) => [ stroke.x + x, stroke.y + y ] as const);
    for (let index = elements.length - 1; index >= 0; index--) {
        const element = elements[index];
        if (element.type === "image" && element.id !== stroke.id && !element.isDeleted && !element.locked
            && getCoverage(points, element) >= MIN_INK_COVERAGE) {
            return element;
        }
    }
    return null;
}

/** The share of `points`, in scene coordinates, that lie inside `element`'s rotated bounds. */
export function getCoverage(points: readonly Point[], element: ExcalidrawElement) {
    if (!points.length) {
        return 0;
    }
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const cos = Math.cos(-element.angle);
    const sin = Math.sin(-element.angle);
    const halfWidth = Math.abs(element.width) / 2;
    const halfHeight = Math.abs(element.height) / 2;
    let inside = 0;
    for (const [ x, y ] of points) {
        const dx = x - centerX;
        const dy = y - centerY;
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        if (Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight) {
            inside++;
        }
    }
    return inside / points.length;
}

/**
 * The id of the image's ink group: its innermost group, when the image's `customData` marks it.
 * A copy of an image with ink keeps the old mark under a new group id, so a group whose members
 * all carry the image's mark, innermost, is its ink group too.
 */
export function getInkGroupId(image: ExcalidrawElement, elements: readonly ExcalidrawElement[]) {
    const groupId = image.groupIds[0];
    const marker: unknown = image.customData?.[INK_GROUP_KEY];
    if (!groupId || typeof marker !== "string") {
        return null;
    }
    if (marker === groupId) {
        return groupId;
    }
    const isCopiedInkGroup = elements.every((element) => (
        element.isDeleted || !element.groupIds.includes(groupId) || element.id === image.id
        || (element.groupIds[0] === groupId && element.type !== "image" && element.customData?.[INK_GROUP_KEY] === marker)
    ));
    return isCopiedInkGroup ? groupId : null;
}

/**
 * The selection that a click on `hit` makes when `hit` is an image whose ink group is the whole
 * selection: the group entered, as Excalidraw's double-click enters it, and only the image
 * selected. Returns `null` for any other click, which Excalidraw handles as usual.
 */
export function getImageOnlySelection(
    hit: ExcalidrawElement,
    appState: Pick<AppState, "selectedGroupIds" | "selectedElementIds" | "editingGroupId">,
    elements: readonly ExcalidrawElement[]
): Pick<AppState, "editingGroupId" | "selectedElementIds" | "selectedGroupIds"> | null {
    if (hit.type !== "image" || hit.isDeleted || hit.locked) {
        return null;
    }
    const groupId = getInkGroupId(hit, elements);
    if (!groupId || !appState.selectedGroupIds[groupId] || appState.editingGroupId === groupId) {
        return null;
    }
    const byId = new Map(elements.map((element) => [ element.id, element ]));
    const isOnlyInkGroupSelected = Object.keys(appState.selectedElementIds).every((id) => (
        !appState.selectedElementIds[id] || byId.get(id)?.groupIds.includes(groupId)
    ));
    if (!isOnlyInkGroupSelected) {
        return null;
    }
    return { editingGroupId: groupId, selectedElementIds: { [hit.id]: true }, selectedGroupIds: {} };
}

function isSameList(a: readonly string[], b: readonly string[]) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
