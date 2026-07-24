# Cue

Turn a document into something worth listening to.

Cue reads a report, plan or manual out loud the way a person would read it: slower
through headings, a breath between sections, leaning on the sentences that matter,
and saying `J$1,902,360` as *one million, nine hundred and two thousand, three
hundred and sixty Jamaican dollars* rather than reciting digits.

It is a static site. No server, no build step, no account. Everything — parsing,
markup, speech — happens in the browser, and your document never leaves your machine.

---

## Put it online in five minutes

1. Create a new GitHub repository and push these files to the default branch:

   ```bash
   git init
   git add .
   git commit -m "Cue"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/cue.git
   git push -u origin main
   ```

2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*,
   pick **main** and the **/ (root)** folder, then save.
4. Wait about a minute. Your app is at `https://YOUR-NAME.github.io/cue/`.

Nothing else to configure. The `.nojekyll` file is already here so GitHub serves
the `src/` folder untouched.

### Running it on your own machine

```bash
python3 -m http.server 8080     # then open http://localhost:8080
```

Open the folder over `http://`, not by double-clicking `index.html` — browsers block
JavaScript modules loaded from `file://`.

---

## Using it

**Drop in a file.** Word (`.docx`), PDF, Markdown, plain text or HTML. Cue works out
the structure, then shows you the script it is about to read.

**Read the markup.** Every line in the transcript is a unit of speech. Hover one and
the margin shows what Cue decided: `0.88×` slower, `↓` lower, `emph` for a leaned-on
clause, `0.9s` for the silence after it. When a line will be *said* differently from
how it is written, the spoken version appears underneath in blue. That is the whole
idea of the app — you can see the reading before you hear it.

**Steer it.** Click any line to start from there. The contents panel jumps between
sections. Keyboard: `space` play or pause, `←` `→` a line at a time, `[` `]` a
section at a time.

**Fix the pronunciations.** Cue collects every abbreviation it finds and lists them
under **Pronunciation**, marked in blue where they came from your document. Write
them how they should sound — `NIS` → `N I S`, `PAYE` → `pay as you earn`. Changes
apply immediately and are remembered.

Cue leaves your place in a document, so closing the tab mid-chapter is fine.

---

## The two voices

**This browser** (default) uses the speech voices already installed on your device.
Free, instant, works offline, no key. Quality varies a lot: macOS and iOS voices are
good, recent Edge voices on Windows are good, older Android and Linux voices are not.
Look for a voice with *Natural*, *Neural*, *Premium* or *Enhanced* in its name — Cue
sorts those to the top of the list.

**Cloud voice** uses ElevenLabs or any OpenAI-compatible speech endpoint with a key
you supply. It sounds dramatically better, and it is the only way to save a file.
The key is kept in your browser's local storage and sent only to the provider you
picked.

> Some providers block requests made straight from a web page. If you see a network
> error with a valid key, that is why — run Cue locally, or put a small proxy of your
> own between it and the provider.

### Saving an audio file

Under **Export**, choose the whole document or the current section and press
**Render audio**. Cue requests each line, stitches the audio together with the
silences it planned, encodes one MP3 and offers it for download. A two-hour document
comes out around 90 MB.

This needs a cloud voice. Browsers deliberately give web pages no way to record their
built-in speech, so the browser engine can play audio but never capture it.

---

## How the reading is decided

```
your file
   │
   ├─ parse.js     structure: headings, paragraphs, lists, tables, quotes,
   │               captions, callout boxes. Layout tables are unwrapped;
   │               data tables are kept as data.
   │
   ├─ script.js    normalise()   money, percentages, dates, phone numbers,
   │               │             ranges, ordinals, years, section references,
   │               │             email and web addresses, abbreviations
   │               │
   │               buildScript() one line per sentence, each with its own
   │                             rate, pitch, and the silence that follows.
   │                             Tables become sentences: a row of a
   │                             three-column table is read as
   │                             "NIS. Employer, three percent. Employee,
   │                             three percent."
   │
   └─ speech.js    plays it, one line at a time, so the silences are real
                   silences rather than punctuation the voice may ignore.
```

Roughly what the director does:

| Element | Speed | Pitch | Silence after |
| --- | --- | --- | --- |
| Part title | 0.86× | lower | 1.0 s |
| Chapter heading | 0.88× | lower | 0.85 s |
| Section heading | 0.94× | slightly lower | 0.5 s |
| Body sentence | 1.00× | level | 0.27 s |
| Last sentence of a paragraph | 1.00× | level | 0.34 s |
| Question | 1.00× | rises | 0.27 s |
| Bold clause | 0.95× | slightly higher | — |
| Pull quote | 0.90× | lower | 0.7 s |
| Table row | 0.97× | level | 0.32 s |
| List item | 1.00× | level | 0.3 s before |

All of it scales with the **Pause length** slider, so you can tighten the whole
reading without losing the relative shape of it.

---

## Known limits

- **Scanned PDFs** have no text to extract. Cue says so rather than pretending.
- **PDF structure is guessed** from font sizes, so headings in an unusual PDF may come
  out flat. Word files are far more reliable because the headings are real headings.
- **Browser voices ignore some instructions.** A few refuse pitch changes entirely.
  Speed and silence always work.
- **iOS** needs one tap on play before it will make any sound at all; that is a system
  rule, not a bug here.
- **Very long documents** are held in memory. A 77-page plan is about 1,500 lines and
  is comfortable; a 500-page book will be slow to lay out.

---

## Files

```
index.html          markup
assets/app.css      the design system
src/parse.js        file → structured blocks
src/script.js       blocks → spoken script (normalisation + prosody)
src/speech.js       browser voices, cloud voices, MP3 rendering
src/app.js          interface
test/script.test.mjs  39 assertions over the normaliser and director
```

Run the tests with `npm test` (Node 18+, no dependencies).

## Licence

MIT.
