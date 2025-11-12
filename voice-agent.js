// voice-agent.js
// Small utilities
const $ = (s, r = document) => r.querySelector(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Chat client -> talks to your backend /api/chat */
export class ChatClient {
  constructor({ endpoint = '/api/chat', headers = {} } = {}) {
    this.endpoint = endpoint;
    this.headers = { 'Content-Type': 'application/json', ...headers };
  }
  async send(messages) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ messages })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json(); // { reply, lang? }
  }
}

/** VoiceAgent -> Web Speech: ASR + TTS, with niceties for kiosks */
export class VoiceAgent {
  constructor({
    onStatus = (_s) => {},
    onPartialText = (_t) => {},
    onFinalText = (_t) => {},
    onSpeakStart = () => {},
    onSpeakEnd = () => {},
    onError = () => {},
    defaultLang = 'en-US',
    continuous = false
  } = {}) {
    this.onStatus = onStatus;
    this.onPartialText = onPartialText;
    this.onFinalText = onFinalText;
    this.onSpeakStart = onSpeakStart;
    this.onSpeakEnd = onSpeakEnd;
    this.onError = onError;

    this.defaultLang = defaultLang;
    this.recognition = null;
    this.listening = false;
    this.speaking = false;
    this.voiceOn = false;
    this.continuous = continuous;

    // TTS voices
    this.ttsVoice = null;
    this.voices = [];
    if ('speechSynthesis' in window) {
      const bind = () => {
        this.voices = window.speechSynthesis.getVoices() || [];
        if (!this.ttsVoice && this.voices.length) this.ttsVoice = this._findVoiceCloseTo('en');
      };
      bind();
      window.speechSynthesis.onvoiceschanged = bind;
    }

    // ASR
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.lang = this.defaultLang;
      rec.continuous = !!continuous;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => { this.listening = true; this.onStatus('listen'); };
      rec.onerror = (e) => { this.listening = false; this.onStatus('idle'); this.onError(e); };
      rec.onend = () => { this.listening = false; this.onStatus('idle'); };
      rec.onresult = (ev) => {
        let final = '', interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) final += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        if (final.trim()) {
          this.onFinalText(final.trim());
          window.dispatchEvent(new CustomEvent('voice:final', { detail: final.trim() }));
        } else if (interim) {
          this.onPartialText(interim);
        }
      };

      this.recognition = rec;
    } else {
      console.warn('SpeechRecognition not supported in this browser.');
    }
  }

  // ========== ASR ==========
  setRecognitionLanguage(lang) {
    if (this.recognition) this.recognition.lang = lang || this.defaultLang;
  }
  startListening() {
    if (!this.recognition || this.listening) return;
    try { this.recognition.start(); } catch (e) { /* ignore */ }
  }
  stopListening() {
    if (!this.recognition) return;
    try { this.recognition.stop(); } catch (e) { /* ignore */ }
    this.listening = false;
    this.onStatus('idle');
  }

  toggleMic() {
    this.voiceOn = !this.voiceOn;
    if (this.voiceOn) {
      // barge-in: cancel any speech
      this.stopSpeaking();
      this.startListening();
    } else {
      this.stopListening();
      this.stopSpeaking();
    }
    return this.voiceOn;
  }

  // ========== TTS ==========
  _findVoiceCloseTo(lang) {
    if (!this.voices?.length) return null;
    const L = lang.toLowerCase();
    let v = this.voices.find(v => v.lang?.toLowerCase() === L);
    if (!v) v = this.voices.find(v => v.lang?.toLowerCase().startsWith(L.slice(0,2)));
    return v || this.voices[0] || null;
  }
  setTTSLanguage(lang) {
    const v = this._findVoiceCloseTo(lang);
    if (v) this.ttsVoice = v;
  }
  speak(text, { lang } = {}) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const voice = lang ? this._findVoiceCloseTo(lang) : (this.ttsVoice || this._findVoiceCloseTo('en'));
      if (voice) u.voice = voice;
      // natural rates
      u.rate = (lang && lang.startsWith('ar')) ? 0.95 : 1.05;
      u.pitch = 1.0;
      u.onstart = () => { this.speaking = true; this.onStatus('speak'); this.onSpeakStart(); };
      u.onend   = () => { this.speaking = false; this.onStatus(this.voiceOn ? 'listen' : 'idle'); this.onSpeakEnd(); if (this.voiceOn) setTimeout(()=>this.startListening(), 300); };
      window.speechSynthesis.cancel(); // barge-in friendly
      window.speechSynthesis.speak(u);
    } catch (e) { this.onError(e); }
  }
  stopSpeaking() {
    try { window.speechSynthesis.cancel(); } catch (e) {}
    this.speaking = false;
  }
}

/** Tiny language heuristic for TTS fallback */
export function detectLangHeuristic(text = '') {
  const s = text.slice(0, 160);
  if (/[اأإآء-ي]/.test(s)) return 'ar';
  if (/[а-яё]/i.test(s)) return 'ru';
  if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(s)) return 'ko';
  if (/[一-龯]/.test(s)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(s)) return 'fr';
  if (/[äöüß]/i.test(s)) return 'de';
  if (/[áéíóúñ¿¡]/i.test(s)) return 'es';
  if (/[ìòàéù]/i.test(s) && /[gl]li|che|per\b/i.test(s)) return 'it';
  return 'en';
}

/** Auto-wires to simple elements (#toggle, #vstat) and exposes agent */
export function wirePage({
  chat = new ChatClient(),
  statusEl = $('#vstat'),
  toggleBtn = $('#toggle'),
  blobEl = $('.blob'),
  historyLimit = 8
} = {}) {
  const history = [];
  const agent = new VoiceAgent({
    onStatus: (kind) => {
      statusEl.className = `status ${kind}`;
      statusEl.textContent = kind === 'listen' ? 'Listening' : (kind === 'speak' ? 'Speaking' : 'Idle');
      blobEl?.classList.remove('listening','speaking');
      if (kind === 'listen') blobEl?.classList.add('listening');
      else if (kind === 'speak') blobEl?.classList.add('speaking');
    },
    onFinalText: async (text) => {
      history.push({ role: 'user', content: text });
      try {
        const res = await chat.send(history.slice(-historyLimit));
        const reply = (res.reply || '').trim();
        const lang = res.lang || detectLangHeuristic(reply);
        history.push({ role: 'assistant', content: reply });
        agent.setTTSLanguage(lang);
        agent.speak(reply, { lang });
      } catch (e) {
        console.warn('Chat error', e);
        agent.speak('Sorry, I had trouble reaching the server.');
      } finally {
        if (agent.voiceOn) await sleep(250), agent.startListening();
      }
    },
    onError: (e) => { console.warn('Voice error', e); }
  });

  // Toggle mic
  toggleBtn?.addEventListener('click', () => {
    const on = agent.toggleMic();
    toggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') {
      e.preventDefault();
      const on = agent.toggleMic();
      toggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });

  // expose for app-level calls
  window.__voiceAgent = agent;
  return agent;
}

// Auto-wire if the page includes the same ids/classes
document.addEventListener('DOMContentLoaded', () => {
  const hasUI = $('#vstat') && $('#toggle');
  if (hasUI) wirePage();
});
