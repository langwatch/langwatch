# Replacing langevals with Go

Status: plan, revised after a four-lens review on 2026-09-30 (architecture, blast radius,
tenancy and security, specs and feasibility). Ruled by Alex in this session: Go, inside nlpgo;
the gateway's two-pile tracing; PII behind a pluggable analyser; the process-half grammar. Every
other choice below is a recommendation until the decisions in §12 are taken.

Companions:

- Ragas source of truth: `dev/docs/plans/langevals-go/ragas-0.4.3-reference.md`, rendered by
  running ragas 0.4.3, covering all 13 `ragas/*` evaluators.
- Specs: `specs/evaluators/go-evaluator-runtime.feature`, `specs/evaluators/ragas-go-parity.feature`,
  `specs/data-privacy/pii-analyser-choice.feature`.

## 1. Review findings

Every finding was checked against the code; blockers were re-verified by hand. "§" references
point at the section of this plan that resolves each one.

| #   | Sev     | Finding                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                      | Fix                 |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | blocker | nlpgo's `/go/*` has no inbound auth; the plan sends provider credentials and a project API key over it, and without Lambda the "URL secrecy + SG" posture is gone                                                                                                             | `services/nlpgo/adapters/httpapi/router.go:52-80`; `specs/nlp-go/_shared/contract.md:73,240`; no NetworkPolicy in `charts/langwatch/templates/langwatch_nlp/` | §5.1                |
| 2   | blocker | Customer trace routing is last-writer-wins per project id: a request pairing B's id with A's key re-points `registry[B]`, and B's queued spans export under A's key into A's project                                                                                          | `pkg/customertracebridge/registry.go:59,72-74`, `transport.go:110,211`; ingest trusts the token (`otlp-ingest.rest.ts:218`)                                   | §6.1                |
| 3   | blocker | The new feature files enforce no scenario, so the parity checker fails them                                                                                                                                                                                                   | `check-feature-parity.ts:1743,1884-1894`                                                                                                                      | §10                 |
| 4   | blocker | 13 `ragas/*` evaluators exist, the plan had 9 (context_precision, context_recall, context_f1 are non-LLM string distance; response_context_precision is two LLM metrics)                                                                                                      | `services/langevals/evaluators/ragas/langevals_ragas/`; `evaluators.generated.ts`                                                                             | §8.3                |
| 5   | blocker | The TS evaluator catalogue and its Zod settings schemas are generated from Python; nothing regenerates them once Python goes                                                                                                                                                  | `services/langevals/scripts/generate_evaluators_ts.py` → `modules/evaluator/contract/src/evaluators.generated.ts` and ~15 consumers                           | §7                  |
| 6   | major   | nlpgo's multi-tenant `otelsetup` wipes attributes on keyless spans (`stub.Attributes = nil`) and sends keyed spans to the customer, so the ops pile would get nothing and the customer duplicates                                                                             | `pkg/otelsetup/tenant_router.go:236`; `services/nlpgo/deps.go:68`                                                                                             | §6.2                |
| 7   | major   | The bridge cannot build "evaluation parent + judge children": `BeginSpan` names every span `gen_ai.<type>` and parents to the inbound traceparent; the probe-drop heuristic drops tool-only judge answers; no causality depth, so an evaluation trace can re-trigger monitors | `emitter.go:237-259,427-431`; `evaluation-trigger.subscriber.ts:178-201`; precedent `workflow-evaluation.service.ts:37-44`                                    | §6.1                |
| 8   | major   | `ForbiddenInternalSpanAttrs` is a gen_ai denylist; evaluation `details`, labels and provider errors quote entry text                                                                                                                                                          | `gatewaytracer/internal_span.go:21`                                                                                                                           | §6.2                |
| 9   | major   | Tracing adds 1 + N billable `SPAN_RECEIVED` units per evaluation; today evaluator spend reaches only `EvaluationCost`, no gateway budget                                                                                                                                      | `billable-events-meter.projection.ts:88-94`; `evaluation-execution-receipt.service.ts:63-74`                                                                  | §6.3                |
| 10  | major   | `BlockLocalHTTPCalls` defaults off; `pkg/ssrf` classifies but does not dial; Azure's endpoint is tenant-supplied; a shared in-cluster pod widens the blast radius                                                                                                             | `services/nlpgo/config.go:23`; `values.yaml:1165`; `azure-safety-credentials.service.ts:34`                                                                   | §5.3                |
| 11  | major   | nlpgo caps every body at 32 MiB; clustering allows 180 MB; the chart gives nlpgo 1Gi shared with the studio; (revised: TS pages at most 2,000 traces, so the distance matrix is 16 MB and real bodies stay under ~64 MB)                                                      | `pkg/config/server.go:28`; `router.go:65`; `values.yaml:1193`                                                                                                 | §5.4, §8.6          |
| 12  | major   | Moving clustering reverses a recorded ruling (clustering stays Python) and "~200 lines" understates ~1,100 lines of Python                                                                                                                                                    | `specs/nlp-go/_shared/contract.md:22`; `specs/nlp-go/topic-clustering.feature`; `python-removal.feature:56`                                                   | §8.6                |
| 13  | major   | PII must return Presidio's anonymised text too, not just findings; a non-processed status leaves the text unredacted                                                                                                                                                          | `presidio-redaction.service.ts` (`clearingOf` reads `raw_response.anonymized`)                                                                                | §9                  |
| 14  | major   | A Go `google-dlp` analyser duplicates data-privacy's DLP; `connect` needs licensing, which lives in TS (a TS→Go→TS cycle); `presidio` has nothing to call after deletion                                                                                                      | `pii-redaction-policy.service.ts:117`; `http.google-dlp.channel.ts`; `InstantEvalConnectJudgeService`                                                         | §9                  |
| 15  | major   | PII scores: Presidio boosts context with spaCy lemmas (+0.35, floor 0.4), phone starts at 0.4, spaCy NER is a flat 0.85; model and DLP scores are on other scales; `min_threshold` 0.5 flips                                                                                  | `pii_detection.py`; Presidio recognisers                                                                                                                      | §9                  |
| 16  | major   | Replay parity with byte-identical prompts is deterministic, so tolerances hide bugs; live runs need a tolerance measured from Python's own spread; replay needs full request/response pairs incl. repairs, `n=3` and embeddings                                               | reference §2, §5                                                                                                                                              | §8.3                |
| 17  | major   | Ragas asks with the schema in the prompt (no structured output); the langevals judges force a tool call; "byte-identical" holds for the user message only; the token-limit skip counts with `litellm.encode` per model                                                        | reference §1, §5                                                                                                                                              | §8.2, §8.3          |
| 18  | major   | The Go module name `evaluation` / `EvaluationApi` collides with the TS module and token; the TS module owns the boundary                                                                                                                                                      | `modules/catalogue.json:95`; `evaluation.api.ts:121`; ARCHITECTURE.md §3.3                                                                                    | §3                  |
| 19  | major   | The module would import nlpgo's hexagonal `adapters/` and `aigateway/domain`; raw clients must cross only at channel construction                                                                                                                                             | ARCHITECTURE.md §3.2                                                                                                                                          | §3.2                |
| 20  | major   | Config and secrets: declarations belong in the contract; a secret is never a config field; Go has no `Secret.load`                                                                                                                                                            | ARCHITECTURE.md §6; `pkg/config.Hydrate`                                                                                                                      | §3.3                |
| 21  | major   | No error codes; Go's equivalent of a handled error is `pkg/herr`                                                                                                                                                                                                              | ARCHITECTURE.md §3.1, §12; nlpgo `router.go:147`                                                                                                              | §3.4                |
| 22  | major   | Services are not one per entity (`JudgeService` is a procedure); the analyser choice had two homes                                                                                                                                                                            | ARCHITECTURE.md §3.2                                                                                                                                          | §3.1                |
| 23  | major   | The published `langevals` PyPI library (+ `langevals-core`, six extras, pytest plugin, notebooks, docs site) dies with the directory                                                                                                                                          | `services/langevals/pyproject.toml`; `langevals-publish-pypi.yml`; release-please                                                                             | §11, §12            |
| 24  | major   | The npx CLI runs langevals through uv; compose, haven, helm, CI (incl. a required check), e2e and visualdiff all start it                                                                                                                                                     | `apps/server/src/services/langevals.ts`, `venvs.ts`; `infra/compose.yml`; `langevals-ci.yml:183`                                                              | §11                 |
| 25  | major   | The evaluation module has no config to reach nlpgo; `LANGWATCH_NLP_SERVICE` is model-provider's leaf with an unresolved shared-fact note                                                                                                                                      | `workflow.app.ts:508-509`                                                                                                                                     | §4                  |
| 26  | major   | Rollout had no per-evaluator switch, shadow mode, dashboards or rollback                                                                                                                                                                                                      | plan §Order                                                                                                                                                   | §4                  |
| 27  | major   | Missing error paths in specs: unknown slug, bad settings, provider 5xx vs rate limit, deadline, over the project limit, failed trace export, analyser failure, oversized text, NaN, divide by zero                                                                            | specs                                                                                                                                                         | §10                 |
| 28  | major   | Scenarios bound to Python tests unbind on deletion; one TS test reads `select_best_compare.py` directly                                                                                                                                                                       | `check-feature-parity.ts:280,2061`; `comparison-config-form.judge-prompt-parity.unit.test.ts:34`                                                              | §10, §11            |
| 29  | minor   | The ruling sat in §1 while the plan listed it as open; "one package per slot" ignored the grammar's tier folders                                                                                                                                                              | ARCHITECTURE.md; `feature-layout-policy.mjs:75-85`                                                                                                            | done: moved to §3.2 |
| 30  | minor   | Vocabulary: "members", `New(Setup)` bags, `catalogue.go` vs `modules/catalogue.json`, `{module}` path param, `/go/langevals` naming a deleted service, "live" suffix                                                                                                          | ARCHITECTURE.md §5, §8                                                                                                                                        | §3                  |
| 31  | minor   | Go lint runs misspell with `locale: US`; initialisms want `PII`, `LLM`                                                                                                                                                                                                        | `.golangci.yml:100-104`                                                                                                                                       | §3                  |
| 32  | minor   | Embeddings get the install's fallback keys from TS itself (`prepareEnvKeys`); Vertex's `GOOGLE_APPLICATION_CREDENTIALS` is the only Python-only fallback                                                                                                                      | `legacy-model-provider.rules.ts:239-243,271`; `litellm_patch.py:503-508`                                                                                      | §5.2                |
| 33  | minor   | Retries and deadlines: TS retries once on 5xx and aborts at 5 min; Python ignores `Idempotency-Key`                                                                                                                                                                           | `langevals-evaluator.service.ts:141-143`; `evaluation.app.ts:226-227`                                                                                         | §5.5                |
| 34  | minor   | `image_support.py` and `tool_calls.py` (multimodal and tool-call inputs to judges) were missing                                                                                                                                                                               | `langevals_core/`                                                                                                                                             | §8.2                |
| 35  | minor   | Deprecated `langevals/pairwise_compare`; hidden `aws/comprehend_pii_detection`, `google_cloud/dlp_pii_detection`; TS-only `langwatch/api_keys_and_secrets_detection`                                                                                                          | `pairwise_compare.py:156`; `evaluator-catalogue.rules.ts:19-20`                                                                                               | §8.1                |
| 36  | minor   | Record edits implied but not listed: §3.3 staging line, §1 table (`services/piimodel`), §3.5 availability row, contract.md posture                                                                                                                                            | ARCHITECTURE.md                                                                                                                                               | §11                 |

