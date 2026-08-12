// Standalone registry validator. Run: npm run validate:logos
// Exits non-zero on any problem so it can gate a deploy (spec §21, §30).
import { loadRegistry, fragmentSvg, fullSvg } from '../src/server/logos.js';

try {
  const registry = loadRegistry();
  const logos = [...registry.values()];
  // Smoke-test that every logo renders a fragment + full without throwing.
  for (const l of logos) {
    const frag = fragmentSvg(l);
    const full = fullSvg(l);
    if (!frag.includes('<svg') || !full.includes('<svg')) {
      throw new Error(`Logo ${l.id} failed to render SVG.`);
    }
  }
  const counts = logos.reduce((acc, l) => {
    acc[l.difficulty] = (acc[l.difficulty] || 0) + 1;
    return acc;
  }, {});
  const max = logos.reduce((s, l) => s + l.points, 0);
  console.log(`OK — ${logos.length} logos validated.`);
  console.log(`   easy=${counts.easy} medium=${counts.medium} hard=${counts.hard}  maxScore=${max}`);
  process.exit(0);
} catch (err) {
  console.error('LOGO VALIDATION FAILED:\n' + err.message);
  process.exit(1);
}
