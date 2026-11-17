// Definitions and pictures for the word card.
//
// Definitions ship with the site (data/defs/<letter>.json, built from WordNet)
// so they appear instantly and work offline. The few words WordNet lacks fall
// back to Wiktionary. Pictures come from Wikipedia's public API. Both services
// are free, need no key, and are called straight from the browser.

const DATA_URL = new URL('../data/', import.meta.url);
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKTIONARY_API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const TIMEOUT_MS = 8000;

// Bundled thumbnail addresses share a prefix and a suffix; data/pics stores
// only the part in between.
export const THUMB_PREFIX = 'https://thumb.wikimedia.org/wikipedia/';
export const THUMB_SUFFIX = '?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail';

const shards = new Map();
const pictureShards = new Map();
const pictures = new Map();

const MAX_RETRY_WAIT_S = 6;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch JSON; null on any failure. Requests are plain GETs with no custom
 * headers, so the browser sends them without a CORS preflight round trip.
 * A request that fails or is told to slow down is tried once more.
 */
async function getJson(url, retry = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let wait = null;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.ok) return await response.json();
    if (response.status === 429) {
      // Busy: wait as long as the server asks, if that is not long.
      const seconds = Number(response.headers.get('retry-after')) || 2;
      if (seconds <= MAX_RETRY_WAIT_S) wait = seconds * 1000 + 250;
    }
  } catch (error) {
    if (error.name !== 'AbortError') wait = 1500; // a dropped connection
  } finally {
    clearTimeout(timer);
  }
  if (wait === null || !retry) return null;
  await pause(wait);
  return getJson(url, false);
}

// ---------------------------------------------------------- definitions ----

function loadShard(letter) {
  if (!shards.has(letter)) {
    shards.set(letter, getJson(new URL(`defs/${letter}.json`, DATA_URL)).then((data) => data ?? {}));
  }
  return shards.get(letter);
}

/** Split a bundled entry into its meanings, most common first. */
export function toMeanings(entry) {
  const { more = [], ...first } = entry;
  return [first, ...more];
}

/**
 * What a word means: { meanings, source } or null.
 * `meanings` holds one to three entries, most common first, each
 * { pos, definition, example?, lemma?, from?, kind? }.
 */
export async function lookupDefinition(word) {
  const shard = await loadShard(word[0]);
  if (shard[word]) return { meanings: toMeanings(shard[word]), source: 'WordNet' };
  const found = parseWiktionary(await getJson(WIKTIONARY_API + encodeURIComponent(word)));
  if (!found) return null;
  const { source, ...meaning } = found;
  return { meanings: [meaning], source };
}

/** Turn a snippet of HTML from Wiktionary into plain text. */
export function plainText(html) {
  if (!html) return '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(\w+);/g, (match, name) => entities[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pick the first English definition out of a Wiktionary response. */
export function parseWiktionary(data) {
  for (const entry of data?.en ?? []) {
    for (const sense of entry.definitions ?? []) {
      const definition = plainText(sense.definition);
      if (!definition) continue;
      const result = {
        pos: String(entry.partOfSpeech ?? '').toLowerCase(),
        definition,
        source: 'Wiktionary',
      };
      const example = plainText(sense.examples?.[0]);
      if (example) result.example = example;
      return result;
    }
  }
  return null;
}

// -------------------------------------------------------------- pictures ----

function wikipediaQuery(params) {
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*', // anonymous cross-origin access
    redirects: '1',
    prop: 'pageimages|pageprops|description',
    piprop: 'thumbnail|name',
    pithumbsize: '500',
    ppprop: 'disambiguation',
    ...params,
  });
  return getJson(`${WIKIPEDIA_API}?${query}`);
}

/**
 * Does a short article description read like a specific place, person, work or
 * business rather than a general thing? The article "Turkey" is a country and
 * "Nice" a French city; neither illustrates the everyday word.
 */
