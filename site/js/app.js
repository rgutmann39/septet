// Septet: the page. Rules live in core.js; word lookups in lookup.js.

import {
  RANKS, checkGuess, createPuzzle, dateKey, daysBetween, hintTables, isDateKey, isSeptet,
  puzzleIndexFor, rankIndex, rankTable, scoreOf, shiftDateKey, shuffled,
} from './core.js';
import { pronounce, stopPronouncing } from './audio.js';
import { lookupDefinition, lookupPicture } from './lookup.js';

const STORE_KEY = 'septet.v1';
const MAX_ENTRY = 19;
const ARCHIVE_DAYS = 60;
const TOP_REGULAR_RANK = RANKS.length - 2; // the last rank before "every word"

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const ERRORS = {
  short: 'Too short',
  found: 'Already found',
  letters: "Not one of today's letters",
  center: 'Needs the center letter',
  unknown: 'Not in the word list',
};

// ------------------------------------------------------------------ state --

let dictionary = [];
let schedule = { epoch: dateKey(), puzzles: [] };
let store = loadStore();
let today = dateKey();
let viewDate = today;
let puzzle = null;
let found = [];
let revealed = false;
let entry = '';
let outer = [];
let locked = false;

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && typeof saved === 'object') return { ...saved, days: saved.days ?? {} };
  } catch { /* private mode or corrupt data: start fresh */ }
  return { days: {} };
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* storage full or unavailable: play on without saving */ }
}

function lettersFor(date) {
  return schedule.puzzles[puzzleIndexFor(date, schedule.epoch, schedule.puzzles.length)];
}

/** Words saved for a date, if they belong to the puzzle now scheduled for it. */
function savedWords(date, forPuzzle) {
  const day = store.days[date];
  if (!day || day.l !== forPuzzle.letters) return [];
  return day.w.filter((word) => forPuzzle.answerSet.has(word));
}

/** Whether the answers were revealed for a date's current puzzle. */
function isRevealed(date, forPuzzle) {
  const day = store.days[date];
  return Boolean(day?.v && day.l === forPuzzle.letters);
}

function persist() {
  const score = scoreOf(found);
  store.days[viewDate] = {
    l: puzzle.letters,
    w: found,
    s: score,
    t: puzzle.total,
    r: rankIndex(score, puzzle.total),
    p: found.filter(isSeptet).length,
    ...(revealed && { v: 1 }),
  };
  saveStore();
}

function formatDate(key, options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(y, m - 1, d));
}

// ------------------------------------------------------------------- game --

function openDay(date) {
  closeCard();
  viewDate = date;
  puzzle = createPuzzle(lettersFor(date), dictionary);
  found = savedWords(date, puzzle);
  revealed = isRevealed(date, puzzle);
  entry = '';
  outer = [...puzzle.outer];
  const url = new URL(location.href);
  if (date === today) url.searchParams.delete('date');
  else url.searchParams.set('date', date);
  history.replaceState(null, '', url);
  renderDate();
  renderBoard();
  renderEntry();
  renderStatus();
  renderFound();
}

function renderDate() {
  $('puzzle-date').textContent = formatDate(viewDate);
  $('back-to-today').hidden = viewDate === today;
}

function renderBoard() {
  const board = $('board');
  board.replaceChildren();
  const tile = (letter, kind, x, y) => el('button', {
    type: 'button',
    className: `tile ${kind}`,
    textContent: letter,
    style: `left:${x}%;top:${y}%`,
    onclick: () => addLetter(letter),
  });
  board.append(tile(puzzle.center, 'center', 50, 50));
  outer.forEach((letter, i) => {
    const angle = ((-90 + 60 * i) * Math.PI) / 180;
    board.append(tile(letter, 'outer', 50 + 34 * Math.cos(angle), 50 + 34 * Math.sin(angle)));
  });
}

