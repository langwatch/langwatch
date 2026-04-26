# LangWatch NLP-Go — Shared Contract

**Status:** Draft v0.1 (2026-04-25)
**Owners:** @sarah (engine + dataset/code/HTTP blocks), @ash (LLM block + gateway client + proxy + topic clustering glue + infra/FF)
**Purpose:** Single source of truth for the langwatch_nlp → Go migration. Every BDD spec under `specs/nlp-go/` and every implementation in `services/nlpgo/` must agree with this file. Disagreements get resolved here first, code changes second.

---

## 1. Goals & non-goals

**Goals**
- Replace the Python `langwatch_nlp` workflow execution engine with a Go service that produces **byte-equivalent results** for every supported workflow shape.
- Replace the LiteLLM proxy responsibilities with a thin reverse proxy in front of the Go AI Gateway (`services/aigateway/`).
- Stand up parallel deployment so customers can be migrated per-project via a feature flag, with zero risk to existing traffic.
- Strip out DSPy and LiteLLM monkey-patching entirely. The new engine is plain Go structs + a stateless prompt builder; the proxy is plain HTTP.

**Non-goals**
- Rewriting topic clustering. It stays on Python (sklearn, scipy, numpy + LiteLLM). What *does* move: the hosting service. When `release_nlp_go_engine_enabled` is on, topic clustering routes to **langevals** (a new workspace member at `langevals/evaluators/topic_clustering/`) instead of `langwatch_nlp`. When off, traffic stays on `langwatch_nlp` unchanged. Long-term goal: all Python lives in `langevals`; `langwatch_nlp` can be deleted once the flag is at 100%.
- Backwards-incompatible URL or DSL changes for customers. The Studio JSON schema is frozen for v1; only internal interfaces move.
- Deleting Python NLP code in this PR. Removal is a follow-up after the flag has been at 100% for two release cycles.

---

## 2. Service layout

| Component | Repo | Path |
|---|---|---|
| Go NLP service (data plane) | `langwatch` | `services/nlpgo/` (extends `cmd/service/main.go`) |
| Python NLP service (legacy) | `langwatch` | `langwatch_nlp/` (unchanged) |
| Helm | `langwatch` | `charts/langwatch/templates/langwatch_nlp/` (extended; one container, see §4) |
| BDD specs | `langwatch` | `specs/nlp-go/` |
| Infra (Lambda) | `langwatch-saas` | `infrastructure/langwatch_nlp_lambda.tf` (extended) |

The Go service mirrors `services/aigateway/` patterns: chi/v5 router, `pkg/clog` logging, `pkg/config` env hydration, `pkg/lifecycle` graceful shutdown, OTel via `otelsetup.Provider`, panic recovery middleware.

---

## 3. Process topology — single container, Go-as-front-door

In both **Lambda** (production) and **dev pod** (k8s) we run **one container** with two processes:

```
                  +------------------------------------+
  request  --->  | Lambda Web Adapter (existing)       |
                  |    forwards to 127.0.0.1:5562       |
                  +--------------+----------------------+
                                 v
                  +------------------------------------+
                  | nlpgo (Go)  :5562   <-- entrypoint |
                  |  /go/*      handled in-process     |
                  |  /healthz   in-process             |
                  |  everything else  ->  reverse-proxy|
                  +--------------+----------------------+
                                 v
                  +------------------------------------+
                  | uvicorn (Python langwatch_nlp)      |
                  |   :5561  child of nlpgo            |
                  +------------------------------------+
```

- **Port assignments (local & in-pod):** app=5560, langwatch_nlp(uvicorn)=5561, **nlpgo=5562**, aigateway=5563.
- **`NLPGO_BYPASS=1`** — emergency lever. When set, the Lambda Web Adapter (and dev pod entry) skips nlpgo and points at uvicorn `:5561` directly. Two-line change in the entry script. Used when nlpgo has a regression and we need to fail back instantly without infra changes.
- nlpgo owns child-process lifecycle: starts uvicorn, monitors PID, propagates SIGTERM, surfaces child health on `/healthz`. If uvicorn exits, nlpgo exits with the same code so the orchestrator restarts the container.

**Path prefix:** `/go/*` (e.g. `/go/studio/execute_sync`, `/go/studio/execute`, `/go/proxy/v1/...`). The TS app prepends `/go` when the feature flag is on; legacy paths stay routed to uvicorn unchanged. (We picked `/go/` over `/v2/` because the API contract is intentionally identical to v1; the prefix is a routing key, not a version. After Python removal, the TS app will be updated to drop the prefix; this is internal-only and not a customer URL.)

---

## 4. Authentication