## 2. What stays true

- nlpgo runs as a shared Deployment in helm and compose (`charts/langwatch/templates/langwatch_nlp/`);
  the per-project Lambda fleet is optional and stays for studio code blocks. SaaS topology is out
  of the repo: confirm the evaluation module can reach a shared nlpgo there (step 0.4).
- Credentials already arrive in LiteLLM shape (`X_LITELLM_<param>` in `env`), the params
  nlpgo's LiteLLM translation already handles.
- Go tests bind to specs today: `check-feature-parity.ts:208-215` scans `services/nlpgo` for Go
  `@scenario` tests.
- The in-process dispatcher already exists and takes the credential per call.

## 3. The Go module

Named for what it is, so it does not collide with the TS `evaluation` module, which keeps owning
the boundary (ARCHITECTURE.md §3.3): **`evaluators`**, API **`EvaluatorRuntimeApi`**.

### 3.1 Layout

```
services/nlpgo/modules/evaluators/
  contract/
    api.go                  EvaluatorRuntimeApi: Evaluate, ClusterTopics, AnalyzePII
    types.go                Tenant, Entry, Settings, Result, Cost, PIIFinding, EntityType
    config.go               Config with env tags; embedded by nlpgo's Config under NLPGO_EVALUATORS_
    errors.go               herr.Code constants (§3.4)
  evaluators.go             the module: New(deps) builds the three services, forwards; thin
  services/
    evaluation.go           EvaluationService: batch, fair share, deadline, dispatch by definition,
                            ops span; unexported judge loop and ragas/langevals step sequences
    topic_clustering.go     TopicClusteringService
    pii_detection.go        PIIDetectionService: patterns, analyser, merge, anonymise
  channels/
    llm.go                  LLMChannel: Complete, Embed (interface)
    customer_trace.go       CustomerTraceChannel: StartEvaluation, StartCall, End (interface)
    pii_analyzer.go         PIIAnalyzer (interface, §9)
    moderation.go, content_safety.go
    gateway/                gateway.llm.go: the in-process dispatcher, LiteLLM params translated here
    http/                   http.customer_trace.go (the bridge), http.pii_analyzer.go (remote),
                            http.moderation.go, http.content_safety.go; all on the safe dialer
    memory/                 a twin per channel; throws by name on anything unscripted
  rules/
    evaluator_definitions.go  slug -> kind, defaults, required fields (generated, §7)
    exact_match.go basic.go blocklist.go valid_format.go language.go
    string_distance.go      levenshtein, hamming, jaro, jaro_winkler (ragas non-LLM metrics)
    bleu.go rouge.go porter_stemmer.go cosine.go ward_linkage.go
    prompts/*.tmpl          go:embed; ragas and langevals prompts verbatim
    prompt_render.go        PydanticPrompt.to_string, byte-exact; SetEscapeHTML(false)
    judge_parse.go          extract_json, lenient decode, finish-reason decisions
    ragas_scoring.go        each metric's arithmetic and NaN / empty handling
    token_budget.go         the per-evaluator token-limit skip
    pii_patterns.go         recognisers: regex, checksum, context words, Presidio's scores
    pii_merge.go            overlap resolution, threshold, anonymised text
    pii_analyzer_choice.go  config -> analyser kind (the one home of the choice)
    fair_share.go           may this project start another evaluation, given counts?
  repositories/             none: the module owns no state
  transport/
    rpc/http.go             bearer-guarded, pkg/rpc decode (as langyagent's transport/rpc):
                            POST /go/evaluators/{family}/{evaluator}/evaluate,
                            POST /go/evaluators/topics/{batch,incremental}_clustering,
                            POST /go/evaluators/pii/analyze
```

