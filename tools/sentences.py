"""Pick one natural sample sentence for a word from an open sentence corpus.

The corpus is Mozilla Common Voice's English sentence set (CC0): short,
modern, complete sentences. For each target word we keep the best few
sentences that contain it, then choose one in which the word is used as the
wanted part of speech and, for a word with several meanings, one that fits
the wanted meaning better than the others.
"""

from __future__ import annotations

import heapq
import re
from collections.abc import Callable, Iterable

# Letters, spaces, commas, apostrophes and hyphens only: no quotations,
# brackets, numbers or lists.
SHAPE = re.compile(r"^[A-Z][A-Za-z ,'\-]*[.!?]?$")
TOKEN = re.compile(r"[A-Za-z]+(?:'[a-z]+)?")

# Tags (Penn Treebank) that count as each part of speech.
TAGS = {
    "noun": ("NN", "CD"),
    "verb": ("VB", "MD"),
    "adjective": ("JJ", "CD"),           # WordNet files numbers under adjectives
    "adverb": ("RB", "IN", "RP"),        # ... and prepositions under adverbs
    "preposition": ("IN", "TO", "RP"),
    "pronoun": ("PRP", "WP", "WDT", "DT"),
    "conjunction": ("CC", "IN"),
    "interjection": ("UH",),
}
COARSE = {"NN": "noun", "VB": "verb", "MD": "verb", "JJ": "adjective", "RB": "adverb"}
FINITE = ("VBD", "VBZ", "VBP", "MD")
# Dictionary phrasing ("make a mess in one's office") rather than a sentence.
PLACEHOLDERS = {"one's", "oneself", "someone", "somebody", "something", "someone's"}

STOP = set("""
a an and are as at be been being but by can could did do does for from had has have he her
his how if in into is it its may might more most must no not of on one or other our out over
shall she should so some such than that the their them then there these they this those to
under up very was we were what when where which who whom will with would you your any each
used using use especially usually often also something someone somebody one's kind
""".split())

WEAK_OPENERS = {"it", "this", "these", "those", "he", "she", "they", "however", "also"}


def stems(text: str | Iterable[str]) -> set[str]:
    """Content words of a text, crudely stemmed, for comparing meanings."""
    tokens = TOKEN.findall(text.lower()) if isinstance(text, str) else [t.lower() for t in text]
    out = set()
    for token in tokens:
        token = token.split("'")[0]
        if len(token) < 3 or token in STOP:
            continue
        for suffix, replacement in (("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", "")):
            if token.endswith(suffix) and len(token) - len(suffix) >= 3:
                token = token[: -len(suffix)] + replacement
                break
        out.add(token)
    return out


