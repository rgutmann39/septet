# Septet

A daily word game for the browser. You get seven letters, one of them in the
middle, and find as many words as you can. Every word needs the middle letter,
letters can repeat, and there is never an S.

It plays by the rules of the seven-letter "word hive" genre made popular by
the New York Times Spelling Bee, with its own name, look, ranks, word list and
puzzles. Tap any word you have found (or any of yesterday's answers) to see
its most common meaning and a picture.

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
| Found words | Alphabetical list. Tap a word for its definition and a picture. |
| Hints | Word, point and septet counts, a first-letter by length grid, and two-letter starts. Can show totals or only what is left. |
| Yesterday | Every answer from the previous puzzle, marked with the ones you found. Also tappable. |
| Stats | Days played, words, septets, points, streaks, and days finished at each rank. |
| Past puzzles | Replay any of the last 60 days; each day keeps its own progress. |
| Daily puzzle | Changes at local midnight. Everyone gets the same puzzle on the same date. |
| Saved progress | In the browser's `localStorage`. Nothing leaves the device. |
| Light and dark | Follows the system setting; the toggle overrides it. |

## How it works

```
tools/build_data.py  ──►  site/data/words.txt        accepted dictionary (17k words)
   (run by hand,           site/data/puzzles.json     schedule: 1,785 puzzles, ~5 years
    output committed)      site/data/defs/a..z.json   one definition per word
                           site/data/meta.json        build summary

site/index.html + css/ + js/     the game; loads the data files with fetch()
   js/core.js      rules: scoring, validation, ranks, hints, schedule
   js/lookup.js    definitions and pictures for the word card
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

### Pictures

Pictures come from Wikipedia's public API, called directly from the browser
(free, no key). For each word the game asks for the lead image of the article
with that title, and for nouns it also searches for the word plus its
category from WordNet ("mole insectivore") so that an ambiguous word gets the
picture that matches the definition shown. Disambiguation pages, and articles
about a place, person, film or company that happens to share the word, are
skipped. Abstract words often have no good picture; the card says so rather
than show a wrong one. Each picture links to its article and to its file
page, which carries the author and licence.

## Rebuilding the data

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r tools/requirements.txt
python tools/build_data.py            # add --report for tuning detail
npm test                              # checks the new files
```

Sources are downloaded once into `tools/.cache/` and verified by checksum.
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
