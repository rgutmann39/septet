# Credits and licences

Septet is built on open data. None of it costs anything to use.

| What | Source | Used | Licence |
|---|---|---|---|
| Word list | [SCOWL](http://wordlist.aspell.net/) by Kevin Atkinson, packaged as [wordlist-english](https://www.npmjs.com/package/wordlist-english) | Build time; the filtered list ships in `site/data/words.txt` | SCOWL licence, see `licenses/SCOWL-Copyright.txt` |
| Definitions | [WordNet 3.1](https://wordnet.princeton.edu/), Princeton University | Build time; definitions ship in `site/data/defs/` | WordNet licence, see `licenses/WordNet-LICENSE.txt` |
| Word frequencies | [wordfreq](https://github.com/rspeer/wordfreq) by Robyn Speer | Build time only, to decide which words are common enough; its data is not redistributed | Code MIT, data CC BY-SA 4.0 |
| Sample sentences | [Mozilla Common Voice](https://github.com/common-voice/common-voice) English sentence set | Build time; chosen sentences ship in `site/data/defs/` | CC0 (public domain) |
| Part-of-speech tagger | [NLTK](https://www.nltk.org/) averaged perceptron tagger | Build time only, to check how a sentence uses a word | Apache 2.0 |
| Pronunciation recordings | [Wikimedia Commons](https://commons.wikimedia.org/) `En-us-*.ogg` files | In the browser, when the play button is pressed; each links to its file page, which names the author and licence | Varies per recording (free licences) |
| Profanity list | [badwords-list](https://www.npmjs.com/package/badwords-list) | Build time only, to drop offensive words | MIT |
| Backup definitions | [Wiktionary](https://en.wiktionary.org/) | In the browser, for the few words WordNet lacks | CC BY-SA 4.0 |
| Pictures | [Wikipedia](https://en.wikipedia.org/) and [Wikimedia Commons](https://commons.wikimedia.org/) | In the browser; each picture links to its article and its file page, which name the author and licence | Varies per image (free licences) |

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.
The definitions in `site/data/defs/` are taken from WordNet, selected and
lightly reformatted by `tools/build_data.py`; a small number are written by
hand in `tools/curation/definitions.json`. Sample sentences come from WordNet,
from Common Voice, or are written by hand in `tools/curation/sentences.txt`.

Septet is an independent project. It is not affiliated with, or endorsed by,
any publisher of other word games.
