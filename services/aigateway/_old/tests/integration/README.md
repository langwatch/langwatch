# Gateway integration tests — coverage matrix

Per rchaves iter-108 ask ("ALL we have done recently is fully covered by
integration tests"). This doc enumerates what is unit-tested vs
integration-pending across the gateway surface, so each lane can close
specific gaps without duplicating effort.

## How to run

```bash
# default CI — runs every unit test, skips build-tagged live ones
go test ./...

# Live upstream-provider integration (spends real API credits)
OPENAI_API_KEY=sk-...    go test -tags=live_openai    ./tests/integration/... -v
ANTHROPIC_API_KEY=sk-... go test -tags=live_anthropic ./tests/integration/... -v
```

## Coverage matrix

### OTel semconv (gen_ai.* envelope)

| Surface | Unit | Integration (stub upstream) | Live (real upstream) |
|---------|:----:|:---:|:---:|
| gen_ai.request.{model, temperature, top_p, max_tokens, frequency_penalty, presence_penalty, stop_sequences} | ✅ `gen_ai_attrs_test.go` | 🚧 | 🚧 |
| gen_ai.operation.name (chat / messages / embeddings) | ✅ `gen_ai_attrs_test.go` | — | — |
| gen_ai.system (provider name) | ✅ | — | — |
| gen_ai.input.messages | ✅ `gen_ai_attrs_test.go` | 🚧 | 🚧 |
| gen_ai.output.messages (non-streaming) | ✅ | 🚧 | 🚧 |
| gen_ai.output.messages (streaming reassembly) | ⚠️ logic via `TestSpanShape_*` | 🚧 | 🚧 |
| gen_ai.system_instructions hoist (Anthropic `system` or OpenAI role=system) | ✅ `TestResolveSystemInstructions_*` | 🚧 | 🚧 |
| gen_ai.response.{id, model, finish_reasons[]} | ✅ | 🚧 | 🚧 |
| gen_ai.usage.{input,output,total}_tokens | ✅ `TestSpanShape_PerProviderUsageMappingContract` | 🚧 | 🚧 |
| gen_ai.usage.cache_read.input_tokens + cache_creation.input_tokens | ✅ contract | 🚧 | ✅ `cache_passthrough_live_test.go` (Anthropic) |

### Dispatcher behaviour

| Feature | Unit | Integration |
|---------|:----:|:---:|
| resolveModel — bare + provider/model + alias | ✅ `openai_chat_test.go` | — |
| rewriteRequestModel (strip provider prefix before upstream) | ✅ `rewrite_model_test.go` | 🚧 |
| errProviderNotBound enriched error | ✅ | 🚧 |
| Multi-provider bare-name falls through to primary | ✅ | 🚧 |
| Fallback attribution (winning_provider, winning_credential, attempts_count) | ✅ `TestSpanShape_FallbackAttribution_*` | 🚧 |
| Budget precheck → budget_hard_cap_hit | ✅ budget_test.go | 🚧 |
| Pre-guardrail block | ✅ | 🚧 |
| Post-guardrail block | ✅ | 🚧 |
| Stream-chunk guardrail block | ✅ | 🚧 |
| Blocked tool/MCP/URL | ✅ blocked/ | 🚧 |
| Rate-limit hit (per-VK rpm/tpm/rpd) | ✅ ratelimit/ | 🚧 |
| Cache rule match → mode_applied | ✅ cacherules/ | 🚧 |

### OTel plumbing

| Feature | Unit | Integration |
|---------|:----:|:---:|
| Per-project OTLP auth (bundle.ProjectOTLPToken → X-Auth-Token) | ⚠️ router_normalize_test.go only | 🚧 |
| GATEWAY_OTEL_DEFAULT_ENDPOINT default | ✅ `config_test.go` | ✅ dev main.go boots without env |
| Trace endpoint URL auto-append /v1/traces | ✅ `router_normalize_test.go` | 🚧 |
| X-LangWatch-Principal + X-LangWatch-Thread-Id headers → span attrs | ✅ `enrich_request_headers_test.go` | 🚧 |
| RecordException — exception event on every error | ✅ `enrich_request_headers_test.go` | 🚧 |
| Compat-rejection metric (legacy_max_tokens) | ✅ `compat_reject_test.go` | 🚧 |

### Auth + bundle

| Feature | Unit | Integration |
|---------|:----:|:---:|
| JWT mint / verify (control plane ↔ gateway) | ✅ `auth/*_test.go` | ✅ existing `/internal/gateway/*` tests |
| HMAC sign request | ✅ `hmac_test.go` | ✅ |
| Bundle cache warm/invalidation on revision bump | ✅ `resolver_test.go` | 🚧 |
| /changes long-poll separate http.Client | ✅ — | 🚧 |

## Integration-test gaps (🚧 above) — what the harness needs

To close the 🚧 rows we need a shared in-process harness under
`tests/integration/gateway_harness/` that:

1. Starts an `httptest.NewServer` that pretends to be each provider
   (OpenAI, Anthropic, Azure OpenAI). Returns fixed JSON shaped like
   the real upstream's response.
2. Builds an `auth.Bundle` with `ProviderCred.BaseURL` pointing at
   the test server's URL, plus a deterministic VK ID / project ID.
3. Wires a `Dispatcher` with:
   - real `bifrost.Bifrost` (points at the test server via BaseURL)
   - stub budget.Outbox that records DebitEvents in memory
   - stub guardrails.Client that can be configured per-test
   - `tracetest.SpanRecorder` attached to a TracerProvider so the
     test can assert on exported spans without a live collector
4. Exposes `serveChat(t, body, headers, bundle)` and
   `serveStream(t, body, headers, bundle)` helpers that return the
   `httptest.ResponseRecorder` + the `[]sdktrace.ReadOnlySpan` the
   handler produced.

Each 🚧 row above then becomes a ~15-line table-driven test. The
harness itself is ~200 lines of setup.

## Live-provider integration

`cache_passthrough_live_test.go` is the current template. Tag the file
with `live_<provider>`, `mustEnv` the credential at the top, then
execute the full gateway path. These tests cost real money — run them
when a gap really needs end-to-end verification.

Next candidate to add under `live_openai`: full span-shape verification
for a real `gpt-5-mini` call — asserts the exported spans carry all
the gen_ai.* attributes that `TestSpanShape_*` locks in unit form.
That's the "would have caught #74 against a real provider" check.

## Why this split

- Unit tests fail fast on contract drift (key renames, shape regressions).
- Stub-upstream integration tests fail on end-to-end wiring regressions
  (middleware order, header propagation, pool lifecycle) without
  provider spend.
- Live-provider tests guard against Bifrost-normalisation drift across
  provider SDKs — worth running in a nightly workflow with a budget cap.
