/* VoxFlow — app logic.
   Binds the voice library and script editor to the Kokoro API. The server
   URL and access token are fixed in voxflow-api.js — there is no settings UI. */

(function () {
  'use strict';

  var API = window.VoxFlowAPI;
  var MAX = API.MAX_TEXT;
  var STORE = 'voxflow.settings';

  /* Output format for every request. MP3 (audio/mpeg) plays natively in every
     browser and is ~10x smaller than the 24 kHz WAV the server also offers. */
  var FORMAT = 'mp3';
  var FORMAT_LABEL = '24 kHz MP3';

  var SAMPLE = 'The tide came in slowly that morning, folding over the sand ' +
    'without a sound. Nobody on the pier noticed the shape moving beneath the ' +
    'water — not the fishermen, not the boy with the yellow kite, not even the ' +
    'old keeper who had watched this stretch of coast for forty-one years.';

  var FILTERS = ['All', 'Deep', 'Bright', 'British', 'Energetic', 'Narration', 'Online'];

  var el = {};
  ['statusDot', 'statusLabel', 'themeBtn', 'themeIcon', 'exportBtn',
   'script', 'wordsLabel', 'durationLabel', 'meterFill', 'countLabel',
   'sampleBtn', 'clearBtn', 'generateBtn', 'generateIcon', 'generateLabel',
   'activeAvatar', 'activeName', 'activeMeta',
   'render', 'renderPlay', 'renderTitle', 'renderMeta', 'wave', 'downloadBtn',
   'voiceCount', 'search', 'langBtn', 'langLabel', 'langCount', 'langPop',
   'filters', 'voices', 'resetBtn', 'speed', 'speedLabel', 'pitch', 'pitchLabel',
   'streamToggle', 'toast', 'player', 'preview'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  var state = {
    text: SAMPLE,
    query: '',
    filter: 'All',
    lang: 'all',
    langOpen: false,
    selected: null,
    previewLoading: null,   // key of the voice whose preview is synthesizing
    speed: 1,
    pitch: 0,
    stream: true,
    generating: false,
    previewing: null,
    theme: 'light'
  };

  var catalog = { voices: [], online: [], live: false };
  var client = null;
  var audioUrl = null;
  var previewUrl = null;
  var previewAudio = null;      // set on boot to the #preview element
  var abort = null;
  var toastTimer = null;

  /* ---------- persistence ---------- */

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      ['theme', 'speed', 'pitch', 'stream', 'selected', 'lang'].forEach(function (k) {
        if (saved[k] !== undefined && saved[k] !== null) state[k] = saved[k];
      });
    } catch (e) { /* first run, or storage blocked */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        theme: state.theme,
        speed: state.speed, pitch: state.pitch, stream: state.stream,
        selected: state.selected, lang: state.lang
      }));
    } catch (e) { /* storage blocked; settings stay for this session */ }
  }

  /* ---------- helpers ---------- */

  function toast(message, kind) {
    el.toast.textContent = message;
    el.toast.setAttribute('data-kind', kind || 'info');
    el.toast.setAttribute('data-show', 'true');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.setAttribute('data-show', 'false');
    }, kind === 'error' ? 6000 : 3200);
  }

  function allVoices() {
    return catalog.voices.concat(catalog.online);
  }

  function keyOf(v) { return v.key || v.id; }

  function activeVoice() {
    var list = allVoices();
    var found = list.filter(function (v) { return keyOf(v) === state.selected; })[0];
    return found || list[0] || null;
  }

  function paintAvatar(node, voice, initial) {
    node.style.setProperty('--hue', voice ? voice.hue : 258);
    node.style.setProperty('--hue2', voice ? (voice.hue + 38) % 360 : 296);
    node.textContent = initial;
  }

  function svg(paths, opts) {
    opts = opts || {};
    return '<svg width="' + (opts.size || 15) + '" height="' + (opts.size || 15) +
      '" viewBox="0 0 24 24" fill="' + (opts.fill || 'none') + '" stroke="' +
      (opts.stroke || 'currentColor') + '" stroke-width="' + (opts.width || 2) +
      '" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  /* ---------- language list ---------- */

  function languages() {
    var counts = {};
    allVoices().forEach(function (v) {
      counts[v.lang] = (counts[v.lang] || 0) + 1;
    });
    var codes = Object.keys(counts).sort(function (a, b) {
      return API.langMeta(a).label.localeCompare(API.langMeta(b).label);
    });
    var out = [{ code: 'all', label: 'All languages', short: 'All', count: allVoices().length }];
    codes.forEach(function (code) {
      var meta = API.langMeta(code);
      out.push({ code: code, label: meta.label, short: meta.short, count: counts[code] });
    });
    return out;
  }

  function renderLangs() {
    var langs = languages();
    var current = langs.filter(function (l) { return l.code === state.lang; })[0] || langs[0];
    el.langLabel.textContent = current.label;
    el.langCount.textContent = current.count + (current.count === 1 ? ' voice' : ' voices');
    el.langBtn.setAttribute('aria-expanded', state.langOpen ? 'true' : 'false');
    el.langPop.hidden = !state.langOpen;
    if (!state.langOpen) return;

    el.langPop.innerHTML = '';
    langs.forEach(function (l) {
      var b = document.createElement('button');
      b.className = 'vf-lang-opt';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', l.code === state.lang ? 'true' : 'false');
      b.innerHTML = '<span class="vf-lang-code">' + l.short + '</span>' +
        '<span class="vf-lang-label"></span>' +
        '<span class="vf-lang-count">' + l.count + '</span>';
      b.querySelector('.vf-lang-label').textContent = l.label;
      b.addEventListener('click', function () {
        state.lang = l.code;
        state.langOpen = false;
        save();
        renderLangs();
        renderVoices();
      });
      el.langPop.appendChild(b);
    });
  }

  /* ---------- filters ---------- */

  function renderFilters() {
    el.filters.innerHTML = '';
    FILTERS.forEach(function (f) {
      if (f === 'Online' && !catalog.online.length) return;
      var b = document.createElement('button');
      b.className = 'vf-filter';
      b.textContent = f;
      b.setAttribute('aria-pressed', state.filter === f ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.filter = f;
        renderFilters();
        renderVoices();
      });
      el.filters.appendChild(b);
    });
  }

  /* ---------- voice list ---------- */

  function matches(v) {
    if (state.filter !== 'All' && v.tags.indexOf(state.filter) === -1) return false;
    if (state.lang !== 'all' && v.lang !== state.lang) return false;
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    var hay = [v.name, v.gender, v.lang, v.langLabel, v.langShort, v.id]
      .concat(v.tags).join(' ').toLowerCase();
    return hay.indexOf(q) > -1;
  }

  function renderVoices() {
    var list = allVoices().filter(matches);
    el.voiceCount.textContent = list.length + ' of ' + allVoices().length + ' voices';
    el.voices.innerHTML = '';

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'vf-empty';
      empty.textContent = 'No voices match that search.';
      el.voices.appendChild(empty);
      return;
    }

    list.forEach(function (v) {
      var key = keyOf(v);
      var selected = key === state.selected;
      var playing = state.previewing === key;
      var loading = state.previewLoading === key;

      var card = document.createElement('div');
      card.className = 'vf-voice';
      card.setAttribute('aria-selected', selected ? 'true' : 'false');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      var avatar = document.createElement('div');
      avatar.className = 'vf-avatar vf-avatar-lg';
      paintAvatar(avatar, v, v.name.charAt(0));

      var body = document.createElement('div');
      body.className = 'vf-voice-body';

      var line = document.createElement('div');
      line.className = 'vf-voice-line';
      var name = document.createElement('span');
      name.className = 'vf-voice-name';
      name.textContent = v.name;
      var meta = document.createElement('span');
      meta.className = 'vf-voice-meta';
      meta.textContent = v.langShort + ' · ' + v.gender;
      line.appendChild(name);
      line.appendChild(meta);

      if (v.online) {
        var badge = document.createElement('span');
        badge.className = 'vf-badge';
        badge.innerHTML = svg('<circle cx="12" cy="12" r="9.5"></circle><path d="M2.5 12h19"></path>' +
          '<path d="M12 2.5a15 15 0 0 1 0 19a15 15 0 0 1 0-19z"></path>',
          { size: 9, width: 2.4 }) + '<span>Online</span>';
        badge.title = 'Rendered by the online multilingual voice';
        line.appendChild(badge);
      }

      var tags = document.createElement('div');
      tags.className = 'vf-tags';
      v.tags.forEach(function (t) {
        var tag = document.createElement('span');
        tag.className = 'vf-tag';
        tag.textContent = t;
        tags.appendChild(tag);
      });

      body.appendChild(line);
      if (v.tags.length) body.appendChild(tags);

      var preview = document.createElement('button');
      preview.className = 'vf-preview';
      preview.setAttribute('data-playing', playing ? 'true' : 'false');
      preview.setAttribute('data-loading', loading ? 'true' : 'false');
      preview.title = loading ? 'Generating preview…' : 'Preview voice';
      if (loading) {
        preview.setAttribute('aria-busy', 'true');
        preview.innerHTML = svg('<path d="M21 12a9 9 0 1 1-6.22-8.56"></path>', { size: 13, width: 2.6 })
          .replace('<svg ', '<svg class="vf-spin" ');
      } else {
        preview.innerHTML = playing
          ? svg('<rect x="5" y="5" width="14" height="14" rx="2.5"></rect>', { size: 12, fill: 'currentColor', stroke: 'none' })
          : svg('<path d="M6 3.5l14 8.5-14 8.5v-17z"></path>', { size: 13, fill: 'currentColor', stroke: 'none' });
      }
      preview.addEventListener('click', function (e) {
        e.stopPropagation();
        previewVoice(v);
      });

      var radio = document.createElement('div');
      radio.className = 'vf-radio';
      radio.innerHTML = '<i></i>';

      card.appendChild(avatar);
      card.appendChild(body);

      if (loading) {
        var load = document.createElement('div');
        load.className = 'vf-preview-loading';
        load.innerHTML = '<span></span><span></span><span></span>';
        load.title = 'Generating preview…';
        card.appendChild(load);
      } else if (playing) {
        var eq = document.createElement('div');
        eq.className = 'vf-eq';
        eq.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
        card.appendChild(eq);
      }

      card.appendChild(preview);
      card.appendChild(radio);

      function choose() {
        state.selected = key;
        save();
        renderVoices();
        renderActive();
      }
      card.addEventListener('click', choose);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      });

      el.voices.appendChild(card);
    });
  }

  /* ---------- active voice + script stats ---------- */

  function renderActive() {
    var v = activeVoice();
    if (!v) return;
    paintAvatar(el.activeAvatar, v, v.name.charAt(0));
    el.activeName.textContent = v.name;
    el.activeMeta.textContent = 'in ' + v.langLabel + ' · ' + state.speed.toFixed(2) + 'x' +
      (state.pitch ? ' · pitch ' + (state.pitch > 0 ? '+' : '') + state.pitch : '');
  }

  function renderStats() {
    var text = state.text;
    var chars = text.length;
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var secs = Math.round((words / 155) * 60 / (state.speed || 1));
    var near = chars > MAX * 0.9;

    el.wordsLabel.textContent = words.toLocaleString() + (words === 1 ? ' word' : ' words');
    el.durationLabel.textContent = '~' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    el.countLabel.textContent = chars.toLocaleString() + ' / ' + MAX.toLocaleString() + ' characters';
    el.countLabel.setAttribute('data-near', near ? 'true' : 'false');
    el.meterFill.style.width = Math.min(100, (chars / MAX) * 100) + '%';
    el.meterFill.setAttribute('data-near', near ? 'true' : 'false');
    el.generateBtn.disabled = !text.trim() || state.generating;
  }

  /* ---------- waveform ---------- */

  function renderWave(progress) {
    var bars = el.wave.children;
    if (!bars.length) {
      var html = '';
      for (var i = 0; i < 56; i++) {
        var h = 22 + Math.abs(Math.sin(i * 0.7)) * 62 + (i % 3) * 8;
        html += '<div class="vf-wave-bar" style="height:' + h + '%"></div>';
      }
      el.wave.innerHTML = html;
      bars = el.wave.children;
    }
    var lead = Math.round((progress || 0) * bars.length);
    for (var j = 0; j < bars.length; j++) {
      bars[j].setAttribute('data-lead', j < lead ? 'true' : 'false');
    }
  }

  /* ---------- synthesis ---------- */

  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.removeAttribute('src');
    }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    state.previewing = null;
    state.previewLoading = null;
  }

  function applyPlaybackPitch(audio) {
    /* Kokoro has no pitch parameter, so the slider shifts playback rate.
       Speed is already rendered server-side, so rate starts at 1. */
    if (!audio) return;
    audio.preservesPitch = false;
    if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = false;
    if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = false;
    audio.playbackRate = Math.pow(2, state.pitch / 12);
  }

  /* Autoplay policies only grant playback to an element the user has just
     interacted with, and synthesis takes seconds — by the time the blob
     arrives the click no longer counts as a gesture. Calling play() while
     still inside the click consumes that gesture and unblocks the later
     play() on the same element, so the preview is actually audible. */
  function unlockPreview() {
    if (!previewAudio) return;
    previewAudio.muted = false;
    previewAudio.volume = 1;
    var p = previewAudio.play();
    if (p && p.catch) p.catch(function () { /* nothing loaded yet; expected */ });
    previewAudio.pause();
  }

  function previewVoice(v) {
    var key = keyOf(v);
    /* A second click cancels, whether it is still generating or already
       playing, so the spinner is never a dead end. */
    if (state.previewing === key || state.previewLoading === key) {
      stopPreview();
      renderVoices();
      return;
    }
    stopPreview();
    unlockPreview();

    /* Synthesis takes a couple of seconds; the card shows a spinner until
       the audio actually starts, rather than claiming to play immediately. */
    state.previewLoading = key;
    renderVoices();

    var line = 'Hello, I am ' + v.name + '. This is how I sound.';
    client.synthesize({
      text: line, voice: v.id, language: v.lang,
      speed: state.speed, format: FORMAT, stream: false
    }).then(function (blob) {
      if (state.previewLoading !== key) return;   // superseded or cancelled
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      previewAudio.src = previewUrl;
      previewAudio.muted = false;
      previewAudio.volume = 1;
      applyPlaybackPitch(previewAudio);
      state.previewLoading = null;
      state.previewing = key;
      renderVoices();
      return previewAudio.play();
    }).catch(function (err) {
      if (state.previewLoading === key || state.previewing === key) {
        state.previewLoading = null;
        state.previewing = null;
        renderVoices();
      }
      if (err && err.name === 'NotAllowedError') {
        toast('Your browser blocked preview playback \u2014 click the card again.', 'error');
        return;
      }
      if (err) toast(err.message, 'error');
    });
  }

  function setGenerating(on) {
    state.generating = on;
    el.generateBtn.setAttribute('data-busy', on ? 'true' : 'false');
    el.generateLabel.textContent = on ? 'Generating audio…' : 'Generate Full Audio';
    el.generateIcon.innerHTML = on
      ? svg('<path d="M21 12a9 9 0 1 1-6.22-8.56"></path>', { size: 17, width: 2.4 })
        .replace('<svg ', '<svg class="vf-spin" ')
      : svg('<path d="M5 3l14 9-14 9V3z"></path>', { size: 17, fill: 'currentColor', stroke: 'none' });
    renderStats();
  }

  function generate() {
    if (state.generating) {
      if (abort) abort.abort();
      return;
    }
    var v = activeVoice();
    if (!v) { toast('No voice is selected yet.', 'error'); return; }
    if (!state.text.trim()) { toast('The script is empty.', 'error'); return; }

    stopPreview();
    renderVoices();
    setGenerating(true);
    abort = new AbortController();

    client.synthesize({
      text: state.text, voice: v.id, language: v.lang,
      speed: state.speed, format: FORMAT,
      stream: state.stream, signal: abort.signal
    }).then(function (blob) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob);
      el.player.src = audioUrl;
      applyPlaybackPitch(el.player);
      el.render.hidden = false;
      el.exportBtn.disabled = false;
      el.renderTitle.textContent = v.name + ' — full render';
      renderWave(0);
      setGenerating(false);
      el.player.play().catch(function () { /* autoplay blocked; the button works */ });
      toast('Audio ready.');
    }).catch(function (err) {
      setGenerating(false);
      if (err.name === 'AbortError') { toast('Generation cancelled.'); return; }
      toast(err.message, 'error');
    });
  }

  el.player.addEventListener('timeupdate', function () {
    if (el.player.duration) {
      renderWave(el.player.currentTime / el.player.duration);
      var total = Math.round(el.player.duration);
      el.renderMeta.textContent = Math.floor(total / 60) + ':' +
        String(total % 60).padStart(2, '0') + ' · ' + FORMAT_LABEL;
    }
  });

  /* Drive the button from the element's own events, so it stays correct
     however playback changes — button, autoplay after generate, the
     keyboard, or reaching the end. */
  function renderPlayButton() {
    var playing = !el.player.paused && !el.player.ended;
    el.renderPlay.setAttribute('data-playing', playing ? 'true' : 'false');
    el.renderPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    el.renderPlay.title = playing ? 'Pause' : 'Play';
    el.renderPlay.innerHTML = playing
      ? svg('<rect x="5" y="4" width="4.5" height="16" rx="1.5"></rect>' +
            '<rect x="14.5" y="4" width="4.5" height="16" rx="1.5"></rect>',
            { size: 15, fill: 'currentColor', stroke: 'none' })
      : svg('<path d="M5 3l14 9-14 9V3z"></path>',
            { size: 15, fill: 'currentColor', stroke: 'none' });
  }

  el.player.addEventListener('play', renderPlayButton);
  el.player.addEventListener('pause', renderPlayButton);
  el.player.addEventListener('ended', function () {
    renderWave(1);
    renderPlayButton();
  });

  function download() {
    if (!audioUrl) { toast('Generate some audio first.', 'error'); return; }
    var v = activeVoice();
    var a = document.createElement('a');
    a.href = audioUrl;
    a.download = 'voxflow-' + (v ? v.name.toLowerCase().replace(/\s+/g, '-') : 'render') + '.' + FORMAT;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ---------- connection ---------- */

  function connect() {
    client = new API.Client();

    client.health().then(function (h) {
      if (h.cli_present) {
        el.statusDot.setAttribute('data-state', 'ok');
        el.statusLabel.textContent = h.online_tts_present ? 'Connected · online voice ready' : 'Connected';
      } else {
        el.statusDot.setAttribute('data-state', 'offline');
        el.statusLabel.textContent = 'Server up, engine missing';
      }
    }).catch(function () {
      el.statusDot.setAttribute('data-state', 'down');
      el.statusLabel.textContent = 'Server unreachable';
    });

    return client.voices().then(function (data) {
      catalog = data;
      if (!data.live) {
        toast('Could not reach the TTS server — showing the built-in voice list.', 'error');
      }
      var keys = allVoices().map(keyOf);
      if (!state.selected || keys.indexOf(state.selected) === -1) {
        state.selected = keys.indexOf(data.defaultVoice) > -1 ? data.defaultVoice : keys[0];
      }
      renderFilters();
      renderLangs();
      renderVoices();
      renderActive();
    });
  }

  /* ---------- theme ---------- */

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    el.themeIcon.innerHTML = state.theme === 'dark'
      ? '<circle cx="12" cy="12" r="4.5"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.2 4.2l1.4 1.4"></path><path d="M18.4 18.4l1.4 1.4"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.2 19.8l1.4-1.4"></path><path d="M18.4 5.6l1.4-1.4"></path>'
      : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>';
  }

  /* ---------- wiring ---------- */

  el.script.addEventListener('input', function () {
    state.text = el.script.value.slice(0, MAX);
    if (el.script.value.length > MAX) el.script.value = state.text;
    renderStats();
  });

  el.sampleBtn.addEventListener('click', function () {
    state.text = SAMPLE;
    el.script.value = SAMPLE;
    renderStats();
  });

  el.clearBtn.addEventListener('click', function () {
    state.text = '';
    el.script.value = '';
    renderStats();
    el.script.focus();
  });

  el.search.addEventListener('input', function () {
    state.query = el.search.value;
    renderVoices();
  });

  el.langBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    state.langOpen = !state.langOpen;
    renderLangs();
  });

  document.addEventListener('click', function (e) {
    if (state.langOpen && !el.langPop.contains(e.target) && e.target !== el.langBtn) {
      state.langOpen = false;
      renderLangs();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.langOpen) { state.langOpen = false; renderLangs(); }
  });

  el.speed.addEventListener('input', function () {
    state.speed = parseFloat(el.speed.value);
    el.speedLabel.textContent = state.speed.toFixed(2) + 'x';
    save();
    renderStats();
    renderActive();
  });

  el.pitch.addEventListener('input', function () {
    state.pitch = parseInt(el.pitch.value, 10);
    el.pitchLabel.textContent = (state.pitch > 0 ? '+' : '') + state.pitch + ' st';
    save();
    renderActive();
    applyPlaybackPitch(el.player);
    applyPlaybackPitch(previewAudio);
  });

  el.resetBtn.addEventListener('click', function () {
    state.speed = 1;
    state.pitch = 0;
    el.speed.value = '1';
    el.pitch.value = '0';
    el.speedLabel.textContent = '1.00x';
    el.pitchLabel.textContent = '0 st';
    save();
    renderStats();
    renderActive();
    applyPlaybackPitch(el.player);
  });

  el.streamToggle.addEventListener('click', function () {
    state.stream = !state.stream;
    el.streamToggle.setAttribute('aria-checked', state.stream ? 'true' : 'false');
    save();
  });

  el.themeBtn.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    save();
    applyTheme();
  });

  el.generateBtn.addEventListener('click', generate);
  el.downloadBtn.addEventListener('click', download);
  el.exportBtn.addEventListener('click', download);

  el.renderPlay.addEventListener('click', function () {
    if (el.player.paused) {
      applyPlaybackPitch(el.player);
      el.player.play().catch(function () {});
    } else {
      el.player.pause();
    }
  });

  el.wave.addEventListener('click', function (e) {
    if (!el.player.duration) return;
    var box = el.wave.getBoundingClientRect();
    el.player.currentTime = ((e.clientX - box.left) / box.width) * el.player.duration;
  });

  /* ---------- boot ---------- */

  previewAudio = el.preview;
  previewAudio.addEventListener('ended', function () {
    stopPreview();
    renderVoices();
  });

  load();
  applyTheme();
  el.script.value = state.text;
  el.speed.value = String(state.speed);
  el.pitch.value = String(state.pitch);
  el.speedLabel.textContent = state.speed.toFixed(2) + 'x';
  el.pitchLabel.textContent = (state.pitch > 0 ? '+' : '') + state.pitch + ' st';
  el.streamToggle.setAttribute('aria-checked', state.stream ? 'true' : 'false');
  renderStats();
  renderWave(0);
  renderPlayButton();
  connect();
})();
