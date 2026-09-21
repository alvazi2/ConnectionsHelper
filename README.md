# Connections Helper

A different way to play the NYT Connections puzzle on an iPad. You load a screenshot of the puzzle, and the app reads the 16 words and lays them out as tiles you can move around while you work out the groups.

- **Drag** a tile onto another tile to swap them.
- **Tap** a tile to cycle its color: yellow → green → blue → purple → none.
- **Clear colors** removes all color tags. **New screenshot** loads a different puzzle.
- The board is saved in the browser, so closing and reopening the app keeps your arrangement.
- If a tile holds a symbol or picture instead of a word, the tile shows that picture cut from the screenshot. When most tiles look like pictures, every tile is shown as a picture.
- A word too long for one line, such as PEPPERMINT PATTY, is read off both lines and joined back into one word.

Words are read in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js). Nothing is uploaded. The first run downloads the text-recognition engine and English language data from jsDelivr (a few MB). After that they're cached.

The language data is Tesseract's `fast` model rather than the `best_int` one Tesseract.js loads by default, because `best_int` misreads the puzzle's bold capitals as small letters (see `LANG_PATH` in `ocr.js`).

## Using it on the iPad

1. Take a screenshot of the Connections puzzle. It can be cropped to the grid or show the whole page.
2. Open the app and tap **Load screenshot**, then pick the image from Photos or Files. You can also drag one in from another app in Split View.
   - **From the clipboard:** tap **Paste screenshot**, then tap Safari's **Paste** bubble to allow it. To copy a screenshot instead of saving it, tap the thumbnail right after taking it, tap **Done**, and choose **Copy and Delete**. Or long-press a screenshot in Photos and choose **Copy**.
   - The Paste button needs HTTPS (or `localhost`), so it's hidden when the app is opened over plain `http://` from another device.
   - With a hardware keyboard, Cmd+V also works.
3. To install it: in Safari, tap **Share → Add to Home Screen**. It then opens full screen like a regular app.

## Hosting on GitHub Pages

1. Create an empty repository on GitHub, for example `connections-helper`.
2. Push this folder:
   ```sh
   git remote add origin git@github.com:<your-user>/connections-helper.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`.
4. After a minute the app is live at `https://<your-user>.github.io/connections-helper/`.

## Running locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000> on the Mac, or `http://<mac-ip>:8000` on an iPad on the same Wi-Fi. Add `?demo` to the URL to load the bundled sample screenshot automatically, or `?demo=symbols` for the sample whose tiles hold symbols instead of words.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `styles.css` | Layout and tile styles |
| `ocr.js` | Finds the tile grid in the screenshot and reads each tile's word |
| `app.js` | Board state, drag-to-swap, tap-to-color, saving |
| `samples/example.png` | Sample screenshot used by `?demo` |
| `samples/example-symbols.png` | Sample with symbols instead of words, used by `?demo=symbols` |

## Tuning the reader

Three constants in `ocr.js` decide how a screenshot is turned into tiles. Change one only if a puzzle comes out wrong, and check both samples afterwards.

| Constant | What it does | When to change it |
|---|---|---|
| `MIN_WORD_CONFIDENCE` (60) | How sure the text reader must be for a tile to count as a word. Below it, the tile becomes a picture cut from the screenshot. | Raise it if symbol tiles show junk letters instead of pictures. Lower it if a normal word puzzle turns into pictures. |
| `INNER_BACKGROUND_SHARE` (0.15) | A picture tile also drops a second background when one flat color covers this share of the tile beyond the tile color, such as a card the symbol sits on. | Lower it if a card stays behind a symbol and hides the color tag. Raise it if part of a real picture is being erased. |
| Column threshold (0.25, in `gridFromMask`) | How much of a column must be tile color for it to count as part of a tile. | Raise it if things that aren't tiles are picked up as a grid. Lower it if tiles holding a large symbol aren't found at all. |

Verified on 2026-09-15: these values read both bundled samples correctly on an iPad.
