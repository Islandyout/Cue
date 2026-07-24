/* ============================================================
   app.js — wiring. Nothing clever lives here; the reading
   decisions are all in script.js.
   ============================================================ */
import { parseFile, parseText } from './parse.js';
import { buildScript, collectAcronyms, estimateSeconds, clock, normalise, DEFAULT_LEXICON } from './script.js';
import { BrowserEngine, CloudEngine, listVoices, rankVoices } from './speech.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const SAMPLE = `# Reading test

Cue works out how a document should sound before it says a word.

This paragraph exists to prove a point. A voice that reads **J$1,902,360** as digits is not reading, it is reciting. Cue says it as *one million, nine hundred and two thousand, three hundred and sixty Jamaican dollars* — and it slows down for the number, because numbers need room.

## What it listens for

- Headings, which get a lower pitch and a longer breath after them
- Bold text, which it leans on rather than skates over
- Tables, which it turns back into sentences
- Abbreviations such as NIS, NHT and PAYE, said the way people say them

| Deduction | Employer | Employee |
| --- | --- | --- |
| NIS | 3% | 3% |
| NHT | 3% | 2% |
| Education Tax | 3.5% | 2.25% |

> A table read cell by cell is noise. A table read as sentences is information.

Dates land properly too: from 1 July 2026 the rate changed, and by 2016 standards that is a large move. Ring (876) 908-4419 if you disagree.`;

const state = {
  doc:null, script:null, idx:0, playing:false, token:0, timer:null,
  engine:null, browser:new BrowserEngine(), cloud:new CloudEngine({}),
  voices:[], lexicon:{...DEFAULT_LEXICON}, docKey:'',
  settings:{
    engine:'browser', voiceURI:'', rate:1, pitch:1, pause:1,
    sectionNumbers:true, emphasis:true, captions:false, tables:'full',
    provider:'elevenlabs', key:'', voiceId:'', model:'', base:'https://api.openai.com/v1',
  },
};

/* ── boot ─────────────────────────────────────────────────── */
loadSettings();
state.engine = state.browser;
wireIntake();
wirePanels();
wireTransport();
wireKeyboard();
initVoices();

/* ── settings ─────────────────────────────────────────────── */
function loadSettings(){
  try {
    Object.assign(state.settings, JSON.parse(localStorage.getItem('cue.settings') || '{}'));
    const lex = JSON.parse(localStorage.getItem('cue.lexicon') || 'null');
    if (lex) state.lexicon = lex;
  } catch {}
}
function saveSettings(){
  try { localStorage.setItem('cue.settings', JSON.stringify(state.settings)); } catch {}
}
function saveLexicon(){
  try { localStorage.setItem('cue.lexicon', JSON.stringify(state.lexicon)); } catch {}
}

/* ── intake ───────────────────────────────────────────────── */
function wireIntake(){
  const zone = $('#dropzone'), input = $('#fileInput');
  $('#btnBrowse').addEventListener('click', e => { e.stopPropagation(); input.click(); });
  $('.dropzone__inner').addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files[0] && open(input.files[0]));

  ['dragenter','dragover'].forEach(t => zone.addEventListener(t, e => {
    e.preventDefault(); zone.classList.add('is-over');
  }));
  ['dragleave','drop'].forEach(t => zone.addEventListener(t, e => {
    e.preventDefault(); if (t === 'dragleave' && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('is-over');
  }));
  zone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) open(f); });

  $('#btnSample').addEventListener('click', e => {
    e.stopPropagation();
    load(parseText(SAMPLE, 'Reading test'), 'sample');
  });
  $('#btnNew').addEventListener('click', () => location.reload());
  $('#fileChip').addEventListener('click', () => $('#contents').classList.toggle('is-open'));
}

async function open(file){
  const err = $('#intakeError');
  err.hidden = true;
  $('.dropzone__lead').textContent = 'Reading ' + file.name + '…';
  try {
    const doc = await parseFile(file);
    load(doc, file.name);
  } catch (e){
    $('.dropzone__lead').textContent = 'Drop a document here';
    err.textContent = e.message || 'That file could not be read.';
    err.hidden = false;
  }
}

function load(doc, label){
  state.doc = doc;
  state.docKey = 'cue.pos.' + hash(doc.title + doc.blocks.length);
  const found = collectAcronyms(doc.blocks);
  state.lexicon = { ...state.lexicon, ...Object.fromEntries(
    Object.entries(found).filter(([k]) => !(k in state.lexicon))) };
  saveLexicon();

  rebuild();
  document.body.dataset.state = 'reading';
  $('#stageEmpty').hidden = true;
  $('#stageReader').hidden = false;
  $('#desk').hidden = false;
  $('#btnNew').hidden = false;
  const chip = $('#fileChip');
  chip.hidden = false;
  chip.textContent = label;
  chip.title = doc.title;

  const saved = +(localStorage.getItem(state.docKey) || 0);
  if (saved > 0 && saved < state.script.segments.length){
    seek(saved, false);
    toast('Picked up where you stopped last time.');
  } else seek(0, false);
}

function rebuild(){
  if (!state.doc) return;
  const keepBlock = state.script ? (state.script.segments[state.idx] || {}).blockIdx : null;
  state.script = buildScript(state.doc, {
    lexicon: state.lexicon,
    emphasis: state.settings.emphasis,
    captions: state.settings.captions,
    tables: state.settings.tables,
    sectionNumbers: state.settings.sectionNumbers,
    pauseScale: state.settings.pause,
  });
  renderScript();
  renderToc();
  renderMeta();
  if (keepBlock != null){
    const i = state.script.segments.findIndex(s => s.blockIdx === keepBlock);
    state.idx = i < 0 ? 0 : i;
  }
  paint();
}

/* ── rendering the script ─────────────────────────────────── */
function renderScript(){
  const host = $('#scriptInner');
  host.textContent = '';
  const { segments } = state.script;
  const blocks = state.doc.blocks;

  let group = null, lastItem = null;
  segments.forEach(seg => {
    const startsBlock = !group || group.dataset.block !== String(seg.blockIdx);
    if (startsBlock){
      group = document.createElement('div');
      group.className = 'blk blk--' + seg.role;
      group.dataset.block = seg.blockIdx;
      const b = blocks[seg.blockIdx];
      if (seg.role === 'table' && b && b.header){
        const cap = document.createElement('p');
        cap.className = 'blk__caption';
        cap.textContent = b.header.filter(Boolean).join('  ·  ');
        group.appendChild(cap);
      }
      host.appendChild(group);
      lastItem = null;
    }

    const line = document.createElement('button');
    line.className = 'line';
    line.type = 'button';
    line.dataset.i = seg.id;
    if (seg.itemIdx != null && seg.itemIdx !== lastItem){
      if (lastItem != null) line.style.marginTop = '9px';
      lastItem = seg.itemIdx;
    }

    if (seg.silent){
      line.disabled = true;
      line.style.opacity = '.45';
      line.title = 'Skipped — turn captions on under Voice';
    }

    const marks = document.createElement('span');
    marks.className = 'line__marks';
    marks.innerHTML = marksFor(seg);
    line.appendChild(marks);

    const text = document.createElement('span');
    text.className = 'line__text';
    text.textContent = seg.display;
    line.appendChild(text);

    const spoken = document.createElement('span');
    spoken.className = 'line__spoken';
    const differs = simplify(seg.spoken) !== simplify(seg.display);
    spoken.dataset.differs = differs ? '1' : '0';
    spoken.textContent = seg.spoken;
    line.appendChild(spoken);

    line.addEventListener('click', () => { if (!seg.silent) seek(seg.id, state.playing); });
    group.appendChild(line);
  });
}

function marksFor(seg){
  const out = [];
  const r = seg.rate || 1, p = seg.pitch || 1;
  if (Math.abs(r - 1) > 0.035) out.push(`<i class="mark">${r.toFixed(2)}×</i>`);
  if (Math.abs(p - 1) > 0.03)  out.push(`<i class="mark">${p > 1 ? '↑' : '↓'}</i>`);
  if (seg.emphasis)            out.push('<i class="mark">emph</i>');
  if (seg.pauseAfter >= 400)   out.push(`<i class="mark mark--pause">${(seg.pauseAfter/1000).toFixed(1)}s</i>`);
  return out.join('');
}
const simplify = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g,'');

function renderToc(){
  const ol = $('#toc');
  ol.textContent = '';
  state.script.chapters.forEach((ch, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'toc__item';
    b.type = 'button';
    b.dataset.level = ch.level;
    b.dataset.ch = i;
    b.textContent = ch.title;
    b.addEventListener('click', () => {
      seek(ch.segment, state.playing);
      $('#contents').classList.remove('is-open');
    });
    li.appendChild(b);
    ol.appendChild(li);
  });
  const marks = $('#scrubMarks');
  marks.textContent = '';
  const n = state.script.segments.length || 1;
  state.script.chapters.filter(c => c.level <= 2).forEach(c => {
    const i = document.createElement('i');
    i.style.left = (c.segment / n * 100) + '%';
    marks.appendChild(i);
  });
}

function renderMeta(){
  if (!state.script) return;
  const { segments } = state.script;
  const words = segments.reduce((a, s) => a + s.words, 0);
  const total = estimateSeconds(segments, state.settings.rate);
  $('#docMeta').textContent =
    `${state.script.chapters.length} sections · ${words.toLocaleString()} words · about ${clock(total)}`;
  $('#timeTotal').textContent = clock(total);
}

/* ── transport ────────────────────────────────────────────── */
function wireTransport(){
  $('#btnPlay').addEventListener('click', () => state.playing ? pause() : play());
  $('#btnPrev').addEventListener('click', () => step(-1));
  $('#btnNext').addEventListener('click', () => step(1));
  $('#btnPrevCh').addEventListener('click', () => jumpChapter(-1));
  $('#btnNextCh').addEventListener('click', () => jumpChapter(1));

  const scrub = $('#scrub');
  const at = e => {
    const r = scrub.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width));
    seek(Math.floor(pct * (state.script.segments.length - 1)), state.playing);
  };
  scrub.addEventListener('click', at);
  scrub.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();      // the global handler must not also fire
    step(e.key === 'ArrowLeft' ? -1 : 1);
  });

  const quick = $('#rateQuick');
  quick.value = state.settings.rate;
  $('#rateOut').textContent = (+state.settings.rate).toFixed(2) + '×';
  quick.addEventListener('input', () => {
    state.settings.rate = +quick.value;
    $('#rateOut').textContent = state.settings.rate.toFixed(2) + '×';
    $('#setRate').value = state.settings.rate;
    $('#outRate').textContent = state.settings.rate.toFixed(2) + '×';
    saveSettings(); renderMeta(); paint();
  });
}

async function play(){
  if (!state.script) return;
  if (state.settings.engine === 'cloud' && !state.cloud.available){
    toast('Add your API key and a voice ID under Voice first.');
    openPanel('#panelVoice', '#btnVoice');
    return;
  }
  state.engine.unlock && state.engine.unlock();   // inside the click, before any await
  state.playing = true;
  state.justStarted = true;
  document.body.dataset.playing = '1';
  $('#btnPlay').setAttribute('aria-label','Pause');
  const token = ++state.token;
  runLoop(token);
}

async function pause(){
  state.playing = false;
  state.token++;
  document.body.dataset.playing = '0';
  $('#btnPlay').setAttribute('aria-label','Play');
  clearTimeout(state.timer);
  await state.engine.cancel();
}

async function runLoop(token){
  const segs = state.script.segments;
  while (state.playing && token === state.token && state.idx < segs.length){
    const seg = segs[state.idx];
    if (!seg || seg.silent || !seg.spoken){ state.idx++; continue; }

    paint();
    if (state.settings.engine === 'cloud') state.cloud.prefetch(segs, state.idx + 1, 3);
    const skipHold = state.justStarted;
    state.justStarted = false;
    if (seg.pauseBefore && !skipHold && !(await hold(seg.pauseBefore, token))) return;

    try {
      await state.engine.speak(seg, { rate: state.settings.rate, pitch: state.settings.pitch });
    } catch (e){
      if (token !== state.token) return;
      await pause();
      toast(e.message || 'The voice stopped unexpectedly.');
      return;
    }
    if (token !== state.token || !state.playing) return;
    if (seg.pauseAfter && !(await hold(seg.pauseAfter, token))) return;

    state.idx++;
    try { localStorage.setItem(state.docKey, String(state.idx)); } catch {}
  }
  if (token === state.token && state.idx >= segs.length){
    await pause();
    state.idx = segs.length - 1;
    paint();
    toast('That is the end of the document.');
  }
}

function hold(ms, token){
  return new Promise(resolve => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => resolve(state.playing && token === state.token), ms);
  });
}

async function seek(i, resume){
  const segs = state.script.segments;
  state.idx = Math.min(Math.max(0, i), segs.length - 1);
  const was = state.playing;
  if (was || resume){ await pause(); }
  paint();
  try { localStorage.setItem(state.docKey, String(state.idx)); } catch {}
  if (was || resume) play();
}

function step(d){
  const segs = state.script.segments;
  let i = state.idx + d;
  while (i > 0 && i < segs.length && (segs[i].silent || !segs[i].spoken)) i += d;
  seek(i, state.playing);
}

function jumpChapter(d){
  const chs = state.script.chapters;
  if (!chs.length) return;
  const cur = chs.findIndex(c => c.segment > state.idx);
  const here = (cur === -1 ? chs.length : cur) - 1;
  let target = here + d;
  if (d < 0 && here >= 0 && state.idx - chs[here].segment > 3) target = here;
  target = Math.min(chs.length - 1, Math.max(0, target));
  seek(chs[target].segment, state.playing);
}

/* ── painting the current position ────────────────────────── */
let lastPainted = -1;
function paint(){
  if (!state.script) return;
  const segs = state.script.segments;
  const seg = segs[state.idx];
  if (!seg) return;

  if (lastPainted !== state.idx){
    $$('.line.is-live').forEach(el => el.classList.remove('is-live'));
    const el = $(`.line[data-i="${state.idx}"]`);
    if (el){
      el.classList.add('is-live');
      const box = $('#script');
      const y = el.offsetTop - box.clientHeight * 0.34;
      box.scrollTo({ top: Math.max(0, y), behavior: prefersMotion() ? 'smooth' : 'auto' });
    }
    $$('.line').forEach(n => n.classList.toggle('is-done', +n.dataset.i < state.idx));
    lastPainted = state.idx;
  }

  const pct = segs.length > 1 ? state.idx / (segs.length - 1) : 0;
  $('#scrubFill').style.width = (pct * 100) + '%';
  $('#scrubHead').style.left = (pct * 100) + '%';
  $('#scrub').setAttribute('aria-valuenow', Math.round(pct * 100));
  $('#timeNow').textContent = clock(estimateSeconds(segs, state.settings.rate, 0, state.idx));

  const ch = state.script.chapters[seg.chapter];
  $('#nowLabel').textContent = ch ? ch.title : (state.doc ? state.doc.title : '');
  $$('.toc__item').forEach(b => b.classList.toggle('is-current', +b.dataset.ch === seg.chapter));
}
const prefersMotion = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── voices ───────────────────────────────────────────────── */
async function initVoices(){
  const sel = $('#voiceSelect');
  const voices = rankVoices(await listVoices());
  state.voices = voices;
  sel.textContent = '';
  if (!voices.length){
    sel.innerHTML = '<option>No voices found on this device</option>';
    $('#voiceHint').textContent = 'This browser exposes no speech voices. Try Chrome, Edge or Safari, or use a cloud voice.';
    return;
  }
  voices.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} — ${v.lang}${v.localService ? '' : ' (online)'}`;
    sel.appendChild(o);
  });
  const want = state.settings.voiceURI && voices.find(v => v.voiceURI === state.settings.voiceURI);
  const pick = want || voices[0];
  sel.value = pick.voiceURI;
  state.browser.setVoice(pick);
  $('#voiceHint').textContent = pick.localService
    ? 'Installed on this device, so it works offline.'
    : 'Served over the network by your browser vendor.';

  sel.addEventListener('change', () => {
    const v = state.voices.find(x => x.voiceURI === sel.value);
    if (!v) return;
    state.browser.setVoice(v);
    state.settings.voiceURI = v.voiceURI;
    saveSettings();
    $('#voiceHint').textContent = v.localService
      ? 'Installed on this device, so it works offline.'
      : 'Served over the network by your browser vendor.';
  });
}

