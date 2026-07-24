# LangWatch NLP-Go — Shared Contract

**Status:** v1.0 (2026-06-07) — migration complete, Python `langwatch_nlp` removed. nlpgo is the sole NLP engine.
**Owners:** @sarah (engine + dataset/code/HTTP blocks), @ash (LLM block + gateway client + proxy + topic clustering glue + infra/FF)
**Purpose:** Single source of truth for the Go NLP service. Every BDD spec under `specs/nlp-go/` and every implementation in `services/nlpgo/` must agree with this file. Disagreements get resolved here first, code changes second.

> **History:** This file began as the `langwatch_nlp` (Python) to Go migration contract. The migration reached 100% and the Python service was deleted. Sections describing the dual-engine / parallel-deployment phase have been rewritten to the Go-only end state. Git history holds the prior contract.

---

## 1. Goals & non-goals

**Goals**
- nlpgo is the **only** NLP execution engine. It produces byte-equivalent results to the deleted Python `langwatch_nlp` for every supported workflow shape.
- The playground proxy is a thin in-process dispatch in front of the Go AI Gateway (`services/aigateway/`). No LiteLLM.
- The deployable artifact (self-hosted image + production Lambda) is Go-only at the application layer. No Python framework or service. The single remaining Python dependency is a minimal stdlib `python3` interpreter used to sandbox user code blocks (see §7).
- DSPy and LiteLLM are gone entirely. The engine is plain Go structs + a stateless prompt builder; the proxy is plain HTTP.

**Non-goals**
- Rewriting topic clustering in Go. It stays on Python, hosted by **langevals** (the workspace member at `langevals/evaluators/topic_clustering/`). The TS app routes topic clustering unconditionally to `${LANGEVALS_ENDPOINT}/topics/{batch,incremental}_clustering`. `langevals` remains a separate Python service (evaluators + presidio PII + topic clustering); it is **not** in scope for this removal.
- Backwards-incompatible URL or DSL changes for customers. The Studio JSON schema is frozen; only internal interfaces moved.
- Removing the code-block feature. User code blocks keep working via the bundled stdlib `python3` sandbox (§7).

---

## 2. Service layout

| Component | Repo | Path |
|---|---|---|
| Go NLP service (sole engine) | `langwatch` | `services/nlpgo/` (a subcommand of `cmd/service/main.go`) |
| Self-hosted NLP image | `langwatch` | `Dockerfile.langwatch_nlp` (Go binary + slim stdlib `python3`) |
| Helm | `langwatch` | `charts/langwatch/templates/langwatch_nlp/` (single Go container) |
| BDD specs | `langwatch` | `specs/nlp-go/` |
| Production Lambda artifact | `langwatch-saas` | `infrastructure/langwatch_nlp_lambda.tf` + saas runtime packaging |

The Python `langwatch_nlp/` directory has been **deleted**. The Go service mirrors `services/aigateway/` patterns: chi/v5 router, structured logging, env hydration, `pkg/lifecycle` graceful shutdown, OTel via the shared provider, panic recovery middleware.

---

## 3. Process topology — single Go process, no Python service

In both **Lambda** (production) and **pod** (k8s/self-hosted) we run **one Go process**. There is no uvicorn child and no reverse proxy. The only Python that ever runs is a short-lived `python3` subprocess spawned per code-block node (§7), which exits when the node finishes.

```
  request  --->  +------------------------------------+
                 | nlpgo (Go)   <-- the only process   |
                 |  /go/*       handled in-process     |
                 |  /healthz /readyz /startupz         |
                 |  anything else -> 502 (go-only)     |
                 +------------------------------------+
                                 |
                                 |  per code-block node, transient:
                                 v
                 +------------------------------------+
                 | python3 runner.py  (stdlib only)    |
                 |  embedded in the binary, exits      |
                 |  when the node completes            |
                 +------------------------------------+
```

- **Port assignments (local & in-pod):** app=5560, **nlpgo=5561** (it inherits the port the Python service used so callers and `LANGWATCH_NLP_SERVICE` are unchanged), aigateway=5563. On Lambda nlpgo binds `$PORT` (8080).
- **No `NLPGO_BYPASS`.** There is no Python service to fall back to. The lever and the dual-process entry script are removed.
- nlpgo no longer manages any child lifecycle. The code-block `python3` subprocess is owned per-invocation by the code-block executor (timeout + process-group kill), not by the service lifecycle.

