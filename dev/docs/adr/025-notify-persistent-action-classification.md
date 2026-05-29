# ADR-025: Notify vs persistent trigger action classification, with per-trigger cadence

**Date:** 2026-05-28

**Status:** Accepted

## Context

LangWatch triggers have four action types:

| Action | Semantics |
|---|---|
| `SEND_EMAIL` | Sends a customer-visible message to one or more recipients |
| `SEND_SLACK_MESSAGE` | Posts to a customer-configured Slack webhook |
| `ADD_TO_DATASET` | Writes one or more rows to a LangWatch-managed dataset |
| `ADD_TO_ANNOTATION_QUEUE` | Inserts items into a LangWatch-managed annotation queue |

Today's per-(trigger, trace) dedup via `TriggerSent` prevents the *same* trace from firing the trigger more than once. But it does nothing about the more common pain: **N distinct traces matching the same trigger in a short window**.

The pain is **action-class dependent**:

- 1000 distinct matching traces in 5 minutes = **1000 Slack messages** (notification storm; customer churn risk; #monitoring channel becomes unusable).
- 1000 distinct matching traces in 5 minutes = **1000 dataset rows** — which is often the *intent* (e.g., "capture every production trace where the user thumbs-down for an evaluation set").

The two action classes behave differently:

- **Notify**: each invocation lands in front of a human. Many invocations in a short window is a usability problem.
- **Persist**: each invocation writes durable data the customer asked for. Many invocations is a feature.

The trigger dispatch path needs to distinguish them. It currently does not.

A secondary question: when we add cadence (windowed batching) to notify actions, is it per-trigger or per-(trigger, channel)?

## Decision

### Codify the action classification

Add two constant sets in `src/server/event-sourcing/pipelines/shared/triggerActionDispatch.ts`:

```ts
export const NOTIFY_TRIGGER_ACTIONS = new Set<TriggerAction>([
  TriggerAction.SEND_EMAIL,
  TriggerAction.SEND_SLACK_MESSAGE,
]);

export const PERSIST_TRIGGER_ACTIONS = new Set<TriggerAction>([
  TriggerAction.ADD_TO_DATASET,
  TriggerAction.ADD_TO_ANNOTATION_QUEUE,
]);
```

The dispatcher routes on this classification at the top of its switch:

```ts
function computeScheduledFor(action, cadence, now) {
  if (PERSIST_TRIGGER_ACTIONS.has(action)) return now;        // immediate
  if (cadence === "immediate") return now;
  return new Date(now.getTime() + CADENCE_WINDOW_MS[cadence]);
}
```

### Add per-trigger cadence

A new column on `Trigger`:

```sql
ALTER TABLE "Trigger"
  ADD COLUMN "notificationCadence" TEXT NOT NULL DEFAULT 'immediate';
-- Enum values: 'immediate' | '5min_digest' | '15min_digest' | 'hourly_digest'
```

The cadence applies only to notify actions. Persist actions always dispatch immediately, regardless of cadence value.

**Migration defaults:**

- Existing triggers: `'immediate'` (preserves current behavior — no surprise digest delays).
- New triggers, app-layer default: `'5min_digest'` for notify actions; `'immediate'` for persist actions.

### Cadence is per-trigger, not per-(trigger, channel)

Customers who want different cadences for different destinations create multiple triggers with identical filters. This matches today's single-action-per-trigger data model.

## Rationale

### Why hardcoded action-class sets, not per-action runtime config

The four action types are stable (changes have to be coordinated across the codebase anyway). Hardcoded sets in one file are unambiguous and reviewable. Per-action runtime config (each action declaring its own dispatch class via metadata) adds indirection without benefit — there's no scenario where a single deployment would want different classifications for the same action.

### Why per-trigger cadence

Today's `Trigger` schema has one `action` field and one `actionParams` blob — fundamentally single-destination. Supporting per-(trigger, channel) cadence requires either:

- **Multi-action triggers**: change the schema so `actions` is an array, migrate every code path that reads `trigger.action`. Large refactor.
- **Per-recipient scheduling**: exploit that `SEND_EMAIL.members` is an array, schedule per `(triggerId, recipient)`. Asymmetric for Slack (one webhook = one channel) — leads to mismatched semantics across actions.

Per-trigger cadence is congruent with today's data model and costs nothing extra. Customers who need per-channel cadence can duplicate triggers — workable as a fallback until someone files a real request.

### Why these specific cadence values

`immediate`, `5min_digest`, `15min_digest`, `hourly_digest` cover the meaningful operational regimes:

- `immediate`: alerts that need to wake on-call now.
- `5min_digest`: typical notification-storm protection without losing fresh signal.
- `15min_digest`: low-priority alerts where some batching is desired.
- `hourly_digest`: passive monitoring digests.

Daily and weekly digests aren't included in v1 — they cross the "is this still a trigger or is it a report?" line and complicate retention semantics for the underlying outbox rows. Add later if asked.

## Consequences

- **New `notificationCadence` column on `Trigger`.** Single `ALTER TABLE` with `DEFAULT 'immediate' NOT NULL` — instant on PG ≥ 11.
- **Dispatcher rendering must handle `payloads[]`.** When `length === 1` (immediate or single-match digest), render as a single message; when `length > 1`, render as a digest with N occurrences. Templates ([ADR-026](./026-liquid-templates-for-trigger-notifications.md)) iterate `{% for m in matches %}` regardless of length.
- **UI surface in trigger settings.** Cadence dropdown, visible only when the action is in `NOTIFY_TRIGGER_ACTIONS`. Persist-action triggers don't see the field.
- **Operator default for new notify triggers is `5min_digest`**, which is a behavior change vs today's implicit immediate. A migration banner / changelog notes this and links to the cadence settings. Existing triggers don't change.
- **The classification is the contract** for the outbox layer. `computeScheduledFor(action, cadence)` is the single function called by `.withOutbox`-registered reactors' `cadenceWindowMs` resolvers.
- **Future action types** (e.g., a hypothetical `SEND_WEBHOOK`, `OPEN_INCIDENT`) must be classified at the point of introduction. The two sets together must cover every `TriggerAction` enum value — enforce with a unit test that asserts the union of `NOTIFY_TRIGGER_ACTIONS` and `PERSIST_TRIGGER_ACTIONS` has the same size as `allTriggerActions` and that every element of `allTriggerActions` is present in the union.
- **Multi-destination fan-out is a notify-side concern, not persist-side.** NOTIFY actions will eventually want one trigger → multiple destinations, potentially with different cadences each ("page on-call immediately, also digest to #monitoring every 15 min"). Today's workaround is duplicating the trigger. PERSIST actions stay 1-destination by design — there's no "fan out a dataset write." When fan-out lands, it lives on the notify path: a notify trigger references a list of `(channel, cadence)` pairs, the outbox row carries the destination identity, and `groupKey` extends from `${projectId}/${reactorName}:${triggerId}` to `${projectId}/${reactorName}:${triggerId}:${channelId}` so each destination gets its own cadence window. No outbox-framework change required; the schema split (per-trigger row → notify-policy-with-channels) is the work. Out of scope here.

## References

- [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — the outbox layer this classification feeds
- [ADR-026](./026-liquid-templates-for-trigger-notifications.md) — template engine that consumes the digest `matches[]` payload
- `src/server/event-sourcing/pipelines/shared/triggerActionDispatch.ts` — where the constants live
- Prisma `Trigger` model — schema being extended
