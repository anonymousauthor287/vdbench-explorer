# VDBench Explorer

Static, read-only browser giving a **sample overview — not the full dataset**.
Explore the 41 reviewed topics and their 201 periods through selected photographs,
historical context, and per-image ground truth.

**[Explore the full dataset](https://anonymous-hf.com/a/yx8guz54j8ct/)**

No build step, framework, package installation, or backend is required.

## Deploy to GitHub Pages

1. Push this folder, including `data/` and `.nojekyll`, to the root of the anonymous repository.
2. In the repo's Settings → Pages, set "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Once deployment completes, open the URL GitHub provides.

All assets use relative paths, so both account sites and repository subpaths work.
Topic links use URL fragments and do not require routing rules or a custom 404 page.

## Run locally first (optional)

```
python3 -m http.server 8080
```
Then open <http://localhost:8080/>. Opening `index.html` directly will not load the data.

## Browsing

- Search for a topic; press `/` to focus search. On smaller screens, open **Topics**.
- Use **Timeline** for a horizontal sequence or **Reading** for a vertical chronology.
- Select a year range or use the period arrows to move through time.
- Turn off **Images** to focus on the historical descriptions.
- Open a photograph to inspect its caption, year, scene, activity, and other available ground truth.
- In the image viewer, use the arrow keys to browse and `Esc` to close.
- Use **Copy link** to share the current topic and period. Browser back and forward are supported.
- Open the **Sources** tab on desktop to read the supplied references.

The dataset notice remains visible at every screen size. Counts describe topics and
periods only; the photographs are a sample. Bibliographic references and dataset
annotations are kept as supplied.

## Original image files

The bundled JPEGs are exact copies from the linked dataset, matched by image ID and
verified against the release checksums. They are not resized or recompressed.
Per-image hashes in `data/topics.json` also refresh browser caches when a file changes.

To restore the same selection from the dataset, run:

```
python scripts/sync_sample_images.py
```

The script uses Python's standard library, downloads and verifies the selection before
replacing files, and preserves the existing captions and ground truth.
