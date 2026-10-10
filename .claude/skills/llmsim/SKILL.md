---
name: llmsim
description: "Answer every LLM call for free and deterministically with llmsim, haven's provider stand-in. Use when someone says 'haven llm', 'run without a real model', 'no API key', 'cheap playground', 'llmsim', 'haven up +llm', 'force a 429', 'mock the LLM', 'haven sim llm', 'Langy echo', or needs repeatable model output in a test or load run."
user-invocable: true
---

# llmsim

Answers OpenAI chat completions, embeddings and models and Anthropic messages from a
seeded Markov chain: the same prompt gets the same answer, at no cost. Code:
`services/llmsim`, console `apps/llmsim-web`.

## Run it

- Opt-in: `haven up +llm` (sticky). Hosted in the `sims` lane.
- Console: `https://llm.<slug>.langwatch.localhost`; `haven status` shows the loopback
  port for drivers (`POST /v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/embeddings`).
  Calls tab: filter, per-call detail, Clear calls. Settings tab: forced error, seed and the
  per-call override headers.
- The loopback port is stable per stack (a slug hash in 21000-21999, probed if taken), so seeded providers survive `haven up` restarts.
- Overlay sets `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and dummy keys, so the seeded
  providers, playground, evaluators, scenarios and Langy reach it. A base URL `.env`
  names wins. Standalone: `make service svc=llmsim` (:5595).

## Steer a call

- Models: `markov-small`, `markov-json`, `markov-tools`, `langy-echo`, `text-embedding-llmsim`; any name works.
- `canned-hello`, `canned-ok`, `canned-json` return that fixed text for every prompt.
- `error-429` / `error-500` in the model name, or header `X-Llmsim-Error`, force that error.
- The seed gives the OpenAI provider custom models `error-429` and `error-500` (on a newly created row), so any member can pick them in a model selector.
- `X-Llmsim-Seed` pins or (`random`) varies the answer; `X-Llmsim-Mode: langy` echoes.
- `response_format` json_schema and forced tools get schema-valid output.
- Agentic runs: `tools` in the model name (`markov-tools`) or `X-Llmsim-Tools: auto` makes
  an auto tool choice always call a tool (the one the last user message names, else a
  seeded pick, schema-valid args); after a tool result it answers text. Chat, responses
  and messages.

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
- SDK experiment runs on llmsim: `dev/scripts/dogfood/experiments/run.sh log_steps` (a small GEPA run, steps via
  `/api/dspy/log_steps`) or `run.sh compare` (SDK comparison; the judge needs langevals). Each prints the experiment URL.

## From a terminal or agent

`--json` on every read; non-zero exit on failure; `--stack <slug>` reads another worktree.

```
haven sim llm status | list | get <id> | clear
haven sim llm list [--model <text>] [--failed]                     # model contains text; 4xx/5xx only
haven sim llm fault [--error <0|4xx|5xx>]   # `fault off` removes it
haven sim llm config [--seed <value|random>]   # only the flags given change
```
