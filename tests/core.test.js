import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRA_KEEP_DAYS, RANKS, checkGuess, createPuzzle, dateKey, daysBetween, hintTables, isDateKey,
  isPlayable, isSeptet, parsePuzzleKey, pickFromPool, pruneExtras, puzzleIndexFor, rankIndex,
  rankTable, scoreOf, shiftDateKey, shuffled, wordPoints,
} from '../site/js/core.js';

const WORDS = [
  'atypical', 'capital', 'clap', 'clip', 'pact', 'pita', 'typical', 'typically',
  'tail',   // no centre letter
  'paste',  // letters outside the puzzle
  'cat',    // too short to ever be an answer
];
const puzzle = createPuzzle('pacilty', WORDS);

test('scoring: 1 point for four letters, length for longer, +7 for a septet', () => {
  assert.equal(wordPoints('clap'), 1);
  assert.equal(wordPoints('capital'), 7);
  assert.equal(wordPoints('typical'), 14);
  assert.equal(wordPoints('typically'), 16);
  assert.equal(scoreOf(['clap', 'typical']), 15);
});

test('a septet uses all seven letters', () => {
  assert.equal(isSeptet('typical'), true);
  assert.equal(isSeptet('typically'), true);
  assert.equal(isSeptet('capital'), false);
});

test('createPuzzle keeps only words with the centre letter and no stray letters', () => {
  assert.equal(puzzle.center, 'p');
  assert.deepEqual(puzzle.outer, ['a', 'c', 'i', 'l', 't', 'y']);
  assert.deepEqual(puzzle.answers,
    ['atypical', 'capital', 'clap', 'clip', 'pact', 'pita', 'typical', 'typically']);
  assert.deepEqual(puzzle.septets, ['atypical', 'typical', 'typically']);
  assert.equal(puzzle.total, 15 + 7 + 1 + 1 + 1 + 1 + 14 + 16);
});

test('checkGuess explains each kind of rejection', () => {
  const reason = (guess, found = []) => checkGuess(puzzle, found, guess).reason;
  assert.equal(reason(''), 'empty');
  assert.equal(reason('pit'), 'short');
  assert.equal(reason('clap', ['clap']), 'found');
  assert.equal(reason('paste'), 'letters');
  assert.equal(reason('tail'), 'center');
  assert.equal(reason('papa'), 'unknown');
});

test('checkGuess accepts answers in any letter case', () => {
  assert.deepEqual(checkGuess(puzzle, [], 'Clap'), { ok: true, word: 'clap', points: 1, septet: false });
  assert.deepEqual(checkGuess(puzzle, [], 'TYPICAL'), { ok: true, word: 'typical', points: 14, septet: true });
});

test('rank table rises strictly and ends at the full score', () => {
  for (const total of [20, 56, 100, 187, 260]) {
    const table = rankTable(total);
    assert.equal(table.length, RANKS.length);
    assert.equal(table[0].score, 0);
    assert.equal(table.at(-1).score, total);
    for (let i = 1; i < table.length; i++) assert.ok(table[i].score > table[i - 1].score, `total ${total}`);
  }
});

test('rankIndex follows the table', () => {
  assert.equal(rankIndex(0, 200), 0);
  assert.equal(rankIndex(4, 200), 1);    // 2%
  assert.equal(rankIndex(139, 200), 7);  // just short of 70%
  assert.equal(rankIndex(140, 200), 8);
  assert.equal(rankIndex(199, 200), 8);
  assert.equal(rankIndex(200, 200), 9);
});

test('hint tables count totals and what is left', () => {
  const tables = hintTables(puzzle.answers, ['clap', 'pact']);
  assert.deepEqual(tables.lengths, [4, 7, 8, 9]);
  assert.deepEqual(tables.letters, ['a', 'c', 'p', 't']);
  assert.deepEqual(tables.cell('c', 4), { total: 2, left: 1 });
  assert.deepEqual(tables.cell('p', 4), { total: 2, left: 1 });
  assert.deepEqual(tables.cell('a', 4), { total: 0, left: 0 });
  assert.deepEqual(tables.pairs.find((p) => p.pair === 'cl'), { pair: 'cl', total: 2, left: 1 });
  assert.deepEqual(tables.pairs.find((p) => p.pair === 'ty'), { pair: 'ty', total: 2, left: 2 });
});

