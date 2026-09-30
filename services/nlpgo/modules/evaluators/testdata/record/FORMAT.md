# LLM fixture format (frozen)

`record_llm_fixtures.py` runs langevals' LLM and embedding evaluators against `fake_llm.py`
and writes `../fixtures/<family>__<name>.json`: a JSON array, keys sorted, floats at full precision.

## Case

| Field | Meaning |
|---|---|
| `name`, `settings`, `entry`, `result` | As in `record_fixtures.py` (error tracebacks blanked). |
| `env` | Tenant env the case added (`X_LITELLM_temperature`, ...). The recorder always adds `X_LITELLM_api_key`, `X_LITELLM_api_base`, `X_LITELLM_EMBEDDINGS_api_key` and `X_LITELLM_EMBEDDINGS_api_base`; the replay sets its own four. |
| `calls` | Every model call the server received for the case. |

A call is `{"kind": "chat" \| "embedding", "request": <body litellm sent, minus stream, metadata and user>, "response": <body answered>}`, plus `"status"` when not 200.

## Order

Calls are sorted by `(kind, canonical request)`, where canonical is
`json.dumps(request, sort_keys=True, ensure_ascii=False, separators=(",", ":"))`. The sort is
stable, so identical requests keep the order they were answered in. Arrival order is not kept:
ragas sends concurrently. The server answers from the request and script only, never from order.

## Replay matching

- **Chat**: the request the Go gateway channel renders (`channels/gateway`, forwarded by the AI
  gateway) matches the first unused recorded chat call whose fields below are equal as decoded
  JSON: `model` (provider prefix removed, as litellm sends it), `messages`, `tools`,
  `tool_choice`, `temperature`, `top_p`, `max_tokens`, `n` (absent = 1), `reasoning_effort`.
  Absent and `null` are equal; numbers compare as float64. Any other field is ignored.
- **Embedding**: matched per input text on `(model, text)`: langevals embeds one text per call
  where the Go ports batch. The replay answers each text with its recorded vector.
- A request with no match fails the test, naming the nearest call's differing fields. A recorded
  chat call or embedded text that is never requested fails the test.

## Byte-identical rendered prompt

Each message's `role` and `content` equal the recorded ones after JSON decoding: a string
content is the same bytes (whitespace, newlines and Unicode included); a list of content parts
is the same parts in the same order, each part's keys and values equal. Tool schemas compare
the same way, so key order inside `tools` does not matter and array order does.

## Scripts and vectors

A corpus case may carry `script` (knobs in `fake_llm.py`'s docstring). Tool-call arguments and
ragas JSON are filled from the schema in the request, with `script.values` by field name at any
depth. Embeddings are 8 dimensions: the first 8 bytes of `sha256(text)`, each `(b - 127.5) / 127.5`.

## Known limits

- `anthropic/` cases reach the fake through `X_LITELLM_custom_llm_provider=openai`, so their
  recorded wire is OpenAI-shaped and keeps the `anthropic/` model prefix; the Go gateway sends Anthropic's native shape for that prefix.
- off_topic's intent enum comes from a Python `set`; the recorder pins `PYTHONHASHSEED=0`, and the
  Go port must reproduce that order or compare the enum as a set.
- `openai/gpt-5.6-{luna,sol,terra}` with tools go to litellm's `/responses` bridge, which the
  fake does not serve; no case records them.
