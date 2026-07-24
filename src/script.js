/* ============================================================
   script.js — turn blocks into a spoken script.

   Two jobs:
     normalise()  what the words become when a voice has to say them
     buildScript() how fast, how high, and how long the silences are
   ============================================================ */

/* ── numbers ──────────────────────────────────────────────── */
const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
  'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const SCALE = ['',' thousand',' million',' billion',' trillion'];
const ORD = {one:'first',two:'second',three:'third',four:'fourth',five:'fifth',six:'sixth',
  seven:'seventh',eight:'eighth',nine:'ninth',ten:'tenth',eleven:'eleventh',twelve:'twelfth',
  thirteen:'thirteenth',fourteen:'fourteenth',fifteen:'fifteenth',sixteen:'sixteenth',
  seventeen:'seventeenth',eighteen:'eighteenth',nineteen:'nineteenth',twenty:'twentieth',
  thirty:'thirtieth',forty:'fortieth',fifty:'fiftieth',sixty:'sixtieth',seventy:'seventieth',
  eighty:'eightieth',ninety:'ninetieth'};
const MONTHS = ['january','february','march','april','may','june','july','august',
  'september','october','november','december'];

function under100(n){
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n/10)], r = n % 10;
  return r ? `${t}-${ONES[r]}` : t;
}
function under1000(n){
  const h = Math.floor(n/100), r = n % 100;
  if (!h) return under100(n);
  return ONES[h] + ' hundred' + (r ? ' and ' + under100(r) : '');
}
export function intWords(n){
  n = Math.trunc(Math.abs(n));
  if (n === 0) return 'zero';
  const chunks = [];
  let x = n, i = 0;
  while (x > 0 && i < SCALE.length){
    const c = x % 1000;
    if (c) chunks.unshift({ v:c, i });
    x = Math.floor(x / 1000); i++;
  }
  const parts = chunks.map(c => under1000(c.v) + SCALE[c.i]);
  if (chunks.length > 1 && chunks[chunks.length-1].v < 100)
    return parts.slice(0,-1).join(' ') + ' and ' + parts[parts.length-1];
  return parts.join(' ');
}
function ordinalWords(n){
  const w = intWords(n);
  const bits = w.split(/([- ])/);
  const last = bits[bits.length-1];
  bits[bits.length-1] = ORD[last] || (last.endsWith('y') ? last.slice(0,-1)+'ieth' : last + 'th');
  return bits.join('');
}
function decimalWords(str){
  const neg = /^-/.test(str);
  const [i, d] = str.replace(/^[-+]/,'').replace(/,/g,'').split('.');
  let out = intWords(+i);
  if (d) out += ' point ' + d.split('').map(x => ONES[+x]).join(' ');
  return (neg ? 'minus ' : '') + out;
}
function yearWords(y){
  const n = +y;
  if (n < 1000 || n > 2999) return intWords(n);
  const hi = Math.floor(n/100), lo = n % 100;
  if (lo === 0) return intWords(hi) + ' hundred';
  if (n >= 2000 && n < 2010) return 'two thousand and ' + under100(lo);
  return under100(hi) + ' ' + (lo < 10 ? 'oh ' + ONES[lo] : under100(lo));
}
function sayDigits(s){ return s.split('').map(c => /\d/.test(c) ? ONES[+c] : '').filter(Boolean).join(' '); }

/* ── currency ─────────────────────────────────────────────── */
const CURRENCIES = [
  [/\bJ\$\s?/i, 'Jamaican dollars', 'Jamaican dollar'],
  [/\bUS\$\s?/i, 'US dollars', 'US dollar'],
  [/\bCA\$\s?/i, 'Canadian dollars', 'Canadian dollar'],
  [/£\s?/,       'pounds', 'pound'],
  [/€\s?/,       'euros', 'euro'],
  [/\$\s?/,      'dollars', 'dollar'],
];
const MAG = { k:'thousand', m:'million', bn:'billion', b:'billion' };

