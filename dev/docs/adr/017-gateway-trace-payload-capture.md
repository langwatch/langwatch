# ADR-017: Gateway Trace Payload Capture

**Date:** 2026-04-19

**Status:** Proposed (v1.1 scope)

## Context

The LangWatch AI Gateway currently produces rich OpenTelemetry spans on every `/v1/chat/completions`, `/v1/messages`, and `/v1/embeddings` request. Those spans carry:

- Request metadata: model, provider, http method/url, user_agent, virtual-key prefix, project id, origin=gateway.
- Response shape: status, latency, token counts (input/output/cache-read/cache-write), cost in USD, finish reason.
- Fallback chain state: attempts, which providers were tried, circuit-open flags, retry counters.
- Error signatures: upstream 4xx/5xx codes, exceptions.

What spans do **not** carry today is the message content itself — no prompt, no assistant completion, no tool-call arguments, no streaming deltas. Ariana's dogfood (finding #73) surfaced this: a gateway-routed request shows up in the LangWatch Messages view, but the "Messages" tab is empty.

This is not an oversight; it is a defensible default. The gateway is a thin proxy on the hot path with a sub-millisecond overhead target, and carrying arbitrary message payloads has meaningful privacy and compliance implications. But the cost of the default is real:

- **LangWatch Evaluations can't score gateway traffic.** Online evaluators (answer correctness, hallucination, custom LLM-as-a-judge) require the input + output content. A gateway-routed request is invisible to the eval engine.
- **Dataset extraction from gateway traffic is impossible.** Customers who want to build fine-tuning datasets from their production traffic have no content to pull.
- **Debugging semantic issues is blind.** "Why did this response go sideways?" is not answerable when only the metadata is visible.
- **Portkey and Bifrost both capture payloads by default.** LangWatch being the observability-first product but *not* capturing payloads reads as a feature regression, not a privacy stance.

The LangWatch platform already has a PII redaction infrastructure (configurable per project, applied server-side in the trace pipeline, with Presidio-backed entity detection). That infrastructure is the safety substrate for any payload capture at the gateway.

## Decision

We will add **opt-in, per-VK payload capture** to the AI Gateway, with three levels, enforced via the existing PII redaction pipeline. The default stays **off** — zero behavior change for current VKs.

Specifically:

1. **VK configuration field: `capture_payload`.** A new `capture_payload` enum on the virtual-key config, with four values:
   - `none` (default) — current behavior; no message content on spans.
   - `metadata_only` — capture role names and lengths (`{"role": "user", "content_length": 142}`), no content bytes.
   - `redacted` — capture full message content, run through the project's PII redaction pipeline before the span leaves the gateway pod.
   - `raw` — capture full message content with no redaction. Requires an explicit compliance acknowledgement on save; disabled by default at the org level.

