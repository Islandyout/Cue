/* ============================================================
   parse.js — turn an uploaded file into structured blocks.

   A block is the smallest unit that carries meaning about how
   something should be *read*, not how it looks:

     { type:'h1'|'h2'|'h3'|'p'|'li'|'quote'|'caption'|'label'|'table',
       text, runs:[{text,bold}], items:[…], rows:[[…]], header:[…], ordered }
   ============================================================ */

const CAPTION_RE = /^(figure|fig\.|table|exhibit|chart|plate|image|photo)\b/i;

export async function parseFile(file){
  const name = (file.name || 'document').replace(/\.[^.]+$/, '');
  const ext  = (file.name || '').toLowerCase().split('.').pop();

  let blocks;
  if (ext === 'docx')                      blocks = await parseDocx(file);
  else if (ext === 'pdf')                  blocks = await parsePdf(file);
  else if (ext === 'html' || ext === 'htm')blocks = parseHtml(await file.text());
  else if (ext === 'md' || ext === 'markdown') blocks = parseMarkdown(await file.text());
  else if (ext === 'txt' || !ext)          blocks = parsePlain(await file.text());
  else throw new Error(`Cue cannot read .${ext} files. Try .docx, .pdf, .md, .txt or .html.`);

  blocks = tidy(blocks);
  if (!blocks.length) throw new Error('That file opened, but there was no readable text inside it.');
  return { title: guessTitle(blocks, name), blocks };
}

export function parseText(text, title){
  return { title: title || 'Sample script', blocks: tidy(parseMarkdown(text)) };
}

/* ── Word ─────────────────────────────────────────────────── */
async function parseDocx(file){
  if (typeof window.mammoth === 'undefined')
    throw new Error('The Word reader has not finished loading. Check your connection and try again.');
  const buf = await file.arrayBuffer();
  const { value: html } = await window.mammoth.convertToHtml(
    { arrayBuffer: buf },
    { styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => p:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
      ] }
  );
  return parseHtml(html);
}

/* ── HTML ─────────────────────────────────────────────────── */
export function parseHtml(html){
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,head').forEach(n => n.remove());
  const out = [];
  walk(doc.body || doc.documentElement, out);
  return out;
}

function walk(node, out){
  for (const el of Array.from(node.children || [])){
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)){
      const level = Math.min(3, +tag[1]);
      const text = clean(el.textContent);
      if (text) out.push({ type:'h'+level, text, runs:[{text,bold:true}] });
    }
    else if (tag === 'p'){
      pushParagraph(clean(el.textContent), runsOf(el), out);
    }
    else if (tag === 'blockquote'){
      const text = clean(el.textContent);
      if (text) out.push({ type:'quote', text, runs:runsOf(el) });
    }
    else if (tag === 'ul' || tag === 'ol'){
      const items = Array.from(el.querySelectorAll(':scope > li'))
        .map(li => ({ text: clean(li.textContent), runs: runsOf(li) }))
        .filter(i => i.text);
      if (items.length) out.push({ type:'li', ordered: tag === 'ol', items, text: items.map(i=>i.text).join(' ') });
    }
    else if (tag === 'table'){
      pushTable(el, out);
    }
    else if (tag === 'br' || tag === 'hr'){ /* nothing to say */ }
    else if (el.children.length){
      walk(el, out);
    }
    else {
      pushParagraph(clean(el.textContent), runsOf(el), out);
    }
  }
}

function pushParagraph(text, runs, out){
  if (!text) return;
  if (CAPTION_RE.test(text) && text.length < 220) out.push({ type:'caption', text, runs });
  else if (isLabel(text))                          out.push({ type:'label',   text, runs });
  else                                             out.push({ type:'p',       text, runs });
}

function pushTable(el, out){
  const rows = Array.from(el.querySelectorAll('tr'))
    .map(tr => Array.from(tr.querySelectorAll('th,td')).map(td => clean(td.textContent)))
    .filter(r => r.some(c => c));
  if (!rows.length) return;

  // A one-cell table is a callout box, not data. Read what is inside it.
  if (rows.length === 1 && rows[0].length === 1){
    const inner = el.querySelector('td,th');
    if (inner) walk(inner, out);
    return;
  }
  // A single row of short cells is a stat strip — read the cells in turn.
  if (rows.length === 1){
    rows[0].filter(Boolean).forEach(c => pushParagraph(c, [{text:c}], out));
    return;
  }
  // Unwrap tables that are really just layout containers holding blocks.
  const cells = Array.from(el.querySelectorAll('td,th'));
  if (rows.length <= 2 && cells.some(c => c.querySelectorAll('p,ul,ol,h1,h2,h3').length > 1)){
    cells.forEach(c => walk(c, out));
    return;
  }

  const looksHeaded = el.querySelector('th') ||
    rows[0].every(c => c && c.length < 40 && !/[.!?]$/.test(c));
  const header = looksHeaded ? rows.shift() : null;
  if (!rows.length) return;
  out.push({
    type:'table', header, rows,
    text: (header ? header.join(', ') + '. ' : '') + rows.map(r => r.join(', ')).join('. ')
  });
}

