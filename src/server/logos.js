// Logo registry loader + validator + fragment generator.
//
// Assets are stored as pure black-on-transparent SVG strings inside
// data/logos.json (desaturation is intrinsic — no colour is ever present).
// Fragmentation is applied SERVER-SIDE: the full artwork is composited behind
// an SVG <mask> built from per-logo reveal regions, so the browser receives a
// genuinely fragmented image and never the answer key.
//
// All artwork is a simplified geometric reconstruction, not a trademark file.
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

let REGISTRY = null;

const VIEWBOX = 800; // canonical 800×800 canvas (spec §24)

// Optional per-logo artwork override. Drop a file at
// public/assets/logos/<id>.svg and it replaces the inline `svg` in logos.json
// WITHOUT any code change. The resolver is forgiving so real brand SVGs drop
// in cleanly:
//   FILENAME — matched against, in order: `<id>.svg` (e.g. nike-001.svg),
//     `<Brand>_black.svg`, `<Brand>.svg`, and lowercase variants. So both
//     `nike-001.svg` and `Nike_black.svg` are picked up automatically.
//   VIEWBOX  — any viewBox is scaled + centered into the 800×800 canvas, so
//     the per-logo `reveal` mask still aligns spatially. (For pixel-perfect
//     fragmentation, author on 800×800 or tune that logo's `reveal` regions.)
//   COLOUR   — real "black" artwork would be invisible on the dark substrate,
//     so imported art is forced to phosphor white (this also enforces the
//     spec's rule that colour must never be a recognition cue).
function candidateFilenames(logo) {
  const b = logo.brand;
  const names = [
    `${logo.id}.svg`,
    `${b}_black.svg`,
    `${b}.svg`,
    `${b.replace(/\s+/g, '_')}_black.svg`,
    `${b.replace(/\s+/g, '')}_black.svg`,
    `${b.toLowerCase()}_black.svg`,
    `${b.toLowerCase()}.svg`,
  ];
  return [...new Set(names)];
}

// Remove <script> blocks, on*= event handlers, and javascript: URLs from an
// SVG string. Conservative and regex-based (sufficient for trusted-ish operator
// assets; the CSP is the primary control).
function sanitizeSvg(svg) {
  return (
    svg
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '')
      // Editor cruft (Inkscape/Illustrator): non-rendering, and its undeclared
      // namespace prefixes (sodipodi:, inkscape:) break the SVG rasterizer's
      // XML parser once the inner markup is re-embedded.
      .replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)/gi, '')
      .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
      .replace(/<(sodipodi|inkscape):[a-z-]+[\s\S]*?(\/>|<\/(sodipodi|inkscape):[a-z-]+>)/gi, '')
      .replace(/\s(sodipodi|inkscape):[\w-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  );
}