class SentenceBank:
    """The best candidate sentences for each target word."""

    def __init__(self, lines: Iterable[str], targets: set[str], common: set[str],
                 blocked: set[str], zipf: Callable[[str], float], keep: int = 24):
        self.candidates: dict[str, list[tuple[float, str]]] = {}
        self.read = 0
        self.usable = 0
        self._tags: dict[str, list[tuple[str, str]]] = {}
        self._tagger = None
        cache: dict[str, float] = {}

        def frequency(token: str) -> float:
            value = cache.get(token)
            if value is None:
                value = cache[token] = zipf(token)
            return value

        for line in lines:
            self.read += 1
            sentence = line.strip()
            if not 20 <= len(sentence) <= 110 or not SHAPE.match(sentence):
                continue
            tokens = TOKEN.findall(sentence)
            if not 4 <= len(tokens) <= 18:
                continue
            lower = [t.lower() for t in tokens]
            hits = [i for i in range(1, len(tokens)) if tokens[i] == lower[i] and lower[i] in targets]
            if not hits:
                continue
            bare = [t.split("'")[0] for t in lower]
            if any(t in blocked for t in bare):
                continue
            names = [i for i in range(1, len(tokens)) if tokens[i] != lower[i] and tokens[i] != "I"]
            plain = [frequency(bare[i]) for i in range(len(tokens)) if i not in names]
            if min(plain) < 1.0:
                continue
            self.usable += 1

            quality = sum(plain) / len(plain)
            quality -= 0.4 * abs(len(tokens) - 8)
            quality += 0.5 if sentence.endswith(".") else 0
            quality -= 0.4 if bare[0] in WEAK_OPENERS else 0
            # The cleanest sentences have no names, everyday words, and an
            # ordinary opening word; anything else is kept only as a fallback.
            clean = (not names and 5 <= len(tokens) <= 14 and min(plain) >= 2.0
                     and bare[0] in common)
            quality -= 0 if clean else 4

            for i in hits:
                if "-" in sentence and self._hyphenated(sentence, tokens[i]):
                    continue
                heap = self.candidates.setdefault(lower[i], [])
                item = (quality - 0.02 * i, sentence)
                if len(heap) < keep:
                    heapq.heappush(heap, item)
                elif item > heap[0]:
                    heapq.heapreplace(heap, item)

    @staticmethod
    def _hyphenated(sentence: str, token: str) -> bool:
        """Is the word only present as part of a hyphenated compound?"""
        return not re.search(rf"(?<![A-Za-z\-]){re.escape(token)}(?![A-Za-z\-])", sentence)

    def _tagged(self, sentence: str) -> list[tuple[str, str]]:
        tags = self._tags.get(sentence)
        if tags is None:
            if self._tagger is None:
                from nltk.tag.perceptron import PerceptronTagger
                self._tagger = PerceptronTagger(lang="eng")
            tags = self._tags[sentence] = self._tagger.tag(TOKEN.findall(sentence))
        return tags

    def sentence_like(self, text: str, word: str) -> bool:
        """Is this a complete sentence, as opposed to a phrase such as
        "a cold unfriendly nod" or "make a mess in one's office"?"""
        tokens = TOKEN.findall(text)
        if len(tokens) < 4 or PLACEHOLDERS & {t.lower() for t in tokens}:
            return False
        tags = self._tagged(text)
        if tags[0][1].startswith("VB") or tokens[0].lower() == word:
            return False  # "Took the right road", "Apply for a job": no subject
        return any(tag in FINITE for _, tag in tags)

    def pos_shares(self, word: str) -> dict[str, float]:
        """How the corpus uses the word: share of sentences per part of speech."""
        counts: dict[str, int] = {}
        for _, sentence in self.candidates.get(word, ()):
            tag = next((t for token, t in self._tagged(sentence)[1:] if token == word), None)
            coarse = COARSE.get(tag[:2]) if tag else None
            if coarse:
                counts[coarse] = counts.get(coarse, 0) + 1
        total = sum(counts.values())
        return {pos: n / total for pos, n in counts.items()} if total >= 6 else {}

    @staticmethod
    def _frame(tags: list[tuple[str, str]], at: int, pos: str) -> float:
        """Reward the word's most ordinary setting; penalise odd ones."""
        before = tags[at - 1][1] if at > 0 else ""
        after = tags[at + 1][1] if at + 1 < len(tags) else ""
        if pos == "noun":
            # "the duck", not "duck meat" (where it describes another noun).
            return (1.5 if before in ("DT", "PRP$", "JJ", "CD") else 0) - (1.0 if after.startswith("NN") else 0)
        if pos == "verb":
            return 0.8 if before in ("PRP", "NN", "NNS", "TO", "MD", "RB") else 0
        if pos == "adjective":
            return 0.8 if after.startswith("NN") or before in ("VBZ", "VBP", "VBD", "RB") else 0
        return 0

    def pick(self, word: str, pos: str, meaning: set[str] | None = None,
             rivals: Iterable[set[str]] = (), must_fit: bool = False) -> str | None:
        """The best sentence using ``word`` as ``pos``.

        ``meaning`` is the stemmed vocabulary of the wanted sense and ``rivals``
        that of the word's other senses. A sentence sharing words with the
        wanted sense is preferred; with ``must_fit`` it has to share more with
        the wanted sense than with any rival, or nothing is returned.
        """
        wanted = TAGS.get(pos)
        rivals = list(rivals)
        best = None
        best_score = None
        for quality, sentence in sorted(self.candidates.get(word, ()), reverse=True):
            tags = self._tagged(sentence)
            at = next((i for i in range(1, len(tags)) if tags[i][0] == word), None)
            if at is None or (wanted and not tags[at][1].startswith(wanted)):
                continue
            quality += self._frame(tags, at, pos)
            fit = 0
            if meaning is not None:
                context = stems(sentence) - stems(word)
                fit = len(context & meaning) - max((len(context & r) for r in rivals), default=0)
                if must_fit and fit <= 0:
                    continue
            score = quality + 1.5 * fit
            if best_score is None or score > best_score:
                best, best_score = sentence, score
        return best
