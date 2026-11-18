// Rank-up celebrations. Each rank keeps the effects of the ranks below it and
// adds one more, so the show builds from a single floating note at Warm-Up to
// the full finale at Maestro. Nothing here runs at import time, so the plan
// can be tested in Node; the effects themselves need a DOM.

// One effect joins the show at each rank (index into RANKS). Rank 0 is where
// everyone starts, so it has none.
export const EFFECTS = [
  { name: 'pop', from: 1 },        // the rank name bounces
  { name: 'glow', from: 2 },       // the meter segment just filled lights up
  { name: 'beat', from: 3 },       // the letters pulse in rhythm
  { name: 'ripple', from: 4 },     // sound waves ring out from the centre letter
  { name: 'arpeggio', from: 5 },   // the letters light up one by one, like a rising chord
  { name: 'spotlight', from: 6 },  // a spotlight sweeps onto the board
  { name: 'marquee', from: 7 },    // the rank goes up in lights
  { name: 'equalizer', from: 8 },  // equalizer bars jump along the bottom of the screen
  { name: 'finale', from: 9 },     // baton flourish, fireworks of notes, a shower of notes
];

/** What a rank-up to `index` shows: its effects and how many notes float up. */
export function celebrationPlan(index) {
  return {
    effects: EFFECTS.filter((effect) => effect.from <= index).map((effect) => effect.name),
    notes: index > 0 ? 2 + index * 2 : 0,
    big: index >= EFFECTS.at(-1).from,
  };
}

// ------------------------------------------------------------- the show --

const GLYPHS = ['♪', '♫', '♩', '♬']; // ♪ ♫ ♩ ♬
const COLORS = ['accent', 'gold', 'coral', 'teal'];
const TEXT = '︎'; // ask for the text form, not an emoji

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A colour token from the stylesheet (--accent, --fx-gold, ...), resolved for animate(). */
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let layer = null;
function fxLayer() {
  if (!layer?.isConnected) {
    layer = Object.assign(document.createElement('div'), { className: 'fx-layer' });
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
}

/** Add an element to the effects layer and remove it when its animation ends. */
function spawn(className, props = {}) {
  const node = Object.assign(document.createElement('div'), { className, ...props });
  fxLayer().append(node);
  return node;
}

function play(node, keyframes, options) {
  const animation = node.animate(keyframes, { fill: 'both', ...options });
  animation.finished.then(() => node.remove(), () => node.remove());
  return animation;
}

function centreOf(element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, box };
}

/** A music note that floats up from (x, y), drifting side to side. */
function floatNote(x, y, { rise = rand(90, 170), delay = 0, size = rand(1.1, 1.8), color } = {}) {
  const note = spawn(`fx-note fx-${color ?? pick(COLORS)}`, { textContent: pick(GLYPHS) + TEXT });
  note.style.left = `${x}px`;
  note.style.top = `${y}px`;
  note.style.fontSize = `${size}rem`;
  const sway = rand(14, 34) * (Math.random() < 0.5 ? -1 : 1);
  const tilt = rand(-25, 25);
  play(note, [
    { opacity: 0, transform: 'translate(-50%, -50%) scale(0.4)' },
    { opacity: 1, transform: `translate(calc(-50% + ${sway * 0.6}px), calc(-50% - ${rise * 0.3}px)) scale(1) rotate(${tilt}deg)`, offset: 0.25 },
    { opacity: 1, transform: `translate(calc(-50% - ${sway * 0.4}px), calc(-50% - ${rise * 0.65}px)) scale(1) rotate(${-tilt}deg)`, offset: 0.6 },
    { opacity: 0, transform: `translate(calc(-50% + ${sway}px), calc(-50% - ${rise}px)) scale(0.8) rotate(${tilt}deg)` },
  ], { duration: rand(1300, 2000), delay, easing: 'ease-out' });
}

/** Notes rising from the end of the meter segment that just filled. */
function notesFrom(meter, index, count) {
  const segment = meter.children[index - 1] ?? meter;
  const box = segment.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    floatNote(box.right - rand(0, 1.5) * box.width, box.top, { delay: i * 70, rise: rand(50, 95) + index * 4 });
  }
}

