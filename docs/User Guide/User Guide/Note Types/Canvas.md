# Canvas
<figure class="image"><img style="aspect-ratio:1152/720;" src="Canvas_demo.webp" width="1152" height="720"></figure>

Canvas notes use the Excalidraw library to allow handwritten notes with mouse, pen or touch on an infinite canvas. It also supports basic diagramming, text and graphics input.

## Interaction

*   The note can be toggled [read-only](../Basic%20Concepts%20and%20Features/Notes/Read-Only%20Notes.md) from the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20menu.md">Note menu</a>.

## Typing text

Text can be typed anywhere on the canvas, as in a page of OneNote:

*   To start typing, click an empty spot of the canvas with the selection tool and type. A blinking caret shows where the text goes, and the first key creates a text element there. Neither the text tool nor a double click is needed.
*   To leave the text, press <kbd>Escape</kbd> or click elsewhere. Clicking another empty spot and typing starts a new text element.
*   While a spot is picked, letter and number keys type instead of choosing a tool. To choose a tool with its shortcut, first press <kbd>Escape</kbd> or click a shape. <kbd>Space</kbd> still pans the canvas.

This also works in drawing canvases inside text notes and in canvas slides. To turn it off, disable _Click anywhere to type_ in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Other_.

### Bullets and numbered lists

Text elements continue lists the way OneNote does:

*   A line that starts with `•`, `-`, a number such as `1.` or `1)`, or a letter such as `a)` is a list item. <kbd>Enter</kbd> at its end starts the next item with the next bullet, number or letter, at the same indentation.
*   <kbd>Enter</kbd> in an empty item ends the list. <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line inside the item.
*   Typing `*` followed by a space at the start of a line turns it into a `•` bullet.
*   <kbd>Backspace</kbd> right after a bullet or number removes it.
*   <kbd>Ctrl</kbd>+<kbd>.</kbd> turns the selected lines into a bulleted list, and <kbd>Ctrl</kbd>+<kbd>/</kbd> into a numbered list. Pressing the shortcut again turns them back into plain lines.
*   <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> indent and outdent the selected lines.

To turn this off, disable _Bullets and numbered lists_ in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Other_.

## Searching

The text of a canvas, including the labels of shapes and the names of frames, is found by <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a>, and the search results show that text. To find text within the canvas that is open, use <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search%20in%20note.md">Search in note</a>.

## Ruled and white pages

*   To write on lined paper, choose _Narrow ruled_, _College ruled_ or _Wide ruled_ under _Rule lines_ in the Excalidraw menu at the top-left of the canvas. _None_ removes the lines. _College ruled_ lines are as far apart as the lines of text, so typed text follows them. The lines show over any background color, in the light and the dark theme, and are not part of exported images.
*   In the dark theme, the drawing is shown in inverted colors. To keep a white page with the drawing in its own colors instead, turn on _White page_ in the same menu. Pasted images and exported images then show in their real colors, and the menus and toolbars over the canvas use light colors too, even in the dark theme.

Both settings are kept with the note as the `#canvasRuleLines` and `#canvasPaper=white` [labels](../Advanced%20Usage/Attributes/Labels.md), so they can also be set from the attributes or inherited. They are not available in the canvas slides of a <a class="reference-link" href="../Collections/Presentation.md">Presentation</a>.

## Page layout

A canvas note is laid out like a page, as in OneNote:

*   The page has a top and a left edge, which the canvas cannot be scrolled past. It still extends without limit to the right and down. Content already placed above or left of the page start stays reachable, as the edges move to include it.
*   The note opens at the top-left corner of the page, at the zoom it was last saved with.
*   A faint band marks the top edge of the page, and a ruled page shows a red margin line near its left edge.

To get the infinite canvas back, turn off _Page layout_ in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Other_; it is on by default. Drawing canvases in text notes and the canvas slides of a <a class="reference-link" href="../Collections/Presentation.md">Presentation</a> are not affected.

## Drawing with a pen

### Ink toolbar

Instead of Excalidraw's shape toolbar, the top of the canvas shows a simple ink toolbar, as in OneNote:

*   <span class="tn-icon bx bx-undo"></span> _Undo_ and <span class="tn-icon bx bx-redo"></span> _Redo_.
*   <span class="tn-icon bx bx-pointer"></span> _Select_ (<kbd>V</kbd>), to select, move and resize elements.
*   <span class="tn-icon bx bx-selection"></span> _Lasso select_, to select by drawing a loop around elements (see _Lasso select_ below).
*   <span class="tn-icon bx bx-pen"></span> _Pen_ (<kbd>P</kbd>), followed by four quick colors: black, red, blue and green. A color switches to the pen in that color and recolors the selected elements too; a text box takes the color on its text. While _Rectangle_ or _Ellipse_ is picked, a color keeps that tool and draws the next shape in it.
*   <span class="tn-icon bx bx-highlight"></span> _Highlighter_, a wide, translucent yellow pen. It keeps its own color, width and opacity, apart from the pen's, as changed in the properties panel while it is picked.
*   <span class="tn-icon bx bx-eraser"></span> _Eraser_ (<kbd>E</kbd>), <span class="tn-icon bx bx-rectangle"></span> _Rectangle_ (<kbd>R</kbd>) and <span class="tn-icon bx bx-circle"></span> _Ellipse_ (<kbd>O</kbd>).
*   <span class="tn-icon bx bx-move-vertical"></span> _Insert space_, to make or remove room on the page (see _Insert space_ below).
*   <span class="tn-icon bx bx-shape-polygon"></span> _Snap ink to shapes_, which turns pen strokes into clean shapes (see _Ink to shape_ below).

