#!/usr/bin/env python3
"""Build the static data files the game ships with.

Everything the browser needs is generated here, once, and committed under
``site/data`` so the site can be hosted as plain static files:

    site/data/words.txt        accepted dictionary, one word per line
    site/data/puzzles.json     daily puzzle schedule (letters, centre first)
    site/data/defs/<a-z>.json  most common definition for every accepted word
    site/data/meta.json        build summary (counts, sources)

Sources (all free / openly licensed, see CREDITS.md):

    SCOWL         word lists graded by how common a word is
    wordfreq      corpus frequencies, used to drop obscure words
    WordNet       definitions, ordered by how often each sense is used
    Common Voice  short everyday sentences, used as sample sentences
    badwords      profanity list, used to drop offensive words

Usage:
    pip install -r tools/requirements.txt
    python tools/build_data.py
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import random
import re
import sys
import tarfile
import urllib.request
import zipfile
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

from wordfreq import zipf_frequency

from sentences import SentenceBank, stems

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache"
CURATION = Path(__file__).resolve().parent / "curation"
OUT = ROOT / "site" / "data"

# --------------------------------------------------------------------------
# Sources. Each download is pinned by checksum so a build is reproducible and
# a changed upstream file is noticed rather than silently used.
# --------------------------------------------------------------------------
SOURCES = {
    "scowl": {
        "url": "https://registry.npmjs.org/wordlist-english/-/wordlist-english-1.2.1.tgz",
        "sha256": "478eb732b831172d8212d26628fab33df08585b821fcfffa871760e060c76432",
        "label": "SCOWL (via wordlist-english 1.2.1)",
    },
    "wordnet": {
        "url": "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet31.zip",
        "sha256": "2a9e7da7d0c17ad875e4171a4d28ae17ab6969c7d67f1cf0f59d65c66d0fdd37",
        "label": "Princeton WordNet 3.1",
    },
    "badwords": {
        "url": "https://registry.npmjs.org/badwords-list/-/badwords-list-2.0.1-4.tgz",
        "sha256": "7258b2840d03f6d8e118dbe137ed18e6fc022f58d976dab8498e4b7d252412c0",
        "label": "badwords-list 2.0.1-4",
    },
    "sentences_wiki": {
        "url": "https://raw.githubusercontent.com/common-voice/common-voice/main/server/data/en/wiki.en.txt",
        "sha256": "438e55e8bc91dfa6cbe098a7233702c6b177c5ae07137a01d66b9c75c9789ae5",
        "label": "Mozilla Common Voice sentences (CC0)",
    },
    "sentences_misc": {
        "url": "https://raw.githubusercontent.com/common-voice/common-voice/main/server/data/en/sentence-collector.txt",
        "sha256": "31ac8e200449ebd7aee4a8c6bd16d4dafd076cf11f7c3efe1035f0283712d136",
        "label": "Mozilla Common Voice sentences (CC0)",
    },
    "tagger": {
        "url": "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/taggers/averaged_perceptron_tagger_eng.zip",
        "sha256": "6025f530624335c67d6547d44757b357b4e79bae030a0383e9887a92c1718f0b",
        "label": "NLTK part-of-speech tagger",
    },
}

# --------------------------------------------------------------------------
# Game rules that shape the data.
# --------------------------------------------------------------------------
MIN_LENGTH = 4
BANNED_LETTERS = set("s")
LETTERS_PER_PUZZLE = 7

# A word is accepted when it is common enough. SCOWL grades words into tiers
# (10 = the most common, 70 = large dictionary); the rarer the tier, the more
# corpus evidence (Zipf frequency, roughly log10 of uses per billion words) a
# word needs before it is let in. Tier 70 is reference-dictionary territory
# and is only reachable through curation/allow.txt.
MIN_ZIPF_BY_TIER = {10: 1.0, 20: 1.0, 35: 1.0, 40: 1.0, 50: 1.8, 55: 2.3, 60: 2.6}

# Puzzle selection: enough words to be satisfying, few enough to finish.
PUZZLE_MIN_WORDS = 20
PUZZLE_MAX_WORDS = 55
PUZZLE_MIN_POINTS = 70
PUZZLE_MAX_POINTS = 260
# Every puzzle needs a word using all seven letters that a player can
# reasonably be expected to know.
FAIR_SEPTET_MIN_ZIPF = 2.6
SCHEDULE_SEED = 20261101
SCHEDULE_EPOCH = "2026-11-01"

# A word gets more than one meaning on its card only when the others are in
# real use too. WordNet's usage counts decide: another reading of the word (a
# different part of speech or base form) needs a few sightings; a second sense
# of the same reading also has to hold a fair share next to the first.
MIN_SENSE_COUNT = 5
SAME_READING_SHARE = 0.25
MAX_SENSES = 3

POS_NAMES = {"n": "noun", "v": "verb", "a": "adjective", "r": "adverb"}
# Senses that are rarely the one meant when nothing says otherwise: a field
# label ("(astronomy) ..."), a taxonomic rank ("a genus of ..."), or a material
# taken from the thing ("flesh of ...", "wood of ...") rather than the thing.
SIDE_SENSE = re.compile(r"\(|(a |type )?genus\b|family of\b|(wool|fur|wood|flesh) of\b")

# Small nudge toward nouns when the usage counts cannot decide.
POS_BONUS = {"n": 2.5, "v": 0.5, "a": 1.0, "r": 0.0}


# --------------------------------------------------------------------------
# Downloading
# --------------------------------------------------------------------------
def fetch(name: str) -> bytes:
    """Return the bytes of a pinned source, downloading it on first use."""
    src = SOURCES[name]
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / src["url"].rsplit("/", 1)[-1]
    if not path.exists():
        print(f"  downloading {src['label']} ...")
        req = urllib.request.Request(src["url"], headers={"User-Agent": "word-game-data-build"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            path.write_bytes(resp.read())
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != src["sha256"]:
        path.unlink()
        sys.exit(
            f"Checksum mismatch for {src['label']}:\n  expected {src['sha256']}\n  got      {digest}\n"
            "The upstream file changed. Review it, then update SOURCES in tools/build_data.py."
        )
    return data


def read_curation(filename: str) -> set[str]:
    """Read a curation list: one word per line, '#' starts a comment."""
    path = CURATION / filename
    if not path.exists():
        return set()
    words = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        word = line.split("#", 1)[0].strip().lower()
        if word:
            words.add(word)
    return words


def read_pins() -> dict[str, list[str]]:
    """Read curation/senses.txt: 'word: phrase' or 'word: phrase | phrase'."""
    path = CURATION / "senses.txt"
    pins: dict[str, list[str]] = {}
    if not path.exists():
        return pins
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            word, _, phrases = line.partition(":")
            pins[word.strip().lower()] = [p.strip().lower() for p in phrases.split("|") if p.strip()]
    return pins


# --------------------------------------------------------------------------
# Word list
# --------------------------------------------------------------------------
def load_scowl() -> dict[str, int]:
    """Map each SCOWL word to its commonness tier (lowest tier wins)."""
    tier_of: dict[str, int] = {}
    pattern = re.compile(r"package/(english|american)-words-(\d+)\.json$")
    with tarfile.open(fileobj=io.BytesIO(fetch("scowl")), mode="r:gz") as tar:
        for member in tar.getmembers():
            match = pattern.match(member.name)
            if not match:
                continue
            tier = int(match.group(2))
            for word in json.load(tar.extractfile(member)):
                if tier < tier_of.get(word, 99):
                    tier_of[word] = tier
    return tier_of


def load_badwords() -> set[str]:
    with tarfile.open(fileobj=io.BytesIO(fetch("badwords")), mode="r:gz") as tar:
        source = tar.extractfile("package/dist/array.js").read().decode("utf-8")
    return {w.lower() for w in re.findall(r"'([^']+)'", source)}


def is_playable_shape(word: str) -> bool:
    """Could this string ever be an answer, going by its letters alone?"""
    return (
        word.isascii()
        and word.isalpha()
        and word.islower()
        and len(word) >= MIN_LENGTH
        and not (set(word) & BANNED_LETTERS)
        and len(set(word)) <= LETTERS_PER_PUZZLE
        and bool(set(word) & set("aeiouy"))
    )


# --------------------------------------------------------------------------
# WordNet
# --------------------------------------------------------------------------
class WordNet:
    """Just enough of WordNet: senses with usage counts, glosses, base forms."""

    # Suffix rules WordNet uses to find the base form of an inflected word.
    RULES = {
        "n": [("s", ""), ("ses", "s"), ("xes", "x"), ("zes", "z"), ("ches", "ch"),
              ("shes", "sh"), ("men", "man"), ("ies", "y")],
        "v": [("s", ""), ("ies", "y"), ("es", "e"), ("es", ""), ("ed", "e"), ("ed", ""),
              ("ing", "e"), ("ing", "")],
        "a": [("er", ""), ("est", ""), ("er", "e"), ("est", "e")],
        "r": [],
    }
    FILES = {"n": "noun", "v": "verb", "a": "adj", "r": "adv"}

    def __init__(self, archive: bytes):
        self.senses: dict[str, list[tuple[str, str, int, int]]] = defaultdict(list)
        self.synsets: dict[tuple[str, str], dict] = {}
        self.exceptions: dict[str, dict[str, list[str]]] = {}
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            def text(name: str) -> str:
                return zf.read(f"wordnet31/{name}").decode("utf-8")

            # index.sense: "lemma%type:... offset sense_number tag_count"
            for line in text("index.sense").splitlines():
                key, offset, number, count = line.split()
                lemma, rest = key.split("%", 1)
                pos = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}[rest[0]]
                self.senses[lemma].append((pos, offset, int(number), int(count)))

            for pos, name in self.FILES.items():
                for line in text(f"data.{name}").splitlines():
                    if line.startswith("  "):
                        continue  # licence header
                    head, _, gloss = line.partition(" | ")
                    fields = head.split()
                    word_count = int(fields[3], 16)
                    words = [w.replace("_", " ") for w in fields[4:4 + 2 * word_count:2]]
                    ptr_at = 4 + 2 * word_count
                    hypernym = None
                    instance = False
                    for i in range(int(fields[ptr_at])):
                        symbol, target, target_pos = fields[ptr_at + 1 + 4 * i: ptr_at + 4 + 4 * i]
                        if symbol in ("@", "@i"):
                            hypernym = (target_pos, target)
                            instance = symbol == "@i"  # one particular person, city, ...
                            break
                    self.synsets[(pos, fields[0])] = {
                        "words": words, "gloss": gloss.strip(), "hypernym": hypernym,
                        "instance": instance,
                    }

                table: dict[str, list[str]] = {}
                for line in text(f"{name}.exc").splitlines():
                    form, *bases = line.split()
                    table[form] = bases
                self.exceptions[pos] = table

    def has(self, lemma: str, pos: str) -> bool:
        return any(sense[0] == pos for sense in self.senses.get(lemma, ()))

    @staticmethod
    def forms(synset: dict) -> list[str]:
        """The synset's words as index keys: 'mint(a)' -> 'mint'."""
        return [re.sub(r"\(\w+\)$", "", w).replace(" ", "_") for w in synset["words"]]

    def common(self, lemma: str, pos: str) -> bool:
        """Does this lemma have a sense that is not a proper noun?"""
        for sense_pos, offset, _, _ in self.senses.get(lemma, ()):
            if sense_pos == pos:
                own = next((f for f in self.forms(self.synsets[(pos, offset)])
                            if f.lower() == lemma), lemma)
                if own == own.lower():
                    return True
        return False

    def base_forms(self, word: str, exact: bool = True, rules: bool = True) -> list[tuple[str, str]]:
        """Every (lemma, part of speech) this spelling can be a form of.

        ``exact`` covers the word itself and WordNet's list of irregular forms;
        ``rules`` covers regular endings such as "-ed" and "-ing".
        """
        found: list[tuple[str, str]] = []
        for pos in ("n", "v", "a", "r"):
            options: list[str] = []
            if exact:
                options += [word, *self.exceptions[pos].get(word, [])]
            if rules:
                for suffix, replacement in self.RULES[pos]:
                    if word.endswith(suffix) and len(word) > len(suffix):
                        stem = word[: -len(suffix)]
                        # "peter" is not "pet" + "-er": that would be "petter".
                        if pos == "a" and re.search(r"[^aeiou][aeiou][^aeiouwxy]$", stem):
                            continue
                        options.append(stem + replacement)
            for lemma in dict.fromkeys(options):
                if lemma != word or exact:
                    if self.has(lemma, pos) and (lemma, pos) not in found:
                        found.append((lemma, pos))
        return found

    def derived_from(self, word: str) -> list[tuple[str, str]]:
        """Looser match for words WordNet does not list, such as "blogged",
        "curvier" or "pancaked": strip a common ending and look again."""
        stems: list[str] = []
        for suffix in ("ing", "ed", "er", "est", "ly"):
            if not word.endswith(suffix):
                continue
            stem = word[: -len(suffix)]
            stems += [stem, stem + "e"]
            if len(stem) > 2 and stem[-1] == stem[-2]:
                stems.append(stem[:-1])          # blogged -> blog
            if stem.endswith("i"):
                stems.append(stem[:-1] + "y")    # curvier -> curvy
        found = []
        for lemma in dict.fromkeys(stems):
            if len(lemma) < 3:
                continue
            for pos in ("n", "v", "a", "r"):
                if self.has(lemma, pos):
                    found.append((lemma, pos))
        return found

    def readings(self, word: str) -> list[tuple[str, str, bool]]:
        """(lemma, part of speech, loosely derived?) for each way to read a word."""
        exact = [(lemma, pos, False) for lemma, pos in self.base_forms(word, rules=False)]
        ruled = [(lemma, pos, False) for lemma, pos in self.base_forms(word, exact=False)]
        # A word WordNet lists in its own right ("owner") is not read as a
        # comparative of something shorter ("own" + "-er"). Verb endings always
        # compete: "going" is far more often a form of "go" than an adjective.
        if any(self.common(lemma, pos) for lemma, pos, _ in exact):
            ruled = [r for r in ruled if r[1] != "a"]
        found = exact + ruled
        return found or [(lemma, pos, True) for lemma, pos in self.derived_from(word)]

    def candidates(self, word: str, allow_capitalized: bool = False) -> list[dict]:
        """Every sense the word could have, each with a score.

        WordNet counts how often each sense occurs in hand-tagged text, which is
        the main signal. The counts come from a small, dated corpus, so they are
        backed up by structure: a sense where the word is the synset's own
        headword gets a nudge over one where it is a synonym of something else,
        earlier senses over later ones, and names of people and places are
        skipped.
        """
        found = []
        for lemma, pos, loose in self.readings(word):
            rank = 0
            for sense_pos, offset, _, count in sorted(self.senses[lemma], key=lambda s: s[2]):
                if sense_pos != pos:
                    continue
                synset = self.synsets[(pos, offset)]
                if synset["instance"]:
                    continue  # a particular person or place
                forms = self.forms(synset)
                own = next((f for f in forms if f.lower() == lemma), lemma)
                if own != own.lower() and not allow_capitalized:
                    continue  # "China" when the word is "china"
                rank += 1
                evidence = max(0, count - 2)  # one or two sightings prove little
                score = 2.0 * math.log2(1 + evidence)
                score += 2.5 if forms[0].lower() == lemma else 0
                score -= min(rank - 1, 4)
                score += POS_BONUS[pos]
                score += 1 if lemma == word else 0
                if pos == "v" and lemma != word and word.endswith(("ing", "ed")):
                    score += 1.5  # "mending" is the verb far more often than the noun
                if evidence == 0 and SIDE_SENSE.match(synset["gloss"]):
                    score -= 3  # a specialist or by-product sense
                found.append({"lemma": lemma, "pos": pos, "offset": offset, "loose": loose,
                              "count": count, "score": score, "synset": synset})
        return found

    @staticmethod
    def _best(pool: list[dict], phrase: str | None = None) -> dict | None:
        best = None
        for sense in pool:
            if phrase and phrase not in sense["synset"]["gloss"].lower():
                continue
            if best is None or sense["score"] > best["score"]:
                best = sense
        return best

    def senses_for(self, word: str, pins: dict[str, list[str]] | None = None,
                   prefer_pos: str | None = None) -> list[dict]:
        """The meanings of ``word`` in common use, most common first.

        The first is the sense a reader is most likely to mean. Others follow
        only if WordNet's usage counts show they are in real use too (see
        ``other_common_senses``).

        ``pins`` (curation/senses.txt) overrides the choice. A pinned word uses
        the sense containing its phrase; with several phrases it gets exactly
        those senses, in that order. Forms of a pinned word follow its first pin.

        ``prefer_pos`` ("noun", "verb", ...) makes the first sense one of that
        part of speech when the word has one.
        """
        pins = pins or {}
        own = pins.get(word, [])
        pool = self.candidates(word)
        if prefer_pos and not own:
            preferred = [c for c in pool if POS_NAMES[c["pos"]] == prefer_pos]
            first = self._best(preferred)
            if first is not None:
                return [self.entry(word, sense, pool)
                        for sense in [first, *self.other_common_senses(first, pool)]]
        if own:
            first = self._best(pool, own[0])
        else:
            # A pin on a base form is a preference ("made" follows "make"); when
            # it leaves nothing ("banked" is a verb, the pin for "bank" a noun)
            # the ordinary choice applies.
            following = [c for c in pool if not pins.get(c["lemma"])
                         or pins[c["lemma"]][0] in c["synset"]["gloss"].lower()]
            first = self._best(following) or self._best(pool)
        if first is None:
            # Capitalized senses ("Brie") are a last resort.
            pool = self.candidates(word, allow_capitalized=True)
            first = self._best(pool, own[0] if own else None)
        if first is None:
            return []

        chosen = [first]
        if len(own) > 1:
            for phrase in own[1:]:
                extra = self._best([c for c in pool if c not in chosen], phrase)
                if extra:
                    chosen.append(extra)
        else:
            chosen += self.other_common_senses(first, pool)
        return [self.entry(word, sense, pool) for sense in chosen]

    def other_common_senses(self, first: dict, pool: list[dict]) -> list[dict]:
        """Further senses in real use, by how often WordNet saw each."""
        def reading(sense: dict) -> tuple[str, str]:
            return sense["lemma"], sense["pos"]

        by_reading: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for sense in pool:
            by_reading[reading(sense)].append(sense)

        eligible = []
        for key, members in by_reading.items():
            if key == reading(first):
                # More senses of the same reading: each must hold its own
                # beside the most used one ("light" the lamp beside the glow).
                top = max(m["count"] for m in members)
                eligible += [m for m in members if m is not first
                             and m["count"] >= max(MIN_SENSE_COUNT, SAME_READING_SHARE * top)]
            else:
                # Another reading altogether ("left" the direction beside
                # "left" from "leave"): its leading sense, if it is in use.
                lead = self._best(members)
                if lead["count"] >= MIN_SENSE_COUNT:
                    eligible.append(lead)

        chosen: list[dict] = []
        used = Counter([reading(first)])
        for sense in sorted(eligible, key=lambda m: -m["count"]):
            if len(chosen) + 1 >= MAX_SENSES:
                break
            if used[reading(sense)] >= 2:
                continue
            if any(self.near_duplicate(sense, other) for other in [first, *chosen]):
                continue
            chosen.append(sense)
            used[reading(sense)] += 1
        return chosen

    @staticmethod
    def near_duplicate(a: dict, b: dict) -> bool:
        """WordNet splits hairs; two senses a reader would call one meaning."""
        if (a["pos"], a["offset"]) == (b["pos"], b["offset"]):
            return True
        if a["pos"] == b["pos"] == "n" and a["synset"]["hypernym"] \
                and a["synset"]["hypernym"] == b["synset"]["hypernym"]:
            return True  # two kinds of the same thing
        words_a = stems(split_gloss(a["synset"]["gloss"])[0])
        words_b = stems(split_gloss(b["synset"]["gloss"])[0])
        shared = len(words_a & words_b)
        return shared >= 0.4 * len(words_a | words_b) or shared == min(len(words_a), len(words_b)) > 0

    def entry(self, word: str, sense: dict, pool: list[dict]) -> dict:
        """The card entry for one sense. Keys starting with '_' are working
        data for choosing a sample sentence and are not written out."""
        lemma, pos, synset = sense["lemma"], sense["pos"], sense["synset"]
        definition, examples = split_gloss(synset["gloss"])
        entry = {"pos": POS_NAMES[pos], "definition": definition}
        if lemma != word:
            # "lemma": word is an inflection of it. "from": word is built on it.
            entry["from" if sense["loose"] else "lemma"] = lemma
        meaning = stems(definition) | stems(synset["words"])
        parent = self.synsets.get(synset["hypernym"]) if synset["hypernym"] else None
        if parent:
            meaning |= stems(split_gloss(parent["gloss"])[0]) | stems(parent["words"])
            if pos == "n":
                entry["kind"] = parent["words"][0]
        for example in examples:
            meaning |= stems(example)
        entry["_examples"] = examples
        entry["_meaning"] = meaning - stems([word, lemma])
        entry["_count"] = sense["count"]
        # Can a sentence from the corpus be assumed to use this sense? Yes if
        # the reading has no other sense; if it has only one or two and none is
        # in real use; or if this sense clearly dominates the rest. A word with
        # many unranked senses ("mole", "pitch") gives no such assurance.
        others = [c["count"] for c in pool
                  if (c["lemma"], c["pos"]) == (lemma, pos) and c is not sense]
        entry["_usual"] = (
            not others
            or (len(others) <= 2 and max(others) < MIN_SENSE_COUNT)
            or (sense["count"] >= 10 and sense["count"] >= 2 * max(others)))
        return entry


