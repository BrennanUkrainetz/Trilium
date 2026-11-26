import { describe, expect, it } from "vitest";

import {
    CANVAS_RICH_TEXT_LINK, canvasRichTextToPlainText, getCanvasRichTextHtml, isCanvasRichTextElement
} from "./canvas_rich_text.js";

describe("getCanvasRichTextHtml", () => {
    it("reads the HTML of a rich text box only", () => {
        const box = { type: "embeddable", link: CANVAS_RICH_TEXT_LINK, customData: { triliumRichText: { html: "<p>x</p>" } } };
        expect(isCanvasRichTextElement(box)).toBe(true);
        expect(getCanvasRichTextHtml(box)).toBe("<p>x</p>");
        expect(getCanvasRichTextHtml({ ...box, customData: null })).toBe("");
        expect(getCanvasRichTextHtml({ ...box, link: "root/abc" })).toBeNull();
        expect(getCanvasRichTextHtml({ type: "rectangle", link: CANVAS_RICH_TEXT_LINK })).toBeNull();
        expect(getCanvasRichTextHtml(null)).toBeNull();
    });
});

describe("canvasRichTextToPlainText", () => {
    it("keeps one line per block and decodes entities", () => {
        expect(canvasRichTextToPlainText("<p><b>Bold</b> &amp; <i>it</i></p><p>Next&nbsp;line</p>"))
            .toBe("Bold & it\nNext line");
        expect(canvasRichTextToPlainText("<ul><li>one</li><li>two</li></ul>a<br>b &#x41;&#66; &lt;tag&gt;"))
            .toBe("one\ntwo\na\nb AB <tag>");
        expect(canvasRichTextToPlainText("<p></p><p> </p>")).toBe("");
    });
});
