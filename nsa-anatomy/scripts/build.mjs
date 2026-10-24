// Builds dist/index.html: validates the question bank, optionally converts an
// Anki "Notes in Plain Text" export into flashcards, and inlines everything
// into the single-page app template.
//
//   node nsa-anatomy/scripts/build.mjs [--anki path/to/deck.txt] [--out file]

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

// Official NSA Type 2 key: which statement-truth patterns map to which letter.
export const TYPE2_KEY = {
  TFFF: 'A', // 1 is the only correct response
  FTFT: 'B', // 2 and 4 are the only correct responses
  TTTF: 'C', // 1, 2 and 3 are the only correct responses
  FFFT: 'D', // 4 is the only correct response
  TTTT: 'E', // all responses are correct
};

const REGION_ORDER = ['sk', 'cns', 'cn', 'sp', 'hn', 'ul', 'll', 'th', 'ab', 'au', 'gp'];

function shortHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}

export function loadQuestions(dir = join(root, 'questions')) {
  const regions = [];
  const questions = [];
  const errors = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!regions.some((r) => r.code === data.code)) regions.push({ code: data.code, name: data.region });
    data.questions.forEach((q, n) => {
      const where = `${file} #${n + 1}`;
      if (q.y !== 1 && q.y !== 2) errors.push(`${where}: type must be 1 or 2`);
      if (!Array.isArray(q.o) || q.o.length !== 4) errors.push(`${where}: needs exactly 4 options`);
      const truth = q.o.map((o) => (o[1] ? 'T' : 'F')).join('');
      q.o.forEach((o, i) => {
        if (typeof o[0] !== 'string' || !o[0].trim()) errors.push(`${where}: option ${i + 1} text missing`);
        if (o[1] !== 0 && o[1] !== 1) errors.push(`${where}: option ${i + 1} truth must be 0 or 1`);
        if (typeof o[2] !== 'string' || !o[2].trim()) errors.push(`${where}: option ${i + 1} explanation missing`);
      });
      const out = {
        id: `${data.code}-${shortHash(q.s + q.o.map((o) => o[0]).join('|'))}`,
        r: data.code,
        t: q.t,
        y: q.y,
        d: q.d || data.difficulty || 1,
        ...(q.src ? { src: q.src } : {}),
        s: q.s,
        o: q.o.map((o) => [o[0], o[1], o[2]]),
      };
      if (q.y === 2) {
        const letter = TYPE2_KEY[truth];
        if (!letter) errors.push(`${where}: Type 2 pattern ${truth} does not match any key letter`);
        out.k = letter;
      }
      questions.push(out);
    });
  }
  const ids = new Set();
  for (const q of questions) {
    if (ids.has(q.id)) errors.push(`duplicate question id ${q.id} (${q.s})`);
    ids.add(q.id);
  }
  regions.sort((a, b) => REGION_ORDER.indexOf(a.code) - REGION_ORDER.indexOf(b.code));
  return { regions, questions, errors };
}

// ---------- Anki deck conversion ----------

function splitTsv(text) {
  // Anki quotes fields containing tabs, newlines or quotes, doubling inner quotes.
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === '\t') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function cleanHtml(html) {
  const out = html
    .replace(/<img[^>]*>/gi, ' <span class="fig">[figure]</span> ')
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (!part.startsWith('<')) return part.replace(/>/g, '&gt;');
      if (/^<span class="(fig|cloze|cloze-a)">$|^<\/span>$/.test(part)) return part;
      const m = part.match(/^<\/?\s*([a-z0-9]+)/i);
      if (!m) return '';
      const tag = m[1].toLowerCase();
      if (['b', 'i', 'u', 'sub', 'sup', 'strong', 'em'].includes(tag)) return part.startsWith('</') ? `</${tag}>` : `<${tag}>`;
      if (['br', 'div', 'p', 'li'].includes(tag)) return part.startsWith('</') ? '' : '<br>';
      return '';
    })
    .join('');
  return out
    .replace(/(\s*<br>\s*){3,}/g, '<br><br>')
    .replace(/^(\s*<br>\s*)+|(\s*<br>\s*)+$/g, '')
    .trim();
}

