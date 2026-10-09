# CLAUDE.md: Playmate

Playmate is a line-rehearsal web app for amateur theatre. The owner uploads a play as a Word
file, picks their character, and Playmate reads every other character's lines aloud, listens
while the owner says theirs, checks the words with speech recognition, and moves on when they
go quiet. It is used by the owner (an actor, rehearsing in Hebrew) and a few friends.

**The owner's priorities:** quick and simple beats clever. Small, working steps. Hebrew first.

## What's in the repo

```
index.html        the whole app: markup, CSS and JS in one file, no build step
tests/smoke.cjs   headless end-to-end check (run it before every push)
README.md         one paragraph for humans
CLAUDE.md         this file
```

There is no package.json, bundler, framework or server. Keep it that way unless the owner
asks: one static file is what makes hosting free and the app load instantly on a phone.

## Where it runs

- **Live app:** https://moshe191201.github.io/Playmate/ (GitHub Pages, deployed from `main`
  root). A push to `main` is live within a minute or two. This is the only place the
  microphone works, because Pages is https.
- **Claude artifact copy:** https://claude.ai/artifact/SoHGQnTSjUHANKyeCy5Coo. The artifact
  sandbox blocks the microphone, so there the app falls back to tapping "Done" after each line.
  It is published from the block between `<!-- app:start -->` and `<!-- app:end -->` in
  `index.html` (the artifact host supplies its own `<html>/<head>`):
  ```bash
  sed -n '/<!-- app:start -->/,/<!-- app:end -->/p' index.html | sed '1d;$d' > <scratchpad>/playmate.html
  ```
  then publish that file to the artifact URL above. Everything the app needs must stay
  inside those markers.
- **External resources:** only JSZip from cdnjs (parsing .docx) and Google Fonts. The artifact
  sandbox allows only cdnjs/jsdelivr/unpkg scripts and Google Fonts, so don't add other hosts.

## Workflow the owner expects

