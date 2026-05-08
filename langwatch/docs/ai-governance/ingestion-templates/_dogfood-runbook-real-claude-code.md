# Real Claude Code dogfood — closing the canned-fixture gap

> **Why this exists**: The IngestionTemplate v1 dogfood pass used canned OTLP payloads (`scripts/dogfood/governance/payloads/claude_code.json`) that explicitly emit canonical `gen_ai.*` shape because we wrote them to. The v1 design claim — "Claude Code emits canonical gen_ai natively, receiver passes through" — was therefore not actually verified end-to-end. This runbook lets rchaves (on his actual machine, with the actual Anthropic 20x Claude Code session) close that gap in ~5 minutes.

## Prerequisites

- Claude Code CLI installed locally (`claude --version`). Per [Claude Code monitoring docs](https://code.claude.com/docs/en/monitoring-usage), OTLP export is configured via `CLAUDE_CODE_ENABLE_TELEMETRY=1` + standard OTEL_EXPORTER_OTLP_* env vars. Verify your Claude Code version supports this.
- Dev stack running (`make dev` or `make dev-scenarios`) with seeded users.
- A `lwub_*` binding token from `/me` Trace Ingest → click Claude Code → "Issue binding token" → copy. (Or reuse an existing binding if you have one.)

## Steps

### 1. Confirm Claude Code's OTLP support in your version

```bash
claude --help 2>&1 | grep -iE "otel|telemetry"   # may show env hints
echo "Claude Code version: $(claude --version 2>&1 | head -1)"
```

### 2. Set OTLP env vars + fire a real session

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:5560/api/otel"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer lwub_REPLACE_WITH_YOUR_BINDING_TOKEN"
export OTEL_LOGS_EXPORTER="otlp"
export OTEL_METRICS_EXPORTER="otlp"
export OTEL_TRACES_EXPORTER="otlp"

claude --print "What is 2+2?"   # any short prompt — generates one trace
```

(Adjust env-var names to match the actual Claude Code env-var convention if it diverges. The receiver only cares about `Authorization: Bearer lwub_*` + an OTLP-shaped POST.)

### 3. Verify trace lands at `/me/traces` with canonical fields populated

Open `http://localhost:5560/me/traces?source=claude_code` in your browser.

**Verify each of these populated FROM THE REAL CLAUDE CODE RESPONSE** (NOT from a fixture stamping known values):

- [ ] `gen_ai.usage.input_tokens` > 0 (matches your prompt's actual input length)
- [ ] `gen_ai.usage.output_tokens` > 0 (matches your prompt's actual response length)
- [ ] `langwatch.cost.usd` > 0 (NOT `'—'` like the canned-fixture screenshots show)
- [ ] `gen_ai.response.model` matches the upstream model Claude Code used (e.g. `claude-3-5-sonnet-...` for current)
- [ ] `langwatch.user.id` matches your user (receiver-stamped, not template-stamped)
- [ ] `langwatch.template.id` matches the claude_code template id (receiver-stamped post-OTTL)
- [ ] `langwatch.user_ingestion_binding.id` matches the binding row (receiver-stamped post-OTTL)
- [ ] `langwatch.source` = `"claude_code"` (receiver-stamped, NOT template-stamped)
- [ ] Span name is what Claude Code actually emits (likely `claude.code.completion` or similar, not the canned `claude-code.completion`)

### 4. Compare to the canned fixture's claim

The canned fixture at `scripts/dogfood/governance/payloads/claude_code.json` emits a span with shape `claude-code.completion` + `gen_ai.usage.input_tokens=187 + output_tokens=53 + model=claude-3-5-sonnet-20241022`. If your real run produces a different span shape (different name, different attribute keys, missing canonical gen_ai), the v1 design assumption is wrong and we need either:
- (a) Update the canned fixture to match real shape (low impact)
- (b) Ship a real OTTL transform on the claude_code template (substantial — admin OTTL authoring UI dependency)
- (c) Hardcode the shape mapping in the receiver (anti-pattern but quick)

If your real run produces canonical gen_ai 1:1 (matches the fixture), the v1 design holds and we can close this gap with a screenshot of the real-Claude-Code trace detail in `/me/traces` showing cost > 0.

### 5. Report back to the channel

- Span shape that landed: `[paste from /me/traces trace detail]`
- gen_ai.* keys that were populated: `[list]`
- Cost shown: `[$X.XX or '—']`
- Decision: v1 holds / v1 needs OTTL work / v1 needs fixture adjustment

This is the load-bearing gap closure. Without it, "claude_code template auto-shapes traces" is a v1 claim we cannot stand behind under reviewer scrutiny.

---

## Cross-references

- `langwatch/ee/governance/ingestion-templates/_template/dogfood.md` — the per-template ritual; this runbook closes the R3 step (real upstream tool) for claude_code specifically.
- `feedback_fixtures_dont_replace_real_user_dogfood.md` — the rchaves nudge memory.
- `feedback_fixture_wrapper_time_anchor_and_2xx_drop_guard.md` — the 2xx-with-rejectedSpans gotcha.
- `specs/ai-gateway/governance/personal-project-ingest-via-template.feature` @happy-path — the contract this runbook verifies.
