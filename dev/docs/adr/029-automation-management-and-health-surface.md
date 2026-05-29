# ADR-029: Automation management & dispatch-health surface in settings

**Date:** 2026-05-29

**Status:** Proposed

## Context

The settings automations list (`/[project]/automations`) shows name, action,
destination, filters, last-run timestamp, and an active toggle. That is enough
to see *that* an automation exists, but nothing about whether it is *working*.

As automations gain templates ([ADR-026](./026-liquid-templates-for-trigger-notifications.md)),
cadence ([ADR-025](./025-notify-persistent-action-classification.md)), and
outbox-backed dispatch ([ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md)),
the operator's real questions are operational:

- When did this last fire, and how often is it firing?
- Is anything **pending** (queued / in-flight) or **stuck** (failed / dead)?
- Did a notification **render with the default** because a custom template threw,
  or reference **missing variables**? [ADR-026](./026-liquid-templates-for-trigger-notifications.md)
  promised operators would see this; there is currently nowhere to see it.

[ADR-026](./026-liquid-templates-for-trigger-notifications.md) referred to an
"operator activity tab" for exactly these signals but did not specify where it
lives. This ADR places it on the automations settings surface.

## Decision

Enrich the automations list, plus a per-automation detail panel, with an
operational view sourced from the existing dispatch records:

- **Last triggered** and **fired count** — from `TriggerSent`
  ([ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md)), which already
  records every `(triggerId, traceId)` dispatch. Available immediately.
- **Pending / failed / dead** — counts from `ReactorOutbox`
  ([ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md)) grouped
  by `status` for the trigger.
- **Template-health warnings** — "rendered with the default due to a template
  error" and "N missing variables", the
  [ADR-026](./026-liquid-templates-for-trigger-notifications.md) operator
  signals, surfaced from the outbox row's `lastError` / a render-diagnostics
  field on the dispatched row.
- **Cadence** — the [ADR-025](./025-notify-persistent-action-classification.md)
  `notificationCadence` shown as a column (notify triggers only) once that phase
  ships.
- **Edit** opens the staged drawer from
  [ADR-028](./028-staged-automation-authoring-drawer.md).

### Querying the outbox by trigger

`ReactorOutbox` rows are keyed by `(reactorName, dedupKey)` and grouped by
`groupKey`, both `projectId`-prefixed and embedding the `triggerId`
(`${projectId}/${reactorName}:${triggerId}...`). Counting per-trigger health via
a `LIKE` on `dedupKey` is unindexed and slow. We will instead add an indexed
**`subjectId`** column (the `triggerId`) to `ReactorOutbox` so per-trigger health
is an indexed lookup. This is a small extension to the
[ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) schema.

### Layering

A read-only `TriggerHealthService` (or an extension of `TriggerService`) reads
`TriggerSent` and `ReactorOutbox` through repositories and returns a per-trigger
health summary; a tRPC query feeds the list. Transport stays thin — no
aggregation logic in the router.

### Sequencing dependency

The pending/failed/dead and template-health signals require **notify dispatch to
flow through the `ReactorOutbox`**. Today `triggerActionDispatch.ts` calls the
senders inline (the production dispatch is not yet outbox-backed — the wiring is
deferred). Therefore:

- **Ship now:** last-triggered and fired-count (from `TriggerSent`).
- **Ship with outbox-backed notify dispatch:** pending / failed / dead and
  template-health warnings.

The list is built so the outbox-derived columns light up when that dispatch
wiring lands, rather than requiring a second redesign.

## Rationale / Trade-offs

- **Reuse the dispatch records as the source of truth.** `TriggerSent` and
  `ReactorOutbox` already hold exactly the firing and dispatch-outcome data;
  surfacing them avoids a parallel metrics store that could drift from reality.
- **Indexed `subjectId` over `dedupKey LIKE`.** A trigger's health view is a
  per-row UI query that must be cheap; an unindexed prefix scan over the outbox
  is not acceptable. The column is cheap to add and also useful for any future
  "show me this trigger's dispatch log" view.
- **Graceful degradation by sequencing.** We do not block the management surface
  on the deferred dispatch wiring: the always-available `TriggerSent` columns
  ship first, and the outbox columns are additive.
- **Settings is the right home.** Operators manage automations in settings;
  putting health next to the edit action (rather than in a separate ops tool)
  keeps "see a problem → fix the automation" a one-screen loop, and satisfies the
  [ADR-026](./026-liquid-templates-for-trigger-notifications.md) operator-activity
  promise without a new top-level surface.

## Consequences

- **A new read path over `ReactorOutbox`** (a `TriggerHealthService` + repository
  method + tRPC query) and an indexed `subjectId` column on the outbox table.
- **The automations list page becomes the operator activity surface** referenced
  by [ADR-026](./026-liquid-templates-for-trigger-notifications.md).
- **Outbox-derived columns depend on outbox-backed notify dispatch.** Until that
  lands they render as "—"/empty; only `TriggerSent`-derived columns are
  populated. This is an explicit, documented two-phase rollout, not a bug.
- **Edit/Manage unify on [ADR-028](./028-staged-automation-authoring-drawer.md).**
  The list's row actions (edit, toggle, delete) stay; "Customize Message" and
  "Customize Templates" collapse into the single staged-drawer "Edit".
- **The cadence column** appears here once
  [ADR-025](./025-notify-persistent-action-classification.md) ships, alongside
  the cadence stage in the authoring drawer.

## References

- Related ADRs:
  - [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — `ReactorOutbox` (pending/failed source; `subjectId` extension)
  - [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md) — `TriggerSent` (last-triggered / fired-count source)
  - [ADR-025](./025-notify-persistent-action-classification.md) — cadence column
  - [ADR-026](./026-liquid-templates-for-trigger-notifications.md) — the operator-visibility signals this surface fulfils
  - [ADR-028](./028-staged-automation-authoring-drawer.md) — the authoring drawer the Edit action opens
- Code: `src/pages/[project]/automations.tsx`, `src/server/app-layer/triggers/`, `src/server/event-sourcing/outbox/`
