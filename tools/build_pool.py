"""Build site/data/pool.txt: puzzles for the "New puzzle" button.

The daily schedule (site/data/puzzles.json) holds one puzzle per letter set
that build_data.py chose. Every other letter set that would make a fair
puzzle goes in the pool, so a player can ask for a fresh puzzle at any time
without being handed a future daily one. Each line is a puzzle's letters,
centre letter first, sorted.

A pool puzzle meets the same tests as a daily one:

  - 20 to 65 words and 70 to 330 points;
  - at least one septet a player can reasonably be expected to know
    (wordfreq Zipf frequency 2.6 or more, or listed in curation/allow.txt);
  - not a letter set the schedule uses, nor one the reference has used, when
    the local reference list (tools/reference/letter_sets.txt) is present.

Of the centre letters that qualify, the one whose puzzle is closest to a
typical size (42 words) is taken, as for the schedule.

Run after build_data.py, from the repository root:

    python tools/build_pool.py

Needs only wordfreq (tools/requirements.txt). The output is committed.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path

from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
TOOLS = ROOT / "tools"

# Keep in step with build_data.py.
MIN_LENGTH = 4
LETTERS = 7
MIN_WORDS, MAX_WORDS = 20, 65
MIN_POINTS, MAX_POINTS = 70, 330
TARGET_WORDS = 42
FAIR_SEPTET_MIN_ZIPF = 2.6


def mask_of(word: str) -> int:
    mask = 0
    for ch in word:
        mask |= 1 << (ord(ch) - 97)
    return mask


def points(word: str) -> int:
    base = 1 if len(word) == MIN_LENGTH else len(word)
    return base + (LETTERS if len(set(word)) == LETTERS else 0)


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [line.split("#")[0].strip() for line in path.read_text(encoding="utf-8").splitlines()
            if line.split("#")[0].strip()]


def main() -> None:
    words = read_lines(DATA / "words.txt")
    schedule = json.loads((DATA / "puzzles.json").read_text(encoding="utf-8"))["puzzles"]
    allow = set(read_lines(TOOLS / "curation" / "allow.txt"))
    reference = {mask_of(line) for line in read_lines(TOOLS / "reference" / "letter_sets.txt")}
    if not reference:
        print("note: no tools/reference/letter_sets.txt, so reference letter sets are not avoided",
              file=sys.stderr)
    avoid = {mask_of(letters) for letters in schedule} | reference

    by_mask: dict[int, list[str]] = defaultdict(list)
    for word in words:
        by_mask[mask_of(word)].append(word)

    pool = []
    for mask, septets in by_mask.items():
        if bin(mask).count("1") != LETTERS or mask in avoid:
            continue
        if not any(w in allow or zipf_frequency(w, "en") >= FAIR_SEPTET_MIN_ZIPF for w in septets):
            continue
        letters = [chr(97 + i) for i in range(26) if mask >> i & 1]
        bits = [1 << (ord(ch) - 97) for ch in letters]
        subsets = [sum(combo) for size in range(1, LETTERS + 1) for combo in combinations(bits, size)]
        options = []
        for letter, bit in zip(letters, bits):
            answers = [w for sub in subsets if sub & bit for w in by_mask.get(sub, ())]
            total = sum(points(w) for w in answers)
            if MIN_WORDS <= len(answers) <= MAX_WORDS and MIN_POINTS <= total <= MAX_POINTS:
                options.append((abs(len(answers) - TARGET_WORDS), letter))
        if options:
            centre = min(options)[1]
            pool.append(centre + "".join(ch for ch in letters if ch != centre))

    pool.sort()
    (DATA / "pool.txt").write_text("\n".join(pool) + "\n", encoding="utf-8")
    print(f"site/data/pool.txt: {len(pool)} puzzles")


if __name__ == "__main__":
    main()
