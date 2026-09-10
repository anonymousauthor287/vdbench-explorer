# AGENTS.md — VDBench Explorer

Handoff notes for an agent picking this up locally. Read before changing anything.

## What this is

A static, read-only browser giving a **sample overview** of the VDBench visual-diachrony
dataset. It ships the 41 reviewed topics, each with its periods, a few representative
images per period, and per-image groundtruth. No build step, no framework, no server-side
anything.

It is **not** the dataset. The full release lives on Zenodo / Hugging Face.

## Run it

```
python3 -m http.server 8080
```

then open <http://localhost:8080/>. It `fetch()`es `data/topics.json`, so opening
`index.html` over `file://` will fail with a CORS error — always use a server.

## Layout

```
index.html      markup + font links; the shell only, everything else is rendered by JS
styles.css      the whole design system (tokens at :root)
app.js          no dependencies; fetch -> topic index / plates / image viewer / hash links
data/
  topics.json   the content: topics -> temporal_evolution[] -> images[] (+ groundtruth)
  images/       entry_<topicId>/<period-slug>-<n>.jpg, byte-for-byte dataset originals
scripts/
  sync_sample_images.py  restore the selected originals and verify release checksums
.nojekyll       stops GitHub Pages running Jekyll over it
```

`data/topics.json` shape, per image:

```json
{ "src": "images/entry_1/1920s-1930s-1.jpg", "image_id": "img_…",
  "caption": "…", "point_year": 1930, "scene": "…", "activity": "…", "trend": null }
```

`app.js` builds `state.imgIndex` (src -> image object) at render time; the lightbox reads
groundtruth from it on click. If you change the images array shape, update `firstThumb()`,
`renderPlate()` and `renderGtPanel()` together.

Image paths in the JSON are relative to `data/`; `imageSrc()` resolves them for the page.
Each image's `sha256` records its original file checksum and versions its browser URL.
Keep originals at their dataset resolution; restore with `scripts/sync_sample_images.py`
after a regeneration that replaces assets or removes the hashes. Do not downsample the
originals to reduce the site size.
Topic and period links use `#topic=<id>&period=<one-based index>`. Topic IDs are not
consecutive; preserve the order in the JSON. The topic drawer opens below 800px, where
Reading is the initial layout. Explicit layout choices persist while browsing the page.

## Design system

Register is a **photographic plate catalogue** — the dataset is about time, so the year is
the anchor and periods are numbered plates (`PL. 01`) on a chronology rule. The numbering is
meaningful (periods are an ordered sequence), not decoration; don't reuse that device for
things that aren't sequences.

- **Colour** — archival mount board. `--paper #e6e1d8`, `--paper-2 #f2efe9`,
  `--mount #d8d1c4`, ink ramp `#1c1a17 / #57514a / #8a8279`, rule `#cdc5b8`,
  accent `--accent #9e3b23` (deep oxide red). Neutrals are deliberately hue-biased toward
  the accent. Everything is a token at `:root` — don't hardcode colours in components.
- **Type** — two roles from one superfamily. IBM Plex Sans for reading, **IBM Plex Mono for
  years, plate numbers and metadata labels**. Seven-step scale (`--fs-xs` … `--fs-2xl`);
  stay on it rather than inventing sizes.
- **Single committed light theme. Do not add a dark theme or a theme toggle** — this was an
  explicit product decision, not an oversight.

## Hard constraints — do not regress these

1. **Anonymity.** This is published for double-blind review. No real names, email
   addresses, usernames, institution domains, or absolute local filesystem paths anywhere in
   the repo — including in code comments and commit messages. Before publishing, grep the
   tree for each of those (author name, account handle, institution domain, home-directory
   prefix) and confirm zero hits.
2. **Always state this is not the full dataset.** The bar carries
   "sample overview — not the full dataset". It must stay visible at every viewport width
   (it was once hidden on mobile — that was a bug). Keep it out of the flex-wrap flow: it
   used to sit inline competing for space and made the whole bar jump between rows.
3. **Never print an image count.** Topic and period counts are accurate and fine; an image
   count implies completeness the sample doesn't have.
4. **Don't describe it as "curated."** Use "sample" / "selection".

## Traps already hit — don't repeat them

- **Aspect-ratio explosion.** `aspect-ratio:5/4` on a full-width lead image derives height
  from width: at 380px wide that's 304px tall, and with the supporting pair it overflowed
  any normal laptop viewport. In the horizontal filmstrip **vertical space is the scarce
  axis** — the frames are capped with `max-height:clamp(...vh...)`. Keep those caps, and
  keep them scoped to `.plates:not(.vertical)` (a shared cap desyncs the 3-across row in
  vertical mode).
- **Fonts.** `index.html` links Google Fonts in `<head>`. A bundled single-file build must
  carry that link too or it silently falls back to system fonts and looks wrong.
- **JPEG artifacts.** Any image resampling must read from the **original** file, never from
  an already-compressed derivative (two lossy passes compound), and must pass
  `subsampling=0` to Pillow — default 4:2:0 chroma subsampling smears colour noise into
  near-grayscale and sepia photographs.
- **Colour-error images.** Some generated images carry a partially-colourised object in an
  otherwise B&W/sepia frame (a green bottle, an amber-glowing dial). Known ones were
  replaced. **But colour is the subject in some topics** — "Rainbow flag / rainbow symbol"
  and "Pink and blue gender coding" are *supposed* to have colour in period photographs.
  Always check the topic before calling colour an error.

## Sources panel

Collapsed by default; the "Sources" tab on the right edge expands it. Hidden entirely below
1000px. Citations were audited — several originally pointed at journal *book reviews* rather
than the books themselves, and a few DOIs resolved to unrelated works. If you touch sources,
verify against CrossRef metadata rather than trusting an HTTP status: major academic
publishers return 403 to automated requests even when the link is perfectly valid.

## Regenerating data

`data/` is produced by a script outside this folder from the dataset release plus two
curation files (one base pick per period, two extras). This repo is a snapshot — editing
`data/topics.json` by hand is fine for UI work, but it will be overwritten by the next
regeneration.
