// Checks on the generated files in site/data. They fail if a rebuild of the
// data (tools/build_data.py) produces something the game cannot use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createPuzzle, isDateKey, letterMask } from '../site/js/core.js';

const data = new URL('../site/data/', import.meta.url);
const tools = new URL('../tools/', import.meta.url);
const words = readFileSync(new URL('words.txt', data), 'utf8').split('\n').filter(Boolean);
const schedule = JSON.parse(readFileSync(new URL('puzzles.json', data), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('meta.json', data), 'utf8'));

/** Non-comment lines of a tools/ text file, split on tabs. */
function rows(path) {
  return readFileSync(new URL(path, tools), 'utf8').split('\n')
    .map((line) => line.split('#')[0].trim())
    .filter(Boolean)
    .map((line) => line.split('\t'));
}

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
    // New puzzles have 20 to 65 words; kept ones may have grown to 80.
    assert.ok(count >= 20 && count <= 80, `${letters} has ${count} words`);
  }
});

// The reference list is built locally by tools/fetch_reference.py and never
// committed, so these two checks only run where it exists.
const reference = new URL('reference/verdicts.tsv', tools);
const noReference = !existsSync(reference) && 'no local reference list (tools/fetch_reference.py)';

test('dictionary: agrees with every reference verdict, apart from hand curation', { skip: noReference }, () => {
  const known = new Set(words);
  const allow = new Set(rows('curation/allow.txt').map(([word]) => word));
  const deny = new Set(rows('curation/deny.txt').map(([word]) => word));
  const verdicts = rows('reference/verdicts.tsv');
  assert.ok(verdicts.length > 15000, `only ${verdicts.length} verdicts`);
  const wrong = [];
  for (const [word, verdict] of verdicts) {
    const expected = deny.has(word) ? false : allow.has(word) ? true : verdict === '1';
    if (known.has(word) !== expected) wrong.push(word);
  }
  assert.deepEqual(wrong.slice(0, 20), [], `${wrong.length} words disagree`);
  for (const word of ['pitapat', 'pipette', 'palapa']) assert.ok(known.has(word), word);
});

test('schedule: new puzzles do not reuse a reference letter set', { skip: noReference }, () => {
  const used = new Set(rows('reference/letter_sets.txt').map(([letters]) => letters));
  assert.ok(used.size > 1000);
  for (const letters of schedule.puzzles.slice(meta.kept ?? 0)) {
    assert.ok(!used.has([...letters].sort().join('')), `${letters} is a reference letter set`);
  }
});

test('createPuzzle agrees with the schedule on a sample puzzle', () => {
  const puzzle = createPuzzle(schedule.puzzles[0], words);
  assert.ok(puzzle.septets.length >= 1);
  assert.ok(puzzle.total > 0);
});

test('definitions: most words have one, in the right shard', () => {
  const files = readdirSync(new URL('defs/', data)).filter((name) => name.endsWith('.json'));
  let defined = 0;
  let withSentence = 0;
  const known = new Set(words);
  for (const file of files) {
    const shard = JSON.parse(readFileSync(new URL(`defs/${file}`, data), 'utf8'));
    for (const [word, entry] of Object.entries(shard)) {
      assert.equal(word[0], file[0], `${word} is in ${file}`);
      assert.ok(known.has(word), `${word} is defined but not in the dictionary`);
      const meanings = [entry, ...(entry.more ?? [])];
      assert.ok(meanings.length <= 3, `${word} has too many meanings`);
      for (const meaning of meanings) {
        assert.ok(meaning.pos && meaning.definition, `${word} has an incomplete entry`);
        // A capital letter, or an opening quotation mark: 'Come and visit me,' he said amiably.
        if ('example' in meaning) assert.match(meaning.example, /^['"A-Z].{6,}/, `${word} sample sentence`);
        assert.ok(!Object.keys(meaning).some((key) => key.startsWith('_')), `${word} leaks working data`);
      }
      if (entry.example) withSentence += 1;
      defined += 1;
    }
  }
  // The dictionary has many recent and informal words WordNet lacks
  // ("relatable", "gonna"); the card looks those up in Wiktionary.
  assert.ok(defined / words.length > 0.9, `only ${defined} of ${words.length} words are defined`);
  // Rarer words have fewer corpus sentences to choose from; 80% as built.
  assert.ok(withSentence / defined > 0.75, `only ${withSentence} of ${defined} definitions have a sample sentence`);
});

test('pictures: every bundled entry belongs to a dictionary word', { skip: !existsSync(new URL('pics/', data)) }, () => {
  const known = new Set(words);
  let count = 0;
  for (const file of readdirSync(new URL('pics/', data))) {
    const shard = JSON.parse(readFileSync(new URL(`pics/${file}`, data), 'utf8'));
    for (const [word, row] of Object.entries(shard)) {
      assert.equal(word[0], file[0], `${word} is in ${file}`);
      assert.ok(known.has(word), `${word} has a picture but is not in the dictionary`);
      assert.equal(row.length, 4, word);
      const [title, src, description, imageFile] = row;
      assert.ok(title && src && typeof description === 'string' && typeof imageFile === 'string', word);
      count += 1;
    }
  }
  assert.ok(count > 1000, `only ${count} pictures`);
});