The other Excalidraw tools remain available through their keyboard shortcuts. To get Excalidraw's own toolbar back, turn off _Ink toolbar_ in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Other_. A drawing canvas in a text note shows the ink toolbar only in fullscreen.

While only pen or highlighter strokes are selected, or the pen is picked with nothing selected, the properties panel leaves out _Background_, _Fill_ and the alignment buttons, which do not apply to ink.

### Lasso select

To select elements of any shape, such as handwritten words, pick <span class="tn-icon bx bx-selection"></span> _Lasso select_ and drag a loop around them with the pen, the mouse or one finger:

*   An element is selected when about 80% of it lies inside the loop.
*   Dragging the selection then moves it, and its handles resize and rotate it.
*   A press outside the selection starts a new lasso.

### Insert space

To make room on the page, pick <span class="tn-icon bx bx-move-vertical"></span> _Insert space_, press at the height where the room should go and drag down. Everything below that line moves down with the pointer as you drag, by the distance dragged.

*   Dragging up removes space instead. The content below the line moves up until it reaches the line or the content above it.
*   The whole move is one undo step.
*   <kbd>Escape</kbd> cancels the drag and puts the content back where it was.

### Pen width

The pen draws at half the _Stroke width_ picked in the properties panel, which suits handwriting. To draw at the full width instead, turn off _Thin pen stroke_ in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Other_. Strokes already drawn keep their width.

### Pen input

*   While the pen or the highlighter is picked, the pointer is a small dot in the color of the ink instead of a crosshair.
*   To select with a pen, hold its side (barrel) button and drag a loop around the elements, as with _Lasso select_. After the button is released, the pen tip moves the selection, and a tip press elsewhere goes back to inking. If nothing was selected, the pen goes back to inking right away.
*   The eraser at the end of the pen erases, as before.

### Ink to shape

A pen stroke can turn into the clean shape it looks like: a line, a rectangle, an ellipse or a triangle.

*   To snap one stroke, draw the shape and hold the pen still at its end for about half a second before lifting it. This works whether _Snap ink to shapes_ is on or not.
*   With <span class="tn-icon bx bx-shape-polygon"></span> _Snap ink to shapes_ turned on in the ink toolbar (it is off by default), every finished stroke that reads as a shape snaps as the pen lifts. Handwriting stays as drawn.
*   A nearly square rectangle becomes a square, a nearly round ellipse becomes a circle, and a line straightens to horizontal, vertical or 45°.
*   Undo brings the ink back.
*   Highlighter strokes never snap.

### Ink on pictures

Ink drawn on a picture stays with it, so writing on a screenshot or a photo keeps its place when the picture changes.

*   A pen or highlighter stroke attaches to a picture when about 80% of it lies on the picture. A shape snapped from such a stroke stays attached too.
*   Clicking the picture selects it together with its ink, and moving, resizing or rotating the selection changes both.
*   To move or resize the picture without its ink, click the picture again once it is selected. Only the picture is then selected. After a click outside it, the next click on the picture selects its ink with it again.
*   Drawing a stroke and attaching it to the picture are one undo step.
*   The picture and its ink form a group. To detach all the ink, select the picture and choose _Ungroup_ (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>). Deleting the selected group deletes the ink with the picture; deleting the picture alone, after the second click, leaves its ink on the page.

## Touch menu

To act on the drawing with a finger, press and hold one finger on the canvas, with the _Select_ tool or while Excalidraw's pen mode is on. A menu opens beside the finger:

*   _Paste_ pastes the clipboard at the spot pressed. The browser might ask for permission to read the clipboard.
*   _Cut_, _Copy_, _Delete_ and _Duplicate_ act on the selection. Pressing an element selects it first, and pressing inside the selection keeps it.
*   The row of colors recolors the selected elements, and the text of a text box.

Inside a text box being edited, the menu acts on the selected text instead. A right click with the mouse still opens Excalidraw's own context menu.

## Embedding notes

Since v0.104.0, Canvas supports embedding notes in a similar fashion to the <a class="reference-link" href="Text/Include%20Note.md">Include Note</a> functionality for <a class="reference-link" href="Text.md">Text</a> notes.

To embed a note:

*   From the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a>, drag the item onto the canvas.
*   Manually, by choosing _More tools_ → _Web Embed_ and pasting the link to the note (e.g. `root/MujWAc9fQ1nj`).

Embedding notes in the canvas follows the same rules as <a class="reference-link" href="Text/Include%20Note.md">Include Note</a>: some notes are rendered as images (e.g. <a class="reference-link" href="Mind%20Map.md">Mind Map</a>), whereas some render fully interactive such as <a class="reference-link" href="../Collections.md">Collections</a>.

## Linking to a note

1.  From the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Note%20Tree.md">Note Tree</a> right click the note to be linked and selected _Advanced → Copy note path to the clipboard_.
2.  In the canvas note, right click an element and select _Add link_ (or press <kbd>Ctrl</kbd>+<kbd>K</kbd>). Paste the link and press <kbd>Enter</kbd>.
3.  A <span class="tn-icon bx bx-link-external"></span> icon will appear at the top-right of the element which will navigate to the linked note when clicked.

## Drawing in a text note

To draw inside a <a class="reference-link" href="Text.md">Text</a> note instead of in a note of its own, insert a drawing canvas with <span class="tn-icon bx bx-pen"></span>_Drawing canvas_ in the <span class="tn-icon cke cke-plus"></span>_Insert_ menu. See _Drawing canvases_ in <a class="reference-link" href="Text/Include%20Note.md">Include Note</a>.