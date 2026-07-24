/* ============================================================
   speech.js — two ways to make sound.

   BrowserEngine  the voices already on the device. Free, instant.
   CloudEngine    a paid API the listener supplies a key for.
                  Only this one can be written to a file.
   ============================================================ */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── the device's own voices ──────────────────────────────── */
export function listVoices(){
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(synth.getVoices()); };
    synth.addEventListener('voiceschanged', finish, { once:true });
    setTimeout(finish, 1200);
  });
}

/** Voices most likely to sound like a narrator rather than a satnav. */
export function rankVoices(voices){
  const good = /(natural|neural|premium|enhanced|siri|google|samantha|serena|daniel|karen|moira|tessa|arthur|amelie|zira|aria|libby|ryan|sonia)/i;
  return [...voices].sort((a, b) => {
    const la = a.lang.toLowerCase().startsWith('en'), lb = b.lang.toLowerCase().startsWith('en');
    if (la !== lb) return la ? -1 : 1;
    const ga = good.test(a.name), gb = good.test(b.name);
    if (ga !== gb) return ga ? -1 : 1;
    if (a.localService !== b.localService) return a.localService ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export class BrowserEngine {
  constructor(){
    this.synth = window.speechSynthesis;
    this.voice = null;
    this.current = null;
    this.ping = null;
  }
  get available(){ return !!this.synth; }
  get needsFile(){ return false; }

  setVoice(v){ this.voice = v; }

  /** Must run inside the click that starts playback, or mobile stays silent. */
  unlock(){
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      this.synth.speak(u);
    } catch {}
  }

  speak(seg, { rate = 1, pitch = 1 } = {}){
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(seg.spoken);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
      u.rate   = clamp(rate  * (seg.rate  || 1), 0.5, 2);
      u.pitch  = clamp(pitch * (seg.pitch || 1), 0, 2);
      u.volume = clamp(seg.volume || 1, 0, 1);

      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true; this.stopPing(); this.pending = null; fn(arg);
      };
      this.pending = () => finish(resolve);
      u.onend   = () => finish(resolve);
      u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled')
        ? finish(resolve)
        : finish(reject, new Error(e.error || 'speech failed'));

      this.current = u;
      // Chrome drops long utterances unless nudged.
      this.startPing();
      try { this.synth.speak(u); }
      catch (err){ finish(reject, err); }
    });
  }

  startPing(){
    this.stopPing();
    this.ping = setInterval(() => {
      if (this.synth.speaking && !this.synth.paused){ this.synth.pause(); this.synth.resume(); }
    }, 9000);
  }
  stopPing(){ if (this.ping){ clearInterval(this.ping); this.ping = null; } }

  cancel(){
    this.stopPing();
    if (this.pending) this.pending();          // never leave runLoop awaiting forever
    if (this.current){ this.current.onend = null; this.current.onerror = null; this.current = null; }
    try { this.synth.cancel(); } catch {}
    return new Promise(r => setTimeout(r, 70));   // Chrome needs a beat after cancel()
  }
}

/* ── a cloud voice, using the listener's own key ──────────── */
export class CloudEngine {
  constructor(cfg = {}){
    this.cfg = cfg;
    this.cache = new Map();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.stopped = false;
  }

  /** Same idea: a muted play inside the gesture buys us autoplay later. */
  unlock(){
    try {
      this.audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
      const p = this.audio.play();
      p && p.catch(() => {});
    } catch {}
  }
  get available(){ return !!(this.cfg.key && this.cfg.voice); }
  get needsFile(){ return true; }
  configure(cfg){
    const changed = ['provider','key','voice','model','base'].some(k => cfg[k] !== this.cfg[k]);
    this.cfg = cfg;
    if (changed) this.cache.clear();
  }