def split_gloss(gloss: str) -> tuple[str, list[str]]:
    """Split a WordNet gloss into its definition and its example phrases."""
    definition, _, rest = gloss.partition('; "')
    examples = [e.strip() for e in re.findall(r'"([^"]+)"', '"' + rest)] if rest else []
    return definition.strip().rstrip(";:").strip(), examples


# --------------------------------------------------------------------------
# Sample sentences
# --------------------------------------------------------------------------
def load_sentence_bank(words: list[str], senses: dict[str, list[dict]], tier_of: dict[str, int],
                       blocked: set[str]) -> SentenceBank:
    """Index the sentence corpus for every word and every base form."""
    import nltk

    tagger_dir = CACHE / "nltk_data" / "taggers"
    if not (tagger_dir / "averaged_perceptron_tagger_eng").exists():
        tagger_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(fetch("tagger"))) as zf:
            zf.extractall(tagger_dir)
    nltk.data.path.insert(0, str(CACHE / "nltk_data"))

    targets = set(words)
    for entries in senses.values():
        targets.update(e.get("lemma") or e.get("from") or "" for e in entries)
    targets.discard("")
    common = {w for w, tier in tier_of.items() if tier <= 60 and w.islower()}
    lines = (line for name in ("sentences_wiki", "sentences_misc")
             for line in fetch(name).decode("utf-8").splitlines())
    return SentenceBank(lines, targets, common, blocked, lambda w: zipf_frequency(w, "en"))