The Python NLP service has no application-layer auth today — its security posture is Lambda Function URL + URL secrecy + restrictive Security Group. **The Go path inherits the same posture:** no HMAC, no Bearer token on `/go/*`. nlpgo and uvicorn share the container's network surface; both are unauthenticated and rely on the surrounding infrastructure (FunctionURL/VPC/SG) for ingress control.

Earlier drafts of this spec described an `LW_NLPGO_INTERNAL_SECRET` HMAC bridge. That bridge was removed when nlpgo pivoted to importing the AI Gateway dispatcher as a library (see §8). Without an HTTP hop between nlpgo and the gateway there is nothing to authenticate at the wire layer; per-request credentials travel in-process as `domain.Credential` values, not as base64-encoded HTTP headers.

Hardening the underlying ingress posture (e.g. retrofitting the Python path with mutual TLS, or moving off Lambda Function URLs) is tracked as a separate workstream after the migration completes.

---

## 5. Workflow DSL — frozen schema reference

The DSL is defined in `langwatch_nlp/langwatch_nlp/studio/types/dsl.py`. Go structs in `services/nlpgo/app/engine/dsl/` MUST round-trip-deserialize every JSON shape that file produces.

**Top-level:** `Workflow{ workflow_id, version_id, api_key, nodes: Node[], edges: Edge[], state: ExecutionState, ... }`.

**Node kinds (v1 in scope):**
- `entry` — Dataset entry point (records + train/test split + `entry_selection`).
- `signature` — LLM call (Ash owns the executor).
- `code` — User Python code, sandboxed (see §7).
- `http` — Outbound HTTP call (Liquid template body, JSONPath response extraction).
- `end` — Terminal node, defines workflow output shape.
- `prompting_technique` — Decorator referenced by signature nodes (`ChainOfThought`, `MultiHop`, `ReAct`); v1 supports at minimum `ChainOfThought` (hidden `reasoning` field) — others tracked as follow-up.

**Node kinds (v1 out of scope, return 501 if encountered):**
- `agent`, `evaluator`, `retriever`, `custom`. Workflows containing these stay on the Python path (the TS-side feature-flag check returns false when any node kind is unsupported by Go).

**Field types:** `str`, `image`, `float`, `int`, `bool`, `list[*]`, `dict`, `json_schema`, `chat_messages`, `signature`, `llm`, `dataset`, `code`. All must be parseable; `image`/`chat_messages` carry chat-history semantics (see §10).

**Edges:** `Edge{ source_node, source_handle, target_node, target_handle }`. The DAG is built at request time, not at compile time.

---

## 6. Streaming contract (`/go/studio/execute`)

Server-Sent Events. Event shapes match `langwatch_nlp.studio.types.events.StudioServerEvent`:

| event | data |
|---|---|
| `is_alive_response` | `{}` — heartbeat every `NLP_STREAM_HEARTBEAT_SECONDS` (default 15). Matches Python `IsAliveResponse.type`. |
| `execution_state_change` | `{ trace_id, state: { status, nodes: { <node_id>: { status, inputs, outputs, error?, cost?, duration_ms? } } } }` |
| `done` | `{ trace_id, status: "success"|"error", result }` |
| `error` | `{ trace_id, payload: { stack?, message } }` |

- Idle timeout = `NLP_STREAM_IDLE_TIMEOUT_SECONDS` (default 900). On timeout, emit `error` then close.
- Client cancellation: closing the connection MUST cancel in-flight node executions (cooperative; nodes check ctx).
- The sync endpoint `/go/studio/execute_sync` runs the same engine and returns the final `done` payload as JSON when complete.

---

## 7. Code-block sandbox — Go side spawns Python

The code block runs **arbitrary user Python**. Today's Python service isolates via `multiprocessing.Process` (local) or per-Lambda-invocation isolation (Lambda). Go has no Python interpreter, so:

- nlpgo packages a small Python helper at `services/nlpgo/internal/codesandbox/runner.py`.
- For each code-block invocation, nlpgo spawns `python3 runner.py` as a subprocess of the same container, feeds the user code + JSON inputs over stdin, and reads JSON outputs from stdout.
- Hard CPU + wall-clock timeout enforced from Go via `context.WithTimeout` and `cmd.Process.Kill()`.
- stdout/stderr buffered and surfaced in `execution_state_change` for the node.
- The runner.py runs without network access (default — no special restriction; same as the Python pod today; future hardening separate).
- This keeps the **feature parity** floor: anything customer code does today still works.

This is the only place nlpgo depends on a Python interpreter being installed in the container image.

---

## 8. AI Gateway integration — library, not HTTP