function renderEntry() {
  const box = $('entry');
  box.replaceChildren();
  if (!entry) {
    box.append(el('span', { className: 'placeholder', textContent: 'Type or tap letters' }));
    return;
  }
  for (const ch of entry) {
    const className = ch === puzzle.center ? 'hit' : puzzle.letters.includes(ch) ? '' : 'miss';
    box.append(el('span', { className, textContent: ch }));
  }
  box.append(el('span', { className: 'caret' }));
}

function renderStatus() {
  const score = scoreOf(found);
  const table = rankTable(puzzle.total);
  const index = rankIndex(score, puzzle.total);
  $('rank-name').textContent = table[index].name;
  $('score').textContent = score;
  $('score-unit').textContent = score === 1 ? 'point' : 'points';

  const next = table[index + 1];
  $('next-rank').textContent = next
    ? `${plural(next.score - score, 'point')} to ${next.name}`
    : 'Every word found. Bravo!';

  const meter = $('meter');
  meter.replaceChildren();
  for (let i = 0; i < table.length - 1; i++) {
    const span = table[i + 1].score - table[i].score;
    const fill = clamp((score - table[i].score) / span, 0, 1);
    meter.append(el('span', { className: 'seg' }, el('i', { style: `width:${fill * 100}%` })));
  }
  meter.setAttribute('aria-label', `${table[index].name}: ${score} of ${puzzle.total} points`);
}

function wordButton(word, extraClass = '') {
  return el('button', {
    type: 'button',
    className: `word ${isSeptet(word) ? 'septet' : ''} ${extraClass}`.trim(),
    textContent: word,
    ariaExpanded: 'false',
  });
}

function renderFound(justAdded) {
  const count = found.length;
  $('found-count').textContent = count ? `${plural(count, 'word')} found` : 'No words yet';
  $('found-preview').textContent = [...found].reverse().slice(0, 12).join('  ');
  $('found-tip').hidden = count === 0;
  const list = $('found-list');
  list.replaceChildren();
  for (const word of [...found].sort()) {
    const button = wordButton(word, word === justAdded ? 'new' : '');
    button.dataset.word = word;
    list.append(el('li', {}, button));
  }
}

let toastTimer;
function toast(text, tone = 'info') {
  const box = $('toast');
  box.textContent = text;
  box.dataset.tone = tone;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 1800);
}

function addLetter(letter) {
  if (locked) return;
  if (entry.length >= MAX_ENTRY) {
    toast('Too long');
    return;
  }
  entry += letter.toLowerCase();
  renderEntry();
}

function deleteLetter() {
  if (locked) return;
  entry = entry.slice(0, -1);
  renderEntry();
}

function shuffleLetters() {
  const board = $('board');
  board.classList.add('shuffling');
  setTimeout(() => {
    let next = shuffled(outer);
    if (next.join('') === outer.join('')) next = [...outer.slice(1), outer[0]];
    outer = next;
    renderBoard();
    board.classList.remove('shuffling');
  }, 180);
}

function submit() {
  if (locked) return;
  const result = checkGuess(puzzle, found, entry);
  if (result.reason === 'empty') return;
  if (!result.ok) {
    toast(ERRORS[result.reason], 'error');
    const box = $('entry');
    locked = true;
    box.classList.add('shake');
    setTimeout(() => {
      box.classList.remove('shake');
      entry = '';
      locked = false;
      renderEntry();
    }, 550);
    return;
  }

  const before = rankIndex(scoreOf(found), puzzle.total);
  found.push(result.word);
  persist();
  entry = '';
  renderEntry();
  renderStatus();
  renderFound(result.word);

  const praise = result.septet ? 'Septet!' : result.points >= 7 ? 'Superb!' : result.points >= 5 ? 'Great!' : 'Nice!';
  toast(`${praise} +${result.points}`, result.septet ? 'septet' : 'good');

  const after = rankIndex(scoreOf(found), puzzle.total);
  if (after > before && after >= TOP_REGULAR_RANK) setTimeout(() => cheer(after), 900);
}

