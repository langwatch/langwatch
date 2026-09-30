# llmsim — local LLM provider stand-in

One Go process (stdlib only) that answers the model calls a haven stack makes,
so the playground, evaluators, scenario runs and Langy work with no provider
key and cost $0. Text comes from a small word-level Markov chain over an
embedded, self-written corpus, seeded from a hash of the model and the
messages: the same prompt always gets the same answer.

`haven up +llm` runs the copy bundled into the Haven binary as the `llm` lane,
routed at `llm.<slug>.langwatch.localhost`, and points the product's OpenAI and
Anthropic providers at it (see `tools/thuishaven/README.md`).

```bash
LLMSIM_ADDR=:5595 haven simulator llm   # standalone, on :5595 by default
```

## What it serves

Routing is by path suffix, so `/v1/chat/completions`, `/chat/completions` and
Azure's `/openai/deployments/{d}/chat/completions` all answer.

| Path suffix               | Dialect                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `/chat/completions`       | OpenAI chat completions, JSON or SSE (`stream`, `stream_options.include_usage`) |
| `/messages`               | Anthropic messages, JSON or SSE (`message_start` ... `message_stop`) |
| `/messages/count_tokens`  | Anthropic token count                                          |
| `/embeddings`             | OpenAI embeddings, float or base64, at `dimensions` (default 1536) |
| `GET /models`             | model list, in Anthropic's shape when `anthropic-version` is sent |

The OpenAI Responses API is not served: the gateway turns a Responses call to
an OpenAI provider with a base URL into chat completions before it leaves.

## What it answers

- **Markov text** (default), about 12 to 50 words, cut at `max_tokens` or
  `max_completion_tokens` with finish reason `length` / `max_tokens`. Usage
  counts a token a word, so cost and usage views get numbers.
- **Structured output**: `response_format` `json_schema` (or Anthropic's
  `output_format` / `output_config.format`) gets JSON drawn from the same
  seeded source: strings of Markov text within `minLength`/`maxLength` and
  `format` (date-time, date, email, uri, uuid), numbers within
  `minimum`/`maximum`, a seeded `enum`/`const` pick, arrays of `minItems` to
  `maxItems`, required keys always, optional keys half the time, `$ref`/`$defs`
  resolved. `json_object` gets `{"answer": "..."}`.
- **Tools**: a forced tool (`tool_choice` required, a named function, or
  Anthropic `any`/`tool`) is always called; otherwise, when tools are offered
  and the last message is not a tool result, half of all prompts call the first
  tool. Arguments are drawn from the tool's JSON schema.
- **Langy mode** (model name containing `langy-echo`, or `X-Llmsim-Mode:
  langy`): no Markov text; llmsim does what the last user message says.
  - A plain message is echoed back verbatim, streaming included.
  - `/tool <name> <json args>` lines are tool calls, exactly as written;
    several lines make several calls in one turn. Other lines are text.
  - `/next` starts the turn taken after the tool results come back, so a
    script can chain calls.
  - When the script has no step left, the last tool results are echoed back as
    the final answer.
  - A tool the request does not offer, or arguments that are not JSON, is
    refused in plain text, never guessed.

  ```
  /tool search_traces {"query":"x"}
  /next
  /tool get_trace {"id":"t1"}
  ```

## Switches

| Switch                                   | Effect                                        |
| ---------------------------------------- | --------------------------------------------- |
| `X-Llmsim-Seed: <value>`                 | pins the random source, whatever the prompt   |
| `X-Llmsim-Seed: random`                  | a fresh source per call (load and fuzz tests) |
| `X-Llmsim-Error: 429` / model `...error-500...` | answers that status in the caller's error shape |
| `X-Llmsim-Mode: langy` / model `...langy-echo...` | Langy mode                            |

The gateway forwards no custom headers upstream, so through the product use
the model-name forms. The console's settings tab sets a forced error and a
seed for every call that carries no header of its own.

## Limits and canned models

`LLMSIM_MAX_CALLS` (default 500) calls are kept, each with at most
`LLMSIM_MAX_BODY_BYTES` (default 262144) of request body. A model containing
`canned-hello`, `canned-ok` or `canned-json` answers that fixed text to any prompt.

## Console

`GET /` serves the React console (`apps/llmsim-web`, ADR-160, built into
`web/dist` and embedded). Its data is under `/_sim/api`:

```
GET    /_sim/api/info            stack, models, settings
GET    /_sim/api/calls           the last 500 calls, newest first
GET    /_sim/api/calls/{id}      one call with its request body and reply
DELETE /_sim/api/calls           forget them
GET    /_sim/api/settings
PUT    /_sim/api/settings        {"forcedError": 0 | 4xx | 5xx, "seed": "" | "random" | "<value>"}
```

It is a dev shim: no auth, any key accepted. Never expose it.
