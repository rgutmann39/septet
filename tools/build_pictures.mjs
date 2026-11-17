#!/usr/bin/env node
// Build the bundled picture index: site/data/pics/<a-z>.json
//
// For every word in the dictionary this asks Wikipedia (50 titles per request)
// for the lead image of the article with that title, then keeps the ones the
// game would accept, using the same choosePicture() the browser uses. The
// result ships with the site, so most pictures appear without any API call;
// the browser only searches live for ambiguous words that have no entry here.
//
// Usage:  node tools/build_pictures.mjs
//
// Responses are cached in tools/.cache/wikipedia.json, so an interrupted run
// resumes where it stopped and a rebuild only fetches new words. Delete the
// cache to refresh every picture.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { choosePicture, packPicture } from '../site/js/lookup.js';

const DATA = new URL('../site/data/', import.meta.url);
const CACHE_DIR = new URL('./.cache/', import.meta.url);
const CACHE = new URL('wikipedia.json', CACHE_DIR);
const API = 'https://en.wikipedia.org/w/api.php';
// Wikimedia asks automated clients to say who runs them. Set SEPTET_CONTACT
// to a URL or email address of yours before running this script.
const CONTACT = process.env.SEPTET_CONTACT;
const USER_AGENT = `SeptetWordGame/1.0 (picture index build; ${CONTACT})`;
const BATCH = 50;
const PAUSE_MS = 1200;
const MAX_TRIES = 3;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function query(params) {
  const url = `${API}?${new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    maxlag: '5',
    prop: 'pageimages|pageprops|description',
    piprop: 'thumbnail|name',
    pithumbsize: '500',
    pilimit: '50',
    ppprop: 'disambiguation',
    ...params,
  })}`;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (response.status === 429) {
        // Over the allowance for this address. Do not push: stop, keep what
        // is cached, and let the operator try again later.
        throw Object.assign(new Error(
          'Wikipedia says this address is making too many requests (HTTP 429). Stopped.\n'
          + 'Progress is cached; run the script again later to resume. See\n'
          + 'https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits'), { fatal: true });
      }
      if (response.ok) {
        const data = await response.json();
        if (!data.error) return data;
      }
      const wait = Number(response.headers.get('retry-after')) || 2 * attempt;
      await pause(Math.min(wait, 60) * 1000 + 500);
    } catch (error) {
      if (error.fatal) throw error;
      await pause(2000 * attempt);
    }
  }
  throw new Error('Wikipedia did not answer; run the script again to resume.');
}

/** Fetch one batch of titles; returns { requested title: page | null }. */
async function fetchBatch(titles) {
  const pages = new Map();
  const hops = [];
  let more = {};
  for (;;) {
    const data = await query({ titles: titles.join('|'), ...more });
    for (const page of data.query?.pages ?? []) {
      pages.set(page.title, { ...pages.get(page.title), ...page });
    }
    hops.push(...(data.query?.normalized ?? []), ...(data.query?.redirects ?? []));
    if (!data.continue) break;
    more = data.continue;
    await pause(PAUSE_MS);
  }
  const result = {};
  for (const title of titles) {
    let current = title;
    for (let i = 0; i < 4; i++) {
      const hop = hops.find((entry) => entry.from === current);
      if (!hop) break;
      current = hop.to;
    }
    const page = pages.get(current);
    result[title] = !page || page.missing || page.invalid ? null : {
      title: page.title,
      pageid: page.pageid,
      ...(page.thumbnail && { thumbnail: page.thumbnail, pageimage: page.pageimage }),
      ...(page.description && { description: page.description }),
      ...(page.pageprops?.disambiguation !== undefined && { pageprops: { disambiguation: '' } }),
    };
  }
  return result;
}

async function main() {
  if (!CONTACT) {
    throw new Error('Set SEPTET_CONTACT to a URL or email address of yours first, e.g.\n'
      + '  SEPTET_CONTACT=https://github.com/you/septet node tools/build_pictures.mjs');
  }
  const words = readFileSync(new URL('words.txt', DATA), 'utf8').split('\n').filter(Boolean);
  const definitions = {};
  for (const name of readdirSync(new URL('defs/', DATA))) {
    Object.assign(definitions, JSON.parse(readFileSync(new URL(`defs/${name}`, DATA), 'utf8')));
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const baseOf = (word) => definitions[word]?.lemma ?? definitions[word]?.from ?? null;
  const wanted = [...new Set(words.flatMap((word) => [word, baseOf(word)]).filter(Boolean))]
    .filter((title) => !(title in cache));

  console.log(`${words.length} words; ${wanted.length} titles to fetch (${Object.keys(cache).length} cached)`);
  for (let i = 0; i < wanted.length; i += BATCH) {
    Object.assign(cache, await fetchBatch(wanted.slice(i, i + BATCH)));
    writeFileSync(CACHE, JSON.stringify(cache));
    if ((i / BATCH) % 10 === 9 || i + BATCH >= wanted.length) {
      console.log(`  ${Math.min(i + BATCH, wanted.length)} / ${wanted.length}`);
    }
    await pause(PAUSE_MS);
  }

  const shards = {};
  let count = 0;
  for (const word of words) {
    const entry = definitions[word];
    const lemma = baseOf(word);
    const pages = [word, lemma].filter(Boolean).map((title) => cache[title]).filter(Boolean);
    const exact = {
      query: {
        pages,
        normalized: [word, lemma].filter((title) => title && cache[title])
          .map((title) => ({ from: title, to: cache[title].title })),
      },
    };
    const picture = choosePicture({ word, lemma, kind: entry?.kind, definition: entry?.definition }, exact, null);
    (shards[word[0]] ??= {})[word] = picture ? packPicture(picture) : 0;
    if (picture) count += 1;
  }

  const out = new URL('pics/', DATA);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [letter, entries] of Object.entries(shards)) {
    // Words without a picture are left out; the file's presence means "this
    // letter was checked", so the browser need not ask about them again.
    const kept = Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
    writeFileSync(new URL(`${letter}.json`, out), `${JSON.stringify(kept)}\n`);
  }
  console.log(`${count} of ${words.length} words have a bundled picture`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