function pop(rankName, index) {
  const lift = 1 + 0.03 * index;
  rankName.animate([
    { transform: 'scale(1)' },
    { transform: `scale(${lift + 0.1}) rotate(-2deg)`, color: token('accent'), offset: 0.3 },
    { transform: `scale(${lift - 0.05}) rotate(1deg)`, offset: 0.6 },
    { transform: 'scale(1)' },
  ], { duration: 650 + index * 40, easing: 'ease-out' });
}

function glow(meter, index) {
  const segment = meter.children[index - 1];
  segment?.animate([
    { boxShadow: '0 0 0 0 transparent' },
    { boxShadow: `0 0 12px 3px ${token('fx-glow')}`, offset: 0.35 },
    { boxShadow: '0 0 0 0 transparent' },
  ], { duration: 1100, easing: 'ease-out' });
}

/** Tiles in the order they go around the hive, centre first. */
const tilesOf = (board) => [...board.querySelectorAll('.tile')];

function beat(board) {
  // A bar of 4/4: centre on the downbeat, then the outer tiles in pairs.
  const [centre, ...outer] = tilesOf(board);
  const hits = [[centre], [outer[0], outer[3]], [outer[1], outer[4]], [outer[2], outer[5]], [centre]];
  hits.forEach((tiles, i) => tiles.forEach((tile) => tile?.animate(
    [{ scale: '1' }, { scale: i === 0 || i === 4 ? '1.16' : '1.1', offset: 0.3 }, { scale: '1' }],
    { duration: 260, delay: i * 190, easing: 'ease-out' },
  )));
}

function ripple(board) {
  const [centre] = tilesOf(board);
  if (!centre) return;
  const { x, y, box } = centreOf(centre);
  for (let i = 0; i < 3; i++) {
    const ring = spawn('fx-ring');
    Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, width: `${box.width}px`, height: `${box.height}px` });
    play(ring, [
      { opacity: 0.85, transform: 'translate(-50%, -50%) scale(0.9)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(3.6)' },
    ], { duration: 1200, delay: 150 + i * 220, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)' });
  }
}

function arpeggio(board) {
  const [centre, ...outer] = tilesOf(board);
  [...outer, centre].forEach((tile, i) => {
    if (!tile) return;
    const color = token(`fx-${COLORS[i % COLORS.length]}`);
    tile.animate([
      { offset: 0.35, backgroundColor: color, color: '#fff', boxShadow: `0 0 22px 4px ${color}` },
    ], { duration: 700, delay: 700 + i * 95, easing: 'ease-in-out' });
    setTimeout(() => {
      const { x, y } = centreOf(tile);
      floatNote(x, y - 10, { color: COLORS[i % COLORS.length], rise: rand(70, 120) });
    }, 700 + i * 95);
  });
}

function spotlight(board) {
  const { x, y, box } = centreOf(board);
  const light = spawn('fx-spotlight');
  light.style.setProperty('--r', `${Math.round(box.width * 0.62)}px`);
  Object.assign(light.style, { left: `${x}px`, top: `${y}px` });
  play(light, [
    { opacity: 0, transform: 'translate(-50%, -50%) translate(-35vw, -25vh)' },
    { opacity: 1, transform: 'translate(-50%, -50%) translate(0, 0)', offset: 0.35 },
    { opacity: 1, transform: 'translate(-50%, -50%) translate(0, 0)', offset: 0.75 },
    { opacity: 0, transform: 'translate(-50%, -50%) translate(0, 0)' },
  ], { duration: 2400, easing: 'ease-in-out' });
}

function marquee(name, delay = 300) {
  const sign = spawn('fx-marquee');
  sign.append(Object.assign(document.createElement('span'), { textContent: name }));
  play(sign, [
    { opacity: 0, transform: 'translate(-50%, -50%) scale(0.6) rotate(-4deg)' },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1.06) rotate(1deg)', offset: 0.14 },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.22 },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.82 },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' },
  ], { duration: 2300, delay, easing: 'ease-out' });
}