2. **Redaction happens in the gateway, not the trace pipeline.** For `redacted` mode, the gateway calls into a redaction library (the same rules set the project's PII redaction uses) *before* stamping the span attributes. Rationale: trace pipeline redaction is a defence in depth, but the gateway is the authoritative boundary — a leaked raw prompt in a trace is a leaked raw prompt regardless of what the pipeline does next. Redact at the source.

3. **Streaming captures the reassembled message.** For streaming responses, the gateway already reassembles deltas for tool-call integrity. The reassembled final message is the one that gets captured (not every delta). Stream chunks are not individually traced.

4. **New span attributes.**
   - `langwatch.input` — stringified request messages, JSON-shaped like `[{"role":"user","content":"..."}]`.
   - `langwatch.output` — stringified completion.
   - `langwatch.input_redacted` / `langwatch.output_redacted` — boolean, true when redaction fired.
   These names match what the LangWatch trace pipeline already expects from SDK-instrumented clients, so evaluation and dataset extraction work identically regardless of capture source.

5. **RBAC gate.** Setting `capture_payload=raw` on a VK requires a new permission `virtualKeys:capturePayload:raw` that defaults to **nobody**. Org admins opt-in per-org via the settings UI. `metadata_only` and `redacted` require the existing `virtualKeys:update` permission. Audit-log entries on every change carry the before/after value so compliance teams can reconstruct who enabled what and when.

6. **Org-level kill switch.** An org-level setting `gateway.payload_capture_enabled` defaults to `true` in new orgs, can be flipped to `false` to disable all payload capture across every VK in the org regardless of per-VK config — a single global compliance lever.

7. **Size cap.** Captured payloads are truncated at 32 KB per field (input or output), with a `langwatch.input_truncated` boolean attribute when the cap fires. Rationale: OpenTelemetry span attribute limits and storage cost at the trace pipeline side. Extremely long contexts (200k-token) don't belong on hot-path spans.

## Rationale / Trade-offs

**Why opt-in, not opt-out.** Defaulting to capture would ship a regression for anyone dogfooding today: their VK traffic would suddenly start carrying message content, with no explicit consent. Opt-in respects the principle of least surprise — existing VKs keep current behaviour; customers who want the eval/dataset value check a box.

**Why four levels rather than a single toggle.** `metadata_only` is a meaningful middle ground: "I want to know what traffic shapes look like without seeing the actual content." Healthcare and finance customers routinely want message counts and role distributions without content. `redacted` is the main production path. `raw` is the research / internal-dogfood path.

**Why redact at the gateway, not at the trace pipeline.** Defense in depth is good, but the first line of defense is where the data enters a logged channel. If an SRE gets a gateway pod dump during an incident, we don't want raw payloads in the in-memory span buffer. Redaction at source keeps the gateway itself compliant.

**Why keep the trace pipeline's redaction too.** Defense in depth. The pipeline already redacts SDK-sourced traces; applying it to gateway traces too means a single code path for post-capture safety, and catches any gateway-side redaction bug before the data leaves the ingest.

**Why not just let the customer SDK-instrument.** An SDK already captures payloads. But the customer writing the SDK call and the customer hosting the VK are different people in the enterprise case. The gateway is often the *only* surface the platform team controls. Gateway-side capture is the only path that gives the platform team observability without depending on every SDK caller to instrument correctly.

**Size cap of 32 KB.** Bigger than most chat prompts (a 32k-token context is ~100 KB of UTF-8, and most chats are a fraction of that). Small enough that a single span doesn't dominate storage. Prior art: OpenTelemetry span attribute default limits are 128 entries at 128 KB total per span.

## Consequences

**Positive.**
- LangWatch Evaluations work on gateway traffic — the killer-feature integration that was missing.
- Customers can dataset-extract from gateway traffic for fine-tuning, A/B testing, prompt optimization.
- Debugging semantic issues becomes tractable.
- Feature parity with Portkey / Bifrost on captured content; observability-first positioning is consistent with actually being able to see the content.

**Negative.**
- Complexity. Three new fields on the VK config, a new RBAC permission, an org-level kill switch, a size cap, and an audit trail.
- Compliance review overhead. Healthcare / finance / government customers will want to review the redaction guarantees explicitly. The doc story has to be tight.
- Hot-path cost. Redaction runs inline on every request when `capture_payload=redacted`. Ballpark: 200 µs–2 ms per request depending on content size and the PII pipeline's entity set. The gateway's overhead target rises from ~11 µs to ~2 ms when redacted capture is on — we have to be explicit about this in the feature docs. `none` and `metadata_only` stay under the sub-ms budget.
- Storage. Payload-carrying spans are 10–100× bigger than metadata-only spans. Trace-pipeline retention cost scales accordingly. Customers opting into capture should be on the corresponding billing tier.

**Neutral.**
- The gateway's position as a governance boundary becomes more defined — it is now explicitly the place where payload-visibility policy is enforced, not just auth and budget.
- The cross-linking between VKs and Evaluations deepens. Customers who attach an evaluator to a VK will naturally want `capture_payload=redacted` as the precondition. Surfacing this linkage in the VK edit UI is a follow-up.

## References

- Finding #73: @ariana gateway-trace dogfood (channel #langwatch-ai-gateway, 2026-04-19)
- ADR-001: RBAC (permission model this extends)
- ADR-005: Feature flags (rollout behind `release_gateway_payload_capture_enabled`)
- LangWatch PII redaction pipeline: `langwatch/src/server/traces/redaction/` and [Presidio docs](https://microsoft.github.io/presidio/)
- Feature spec to follow: `specs/ai-gateway/payload-capture.feature` (v1.1)
- Related v1.1 items: finding #24 (ClickHouse ledger), #72 (principal_id propagation) — both touch the same span-attribute surface