### 3.2 Boundaries

- The module imports nothing from nlpgo's `adapters/`, `app/` or `aigateway/domain` outside
  `channels/gateway`. `deps.go` builds the dispatcher, the bridge emitter, the HTTP clients and the
  resolved secrets, and hands each to its channel's constructor; the module constructor receives
  built channels, never a bag of raw clients.
- nlpgo's LiteLLM translation (`adapters/litellm`, `adapters/gatewayproxy/headers.go`) moves to
  `pkg/litellmparams` so the studio and `channels/gateway` share it without a module reaching into
  `adapters/`.
- Channel tiers: `http`, `memory` from the grammar, plus a new `gateway` tier for the in-process
  dispatcher (decision D9).
- Go spelling: identifiers and comments US (`PIIAnalyzer`, `AnalyzePII`), because misspell runs
  `locale: US`; docs, specs and wire field names stay as they are.

### 3.3 Config and secrets

- `contract/config.go` declares the module's config (analyser choice and base URL, limits, caps,
  deadline) with env tags; nlpgo's `Config` embeds it as it embeds `EngineConfig`. The module never
  reads the environment.
- The analyser API key is not a config field (the internal secret is nlpgo's, as langyagent's is): `deps.go` resolves them and passes
  them into the channel or middleware that uses them. Go has no `Secret.load` equivalent yet
  (decision D10).

### 3.4 Errors

`contract/errors.go` declares `herr.Code`s; the transport registers their statuses; the TS
`LangevalsChannel` maps each to a `HandledError`. The wire is internal, so `herr`'s nested
`error` body is acceptable here.

| Code                           | Status               | When                                                          |
| ------------------------------ | -------------------- | ------------------------------------------------------------- |
| `evaluator_not_found`          | 404                  | unknown `{family}/{evaluator}`                                |
| `evaluator_settings_invalid`   | 400                  | settings fail the definition's schema                         |
| `evaluation_payload_too_large` | 413                  | over the per-route cap                                        |
| `tenant_missing`               | 400                  | no project id header                                          |
| `unauthorized`                 | 401                  | internal bearer secret missing or wrong (§5.1)                |
| `evaluation_busy`              | 429 + `retryAfterMs` | fair share full after the bounded wait                        |
| `pii_analyzer_unavailable`     | 200, result `error`  | analyser timeout or 5xx; TS falls back to the essential floor |

A provider failure after a provider call is never a 5xx: the entry is `status: "error"` with the
cost accrued so far (§5.5).

## 4. Cut-over and rollout