test('date helpers', () => {
  assert.equal(dateKey(new Date(2026, 10, 7)), '2026-11-07');
  assert.equal(isDateKey('2026-11-17'), true);
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey('17/11/2026'), false);
  assert.equal(isDateKey(null), false);
  assert.equal(daysBetween('2026-11-01', '2026-11-17'), 16);
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);   // across a clock change
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
});

test('the schedule gives one puzzle per day and loops', () => {
  assert.equal(puzzleIndexFor('2026-11-01', '2026-11-01', 100), 0);
  assert.equal(puzzleIndexFor('2026-11-17', '2026-11-01', 100), 16);
  assert.equal(puzzleIndexFor('2027-02-09', '2026-11-01', 100), 0);
  assert.equal(puzzleIndexFor('2026-10-31', '2026-11-01', 100), 99);
});

test('shuffled keeps the same items', () => {
  const letters = ['a', 'c', 'i', 'l', 't', 'y'];
  const out = shuffled(letters, () => 0.3);
  assert.deepEqual([...out].sort(), letters);
  assert.notEqual(out, letters);
});

test('parsePuzzleKey accepts seven distinct letters without S, centre first', () => {
  assert.equal(parsePuzzleKey('uegilnr'), 'uegilnr');
  assert.equal(parsePuzzleKey(' UEGILNR '), 'uegilnr');
  for (const bad of [null, undefined, '', 'uegiln', 'uegilnrt', 'uegilns', 'uegilnn', 'uegil1r', 42]) {
    assert.equal(parsePuzzleKey(bad), null, String(bad));
  }
});

test('a puzzle key rebuilds the same puzzle, centre letter included', () => {
  const words = ['glue', 'lunge', 'gruel', 'ruling', 'reguline', 'linger', 'lingerie'];
  const a = createPuzzle(parsePuzzleKey('uegilnr'), words);
  const b = createPuzzle(parsePuzzleKey('uegilnr'), words);
  assert.deepEqual(a.answers, b.answers);
  assert.equal(a.center, 'u');
  assert.ok(!a.answers.includes('linger'), 'needs the centre letter');
  assert.ok(isPlayable(a));
  assert.ok(!isPlayable(createPuzzle('uegilnr', ['glue'])));
});

test('pickFromPool skips excluded keys until none are left', () => {
  const pool = ['abcdefg', 'hijklmn', 'opqrtuv'];
  const exclude = new Set(['abcdefg', 'hijklmn']);
  for (let i = 0; i < 20; i++) assert.equal(pickFromPool(pool, exclude), 'opqrtuv');
  assert.ok(pool.includes(pickFromPool(pool, new Set(pool))));
  assert.equal(pickFromPool([], new Set()), null);
  assert.equal(pickFromPool(pool, new Set(), () => 0.99), 'opqrtuv');
});

test('pruneExtras keeps puzzles with a word found in the last 14 days', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
  const kept = pruneExtras({
    abcdefg: { w: ['face'], u: daysAgo(0), c: daysAgo(3) },
    hijklmn: { w: ['milk'], u: daysAgo(13.9) },
    opqrtuv: { w: ['pour'], u: daysAgo(14.1) },
    bcdefgh: { w: [], u: daysAgo(0) },
    cdefghi: { w: ['chef'] },
    sabcdef: { w: ['word'], u: daysAgo(0) },
  }, now);
  assert.deepEqual(Object.keys(kept).sort(), ['abcdefg', 'hijklmn']);
  assert.equal(EXTRA_KEEP_DAYS, 14);
  assert.deepEqual(pruneExtras(undefined, now), {});
});