export function describesNamedEntity(description) {
  if (!description) return false;
  const text = String(description);
  // "City in Mobile County", "Prefecture of Alpes-Maritimes": a kind of place
  // followed by a capitalised name. "State of matter" does not qualify.
  const located = /\b(city|town|village|hamlet|commune|municipality|prefecture|capital|country|county|state|province|territory|region|district|borough|suburb|neighbou?rhood|island|river|lake|mountain|census-designated place)\b[^,;]*?\b(in|of|on|near)\s+(?:the\s+)?(\S)/i.exec(text);
  const place = { test: () => Boolean(located) && /[A-Z]/.test(located[3]) };
  const dated = /\b(1[0-9]|20)\d{2}\b/; // "1997 film", "(born 1970)"
  const work = /\b(film|album|song|single|ep|novel|sitcom|band|tv series|television series|video game|comic|manga|anime)\b\s+(by|from|directed|written|starring)\b/i;
  const person = /\b(actor|actress|singer|rapper|musician|politician|footballer|athlete|writer|author|director|businessman|businesswoman|artist|poet|composer|journalist)\b/i;
  const business = /\b(american|british|canadian|australian|french|german|japanese|multinational|international)\b[^.]*\b(company|corporation|brand|manufacturer|retailer|chain|band|magazine|newspaper)\b/i;
  const name = /\b(surname|given name|family name|disambiguation|list of)\b/i;
  return [place, dated, work, person, business, name].some((pattern) => pattern.test(text));
}

function usable(page) {
  return Boolean(
    page
      && !page.missing
      && !page.invalid
      && page.thumbnail?.source
      && page.pageprops?.disambiguation === undefined
      && !describesNamedEntity(page.description),
  );
}

/** Follow the API's normalisation and redirect notes from a title to its page. */
function pageForTitle(query, title) {
  let current = title;
  for (const step of [query?.normalized, query?.redirects]) {
    const hop = (step ?? []).find((entry) => entry.from === current);
    if (hop) current = hop.to;
  }
  const pages = query?.pages ?? [];
  return pages.find((page) => page.title === current)
    ?? pages.find((page) => page.title?.toLowerCase() === current.toLowerCase());
}

/**
 * How squarely an article title is about the word:
 * 4 "Mole" or "Mole (animal)", 2 "European mole", 1 "Capital city", 0 otherwise.
 */
function titleScore(title, word) {
  const t = title.toLowerCase();
  const w = word.toLowerCase();
  if (t === w || t.startsWith(`${w} (`)) return 4;
  if (t.endsWith(` ${w}`)) return 2;
  if (t.startsWith(`${w} `)) return 1;
  return 0;
}

/**
 * Choose the article whose lead image best illustrates the word.
 *
 * `exact` is the API response for the word's own title(s). `search` is the
 * response for a search on the word plus its category ("mole insectivore"),
 * made only when the word's own article will not do. Either may be null.
 *
 * In order of preference:
 *   1. the word's own article ("Piano"), unless it is a disambiguation page or
 *      a namesake place, person, work or business;
 *   2. a search hit titled for this sense: "Table (furniture)";
 *   3. a search hit with the word as its head noun: "Domestic turkey";
 *   4. a search hit the definition itself names: "Mentha" for mint;
 *   5. a search hit that starts with the word: "Capital city".
 * Anything else is more likely to mislead than to help, so there is no picture.
 */
export function choosePicture({ word, lemma, kind, definition }, exact, search) {
  const titles = [...new Set([word, lemma].filter(Boolean))];
  const hits = [...(search?.query?.pages ?? [])]
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .filter(usable)
    .slice(0, 5);
  const score = (hit) => Math.max(...titles.map((title) => titleScore(hit.title, title)));
  const gloss = ` ${String(definition ?? '').toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  const named = (hit) => hit.title.length > 3
    && hit.title.toLowerCase() !== String(kind ?? '').toLowerCase()
    && gloss.includes(` ${hit.title.toLowerCase()} `);

  const page = titles.map((title) => pageForTitle(exact?.query, title)).find(usable)
    ?? hits.find((hit) => score(hit) === 4)
    ?? hits.find((hit) => score(hit) === 2)
    ?? hits.find(named)
    ?? hits.find((hit) => score(hit) === 1)
    ?? null;
  if (!page) return null;
  return {
    src: page.thumbnail.source,
    title: page.title,
    description: page.description ?? '',
    ...pictureLinks(page.title, page.pageimage),
  };
}

function pictureLinks(title, file) {
  return {
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    fileUrl: file ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}` : null,
  };
}