function equalizer() {
  const eq = spawn('fx-eq');
  const bars = Math.min(32, Math.max(14, Math.round(window.innerWidth / 36)));
  for (let i = 0; i < bars; i++) {
    const bar = document.createElement('i');
    bar.className = `fx-${COLORS[i % COLORS.length]}`;
    eq.append(bar);
    const heights = Array.from({ length: 7 }, () => `scaleY(${rand(0.15, 1).toFixed(2)})`);
    bar.animate(
      [{ transform: 'scaleY(0)' }, ...heights.map((transform) => ({ transform })), { transform: 'scaleY(0)' }],
      { duration: 2200, delay: i * 18, easing: 'ease-in-out', fill: 'both' },
    );
  }
  play(eq, [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 2500 });
}

/** A conductor's flourish drawn in gold across the screen. */
function baton() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'fx-baton');
  // Drawn in screen pixels so the stroke keeps its width and the dash that
  // draws it stays one piece. Points are shares of the width and height.
  const w = window.innerWidth;
  const h = window.innerHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const at = (x, y) => `${Math.round(x * w)} ${Math.round(y * h)}`;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', `M${at(0.06, 0.72)} C ${at(0.22, 0.2)}, ${at(0.4, 0.14)}, ${at(0.5, 0.44)} `
    + `S ${at(0.7, 0.86)}, ${at(0.82, 0.42)} S ${at(0.92, 0.14)}, ${at(0.96, 0.22)}`);
  path.setAttribute('pathLength', '100');
  svg.append(path);
  fxLayer().append(svg);
  path.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 750, easing: 'cubic-bezier(0.6, 0, 0.3, 1)', fill: 'both' });
  play(svg, [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 1500 });
}

/** A burst of notes from (x, y) that falls away like a firework. */
function firework(x, y, count = 20) {
  const flash = spawn('fx-flash');
  Object.assign(flash.style, { left: `${x}px`, top: `${y}px` });
  play(flash, [
    { opacity: 0.9, transform: 'translate(-50%, -50%) scale(0.2)' },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(2.4)' },
  ], { duration: 600, easing: 'ease-out' });
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand(-0.15, 0.15);
    const reach = rand(100, 190);
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach;
    const note = spawn(`fx-note fx-${i % 3 === 0 ? 'gold' : pick(COLORS)}`, { textContent: pick(GLYPHS) + TEXT });
    Object.assign(note.style, { left: `${x}px`, top: `${y}px`, fontSize: `${rand(1, 1.6)}rem` });
    play(note, [
      { opacity: 1, transform: 'translate(-50%, -50%) scale(0.3)' },
      { opacity: 1, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${rand(-40, 40)}deg)`, offset: 0.45 },
      { opacity: 0, transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 90}px)) scale(0.85)` },
    ], { duration: rand(1300, 1700), easing: 'cubic-bezier(0.15, 0.7, 0.4, 1)' });
  }
}

/** Notes falling across the whole screen. */
function shower(count, duration = 3200) {
  for (let i = 0; i < count; i++) {
    const x = rand(0, window.innerWidth);
    const note = spawn(`fx-note fx-${i % 2 ? 'gold' : pick(COLORS)}`, { textContent: pick(GLYPHS) + TEXT });
    Object.assign(note.style, { left: `${x}px`, top: '-40px', fontSize: `${rand(1, 2.1)}rem` });
    const fall = window.innerHeight + 80;
    const sway = rand(20, 60);
    play(note, [
      { opacity: 0, transform: 'translateX(0) rotate(0deg)' },
      { opacity: 1, transform: `translate(${sway}px, ${fall * 0.3}px) rotate(${rand(-40, 40)}deg)`, offset: 0.25 },
      { opacity: 1, transform: `translate(${-sway}px, ${fall * 0.7}px) rotate(${rand(-40, 40)}deg)`, offset: 0.7 },
      { opacity: 0, transform: `translate(${sway / 2}px, ${fall}px) rotate(${rand(-60, 60)}deg)` },
    ], { duration: rand(duration * 0.7, duration * 1.1), delay: rand(0, duration * 0.5), easing: 'linear' });
  }
}

