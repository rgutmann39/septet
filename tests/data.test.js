// Checks on the generated files in site/data. They fail if a rebuild of the
// data (tools/build_data.py) produces something the game cannot use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createPuzzle, isDateKey, letterMask } from '../site/js/core.js';

const data = new URL('../site/data/', import.meta.url);
const words = readFileSync(new URL('words.txt', data), 'utf8').split('\n').filter(Boolean);
const schedule = JSON.parse(readFileSync(new URL('puzzles.json', data), 'utf8'));

test('dictionary: sorted, unique, and every word is playable', () => {
  assert.ok(words.length > 10000);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    assert.match(word, /^[a-rt-z]{4,}$/, word);
    assert.ok(new Set(word).size <= 7, `${word} needs more than seven letters`);
    if (i) assert.ok(words[i - 1] < word, `${words[i - 1]} / ${word} out of order`);
  }
});

test('schedule: every puzzle is seven distinct letters without S', () => {
  assert.ok(isDateKey(schedule.epoch));
  assert.ok(schedule.puzzles.length >= 365, 'at least a year of puzzles');
  assert.equal(new Set(schedule.puzzles).size, schedule.puzzles.length);
  for (const letters of schedule.puzzles) {
    assert.match(letters, /^[a-rt-z]{7}$/, letters);
    assert.equal(new Set(letters).size, 7, letters);
  }
  // No letter set is used twice, whatever the centre letter.
  const sets = new Set(schedule.puzzles.map((letters) => [...letters].sort().join('')));
  assert.equal(sets.size, schedule.puzzles.length);
});

test('schedule: every puzzle has a septet and a sensible number of words', () => {
  const masks = words.map(letterMask);
  for (const letters of schedule.puzzles) {
    const allowed = letterMask(letters);
    const center = letterMask(letters[0]);
    let count = 0;
    let septets = 0;
    for (const mask of masks) {
      if (mask & center && (mask & ~allowed) === 0) {
        count += 1;
        if (mask === allowed) septets += 1;
      }
    }
    assert.ok(septets >= 1, `${letters} has no septet`);
    assert.ok(count >= 20 && count <= 55, `${letters} has ${count} words`);
  }
});

test('createPuzzle agrees with the schedule on a sample puzzle', () => {
  const puzzle = createPuzzle(schedule.puzzles[0], words);
  assert.ok(puzzle.septets.length >= 1);
  assert.ok(puzzle.total > 0);
});

test('definitions: almost every word has one, in the right shard', () => {
  const files = readdirSync(new URL('defs/', data)).filter((name) => name.endsWith('.json'));
  let defined = 0;
  const known = new Set(words);
  for (const file of files) {
    const shard = JSON.parse(readFileSync(new URL(`defs/${file}`, data), 'utf8'));
    for (const [word, entry] of Object.entries(shard)) {
      assert.equal(word[0], file[0], `${word} is in ${file}`);
      assert.ok(known.has(word), `${word} is defined but not in the dictionary`);
      assert.ok(entry.pos && entry.definition, `${word} has an incomplete entry`);
      defined += 1;
    }
  }
  assert.ok(defined / words.length > 0.97, `only ${defined} of ${words.length} words are defined`);
});