function extractViewBox(openTag) {
  const m = openTag.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

function fileOverride(logo) {
  const dir = path.join(config.publicDir, 'assets', 'logos');
  let file = null;
  for (const name of candidateFilenames(logo)) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      file = p;
      break;
    }
  }
  if (!file) return null;

  // Defense-in-depth: strip scripts + inline event handlers from operator-
  // supplied SVG files before injecting them. The CSP already blocks inline
  // script execution, but this removes the vector entirely rather than relying
  // on a single control (fullstack-guardian: never trust an asset source).
  const raw = sanitizeSvg(fs.readFileSync(file, 'utf8').trim());
  const open = raw.match(/<svg\b[^>]*>/i);
  let inner = raw;
  let viewBox = null;
  if (open) {
    const start = raw.indexOf(open[0]) + open[0].length;
    const end = raw.lastIndexOf('</svg>');
    inner = end > start ? raw.slice(start, end).trim() : raw;
    viewBox = extractViewBox(open[0]);
  }

  // Scale foreign coordinate systems into the 800×800 canvas.
  if (viewBox && viewBox.replace(/\s+/g, ' ') !== '0 0 800 800') {
    inner =
      `<svg x="0" y="0" width="${VIEWBOX}" height="${VIEWBOX}" viewBox="${viewBox}" ` +
      `preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  }

  // Force imported art to phosphor white regardless of its source fills, using
  // an SVG <filter> feColorMatrix (sets RGB to white, keeps input alpha). Unlike
  // a CSS `filter`, this renders identically in the browser AND in the
  // server-side rasterizer, so fragments raster correctly. Transparent areas
  // stay transparent, preserving negative space.
  const fid = `whiten-${logo.id}`;
  return (
    `<defs><filter id="${fid}" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/>` +
    `</filter></defs><g filter="url(#${fid})">${inner}</g>`
  );
}

function validateLogo(logo, idx) {
  const errs = [];
  const req = ['id', 'brand', 'difficulty', 'points', 'svg', 'reveal', 'acceptableAnswers'];
  for (const k of req) {
    if (logo[k] === undefined) errs.push(`logo[${idx}] missing "${k}"`);
  }
  if (!['easy', 'medium', 'hard'].includes(logo.difficulty)) {
    errs.push(`logo[${idx}] (${logo.id}) invalid difficulty "${logo.difficulty}"`);
  }
  const expectedPoints = config.game.points[logo.difficulty];
  if (logo.points !== expectedPoints) {
    errs.push(
      `logo[${idx}] (${logo.id}) points ${logo.points} != ${expectedPoints} for ${logo.difficulty}`,
    );
  }
  if (!Array.isArray(logo.acceptableAnswers) || logo.acceptableAnswers.length === 0) {
    errs.push(`logo[${idx}] (${logo.id}) needs at least one acceptableAnswer`);
  }
  if (!Array.isArray(logo.reveal) || logo.reveal.length === 0) {
    errs.push(`logo[${idx}] (${logo.id}) needs at least one reveal region`);
  }
  return errs;
}

// Validate the whole registry against the authoritative distribution.
export function loadRegistry() {
  if (REGISTRY) return REGISTRY;
  const file = config.logosFile;
  const raw = fs.readFileSync(file, 'utf8');
  const logos = JSON.parse(raw);
  if (!Array.isArray(logos)) throw new Error('logos.json must be an array');

  const errors = [];
  logos.forEach((l, i) => errors.push(...validateLogo(l, i)));

  const counts = { easy: 0, medium: 0, hard: 0 };
  const ids = new Set();
  for (const l of logos) {
    if (ids.has(l.id)) errors.push(`duplicate logo id "${l.id}"`);
    ids.add(l.id);
    if (counts[l.difficulty] !== undefined) counts[l.difficulty]++;
  }
  const want = config.game.distribution;
  for (const d of ['easy', 'medium', 'hard']) {
    if (counts[d] !== want[d]) {
      errors.push(`expected ${want[d]} ${d} logos, found ${counts[d]}`);
    }
  }
  const total = logos.length;
  if (total !== config.game.totalQuestions) {
    errors.push(`expected ${config.game.totalQuestions} logos, found ${total}`);
  }
  const maxScore = logos.reduce((s, l) => s + l.points, 0);
  if (maxScore !== config.game.totalPossibleScore) {
    errors.push(`max score ${maxScore} != ${config.game.totalPossibleScore}`);
  }

  if (errors.length) {
    throw new Error('Invalid logo registry:\n  - ' + errors.join('\n  - '));
  }

  // Apply any drop-in SVG file overrides after validation.
  for (const l of logos) {
    const override = fileOverride(l);
    if (override) l.svg = override;
  }

  REGISTRY = new Map(logos.map((l) => [l.id, l]));
  return REGISTRY;
}

export function getLogo(id) {
  return loadRegistry().get(id);
}

export function allLogos() {
  return [...loadRegistry().values()];
}

// Wrap raw artwork paths in an 800×800 SVG document.
function svgDocument(inner, extraDefs = '') {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" ` +
    `role="img" aria-label="Fragmented logo">` +
    `<defs>${extraDefs}</defs>` +
    inner +
    `</svg>`
  );
}

