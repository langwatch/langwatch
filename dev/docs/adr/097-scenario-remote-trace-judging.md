# ADR-097: Scenario trace propagation and remote-trace judging

**Date:** 2026-08-15

**Status:** Accepted

## Context

Customers run scenarios from the platform against their own agents over HTTP. Those endpoints return final text only, so the judge cannot verify tool calls, table writes, or retrievals. A customer report showed the workaround this forces: the endpoint appended the list of tools used to the response text, and the judge still missed calls.

The platform already ships half of the mechanism. Every scenario HTTP call injects a W3C `traceparent` header (`injectTraceContextHeaders` in `serialized-adapters/http-agent.adapter.ts`), and a remote-span judge (`remote-span-judge-agent.ts`) polls `GET /api/trace/{id}` before evaluation. It has three defects. The adapter keeps one `capturedTraceId`, overwritten on every call, so a multi-turn scenario loses the remote spans of every turn except the last. The fetch runs on every judge call with a hardcoded 10 second wait, so every turn pays the wait even when the judge only decides to continue. And the capability exists only inside the platform: the open-source scenario SDKs have no trace propagation and no remote fetching, so code-first users have the same blind judge.

Custom header values also never pass the template engine. Secrets resolve, but `{{ params.X }}` in a header does nothing, so a system that needs a custom trace header cannot be served.

## Decision

We will treat the scenario runtime's existing per-turn trace as the propagation unit. The runtime already opens one trace per turn and stamps its id on each message. The HTTP call carries that turn's context as `traceparent`; when the customer's server adopts it, their spans join the same trace, in the same project, and the messages already point at the trace ids the judge must fetch.

We will move remote-trace judging into the scenario SDKs, in both languages, behind opt-in config: Python `fetch_remote_traces` / `trace_wait_timeout` (seconds), TypeScript `fetchRemoteTraces` / `traceWaitTimeoutMs`. Adapters receive propagation headers on `AgentInput` (`propagation_headers` / `propagationHeaders`). The judge fetches all message trace ids, converts the spans into the shape its digest already renders, dedupes against locally collected spans, and filters scenario infrastructure spans.

The judge itself becomes two-phase, which is what makes the latency contract possible: zero added wait per turn, full wait exactly once, at the verdict. A mid-conversation call is a decision only: continue the conversation or move to the verdict, expressed through two argument-free tools (`continue_test`, `make_verdict`). The decision carries no reasoning field and no per-criterion schema, so the judge cannot pre-commit to pass or fail before it sees the evidence, and it performs no remote fetching at all; the prompt leans towards continuing while the conversation is still short, since scenario exists to exercise multi-turn behavior. The verdict call, entered from a make_verdict decision, the last turn, or an explicit `judge()` checkpoint, settle-waits first: it polls every second under the shared timeout budget until the trace holds at least one remote span and every fetched agent span's parent resolves within the fetched and locally collected spans; the scenario's own spans echoed back by the platform are exempt from the parent check, since their parent is often the still-open local turn span. Ancestors finish and export after their descendants, so unresolved parents mean the trace is still arriving; span-count stability is deliberately not a settle signal, because ingestion arrives in chunks that can be tens of seconds apart. When the budget expires with remote spans present, the judge keeps every collected span and additionally sees a synthetic `langwatch.span_collection.error` span marking the trace incomplete; with no remote spans, or on a hard fetch failure, the synthetic span reports that nothing was collected. The judge prompt instructs that trace-dependent criteria go inconclusive, never passed on transcript claims alone, while criteria about the conversation itself judge normally from the transcript, so an agent that never adopted propagation still gets its conversation-level criteria evaluated as before. A voluntary verdict that comes back inconclusive continues the conversation only while trace evidence can still improve: when not one trace of the run ever settled, more turns cannot produce trace evidence, so the verdict stands instead of looping settle-wait after settle-wait to the turn cap.

The platform adopts the SDK capability for `http` targets and deletes its bespoke path (`remote-span-judge-agent.ts`, `bridge-trace-id.ts`, `remote-span-collector.ts`, `trace-api-span-query.ts`). The wait budget comes from the project's own ingest speed, measured on the store the trace API reads: per trace in `stored_spans`, the time from its last span ending to its last span being inserted (`max(CreatedAt) - max(EndTime)` grouped by trace), p95 over the last 7 days, as `clamp(1.25 * p95 + 5s, 10s, 120s)`, default 60s under 20 recent traces (matching the SDK default), cached in-process for 1 hour, computed at prefetch time and shipped to the child process. `trace_summaries` row arrival deliberately does not drive the budget: the summary row lands with the first ingested chunk in seconds, while the span set the judge fetches can trail it by tens of seconds.

Propagation also becomes reachable from templates and other target types. The Liquid context gains `{{ traceId }}` and `{{ traceparent }}`, header values render through a plain-text Liquid engine (secret fencing first), and code and workflow executions receive `params.trace_id` and `params.traceparent` at call time.

## Rationale / Trade-offs

Echoing tool calls into the response text grades a self-report instead of evidence and pollutes the product's real responses. A structured response envelope would force an API shape on every customer while the trace already carries the same facts in the standard both sides speak. Keeping the fetch platform-only is how the current defect happened: a private fork of judge behavior that upstream tests never exercise. Moving it into the SDKs gives code-first users the capability and leaves the platform as a thin configuration of it.

The decision-then-verdict split costs one extra judge LLM call per automatic run, accepted in exchange for two guarantees: every verdict is trace-informed, and the conversation is never cut short or stretched just to manage trace timing, since the decision call knows nothing about trace arrival. Parent resolution detects missing ancestors but not missing leaf subtrees, so it is a strong heuristic, not a completeness proof; the budget formula over-provisions and the incomplete-trace error span plus the inconclusive rule cover the remainder.

## Consequences

Judges can verify internal behavior for blackbox HTTP agents, and criteria like "the agent wrote the extracted requirement into the results table" become testable. Verdicts on HTTP targets wait for trace ingestion on the final turn, bounded by the per-project budget. The customer's server needs one change, adopting the incoming `traceparent` (zero lines under standard OTel HTTP auto-instrumentation), and must report traces to the same project that runs the scenarios. Non-HTTP targets keep the local judge; enabling remote fetch for workflow and code targets is a follow-up once nlpgo's participation in the propagated trace is verified.

## References

- Related ADRs: ADR-098 (agent dev tunnel)
- Specs: `specs/scenarios/http-header-templating.feature`, `specs/scenarios/remote-trace-judging.feature`, scenario repo `specs/remote-trace-fetching.feature`
- Review draft: https://nexus.langwatch.ai/wiki/scenario-remote-traces-adr
