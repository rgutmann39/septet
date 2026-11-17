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

const shards = new Map();
const pictures = new Map();

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------- definitions ----

function loadShard(letter) {
  if (!shards.has(letter)) {
    shards.set(letter, getJson(new URL(`defs/${letter}.json`, DATA_URL)).then((data) => data ?? {}));
  }
  return shards.get(letter);
}

/**
 * The most common definition of a word:
 * { pos, definition, example?, lemma?, from?, kind?, source } or null.
 */
export async function lookupDefinition(word) {
  const shard = await loadShard(word[0]);
  if (shard[word]) return { ...shard[word], source: 'WordNet' };
  const data = await getJson(WIKTIONARY_API + encodeURIComponent(word));
  return parseWiktionary(data);
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
  const located = /\b(city|town|village|hamlet|commune|municipality|prefecture|capital|country|county|state|province|region|district|borough|suburb|neighbou?rhood|island|river|lake|mountain|census-designated place)\b[^,;]*?\b(in|of|on|near)\s+(?:the\s+)?(\S)/i.exec(text);
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

function mentions(title, word) {
  return new RegExp(`\\b${word.replace(/[^a-z]/gi, '')}`, 'i').test(title);
}

/**
 * Choose the article whose lead image best illustrates the word.
 *
 * `exact` is the API response for the word's own title(s); `search` is the
 * response for a search on the word plus its category ("mole insectivore"),
 * present only when the definition supplies one.
 */
export function choosePicture({ word, lemma, kind }, exact, search) {
  const titles = [...new Set([word, lemma].filter(Boolean))];
  const own = titles.map((title) => pageForTitle(exact?.query, title)).find(usable);
  const hits = [...(search?.query?.pages ?? [])]
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .filter(usable)
    .slice(0, 5);

  let page = null;
  if (!kind) {
    page = own ?? null;
  } else if (own && hits.some((hit) => hit.pageid === own.pageid)) {
    page = own; // the obvious article, and the category search agrees
  } else {
    // Prefer an article about this sense of the word: "Mole (animal)".
    page = hits.find((hit) => titles.some((title) => mentions(hit.title, title)))
      ?? own
      ?? hits.find((hit) => hit.index === 1) // e.g. "Mentha" for mint
      ?? null;
  }
  if (!page) return null;
  return {
    src: page.thumbnail.source,
    width: page.thumbnail.width,
    height: page.thumbnail.height,
    title: page.title,
    description: page.description ?? '',
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    fileUrl: page.pageimage
      ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`
      : null,
  };
}

/**
 * A picture representing the word, or null when there is no good match.
 * `entry` is the definition returned by lookupDefinition (may be null).
 */
export function lookupPicture(word, entry) {
  if (!pictures.has(word)) {
    const lemma = entry?.lemma ?? entry?.from ?? null;
    const kind = entry?.kind ?? null;
    const titles = [...new Set([word, lemma].filter(Boolean))];
    const exact = wikipediaQuery({ titles: titles.join('|') });
    const search = kind
      ? wikipediaQuery({
        generator: 'search',
        gsrsearch: `${lemma ?? word} ${kind}`,
        gsrnamespace: '0',
        gsrlimit: '5',
      })
      : Promise.resolve(null);
    pictures.set(word, Promise.all([exact, search])
      .then(([exactData, searchData]) => choosePicture({ word, lemma, kind }, exactData, searchData)));
  }
  return pictures.get(word);
}