nlpgo imports the AI Gateway as an in-process Go package and dispatches
through `services/aigateway/dispatcher`. Per-request credentials are passed
directly as `domain.Credential` values; there is no second HTTP hop, no
HMAC, no `LW_GATEWAY_BASE_URL` in the Studio path. Studio code-block
sandboxing isolates user Python at the subprocess boundary (see §7), so the
gateway library and the user's Python sandbox never share an address space.

What the in-process dispatcher does NOT skip:
- Provider routing through Bifrost (real provider HTTP calls).
- Per-provider error classification + retry (Bifrost-internal).
- Streaming pass-through with raw-byte preservation.

What it does skip (vs. the HTTP `/v1/*` path used by SDK/CLI customers):
- Virtual-key auth — nlpgo brings credentials per-call.
- Rate limiting — internal traffic, not customer-facing.
- Budget tracking — no VK to debit.
- Cache rules / guardrails — Studio runs decide for themselves.

The standard VK + `/v1/*` HTTP path is unchanged for SDK / CLI / customer
Bifrost-passthrough traffic. nlpgo and the HTTP path coexist on different
process surfaces but share the same Bifrost router.

### 8.1 Per-request credential shape

`domain.Credential` carries the provider id + the provider-specific credential
material. nlpgo's `services/nlpgo/adapters/dispatcheradapter/` translates the
inbound `litellm_params` (Studio shape) or `x-litellm-*` headers (playground
shape) into a Credential before calling the dispatcher.

Credential material per provider — all populated fields are strings unless
noted:

```
openai:    { api_key, api_base?, organization? }
anthropic: { api_key, api_base? }
azure:     { api_key, api_base, api_version, use_azure_gateway?: bool,
             extra_headers?: map<string,string> }
bedrock:   { aws_access_key_id, aws_secret_access_key, aws_session_token?,
             aws_region_name, aws_bedrock_runtime_endpoint? }
vertex_ai: { vertex_credentials: <JSON SA key>, vertex_project, vertex_location }
gemini:    { api_key }
custom:    { api_key, api_base }
```

#### Security notes

- Inline credentials never appear in any log line at any level.
- nlpgo logs `nlpgo_llm_dispatched` with request id + project id only, never
  with secret values or even key prefixes.
- Credentials live only in the per-request `domain.Credential` value; they
  are not cached, persisted, or written to OTel attributes.

---

## 9. Provider credential injection — translation matrix

Today the TS app injects credentials in two shapes:
- **Studio runs:** baked into `workflow.nodes[*].data.parameters[*].value.litellm_params` by `prepareLitellmParams()`. DSPy/LiteLLM read them per-node.
- **Proxy / playground:** passed as `x-litellm-*` request headers (`x-litellm-api_key`, `x-litellm-aws_access_key_id`, `x-litellm-vertex_credentials`, …).

nlpgo's gateway client must accept **both shapes** and translate to gateway requests. The `litellm_params` translator (Ash, in `services/nlpgo/adapters/litellm/`) is the single point that knows about provider quirks: Azure `api_version`/`resource_name`, AWS Bedrock STS keys, Vertex SA JSON, custom `model_alias` mappings.

Reasoning model rules (must be preserved):
- Models matching `^(o1|o3|o4|o5|gpt-5)` force `temperature=1.0` and `max_tokens >= 16000`.
- Anthropic temperature is clamped to `[0,1]`.
- `reasoning|reasoning_effort|thinkingLevel|effort` are normalized to a single field.
- Model id translation: `anthropic/claude-opus-4.5 → anthropic/claude-opus-4-5`.

---

## 10. Multi-turn chat preservation

Workflows pass `chat_messages` between nodes. The engine MUST:
- Preserve role+content+tool_calls across node boundaries (regression: commit `cb76144a6`).
- Not collapse history; downstream nodes receive the full message list, not just the last assistant turn.
- Serialize tool_call arguments as canonical JSON to avoid byte drift across the gateway.

---

## 11. Feature flag

- Key: `release_nlp_go_engine_enabled`.
- Backend: `featureFlagService` (PostHog when configured, in-memory otherwise).
- Distinct id: **projectId**. Per-project rollout.
- Env override: `RELEASE_NLP_GO_ENGINE_ENABLED=1` (also honored via `FEATURE_FLAG_FORCE_ENABLE`).
- Decision points (TS app): `runWorkflow.ts`, `playground.ts`, `topicClustering.ts`. **All three** flip together so a flagged project sees the new path everywhere.
- When on:
  - **runWorkflow + playground:** TS app prepends `/go` and routes to nlpgo (single container with Go front-door + Python child).
  - **topic clustering:** TS app routes to **langevals** at `${LANGEVALS_BASE_URL}/topics/{batch,incremental}_clustering` (new langevals workspace member). The langwatch_nlp side is bypassed.