- **Endpoint config**: the TS evaluation module declares its own `evaluatorRuntimeEndpoint`
  (nlpgo's base URL + `/go/evaluators`) rather than borrowing model-provider's
  `LANGWATCH_NLP_SERVICE` (finding 25).
- **Per-evaluator engine switch** in `LangevalsChannel`: `python | go | shadow`, keyed by
  evaluator type, default `python`. Rollback is flipping one entry back. It lives until step 7.
- **Shadow mode**: the channel calls both, answers with Python, and logs the pair: exact
  comparison for deterministic evaluators, score-distribution comparison for LLM ones. The
  shadow call carries no project key, so it traces nothing and is not billed twice.
- **Dashboards per engine**: errors, skips, latency, cost, score distribution per evaluator.
- **Promotion rule**: an evaluator moves to `go` after its replay parity passes and a week of
  shadow shows no drift beyond the live tolerance.
- **Self-hosters**: `LANGEVALS_ENDPOINT` keeps working until the last evaluator flips; the chart
  stops shipping the langevals pod in the release after that, with an upgrade note.

## 5. Security and tenancy

### 5.1 Inbound authentication (finding 1)

Decided (D2): the internal RPC auth the other Go services use, copied from langyagent's
`services/langyagent/transport/rpc`:

- **Wire**: stdlib `ServeMux` behind the shared `pkg/httpmiddleware` chain (RequestID, Recover,
  Telemetry, Version); bodies decoded and validated by `pkg/rpc` (`Decode`, `RegisterStatuses` for
  `bad_request` / `payload_too_large`); errors through `pkg/herr`.
- **Auth**: a required shared bearer secret, `NLPGO_INTERNAL_SECRET`, compared in constant time
  (as `LANGY_INTERNAL_SECRET`). Go reads it through its config with `validate:"required"` and hands
  it only to the transport; TS declares it `Secret.load("NLPGO_INTERNAL_SECRET")` in the
  evaluation module's contract config and the `LangevalsChannel` sends it as `Authorization: Bearer`.
  Rotation follows `pkg/jwtverify`'s current/previous pair if a second secret is needed later.
- **Network**: a NetworkPolicy admitting only the app and worker pods to nlpgo, as the gateway
  chart has.
- Update `specs/nlp-go/_shared/contract.md`'s "no auth" posture. The studio and proxy routes adopt
  the same bearer check afterwards.

### 5.2 Credentials

- Only the request's `env` supplies provider credentials; the module never reads the process
  environment. The operator keys TS deliberately forwards (moderation's `OPENAI_API_KEY`,
  embeddings' install fallback via `prepareEnvKeys`) are TS's decision and arrive the same way;
  the spec says "never reads its own environment", not "never uses an operator key".
- Vertex's `GOOGLE_APPLICATION_CREDENTIALS` fallback is dropped; check the SaaS Lambda env for
  anything relying on it before the Vertex judges flip (step 0.5).
- `Tenant{ProjectID}` travels by name through services and channels; the trace key is bound once
  into the customer-trace channel at the transport and never passed further.

### 5.3 Egress

Every vendor, analyser and OTLP client dials through `httpblock.SafeDialer`
(`services/nlpgo/app/engine/blocks/httpblock/ssrf.go:145`, moved to `pkg/` with the move above),
which re-checks at dial time. Cloud metadata addresses are always blocked. SaaS sets
`blockLocalHTTPCalls=true`; the spec is worded "when the deployment blocks local calls".

### 5.4 Caps and memory

Per-route body caps (as aigateway does): 16 MB evaluation, 180 MB clustering. Clustering bodies
over 32 MB keep the S3 staging path, which nlpgo already receives (`staged_payload.go`); evaluation
staging goes. Bytes in flight count against the global gate. Clustering runs in its own
Deployment of the same image, `--only topics`: 2 replicas, 250m/512Mi requested, 2 CPU/1.5Gi
limit, at most 2 jobs per pod, an 11-minute deadline under TS's 12 (decision D6).

### 5.5 Fair share, deadlines, retries

- Global cap (64, as today) plus a per-project in-flight limit; over the limit the request waits
  up to 10 s, then `evaluation_busy`.
- The module's deadline is 270 s, under TS's 5-minute abort, so cost is reported before TS gives up;
  `r.Context()` cancellation stops provider calls.
- No idempotency needed: never answer 5xx after a provider call, so TS's retry-once-on-5xx only
  retries work that never started.

## 6. Tracing

### 6.1 The customer pile (findings 2, 7)

`channels/http/http.customer_trace.go` wraps `pkg/customertracebridge`, with these changes to the
shared package (options, so the gateway is untouched):

1. **Route by fingerprint, not project id.** Stamp `langwatch.route_key = projectID + ":" +
sha256(key)[:12]` on each span and register under that key. A mismatched pair can then only ever
   write into the key's own project, and concurrent keys for one project never overwrite each other.
2. **No key, no customer span.** Never call `Begin`; never delete a registry entry for a keyless
   request.
3. **Named spans and a parent chain**: a generic `Start(name, type)`; the evaluation span
   `evaluation.<type>` is the parent of every judge span `gen_ai.chat` / `gen_ai.embeddings`.
4. **Loop guard**: stamp `langwatch.reserved.causality_depth >= 1`; with no inbound
   `traceparent`, do not trace at all (the precedent in `workflow-evaluation.service.ts:37-44`).
   The traceparent TS sends is a fresh trace per evaluation, never the evaluated trace: the fold
   keeps depth at trace level (`detectFoldedCausalityLoop`), so depth 1 on the evaluated trace
   would block every later evaluation of it.
5. **Probe-drop exemption** for origin `evaluation`, so tool-only judge answers are kept.
6. **Metric names** configurable (`langwatch.nlpgo.evaluators.*` instead of `langwatch.gateway.*`).

Better than shipping the long-lived project key: TS mints a short-lived, ingest-only token per
evaluation (decision D3). The fingerprint routing works for either.

### 6.2 Our pile (findings 6, 8)

A dedicated ops tracer provider in the module, not nlpgo's global multi-tenant one. The evaluation
ops span carries an **allowlist**: evaluator type, model, provider, token counts, cost, status,
error code, duration, entry count, skip reason code. A test runs an evaluation whose entry text
is a canary string and asserts it appears on no ops span or log line. Decision D5 settles whether
the studio moves onto the bridge too.

### 6.3 Billing (finding 9)

Evaluation-origin spans are exempt from the `SPAN_RECEIVED` meter; the evaluation is already a
billable unit (decision D4). `result.cost` keeps its meaning: Go prices `Usage` with the gateway's
pricing tables and reports it per entry.

## 7. The catalogue (finding 5)

Go owns the evaluator definitions: `rules/evaluator_definitions.go` is the source, and
`go generate` writes `modules/evaluator/contract/src/evaluators.generated.ts` at the same path, so
its ~15 consumers (`start:prepare:files`, Dockerfiles, `verify-generated-files.sh`,
`sdks/typescript/copy-types.sh`, `mcp/typescript`, `docs/scripts/generate-openapi-evals.ts`)
change only their source command. The first change ports the definitions and proves the generated
file byte-identical to today's (decision D8 offers the alternative: TS hand-owned, Go
parity-tested against it). The docs generator's fetch of
`raw.githubusercontent.com/langwatch/langevals/...` switches to the in-repo file.

## 8. Evaluators

### 8.1 Inventory

| Family                  | Evaluators                                                                                                                                                                                          | Kind                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `langevals/` pure       | exact_match, basic, competitor_blocklist, valid_format                                                                                                                                              | rules; SQL validation needs a Go SQL parser for sqlglot |
| `langevals/` embeddings | sentiment, similarity                                                                                                                                                                               | `Embed` + cosine                                        |
| `langevals/` judges     | llm_boolean, llm_score, llm_category, llm_answer_match, competitor_llm, competitor_llm_function_call, off_topic, query_resolution, select_best_compare, pairwise_compare (deprecated, decision D11) | judge loop, forced tool call                            |
| `ragas/` non-LLM        | bleu_score, rouge_score, context_precision, context_recall, context_f1                                                                                                                              | rules, exact                                            |
| `ragas/` LLM            | faithfulness, factual_correctness, response_context_recall, response_context_precision, response_relevancy, summarization_score, rubrics_based_scoring, sql_query_equivalence                       | ragas loop, JSON in prompt                              |
| vendors                 | openai/moderation, azure/content_safety, azure/jailbreak, azure/prompt_injection                                                                                                                    | http channels                                           |
| language                | lingua/language_detection                                                                                                                                                                           | `lingua-go`                                             |
| PII                     | presidio/pii_detection                                                                                                                                                                              | §9                                                      |

Not ported: `aws/comprehend_pii_detection` and `google_cloud/dlp_pii_detection` (hidden, never
generated). `langwatch/api_keys_and_secrets_detection` is TS-native and unaffected.

### 8.2 The two judge loops (finding 17)

- **langevals judges** force a tool call. They carry `litellm_patch.py`'s behaviours, each bound to
  its spec: forced-tool refusal retry with a reminder and tool/reasoning conflict
  (`langevals-judge-reasoning-tool-compatibility.feature`), Anthropic sampling, GPT-5 temperature,
  long content and the token budget (`langevals-judge-long-content.feature`), the deadline.
- **ragas metrics** put the schema in the prompt: one user message, temperature 0.01 (0.7 for
  relevancy, 1.0 on GPT-5), only rate limits retried, `finish_reason=length` aborts, up to 3 repair
  calls. Providers that ignore `n` get 3 sequential calls for relevancy.
- **Multimodal and tool-call inputs** (`image_support.py`, `tool_calls.py`) port into the message
  building of both loops.
- **Tokeniser**: the token-limit skip counts with tiktoken's encodings chosen per model as
  `litellm.encode` does; entries within 2% of the limit are listed in the parity fixtures.

### 8.3 Ragas parity (findings 4, 16)

- **Recording**: run Python once over a fixed sample per metric, capturing every raw
  request/response pair (repairs, `n=3`, embedding vectors) keyed by the rendered prompt, plus the
  final scores and skip reasons. Committed under
  `services/nlpgo/modules/evaluators/services/testdata/ragas/`.
- **Replay** (unit, every CI run): the memory `LLMChannel` answers from the recording; a prompt
  with no recorded answer fails. Scores must match to 1e-9; skips must match by reason.
- **Live** (on demand): real judge model, tolerance per metric set to Python's own spread, measured
  by running Python three times while recording.
- **Non-LLM metrics**: exact to 1e-9 against recorded scores (BLEU's first-sentence rule, ROUGE's
  non-ASCII drop and NLTK Porter in `NLTK_EXTENSIONS` mode, rapidfuzz's distance definitions).
- **Rendering**: each rendered user message is byte-identical to the recording.

### 8.4 langevals judges parity

Same recording and replay as ragas, one sample per judge; the dspy prompt for
`llm_answer_match` is copied from the recording.

### 8.5 Vendors and language

Replay against recorded vendor responses; exact parity. `lingua-go` versions pinned to the
Python library's model data.

### 8.6 Clustering (findings 11, 12)

- Supersede the ruling explicitly in the same change: `specs/nlp-go/_shared/contract.md:22`,
  `specs/nlp-go/topic-clustering.feature`, `python-removal.feature:56`.
- Design: `dev/docs/plans/langevals-go/topic-clustering-go.md` (algorithm end to end, numerics,
  layout, fixtures, specs, estimate).
- Proven: a hand-written Go Ward linkage (NN-chain) + `fcluster` matched scipy 1.17.1 on 9
  datasets up to n=5,000 at dim 1,536: identical merges and labels, heights within 1.1e-14,
  centroids bit-identical, p95 within 3.3e-16; 3 to 5 times faster on 10 cores. gonum has no
  hierarchical clustering and no maintained Go library matches scipy, so it is ~200 lines by hand.
- Size: Python is 1,428 lines; Go ~1,280 lines of code plus ~1,130 of tests and fixtures.
- Parity: exact cluster membership and heights within 1e-12 (arm64 fused multiply-add rules out
  bit identity). Naming prompts are shuffled unseeded in Python, so naming parity is the call
  plan plus a shadow run, not replay.
- Decided (Alex, 2026-09-30): the three Python incremental defects (a never-created parent id for
  new subtopics, null ids at 100 or fewer unassigned, duplicated traces) are fixed in Go, not
  ported; embeddings are priced through the gateway's pricing behind a switch that starts off; an
  unpriced chat model names at zero cost instead of producing no topics; 4 embedding batches in
  flight (design doc §9).

## 9. PII

```go
// channels/pii_analyzer.go
type PIIAnalyzer interface {
    Covers() []contract.EntityType
    Analyze(ctx context.Context, req AnalyzeRequest) (AnalyzeResult, error)
}
type AnalyzeRequest struct {
    ProjectID string
    Text      string
    Entities  []contract.EntityType
    Language  string
}
type AnalyzeResult struct {
    Findings []contract.PIIFinding // {EntityType, Start, End, Score}
}
```

- **Default is simple** (Alex, 2026-09-30): nlpgo ships patterns only; any model is a `remote` analyser, never embedded.
- **Remote wire**: Presidio's REST shape: `POST <base>/v1/analyze` `{text, language, entities}` answering `[{entity_type, start, end, score}]`, so a plain presidio-analyzer or any model service speaking it plugs in.
- **Found in the port**: Presidio 2.2.364 ships the SG, AU and IN recognisers disabled for English; those settings never find anything today, and asking for only them errors. Go keeps that behaviour.
- **Who owns what**: data-privacy (TS) keeps the policy and the method choice, including Google
  DLP and `connect` (it has licensing and the org opt-in). nlpgo owns detection: patterns plus a
  configured analyser for what patterns cannot find.
- **Implementations in Go**: `remote` (our own model service or any compatible endpoint), `null`,
  and the memory twin. No `google-dlp` (data-privacy has it), no `presidio` (nothing to call after
  deletion; Presidio's answers become recorded fixtures). For `connect`, data-privacy passes the
  hosted endpoint and a per-request credential it obtained through licensing; the `remote` channel
  uses them for that request (decision D7).
- **The service asks** the analyser for `(requested − pattern-covered) ∩ analyser.Covers()`.
- **The answer keeps Presidio's shape**: findings plus `anonymized` text with `<ENTITY_TYPE>`
  replacements, overlap resolution and the JSON-escape behaviour of `pii_detection.py`, so
  `pii-analysis.rules.ts` and the model-id exemption do not change.
- **Null or failed analyser**: status `processed`, pattern findings applied, and the redaction
  marked incomplete, reusing `pii-redaction.feature`'s "incomplete strict redaction" scenario.
- **Scores**: patterns reproduce Presidio's base scores and context boosting (+0.35, floor 0.4,
  5-token prefix window; lemma matching approximated by a fixed word list per recogniser). Model
  analysers map to Presidio's scale: a finding above the model's calibrated threshold scores 0.85,
  as spaCy's did. Parity runs on pattern identifiers as well as names and places.
- **Limits**: text over 524,288 characters keeps TS's current handling; the analyser request text
  is never logged or traced.
- **Our model**: `services/piimodel`, same Go grammar, hugot + ONNX Runtime (cgo, hence not in
  nlpgo), `POST /v1/analyze` behind a Bearer key; its own chart entry; ONNX Runtime is
  linux/amd64-tested, so arm64 needs its own validation. Candidates:

| Model                                              | Licence                  | Notes                                                                                                 |
| -------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| A permissive BERT/DeBERTa PER/LOC token classifier | check per model          | Runs in hugot as-is; lowest-risk spaCy replacement                                                    |
| knowledgator/gliner-pii-base                       | Apache-2.0               | 197 MB UINT8 ONNX; ~200 lines of GLiNER span decoding in Go                                           |
| OpenAI Privacy Filter                              | Apache-2.0               | 1.5B MoE, no LOCATION label, weak real-world recall in one vendor benchmark                           |
| LiquidAI LFM2.5-Encoder-350M-PII                   | LFM1.0, terms unverified | Multilingual, strong claimed F1                                                                       |
| Piiranha                                           | CC-BY-NC-ND              | Not usable                                                                                            |
| Perplexity PII-Tracer                              | check                    | 0.6B, 13 languages, on-device focus; too large to embed, fine as a `remote` analyser an operator runs |

- **Data residency**: `connect` and a SaaS-hosted `remote` send trace text to LangWatch; per-org
  opt-in, DPA coverage and region pinning are part of the connect decision.

## 10. Specs and tests

- Every scenario carries its intended level now (`@unit @unimplemented`, `@integration
@unimplemented`) and the three files sit in `LEGACY_INERT` under the "planned, not yet built"
  block; each file leaves the list with its first binding.
- Steps are declarative: no env var names, package names or file paths in steps.
- Existing specs rebind to Go before their Python tests are deleted:
  `langevals-anthropic-sampling-compatibility`, `langevals-gpt5-temperature-compatibility`,
  `langevals-judge-long-content`, `langevals-judge-reasoning-tool-compatibility`,
  `langevals-evaluation-deadline`, `ragas-max-tokens`, `evaluator-generation-params`,
  `moderation-answers-every-entry`, `exact-match-loose-equality`, and the Python credential
  isolation and concurrency tests. Retired: `langevals-read-only-root` (gunicorn-only) and the
  evaluation half of `specs/langevals-staging/staged-payload.feature`.
- Memory twins throw by name on unscripted calls; an installation-style test builds the real
  module over memory twins; `services/piimodel` joins `DEFAULT_GO_TEST_ROOTS`.
- `comparison-config-form.judge-prompt-parity.unit.test.ts` reads the Go prompt template instead
  of `select_best_compare.py`.

## 11. Work plan

Each phase ends green on its own: scoped Go lint and tests, the parity checker, and the evaluator
flips it names. Nothing flips without replay parity.

**Phase 0: decisions and groundwork**

1. Take the decisions in §12.
2. Record the parity fixtures from Python for every evaluator (ragas, judges, vendors, clustering,
   Presidio on a labelled PII sample), with full request/response pairs.
3. Done: the ragas reference covers all 13 evaluators, including rapidfuzz string-distance parity (reference §4.1).
4. Confirm SaaS can reach a shared nlpgo over HTTP and check the SaaS Lambda env for
   Vertex fallback reliance.

**Phase 1: skeleton and security** (flips `langevals/exact_match`)

1. `modules/evaluators` with contract, config, errors, transport, `EvaluationService`, fair share,
   deadline, ops tracer with allowlist and canary test.
2. Internal bearer auth on the rpc transport + TS `Secret.load`; NetworkPolicy; safe dialer moved to `pkg/`.
3. `pkg/litellmparams` extracted; `channels/gateway` `LLMChannel`; memory twins.
4. Customer trace channel with the bridge changes of §6.1; the loop guard; meter exemption.
5. TS: `evaluatorRuntimeEndpoint`, per-evaluator engine switch, shadow mode, error-code mapping,
   project id + key (or scoped token) headers.
6. Catalogue: Go definitions, `go generate` emitting a byte-identical `evaluators.generated.ts`.
7. Isolation tests: two tenants concurrent; mismatched id/key pair; keyless request.

**Phase 2: deterministic evaluators** (flips exact parity only)
basic, competitor_blocklist, valid_format, bleu_score, rouge_score, context_precision,
context_recall, context_f1, lingua, sentiment, similarity, openai/moderation, azure ×3.

**Phase 3: langevals judges**
Judge loop with the `litellm_patch.py` behaviours; multimodal and tool-call inputs; the rebinding
of the `langevals-*` specs; flips each judge after replay parity and a shadow week.

**Phase 4: ragas LLM metrics**
Ragas loop, rendering, repair, tokeniser; the eight LLM metrics; flips after replay and shadow.

**Phase 5: clustering**
Supersede the ruling; Ward, assignment, incremental, naming; the clustering Deployment and staging
route; flip after membership parity.

**Phase 6: PII**
Patterns (all Presidio recognisers we request, with scores and boosting); `PIIAnalyzer` with
`remote` and `null`; anonymised text; data-privacy passing connect endpoint + credential;
`services/piimodel` with the chosen model; parity against recorded Presidio answers; flip.

**Phase 7: deletion**

- Code: `services/langevals` (evaluators, core, server, scripts, notebooks, docs site,
  ts-integration), `pyproject.toml` workspace entry, ADR-145 note, `python-uv-workspace.feature`.
- Library: final `langevals` release marked deprecated (decision D1), `langevals-publish-pypi.yml`,
  release-please entries, dependabot, `dev/docs/RELEASES.md`.
- npx CLI: `apps/server` langevals service, uv venvs and predeps, animation, distribution files,
  tests, `npx-server-publish.yml`, `npx-server-smoke.yml`, `specs/npx-installer/*`.
- Local and compose: `infra/compose.yml`, `dev/compose.dev.yml`, agentic-e2e compose,
  `dev/scripts/*`, Makefile targets, `tools/thuishaven/app/play.go`, `.githooks/post-checkout`,
  `tools/featureparity`, `tools/visualdiff`, `dev/docs/LOCAL_STACK.md`.
- Helm: `templates/langevals/*`, helpers, values, examples, chart Makefile, sizing test and its CI.
- Docker and CI: both langevals Dockerfiles, `langevals-ci.yml` (un-require `langevals-complete`
  first), `publish-docker-ecr.yml`, `sign-release-images.yml`, `e2e-ci.yml`, `visualdiff.yml`,
  `codeql.yml`, `code-scanners.yml`, `pr-impact-map.yml`, deployment-impact guards.
- TS: the engine switch, `LANGEVALS_ENDPOINT`, evaluation staging, `warmupLambda`/`warmupEvaluators`,
  `hasLangevals` → an availability answer from the evaluator runtime.
- Parity checker: drop `services/langevals` from `DEFAULT_PYTHON_TEST_ROOTS` after rebinding.
- Out of repo: the per-evaluator Lambdas, their IaC, the S3 staging prefix and IAM.
- Docs: self-hosting (architecture, images, sizing, security, troubleshooting), links to the
  langevals repo.
- Record: §1 table (`services/piimodel`), §3.3 staging line, §3.5 availability row,
  `specs/nlp-go/_shared/contract.md` posture and clustering non-goal.

## 12. Decisions

| #   | Decision                                                 | Recommendation                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The `langevals` PyPI library                             | **Decided:** final release marked deprecated pointing at LangWatch evaluations; archive                                                                                                                                                                                                               |
| D2  | Inbound auth on `/go/evaluators/*`                       | **Decided:** the Go services' internal RPC auth (langyagent's bearer secret + `pkg/rpc`), plus NetworkPolicy                                                                                                                                                                                          |
| D3  | Trace credential                                         | **Decided:** short-lived ingest-only token minted by TS per evaluation; fingerprint routing either way                                                                                                                                                                                                |
| D4  | Do evaluation spans count as billable spans?             | No; exempt origin `evaluation`                                                                                                                                                                                                                                                                        |
| D5  | Move the studio from `TenantRouter` onto the bridge      | Yes, after phase 1, so nlpgo has one customer pile                                                                                                                                                                                                                                                    |
| D6  | Clustering                                               | **Decided:** ported last (phase 5), superseding the ruling, in its own nlpgo Deployment with S3 staging kept for large payloads                                                                                                                                                                       |
| D7  | `connect` for PII                                        | data-privacy decides and passes endpoint + credential per request                                                                                                                                                                                                                                     |
| D8  | Catalogue source of truth                                | Go definitions generate the TS file                                                                                                                                                                                                                                                                   |
| D9  | New `gateway` channel tier for the in-process dispatcher | Yes, Go only                                                                                                                                                                                                                                                                                          |
| D10 | A Go secrets mechanism (`Secret.load` equivalent)        | Resolve in `deps.go` now; a `pkg/secret` later                                                                                                                                                                                                                                                        |
| D11 | Port the deprecated `pairwise_compare`                   | Only if it has usage in the last 90 days                                                                                                                                                                                                                                                              |
| D12 | Per-project concurrency limit                            | 8 in flight per project, 64 global                                                                                                                                                                                                                                                                    |
| D13 | Who hosts the PII model for self-hosters by default      | `null` until the sidecar is enabled in the chart                                                                                                                                                                                                                                                      |
| D14 | Rollout switch                                           | **Decided:** Python stays the production path; Go only behind an explicit flag (haven `+go-evaluators` in dev; chart values default off; nlpgo mounts `/go/evaluators` only with its secret)                                                                                                          |
| D15 | `valid_format` python and sql modes                      | **Decided:** best-effort Go parsers measured against the recorded fixtures; a mode short of parity keeps the evaluator on Python                                                                                                                                                                      |
| D16 | `lingua/language_detection`                              | **Decided:** Fork C: vendored lingua-go v1.4.0 in `third_party/`, flat models generated at build time into a file the nlp image ships and nlpgo maps at boot (`NLPGO_LINGUA_MODELS`; no build tag), Rust tokeniser regex; 1e-15 parity, ~7 MB anonymous RSS (measurements: the lingua research notes) |
| D17 | Where evaluators run in production                       | Proposed: in place in a shared nlpgo Deployment, SaaS and self-hosted alike; no Lambda for evaluators (§13)                                                                                                                                                                                           |
| D18 | Language for new code blocks                             | Open: Starlark in place is the recommendation; Python stays on the per-project Lambda (§13.3)                                                                                                                                                                                                         |

## 13. Production shape

### 13.1 Why evaluators no longer need Lambda

SaaS runs langevals as one Lambda per evaluator (`infra/docker/Dockerfile.langevals.lambda`, one
`uv` extra each; `langevals/server.py:413`). Lambda was there for Python's reasons: each
evaluator's heavy dependencies in its own image, and scaling to zero. The 6 MB synchronous body
cap it brought is why evaluation payloads are staged through S3 (`langevals.channel.ts:1-4`).
None of that holds on Go:

- No tenant-written code runs. `valid_format`'s python mode only parses (`gpython` parser,
  `ExecMode` is the grammar, nothing executes); user regexes go through Go's linear-time
  `regexp`; Presidio's fixed patterns use `regexp2` with a 10 s match timeout.
