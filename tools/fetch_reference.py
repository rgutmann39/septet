#!/usr/bin/env python3
"""Build the local reference list that Septet's dictionary is matched to.

Septet's word list is calibrated against the published answers of past
puzzles of a reference game in the same genre. This script downloads
archives of those answers and works out, for every word Septet could
consider, what the reference decided the last time one of its puzzles
allowed that word:

    accepted   it was in that day's answers
    rejected   the day's letters and centre letter allowed it, and it was not

It writes two files, which build_data.py reads:

    tools/reference/verdicts.tsv      word, verdict, date last judged, record
    tools/reference/letter_sets.txt   letter sets the reference has used;
                                      Septet's schedule avoids them

Nothing in tools/reference/ is committed (see .gitignore). Where to download
the archives from is set in tools/reference/sources.json, which you keep
yourself:

    {
      "daily_files": {"url": ".../{year}/{day}_{number}.txt", "first_day": "YYYY-MM-DD"},
      "daily_json":  {"url": ".../data.json", "key": "<game key>"}
    }

"daily_files" is an archive with one text file per day: the letters, centre
first, on the first line, then one answer per line. {number} counts days from
"first_day", starting at 1. "daily_json" is one JSON file mapping each date
to an object whose "key" entry has "center", "letters" and "answers". Days in
both archives are taken from "daily_json".

Run this now and then to pick up recent puzzles, then rebuild the data:

    python tools/fetch_reference.py
    python tools/build_data.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from itertools import combinations

import build_data as data

CACHE = data.CACHE / "reference"
REFERENCE = data.REFERENCE


def download(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "word-game-data-build"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
        except (urllib.error.URLError, TimeoutError):
            pass
        if attempt < 3:
            time.sleep(2 ** attempt)
    sys.exit(f"Could not download {url}")


def read_sources() -> dict:
    path = REFERENCE / "sources.json"
    if not path.exists():
        sys.exit(f"{path} is missing; it names the archives to download (see this script's docstring)")
    return json.loads(path.read_text(encoding="utf-8"))


def load_daily_json(source: dict, offline: bool) -> dict[str, tuple[str, str, list[str]]]:
    """{day: (centre, letters, answers)} from a single JSON archive."""
    path = CACHE / "daily.json"
    if not offline or not path.exists():
        print("  downloading the daily JSON archive ...")
        body = download(source["url"])
        if body is None:
            sys.exit(f"{source['url']} is gone; update tools/reference/sources.json")
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    days = {}
    for day, entry in json.loads(path.read_text(encoding="utf-8")).items():
        puzzle = entry.get(source["key"])
        if puzzle and puzzle.get("answers"):
            centre = puzzle["center"].lower()
            letters = centre + "".join(ch.lower() for ch in puzzle["letters"])
            days[day] = (centre, letters, [w.lower() for w in puzzle["answers"]])
    return days


def load_daily_files(source: dict, until: date) -> dict[str, tuple[str, str, list[str]]]:
    """{day: (centre, letters, answers)} for the days before ``until``.

    Files never change once written, so each is downloaded once and cached.
    """
    first = date.fromisoformat(source["first_day"])
    folder = CACHE / "daily"
    folder.mkdir(parents=True, exist_ok=True)
    wanted = []
    day = first
    while day < until:
        wanted.append(day)
        day += timedelta(days=1)

    def get(day: date) -> tuple[str, bytes | None]:
        number = (day - first).days + 1
        path = folder / f"{day.isoformat()}_{number}.txt"
        if path.exists():
            return day.isoformat(), path.read_bytes()
        body = download(source["url"].format(year=day.year, day=day.isoformat(), number=number))
        if body is not None:
            path.write_bytes(body)
        return day.isoformat(), body

    print(f"  reading {len(wanted)} daily files (downloading any not cached) ...")
    days = {}
    with ThreadPoolExecutor(6) as pool:
        for key, body in pool.map(get, wanted):
            if body is None:
                print(f"  (no file for {key})")
                continue
            letters, *answers = body.decode("utf-8").split()
            days[key] = (letters[0], letters, answers)
    return days


def check(days: dict[str, tuple[str, str, list[str]]]) -> dict[str, tuple[set[str], set[str], set[str]]]:
    """Validate each day and settle its centre letter.

    Archives sometimes record the wrong centre letter. The true centre is in
    every answer, so the letters common to all answers are the candidates;
    usually that is one letter, sometimes two. A word only counts as rejected
    if it contains every candidate, so a mislabelled day cannot reject words.
    """
    good = {}
    for day, (_, letters, answers) in sorted(days.items()):
        letter_set = set(letters)
        if len(letter_set) != 7 or not answers or any(not set(w) <= letter_set for w in answers):
            print(f"  skipping {day}: letters {letters!r} do not fit its answers")
            continue
        centres = set.intersection(*(set(w) for w in answers))
        good[day] = (centres, letter_set, set(answers))
    return good


def candidate_words() -> set[str]:
    """Every word build_data.py might consider."""
    tier_of = data.load_scowl()
    words = {w for w in tier_of if data.is_playable_shape(w)}
    words |= {w for w in data.load_enable() if data.is_playable_shape(w)}
    hand = data.read_curation("allow.txt") | data.read_curation("deny.txt")
    words |= {w for w in hand if data.is_playable_shape(w)}
    return words


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--offline", action="store_true",
                        help="use the cached copy of the daily JSON archive instead of downloading it")
    args = parser.parse_args()

    print("Loading puzzle archives")
    sources = read_sources()
    days: dict[str, tuple[str, str, list[str]]] = {}
    if "daily_json" in sources:
        days.update(load_daily_json(sources["daily_json"], args.offline))
    if "daily_files" in sources:
        until = date.fromisoformat(min(days)) if days else date.today()
        days = {**load_daily_files(sources["daily_files"], until), **days}
    days = check(days)
    if not days:
        sys.exit("No puzzles found; check tools/reference/sources.json")
    print(f"  {len(days)} puzzles, {min(days)} to {max(days)}")

    print("Judging words")
    candidates = candidate_words()
    for _, _, answers in days.values():
        candidates |= {w for w in answers if data.is_playable_shape(w)}
    by_mask: dict[int, list[str]] = defaultdict(list)
    for word in candidates:
        by_mask[data.mask_of(word)].append(word)

    # word -> [date last judged, accepted then?, times accepted, times judged]
    record: dict[str, list] = {}
    for day, (centres, letters, answers) in days.items():
        required = data.mask_of("".join(centres))
        bits = [data.mask_of(ch) for ch in letters]
        for size in range(1, len(bits) + 1):
            for combo in combinations(bits, size):
                mask = sum(combo)
                if mask & required != required:
                    continue
                for word in by_mask.get(mask, ()):
                    accepted = word in answers
                    entry = record.setdefault(word, [day, accepted, 0, 0])
                    entry[0], entry[1] = day, accepted
                    entry[2] += accepted
                    entry[3] += 1

    REFERENCE.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Reference verdicts, generated by tools/fetch_reference.py",
        f"# from {len(days)} puzzles, {min(days)} to {max(days)}. Not for redistribution.",
        "# verdict: 1 if the word was an answer the last time a puzzle's letters allowed it,",
        "# 0 if it was not. record: times accepted / times a puzzle allowed it.",
        "# word\tverdict\tlast judged\trecord",
    ]
    for word in sorted(record):
        last, accepted, wins, seen = record[word]
        lines.append(f"{word}\t{int(accepted)}\t{last}\t{wins}/{seen}")
    (REFERENCE / "verdicts.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")

    sets = sorted({"".join(sorted(letters)) for _, letters, _ in days.values()})
    (REFERENCE / "letter_sets.txt").write_text(
        "# Letter sets the reference has used; Septet's schedule avoids them.\n"
        f"# Generated by tools/fetch_reference.py, {min(days)} to {max(days)}.\n"
        + "\n".join(sets) + "\n", encoding="utf-8")

    accepted = sum(1 for r in record.values() if r[1])
    print(f"  {len(record)} words judged: {accepted} accepted, {len(record) - accepted} rejected")
    print(f"  {len(sets)} letter sets used")
    print(f"Wrote {REFERENCE / 'verdicts.tsv'} and {REFERENCE / 'letter_sets.txt'}")


if __name__ == "__main__":
    main()