/* ── panels ───────────────────────────────────────────────── */
function wirePanels(){
  const map = [['#btnVoice','#panelVoice'],['#btnWords','#panelWords'],['#btnExport','#panelExport']];
  map.forEach(([btn, panel]) => $(btn).addEventListener('click', () => togglePanel(panel, btn)));
  $$('[data-close]').forEach(b => b.addEventListener('click', closePanels));
  $('#scrim').addEventListener('click', closePanels);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanels(); });

  // engine
  $$('input[name=engine]').forEach(r => {
    r.checked = r.value === state.settings.engine;
    r.addEventListener('change', () => {
      state.settings.engine = r.value;
      state.engine = r.value === 'cloud' ? state.cloud : state.browser;
      $$('[data-engine]').forEach(d => d.hidden = d.dataset.engine !== r.value);
      saveSettings(); pause();
    });
  });
  $$('[data-engine]').forEach(d => d.hidden = d.dataset.engine !== state.settings.engine);
  state.engine = state.settings.engine === 'cloud' ? state.cloud : state.browser;

  // cloud fields
  const cloudFields = [['#cloudProvider','provider'],['#cloudKey','key'],['#cloudVoice','voiceId'],
                       ['#cloudModel','model'],['#cloudBase','base']];
  cloudFields.forEach(([sel, key]) => {
    const el = $(sel);
    el.value = state.settings[key] || el.value;
    el.addEventListener('input', () => {
      state.settings[key] = el.value.trim();
      saveSettings(); syncCloud();
      $$('[data-cloud]').forEach(d => d.hidden = d.dataset.cloud !== state.settings.provider);
    });
  });
  $$('[data-cloud]').forEach(d => d.hidden = d.dataset.cloud !== state.settings.provider);
  syncCloud();

  // sliders
  bindRange('#setRate', 'rate', v => v.toFixed(2) + '×', '#outRate', () => {
    $('#rateQuick').value = state.settings.rate;
    $('#rateOut').textContent = state.settings.rate.toFixed(2) + '×';
    renderMeta();
  });
  bindRange('#setPitch', 'pitch', v => v.toFixed(2), '#outPitch');
  bindRange('#setPause', 'pause', v => v.toFixed(2) + '×', '#outPause', rebuild);

  // reading options
  bindCheck('#optAnnounce', 'sectionNumbers', rebuild);
  bindCheck('#optEmphasis', 'emphasis', rebuild);
  bindCheck('#optCaptions', 'captions', rebuild);
  const tables = $('#optTables');
  tables.value = state.settings.tables;
  tables.addEventListener('change', () => { state.settings.tables = tables.value; saveSettings(); rebuild(); });

  wireLexicon();
  wireExport();
}

