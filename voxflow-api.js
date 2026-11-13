/* VoxFlow — Kokoro TTS client.
   Wraps VoxFlow's own TTS API (see server/API.md) and turns its
   voice inventory into something the voice library can display. */

(function (global) {
  'use strict';

  /* Connection is fixed in code — there is no settings UI. The server serves
     this page itself, so an empty base means "same origin". Point BASE at an
     absolute URL (e.g. 'http://127.0.0.1:8890') only when VoxFlow is hosted
     somewhere other than the TTS server.
     Note: TOKEN ships to the browser and is readable by anyone who loads the
     page; keep the server bound to a trusted network. */
  var DEFAULT_BASE = '';
  var DEFAULT_TOKEN = 'cfc294cdc7b4fb459afe624eb8bb05c713c02c5475d5ae16';
  var MAX_TEXT = 5000;             // server: KOKORO_MAX_TEXT_LENGTH
  var EDGE_VOICE = 'edge:auto';

  /* Kokoro voice ids encode their language in the first letter and the
     speaker's gender in the second: af_sarah = (a)merican (f)emale.
     The server groups them by language already, so the prefix is only
     used for gender and for a sensible display name. */
  var GENDER = { f: 'Female', m: 'Male' };

  var LANGS = {
    'en-us': { label: 'English (US)', short: 'EN-US' },
    'en-gb': { label: 'English (UK)', short: 'EN-GB' },
    'fr-fr': { label: 'French', short: 'FR' },
    'it':    { label: 'Italian', short: 'IT' },
    'ja':    { label: 'Japanese', short: 'JA' },
    'cmn':   { label: 'Chinese (Mandarin)', short: 'ZH' },
    'es':    { label: 'Spanish', short: 'ES' },
    'hi':    { label: 'Hindi', short: 'HI' },
    'pt-br': { label: 'Portuguese (BR)', short: 'PT' }
  };

  /* Base codes the online (edge) voice can reach. Only used to label the
     extra languages that /api/voices reports under online_languages. */
  var ONLINE_LANGS = {
    af: 'Afrikaans', am: 'Amharic', ar: 'Arabic', az: 'Azerbaijani',
    bg: 'Bulgarian', bn: 'Bengali', bs: 'Bosnian', ca: 'Catalan',
    cs: 'Czech', cy: 'Welsh', da: 'Danish', de: 'German', el: 'Greek',
    en: 'English', es: 'Spanish', et: 'Estonian', fa: 'Persian',
    fi: 'Finnish', fil: 'Filipino', fr: 'French', ga: 'Irish',
    gl: 'Galician', gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi',
    hr: 'Croatian', hu: 'Hungarian', id: 'Indonesian', is: 'Icelandic',
    it: 'Italian', iu: 'Inuktitut', ja: 'Japanese', jv: 'Javanese',
    ka: 'Georgian', kk: 'Kazakh', km: 'Khmer', kn: 'Kannada',
    ko: 'Korean', lo: 'Lao', lt: 'Lithuanian', lv: 'Latvian',
    mk: 'Macedonian', ml: 'Malayalam', mn: 'Mongolian', mr: 'Marathi',
    ms: 'Malay', mt: 'Maltese', my: 'Burmese', nb: 'Norwegian',
    ne: 'Nepali', nl: 'Dutch', pl: 'Polish', ps: 'Pashto',
    pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', si: 'Sinhala',
    sk: 'Slovak', sl: 'Slovenian', so: 'Somali', sq: 'Albanian',
    sr: 'Serbian', su: 'Sundanese', sv: 'Swedish', sw: 'Swahili',
    ta: 'Tamil', te: 'Telugu', th: 'Thai', tr: 'Turkish',
    uk: 'Ukrainian', ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese',
    zh: 'Chinese', zu: 'Zulu'
  };

  /* Descriptive tags, so the library's filter chips mean something.
     Keyed by voice id; anything unlisted just shows its language. */
  var TAGS = {
    af_bella: ['Warm', 'Narration'], af_heart: ['Warm', 'Conversational'],
    af_nicole: ['Soft', 'Audiobook'], af_sarah: ['Bright', 'Conversational'],
    af_sky: ['Bright', 'Young'], af_nova: ['Clean', 'Explainer'],
    af_aoede: ['Calm', 'Narration'], af_kore: ['Measured', 'Documentary'],
    af_alloy: ['Neutral', 'Clean'], af_jessica: ['Conversational'],
    af_river: ['Calm', 'Soft'],
    am_adam: ['Deep', 'Narration'], am_michael: ['Deep', 'Warm'],
    am_onyx: ['Deep', 'Formal'], am_fenrir: ['Deep', 'Energetic'],
    am_echo: ['Clean', 'Explainer'], am_eric: ['Bright', 'Conversational'],
    am_liam: ['Young', 'Energetic'], am_puck: ['Energetic', 'Ads'],
    bf_alice: ['British', 'Calm'], bf_emma: ['British', 'Audiobook'],
    bf_isabella: ['British', 'Formal'], bf_lily: ['British', 'Soft'],
    bm_daniel: ['British', 'Deep'], bm_fable: ['British', 'Narration'],
    bm_george: ['British', 'Formal'], bm_lewis: ['British', 'Deep'],
    ff_siwis: ['Soft', 'Conversational'],
    if_sara: ['Warm', 'Conversational'], im_nicola: ['Deep', 'Narration'],
    jf_alpha: ['Clean', 'Explainer'], jf_gongitsune: ['Calm', 'Audiobook'],
    jf_nezumi: ['Soft', 'Young'], jf_tebukuro: ['Bright'],
    jm_kumo: ['Deep', 'Measured'],
    ef_dora: ['Warm', 'Conversational'], em_alex: ['Bright', 'Narration'],
    em_santa: ['Deep', 'Warm'],
    hf_alpha: ['Bright', 'Conversational'], hf_beta: ['Calm', 'Narration'],
    hm_omega: ['Deep', 'Formal'], hm_psi: ['Measured', 'Explainer'],
    zf_xiaobei: ['Bright'], zf_xiaoni: ['Soft'], zf_xiaoxiao: ['Conversational'],
    zf_xiaoyi: ['Young'], zm_yunjian: ['Deep', 'Narration'],
    zm_yunxi: ['Clean'], zm_yunxia: ['Bright'], zm_yunyang: ['Formal', 'Deep']
  };

  /* Shown when the API can't be reached, so the library is never empty.
     These are the real Kokoro ids, not invented ones. */
  var FALLBACK = {
    'en-us': ['af_sarah', 'af_bella', 'af_nicole', 'am_adam', 'am_michael', 'am_onyx'],
    'en-gb': ['bf_emma', 'bf_alice', 'bm_daniel', 'bm_george'],
    'fr-fr': ['ff_siwis'],
    'es': ['ef_dora', 'em_alex'],
    'hi': ['hf_alpha', 'hm_omega'],
    'it': ['if_sara', 'im_nicola'],
    'ja': ['jf_alpha', 'jm_kumo'],
    'cmn': ['zf_xiaoxiao', 'zm_yunjian']
  };

  function titleCase(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  /* af_sarah -> Sarah;  zm_yunjian -> Yunjian;  edge:auto -> Auto */
  function displayName(id) {
    var stem = id.indexOf('_') > -1 ? id.slice(id.indexOf('_') + 1) : id;
    return stem.split(/[-_\s]/).map(titleCase).join(' ');
  }

  function genderOf(id) {
    var prefix = id.split('_')[0];
    return GENDER[prefix.charAt(1)] || 'Neutral';
  }

  function langMeta(code) {
    if (LANGS[code]) return LANGS[code];
    var base = code.split('-')[0];
    var label = ONLINE_LANGS[base] || code.toUpperCase();
    return { label: label, short: code.toUpperCase() };
  }

  /* A stable hue per voice so an avatar keeps its colour between loads. */
  function hueOf(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  }

  function buildVoice(id, lang) {
    var meta = langMeta(lang);
    return {
      id: id,
      name: displayName(id),
      lang: lang,
      langLabel: meta.label,
      langShort: meta.short,
      gender: genderOf(id),
      tags: TAGS[id] ? TAGS[id].slice() : [],
      hue: hueOf(id),
      online: false
    };
  }

  /* The online voice is one id that covers many languages, so it is
     expanded into one selectable entry per language. */
  function buildOnlineVoices(codes) {
    return codes.map(function (code) {
      var meta = langMeta(code);
      return {
        id: EDGE_VOICE,
        key: EDGE_VOICE + ':' + code,
        name: meta.label,
        lang: code,
        langLabel: meta.label,
        langShort: meta.short,
        gender: 'Auto',
        tags: ['Online', 'Multilingual'],
        hue: hueOf(code + 'edge'),
        online: true
      };
    });
  }

  function flatten(groups) {
    var out = [];
    Object.keys(groups).sort().forEach(function (lang) {
      (groups[lang] || []).forEach(function (id) {
        out.push(buildVoice(id, lang));
      });
    });
    return out;
  }

  function Client(options) {
    options = options || {};
    this.base = (options.base || DEFAULT_BASE).replace(/\/+$/, '');
    this.token = options.token || DEFAULT_TOKEN;
  }

  Client.prototype.url = function (path) {
    return this.base + path;
  };

  Client.prototype.headers = function (extra) {
    var h = extra || {};
    if (this.token) h['X-Kokoro-Key'] = this.token;
    return h;
  };

  /* GET /api/health — also tells us whether the online voice is installed. */
  Client.prototype.health = function () {
    return fetch(this.url('/api/health'), { method: 'GET' })
      .then(function (r) {
        if (!r.ok) throw new Error('Health check returned ' + r.status);
        return r.json();
      });
  };

  /* GET /api/voices — the real inventory, grouped by language. */
  Client.prototype.voices = function () {
    var self = this;
    return fetch(this.url('/api/voices'), { method: 'GET' })
      .then(function (r) {
        if (!r.ok) throw new Error('Voice list returned ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var list = flatten(data.voices || {});
        var online = [];
        if (data.online_voice && (data.online_languages || []).length) {
          online = buildOnlineVoices(data.online_languages);
        }
        return {
          voices: list,
          online: online,
          defaultVoice: data.default_voice || 'af_sarah',
          defaultLanguage: data.default_language || 'en-us',
          live: true
        };
      })
      .catch(function (err) {
        self.lastError = err;
        return {
          voices: flatten(FALLBACK),
          online: [],
          defaultVoice: 'af_sarah',
          defaultLanguage: 'en-us',
          live: false,
          error: err.message
        };
      });
  };

  /* POST /api/tts — returns a complete audio file as a Blob.
     `stream` uses /api/tts/stream, which starts returning audio sooner;
     the online voice is download-only, so it never streams. */
  Client.prototype.synthesize = function (opts) {
    var self = this;
    var text = (opts.text || '').trim();
    if (!text) return Promise.reject(new Error('Nothing to say — the script is empty.'));
    if (text.length > MAX_TEXT) {
      return Promise.reject(new Error('Script is ' + text.length.toLocaleString() +
        ' characters; the limit is ' + MAX_TEXT.toLocaleString() + '.'));
    }

    var voice = opts.voice || 'af_sarah';
    var streaming = opts.stream && voice !== EDGE_VOICE;
    var path = streaming ? '/api/tts/stream' : '/api/tts';
    var body = {
      text: text,
      voice: voice,
      language: opts.language || 'en-us',
      speed: Math.min(2, Math.max(0.5, Number(opts.speed) || 1)),
      format: opts.format === 'mp3' ? 'mp3' : 'wav'
    };

    return fetch(this.url(path), {
      method: 'POST',
      headers: self.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: opts.signal
    }).then(function (r) {
      if (r.ok) return r.blob();
      return r.json()
        .catch(function () { return { error: 'Request failed with ' + r.status }; })
        .then(function (payload) {
          var message = payload.error || ('Request failed with ' + r.status);
          if (r.status === 401) message = 'The server rejected the built-in access token.';
          if (r.status === 500 && /cli|model/i.test(message)) {
            message = 'The server could not synthesize — its Kokoro CLI or model files look missing.';
          }
          var err = new Error(message);
          err.status = r.status;
          throw err;
        });
    });
  };

  global.VoxFlowAPI = {
    Client: Client,
    MAX_TEXT: MAX_TEXT,
    EDGE_VOICE: EDGE_VOICE,
    displayName: displayName,
    langMeta: langMeta,
    hueOf: hueOf
  };
})(window);