- No model files to ship separately: lingua's models are embedded in the binary (~7 MB
  anonymous RSS), and there is no torch or spaCy.
- Outbound calls already go through the SSRF guards: judges and embeddings through the
  in-process gateway's customer-endpoint rules, vendors through `ssrf.SafeDialer`.
- Every call is bounded: 270 s deadline, 64 in flight globally and 8 per project, 16 MiB body,
  panics recovered. Topic clustering, which sits outside the per-project limits, now refuses
  more than 5,000 traces (about 100 MB of distances; the app sends at most 2,000).

So evaluators run in place in nlpgo, behind the internal secret and the NetworkPolicy (§5.1).
Ideally as their own Deployment of the same image, so a burst of judges cannot starve workflow
runs. That needs the `--only` switch D6 plans for clustering (`--only topics`), which is not
built yet; `--only evaluators` would be its second value. The S3 staging for
evaluations goes with Lambda; clustering keeps it for bodies over 32 MB (§5.4).

What stays on Python: Presidio's PERSON and LOCATION entities, which need its NER model
(`NLPGO_PII_ANALYZER_URL`), and data-privacy's trace redaction, which calls Presidio through
`LANGEVALS_ENDPOINT` (`presidio-redaction.service.ts:71`). One small in-cluster Presidio
service covers both until they are replaced.

