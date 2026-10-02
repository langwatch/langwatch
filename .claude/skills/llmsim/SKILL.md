---
name: llmsim
description: "Answer every LLM call for free and deterministically with llmsim, haven's provider stand-in. Use when someone says 'run without a real model', 'no API key', 'cheap playground', 'llmsim', 'haven up +llm', 'force a 429', 'mock the LLM', 'Langy echo', or needs repeatable model output in a test or load run."
user-invocable: true
---

# llmsim

Answers OpenAI chat completions, embeddings and models and Anthropic messages from a
seeded Markov chain: the same prompt gets the same answer, at no cost. Code:
`services/llmsim`, console `apps/llmsim-web`.

## Run it

- Opt-in: `haven up +llm` (sticky). Hosted in the `sims` lane.
- Console: `https://llm.<slug>.langwatch.localhost`; `haven status` shows the loopback
  port for drivers (`POST /v1/chat/completions`, `/v1/messages`, `/v1/embeddings`).
- Overlay sets `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and dummy keys, so the seeded
  providers, playground, evaluators, scenarios and Langy reach it. A base URL `.env`
  names wins. Standalone: `make service svc=llmsim` (:5595).

## Steer a call

- Models: `markov-small`, `markov-json`, `langy-echo`, `text-embedding-llmsim`; any name works.
- `canned-hello`, `canned-ok`, `canned-json` return that fixed text for every prompt.
- `error-429` / `error-500` in the model name, or header `X-Llmsim-Error`, force that error.
- `X-Llmsim-Seed` pins or (`random`) varies the answer; `X-Llmsim-Mode: langy` echoes.
- `response_format` json_schema and forced tools get schema-valid output.

## Inspect and assert

```
GET    /_sim/api/calls          newest first (model, mode, tokens, status)
GET    /_sim/api/calls/{id}     request and reply
DELETE /_sim/api/calls          reset
GET|PUT /_sim/api/settings      {"forcedError": 0|4xx|5xx, "seed": ""|"random"|"<v>"}
```

## Seed, tests and load

- No seeding needed: the corpus is built in.
- Caps: `LLMSIM_MAX_CALLS` (default 500) and `LLMSIM_MAX_BODY_BYTES` (default 262144 per
  recorded request; larger bodies keep a size and a head).
- A load run should hit the loopback port; the sims lane keeps it off the gateway's process.
