# ADR-028: Plan-based visibility windows via stateless service-layer teaser redaction

**Date:** 2026-06-11

**Status:** Proposed

> One-line: for Free orgs, trace **content older than 14 days** is **truncated server-side to a ~10% teaser** (existence, timestamps, and aggregates stay fully visible) by **stateless read-time redaction at the service layer**, across **UI, REST/SDK, share links, and exports** — deletion stays at the 49-day retention floor, and upgrading lifts the blur instantly because nothing is ever stored.

## Context

Issue #4745. PR #4720 provisions organization-scoped retention policies at the 49-day platform floor on paid entry points — behaviorally inert today; this ADR is the feature it was built for. [ADR-027](./027-storage-gb-billing.md) (storage billing) references the 14-day Free visibility window in its customer matrix and explicitly defers the read-path mechanism to this decision.

The model (from #4745): the 49-day deletion floor is **not** a limitation — it is the *action window*. Pricing tiers are expressed as **visibility** windows on top of a fixed deletion policy. Free users' data past 14 days is not gone; it is held as a recoverable upgrade incentive until retention deletes it at 49 days.

Hard constraints (locked):

1. **49-day deletion floor stays.** `MIN_RETENTION_DAYS = 49` and weekly partitions unchanged; pricing-page numbers are blur thresholds, never retention policies.
2. **Instant recovery on upgrade.** No restore job, no rehydration — upgrade lifts the blur on the next read.
3. **Reuse plan resolution.** Thresholds resolve through the existing composite `planProvider.getActivePlan()` (Stripe / license); no new plan source.
4. **Self-hosted unlicensed gets the Free experience.** Visibility windows are a license lever, consistent with ADR-027's license-as-feature-gate.

Blast radius is customer data access: over-redaction reads as data loss for paying customers; under-redaction gives Free the paid feature; a misplaced gate is a leak. Full rigor: invariants with test anchors, mandatory red-team.

Read-path reality (verified in code): all user-facing reads thread `startDate`/`endDate` (`sharedFiltersInputSchema`, `src/server/analytics/types.ts`) into services (`TraceService`, `TraceListService`, `AnalyticsService`) which call ClickHouse repositories that build `timeRange` WHERE clauses (`src/server/app-layer/traces/repositories/trace-list.clickhouse.repository.ts:43-68`). There is no single choke point across tRPC, REST, share links, and exports — but all of them pass through the service layer. No read-path plan checks exist today.

## Decision

### 1. Teaser redaction, not hiding, not UI blur

Free users see that traces older than 14 days **exist** — rows in lists, timestamps, durations, status, costs — but content is **truncated server-side to a deterministic teaser**: the first `max(50, min(300, ceil(length × 0.10)))` characters per text field — where `length` and the kept prefix are counted in **UTF-16 code units** (JavaScript `String.prototype.length`/`slice` semantics; the single implementation lives in `teaserOf`, so no cross-stack drift is possible). **Content** is classified broadly (red-team finding): input, output, span payloads, messages, log bodies, **`params` and `metadata` string values, and error/stack bodies** — errors routinely embed prompts. **Metadata** stays visible: model name, ids, timestamps, durations, token counts, costs, status. Structured payloads truncate the JSON-stringified value with the same rule — and since system prompts live at the *head* of typical LLM payloads, the head is what the cap protects against: 300 chars of a multi-KB payload exposes a fragment of the system prompt's opening, accepted as exactly the teaser's purpose, never more. The response carries `redacted: true` plus the plan threshold so every surface renders the upgrade CTA: *"your data is still here — upgrade to see it."*

Why teaser over the alternatives: full hiding (clamping the time window) kills the upsell — users can't miss what they can't see. UI-only blur ships the full payload to the browser — indefensible at this blast radius. The ~10% teaser is the memory hook ("oh right, I need that trace") while leaking nothing material; the 50-char floor keeps tiny traces legible as teasers, the 300-char cap stops large traces from leaking meaningful content.

### 2. Gate at the service layer — stateless, plan-aware, repos stay plan-blind

There are **two service stacks** reading trace content, and both get the gate (red-team finding: the draft's single-stack assumption was false): the legacy `TraceService`/`TraceListService` path, and the app-layer services (`app.traces.*` — span storage, trace summaries) that `tracesV2` and newer REST routes call directly without ever touching `TraceService`. The export and share paths wrap one of these two stacks. Redaction is applied to response objects after fetching, before returning. Per request: resolve `organizationId` from `projectId` (cached, existing `resolveOrganizationId`), resolve the plan (`planProvider.getActivePlan()` — a **local Prisma `subscription`/license read**, not a Stripe API call; cheap and cacheable), compute `visibilityCutoff = now − visibilityDays`, and redact content fields of any trace whose `OccurredAt`/`StartedAt` is older.

**Plan-resolution failure fails closed.** If `getActivePlan` throws, the read is redacted as Free (and the event alerted). A leak is irreversible; over-blur is a refresh away — and a failing plan store usually means the read fails anyway.

**Composition order: permission redaction first, teaser second.** The teaser runs at the END of `applyTraceProtections`/`applySpanProtections`, after the existing `canSeeCapturedInput`/`canSeeCapturedOutput` redaction. A field the user may not see at all stays `[REDACTED]`/omitted — the teaser never resurrects it; a field they may see gets teased. The no-content-escape tests assert post-composition output, so an order flip that leaked would fail them.

**Enforcement is structural, not conventional.** N call sites guarded only by reviewer vigilance is the wrong posture for a data-access invariant. The no-content-escape integration suite (one test per surface, see Invariants) is the merge gate; any new read surface for trace content must add its test or fail review by rule, and a sweep for direct repository reads of content columns runs at implementation time.

Rejected layers: tRPC middleware can only clamp date inputs (fits hiding, not redaction) and misses REST/exports; repository WHERE-injection spreads plan-awareness into 6+ repos, violating the layering in [ADR-019](./019-repository-service-layering.md). Repositories remain plan-blind; plan logic lives exactly once, in a shared `VisibilityWindowService` both service stacks call.

### 3. Aggregates stay full — only content is gated

Analytics, time-series, counts, costs, latency charts include data beyond the threshold: they expose signal, not content. The blur applies on drill-down — trace detail, span trees, messages, log bodies. Metrics continuity also prevents the "my dashboard lost history" misread of the blur as deletion.

### 4. All read surfaces in v1

App UI (tRPC list/detail/spans), **REST API / SDK reads**, **public share links**, and **exports/CSV** all pass through the same service-layer redaction. An ungated API would make the UI gate decorative (any Free user scripts around it with an API key); an ungated share link would make sharing the bypass. Exports redact the same content columns.

### 5. Thresholds: Free 14 days; everyone else unblurred

`PlanInfo` gains `visibilityDays: number | null` (`null` = no blur). Free plans (SaaS Free and self-hosted unlicensed, which resolve to `FREE_PLAN`) get `14`. All paid tiers, Enterprise, and license holders get `null` — their visibility equals their retention window: if the data exists, it is fully visible. One number to maintain; a future per-tier ladder is a `PlanInfo` config change, not a redesign.

### 6. Stateless read-time evaluation — instant in both directions

Every read evaluates the **current** plan against the trace's age (`now − OccurredAt`, the same partition-aligned column repositories already filter on). Nothing is stored, flagged, or migrated. Upgrade → next read is unblurred (locked constraint, satisfied by construction). Downgrade or cancellation → content older than 14 days re-blurs on the next read, answering #4745's open cancellation question with zero state: no grace-period timestamps, no cleanup jobs, no per-row flags.

## Constants

| Constant | Value | Purpose |
|---|---|---|
| `FREE_VISIBILITY_DAYS` | `14` | Free-tier blur threshold; lives on `FREE_PLAN.visibilityDays` (both FREE configs — SaaS and self-hosted) |
| `PlanInfo.visibilityDays` | `number \| null` | `null` = no blur (all paid/licensed plans) |
| `TEASER_MIN_CHARS` | `50` | Floor so tiny traces still tease |
| `TEASER_MAX_CHARS` | `300` | Cap so large traces don't leak content |
| `TEASER_FRACTION` | `0.10` | `keep = max(50, min(300, ceil(len × 0.10)))` per text field |
| Age anchor | `OccurredAt`/`StartedAt` vs `now()` at read time | Same column retention/partitioning uses; no new columns |

## Invariants

| Invariant | Meaning | Test anchor |
|---|---|---|
| **No content escape** | No surface (tRPC, REST, share, export) returns >teaser chars of any text field of a beyond-window trace for a Free org | Integration test per surface: Free org, 15-day-old trace, assert every text field ≤ teaser length and `redacted: true` |
| **Paying users never blurred** | Any org whose plan resolves `visibilityDays = null` gets byte-identical responses to today | Integration test: paid org, 40-day-old trace, deep-equal against unredacted fixture |
| **Instant lift / instant re-blur** | Plan change flips redaction on the next read with no intermediate state | Test: same trace read under Free → blurred; flip plan provider to paid → unblurred; flip back → blurred. No DB writes between reads |
| **Aggregates unaffected** | Analytics totals are identical with and without the gate | Test: analytics over a window spanning the threshold equals pre-gate fixture |
| **Existence preserved** | List counts and trace metadata (ids, timestamps, durations, status, cost) identical for Free before/after gating | Test: list endpoint row count + metadata fields unchanged; only content fields shortened |

## Schema

None. No Prisma migration, no ClickHouse migration, no new columns — the design is deliberately stateless. The only type change is `visibilityDays` on `PlanInfo` (license schema note: adding a field with a default does not break already-issued license signatures; removing would — see the license-signature constraint).

## Rejected alternatives

- **Hide entirely (clamp time windows).** Kills the upsell surface; users can't want back what they can't see.
- **UI-only CSS blur.** Full payload still leaves the server; devtools defeats it. Indefensible for a data-access gate.
- **tRPC middleware input clamping.** Only fits the hide model; misses REST/share/exports.
- **Repository WHERE-clause plan injection.** Spreads plan-awareness across 6+ repos against ADR-019 layering; redaction is response shaping, which is service-layer work.
- **Per-plan visibility ladder in v1.** More PlanInfo state and pricing copy to keep honest; the single Free threshold is the actual offer today. Ladder remains a config change later.
- **Downgrade grace period.** Requires storing downgrade timestamps and a second threshold — state purchased to soften an edge the stateless model handles predictably.
- **Ingestion-time age anchor.** Differs from trace time only for backfilled data; needs a column some tables lack.

## Consequences

**Positive.**
- The 49d floor + 14d blur turns retention into a recoverable upgrade window instead of silent data loss — the exact intent of #4745, with the teaser as a concrete memory hook.
- Zero state: no migrations, no jobs, instant plan-change semantics both directions by construction.
- Plan logic in exactly one new service; repositories untouched and plan-blind.
- ADR-027's customer-matrix story (14d visibility / 45–49d recovery) becomes real before the billing notice goes out.

**Negative.**
- Redaction cost is per-read CPU on the service layer (string slicing per text field). Negligible per trace; bounded on lists by page size.
- Every read surface must route through the redacting services — a new REST endpoint that queries repositories directly bypasses the gate silently. Mitigation: the no-content-escape integration suite runs per surface, and code review treats direct repository reads of trace content as a flag (sweep at implementation time).
- Teaser truncation of JSON payloads can produce syntactically broken JSON heads — surfaces must render them as text teasers, never parse them.
- Share links created by paid orgs that later downgrade re-blur retroactively — correct per the stateless model, but support must know it's by design.

**Neutral.**
- Aggregates remaining full means a determined Free user can mine some signal (counts, costs) from old periods. Accepted — that signal is the dashboard's value, not the trace content's.
- Self-hosted unlicensed sees the blur on their own hardware; consistent with license-as-feature-gate (ADR-027), and the unlock is the license, not a config flag.

## Open questions

None blocking. Two implementation notes for the build PR: (a) the exact field list per payload type (span input/output, messages, log bodies, contexts) is enumerated at implementation against the response DTOs; (b) UI CTA copy and placement is a design task, not architecture.

## Revisions

- **v2** (2026-06-11, post devils-advocate red-team) — four corrections:
  1. **Two service stacks, not one (P0).** `tracesV2` reads spans via app-layer services without touching `TraceService`; the gate now explicitly covers both stacks, and enforcement is structural (per-surface no-escape tests as merge gate) rather than reviewer vigilance.
  2. **Plan source corrected (P1).** `getActivePlan` is a local Prisma read, not a Stripe call; framing and cost analysis fixed.
  3. **Fail-closed on plan-resolution error** — new fork surfaced by the red-team, locked by Sergio: unknown plan redacts as Free, with alerting.
  4. **Content classification widened (P2).** `params`/`metadata` string values and error/stack bodies are content; JSON-head truncation's system-prompt exposure bounded by the 300-char cap and documented.

- **v1** (2026-06-11) — drafted via parc-ferme. Round 1 locked: teaser redaction over hide/CSS-blur (user-corrected to the 10% truncation model), service-layer gate, aggregates stay full, all four surfaces in v1. Round 2 locked: `max(50, min(300, ceil(len×0.10)))` teaser rule, Free-14d-only threshold matrix (`visibilityDays: null` for all paid), stateless read-time evaluation (instant both directions, answers #4745's cancellation question), `OccurredAt` age anchor.

## References

- Issue: [#4745](https://github.com/langwatch/langwatch/issues/4745) · Provisioning mechanism: PR #4720
- Related ADRs: [ADR-019](./019-repository-service-layering.md) (layering), [ADR-022](./022-data-retention.md) (retention/TTL), [ADR-027](./027-storage-gb-billing.md) (storage billing; defers this decision)
- Code: `src/server/analytics/types.ts` (shared filters), `src/server/traces/trace.service.ts`, `src/server/app-layer/traces/trace-list.service.ts`, `src/server/app-layer/traces/repositories/trace-list.clickhouse.repository.ts`, `src/server/app-layer/subscription/plan-provider.ts`, `src/server/organizations/resolveOrganizationId.ts`, `src/server/data-retention/retentionPolicy.schema.ts`
