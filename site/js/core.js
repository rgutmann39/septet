// Game rules. Pure functions only (no DOM, no storage) so the same code runs
// in the browser and in the Node test suite.

export const MIN_LENGTH = 4;
export const LETTER_COUNT = 7;

// Ranks, as a share of the day's total points. The top rank, Maestro, is set
// to be hard but within reach (about the same share as the genre's usual
// "genius" rank), not a full sweep: finding every word is a bonus beyond it.
export const RANKS = [
  { name: 'Tuning Up', share: 0 },
  { name: 'Warm-Up', share: 0.02 },
  { name: 'First Notes', share: 0.05 },
  { name: 'In Rhythm', share: 0.08 },
  { name: 'In Tune', share: 0.15 },
  { name: 'Harmonizing', share: 0.25 },
  { name: 'Soloist', share: 0.33 },
  { name: 'Headliner', share: 0.42 },
  { name: 'Virtuoso', share: 0.55 },
  { name: 'Maestro', share: 0.7 },
];

export const TOP_RANK = RANKS.length - 1;

/** Bitmask of the distinct letters in a word (bit 0 = a). */
export function letterMask(word) {
  let mask = 0;
  for (let i = 0; i < word.length; i++) mask |= 1 << (word.charCodeAt(i) - 97);
  return mask;
}

/** A septet uses all seven of the day's letters. */
export function isSeptet(word) {
  return new Set(word).size === LETTER_COUNT;
}

/** Four-letter words score 1; longer words score their length; septets add 7. */
export function wordPoints(word) {
  const base = word.length === MIN_LENGTH ? 1 : word.length;
  return base + (isSeptet(word) ? LETTER_COUNT : 0);
}

/**
 * Build a puzzle from its letters (centre letter first) and the dictionary.
 * `dictionary` is the full list of accepted words.
 */
export function createPuzzle(letters, dictionary) {
  const center = letters[0];
  const centerBit = letterMask(center);
  const allowed = letterMask(letters);
  const answers = [];
  for (const word of dictionary) {
    const mask = letterMask(word);
    if (mask & centerBit && (mask & ~allowed) === 0) answers.push(word);
  }
  answers.sort();
  return {
    letters,
    center,
    outer: letters.slice(1).split(''),
    answers,
    answerSet: new Set(answers),
    total: answers.reduce((sum, word) => sum + wordPoints(word), 0),
    septets: answers.filter(isSeptet),
  };
}

/**
 * Judge a guess. Returns { ok: true, word, points, septet } or
 * { ok: false, reason } where reason is one of:
 * 'empty' | 'short' | 'found' | 'letters' | 'center' | 'unknown'.
 */
export function checkGuess(puzzle, found, guess) {
  const word = guess.trim().toLowerCase();
  if (!word) return { ok: false, reason: 'empty' };
  if (word.length < MIN_LENGTH) return { ok: false, reason: 'short' };
  if (found.includes(word)) return { ok: false, reason: 'found' };
  for (const ch of word) {
    if (!puzzle.letters.includes(ch)) return { ok: false, reason: 'letters' };
  }
  if (!word.includes(puzzle.center)) return { ok: false, reason: 'center' };
  if (!puzzle.answerSet.has(word)) return { ok: false, reason: 'unknown' };
  return { ok: true, word, points: wordPoints(word), septet: isSeptet(word) };
}

export function scoreOf(words) {
  return words.reduce((sum, word) => sum + wordPoints(word), 0);
}

/** The points needed for each rank in a puzzle worth `total` points. */
export function rankTable(total) {
  let previous = -1;
  return RANKS.map((rank, i) => {
    let score = Math.round(total * rank.share);
    // Small puzzles can round two ranks to the same score; keep them distinct.
    if (score <= previous) score = Math.min(previous + 1, total);
    previous = score;
    return { name: rank.name, score };
  });
}

/** Index into RANKS of the rank earned by `score`. */
export function rankIndex(score, total) {
  const table = rankTable(total);
  let index = 0;
  for (let i = 0; i < table.length; i++) if (score >= table[i].score) index = i;
  return index;
}

/**
 * Hint tables: how many answers start with each letter at each length, and how
 * many start with each two-letter pair. `left` counts those not yet found.
 */
export function hintTables(answers, found) {
  const foundSet = new Set(found);
  const lengths = [...new Set(answers.map((w) => w.length))].sort((a, b) => a - b);
  const rows = new Map();
  const pairs = new Map();
  for (const word of answers) {
    const left = foundSet.has(word) ? 0 : 1;
    const row = rows.get(word[0]) ?? new Map();
    const cell = row.get(word.length) ?? { total: 0, left: 0 };
    cell.total += 1;
    cell.left += left;
    row.set(word.length, cell);
    rows.set(word[0], row);

    const pair = pairs.get(word.slice(0, 2)) ?? { total: 0, left: 0 };
    pair.total += 1;
    pair.left += left;
    pairs.set(word.slice(0, 2), pair);
  }
  const letters = [...rows.keys()].sort();
  return {
    lengths,
    letters,
    cell: (letter, length) => rows.get(letter)?.get(length) ?? { total: 0, left: 0 },
    pairs: [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([pair, counts]) => ({ pair, ...counts })),
  };
}

// ---------------------------------------------------------------- dates ----

/** Local calendar date as 'YYYY-MM-DD'. */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whole days from one date key to another (daylight-saving safe). */
export function daysBetween(fromKey, toKey) {
  const utc = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toKey) - utc(fromKey)) / 86400000);
}

export function shiftDateKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Which puzzle in the schedule belongs to a date. The schedule loops. */
export function puzzleIndexFor(key, epochKey, count) {
  const n = daysBetween(epochKey, key);
  return ((n % count) + count) % count;
}

/** Fisher-Yates shuffle; returns a new array. */
export function shuffled(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------- extra puzzles ----
// Puzzles made on demand, outside the daily schedule. A puzzle's key is its
// letters, centre letter first ("uegilnr"): the key alone rebuilds the whole
// puzzle, so it can travel in a link.

/** Days an extra puzzle is kept after the last word found in it. */
export const EXTRA_KEEP_DAYS = 14;

/** The letters for a puzzle key, or null if it cannot be a puzzle. */
export function parsePuzzleKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!/^[a-rt-z]{7}$/.test(key) || new Set(key).size !== LETTER_COUNT) return null;
  return key;
}

/** Whether a puzzle built from a key is playable: it needs a septet. */
export function isPlayable(puzzle) {
  return puzzle.septets.length > 0;
}

/**
 * Pick a puzzle key from the pool, skipping any in `exclude` (keys already
 * played or open). Falls back to the whole pool once everything is excluded.
 */
export function pickFromPool(pool, exclude = new Set(), random = Math.random) {
  const fresh = pool.filter((key) => !exclude.has(key));
  const from = fresh.length ? fresh : pool;
  return from.length ? from[Math.floor(random() * from.length)] : null;
}

/**
 * The saved extra puzzles worth keeping: at least one word found, and a word
 * found within the last EXTRA_KEEP_DAYS days. `now` is a Date or ms.
 */
export function pruneExtras(extras, now = Date.now(), keepDays = EXTRA_KEEP_DAYS) {
  const cutoff = Number(now) - keepDays * 86400000;
  const kept = {};
  for (const [key, entry] of Object.entries(extras ?? {})) {
    if (!parsePuzzleKey(key) || !Array.isArray(entry?.w) || !entry.w.length) continue;
    const updated = Date.parse(entry.u);
    if (Number.isNaN(updated) || updated < cutoff) continue;
    kept[key] = entry;
  }
  return kept;
}
