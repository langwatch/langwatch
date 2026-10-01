---
name: voicesim
description: "Run ElevenLabs voice calls locally against voicesim, haven's voice-provider stand-in. Use when someone says 'voicesim', 'haven up +voice', 'test a voice agent without ElevenLabs', 'signed URL', 'convai socket', 'fake ElevenLabs', 'voice call console', or needs a deterministic voice call in a test."
user-invocable: true
---

# voicesim

Fakes ElevenLabs Conversational AI (the signed-URL mint and the conversation socket) and
OpenAI's `pcm` speech and transcription. Every answer is canned: tones for audio, four
scripted agent lines, one fixed caller transcript. Keys are accepted and never checked: a dev
shim, never expose it. Code: `services/voicesim`, console `apps/voicesim-web`.

## Run it

- Opt-in: `haven up +voice` (sticky). Hosted in the `sims` lane.
- Console: `https://voice.<slug>.langwatch.localhost`; `haven status` shows the loopback port.
- Unless `.env` names `ELEVENLABS_BASE_URL`, the overlay sets it to `http://127.0.0.1:<port>`,
  a dummy `ELEVENLABS_API_KEY` when none is set, and `VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS=1`.
- The seed then stores the ElevenLabs provider row at voicesim. Standalone:
  `make service svc=voicesim` (:5591).

## The dev switch

`VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS` (`packages/config/src/deployment-facts.ts`) is the only
thing that lets the product call a loopback voice host. One rule decides it,
`isAllowedElevenLabsUrl` in `@langwatch/model-provider-contract`, used by the seed's keys
schema, the gateway's credential read and the signed-URL check. On, it admits `http`/`ws` on
`127.0.0.1` or `localhost` with an explicit port, nothing else. Off (every production
process), those three points refuse loopback. The registry schema never carries the switch, so
the settings form still refuses a loopback base URL.

OpenAI audio is not redirected: the product has no audio-only OpenAI base URL, and
`OPENAI_BASE_URL` would move every model call.

## Inspect and assert

```
GET /_sim/api/calls     # newest first: turns, frame counts, protocol events
GET /_sim/api/status    # stack, call count, the base URLs to point a provider at
GET /v1/convai/conversation/get-signed-url?agent_id=<id>
POST /v1/audio/speech   POST /v1/audio/transcriptions
```

A call id is `conv_voicesim_0001`, `0002`, ... An unfaked provider path answers 404.

## Seed and reset

- `VOICESIM_SEED=1` (haven sets it) records one finished two-turn call for agent
  `agent_voicesim_seed`, so the console starts with content.
- Nothing persists: a restart (`haven restart sims`) empties it.

## Tests and load

- Caps: `VOICESIM_MAX_CALLS` (default 200, oldest dropped) and `VOICESIM_MAX_EVENTS_PER_CALL`
  (default 500, the rest counted as `droppedEvents`).
- Drive the loopback port directly; `go test ./services/voicesim` covers the protocol.
- The Twilio phone transport is not faked.