const CN_WORDS = /\b(oculomotor|trochlear|trigeminal|abducen|facial nerve|vestibulocochlear|glossopharyngeal|vagus|vagal|accessory nerve|hypoglossal|chorda tympani|greater petrosal|olfactory nerve|optic nerve|cochlear|vestibular nerve|nervus intermedius|geniculate)/i;
const TAG_RULES = [
  ['cn', /cranial_nerve|summmary_of_cranial_nerves|vagus_nerge|accessory_nerve|hypoglossal_nerve|glossopharyngeal_nerve/],
  ['cns', /central_nervous_system|brainstem|cerebral_hemispheres|cerebellum|spinal_cord|development_of_the_spinal_cord/],
  ['sk', /skull|sphenoid_bone|temporal|cranial_fossae|cranial_cavity|ethmoid|occipital_bone|parietal_bone|palatine_bone|maxilla|internal_features|osteology_of_the_skull/],
  ['sp', /vertebral_column|osteology_of_the_vertebrae|\[spine\]/],
  ['au', /\bANS\b|sympathetic_nerves/],
  ['ul', /upper_limb|brachial_plexus/],
  ['ll', /lower_limb|lumbosacral_plexus|anterior_compartment_thigh|popliteal|dorsum_of_the_foot|anterior_leg/],
  ['th', /thorax|rib_osteology|cardiac_plexus|thoracic/],
  ['ab', /abdomen|pelvis|urinary/],
  ['hn', /head_and_neck_and_spine|ear\]|orbit|face|scalp|larynx|pharynx|triangles_of_the_neck|carotid_sheath|deep_cervical_fascia|general_topography/],
  ['gp', /regional_anatomy|embryology|anatomy_of_the_child|tissues|muscle|bone|Joints|Ligaments|Tendons|raphe|cartilage|blood_vessels|serous|synovial|subcutaneous|Deep_fascia/i],
];

function regionForCard(tags, front) {
  for (const [code, re] of TAG_RULES) if (re.test(tags)) return code;
  if (CN_WORDS.test(front)) return 'cn';
  return 'hn';
}

export function loadAnki(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const body = lines.filter((l) => !l.startsWith('#')).join('\n');
  const cards = [];
  for (const row of splitTsv(body)) {
    if (row.length < 3) continue;
    const [, rawQ, rawA, tags = ''] = row;
    const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::([^}]*))?\}\}/g;
    let front;
    let back;
    if (/\{\{c\d+::/.test(rawQ)) {
      front = cleanHtml(rawQ.replace(CLOZE, (_, _ans, hint) => `<span class="cloze">[${hint || '…'}]</span>`));
      back = cleanHtml(rawQ.replace(CLOZE, (_, ans) => `<span class="cloze-a">${ans}</span>`));
      const extra = cleanHtml(rawA);
      if (extra) back += `<hr>${extra}`;
    } else {
      front = cleanHtml(rawQ);
      back = cleanHtml(rawA);
    }
    if (!front || !back) continue;
    const plain = front.replace(/<[^>]+>/g, ' ');
    cards.push({
      id: `fc-${shortHash(rawQ)}`,
      r: regionForCard(tags, plain),
      f: front,
      b: back,
    });
  }
  const seen = new Set();
  return cards.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
}

// ---------- build ----------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { regions, questions, errors } = loadQuestions();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  const ankiPath = argValue('--anki');
  const cards = ankiPath ? loadAnki(ankiPath) : [];
  const outPath = resolve(argValue('--out') || join(root, 'dist', 'index.html'));
  const data = { regions, questions, cards, type2Key: TYPE2_KEY, built: new Date().toISOString().slice(0, 10) };
  const template = readFileSync(join(root, 'src', 'app.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = template.replace('/*__DATA__*/null', json);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  const byRegion = Object.fromEntries(regions.map((r) => [r.code, 0]));
  for (const q of questions) byRegion[q.r]++;
  const letters = {};
  for (const q of questions) if (q.k) letters[q.k] = (letters[q.k] || 0) + 1;
  console.log(`${questions.length} questions`, byRegion);
  console.log('Type 2 answer letters', letters);
  if (ankiPath) {
    const cardRegions = {};
    for (const c of cards) cardRegions[c.r] = (cardRegions[c.r] || 0) + 1;
    console.log(`${cards.length} flashcards`, cardRegions);
  }
  console.log(`wrote ${outPath} (${Math.round(html.length / 1024)} KB)`);
}
