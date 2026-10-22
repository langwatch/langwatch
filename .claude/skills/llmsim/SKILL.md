---
name: llmsim
description: "Answer every LLM call for free and deterministically with llmsim, haven's provider stand-in. Use when someone says 'haven llm', 'run without a real model', 'no API key', 'cheap playground', 'llmsim', 'haven up +llm', 'force a 429', 'mock the LLM', 'haven sim llm', 'Langy echo', or needs repeatable model output in a test or load run."
user-invocable: true
---

# llmsim

Answers OpenAI chat completions, embeddings and models, Anthropic messages, Gemini and
Vertex generateContent, and Bedrock Converse from a seeded Markov chain: the same prompt
gets the same answer, at no cost. Code: `services/sims/llmsim`, console `apps/sims/src/llm`.

## Run it

- Opt-in: `haven up +llm` (sticky). Runs in the `go` lane by default (see `sims`).
- Console: `https://llm.<slug>.langwatch.localhost`; `haven status` shows the loopback
  port for drivers (`POST /v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/embeddings`).
  Also `POST /v1beta/models/<m>:generateContent` and `:streamGenerateContent` (`?alt=sse`
  for SSE, else a JSON array), the Vertex path `/v1/projects/<p>/locations/<l>/publishers/google/models/<m>:generateContent`,
  and Bedrock `POST /model/<modelId>/converse` and `/converse-stream` (AWS event stream; the
  AWS SDK works with any keys via `BaseEndpoint`). These wires name the model in the path.
  Calls tab: filter, per-call detail, Clear calls. Settings tab: forced error, seed and the
  per-call override headers.
- The loopback port is stable per stack (a slug hash in 21000-21999, probed if taken), so seeded providers survive `haven up` restarts.
- Overlay sets `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and dummy keys, so the seeded
  providers, playground, evaluators, scenarios and Langy reach it. A base URL `.env`
  names wins. Standalone: `make service svc=llmsim` (:5595).
- The seed also adds Gemini, Vertex and Bedrock rows whose `base_url` is llmsim (`HAVEN_SEED_LLMSIM_BASE_URL`),
  unless `.env` names a real Gemini key, Vertex service account or AWS keys.

## Steer a call

- Models: `markov-small`, `markov-json`, `markov-tools`, `langy-echo`, `text-embedding-llmsim`; any name works.
- `canned-hello`, `canned-ok`, `canned-json` return that fixed text for every prompt.
- `error-429` / `error-500` in the model name, or header `X-Llmsim-Error`, force that error,
  in the caller's dialect (Google `RESOURCE_EXHAUSTED`, Bedrock `ThrottlingException`).
- The seed gives the OpenAI provider custom models `error-429` and `error-500` (on a newly created row), so any member can pick them in a model selector.
- `X-Llmsim-Seed` pins or (`random`) varies the answer; `X-Llmsim-Mode: langy` echoes.
- `response_format` json_schema and forced tools get schema-valid output.
- Scripted tool calls, on any model when the request offers tools (and in Langy mode): each
  `/tool <name> <json args>` line of the last user message is a call with exactly those
  arguments, in order; `/next` starts the turn after the tool results; other lines are text.
  Type it into Langy's chat to make Langy call one of its tools (`bash`, `read`, `notify`, …) your way;
  `/tool A` `/next` `/tool B` `/next` text runs A, then B, then answers, in one turn (githubsim: LANGY-09).
- A `/json <object>` line in the last user message is the exact answer to a JSON request;
  settings `nextJson` queues one exact answer for the next JSON request (PUT replaces all settings).
- Agentic runs: `tools` in the model name (`markov-tools`) or `X-Llmsim-Tools: auto` makes
  an auto tool choice always call a tool (the one the last user message names, else a
  seeded pick, schema-valid args); after a tool result it answers text. Chat, responses
  and messages.

## Inspect and assert

```
GET    /_sim/api/calls          newest first (model, mode, tokens, status)
GET    /_sim/api/calls/{id}     request and reply
DELETE /_sim/api/calls          reset
GET|PUT /_sim/api/settings      {"forcedError": 0|4xx|5xx, "seed": ""|"random"|"<v>", "nextJson": {...}}
```

## Seed, tests and load

- No seeding needed: the corpus is built in.
- Caps: `LLMSIM_MAX_CALLS` (default 500) and `LLMSIM_MAX_BODY_BYTES` (default 262144 per
  recorded request; larger bodies keep a size and a head).
- A load run should hit the loopback port. By default the sim shares the `go` lane (one process) with the gateway, so a load run on it is gateway load too; `LANGWATCH_DEV_ONE_PROCESS=0` splits them (see `sims`).
- SDK experiment runs on llmsim: `dev/scripts/dogfood/experiments/run.sh log_steps` (a small GEPA run, steps via
  `/api/dspy/log_steps`) or `run.sh compare` (SDK comparison; the judge needs langevals). Each prints the experiment URL.

## From a terminal or agent

`--json` on every read; non-zero exit on failure; `--stack <slug>` reads another worktree.

```
haven sim llm status | list | get <id> | clear
haven sim llm list [--model <text>] [--failed]                     # model contains text; 4xx/5xx only
haven sim llm fault <4xx|5xx|off>   # `fault off` removes it
haven sim llm config [--seed <value|random>]   # only the flags given change
```