  async bytes(text){
    if (this.cache.has(text)) return this.cache.get(text);
    const { provider, key, voice, model, base } = this.cfg;
    let res;
    if (provider === 'elevenlabs'){
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method:'POST',
        headers:{ 'xi-api-key': key, 'Content-Type':'application/json', 'Accept':'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: model || 'eleven_multilingual_v2',
          voice_settings:{ stability:0.42, similarity_boost:0.78, style:0.18, use_speaker_boost:true },
        }),
      });
    } else {
      res = await fetch(`${(base || 'https://api.openai.com/v1').replace(/\/$/,'')}/audio/speech`, {
        method:'POST',
        headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ model: model || 'gpt-4o-mini-tts', voice, input:text, response_format:'mp3' }),
      });
    }
    if (!res.ok){
      const detail = await res.text().catch(() => '');
      throw new Error(`${res.status} from the voice provider. ${detail.slice(0,180)}`);
    }
    const buf = await res.arrayBuffer();
    if (this.cache.size > 400) this.cache.clear();
    this.cache.set(text, buf);
    return buf;
  }

  /** Warm the next few lines so playback does not stutter. */
  prefetch(segments, from, count = 3){
    for (let i = from; i < Math.min(from + count, segments.length); i++){
      const s = segments[i];
      if (s && s.spoken && !this.cache.has(s.spoken)) this.bytes(s.spoken).catch(() => {});
    }
  }

  async speak(seg, { rate = 1 } = {}){
    this.stopped = false;
    const buf = await this.bytes(seg.spoken);
    if (this.stopped) return;
    const url = URL.createObjectURL(new Blob([buf], { type:'audio/mpeg' }));
    return new Promise((resolve, reject) => {
      const a = this.audio;
      a.src = url;
      a.playbackRate = clamp(rate * (seg.rate || 1), 0.5, 2);
      a.volume = clamp(seg.volume || 1, 0, 1);
      const done = (err) => {
        a.onended = a.onerror = null;
        URL.revokeObjectURL(url);
        err && !this.stopped ? reject(err) : resolve();
      };
      a.onended = () => done();
      a.onerror = () => done(this.stopped ? null : new Error('That audio would not play.'));
      a.play().catch(e => done(this.stopped ? null : e));
    });
  }

  async cancel(){
    this.stopped = true;
    try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch {}
  }

  /** Render a run of segments into one MP3, silences included.
      Encodes as it goes — a two-hour document must never be held
      in memory as raw audio. */
  async render(segments, onProgress){
    const lame = await loadLame();
    const ctx  = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    const rate = 44100;
    const enc  = new lame.Mp3Encoder(1, rate, 96);
    const out  = [];
    const BLOCK = 1152;
    const hush = new Int16Array(BLOCK);

    const feed = (pcm) => {
      for (let i = 0; i < pcm.length; i += BLOCK){
        const mp3 = enc.encodeBuffer(pcm.subarray(i, Math.min(i + BLOCK, pcm.length)));
        if (mp3.length) out.push(new Uint8Array(mp3));
      }
    };
    const silence = (samples) => {
      let left = samples;
      while (left > 0){
        const n = Math.min(BLOCK, left);
        const mp3 = enc.encodeBuffer(n === BLOCK ? hush : hush.subarray(0, n));
        if (mp3.length) out.push(new Uint8Array(mp3));
        left -= n;
      }
    };

    const speak = segments.filter(s => s.spoken && !s.silent);
    for (let i = 0; i < speak.length; i++){
      const s = speak[i];
      const buf  = await this.bytes(s.spoken);
      const deco = await ctx.decodeAudioData(buf.slice(0));
      const mono = toMono(deco);
      const pcm  = new Int16Array(mono.length);
      for (let k = 0; k < mono.length; k++){
        const v = Math.max(-1, Math.min(1, mono[k]));
        pcm[k] = v < 0 ? v * 0x8000 : v * 0x7FFF;
      }
      feed(pcm);
      silence(Math.round(rate * (s.pauseAfter || 0) / 1000));
      this.cache.delete(s.spoken);          // let each line go once it is encoded
      onProgress && onProgress((i + 1) / speak.length, i + 1, speak.length);
      if (i % 25 === 0) await new Promise(r => setTimeout(r, 0));  // keep the tab responsive
    }

    const tail = enc.flush();
    if (tail.length) out.push(new Uint8Array(tail));
    ctx.close && ctx.close();
    return new Blob(out, { type:'audio/mpeg' });
  }
}

function toMono(buf){
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const a = buf.getChannelData(0), b = buf.getChannelData(1);
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}

let lamePromise = null;
function loadLame(){
  if (window.lamejs) return Promise.resolve(window.lamejs);
  if (lamePromise) return lamePromise;
  lamePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    s.onload = () => window.lamejs ? resolve(window.lamejs) : reject(new Error('The MP3 encoder did not load.'));
    s.onerror = () => reject(new Error('The MP3 encoder could not be downloaded. Check your connection.'));
    document.head.appendChild(s);
  });
  return lamePromise;
}