function bindRange(sel, key, fmt, out, after){
  const el = $(sel);
  el.value = state.settings[key];
  $(out).textContent = fmt(+state.settings[key]);
  el.addEventListener('input', () => {
    state.settings[key] = +el.value;
    $(out).textContent = fmt(+el.value);
    saveSettings();
    after && after();
  });
}
function bindCheck(sel, key, after){
  const el = $(sel);
  el.checked = !!state.settings[key];
  el.addEventListener('change', () => { state.settings[key] = el.checked; saveSettings(); after && after(); });
}
function syncCloud(){
  state.cloud.configure({
    provider: state.settings.provider, key: state.settings.key,
    voice: state.settings.voiceId, model: state.settings.model, base: state.settings.base,
  });
}

function togglePanel(panel, btn){
  const open = !$(panel).hidden;
  closePanels();
  if (!open) openPanel(panel, btn);
}
function openPanel(panel, btn){
  $(panel).hidden = false;
  $('#scrim').hidden = false;
  $(btn).setAttribute('aria-expanded','true');
  const first = $(panel).querySelector('input,select,button');
  first && first.focus({ preventScroll:true });
}
function closePanels(){
  $$('.panel').forEach(p => p.hidden = true);
  $('#scrim').hidden = true;
  $$('.masthead__tools .btn').forEach(b => b.setAttribute('aria-expanded','false'));
}