- Work on `main` and push directly. That is how every change so far has shipped. Design work
  has come in as PRs from other sessions (e.g. PR #1, merged), so pull before starting.
- After pushing, refresh the artifact copy (above) so both stay identical.
- Test before pushing: `node tests/smoke.cjs` (all PASS), and add a check to it for whatever
  you change. For parser changes, also test against a real Hebrew .docx if the owner provides
  one (their play "מכולת" was the reference script: 1,096 speeches, `NAME:<tab>speech` layout,
  multi-paragraph parenthesised stage directions, Google Docs export).
- Report back briefly: what changed, what was verified and how, and what couldn't be verified
  (real phones, real voices, real speech recognition can't be tested in the sandbox).

## Product rules (decided by the owner, don't undo without asking)

- **The interface is bilingual; the play is not touched.** Hebrew (`he`, right-to-left) is the
  default interface language and English is the other. A header button switches. The play's
  text, character names, voices and recognition language come from the file only. Interface
  language must never change how the script is spoken or displayed (script elements use
  `dir="auto"`).
- **Hebrew copy addresses the user in the plural** (בחרו, הקישו, לחצו), as the gender-neutral form.
- **Line checking is always on** (there is no switch). The only switch on the main screen is
  **Read mistakes aloud**:
  - on: after a wrong line, wait for the recogniser to release the mic, then read the correct
    line with the narrator voice, then continue;
  - off: flash the red X (`#miss`) and continue **with no added delay**.
- **Line check strictness defaults to strict** (`strict: 3`).
- After each of the user's lines, **show what was heard and the match %** in the bottom bar
  (`#lastHeard`) and under the line (`.said`). When nothing was recognised, say why.
- **Stage directions** in (parentheses), [brackets] or italics are shown but never spoken,
  unless "Read stage directions aloud" is on. The user is never expected to say them.
- **Character picker** shows names only (no line counts) and hides characters with a single
  line. Their lines are still read aloud.
- **Microphone only while the tab is on screen** (plus window focus on computers, via
  `pointer: fine`; not on phones, where recognition can briefly blur the page). Leaving pauses
  the rehearsal and releases the mic; Play asks for it again.
- **Android back** first closes the settings panel if it's open; otherwise it asks "Are you
  sure you want to leave?" (yes/no).
- **Voices:** device voices only. The owner was offered paid cloud voices (Google/OpenAI) and
  declined. Each character gets a distinct voice + pitch + pace combination; users can cycle a
  character's voice in Settings.
- **Visual design:** "Vintage Military Cinema". Black/charcoal, muted gold, warm off-white,
  Anton/Oswald headings, Inter body, Courier Prime for script text, Heebo/Secular One as the
  Hebrew fallbacks, film grain, square corners, thin gold rules, a worn red stamp for the miss
  mark. All colours are CSS tokens on `:root`. Use them, don't add literals. The app is
  dark-only by design.

## How `index.html` is organised

The script is one IIFE. Sections are marked with `/* ---------- name ---------- */`:

| Section | What it does |
|---|---|
| top of script | `STR` (all interface strings, `en` and `he`), `settings` defaults + one-off migrations, `S` (the loaded script), `t()` / `K()` |
| reading the .docx | JSZip + DOMParser over `word/document.xml`. Paragraphs (with italics), tables (2 cells become `name: speech`), `sdt` blocks |
| finding characters and speeches | `parseScript()`: scores two layouts (`NAME: speech` vs name-on-its-own-line), builds `items` (`{type:'line', key, who, text}` / `{type:'dir', text}`), detects the play language |
| screens | load / cast / stage views, file handling, `castList()` (characters with >1 line) |
| the script view | renders the script, highlight + scroll, blur-my-lines |
| voices | `voicesFor()`, `voicePool()` (play-language voices, then Edge "Multilingual" ones), `combos()`, `voiceIndex()` (0 = narrator), per-character voice cycling, `sayChunk()` / `speak()` (sentence chunking, retry of dropped utterances) |
| speech recognition | `startRec()` (continuous, auto-restarts, `done` promise on stop), `lineScore()` (word LCS / Dice, Hebrew prefix and 1-letter tolerance), `STRICT` thresholds, `showResult()`, `flashMiss()` |
| microphone | getUserMedia + AnalyserNode voice-activity detection, `releaseMic()`, leave-page handling |
| playback | `listen()`, `runFrom()` main loop, `stop()`, `play()`, `go()`, Back/Skip/Jump buttons, Space key |
| settings | range bindings, Read mistakes aloud switch, recogniser permission priming |
| interface language | `applyUiLang()` re-renders every translatable string and flips `dir` |
| reopen where you left off | restores from localStorage |
| birthday card | Dad's 57th (9 Oct 2026): Hebrew card + canvas confetti on open that day, then until closed once through 16 Oct; gone after. Safe to delete afterwards |
| back button | history-entry guard, leave dialog, settings panel open/close |

### Playback model (read before touching `runFrom`)

- `token` increments to cancel a run. Every await in the loop is followed by
  `if (my !== token) return`.
- `stepAbort` is the "finish the current step now" function (current utterance or current
  listen). Skip/Done call it. `speak()` treats `stepAbort === null` after a chunk as "skip the
  rest of this speech", so set it to `null` after each step.
- `listen()` ends when speech was heard (voice activity **or** recognition text) and then
  nothing new arrives for `settings.silence` seconds. It resolves
  `{said, judged, why, recDone}`.
- `primeRec()` starts and aborts a recogniser inside the Play tap so phones grant permission
  while there's a user gesture.

### Strings and translation

- Every visible string lives in `STR.en` and `STR.he`, with the same keys in both. Values can
  be functions taking arguments.
- Static markup uses `data-t="key"`. `applyUiLang()` fills these.
- Dynamic status uses `status(kind, K('labelKey'), K('textKey', ...args))` so it re-renders
  when the language changes. Raw strings (script text, character names) are passed as-is.
- If you add a dynamic string elsewhere, re-render it in `applyUiLang()`.

### Persistence

`localStorage['playmate-v1']` holds `{title, items, chars, lang, mine, idx, voiceMap, settings}`.
Every access is wrapped in try/catch. To change a default for existing users too, use a
one-off migration flag like the existing `uiLangV2` / `strictV2`
(`if (!settings.xV2) { settings.x = …; settings.xV2 = true; }`).

## Testing notes

- `node tests/smoke.cjs` mocks `SpeechRecognition` (queue phrases in `window.__heard`), records
  `speechSynthesis.speak` calls (`window.__spoken`), and supplies a **silent** fake mic.
  Chromium's built-in fake mic beeps continuously, which means a line never ends.
- Headless Chromium has no TTS voices: utterances error immediately (and are retried once), so
  speech timing in tests is not realistic.
- The sandbox can't reach cdnjs, so the test aborts it. The sample scene needs no JSZip. To
  test .docx uploads, `npm i jszip@3.10.1` in a scratch dir and `page.route('**/jszip.min.js', …)`
  to the local file. Generate test .docx files with python-docx.
- For visual checks, take one Playwright screenshot at 400×860 in Hebrew (RTL is where layout
  bugs show up).

## Known limitations and open ideas

- **Voices are limited by the device.** iPhone has one Hebrew voice, Android usually one,
  Edge desktop two plus multilingual. Pitch/pace can only go so far.
- **Android Chrome beeps** each time recognition starts (once per user line). Browser behaviour.
- **Hebrew recognition errs**, and strict mode will flag some correct lines. The "Heard" text is
  how the user tells.
- **Back-button guard** arms only after the first tap (browser rule). If the app was opened
  in a fresh tab (e.g. from WhatsApp), "Yes" has nowhere to go back to, so pressing back again
  closes it.
- **Parser quirks seen in the reference script, offered to the owner but not yet fixed:**
  - the title page `מאת: <author>` line is taken as a character, so the cast list and set
    description get read as one long speech before the first real line;
  - an indented continuation line like `    אומר: תודה רבה` can start a new "character";
  - typo'd names (`לאיישה` for `לאייטשה`) become separate characters;
  - a stage direction split across paragraphs is appended to the speech (it's still stripped
    when spoken, as long as the parentheses balance).