// Build the SVG <mask> that reveals only the fragment regions. Each region is
// {x,y,w,h,rx?} (rectangle, optional rounding) or {cx,cy,r} (circle). White =
// visible, black = erased.
function buildMask(regions, id) {
  const shapes = regions
    .map((r) => {
      if (r.r !== undefined) {
        return `<circle cx="${r.cx}" cy="${r.cy}" r="${r.r}" fill="#fff"/>`;
      }
      const rx = r.rx ? ` rx="${r.rx}"` : '';
      return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"${rx} fill="#fff"/>`;
    })
    .join('');
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${VIEWBOX}" height="${VIEWBOX}"><rect width="${VIEWBOX}" height="${VIEWBOX}" fill="#000"/>${shapes}</mask>`;
}

// Fragment SVG for gameplay: artwork masked down to its reveal regions.
// NOTE: this contains the full vector geometry behind a mask — safe only when
// rasterized before it reaches the client (see fragmentForClient).
export function fragmentSvg(logo) {
  const maskId = `frag-${logo.id}`;
  const mask = buildMask(logo.reveal, maskId);
  return svgDocument(`<g mask="url(#${maskId})">${logo.svg}</g>`, mask);
}

// Lazy sharp loader — optional dependency. If unavailable, we fall back to
// sending vector (with a one-time warning) rather than crashing.
let _sharp;
let _warnedNoSharp = false;
async function getSharp() {
  if (_sharp === undefined) {
    try {
      _sharp = (await import('sharp')).default;
    } catch {
      _sharp = null;
    }
  }
  return _sharp;
}

// Cache rendered fragments (they are deterministic) to avoid re-rasterizing the
// same logo on every question served.
const RASTER_CACHE = new Map();

// The client-safe fragment: a rasterized bitmap wrapped in a minimal SVG, so
// NO vector path data (the recoverable visual answer) is ever serialized to the
// browser. Falls back to vector if sharp is missing.
export async function fragmentForClient(logo) {
  if (RASTER_CACHE.has(logo.id)) return RASTER_CACHE.get(logo.id);
  const vector = fragmentSvg(logo);
  const sharp = await getSharp();
  if (!sharp) {
    if (!_warnedNoSharp) {
      _warnedNoSharp = true;
      console.warn(
        '[warn] sharp not installed — fragments are sent as vector, so the ' +
          'masked-out geometry is technically recoverable via DevTools. ' +
          'Run `npm i sharp` to serve rasterized fragments.',
      );
    }
    return vector;
  }
  // Resolve currentColor (built-in art) to phosphor; imported art is whitened
  // by its own feColorMatrix filter and unaffected by this replace.
  const baked = vector.replace(/currentColor/g, '#eaeaea');
  try {
    const png = await sharp(Buffer.from(baked), { density: 96 })
      .resize(VIEWBOX, VIEWBOX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const dataUri = `data:image/png;base64,${png.toString('base64')}`;
    const out =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" ` +
      `role="img" aria-label="Fragmented logo">` +
      `<image x="0" y="0" width="${VIEWBOX}" height="${VIEWBOX}" href="${dataUri}"/></svg>`;
    RASTER_CACHE.set(logo.id, out);
    return out;
  } catch (err) {
    // One logo failed to rasterize (e.g. malformed source SVG). Degrade to
    // vector for THIS logo rather than failing the whole request.
    console.warn(`[warn] fragment raster failed for ${logo.id}: ${err.message} — sending vector.`);
    RASTER_CACHE.set(logo.id, vector);
    return vector;
  }
}

// Full SVG for the reveal + results: complete artwork, still pure black.
export function fullSvg(logo) {
  return svgDocument(logo.svg);
}
