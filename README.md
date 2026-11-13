# VoxFlow

Text to speech studio — a self-contained web app with multiple voices and
language support, built on the Kokoro TTS engine.

Everything VoxFlow needs lives in this folder: the UI, the API server, and the
setup script that fetches the engine and its models. It does not depend on
anything outside `voxflow/`.

Built from the `VoxFlow.dc.html` / `VoxFlow Dark.dc.html` design canvases.

## Quick start

```bash
cd voxflow/server
./setup.sh              # installs the CLI, downloads models, writes .env
python3 server.py
```

Open <http://127.0.0.1:8890>. That's it — the server serves both the API and
the UI, so there is no second process to run.

The server URL and access token are hardcoded near the top of
`voxflow-api.js` (`DEFAULT_BASE` and `DEFAULT_TOKEN`); there is no settings
screen. If `setup.sh` generated a new token, copy it from `server/.env` into
`DEFAULT_TOKEN`.

`./setup.sh --with-online` additionally installs the online multilingual voice
(`edge:auto`), which reaches roughly 75 more languages over the internet.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `voxflow.css` | Design tokens and layout, light and dark |
| `voxflow-api.js` | API client and voice-catalog handling |
| `voxflow-app.js` | Application logic and DOM wiring |
| `server/server.py` | The TTS API; also serves the UI on `GET /` |
| `server/setup.sh` | Installs the CLI, models and configuration |
| `server/API.md` | Full API reference |
| `server/.env.example` | Every configuration option |
| `server/edge_tts_helper.py` | Adapter for the optional online voice |

The frontend has no build step and no dependencies. Space Grotesk and IBM Plex
Sans load from Google Fonts; everything else is local.

## Running the UI separately

The UI is a static page, so it can also be served on its own and pointed at a
TTS server elsewhere:

```bash
cd voxflow
python3 -m http.server 8181
```

Because the page is no longer served by the TTS server, set `DEFAULT_BASE` in
`voxflow-api.js` to an absolute URL (for example `http://127.0.0.1:8890`).
Note that port 8000 is often already taken — check before using it.

## What it does

- **Voices and languages** come from `GET /api/voices`, so the library shows
  the engine's real inventory — 50 voices across US and UK English, French,
  Italian, Japanese, Mandarin, Spanish and Hindi. Voice IDs are decoded into
  readable entries: `af_sarah` becomes *Sarah · EN-US · Female*. Search matches
  names, languages, genders and style tags; the language dropdown and filter
  chips narrow the list.
- **The online voice**, when installed, appears as *Online*-badged entries —
  one per language — covering about 75 more languages. These are download-only
  and never stream.
- **Generate** sends the script to `POST /api/tts/stream` (or `/api/tts` when
  streaming is off, or for an online voice) and plays the result. The waveform
  tracks playback and is click-to-seek; Download and Export save the MP3.
- **Preview** on a voice card synthesizes a short line in that voice.
- **Theme** follows the two source designs, and the choice is remembered.

Theme, speed, pitch and the selected voice persist in `localStorage`. The
connection is fixed in code and is not stored there.

## Two deliberate differences from the mockup

**Pitch is applied on playback, not in synthesis.** `POST /api/tts` accepts
only `text`, `voice`, `language`, `speed` and `format`; Kokoro has no pitch
parameter. Rather than send a value the server would ignore, the slider shifts
`playbackRate` with pitch preservation disabled, and the control says so.
Speed is genuine — it is passed to the API and rendered server-side.

**The voice list is real, not the mockup's.** The design shows eleven invented
voices (Marcus, Imogen…). Those names do not exist in Kokoro, so the library is
driven by the live catalog. If the server cannot be reached, it falls back to a
built-in list of real Kokoro IDs and says so, rather than rendering empty.

## Security

`server/.env` holds your API token and is gitignored, along with the model
files and the online-voice virtualenv.

When the UI is served by this server they share an origin, so the token stays
between your browser and your own machine. If you host the page elsewhere, the
token travels to the browser where any visitor can read it — in that case put
the API behind your own backend and keep the token there.

## Relationship to `kokoro-web/`

`server/` began as a copy of `kokoro-web/server.py`, adapted to stand alone:
it serves VoxFlow's assets instead of the older UI, resolves paths relative to
itself, and requires `KOKORO_API_TOKEN` rather than falling back to an
external OpenClaw config. The two are now independent — fixes to one do not
reach the other.

## Requirements

**Python 3.10–3.13**, and either `uv` or `pipx` for `setup.sh` to install the
CLI. The model files are about 350 MB and download once. Limits enforced in
both the UI and the server: 5,000 characters per request, speed 0.5x–2.0x.

The Python version matters. The engine's dependency chain
(`onnxruntime` → `numba` → `llvmlite`) is distributed as pre-built wheels, and
those wheels do not exist for every Python and platform:

- **Python 3.14 has no wheels at all.** Installation falls back to building
  `llvmlite` from source, which needs an LLVM toolchain and usually fails.
- **Intel macOS** is supported only up to `onnxruntime` 1.23.2 and
  `llvmlite` 0.45; newer releases ship arm64 wheels only.

`constraints.txt` pins the newest combination that installs as wheels, and
`setup.sh` applies it while preferring the highest supported interpreter it
finds. If you install the CLI by hand, use the same constraints:

```bash
uv tool install --python python3.13 -c constraints.txt kokoro-tts
```

`~/.local/bin` must be on your `PATH` for the server to find `kokoro-tts`.
