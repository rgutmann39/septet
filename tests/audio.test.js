import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chooseVoice, createBackoff, md5, recordingUrls } from '../site/js/audio.js';

const reference = (text) => createHash('md5').update(text, 'utf8').digest('hex');

test('md5 matches the reference implementation', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  const samples = ['a', 'En-us-apple.ogg', 'En-us-typically.ogg', 'naïve café', 'x'.repeat(55),
    'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(200)];
  for (const text of samples) assert.equal(md5(text), reference(text), JSON.stringify(text));
});

test('recordingUrls follows the Commons storage layout', () => {
  const hash = reference('En-us-alpaca.ogg');
  const urls = recordingUrls('alpaca');
  assert.equal(urls.ogg, `https://upload.wikimedia.org/wikipedia/commons/${hash[0]}/${hash.slice(0, 2)}/En-us-alpaca.ogg`);
  assert.equal(urls.mp3,
    `https://upload.wikimedia.org/wikipedia/commons/transcoded/${hash[0]}/${hash.slice(0, 2)}/En-us-alpaca.ogg/En-us-alpaca.ogg.mp3`);
  assert.equal(urls.page, 'https://commons.wikimedia.org/wiki/File:En-us-alpaca.ogg');
});

test('chooseVoice prefers an American voice, then any English one', () => {
  const voices = [
    { lang: 'fr-FR', name: 'Amelie' },
    { lang: 'en-GB', name: 'Daniel', default: true },
    { lang: 'en-US', name: 'Samantha', localService: true },
    { lang: 'en_US', name: 'Alex' },
  ];
  assert.equal(chooseVoice(voices).name, 'Samantha');
  assert.equal(chooseVoice(voices.slice(0, 2)).name, 'Daniel');
  assert.equal(chooseVoice(voices.slice(0, 1)), null);
  assert.equal(chooseVoice([]), null);
});

test('recordings are left alone for a while after a run of failures', () => {
  const backoff = createBackoff(3, 1000);
  assert.equal(backoff.paused(0), false);
  backoff.failure(0);
  backoff.failure(10);
  assert.equal(backoff.paused(20), false, 'two failures are not a run');
  backoff.success();
  backoff.failure(30);
  backoff.failure(40);
  assert.equal(backoff.paused(50), false, 'a success in between starts the count again');
  backoff.failure(60);
  assert.equal(backoff.paused(61), true);
  assert.equal(backoff.paused(1059), true);
  assert.equal(backoff.paused(1060), false, 'and asked for again once the pause is over');
});