function cheer(index) {
  const everything = index === RANKS.length - 1;
  $('cheer-title').textContent = `${RANKS[index].name}!`;
  $('cheer-text').textContent = everything
    ? `You found all ${puzzle.answers.length} words. Take a bow.`
    : `${scoreOf(found)} points puts you at the top rank. ${plural(puzzle.answers.length - found.length, 'word')} remain if you want every last one.`;
  showDialog('cheer');
}

// ---------------------------------------------------------------- dialogs --

const fillers = {
  ranks: fillRanks,
  hints: fillHints,
  answers: fillAnswers,
  yesterday: fillYesterday,
  stats: fillStats,
  archive: fillArchive,
};

function showDialog(name) {
  closeCard();
  fillers[name]?.();
  const dialog = $(`dlg-${name}`);
  if (!dialog.open) dialog.showModal();
}

function fillRanks() {
  const score = scoreOf(found);
  const table = rankTable(puzzle.total);
  const index = rankIndex(score, puzzle.total);
  $('ranks-lede').textContent = `Each rank is a share of the ${puzzle.total} points in this puzzle. You have ${score}.`;
  const list = $('rank-table');
  list.replaceChildren();
  [...table].reverse().forEach((rank, i) => {
    const position = table.length - 1 - i;
    const item = el('li', { className: position === index ? 'current' : position < index ? 'done' : '' },
      el('span', { className: 'rank-row-name', textContent: rank.name }),
      el('span', { className: 'rank-row-score', textContent: rank.score }));
    if (position === index) item.setAttribute('aria-current', 'true');
    list.append(item);
  });
  $('share-note').textContent = '';
}

function shareText() {
  const score = scoreOf(found);
  const rank = rankTable(puzzle.total)[rankIndex(score, puzzle.total)].name;
  const septets = found.filter(isSeptet).length;
  return [
    `Septet · ${formatDate(viewDate, { month: 'short', day: 'numeric', year: 'numeric' })}`,
    `${rank}: ${score} of ${puzzle.total} points`,
    `${found.length} of ${puzzle.answers.length} words${septets ? `, ${plural(septets, 'septet')}` : ''}`,
    ...(revealed ? ['Answers revealed'] : []),
  ].join('\n');
}

async function copyResult() {
  const note = $('share-note');
  try {
    await navigator.clipboard.writeText(shareText());
    note.textContent = 'Copied';
  } catch {
    note.textContent = shareText();
  }
}

function fillHints() {
  const { answers, septets, total } = puzzle;
  const perfect = septets.filter((word) => word.length === 7).length;
  const starts = new Set(answers.map((word) => word[0]));
  const parts = [
    plural(answers.length, 'word'),
    plural(total, 'point'),
    `${plural(septets.length, 'septet')}${perfect ? ` (${perfect} with exactly seven letters)` : ''}`,
  ];
  if (starts.size === 7) parts.push('every letter starts a word');
  $('hints-summary').textContent = `${parts.join(' · ')}. You have ${plural(found.length, 'word')} and ${plural(scoreOf(found), 'point')}.`;

  const onlyLeft = $('hints-left').checked;
  const tables = hintTables(answers, found);
  const pick = (counts) => (onlyLeft ? counts.left : counts.total);
  const cellText = (n) => (n ? String(n) : '–');

  const grid = $('hint-grid');
  grid.replaceChildren();
  const head = el('tr', {}, el('th', { scope: 'col', ariaLabel: 'First letter' }));
  for (const length of tables.lengths) head.append(el('th', { scope: 'col', textContent: length }));
  head.append(el('th', { scope: 'col', textContent: 'All', className: 'sum' }));
  grid.append(el('thead', {}, head));

  const body = el('tbody');
  const columnTotals = tables.lengths.map(() => 0);
  let grand = 0;
  for (const letter of tables.letters) {
    const row = el('tr', {}, el('th', { scope: 'row', textContent: letter }));
    let rowTotal = 0;
    tables.lengths.forEach((length, i) => {
      const n = pick(tables.cell(letter, length));
      rowTotal += n;
      columnTotals[i] += n;
      row.append(el('td', { textContent: cellText(n), className: n ? '' : 'zero' }));
    });
    grand += rowTotal;
    row.append(el('td', { textContent: cellText(rowTotal), className: 'sum' }));
    body.append(row);
  }
  const foot = el('tr', { className: 'sum' }, el('th', { scope: 'row', textContent: 'All' }));
  for (const n of columnTotals) foot.append(el('td', { textContent: cellText(n) }));
  foot.append(el('td', { textContent: cellText(grand) }));
  body.append(foot);
  grid.append(body);

  const pairs = $('pair-list');
  pairs.replaceChildren();
  for (const item of tables.pairs) {
    const n = pick(item);
    if (!n) continue;
    pairs.append(el('li', {}, el('b', { textContent: item.pair }), ` ${n}`));
  }
  if (!pairs.children.length) pairs.append(el('li', { textContent: 'Nothing left to find.' }));
}

