// Pull the monster table (element weakness stars, type, habitat) from mh-wilds.kerlos.in.th — by keRLos.
//   npm run fetch-monster-data   → src/data/monsters.json
// The site has no API: the table is a constant array inside one of its Next.js JS chunks.
// Text data only; never download the site's images.
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://mh-wilds.kerlos.in.th';
const PAGE = SITE + '/monster';
const OUT = path.resolve('src/data/monsters.json');
const UA = { 'User-Agent': 'MHWildsNext hunt-dashboard data fetch (personal use)' };

async function get(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

const html = await get(PAGE);
const scripts = [...new Set([...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]))];

let rows = [];
for (const src of scripts) { // one request per chunk, sequential
  const js = await get(SITE + src);
  if (!js.includes('monsterType:')) continue;
  rows = [...js.matchAll(/\{monster:"[^{}]*?\}/g)].map((m) => m[0]);
  if (rows.length) break;
}
if (rows.length === 0) {
  console.error('monster table not found — the site changed. Existing file left untouched.');
  process.exit(1);
}

// {monster:"X",fire:"1",...} → JSON (keys are bare identifiers, values plain strings)
const parse = (obj) => JSON.parse(obj.replace(/([{,])(\w+):/g, '$1"$2":'));
const num = (v) => Math.max(0, Math.min(3, Number(v) || 0));
const monsters = rows.map(parse).map((r) => ({
  name: r.monster,
  type: r.monsterType || null,
  habitat: (r.habitat || '').split(',').map((s) => s.trim()).filter(Boolean),
  chapter: r.chapterType || null,
  weakness: { fire: num(r.fire), water: num(r.water), thunder: num(r.thunder), ice: num(r.ice), dragon: num(r.dragon) },
}));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: PAGE, credit: 'keRLos', fetchedAt: new Date().toISOString(), monsters }, null, 1) + '\n');
console.log(`${monsters.length} monsters → ${OUT}`);
