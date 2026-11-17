# Septet

A daily word game for the browser. You get seven letters, one of them in the
middle, and find as many words as you can. Every word needs the middle letter,
letters can repeat, and there is never an S.

It plays by the rules of the seven-letter "word hive" genre made popular by
the New York Times Spelling Bee, with its own name, look, ranks, word list and
puzzles. Tap any word you have found (or any of yesterday's answers) to hear
it spoken and see what it means, with a sample sentence and a picture.

**Play it at <https://rgutmann39.github.io/septet/>.**

There is no server and nothing to pay for: the game is a folder of static
files.

## Run it

```sh
npm start          # serves site/ at http://localhost:8000
npm test           # rules, lookups and data checks (Node 20+)
```

`npm start` is only `python3 -m http.server`; any static file server works.
Opening `index.html` straight from disk does not, because browsers block
module scripts and `fetch` on `file://`.

## What is in the game

| Feature | Notes |
|---|---|
| Seven letters, centre letter required | Tap the letters or type. Enter submits, Backspace deletes, Space shuffles. |
| Scoring | 4 letters = 1 point, longer = 1 point per letter, a word using all seven letters (a *septet*) = +7. |
| Ranks | Ten ranks from Tuning Up to Maestro, each a share of the day's points. Tap the rank to see the thresholds and copy your result. |
| Found words | Alphabetical list. Tap a word to open its card. |
| Word card | A play button that speaks the word, its meaning, a sample sentence and a picture. A word with several common meanings shows each on its own tab, most common first. |
| Hints | Word, point and septet counts, a first-letter by length grid, and two-letter starts. Can show totals or only what is left. |
| Answers | Reveals every word in the puzzle you are playing, after a confirm step, marked with the ones you found. You can keep playing; the day is flagged as revealed in Past puzzles and in the copied result. |
| Yesterday | Every answer from the previous puzzle, marked with the ones you found. Also tappable. |
| Stats | Days played, words, septets, points, streaks, and days finished at each rank. |
| Past puzzles | Replay any of the last 60 days; each day keeps its own progress. |
| Daily puzzle | Changes at local midnight. Everyone gets the same puzzle on the same date. |
| Saved progress | In the browser's `localStorage`. Nothing leaves the device. |
| Light and dark | Follows the system setting; the toggle overrides it. |

## How it works

```
tools/build_data.py      ──►  site/data/words.txt        accepted dictionary (17k words)
   (run by hand,               site/data/puzzles.json     schedule: 1,785 puzzles, ~5 years
    output committed)          site/data/defs/a..z.json   meanings and sample sentences per word
                               site/data/meta.json        build summary
tools/build_pictures.mjs ──►  site/data/pics/a..z.json   optional picture index (not included)

site/index.html + css/ + js/     the game; loads the data files with fetch()
   js/core.js      rules: scoring, validation, ranks, hints, schedule
   js/lookup.js    definitions and pictures for the word card
   js/audio.js     pronunciation for the word card
   js/app.js       the page
```

The browser picks the day's puzzle from the schedule by date, then finds its
answers by filtering the dictionary. The data is generated ahead of time and
committed, so hosting needs no build step and no backend.

### Which words are accepted

The New York Times does not publish a dictionary for its game: the list is
curated by hand by its editor, who leaves out anything obscure, hyphenated,
offensive, or a proper noun. Septet follows the same policy with open data:

1. **Start from SCOWL**, a set of word lists graded by how common each word
   is. Only lower-case entries are used, which excludes proper nouns,
   abbreviations, hyphenated words and contractions. American spellings only.
2. **Keep the common ones.** Each word needs a minimum frequency in real text
   (from `wordfreq`), and the bar rises with SCOWL's rarity tier. The
   reference-dictionary tier is excluded outright.
3. **Drop offensive words** using a profanity list, including inflected forms.
4. **Curate by hand** for what the rules cannot see. The files in
   `tools/curation/` are plain text:
   - `deny.txt` removes words (names that double as words, British-only
     terms, slurs the list missed).
   - `allow.txt` adds words (ramen, tahini, mojo).
   - `not_offensive.txt` rescues ordinary words the profanity list flags.

A puzzle is used only if it has 20 to 55 words, 70 to 260 points, and at
least one septet that is a reasonably common word. Each set of seven letters
appears once.

To change the dictionary, edit the curation files and rebuild.

### Definitions

Definitions are bundled, so they appear instantly and work offline. They come
from Princeton's WordNet, which records how often each sense of a word occurs
in hand-tagged American text; the build takes the most used sense. Because
those counts come from a small, older corpus, two more things apply:

- `tools/curation/senses.txt` pins the everyday meaning where the count picks
  an odd one (`table: a piece of furniture having a smooth flat top`).
- `tools/curation/definitions.json` holds hand-written entries for words
  WordNet lacks, mostly function words (*that*, *with*) and recent ones
  (*emoji*, *hoodie*).

About 1 word in 70 still has no bundled definition; for those the browser
asks Wiktionary. Every card links to the full Merriam-Webster entry.

### Meanings and sample sentences

A card shows up to three meanings, most common first. The first is chosen as
described above. Others are added only when WordNet's usage counts show they
are in real use: "light" gets the glow, the lamp and the opposite of heavy;
most words get one. Where WordNet has almost nothing to go on and everyday
text clearly uses the word as another part of speech, that reading leads. To
set a word's meanings by hand, list them in `tools/curation/senses.txt`:

```
mole: burrowing mammal | congenital pigmented spot
```

Each meaning gets one sample sentence, in this order of preference:

1. a sentence written by hand in `tools/curation/sentences.txt`;
2. WordNet's own example, when it is a complete sentence using the exact
   word, because it was written for that meaning;
3. a sentence from Mozilla Common Voice's public-domain (CC0) sentence set,
   with the word used as the right part of speech.

A corpus sentence cannot be assumed to use the right meaning of a word that
has several. Unless one meaning clearly dominates, the sentence must share
vocabulary with the meaning shown and not with the others; if none does,
there is no sentence. That is deliberate: no sentence is better than one that
illustrates a different meaning. As built, 87% of defined words have a
sentence for their first meaning, and 1,464 words have more than one meaning.

### Pronunciation

The play button on the card speaks the word.

- **A recording when there is one.** Wikimedia Commons holds
  American-English pronunciation recordings named `En-us-<word>.ogg`. The
  game works out the file's address itself and plays it directly; no API is
  involved. The card links to the recording's page, which names its author
  and licence.
- **Otherwise the device's own voice.** If the recording does not load, the
  browser's built-in speech synthesizer says the word with an American
  voice when the device has one.

The browser cannot tell a missing recording from a refused request, so after
a failure the game does not ask for that file again during the visit, and
after three failures in a row it leaves recordings alone for five minutes
and uses the device's voice.

The recording and the voice are for the word as spelled. Words pronounced
differently in different meanings ("lead", "wind") are spoken one way.

### Pictures

Pictures are the lead images of Wikipedia articles, looked up from the
browser through Wikipedia's public API (free, no key) when a card opens.

- **The word's own article first.** One request for the article titled with
  the word. It is used unless it is a disambiguation page, or a place,
  person, film or company that happens to share the word ("Turkey" the
  country, "Nice" the city).
- **A category search for ambiguous nouns.** When that fails, the word is
  searched together with its category from WordNet ("mole insectivore") and
  the game takes the article titled for that sense: "Table (furniture)",
  "Turkey (bird)".
- **No picture beats a wrong picture.** Abstract words often have nothing
  suitable, and the card says so.

Each picture links to its article and to its file page, which carries the
author and licence.

Wikipedia limits how many requests an address may make. A person tapping
words is far below that, but if a lookup is refused the card simply shows no
picture, and the next tap tries again.

**Optional picture index.** `tools/build_pictures.mjs` can do the first step
ahead of time for the whole dictionary and write `site/data/pics/`, so most
pictures need no lookup at all. The index is not included in this
repository: it takes about 350 requests, and it has to be run from a network
that is within Wikipedia's
[rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits),
identifying whoever runs it. The game works the same with or without it.

## Rebuilding the data

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r tools/requirements.txt  # wordfreq, nltk
python tools/build_data.py            # dictionary, puzzles, definitions
npm test                              # checks the new files

# optional: picture index (see "Pictures" above)
SEPTET_CONTACT=<your URL or email> node tools/build_pictures.mjs
```

`build_data.py --report` prints extra detail for tuning the word list. Its
sources (about 100 MB, most of it the sentence corpus) are downloaded once
into `tools/.cache/` and verified by checksum.
`build_pictures.mjs` caches each batch, makes one request at a time, and
stops as soon as Wikipedia asks it to slow down; run it again later to
resume.
The puzzle order comes from a fixed seed, so a rebuild with the same inputs
gives the same schedule. Changing the dictionary can change which puzzle
falls on which date.

## Hosting for free

`site/` is the whole site. Any static host will do; two that cost nothing:

- **GitHub Pages** (free for public repositories). The workflow in
  `.github/workflows/ci.yml` runs the tests and deploys `site/` on every push
  to `main`. One-time setup: make the repository public, then in
  *Settings → Pages* set *Source* to *GitHub Actions*. While the repository is
  private the deploy job is skipped.
- **Cloudflare Pages** (free, works with private repositories). Connect the
  repository, leave the build command empty, and set the output directory to
  `site`. Netlify and Vercel work the same way.

Definitions and pictures need no account or key on any host.

## Credits

Word list, definitions and pictures come from open projects; see
[CREDITS.md](CREDITS.md) for sources and licences.