/* ── pronunciation ────────────────────────────────────────── */
function wireLexicon(){
  $('#lexAdd').addEventListener('click', () => {
    const from = $('#lexFrom').value.trim(), to = $('#lexTo').value.trim();
    if (!from || !to) return;
    state.lexicon[from] = to;
    $('#lexFrom').value = $('#lexTo').value = '';
    saveLexicon(); renderLexicon(); if (state.script) rebuild();
  });
  $('#lexReset').addEventListener('click', () => {
    state.lexicon = { ...DEFAULT_LEXICON };
    if (state.doc) Object.assign(state.lexicon, collectAcronyms(state.doc.blocks));
    saveLexicon(); renderLexicon(); if (state.script) rebuild();
    toast('Pronunciations reset.');
  });
  renderLexicon();
}

function renderLexicon(){
  const host = $('#lexList');
  host.textContent = '';
  const inDoc = state.doc ? new Set(Object.keys(collectAcronyms(state.doc.blocks))) : new Set();
  const keys = Object.keys(state.lexicon)
    .filter(k => inDoc.has(k) || !(k in DEFAULT_LEXICON))
    .sort((a, b) => (inDoc.has(b) - inDoc.has(a)) || a.localeCompare(b));
  if (!keys.length){
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = state.doc
      ? 'Nothing in this document needs correcting. Add your own below if you hear something wrong.'
      : 'Load a document and anything it abbreviates will appear here.';
    host.appendChild(p);
  }
  keys.forEach(k => {
    const row = document.createElement('div');
    row.className = 'lex__row';
    const from = document.createElement('input');
    from.value = k; from.readOnly = true;
    if (inDoc.has(k)) from.style.borderColor = 'var(--pencil)';
    const to = document.createElement('input');
    to.value = state.lexicon[k];
    to.addEventListener('change', () => {
      state.lexicon[k] = to.value;
      saveLexicon(); if (state.script) rebuild();
    });
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '✕'; del.title = 'Remove';
    del.addEventListener('click', () => {
      delete state.lexicon[k];
      saveLexicon(); renderLexicon(); if (state.script) rebuild();
    });
    row.append(from, to, del);
    host.appendChild(row);
  });
}

