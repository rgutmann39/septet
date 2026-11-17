import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePicture, describesNamedEntity, parseWiktionary, plainText } from '../site/js/lookup.js';

const page = (title, extra = {}) => ({
  pageid: title.length * 1000 + title.charCodeAt(0),
  title,
  thumbnail: { source: `https://upload.wikimedia.org/${title}.jpg`, width: 500, height: 375 },
  pageimage: `${title}.jpg`,
  ...extra,
});
const exact = (pages, extra = {}) => ({ query: { pages, ...extra } });
const search = (pages) => ({ query: { pages: pages.map((p, i) => ({ ...p, index: i + 1 })) } });

test('plainText strips markup and decodes entities', () => {
  assert.equal(plainText('<span class="x">Fish &amp; chips</span> are <b>good</b>'), 'Fish & chips are good');
  assert.equal(plainText('<style>.a{color:red}</style>An&nbsp;apple&#39;s core'), "An apple's core");
  assert.equal(plainText(undefined), '');
});

test('parseWiktionary takes the first English definition', () => {
  const data = {
    en: [
      { partOfSpeech: 'Noun', definitions: [{ definition: '' }, { definition: 'A <a href="/wiki/young">young</a> kangaroo.', examples: ['The <b>joey</b> hopped.'] }] },
      { partOfSpeech: 'Verb', definitions: [{ definition: 'Something else.' }] },
    ],
    fr: [{ partOfSpeech: 'Nom', definitions: [{ definition: 'Autre chose.' }] }],
  };
  assert.deepEqual(parseWiktionary(data), {
    pos: 'noun', definition: 'A young kangaroo.', example: 'The joey hopped.', source: 'Wiktionary',
  });
  assert.equal(parseWiktionary(null), null);
  assert.equal(parseWiktionary({ fr: [] }), null);
});

test('describesNamedEntity spots places, people, works and businesses', () => {
  for (const text of [
    'Country in West Asia and Southeast Europe',
    'Prefecture of Alpes-Maritimes, France',
    'City in Mobile County, Alabama, United States',
    '1997 film by James Cameron',
    'American actor (born 1956)',
    'American multinational technology company',
    'Surname list',
    'Wikimedia disambiguation page',
  ]) assert.equal(describesNamedEntity(text), true, text);

  for (const text of [
    'Large bird in the genus Meleagris',
    'State of matter',
    'Sequence of images that give the impression of movement',
    'Fruit that grows on a tree',
    'Musical instrument',
    'Company that provides air transport services',
    '',
    undefined,
  ]) assert.equal(describesNamedEntity(text), false, String(text));
});

test('choosePicture: a word with no category uses its own article', () => {
  const picture = choosePicture({ word: 'yellow' }, exact([page('Yellow', { description: 'Color' })]), null);
  assert.equal(picture.title, 'Yellow');
  assert.equal(picture.pageUrl, 'https://en.wikipedia.org/wiki/Yellow');
  assert.equal(picture.fileUrl, 'https://commons.wikimedia.org/wiki/File:Yellow.jpg');
});

test('choosePicture: no picture for disambiguation, missing or image-less pages', () => {
  assert.equal(choosePicture({ word: 'glad' }, exact([page('Glad', { pageprops: { disambiguation: '' } })]), null), null);
  assert.equal(choosePicture({ word: 'zzzq' }, exact([{ title: 'Zzzq', missing: true }]), null), null);
  assert.equal(choosePicture({ word: 'aptly' }, exact([{ pageid: 9, title: 'Aptly' }]), null), null);
  assert.equal(choosePicture({ word: 'aptly' }, null, null), null);
});

test('choosePicture: a place that shares the word is not used', () => {
  const nice = exact([page('Nice', { description: 'Prefecture of Alpes-Maritimes, France' })]);
  assert.equal(choosePicture({ word: 'nice' }, nice, null), null);
});

test('choosePicture: follows normalisation and redirects, and falls back to the base form', () => {
  const data = exact([page('Goose', { description: 'Common name for many waterfowl' })], {
    normalized: [{ from: 'geese', to: 'Geese' }, { from: 'goose', to: 'Goose' }],
    redirects: [{ from: 'Geese', to: 'Goose' }],
  });
  assert.equal(choosePicture({ word: 'geese', lemma: 'goose' }, data, null).title, 'Goose');
});

test('choosePicture: the category search steers an ambiguous word to the right sense', () => {
  const turkey = exact([page('Turkey', { description: 'Country in West Asia and Southeast Europe' })],
    { normalized: [{ from: 'turkey', to: 'Turkey' }] });
  const hits = search([
    page('Domestic turkey', { description: 'Domesticated form of the wild turkey' }),
    page('Fowl', { description: 'Birds of the superorder Galloanserae' }),
  ]);
  assert.equal(choosePicture({ word: 'turkey', kind: 'domestic fowl' }, turkey, hits).title, 'Domestic turkey');
});

test('choosePicture: keeps the obvious article when the search agrees', () => {
  const piano = page('Piano', { description: 'Keyboard instrument' });
  const data = exact([piano], { normalized: [{ from: 'piano', to: 'Piano' }] });
  const hits = search([page('Keyboard instrument'), piano]);
  assert.equal(choosePicture({ word: 'piano', kind: 'keyboard instrument' }, data, hits).title, 'Piano');
});

test('choosePicture: takes the top search hit when nothing carries the word', () => {
  const mint = exact([page('Mint', { pageprops: { disambiguation: '' } })], { normalized: [{ from: 'mint', to: 'Mint' }] });
  const hits = search([page('Mentha', { description: 'Genus of flowering plants' }), page('Herb')]);
  assert.equal(choosePicture({ word: 'mint', kind: 'herb' }, mint, hits).title, 'Mentha');
});
