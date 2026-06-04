# svc_noai

## Description

NoAI is a **local-development-only** fake OpenAI-compatible LLM. It returns
deterministic, hard-coded responses with no calls to any external provider.
Use it for testing flows, evaluators, simulators, and integration tests
without burning API keys or budget.

It speaks two OpenAI surfaces:

- `POST /v1/chat/completions` (with `stream: true` SSE support)
- `POST /v1/responses` (with `stream: true` SSE support)

…plus the standard health probes.

## Model family

All model ids live under the `langwatch_noai/` namespace (also matched bare).

| Model id                             | Behaviour                                                 |
|--------------------------------------|-----------------------------------------------------------|
| `langwatch_noai/echo-text`           | text in → `Fake LLM Response to: "<input>"`               |
| `langwatch_noai/echo-audio`          | text/audio in → echo text **plus** an `audio/wav` output  |
| `langwatch_noai/judge-text-pass`     | text in → JSON `{"passed": true,  "score": 1, …}`         |
| `langwatch_noai/judge-text-fail`     | text in → JSON `{"passed": false, "score": 0, …}`         |
| `langwatch_noai/judge-audio-pass`    | text/audio in → JSON pass verdict                         |
| `langwatch_noai/judge-audio-fail`    | text/audio in → JSON fail verdict                         |
| `langwatch_noai/user-simulation-text`| text in → deterministic next-user utterance               |
| `langwatch_noai/user-simulation-audio`| text/audio in → next-user utterance + `audio/wav` output |

Audio outputs are a 44-byte silent-WAV stub — recognisable as `audio/wav` by
any parser without us shipping a binary asset.

## Base URL

`http://localhost:5577/`

## Endpoints

| Method | Path                       | Purpose                                          |
|--------|----------------------------|--------------------------------------------------|
| `POST` | `/v1/chat/completions`     | OpenAI chat completion (stream-capable)          |
| `POST` | `/v1/responses`            | OpenAI Responses API (stream-capable)            |
| `GET`  | `/v1/models`               | Lists every noai model                           |
| `GET`  | `/healthz`                 | Liveness probe (always 200)                      |
| `GET`  | `/readyz`                  | Readiness probe (always 200)                     |

## Running locally

```bash
make service svc=noai             # run once
make service-watch svc=noai       # live reload via air
```

The service listens on `NOAI_SERVER_ADDR` (default `:5577`).

## Configuration

| Variable                  | Required | Default | Description                |
|---------------------------|----------|---------|----------------------------|
| `NOAI_SERVER_ADDR`        | no       | `:5577` | Listen address             |
| `NOAI_GRACEFUL_SECONDS`   | no       | `5`     | Shutdown grace period      |
| `LOG_LEVEL`               | no       | `info`  | Log level                  |
| `LOG_FORMAT`              | no       | `json`  | `json` or `pretty`         |

## Wiring into the platform

The matching TS provider entry lives in
`langwatch/src/server/modelProviders/registry.ts` under the key
`langwatch_noai`, with `devOnly: true` so it is filtered out of the registry
seeder and the UI in production. The provider exposes
`LANGWATCH_NOAI_BASE_URL` as an endpoint override — point it at this
service's URL (default `http://localhost:5577`) and every part of the
platform — playground, workflows, evaluators, scenarios, gateway — treats it
as an ordinary OpenAI-compatible upstream.