- When off:
  - All three call sites stay on the legacy paths (langwatch_nlp), bit-identical to today's traffic.

The library pivot for nlpgo→aigateway (see §8) removed the LW_NLPGO_INTERNAL_SECRET HMAC bridge — both /go/* and the langevals /topics/* hops follow today's no-auth posture (Lambda Function URL + URL secrecy + restrictive SG).

---

## 12. Observability

- Every request carries `X-LangWatch-Request-Id` (echoed if present, else generated as `req_<30hex>`).
- One JSON access-log line per request (method, path, status, duration_ms, request_id, project_id when known).
- OTel: spans per request, plus per-node spans inside execution. Customer trace bridge identical to gateway pattern.
- Panics → 500 with JSON envelope; stack trace logged.

## 12.5 Telemetry — origin attribution

Every span emitted by nlpgo and every gateway span served on its behalf MUST
carry the attribute `langwatch.origin` naming the entrypoint that initiated
the work. This is set by the TS app at the request boundary and propagated
through every child span without further intervention by handlers.

### Wire format

The TS app sends header `X-LangWatch-Origin: <origin>` on every call to nlpgo
or to the AI Gateway. nlpgo:

1. Reads the header at the front-door middleware.
2. Stashes the value in the request context via `originctx.With(ctx, origin)`.
3. Sets attribute `langwatch.origin` on the request span.
4. The engine threads the same context through every block executor.
5. The gateway client adds `X-LangWatch-Origin: <origin>` to outbound requests.
6. The code-sandbox subprocess receives `LANGWATCH_ORIGIN=<origin>` in env.

### Canonical origins

| Origin             | Set by                                       |
|--------------------|----------------------------------------------|
| `workflow`         | `runWorkflow.ts` — Studio "Run" button       |
| `evaluation`       | `runEvaluation.ts` — evaluation suite runs   |
| `playground`       | `playground.ts` — Prompt Playground          |
| `scenario`         | `scenarios/.../*-agent.adapter.ts`           |
| `topic_clustering` | `topicClustering.ts` — worker batches        |
| `optimize`         | (LEGACY only) — DSPy optimization runs; never produced by Go engine. If observed in /go/* traffic, nlpgo logs a warning. |
| `unknown`          | Default when no header is present            |

Unknown values are not rejected — they are recorded verbatim. Operators can
investigate via the access log's `missing_origin_header` warning.

### Span naming

- Front-door request: `nlpgo.http.request`
- Engine root: `nlpgo.engine.run`
- Per-block: `nlpgo.engine.<kind>` (e.g. `nlpgo.engine.signature`)
- Gateway client: child span on the same trace; the gateway's own span is the
  outbound HTTP child.

### Required attributes

On every nlpgo + gateway span:
- `langwatch.origin`
- `langwatch.project_id`
- `langwatch.request_id`
- `langwatch.workflow_id` (when known)
- `langwatch.trace_id` (the LangWatch trace id, distinct from OTel trace id)

On the LLM gateway-call span specifically:
- `gen_ai.system` (provider id)
- `gen_ai.request.model`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.usage.total_tokens`

### Security

- Inline credentials are never recorded as span attributes.
- The X-LangWatch-Inline-Credentials header value is never logged.
- API key prefixes (last 4 chars) MAY be recorded for ops debugging, but only
  on the gateway's internal trace pile, never on the customer trace bridge.

---

## 13. Test policy

- Unit tests for translators, parsers, DAG resolver — `tests/unit/`.
- Integration tests for engine + each block — `tests/integration/`. **Real HTTP server**, real fixtures from `langwatch_nlp/tests/`. No mocks for cross-component flow.
- Provider matrix tests (Ash) — `tests/matrix/` with `//go:build live_<provider>` tags, real keys from `langwatch/.env`.
- Each spec scenario in `specs/nlp-go/*.feature` MUST have at least one corresponding test. We do not ship without specs and tests aligned.

---

## 14. Open questions

- [ ] Are there workflows in production using `prompting_technique` other than `ChainOfThought`? Pull from telemetry once the spec is reviewed.
- [ ] What's the SLA on uvicorn child-process restart latency? Affects Lambda cold start budget.
- [ ] Confirm the Lambda Web Adapter handles `RESPONSE_STREAM` mode against a Go upstream (it should — adapter is upstream-agnostic — but verify with one live test).
- [ ] Embeddings for topic clustering — does the Python side switch to gateway HTTP in this PR, or do we ship that as a follow-up?
