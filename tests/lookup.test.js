import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THUMB_PREFIX, THUMB_SUFFIX, choosePicture, describesNamedEntity, packPicture, parseWiktionary, plainText,
  toMeanings, unpackPicture,
} from '../site/js/lookup.js';

const page = (title, extra = {}) => ({
  pageid: title.length * 1000 + title.charCodeAt(0),
  title,
  thumbnail: { source: `${THUMB_PREFIX}commons/thumb/a/ab/${title}.jpg/500px-${title}.jpg${THUMB_SUFFIX}`, width: 500, height: 375 },
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

test('choosePicture: the word\'s own article comes first', () => {
  const picture = choosePicture({ word: 'yellow' }, exact([page('Yellow', { description: 'Color' })]), null);
  assert.equal(picture.title, 'Yellow');
  assert.equal(picture.pageUrl, 'https://en.wikipedia.org/wiki/Yellow');
  assert.equal(picture.fileUrl, 'https://commons.wikimedia.org/wiki/File:Yellow.jpg');

  const piano = exact([page('Piano', { description: 'Keyboard instrument' })], { normalized: [{ from: 'piano', to: 'Piano' }] });
  const hits = search([page('Keyboard instrument'), page('Player piano')]);
  assert.equal(choosePicture({ word: 'piano', kind: 'keyboard instrument' }, piano, hits).title, 'Piano');
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

// The search fixtures below are trimmed copies of real API results.

test('choosePicture: an ambiguous word takes the article titled for its sense', () => {
  const table = exact([page('Table', { pageprops: { disambiguation: '' } })], { normalized: [{ from: 'table', to: 'Table' }] });
  const hits = search([
    page('Garden furniture', { description: 'Furniture designed for outdoor use' }),
    page('Dressing table', { description: 'Furniture for personal grooming' }),
    page('Table (furniture)', { description: 'Piece of furniture with a flat top' }),
  ]);
  assert.equal(choosePicture({ word: 'table', kind: 'furniture' }, table, hits).title, 'Table (furniture)');
});

test('choosePicture: next best is an article with the word as its head noun', () => {
  const turkey = exact([page('Turkey', { description: 'Country in West Asia and Southeast Europe' })],
    { normalized: [{ from: 'turkey', to: 'Turkey' }] });
  const hits = search([
    page('Fowl', { description: 'Birds of the superorder Galloanserae' }),
    page('National Thanksgiving Turkey Presentation', { description: 'Feast ritual held in the United States' }),
    page('Domestic turkey', { description: 'Species of bird' }),
  ]);
  assert.equal(choosePicture({ word: 'turkey', kind: 'domestic fowl' }, turkey, hits).title, 'Domestic turkey');
});

test('choosePicture: then an article the definition names', () => {
  const mint = exact([page('Mint', { pageprops: { disambiguation: '' } })], { normalized: [{ from: 'mint', to: 'Mint' }] });
  const hits = search([
    page('Herb', { description: 'Plant used for food, medicine or perfume' }),
    page('Mentha', { description: 'Genus of flowering plants' }),
    page('Maghrebi mint tea', { description: 'North African green tea' }),
  ]);
  const target = { word: 'mint', kind: 'herb', definition: 'any north temperate plant of the genus Mentha with aromatic leaves' };
  assert.equal(choosePicture(target, mint, hits).title, 'Mentha');
  // Without that clue there is nothing trustworthy: better no picture than mint tea.
  assert.equal(choosePicture({ word: 'mint', kind: 'herb' }, mint, hits), null);
});

test('choosePicture: last, an article that starts with the word', () => {
  const capital = exact([page('Capital', { pageprops: { disambiguation: '' } })], { normalized: [{ from: 'capital', to: 'Capital' }] });
  const hits = search([
    page('Australian Capital Territory', { description: 'Internal territory of Australia' }),
    page('Capital city', { description: 'Seat of government of a country or subnational division' }),
  ]);
  assert.equal(choosePicture({ word: 'capital', kind: 'seat' }, capital, hits).title, 'Capital city');
});

test('choosePicture: dated events and works are never used', () => {
  const pact = exact([{ title: 'Pact', missing: true }]);
  const hits = search([
    page('Tripartite Pact', { description: '1940 World War II mutual defense treaty' }),
    page('Nazareno Pact', { description: '2014–2015 political agreement in Italy' }),
  ]);
  assert.equal(choosePicture({ word: 'pact', kind: 'written agreement' }, pact, hits), null);
});

test('pictures survive the round trip through the compact bundled form', () => {
  const picture = choosePicture({ word: 'goose' }, exact([page('Goose', { description: 'Common name for many waterfowl', pageimage: 'Anser anser (cropped).jpg' })]), null);
  const row = packPicture(picture);
  assert.deepEqual(row, ['Goose', 'commons/thumb/a/ab/Goose.jpg/500px-Goose.jpg', 'Common name for many waterfowl', 'Anser anser (cropped).jpg']);
  assert.deepEqual(unpackPicture(row), { ...picture, bundled: true });

  // An address that does not follow the usual pattern is stored whole.
  const odd = { ...picture, src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Small.png' };
  assert.equal(unpackPicture(packPicture(odd)).src, odd.src);
});

test('toMeanings lists a bundled entry\'s meanings, most common first', () => {
  const entry = {
    pos: 'noun', definition: 'a financial institution', example: 'He cashed a check at the bank.',
    more: [{ pos: 'noun', definition: 'sloping land beside water' }],
  };
  assert.deepEqual(toMeanings(entry), [
    { pos: 'noun', definition: 'a financial institution', example: 'He cashed a check at the bank.' },
    { pos: 'noun', definition: 'sloping land beside water' },
  ]);
  assert.deepEqual(toMeanings({ pos: 'verb', definition: 'move fast' }), [{ pos: 'verb', definition: 'move fast' }]);
});