function fillAnswers() {
  const isToday = viewDate === today;
  $('answers-title').textContent = isToday ? "Today's answers" : `Answers for ${formatDate(viewDate, { month: 'short', day: 'numeric' })}`;
  $('answers-gate').hidden = revealed;
  $('answers-shown').hidden = !revealed;
  const list = $('answers-list');
  list.replaceChildren();
  if (!revealed) {
    const left = puzzle.answers.length - found.length;
    const which = isToday ? "today's" : 'this';
    $('answers-ask').textContent = !left
      ? 'You have found every word already. Reveal the list anyway?'
      : `This shows all ${plural(puzzle.answers.length, 'word')} in ${which} puzzle`
        + `${found.length ? `, including the ${plural(left, 'word')} you have not found yet` : ''}. `
        + 'You can keep playing afterwards.';
    return;
  }
  const mine = new Set(found);
  $('answers-lede').textContent = `You found ${found.length} of ${plural(puzzle.answers.length, 'word')} `
    + `and ${scoreOf(found)} of ${plural(puzzle.total, 'point')}.`;
  for (const word of puzzle.answers) {
    const button = wordButton(word, mine.has(word) ? 'got' : 'missed');
    button.dataset.word = word;
    if (mine.has(word)) button.append(el('span', { className: 'visually-hidden', textContent: ' (found)' }));
    list.append(el('li', {}, button));
  }
}

function revealAnswers() {
  revealed = true;
  persist();
  fillAnswers();
  $('answers-list').querySelector('button')?.focus();
}

function fillYesterday() {
  const date = shiftDateKey(viewDate, -1);
  $('yesterday-title').textContent = viewDate === today ? "Yesterday's answers" : 'The day before';
  const letters = $('yesterday-letters');
  const list = $('yesterday-list');
  letters.replaceChildren();
  list.replaceChildren();
  if (daysBetween(schedule.epoch, date) < 0) {
    $('yesterday-lede').textContent = 'This is the very first puzzle, so there is nothing before it.';
    return;
  }
  const past = createPuzzle(lettersFor(date), dictionary);
  const mine = new Set(savedWords(date, past));
  $('yesterday-lede').textContent = `${formatDate(date)}. ${mine.size
    ? `You found ${mine.size} of ${past.answers.length} words.`
    : `${past.answers.length} words; you did not play this one.`}`;
  for (const letter of past.letters) letters.append(el('span', { textContent: letter }));
  for (const word of past.answers) {
    const button = wordButton(word, mine.has(word) ? 'got' : 'missed');
    button.dataset.word = word;
    if (mine.has(word)) button.append(el('span', { className: 'visually-hidden', textContent: ' (found)' }));
    list.append(el('li', {}, button));
  }
}