function moneyPhrase(sym, num, mag, plural, singular){
  let head;
  if (mag) head = decimalWords(num) + ' ' + MAG[mag.toLowerCase()];
  else {
    const [whole, cents] = num.replace(/,/g,'').split('.');
    head = intWords(+whole);
    if (cents && +cents > 0){
      const c = cents.length === 1 ? +cents * 10 : +cents;
      return `${head} ${+whole === 1 ? singular : plural} and ${intWords(c)} cents`;
    }
    return `${head} ${+whole === 1 ? singular : plural}`;
  }
  return `${head} ${plural}`;
}

/* ── the default lexicon ──────────────────────────────────── */
export const DEFAULT_LEXICON = {
  // general business / documents
  'CEO':'C E O','CFO':'C F O','COO':'C O O','HR':'H R','ID':'I D','FAQ':'F A Q',
  'PDF':'P D F','API':'A P I','URL':'U R L','VAT':'V A T','ROI':'R O I','KPI':'K P I',
  'B2B':'B to B','Q1':'quarter one','Q2':'quarter two','Q3':'quarter three','Q4':'quarter four',
  'e.g.':'for example','i.e.':'that is','etc.':'et cetera','vs.':'versus','approx.':'approximately',
  'No.':'number','&':'and','%':'percent','#':'number',
  // Jamaican statutory vocabulary — harmless elsewhere, essential here
  'NIS':'N I S','NHT':'N H T','GCT':'G C T','TRN':'T R N','TCC':'T C C','PAYE':'pay as you earn',
  'HEART':'HEART','NSTA':'N S T A','MLSS':'M L S S','LRIDA':'L R I D A','IDT':'I D T',
  'JCF':'J C F','TAJ':'T A J','SSA1':'S S A one','JPS':'J P S','NWC':'N W C','BN1':'B N one',
  'BRF1':'B R F one','P24':'P twenty-four','S02':'S oh two','P2A':'P two A',
};

const NOT_ACRONYMS = new Set(['THE','AND','FOR','YOU','ALL','NOT','BUT','ONE','TWO','SIX','TEN',
  'NEW','OUT','OWN','WHO','WHY','HOW','ITS','ARE','WAS','CAN','MAY','PER','VAT','TOTAL','PART',
  'NOTE','FIGURE','TABLE','CHAPTER','APPENDIX','CONTENTS','WEEKS','WEEK','ZONE','TIER','RISK',
  'STAGE','ITEM','COST','LEAN','KEY','TRUE','HOUR','PAID','WAGES','FIRST','WHAT','WHEN','WHERE']);

export function collectAcronyms(blocks){
  const found = new Map();
  const scan = t => {
    for (const m of (t || '').matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)){
      const tok = m[0];
      if (NOT_ACRONYMS.has(tok)) continue;
      if (/^\d/.test(tok)) continue;
      found.set(tok, (found.get(tok) || 0) + 1);
    }
  };
  blocks.forEach(b => {
    scan(b.text);
    (b.items || []).forEach(i => scan(i.text));
    (b.rows || []).forEach(r => r.forEach(scan));
    (b.header || []).forEach(scan);
  });
  const out = {};
  [...found.entries()].sort((a,b) => b[1]-a[1]).forEach(([tok]) => {
    out[tok] = DEFAULT_LEXICON[tok] || tok.split('').join(' ');
  });
  return out;
}