function runsOf(el){
  const runs = [];
  const walkRuns = (n, bold) => {
    for (const c of n.childNodes){
      if (c.nodeType === 3){
        const t = c.textContent.replace(/\s+/g,' ');
        if (t.trim()) runs.push({ text:t, bold });
      } else if (c.nodeType === 1){
        const tag = c.tagName.toLowerCase();
        walkRuns(c, bold || tag === 'strong' || tag === 'b');
      }
    }
  };
  walkRuns(el, false);
  return runs.length ? runs : [{ text: clean(el.textContent), bold:false }];
}

/* ── PDF ──────────────────────────────────────────────────── */
async function parsePdf(file){
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byRow = new Map();
    for (const it of content.items){
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2;
      const size = Math.abs(it.transform[0]) || 10;
      const row = byRow.get(y) || { y, size:0, parts:[] };
      row.size = Math.max(row.size, size);
      row.parts.push({ x: it.transform[4], s: it.str });
      byRow.set(y, row);
    }
    [...byRow.values()]
      .sort((a,b) => b.y - a.y)
      .forEach(r => lines.push({
        page: p, size: r.size,
        text: clean(r.parts.sort((a,b)=>a.x-b.x).map(p=>p.s).join(' '))
      }));
  }

  // Drop running heads/feet: identical short lines repeating across pages.
  const tally = new Map();
  lines.forEach(l => { if (l.text.length < 90) tally.set(l.text, (tally.get(l.text)||0)+1); });
  const pages = pdf.numPages;
  const furniture = new Set([...tally].filter(([,n]) => n > Math.max(2, pages*0.5)).map(([t])=>t));

  const body = lines.filter(l =>
    l.text && !furniture.has(l.text) && !/^\d{1,4}$/.test(l.text) && !/^page \d+/i.test(l.text));
  if (!body.length) throw new Error('That PDF has no selectable text — it is probably a scan. Cue cannot read images yet.');

  const sizes = body.map(l => l.size).sort((a,b)=>a-b);
  const base  = sizes[Math.floor(sizes.length/2)] || 10;

  const out = [];
  let buf = null;
  const flush = () => { if (buf && buf.text) pushParagraph(clean(buf.text), [{text:clean(buf.text)}], out); buf = null; };

  for (const l of body){
    const big = l.size > base * 1.5, mid = l.size > base * 1.18;
    const bullet = /^([•▪◦‣–—*]|\d{1,2}[.)])\s+/.test(l.text);

    if (big || mid){
      flush();
      out.push({ type: big ? 'h2' : 'h3', text: l.text, runs:[{text:l.text,bold:true}] });
      continue;
    }
    if (bullet){
      flush();
      const text = l.text.replace(/^([•▪◦‣–—*]|\d{1,2}[.)])\s+/, '');
      const prev = out[out.length-1];
      if (prev && prev.type === 'li') prev.items.push({ text, runs:[{text}] });
      else out.push({ type:'li', ordered:/^\d/.test(l.text), items:[{text,runs:[{text}]}], text });
      continue;
    }
    if (!buf) buf = { text: l.text };
    else buf.text += (/[-‑]$/.test(buf.text) ? '' : ' ') + l.text;

    if (/[.!?:]["')\]]?$/.test(l.text)) flush();
  }
  flush();
  return out;
}