def tidy_sentence(text: str) -> str:
    text = " ".join(text.replace("`", "'").split())
    text = text[0].upper() + text[1:]
    if len(text.split()) >= 4 and text[-1] not in ".!?":
        text += "."
    return text


def read_sentences() -> dict[tuple[str, int], str]:
    """Read curation/sentences.txt: 'word: sentence' or 'word#2: sentence'."""
    path = CURATION / "sentences.txt"
    written: dict[tuple[str, int], str] = {}
    if not path.exists():
        return written
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            key, _, sentence = line.partition(":")
            word, _, number = key.strip().lower().partition("#")
            written[(word, int(number or 1) - 1)] = sentence.strip()
    return written


def choose_sentence(word: str, index: int, senses: list[dict], bank: SentenceBank,
                    written: dict[tuple[str, int], str]) -> str | None:
    """One sample sentence showing ``word`` used in its ``index``-th sense.

    In order: a sentence written by hand (curation/sentences.txt); WordNet's
    own example when it is a complete sentence with this exact word, since it
    was written for this sense; a sentence from the corpus with the word in the
    right part of speech. A corpus sentence cannot be assumed to use the right
    sense of a word that has several, so unless this sense clearly dominates it
    must share vocabulary with this sense and not with the others. Failing all
    that, a WordNet phrase, or nothing: no sentence beats a misleading one.
    """
    sense = senses[index]
    if (word, index) in written:
        return written[(word, index)]
    if sense.get("example"):
        return sense["example"]  # hand-written entry
    base = sense.get("lemma") or sense.get("from")
    examples = sense.get("_examples", [])

    def has(text: str, form: str, whole: bool) -> bool:
        return bool(re.search(rf"\b{re.escape(form)}" + (r"\b" if whole else ""), text, re.I))

    exact = [e for e in examples if has(e, word, True)]
    related = [e for e in examples if has(e, word, False) or (base and has(e, base, False))]

    for example in exact:
        if bank.sentence_like(example, word):
            return example
    # Only senses sharing this part of speech can be confused with this one;
    # the corpus sentence is already known to use the right part of speech.
    meaning = sense.get("_meaning", stems(sense["definition"]))
    rivals = [s.get("_meaning", stems(s["definition"])) for s in senses
              if s is not sense and s["pos"] == sense["pos"]]
    found = bank.pick(word, sense["pos"], meaning, rivals,
                      must_fit=bool(rivals) or not sense.get("_usual", True))
    if found:
        return found
    for pool in (exact, [e for e in related if bank.sentence_like(e, base or word)], related):
        if pool:
            return pool[0]
    if base and index == 0 and sense.get("_usual", True):
        # Last resort for a rare inflection: a sentence with its base form.
        return bank.pick(base, sense["pos"])
    return None