### 13.2 Code blocks stay isolated

Code blocks are the one place tenants run their own code. Today nlpgo runs them as a CPython
subprocess (`codeblock.go`): an env allowlist, a fresh temp dir, its own process group and a
600 s timeout, but no memory limit, no seccomp or namespaces, and full network (blocks are given
`requests` and `httpx` on purpose). In SaaS the real boundary is the per-project Lambda
(`langwatch_nlp-<projectId>`, 2048 MB, VPC rules on egress; `nlp-lambda-config.rules.ts`).
That stays. Self-hosted runs every project's blocks in the shared nlp pod, which is fine for a
single trusted tenant and should be documented as such.

### 13.3 A sandboxed language for new code blocks

A language that runs in place, safely, would remove the Lambda cold start for new blocks.
Candidates that embed in Go:

| Option                                                     | Per call                                            | Isolation                                                                                    | Close to today's Python                                                     |
| ---------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Starlark (`go.starlark.net`, already in `services/go.mod`) | microseconds to start; slower than CPython per step | No file, network or env access unless given; step limit and cancel; no memory cap of its own | Python syntax, dicts, lists, strings; no classes, `try`, `while` or imports |
| goja (JavaScript in Go)                                    | about 1 ms per runtime, pooled                      | Interrupt for time; no memory cap                                                            | A different language                                                        |
| QuickJS compiled to wasm under wazero                      | milliseconds with a module cache                    | Strongest in place: hard memory cap, fuel or timeout, no host access                         | A different language                                                        |
| Pydantic Monty under wazero                                | microseconds native, more in wasm                   | Hard memory cap through wasm                                                                 | Python subset; young                                                        |
| CEL / expr                                                 | nanoseconds                                         | Not Turing-complete, cost limits                                                             | Expressions only                                                            |