function playedDays() {
  return Object.entries(store.days)
    .filter(([key, day]) => isDateKey(key) && Array.isArray(day?.w) && day.w.length)
    .map(([key, day]) => {
      const score = day.s ?? scoreOf(day.w);
      const total = day.t ?? score;
      return {
        date: key,
        words: day.w.length,
        score,
        total,
        rank: day.r ?? rankIndex(score, total),
        septets: day.p ?? day.w.filter(isSeptet).length,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function fillStats() {
  const days = playedDays();
  const dates = new Set(days.map((day) => day.date));
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of days) {
    run = previous && daysBetween(previous, day.date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day.date;
  }
  let current = 0;
  let cursor = dates.has(today) ? today : shiftDateKey(today, -1);
  while (dates.has(cursor)) {
    current += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  const sum = (key) => days.reduce((total, day) => total + day[key], 0);
  const tiles = [
    ['Days played', days.length],
    ['Words found', sum('words')],
    ['Septets found', sum('septets')],
    ['Points scored', sum('score')],
    ['Current streak', current],
    ['Longest streak', best],
  ];
  const box = $('stat-tiles');
  box.replaceChildren();
  for (const [label, value] of tiles) {
    box.append(el('div', { className: 'tile-stat' },
      el('dt', { textContent: label }),
      el('dd', { textContent: value.toLocaleString() })));
  }

  const counts = RANKS.map((_, i) => days.filter((day) => day.rank === i).length);
  const most = Math.max(1, ...counts);
  const table = $('rank-days');
  table.replaceChildren();
  const body = el('tbody');
  for (let i = RANKS.length - 1; i >= 0; i--) {
    body.append(el('tr', {},
      el('th', { scope: 'row', textContent: RANKS[i].name }),
      el('td', { className: 'num', textContent: counts[i] }),
      el('td', { className: 'bar-cell', ariaHidden: 'true' },
        el('span', { className: 'bar', style: `width:${(counts[i] / most) * 100}%` }))));
  }
  table.append(body);
}

function fillArchive() {
  const list = $('archive-list');
  list.replaceChildren();
  const span = Math.min(ARCHIVE_DAYS, daysBetween(schedule.epoch, today) + 1);
  for (let back = 0; back < span; back++) {
    const date = shiftDateKey(today, -back);
    const day = store.days[date];
    const played = day?.w?.length && day.l === lettersFor(date);
    const current = day?.l === lettersFor(date);
    const status = played
      ? `${RANKS[day.r ?? 0].name} · ${day.s} of ${day.t} points${day.v ? ' · revealed' : ''}`
      : current && day.v ? 'Answers revealed' : 'Not played yet';
    const label = back === 0 ? 'Today' : formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
    const button = el('button', {
      type: 'button',
      className: 'pill small',
      textContent: date === viewDate ? 'Playing' : played ? 'Resume' : 'Play',
      disabled: date === viewDate,
      onclick: () => {
        $('dlg-archive').close();
        openDay(date);
      },
    });
    list.append(el('li', { className: date === viewDate ? 'current' : '' },
      el('span', { className: 'archive-date', textContent: label }),
      el('span', { className: 'archive-status', textContent: status }),
      button));
  }
}

// -------------------------------------------------------------- word card --

const card = $('word-card');
const popoverSupported = typeof card.showPopover === 'function';
if (!popoverSupported) {
  card.removeAttribute('popover');
  card.classList.add('fallback');
}
let cardAnchor = null;
let cardRequest = 0;

function cardIsOpen() {
  return popoverSupported ? card.matches(':popover-open') : card.classList.contains('open');
}

function closeCard() {
  cardRequest += 1;
  stopPronouncing();
  if (cardAnchor) cardAnchor.setAttribute('aria-expanded', 'false');
  cardAnchor = null;
  if (!cardIsOpen()) return;
  if (popoverSupported) card.hidePopover();
  else card.classList.remove('open');
}

function positionCard() {
  if (!cardAnchor || !cardIsOpen()) return;
  const sheet = window.matchMedia('(max-width: 560px)').matches;
  card.classList.toggle('sheet', sheet);
  if (sheet) {
    card.style.left = '';
    card.style.top = '';
    return;
  }
  const anchor = cardAnchor.getBoundingClientRect();
  if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
    closeCard(); // scrolled out of sight
    return;
  }
  const margin = 10;
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const middle = anchor.left + anchor.width / 2;
  const left = clamp(middle - width / 2, margin, window.innerWidth - width - margin);
  const below = anchor.bottom + 10;
  const above = anchor.top - 10 - height;
  const fitsBelow = below + height <= window.innerHeight - margin;
  const side = fitsBelow || above < margin ? 'below' : 'above';
  const top = side === 'below' ? Math.max(margin, Math.min(below, window.innerHeight - height - margin)) : above;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.dataset.side = fitsBelow || side === 'above' ? side : 'none';
  card.style.setProperty('--arrow', `${clamp(middle - left, 20, width - 20)}px`);
}

function setFigure(state, picture) {
  const figure = $('card-figure');
  const image = $('card-image');
  const caption = $('card-caption');
  figure.dataset.state = state;
  caption.replaceChildren();
  if (state === 'ready') {
    image.alt = picture.title;
    $('card-image-link').href = picture.pageUrl;
    caption.append(
      el('a', { href: picture.pageUrl, target: '_blank', rel: 'noopener', textContent: picture.title }),
      picture.description ? ` · ${picture.description}` : '',
      ' · ',
      el('a', {
        href: picture.fileUrl ?? picture.pageUrl,
        target: '_blank',
        rel: 'noopener',
        textContent: 'image credit',
      }),
    );
  } else {
    image.removeAttribute('src');
    image.alt = '';
    $('card-image-link').removeAttribute('href');
    if (state === 'none') caption.textContent = 'No picture found for this word.';
  }
  positionCard();
}

/** Put a sample sentence on the card with the word itself in bold. */
function showExample(box, sentence, word, base) {
  box.replaceChildren();
  box.hidden = !sentence;
  if (!sentence) return;
  // The word as written, else any form of its base ("pottering" for "potter").
  const match = new RegExp(`\\b${word}\\b`, 'i').exec(sentence)
    ?? (base ? new RegExp(`\\b${base}[a-z]*`, 'i').exec(sentence) : null);
  if (!match) {
    box.textContent = sentence;
    return;
  }
  box.append(
    sentence.slice(0, match.index),
    el('b', { textContent: match[0] }),
    sentence.slice(match.index + match[0].length),
  );
}

/** Show one of the word's meanings: definition, sentence, picture. */
function showMeaning(word, meanings, index, request) {
  const meaning = meanings[index];
  const base = meaning.lemma ?? meaning.from;
  $('card-pos').textContent = meaning.pos;
  $('card-definition').textContent = meaning.definition;
  showExample($('card-example'), meaning.example, word, base);
  $('card-origin').hidden = !base;
  if (base) $('card-origin').textContent = meaning.lemma ? `A form of “${base}”.` : `From “${base}”.`;
  for (const tab of $('card-tabs').querySelectorAll('button')) {
    tab.setAttribute('aria-pressed', String(Number(tab.dataset.index) === index));
  }

  setFigure('loading');
  const current = () => request === cardRequest && $('card-tabs').dataset.index === String(index);
  const show = (picture, retry) => {
    if (!current()) return;
    if (!picture) {
      setFigure('none');
      return;
    }
    const image = $('card-image');
    image.onload = () => current() && setFigure('ready', picture);
    // A bundled picture can go stale (renamed or deleted file): look again, live.
    image.onerror = () => (retry
      ? lookupPicture(word, meaning, { live: true, index }).then((fresh) => show(fresh, false))
      : show(null));
    image.src = picture.src;
  };
  $('card-tabs').dataset.index = String(index);
  lookupPicture(word, meaning, { index }).then((picture) => show(picture, Boolean(picture?.bundled)));
}

function setPlayState(state) {
  const button = $('card-play');
  button.dataset.state = state;
  button.setAttribute('aria-busy', String(state === 'loading'));
}

async function playWord() {
  const word = $('card-word').textContent;
  const request = cardRequest;
  const note = $('card-audio-note');
  const result = await pronounce(word, (state) => request === cardRequest && setPlayState(state));
  if (request !== cardRequest) return;
  note.replaceChildren();
  if (!result) {
    note.textContent = ' · No audio could be played on this device';
  } else if (result.source === 'recording') {
    note.append(' · ', el('a', {
      href: result.page, target: '_blank', rel: 'noopener', textContent: 'Recording from Wikimedia Commons',
    }));
  } else {
    note.textContent = ' · Spoken by your device’s voice';
  }
}

async function openCard(word, anchor, byKeyboard = false) {
  const reopening = cardAnchor === anchor && cardIsOpen();
  closeCard();
  if (reopening) return; // a second tap on the same word closes it

  const request = ++cardRequest;
  cardAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');

  // An open modal dialog makes the rest of the page inert, so the card has to
  // live inside the dialog its word is in.
  const host = anchor.closest('dialog') ?? document.body;
  if (card.parentElement !== host) host.append(card);

  const tabs = $('card-tabs');
  $('card-word').textContent = word;
  $('card-pos').textContent = '';
  $('card-badge').hidden = !isSeptet(word);
  $('card-definition').textContent = 'Looking it up…';
  $('card-example').hidden = true;
  $('card-origin').hidden = true;
  $('card-source').textContent = '';
  $('card-audio-note').textContent = '';
  $('card-play').setAttribute('aria-label', `Hear “${word}” pronounced`);
  $('card-more').href = `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`;
  tabs.hidden = true;
  tabs.replaceChildren();
  delete tabs.dataset.index;
  setPlayState('idle');
  setFigure('loading');

  if (popoverSupported) card.showPopover();
  else card.classList.add('open');
  positionCard();
  if (byKeyboard) $('card-play').focus();

  const found = await lookupDefinition(word);
  if (request !== cardRequest) return;
  if (!found) {
    $('card-definition').textContent = 'No definition on file for this one.';
    lookupPicture(word, null).then((picture) => {
      if (request !== cardRequest) return;
      if (!picture) {
        setFigure('none');
        return;
      }
      const image = $('card-image');
      image.onload = () => request === cardRequest && setFigure('ready', picture);
      image.onerror = () => request === cardRequest && setFigure('none');
      image.src = picture.src;
    });
    positionCard();
    return;
  }

  const { meanings, source } = found;
  $('card-source').textContent = ` · Definition from ${source}`;
  if (meanings.length > 1) {
    tabs.append(el('span', { className: 'tabs-label', textContent: `${meanings.length} meanings` }));
    meanings.forEach((meaning, index) => {
      tabs.append(el('button', {
        type: 'button',
        textContent: String(index + 1),
        title: meaning.definition,
        onclick: () => {
          showMeaning(word, meanings, index, request);
          positionCard();
        },
      }));
      tabs.lastChild.dataset.index = String(index);
      tabs.lastChild.setAttribute('aria-label', `Meaning ${index + 1} of ${meanings.length}: ${meaning.pos}`);
    });
    tabs.hidden = false;
  }
  showMeaning(word, meanings, 0, request);
  positionCard();
}

// ----------------------------------------------------------------- events --

function bindEvents() {
  $('btn-delete').onclick = deleteLetter;
  $('btn-shuffle').onclick = shuffleLetters;
  $('btn-enter').onclick = submit;
  $('btn-share').onclick = copyResult;
  $('card-close').onclick = closeCard;
  $('card-play').onclick = playWord;
  $('hints-left').onchange = fillHints;
  $('btn-reveal').onclick = revealAnswers;
  $('btn-reveal-cancel').onclick = () => $('dlg-answers').close();
  $('back-to-today').onclick = () => openDay(today);

  $('found-toggle').onclick = () => {
    const open = $('found').classList.toggle('open');
    $('found-toggle').setAttribute('aria-expanded', String(open));
    closeCard();
  };

  $('theme-toggle').onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.theme = root.dataset.theme;
    saveStore();
  };

  document.addEventListener('click', (event) => {
    const word = event.target.closest('button[data-word]');
    if (word) {
      // detail is 0 for a click made with the keyboard: move focus to the
      // play button so the next key press can speak the word.
      openCard(word.dataset.word, word, event.detail === 0);
      return;
    }
    const opener = event.target.closest('[data-open]');
    if (opener) showDialog(opener.dataset.open);
  });

  // Tapping anywhere else puts the card away.
  document.addEventListener('pointerdown', (event) => {
    if (!cardIsOpen()) return;
    if (card.contains(event.target) || event.target.closest('button[data-word]')) return;
    closeCard();
  });

  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close(); // click on the backdrop
    });
    dialog.addEventListener('cancel', (event) => {
      if (cardIsOpen()) {
        event.preventDefault(); // Escape closes the card first
        closeCard();
      }
    });
    dialog.addEventListener('close', () => {
      closeCard();
      document.body.append(card);
      // A dialog opened on page load has no opener to hand focus back to, so
      // focus would stay on its (now hidden) close button and swallow Enter.
      if (dialog.contains(document.activeElement)) document.activeElement.blur();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && cardIsOpen() && !document.querySelector('dialog[open]')) {
      const anchor = cardAnchor;
      closeCard();
      anchor?.focus();
      return;
    }
    if (document.querySelector('dialog[open]') || !puzzle) return;
    const target = event.target;
    if (target.matches?.('input, textarea, select')) return;
    if (/^[a-zA-Z]$/.test(event.key)) {
      event.preventDefault();
      addLetter(event.key);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      deleteLetter();
      return;
    }
    // With a word in progress, Enter always submits it. Otherwise Enter and
    // Space keep their normal meaning on menus and word buttons.
    const inPuzzle = target === document.body || Boolean(target.closest?.('.play'));
    if (event.key === 'Enter' && (inPuzzle || entry)) {
      event.preventDefault();
      submit();
    } else if (event.key === ' ' && inPuzzle) {
      event.preventDefault();
      shuffleLetters();
    }
  });

  window.addEventListener('resize', positionCard);
  document.addEventListener('scroll', positionCard, { capture: true, passive: true });

  // Roll over to the new puzzle at midnight.
  const checkNewDay = () => {
    const now = dateKey();
    if (now === today) return;
    const wasPlayingToday = viewDate === today;
    today = now;
    if (wasPlayingToday && !document.querySelector('dialog[open]')) {
      openDay(today);
      toast('A new puzzle is here');
    } else {
      renderDate();
    }
  };
  document.addEventListener('visibilitychange', () => !document.hidden && checkNewDay());
  setInterval(checkNewDay, 60_000);
}