/** The title card for the top rank. */
function titleCard(name, subtitle) {
  const card = spawn('fx-title');
  const word = Object.assign(document.createElement('span'), { className: 'fx-title-word' });
  [...name].forEach((letter, i) => {
    const span = Object.assign(document.createElement('span'), { textContent: letter });
    word.append(span);
    span.animate([
      { opacity: 0, transform: 'translateY(0.6em) scale(0.6)' },
      { opacity: 1, transform: 'translateY(-0.12em) scale(1.08)', offset: 0.7 },
      { opacity: 1, transform: 'none' },
    ], { duration: 520, delay: 250 + i * 70, easing: 'ease-out', fill: 'both' });
  });
  card.append(word, Object.assign(document.createElement('span'), { className: 'fx-title-sub', textContent: subtitle }));
  play(card, [
    { opacity: 0, transform: 'translate(-50%, -50%) scale(0.9)' },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.08 },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1.03)', offset: 0.85 },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1.1)' },
  ], { duration: 3400, easing: 'ease-out' });
}

async function finale(board, name) {
  const veil = spawn('fx-veil');
  play(veil, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 3800 });
  baton();
  await wait(500);
  titleCard(name, 'Bravo!');
  const { x, y } = centreOf(board);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const spots = [
    [x, y], [w * 0.2, h * 0.28], [w * 0.8, h * 0.24], [w * 0.3, h * 0.7], [w * 0.75, h * 0.66], [w * 0.5, h * 0.18],
  ];
  shower(Math.round(Math.min(70, Math.max(36, w / 18))));
  for (const [fx, fy] of spots) {
    firework(fx + rand(-30, 30), fy + rand(-20, 20));
    await wait(rand(260, 380));
  }
}

/**
 * Celebrate reaching rank `index`. `parts` holds the elements to animate:
 * { rankName, meter, board }. Returns how long the show lasts, in ms.
 */
export function celebrate(index, name, { rankName, meter, board }) {
  const plan = celebrationPlan(index);
  if (!plan.effects.length || typeof document === 'undefined') return 0;
  if (reducedMotion()) {
    // No movement: a colour change on the rank, and the title card for Maestro.
    rankName.animate([{ color: token('accent'), offset: 0.2 }], { duration: 1200 });
    if (plan.big) {
      const card = spawn('fx-title');
      card.append(Object.assign(document.createElement('span'), { className: 'fx-title-static', textContent: name }));
      const still = 'translate(-50%, -50%)';
      play(card, [
        { opacity: 0, transform: still }, { opacity: 1, transform: still, offset: 0.15 },
        { opacity: 1, transform: still, offset: 0.85 }, { opacity: 0, transform: still },
      ], { duration: 2400 });
    }
    return plan.big ? 2400 : 0;
  }
  const on = new Set(plan.effects);
  if (on.has('pop')) pop(rankName, index);
  notesFrom(meter, index, plan.notes);
  if (on.has('glow')) glow(meter, index);
  if (on.has('beat')) beat(board);
  if (on.has('ripple')) ripple(board);
  if (on.has('arpeggio')) arpeggio(board);
  if (on.has('spotlight')) spotlight(board);
  if (on.has('marquee') && !plan.big) marquee(name);
  if (on.has('equalizer')) equalizer();
  if (on.has('finale')) finale(board, name);
  return plan.big ? 3900 : on.has('marquee') ? 2600 : 1600;
}

/**
 * A curtain call for finding every word: the words go up in lights under a
 * gentle shower of notes. Starts after `delay` ms (to follow a rank-up show)
 * and returns when it ends.
 */
export function encore(text, delay = 0) {
  if (typeof document === 'undefined' || reducedMotion()) return delay;
  setTimeout(() => {
    marquee(text, 0);
    shower(30, 2600);
  }, delay);
  return delay + 2400;
}