/* ── Markdown & plain text ────────────────────────────────── */
export function parseMarkdown(src){
  const out = [];
  const lines = src.replace(/\r/g,'').split('\n');
  let para = [], list = null, fence = false;

  const flushPara = () => {
    if (!para.length) return;
    const raw = clean(para.join(' '));
    const runs = inlineRuns(raw);
    pushParagraph(clean(runs.map(r => r.text).join('')), runs, out);
    para = [];
  };
  const flushList = () => { if (list && list.items.length) out.push(list); list = null; };

  for (let i = 0; i < lines.length; i++){
    const raw = lines[i];
    const line = raw.trim();

    if (/^```/.test(line)){ fence = !fence; continue; }
    if (fence) continue;

    if (!line){ flushPara(); flushList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h){
      flushPara(); flushList();
      const text = clean(strip(h[2]));
      out.push({ type:'h'+Math.min(3,h[1].length), text, runs:[{text,bold:true}] });
      continue;
    }
    if (/^(\*\*\*|---|___)\s*$/.test(line)){ flushPara(); flushList(); continue; }

    if (/^>\s?/.test(line)){
      flushPara(); flushList();
      const raw = clean(strip(line.replace(/^>\s?/,'')));
      const runs = inlineRuns(raw);
      const text = clean(runs.map(r => r.text).join(''));
      if (text) out.push({ type:'quote', text, runs });
      continue;
    }

    // pipe tables
    if (/^\|.*\|$/.test(line)){
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])){
        const cells = lines[i].trim().slice(1,-1).split('|').map(c => clean(strip(c)));
        if (!cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g,'')))) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length > 1) out.push({ type:'table', header: rows.shift(), rows,
        text: rows.map(r=>r.join(', ')).join('. ') });
      continue;
    }

    const li = line.match(/^([-*+•▪]|\d{1,2}[.)])\s+(.*)$/);
    if (li){
      flushPara();
      const ordered = /^\d/.test(li[1]);
      if (!list || list.ordered !== ordered) { flushList(); list = { type:'li', ordered, items:[], text:'' }; }
      const rawItem = clean(strip(li[2]));
      const itemRuns = inlineRuns(rawItem);
      const text = clean(itemRuns.map(r => r.text).join(''));
      list.items.push({ text, runs: itemRuns });
      list.text = list.items.map(x=>x.text).join(' ');
      continue;
    }

    flushList();
    para.push(strip(line));
  }
  flushPara(); flushList();
  return out;
}

function parsePlain(src){
  // Blank-line separated paragraphs; a short line followed by a blank reads as a heading.
  const out = [];
  for (const chunk of src.replace(/\r/g,'').split(/\n{2,}/)){
    const text = clean(chunk.replace(/\n/g,' '));
    if (!text) continue;
    if (text.length < 70 && !/[.!?]$/.test(text) && /^[A-Z0-9]/.test(text))
      out.push({ type:'h2', text, runs:[{text,bold:true}] });
    else pushParagraph(text, [{text}], out);
  }
  return out;
}

const unmark = s => s.replace(/(?:\*|_)(?=\S)([^*_]+?)(?:\*|_)/g, '$1');

function inlineRuns(text){
  const runs = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__)/g;
  let last = 0, m;
  while ((m = re.exec(text))){
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold:false });
    runs.push({ text: m[0].slice(2,-2), bold:true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold:false });
  const out = (runs.length ? runs : [{ text, bold:false }])
    .map(r => ({ ...r, text: unmark(r.text) }))
    .filter(r => r.text);
  return out.length ? out : [{ text: unmark(text), bold:false }];
}

const strip = s => s
  .replace(/!\[[^\]]*\]\([^)]*\)/g,'')
  .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
  .replace(/`([^`]+)`/g,'$1');

/* ── shared helpers ───────────────────────────────────────── */
function clean(s){
  return (s || '')
    .replace(/\u00AD/g,'')
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/\s+/g,' ')
    .trim();
}

function isLabel(text){
  if (text.length > 64 || text.length < 2) return false;
  const letters = text.replace(/[^A-Za-z]/g,'');
  if (letters.length < 2) return false;
  const caps = text.replace(/[^A-Z]/g,'').length;
  return caps / letters.length > 0.82 && !/[.!?]$/.test(text);
}

function tidy(blocks){
  const out = [];
  for (const b of blocks){
    if (!b) continue;
    const text = (b.text || '').trim();
    if (!text && b.type !== 'table') continue;
    // Collapse a heading immediately repeated (common in converted files).
    const prev = out[out.length-1];
    if (prev && prev.type === b.type && prev.text === text) continue;
    if (b.runs) b.runs = b.runs.filter(r => r.text && r.text.trim());
    out.push(b);
  }
  return out;
}

function guessTitle(blocks, fallback){
  const h = blocks.find(b => b.type === 'h1') || blocks.find(b => b.type === 'h2');
  const t = h && h.text.length < 110 ? h.text : fallback;
  return t.replace(/[_-]+/g,' ').trim() || 'Untitled document';
}