// ------------------------------------------------------------------ start --

async function load(path, type) {
  const response = await fetch(new URL(`../data/${path}`, import.meta.url));
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response[type]();
}

async function start() {
  try {
    const [words, puzzles, meta] = await Promise.all([
      load('words.txt', 'text'),
      load('puzzles.json', 'json'),
      load('meta.json', 'json').catch(() => null),
    ]);
    dictionary = words.split('\n').filter(Boolean);
    schedule = puzzles;
    if (meta) {
      $('about-data').textContent = `The dictionary holds ${meta.words.toLocaleString()} common American-English words, `
        + 'built from the SCOWL word lists. Definitions come from Princeton WordNet, with Wiktionary as a backup; '
        + 'pictures come from Wikipedia. Septet is an independent project.';
    }
  } catch (error) {
    $('load-error').textContent = 'The puzzle could not be loaded. Check your connection and reload the page.';
    $('load-error').hidden = false;
    console.error(error);
    return;
  }

  bindEvents();
  const requested = new URLSearchParams(location.search).get('date');
  const valid = isDateKey(requested)
    && daysBetween(schedule.epoch, requested) >= 0
    && daysBetween(requested, today) >= 0;
  openDay(valid ? requested : today);
  $('game').removeAttribute('data-loading');

  if (!store.seenHelp) {
    store.seenHelp = true;
    saveStore();
    showDialog('help');
  }
}

start();