/* ── normalise ────────────────────────────────────────────── */
export function normalise(input, lexicon = {}){
  let t = ' ' + (input || '') + ' ';

  // symbols and typography
  t = t.replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')
       .replace(/\u2192|->/g,' to ').replace(/\u2190/g,' from ')
       .replace(/[\u00B7\u2022\u25AA\u25CF]/g,', ')
       .replace(/\u2014|\u2013\s/g, m => m.includes('\u2014') ? ', ' : ' to ')
       .replace(/\u2026|\.\.\./g,', ')
       .replace(/\u2248/g,' approximately ').replace(/\u2265/g,' at least ').replace(/\u2264/g,' at most ')
       .replace(/[\u2713\u2714]/g,'').replace(/[\u2715\u2717\u2718]/g,'').replace(/[\u2605\u2606]/g,'')
       .replace(/\u00D7/g,' times ').replace(/\u00A0/g,' ')
       .replace(/"/g,'');

  // contacts
  t = t.replace(/\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)/g,
        (_,u,d) => `${u.replace(/\./g,' dot ')} at ${d.replace(/\./g,' dot ')}`);
  t = t.replace(/\b(?:https?:\/\/)?www\.([\w-]+(?:\.[\w-]+)+)\S*/gi,
        (_,d) => `the website ${d.replace(/\./g,' dot ')}`);
  t = t.replace(/\(?(\d{3})\)?[\s.-](\d{3})[\s.-](\d{4})\b/g,
        (_,a,b,c) => `${sayDigits(a)}, ${sayDigits(b)}, ${sayDigits(c)}`);
  t = t.replace(/\b1-(\d{3})-([A-Z-]{4,})\b/g, (_,a,w) => `one ${sayDigits(a)} ${w.replace(/-/g,' ')}`);

  // money — with magnitude suffix, then plain
  for (const [sym, plural, singular] of CURRENCIES){
    const re = new RegExp(sym.source + '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(bn|[kmb])\\b', 'gi');
    t = t.replace(re, (_, num, mag) => ' ' + moneyPhrase(sym, num, mag, plural, singular) + ' ');
  }
  for (const [sym, plural, singular] of CURRENCIES){
    const re = new RegExp(sym.source + '(\\d[\\d,]*(?:\\.\\d+)?)', 'gi');
    t = t.replace(re, (_, num) => ' ' + moneyPhrase(sym, num, null, plural, singular) + ' ');
  }

  // percentages and simple maths
  t = t.replace(/(^|[\s(\[])([+\u2212-])?\s?(\d[\d,]*(?:\.\d+)?)\s?%/g,
        (_,pre,sign,n) => `${pre}${sign === '+' ? 'plus ' : (sign ? 'minus ' : '')}${decimalWords(n)} percent`);
  t = t.replace(/(\d)\s?[\u00D7x]\s?(?=\d)/g,'$1 by ');

  // dates
  const monthRe = MONTHS.join('|');
  t = t.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthRe})\\s+(\\d{4})\\b`,'gi'),
        (_,d,m,y) => `the ${ordinalWords(+d)} of ${cap(m)} ${yearWords(y)}`);
  t = t.replace(new RegExp(`\\b(${monthRe})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,'gi'),
        (_,m,d,y) => `${cap(m)} the ${ordinalWords(+d)}, ${yearWords(y)}`);
  t = t.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthRe})\\b`,'gi'),
        (_,d,m) => `the ${ordinalWords(+d)} of ${cap(m)}`);
  t = t.replace(new RegExp(`\\b(${monthRe})\\s+(\\d{1,2})(?:st|nd|rd|th)\\b`,'gi'),
        (_,m,d) => `${cap(m)} the ${ordinalWords(+d)}`);

  // references
  t = t.replace(/\bCh(?:\.|apters?)?\s?(\d+)(?:\s?[-\u2013]\s?(\d+))?/gi,
        (_,a,b) => b ? `chapters ${intWords(+a)} to ${intWords(+b)}` : `chapter ${intWords(+a)}`);
  t = t.replace(/\b(section|clause|part|item|step|stage|layer|tier|zone|appendix|figure|table|paragraph)\s+(\d+)\.(\d+)/gi,
        (_,w,a,b) => `${w.toLowerCase()} ${intWords(+a)} point ${intWords(+b)}`);
  t = t.replace(/\b(section|clause|part|item|step|stage|layer|tier|zone|week|weeks|month|months|day|days)\s+(\d+)\b/gi,
        (_,w,n) => `${w.toLowerCase()} ${intWords(+n)}`);
  t = t.replace(/^\s*(\d+)\.(\d+)\s+/, (_,a,b) => `section ${intWords(+a)} point ${intWords(+b)}. `);

  // fiscal spans and ranges
  t = t.replace(/\b(\d{4})\s?\/\s?(\d{2})\b/g, (_,a,b) => `${yearWords(a)} to ${yearWords(a.slice(0,2)+b)}`);
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s?[\u2013\u2014-]\s?(\d[\d,]*(?:\.\d+)?)/g,
        (_,a,b) => `${decimalWords(a)} to ${decimalWords(b)}`);

  // ordinals, years, then everything left
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_,n) => ordinalWords(+n));
  t = t.replace(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/g, (_,y) => yearWords(y));

  // lexicon (longest first so 'NSTA Trust' style entries win)
  const keys = Object.keys(lexicon).sort((a,b) => b.length - a.length);
  for (const k of keys){
    const spoken = lexicon[k];
    if (!spoken || spoken === k) continue;
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const bounded = /^[\w]/.test(k) ? `\\b${esc}` : esc;
    const tail = /[\w]$/.test(k) ? `\\b` : '';
    t = t.replace(new RegExp(bounded + tail, 'g'), spoken);
  }

  // any remaining figures
  t = t.replace(/\b\d[\d,]*(?:\.\d+)?\b/g, m => decimalWords(m));

  // slashes read as pauses, not as the word "slash"
  t = t.replace(/\s*\/\s*/g, ', ');

  return t.replace(/\s*,\s*,\s*/g,', ').replace(/\s+([,.;:!?])/g,'$1')
          .replace(/([,;:])\s*([.!?])/g,'$2').replace(/\s+/g,' ').trim();
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const tidyEnd = t => t.replace(/\s*\.{2,}$/,'.').replace(/([.!?:])\s*\.$/,'$1').replace(/\s+([,.])/g,'$1');

/* ── sentence splitting ───────────────────────────────────── */
const ABBR = new Set(['mr','mrs','ms','dr','prof','rev','hon','st','ch','no','fig','vs','approx',
  'etc','inc','ltd','co','jan','feb','mar','apr','jun','jul','aug','sept','sep','oct','nov','dec',
  'e.g','i.e','al','pp','ed','est','dept','govt','ave','rd','sq','mt','p.m','a.m','u.s','u.k']);

export function splitSentences(text){
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;
    let j = i + 1;
    while (j < text.length && /["')\]]/.test(text[j])) j++;
    if (j >= text.length){ out.push(text.slice(start)); start = text.length; break; }
    if (!/\s/.test(text[j])) continue;
    const nxt = text.slice(j).match(/\S/);
    if (!nxt || !/[A-Z0-9"(\u2018\u201C]/.test(nxt[0])) continue;
    const before = text.slice(Math.max(0, i-14), i).split(/[\s(]/).pop().toLowerCase();
    if (c === '.' && (ABBR.has(before) || /^[a-z]$/.test(before))) continue;
    out.push(text.slice(start, j).trim());
    start = j;
  }
  if (start < text.length){
    const tail = text.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out.filter(Boolean).flatMap(s => s.length > 240 ? breakLong(s) : [s]);
}
function breakLong(s){
  const parts = [], soft = /[,;:]\s/g;
  let last = 0, m, cut = 0;
  while ((m = soft.exec(s))){
    if (m.index - last > 150){ parts.push(s.slice(last, m.index + 1).trim()); last = m.index + 2; }
    cut = m.index;
  }
  parts.push(s.slice(last).trim());
  return parts.filter(Boolean);
}

/* ── bold mask, so emphasis survives sentence splitting ───── */
function runsToMasked(runs, fallback){
  if (!runs || !runs.length) return { text: fallback || '', mask: [] };
  let text = '', mask = [];
  for (const r of runs){
    for (const ch of r.text.replace(/\s+/g,' ')){
      if (ch === ' ' && text.endsWith(' ')) continue;
      text += ch; mask.push(!!r.bold);
    }
  }
  const lead = text.length - text.trimStart().length;
  return { text: text.trim(), mask: mask.slice(lead, lead + text.trim().length) };
}

/* ── the director ─────────────────────────────────────────── */
const BASE = {
  h1:      { rate:.86, pitch:.94, before:700, after:1000 },
  h2:      { rate:.88, pitch:.95, before:600, after:850 },
  h3:      { rate:.94, pitch:.98, before:420, after:520 },
  label:   { rate:.92, pitch:1.02, before:300, after:380 },
  p:       { rate:1,   pitch:1,   before:0,   after:270 },
  li:      { rate:1,   pitch:1,   before:300, after:280 },
  quote:   { rate:.9,  pitch:.96, before:520, after:700 },
  caption: { rate:1.06,pitch:1,   before:260, after:360, volume:.82 },
  table:   { rate:.97, pitch:1,   before:0,   after:320 },
};

export function buildScript(doc, opts = {}){
  const o = Object.assign({
    lexicon: DEFAULT_LEXICON, emphasis: true, captions: false,
    tables: 'full', sectionNumbers: true, pauseScale: 1,
  }, opts);

  const segments = [], chapters = [];
  let chapterIdx = -1;

  const push = (s) => {
    s.id = segments.length;
    s.chapter = chapterIdx;
    s.pauseBefore = Math.round((s.pauseBefore || 0) * o.pauseScale);
    s.pauseAfter  = Math.round((s.pauseAfter  || 0) * o.pauseScale);
    s.words = s.spoken.split(/\s+/).filter(Boolean).length;
    if (s.spoken) segments.push(s);
    return s;
  };

  doc.blocks.forEach((b, blockIdx) => {
    const kind = b.type === 'h1' || b.type === 'h2' || b.type === 'h3' ? b.type : b.type;
    const base = BASE[kind] || BASE.p;

    /* headings also become navigation */
    if (kind === 'h1' || kind === 'h2' || kind === 'h3'){
      let display = b.text;
      let source  = display;
      if (!o.sectionNumbers) source = source.replace(/^\s*(?:\d+(?:\.\d+)*|[A-Z])[.)]?\s+/, '');
      const spoken = normalise(source, o.lexicon);
      chapterIdx = chapters.length;
      chapters.push({ level:+kind[1], title:display, segment:segments.length, blockIdx });
      push({ blockIdx, role:kind, display, spoken,
             rate:base.rate, pitch:base.pitch, volume:1,
             pauseBefore:base.before, pauseAfter:base.after });
      return;
    }

    if (kind === 'caption' && !o.captions){
      segments.push({ id:segments.length, blockIdx, role:'caption', display:b.text, spoken:'',
        rate:1, pitch:1, volume:1, pauseBefore:0, pauseAfter:0, words:0, chapter:chapterIdx, silent:true });
      return;
    }

    if (kind === 'table'){
      if (o.tables === 'skip') return;
      const head = b.header || [];
      if (o.tables === 'summary'){
        const what = head.filter(Boolean).join(', ');
        push({ blockIdx, role:'table', display:`[table: ${b.rows.length} rows]`,
          spoken: normalise(`A table of ${b.rows.length} rows${what ? ', covering ' + what : ''}.`, o.lexicon),
          rate:base.rate, pitch:base.pitch, volume:1, pauseBefore:400, pauseAfter:500 });
        return;
      }
      b.rows.forEach((row, ri) => {
        const cells = row.map(c => (c || '').trim());
        if (!cells.some(Boolean)) return;
        let phrase;
        if (head.length > 2){
          const lead = cells[0] ? cells[0].replace(/[.:]$/,'') + '. ' : '';
          phrase = lead + head.slice(1).map((h, i) =>
            cells[i+1] ? `${h ? h.replace(/[.:]$/,'') + ', ' : ''}${cells[i+1]}` : ''
          ).filter(Boolean).join('. ') + '.';
        } else if (cells.length === 2){
          phrase = `${cells[0].replace(/[.:]$/,'')}: ${cells[1]}.`;
        } else {
          phrase = cells.filter(Boolean).join(', ') + '.';
        }
        push({ blockIdx, rowIdx:ri, role:'table', display: cells.filter(Boolean).join('  ·  '),
          spoken: normalise(tidyEnd(phrase), o.lexicon),
          rate:base.rate, pitch:base.pitch, volume:1,
          pauseBefore: ri === 0 ? 420 : base.before, pauseAfter: base.after });
      });
      return;
    }

    if (kind === 'li'){
      b.items.forEach((item, ii) => {
        const { text, mask } = runsToMasked(item.runs, item.text);
        const prefix = b.ordered ? `${intWords(ii+1)}. ` : '';
        emit(text, mask, base, blockIdx, 'li', { first:true, prefix, itemIdx:ii });
      });
      return;
    }

    const { text, mask } = runsToMasked(b.runs, b.text);
    emit(text, mask, base, blockIdx, kind === 'p' ? 'p' : kind);
  });

  function emit(text, mask, base, blockIdx, role, extra = {}){
    const sentences = splitSentences(text);
    let cursor = 0;
    sentences.forEach((sent, si) => {
      const at = text.indexOf(sent, cursor);
      const off = at < 0 ? cursor : at;
      cursor = off + sent.length;

      const last = si === sentences.length - 1;
      const words = sent.split(/\s+/).length;
      const question = /\?["')\]]?$/.test(sent);
      const bang = /!["')\]]?$/.test(sent);

      let rate = base.rate, pitch = base.pitch;
      if (question) pitch *= 1.055;
      if (bang){ rate *= 1.03; }
      if (words <= 7 && si > 0 && role === 'p'){ rate *= .95; }

      let pieces = [{ text:sent, bold:false }];
      if (o.emphasis && mask.length){
        let boldChars = 0;
        for (let i = 0; i < sent.length; i++) if (mask[off + i]) boldChars++;
        if (boldChars / Math.max(1, sent.length) >= 0.8){
          pieces = [{ text:sent, bold:true }];
        } else {
          const spans = boldSpans(mask, off, sent.length);
          if (spans.length) pieces = splitBySpans(sent, spans);
        }
      }

      pieces.forEach((piece, pi) => {
        const isFirst = pi === 0, isLast = pi === pieces.length - 1;
        const prefix = isFirst && si === 0 ? (extra.prefix || '') : '';
        const spoken = normalise(prefix + piece.text, o.lexicon);
        if (!spoken) return;
        push({
          blockIdx, itemIdx: extra.itemIdx, role,
          display: piece.text, spoken,
          rate:  rate  * (piece.bold ? .95 : 1),
          pitch: pitch * (piece.bold ? 1.04 : 1),
          volume: base.volume || 1,
          pauseBefore: isFirst && si === 0 ? base.before : (isFirst ? 0 : 40),
          pauseAfter:  isLast && last ? Math.round(base.after * 1.25)
                     : isLast ? base.after : 40,
          emphasis: piece.bold || undefined,
        });
      });
    });
  }

  return { segments, chapters };
}

function boldSpans(mask, off, len){
  if (!mask.length) return [];
  const spans = [];
  let s = -1;
  for (let i = 0; i <= len; i++){
    const b = i < len ? !!mask[off + i] : false;
    if (b && s < 0) s = i;
    if (!b && s >= 0){ spans.push([s, i]); s = -1; }
  }
  return spans.filter(([a,b]) => b - a >= 12);   // ~3 words or more
}
function splitBySpans(sent, spans){
  const out = [];
  let at = 0;
  for (const [a, b] of spans){
    if (a > sent.length) break;
    const head = sent.slice(at, a);
    if (head.trim()) out.push({ text: head, bold:false });
    const mid = sent.slice(a, Math.min(b, sent.length));
    if (mid.trim()) out.push({ text: mid, bold:true });
    at = Math.min(b, sent.length);
  }
  const tail = sent.slice(at);
  if (tail.trim()) out.push({ text: tail, bold:false });
  return out.length ? out : [{ text:sent, bold:false }];
}

/* ── timing ───────────────────────────────────────────────── */
export function estimateSeconds(segments, rate = 1, from = 0, to = Infinity){
  let s = 0;
  for (let i = from; i < Math.min(to, segments.length); i++){
    const g = segments[i];
    if (g.silent) continue;
    s += g.words / (2.65 * rate * (g.rate || 1));
    s += (g.pauseBefore + g.pauseAfter) / 1000;
  }
  return s;
}
export function clock(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
           : `${m}:${String(s).padStart(2,'0')}`;
}