/** Pack a picture into the compact row stored in data/pics. */
export function packPicture(picture) {
  const src = picture.src.startsWith(THUMB_PREFIX) && picture.src.endsWith(THUMB_SUFFIX)
    ? picture.src.slice(THUMB_PREFIX.length, -THUMB_SUFFIX.length)
    : picture.src;
  const file = picture.fileUrl ? decodeURIComponent(picture.fileUrl.split('/File:')[1]) : '';
  return [picture.title, src, picture.description, file];
}

/** The reverse of packPicture. */
export function unpackPicture([title, src, description, file]) {
  return {
    src: /^https?:/.test(src) ? src : THUMB_PREFIX + src + THUMB_SUFFIX,
    title,
    description: description ?? '',
    ...pictureLinks(title, file),
    bundled: true,
  };
}

function loadPictureShard(letter) {
  if (!pictureShards.has(letter)) {
    pictureShards.set(letter, getJson(new URL(`pics/${letter}.json`, DATA_URL)));
  }
  return pictureShards.get(letter);
}

async function findPicture(word, entry, { skipOwnArticle = false } = {}) {
  const lemma = entry?.lemma ?? entry?.from ?? null;
  const kind = entry?.kind ?? null;
  const target = { word, lemma, kind, definition: entry?.definition };
  const titles = [...new Set([word, lemma].filter(Boolean))];

  // The word's own article usually settles it in one request.
  const exact = skipOwnArticle ? undefined : await wikipediaQuery({ titles: titles.join('|') });
  let picture = choosePicture(target, exact, null);
  let search;
  if (!picture && kind) {
    // An ambiguous noun: search with its category to find the right sense.
    search = await wikipediaQuery({
      generator: 'search',
      gsrsearch: `${lemma ?? word} ${kind}`,
      gsrnamespace: '0',
      gsrlimit: '5',
    });
    picture = choosePicture(target, exact, search);
  }
  // "Nothing suitable" is an answer worth remembering; "could not reach
  // Wikipedia" is not, so that the next tap tries again.
  if (!picture && (exact === null || search === null)) throw new Error('lookup failed');
  return picture;
}

async function pictureFor(word, entry, live, index) {
  if (index > 0) {
    // A second or third meaning: the word's own article shows the first one,
    // so only a search on this meaning's category can find the right picture.
    return entry?.kind ? findPicture(word, entry, { skipOwnArticle: true }) : null;
  }
  if (!live) {
    // The picture index built by tools/build_pictures.mjs answers most words
    // without calling anyone. A word missing from it has no usable article of
    // its own, which leaves only the category search for nouns.
    const bundled = await loadPictureShard(word[0]);
    if (bundled?.[word]) return unpackPicture(bundled[word]);
    if (bundled) return entry?.kind ? findPicture(word, entry, { skipOwnArticle: true }) : null;
  }
  return findPicture(word, entry);
}

/**
 * A picture representing the word, or null when there is no good match.
 * `entry` is one of the meanings from lookupDefinition (may be null) and
 * `index` its position among them. Pass `live: true` to skip the bundled
 * index, for instance when a bundled picture no longer loads.
 */
export function lookupPicture(word, entry, { live = false, index = 0 } = {}) {
  const key = `${word}|${index}|${live}`;
  if (!pictures.has(key)) {
    pictures.set(key, pictureFor(word, entry, live, index).catch(() => {
      pictures.delete(key);
      return null;
    }));
  }
  return pictures.get(key);
}