Recommendation: Starlark. It reads like Python, it is already a dependency, and it has hard step
limits and no outside access unless the host grants it. HTTP, JSON and the LangWatch client become
host functions, with HTTP going through `pkg/ssrf`. If a provable memory cap is required,
QuickJS under wazero is the stronger sandbox, but blocks would be JavaScript.

Migration: a block gets a language field. Existing blocks stay `python` and keep running where
they run today. New blocks default to Starlark and run in place. Python blocks are deprecated
once their count is low, and the per-project Lambda fleet is retired with the last one.

### 13.4 Measured speed

Apple M1 Max (arm64, as the Lambdas), the same recorded fixture inputs on both sides, 21 Oct
2026, with other work on the machine (±20%). Reproduce the Go side with
`make lingua-models && go test -run '^$' -bench BenchmarkEvaluate ./nlpgo/modules/evaluators/services/`.

Every langevals call over HTTP, so every Lambda call, waits at least 100 ms in a sleep:
`evaluate_batch` resets `_tqdm_disabled_once` and `_disable_tqdm` then sleeps 0.1 s
(`langevals_core/base_evaluator.py:442-453`). That sleep is most of the gap.

|                                                                                  | Go                                                 | langevals                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| One call in process, p50 (exact_match / rouge / context_f1 / PII regex / lingua) | 4.5 / 4.3 / 4.3 / 33 / 500 µs                      | 21 / 258 / 416 / 3,430 / 589 µs                         |
| One call over HTTP, warm, p50                                                    | 0.07 ms (lingua 0.65 ms)                           | 105 to 137 ms                                           |
| 32 concurrent, exact_match                                                       | 67,900 a second                                    | 306 a second                                            |
| LLM judge overhead, instant fake model                                           | 0.37 ms                                            | 109 ms (2.3 ms without the sleep)                       |
| Process start to first answer                                                    | 73 to 88 ms, every evaluator                       | 2.7 s (langevals) to 10 s (ragas) per evaluator package |
| Memory, idle / under load                                                        | 129 / 335 MB, every evaluator                      | 2.8 / 2.9 GB, every package                             |
| On disk                                                                          | 308 MB binary with lingua's models (63 MB without) | 1.7 GB of packages, plus the Python image               |

Most evaluators are 4 to 100 times faster in process; PII is about 100 times because langevals
runs spaCy's NER on every call even when only regex entities are on. Lingua is nearly a tie
(1.2 times), since Python's lingua is compiled Rust. langevals also retries entry errors that
can never succeed, such as a broken JSON schema, which takes about 8 s each.