/* ── export ───────────────────────────────────────────────── */
function wireExport(){
  $('#btnRender').addEventListener('click', async () => {
    if (!state.script) return toast('Load a document first.');
    if (!state.cloud.available){
      toast('Rendering a file needs a cloud voice. Set one up under Voice.');
      return openPanel('#panelVoice', '#btnVoice');
    }
    const segs = pickRange();
    const bar = $('#expBar'), status = $('#expStatus'), prog = $('#expProg');
    prog.hidden = false; $('#btnDownload').hidden = true;
    $('#btnRender').disabled = true;
    status.textContent = `Rendering ${segs.length} lines…`;
    try {
      const blob = await state.cloud.render(segs, (p, i, n) => {
        bar.style.width = (p * 100) + '%';
        status.textContent = `Rendering line ${i} of ${n}…`;
      });
      const a = $('#btnDownload');
      if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
      a.dataset.url = URL.createObjectURL(blob);
      a.href = a.dataset.url;
      a.download = (state.doc.title || 'audiobook').replace(/[^\w\d -]+/g,'').trim().slice(0,60) + '.mp3';
      a.hidden = false;
      status.textContent = `Done — ${(blob.size / 1048576).toFixed(1)} MB.`;
    } catch (e){
      status.textContent = e.message || 'Rendering failed.';
    } finally {
      $('#btnRender').disabled = false;
    }
  });
}
function pickRange(){
  const segs = state.script.segments.filter(s => s.spoken && !s.silent);
  if ($('#expRange').value === 'all') return segs;
  const ch = state.script.segments[state.idx].chapter;
  return segs.filter(s => s.chapter === ch);
}

/* ── keyboard ─────────────────────────────────────────────── */
function wireKeyboard(){
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!state.script) return;
    if (e.key === ' '){ e.preventDefault(); state.playing ? pause() : play(); }
    else if (e.key === 'ArrowLeft'){ e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight'){ e.preventDefault(); step(1); }
    else if (e.key === '['){ jumpChapter(-1); }
    else if (e.key === ']'){ jumpChapter(1); }
  });
}

/* ── odds and ends ────────────────────────────────────────── */
let toastTimer;
function toast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, 4200);
}
function hash(s){
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

window.addEventListener('beforeunload', () => { try { state.engine.cancel(); } catch {} });
