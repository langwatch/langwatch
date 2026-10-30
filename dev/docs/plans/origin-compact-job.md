# Plan: origin resolution queues only identifiers

Ruled by Alex, 2026-10-20 (design option a).

## Why

A trace whose spans carry no `langwatch.origin` gets a delayed job, `deferredOriginResolution`, scheduled on its first span and run five minutes later. If nothing set an origin by then, it sends `resolveOrigin` with origin `application` and reason `deferred_fallback`. Today that job's body is the whole first `span_received` event (gzip, about 3-4 KB with routing metadata), held in Redis for five minutes per trace: about 115 MB at 95 traces per second, measured under load.

Origin is not only a label. The evaluation and automation subscribers wait on it through the pending-origin guard (`modules/trace/contract/src/features/ingest/trace-origin-guards.ts`), so neither read-time defaulting (silent traces would never be evaluated) nor immediate projection defaulting (evaluations would fire before a late scenario or evaluation span) is acceptable.

## Decision

Keep the five-minute wait, the post-fold eligibility check, the per-trace deduplication (first span sets the deadline; later spans neither move it nor replace it) and the fallback command. Change only what the queued job carries: tenant id, trace id and the lookup timestamp. Never span content.

## Where origin comes from (for the characterisation specs)

- Span and resource attributes, legacy inference (evaluation and scenario scopes, optimisation studio metadata, scenario labels, evaluation run ids) and the root SDK heuristic: `modules/trace/contract/src/features/attribute/trace-origin-hoisting.ts`.
- SDKs, platform executions (playground, workflow, studio, scenario relay, experiment cells, evaluators), NLP, gateway, Langy and ingest-key policies set explicit origins.
- The deferred path: `modules/trace/process/src/eventing/deferred-origin.subscriber.ts`, its wiring and the legacy job adapter in `trace-processing.pipeline.ts`, the `resolveOrigin` handler in `trace-origin.commands.ts` (emits `lw.obs.trace.origin_resolved`), and the summary and analytics projections, which fill only an absent origin.

## Compatibility (ARCHITECTURE §9)

- Never rename an event, job or queue name. Jobs already queued under `originGate`, `job:deferredOriginResolution` and `subscriber:deferredOriginResolution` with the old full-event body must still drain correctly.
- Readers ship before writers: workers that read both the old and the new body upgrade first; producers switch to the compact body only once every worker reads it.
- Projection replay never schedules effects; stale events stay excluded; command idempotency and both folds' no-overwrite rule stay.

## Slices

1. **Characterise today's behaviour** (specs plus tests, no behaviour change): child span before root; explicit, resource and legacy origins; a late root; evaluation-child protection; silent OTEL traces resolved to application after the deadline; stale events never scheduling; what readers show before the deadline.
2. **Dual-format consumer**: the deferred handler accepts both the old full-event body and the compact body; retries, crashes and a missing summary behave as before; dedup and deadline unchanged; replay without effects. Projection subscribers need typed compact job bodies (event subscribers already support them, `packages/eventing/src/subscribers/eventSubscriber.types.ts`); extend that to projection subscribers.
3. **Compact producer**: schedule the job with only tenant, trace id and timestamp. Prove unchanged evaluation and automation outcomes and that no span content reaches Redis; measure the encoded body plus Redis overhead (target well under 1 KB per waiting trace, against about 4 KB today).

Slices 2 and 3 may ship in one release only if the producer switch sits behind a setting that defaults to the old body until workers have upgraded; otherwise slice 3 is the next release.