**Path prefix:** `/go/*` (e.g. `/go/studio/execute_sync`, `/go/studio/execute`, `/go/proxy/v1/...`). The TS app always routes to `/go/*`; there is no legacy non-prefixed path. The prefix is retained as a stable routing key (kept to avoid a needless churn of the `LANGWATCH_NLP_SERVICE` contract and saas wiring). Any non-`/go/` request to nlpgo returns a typed 502 "go-only mode" so a misrouted caller fails loudly.

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
| `done` | `{ trace_id, status: "success" \| "error", result }` |
| `error` | `{ trace_id, payload: { stack?, message } }` |

- Idle timeout = `NLP_STREAM_IDLE_TIMEOUT_SECONDS` (default 900). On timeout, emit `error` then close.
- Client cancellation: closing the connection MUST cancel in-flight node executions (cooperative; nodes check ctx).
- The sync endpoint `/go/studio/execute_sync` runs the same engine and returns the final `done` payload as JSON when complete.

---

## 7. Code-block sandbox — the only Python in the artifact

The code block runs **arbitrary user Python**. This is the single reason the artifact ships a `python3` interpreter, and it is the only Python dependency left after `langwatch_nlp` was deleted.

- The runner + a `dspy` stub are **embedded in the Go binary** via `//go:embed` at `services/nlpgo/app/engine/blocks/codeblock/{runner.py,fake_dspy.py}`. The executor materializes them to a temp dir on first use. Nothing extra is copied into the image.
- For each code-block invocation, the executor spawns `python3 runner.py <result_path>` as a transient subprocess (default interpreter `python3` from PATH, override `SANDBOX_PYTHON`), feeds the user code + JSON inputs over stdin, and reads a JSON result file.
- Hard wall-clock timeout enforced from Go via `context.WithTimeout` + process-group SIGKILL (`CODE_BLOCK_TIMEOUT_SECONDS`, default 60).
- stdout/stderr captured and surfaced in `execution_state_change` for the node.
- **Runner is stdlib.** `runner.py` + `fake_dspy.py` import only the Python standard library. User `import dspy` resolves to the bundled stub (Module/Prediction/Signature/InputField/OutputField/Predict); the real dspy/litellm are not present.
- **Curated user batteries.** User code is expected to reach for common utilities (`requests`, `httpx`, `pydantic`, data libs), so the sandbox ships a small, explicit, maintained set installed from `services/nlpgo/app/engine/blocks/codeblock/sandbox-requirements.txt`. This is the SAME file in the self-hosted image and the Lambda artifact, and it is published in docs as "what is available in a code block." It deliberately does NOT carry the old mega-image (litellm, dspy, fastapi, torch, boto3, google-cloud-aiplatform); those were an accident of bundling, not a contract. The list is right-sized against a production import histogram of real code blocks.
- **Image requirement:** a `python3` interpreter plus the `sandbox-requirements.txt` packages (e.g. `distroless/python3` or `python3-minimal` as the base, `pip install -r` on top). It does NOT need any langwatch_nlp dependency.

This keeps the feature-parity floor for code blocks while the artifact stays Go-only at the application layer (the only Python is the interpreter + a curated utility set, not a Python service).

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
- **Registry default: `true`** — new projects route through nlpgo by default. The legacy Python pipeline is the opt-out path (PostHog rule, operator-store row, or `NLPGO_BYPASS=1` on the pod for a chart-wide kill switch).
- Backend: `featureFlagService` (PostHog when configured, in-memory otherwise).
- Distinct id: **projectId**. Per-project rollout / opt-out.
- Env override: `RELEASE_NLP_GO_ENGINE_ENABLED=0` to force-disable; `FEATURE_FLAG_FORCE_ENABLE=release_nlp_go_engine_enabled` to pin it on regardless of backend state.
- Decision points (TS app): `runWorkflow.ts`, `playground.ts`, `topicClustering.ts`. **All three** flip together so a project sees the same path everywhere.
- When on (default):
  - **runWorkflow + playground:** TS app prepends `/go` and routes to nlpgo (single container with Go front-door + Python child).
  - **topic clustering:** TS app routes to **langevals** at `${LANGEVALS_BASE_URL}/topics/{batch,incremental}_clustering` (new langevals workspace member). The langwatch_nlp side is bypassed.
- When off (per-project opt-out):
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
