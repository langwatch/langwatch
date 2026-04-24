# v1.1 follow-ups

Deliberate v1 limitations that need a follow-up iteration before v1.1.

## Translator-side `cache_control` preservation (`/v1/chat/completions → Anthropic/Gemini/Bedrock/Vertex`)

**Owner**: Lane A + Lane B

**Context**: iter-110 ship (`a4286eb86`) preserves byte-for-byte on the
OpenAI → OpenAI-family (OpenAI, Azure) happy path by routing through
bifrost's raw-forward. Same-wire-shape routes keep the prefix-hash
intact → OpenAI's automatic prompt cache + Azure's equivalent hit
reliably across repeat calls.

For cross-wire routes — OpenAI-shape `/v1/chat/completions` body against
an Anthropic / Gemini / Bedrock / Vertex VK — the gateway still
unmarshals the inbound body into `bfschemas.ChatParameters` +
re-marshals to the provider's native wire shape. This path **drops
Anthropic's `cache_control: {type: "ephemeral"}` markers** (the
structured-blocks form isn't reachable from OpenAI's flat `content:
string` shape) and isn't byte-identical across calls for Gemini/Vertex's
implicit shared-prefix caching.

**Matrix evidence**: iter-110 run, 4/6 cache cells red:
- `anthropic/cache`: `cached_tokens=0`
- `gemini/cache`: `cached_tokens=0`
- `bedrock/cache`: `cached_tokens=0`
- `vertex/cache`: `cached_tokens=0`

**v1 workaround**: document + recommend `/v1/messages` for Anthropic
callers who need `cache_control`; keep `/v1/chat/completions → Anthropic
VK` supported but cost-unfriendly. `/v1/messages` raw-forwards the body
unchanged (per `0015e3436`) so cache_control bytes reach Anthropic
intact.

**v1.1 fix scope**:
1. Translator-side `cache_control` preservation on
   `/v1/chat/completions → Anthropic`. Two options:
   - A. Translator learns a custom header (`X-LangWatch-Cache-Control`)
     or body extension (`_cache_control`) from the OpenAI-shape inbound
     and injects structured `cache_control` blocks into the Anthropic
     outbound. Backwards-compatible with plain OpenAI clients.
   - B. Direct `cache_control` field on the ChatMessage type in bifrost
     (if upstream adds it in a future version) so the translator can
     round-trip it natively.
2. Investigate Gemini/Vertex implicit caching behaviour across the
   translation path — may need the same normalization guarantees the
   re-marshal-preservation work gave OpenAI in `a4286eb86`, but for a
   different hash function.
3. Integration-test matrix for cross-schema cache — extend
   `services/aigateway/tests/matrix/{anthropic,gemini,bedrock,vertex}_test.go::TestXxx_Cache`
   to assert `cached_tokens > 0` post-v1.1 fix.

## gpt-5-mini + reasoning-model cache behaviour

**Owner**: Lane A (investigation)

gpt-5-mini on this OpenAI account returned `cached_tokens=0` on 10/10
rapid identical calls direct to `api.openai.com` (verified via
bypass-the-gateway test). gpt-4o-mini on the same account + same
prefix cached reliably (10/10 cached=1408).

Likely explanation: OpenAI's reasoning-model family has different or
delayed cache-eligibility rules. Matrix workaround uses `gpt-4o-mini`
for the cache cell via `OPENAI_CACHE_MODEL` env; the simple / streamed
/ tool_calling / structured_outputs cells continue to use gpt-5-mini
as the default.

**v1.1 investigation**: confirm whether OpenAI's reasoning models
support prompt caching on LangWatch's account (may require an
account-level opt-in or enterprise feature).

## Nova pricing catalog

**Owner**: Lane B

`llmModels.json` has no entries for Amazon Nova (Micro / Lite / Pro).
Iter-110 bedrock matrix uses `eu.anthropic.claude-haiku-4-5-20251001-v1:0`
as the default (greenlight from Anthropic form + AWS IAM unblock) so
this isn't a matrix blocker, but anyone switching to a Nova-backed
VK will see `total_cost: null` in traces.

**v1.1 fix scope**: Add Nova entries to the pricing catalog with current
AWS list prices (Nova Micro $0.0375/$0.15 per 1M tokens input/output;
Nova Lite $0.075/$0.30; Nova Pro $0.75/$3.00).
