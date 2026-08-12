// Logo registry + server-side SVG fragmentation.
// Production artwork comes only from public/assets/logos/*.svg.
// IMPORTANT: the registry is bundled as JavaScript. Never read data/logos.json
// at runtime because Vercel serverless functions do not guarantee that source
// data files exist at /var/task.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import logos from './logo-registry.js';
import config from './config.js';

let REGISTRY = null;
const RASTER_CACHE = new Map();

function assetPath(logo) {
  const dir = path.join(config.publicDir, 'assets', 'logos');
  const brand = logo.brand;
  const candidates = [logo.assetFile, `${logo.id}.svg`, `${brand}_black.svg`, `${brand}.svg`, `${brand.replace(/\s+/g, '_')}_black.svg`, `${brand.replace(/\s+/g, '')}_black.svg`, `${brand.toLowerCase()}_black.svg`, `${brand.toLowerCase()}.svg`].filter(Boolean);
  for (const name of [...new Set(candidates)]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Missing SVG asset for ${logo.id} (${logo.brand}) in public/assets/logos/`);
}

function sanitizeSvg(svg) {
  return svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '').replace(/<metadata[\s\S]*?<\/metadata>/gi, '').replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)/gi, '').replace(/\s(?:sodipodi|inkscape):[\w-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function loadAsset(logo) {
  const raw = sanitizeSvg(fs.readFileSync(assetPath(logo), 'utf8').trim());
  const open = raw.match(/<svg\b[^>]*>/i);
  if (!open || !/<\/svg>\s*$/i.test(raw)) throw new Error(`Invalid SVG asset for ${logo.id}`);
  const start = open.index + open[0].length;
  const end = raw.lastIndexOf('</svg>');
  const inner = raw.slice(start, end).trim();
  const vb = open[0].match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (!vb) throw new Error(`SVG asset for ${logo.id} must define viewBox`);
  return { inner: `<svg x="0" y="0" width="800" height="800" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${inner}</svg>` };
}

function validateLogo(logo, idx) {
  const errors = [];
  for (const key of ['id', 'brand', 'difficulty', 'points', 'reveal', 'acceptableAnswers']) if (logo[key] === undefined) errors.push(`logo[${idx}] missing "${key}"`);
  if (!['easy', 'medium', 'hard'].includes(logo.difficulty)) errors.push(`logo[${idx}] invalid difficulty`);
  if (logo.points !== config.game.points[logo.difficulty]) errors.push(`logo[${idx}] points mismatch`);
  if (!Array.isArray(logo.reveal) || !logo.reveal.length) errors.push(`logo[${idx}] needs reveal regions`);
  if (!Array.isArray(logo.acceptableAnswers) || !logo.acceptableAnswers.length) errors.push(`logo[${idx}] needs acceptable answers`);
  return errors;
}

export function loadRegistry() {
  if (REGISTRY) return REGISTRY;
  const errors = [];
  const counts = { easy: 0, medium: 0, hard: 0 };
  const ids = new Set();
  const registryLogos = logos.map((logo) => ({ ...logo }));
  for (const [idx, logo] of registryLogos.entries()) {
    errors.push(...validateLogo(logo, idx));
    if (ids.has(logo.id)) errors.push(`duplicate logo id "${logo.id}"`);
    ids.add(logo.id);
    if (counts[logo.difficulty] !== undefined) counts[logo.difficulty] += 1;
    try { logo.asset = loadAsset(logo); } catch (err) { errors.push(err.message); }
  }
  for (const d of Object.keys(counts)) if (counts[d] !== config.game.distribution[d]) errors.push(`expected ${config.game.distribution[d]} ${d} logos, found ${counts[d]}`);
  if (registryLogos.length !== config.game.totalQuestions) errors.push(`expected ${config.game.totalQuestions} logos, found ${registryLogos.length}`);
  if (registryLogos.reduce((s, l) => s + l.points, 0) !== config.game.totalPossibleScore) errors.push('logo points do not total the configured maximum score');
  if (errors.length) throw new Error('Invalid logo registry:\n  - ' + errors.join('\n  - '));
  REGISTRY = new Map(registryLogos.map((l) => [l.id, l]));
  return REGISTRY;
}

export function getLogo(id) { return loadRegistry().get(id); }
export function allLogos() { return [...loadRegistry().values()]; }

function buildObstructionMask(id, difficulty) {
  const count = difficulty === 'easy' ? 3 : difficulty === 'medium' ? 5 : 7;
  const shapes = [];
  const seed = randomInt(1_000_000);

  for (let i = 0; i < count; i += 1) {
    const x = randomInt(80, 610);
    const y = randomInt(80, 610);
    const w = randomInt(90, difficulty === 'hard' ? 260 : 220);
    const h = randomInt(70, difficulty === 'hard' ? 220 : 190);
    const rx = randomInt(0, 18);
    shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="#000"/>`);
  }

  return `<g id="mask-${id}-${seed}" aria-hidden="true">${shapes.join('')}</g>`;
}

function whiteArtwork(inner) {
  // Force every rendered SVG element to white, including the final revealed
  // artwork. !important prevents source SVG presentation attributes from
  // restoring the original brand colours.
  return `<style>*{fill:#fff !important;stroke:#fff !important;color:#fff !important}</style>${inner}`;
}

export function fragmentSvg(logo) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><g>${whiteArtwork(logo.asset.inner)}</g>${buildObstructionMask(logo.id, logo.difficulty)}</svg>`;
}

export async function fragmentForClient(logo) {
  // Do not cache fragments: the obstruction pattern is intentionally different
  // for every question instance.
  const sharp = (await import('sharp')).default;
  const png = await sharp(Buffer.from(fragmentSvg(logo)), { density: 144 })
    .resize(800, 800, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const uri = `data:image/png;base64,${png.toString('base64')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><image width="800" height="800" href="${uri}"/></svg>`;
}

export function fullSvg(logo) {
  // The revealed artwork must use the same monochrome treatment as the masked
  // artwork. Never expose the original source colours to the client.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">${whiteArtwork(logo.asset.inner)}</svg>`;
}