# --------------------------------------------------------------------------
# Puzzles
# --------------------------------------------------------------------------
def mask_of(word: str) -> int:
    mask = 0
    for ch in set(word):
        mask |= 1 << (ord(ch) - 97)
    return mask


def word_points(word: str) -> int:
    points = 1 if len(word) == MIN_LENGTH else len(word)
    if len(set(word)) == LETTERS_PER_PUZZLE:
        points += LETTERS_PER_PUZZLE
    return points


def build_puzzles(words: list[str], zipf: dict[str, float]) -> tuple[list[str], dict]:
    by_mask: dict[int, list[str]] = defaultdict(list)
    for word in words:
        by_mask[mask_of(word)].append(word)

    septet_masks = [m for m in by_mask if bin(m).count("1") == LETTERS_PER_PUZZLE]
    chosen: list[tuple[str, int, int]] = []
    for mask in septet_masks:
        if max(zipf[w] for w in by_mask[mask]) < FAIR_SEPTET_MIN_ZIPF:
            continue
        letters = [chr(97 + i) for i in range(26) if mask >> i & 1]
        bits = [1 << (ord(ch) - 97) for ch in letters]
        # Every word playable with these letters uses a subset of them.
        playable: list[tuple[int, str]] = []
        for size in range(1, LETTERS_PER_PUZZLE + 1):
            for combo in combinations(bits, size):
                sub = sum(combo)
                for word in by_mask.get(sub, ()):
                    playable.append((sub, word))

        options = []
        for letter, bit in zip(letters, bits):
            answers = [w for sub, w in playable if sub & bit]
            count = len(answers)
            points = sum(word_points(w) for w in answers)
            if (PUZZLE_MIN_WORDS <= count <= PUZZLE_MAX_WORDS
                    and PUZZLE_MIN_POINTS <= points <= PUZZLE_MAX_POINTS):
                options.append((letter, count, points))
        if not options:
            continue
        # One puzzle per letter set, so no two days feel like reruns. Take the
        # centre letter whose puzzle is closest to a comfortable size.
        letter, count, points = min(options, key=lambda o: (abs(o[1] - 36), o[0]))
        outer = "".join(ch for ch in letters if ch != letter)
        chosen.append((letter + outer, count, points))

    chosen.sort()
    random.Random(SCHEDULE_SEED).shuffle(chosen)
    counts = sorted(c for _, c, _ in chosen)
    points = sorted(p for _, _, p in chosen)
    stats = {
        "puzzles": len(chosen),
        "medianWords": counts[len(counts) // 2] if counts else 0,
        "medianPoints": points[len(points) // 2] if points else 0,
    }
    return [letters for letters, _, _ in chosen], stats


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--report", action="store_true",
                        help="print extra detail useful when tuning the word list")
    args = parser.parse_args()

    print("Loading sources")
    tier_of = load_scowl()
    wordnet = WordNet(fetch("wordnet"))
    blocked = load_badwords() | read_curation("deny.txt")
    allow = read_curation("allow.txt")
    not_offensive = read_curation("not_offensive.txt")
    blocked -= not_offensive

    print("Selecting words")
    zipf: dict[str, float] = {}
    accepted: set[str] = set()
    dropped = Counter()
    for word, tier in tier_of.items():
        if not is_playable_shape(word):
            continue
        freq = zipf_frequency(word, "en")
        threshold = MIN_ZIPF_BY_TIER.get(tier)
        if threshold is None or freq < threshold:
            dropped["too obscure"] += 1
            continue
        zipf[word] = freq
        accepted.add(word)

    for word in allow:
        if not is_playable_shape(word):
            sys.exit(f"curation/allow.txt: '{word}' can never be an answer (check its letters)")
        accepted.add(word)
        zipf[word] = max(zipf_frequency(word, "en"), FAIR_SEPTET_MIN_ZIPF)

    # Offensive words go, along with their inflections ("-ed", "-ing", ...).
    for word in sorted(accepted):
        forms = {word} | {lemma for lemma, _ in wordnet.base_forms(word)}
        if forms & blocked:
            accepted.discard(word)
            dropped["offensive or denied"] += 1

    words = sorted(accepted)

    print("Building puzzles")
    puzzles, puzzle_stats = build_puzzles(words, zipf)

    print("Choosing meanings")
    extra = {}
    extra_path = CURATION / "definitions.json"
    if extra_path.exists():
        extra = json.loads(extra_path.read_text(encoding="utf-8"))
    pins = read_pins()
    bad_pins: list[str] = []
    senses: dict[str, list[dict]] = {}
    undefined = []
    for word in words:
        if word in extra:
            # Hand-written: the entry itself, then any under its "more" key.
            written = dict(extra[word])
            senses[word] = [written, *written.pop("more", [])]
            continue
        found = wordnet.senses_for(word, pins)
        for i, phrase in enumerate(pins.get(word, [])):
            if i >= len(found) or phrase not in found[i]["definition"].lower():
                bad_pins.append(f"  {word}: no sense mentions '{phrase}'")
        if found:
            senses[word] = found
        else:
            undefined.append(word)

    if bad_pins:
        sys.exit("curation/senses.txt has pins that match nothing:\n" + "\n".join(bad_pins))

    print("Choosing sample sentences")
    bank = load_sentence_bank(words, senses, tier_of, blocked)

    # WordNet's counts are thin for many words. Where it has next to nothing to
    # go on and everyday text clearly uses the word as another part of speech
    # ("liberal" as an adjective, not a kind of person), lead with that.
    releaded = 0
    for word, entries in senses.items():
        if word in extra or word in pins or entries[0].get("_count", 99) > 4:
            continue
        shares = bank.pos_shares(word)
        usual = max(shares, key=shares.get, default=None)
        if usual and usual != entries[0]["pos"] and shares[usual] >= 0.6:
            again = wordnet.senses_for(word, pins, prefer_pos=usual)
            if again and again[0]["pos"] == usual:
                senses[word] = again
                releaded += 1

    written = read_sentences()
    unknown = sorted({word for word, _ in written} - set(senses))
    if unknown:
        sys.exit("curation/sentences.txt names words that are not in the dictionary: " + ", ".join(unknown))
    shards: dict[str, dict] = defaultdict(dict)
    with_sentence = 0
    for word, entries in senses.items():
        chosen = [choose_sentence(word, i, entries, bank, written) for i in range(len(entries))]
        cards = []
        for entry, sentence in zip(entries, chosen):
            card = {key: value for key, value in entry.items() if not key.startswith("_")}
            if sentence:
                card["example"] = tidy_sentence(sentence)
            cards.append(card)
        with_sentence += "example" in cards[0]
        if len(cards) > 1:
            cards[0]["more"] = cards[1:]
        shards[word[0]][word] = cards[0]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "defs").mkdir(exist_ok=True)
    for old in (OUT / "defs").glob("*.json"):
        old.unlink()
    (OUT / "words.txt").write_text("\n".join(words) + "\n", encoding="utf-8")
    for letter, entries in sorted(shards.items()):
        (OUT / "defs" / f"{letter}.json").write_text(
            json.dumps(entries, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
            encoding="utf-8",
        )
    (OUT / "puzzles.json").write_text(
        json.dumps({"epoch": SCHEDULE_EPOCH, "puzzles": puzzles}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    several = sum(1 for entries in senses.values() if len(entries) > 1)
    meta = {
        "words": len(words),
        "defined": len(words) - len(undefined),
        "withSentence": with_sentence,
        "severalMeanings": several,
        **puzzle_stats,
        "sources": list(dict.fromkeys(src["label"] for src in SOURCES.values()))
                   + ["wordfreq (corpus frequencies)"],
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"\n  {len(words):>6} accepted words   ({dict(dropped)})")
    print(f"  {meta['defined']:>6} with a bundled definition ({len(undefined)} without)")
    print(f"  {with_sentence:>6} of those with a sample sentence "
          f"({with_sentence / max(1, meta['defined']):.0%}); {several} with more than one meaning")
    print(f"         ({releaded} words lead with the part of speech everyday text uses)")
    print(f"  {puzzle_stats['puzzles']:>6} puzzles           "
          f"(median {puzzle_stats['medianWords']} words, {puzzle_stats['medianPoints']} points)")
    years = puzzle_stats["puzzles"] / 365.25
    print(f"         = {years:.1f} years of daily puzzles before the schedule repeats")

    if args.report:
        by_freq = sorted(undefined, key=lambda w: -zipf[w])
        print("\nMost common words without a bundled definition:")
        print("  " + " ".join(by_freq[:150]))
        (CACHE / "undefined.txt").write_text("\n".join(by_freq) + "\n", encoding="utf-8")
        print(f"\nFull list written to {CACHE / 'undefined.txt'}")


if __name__ == "__main__":
    main()
