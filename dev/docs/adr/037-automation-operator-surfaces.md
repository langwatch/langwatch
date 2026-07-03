# ADR-037: Automation operator surfaces — authoring drawer & dispatch-health view

**Date:** 2026-05-29

**Status:** Accepted

## Context

Operators interact with automations through two complementary surfaces — **where they're written** and **where they're watched** — both of which are inadequate today.

### Authoring is fragmented across three forms

Authoring a LangWatch automation (a `Trigger`) is currently spread across three disconnected UI surfaces:

1. **`AddAutomationDrawer`** (`automation` drawer) — creation. Opened from the traces view, it inherits the active `filterParams.filters` as the trigger condition, presents a flat form (name, a radio list of all four action types, and the action-specific field), and saves.
2. **The inline "Customize Message" form** (`automations.tsx` `TriggerForm`) — edits `name` / `alertType` / `message` on an existing trigger, reached from the per-row `⋯` menu.
3. **`EditTriggerTemplatesDrawer`** ([ADR-036](./036-liquid-templates-for-trigger-notifications.md)) — edits the Liquid email/Slack templates, also behind the `⋯` menu.

This split has three problems:

- **Discoverability.** Templates are invisible during creation; a user must create the trigger, find it in settings, open the `⋯` menu, and pick "Customize Templates". In practice users don't find it at all.
- **The flat creation form doesn't scale.** We are adding per-trigger cadence ([ADR-026](./026-per-trigger-dispatch-timing.md)), templates with live preview ([ADR-036](./036-liquid-templates-for-trigger-notifications.md)), and a test-fire step. Stacking all of that into one always-visible form is unusable; the action-specific fields already only make sense once a type is chosen.
- **Creation is anchored to the traces view.** Because the condition is taken from the ambient `filterParams`, there is no self-contained way to create an automation from settings.

### Management shows nothing about whether automations are working

The settings automations list (`/[project]/automations`) shows name, action, destination, filters, last-run timestamp, and an active toggle. That is enough to see *that* an automation exists, but nothing about whether it is *working*.

As automations gain templates ([ADR-036](./036-liquid-templates-for-trigger-notifications.md)), cadence + debounce ([ADR-026](./026-per-trigger-dispatch-timing.md)), and outbox-backed dispatch ([ADR-030](./030-transactional-outbox-for-stake-sensitive-dispatch.md)), the operator's real questions are operational:

- When did this last fire, and how often is it firing?
- Is anything **pending** (queued / in-flight) or **stuck** (failed / dead)?
- Did a notification **render with the default** because a custom template threw, or reference **missing variables**? ADR-036 promised operators would see this; there is currently nowhere to see it.

ADR-036 referred to an "operator activity tab" for exactly these signals but did not specify where it lives. This ADR places it on the automations settings surface.

## Decision

Two coupled surfaces on the same data model: a unified **authoring drawer** for writing, and a **dispatch-health view** on the settings list for watching. The settings list's "Edit" action opens the drawer.

### Authoring — staged drawer for create + edit

Replace all three legacy surfaces with **one staged authoring drawer** — a series of section rows that open into secondary drawers — used for both **create** and **edit**.

Top-level sections shown on the main pane:

1. **Identity** — name + alert type (always visible at the top; mirrors how every modern automation builder treats the rule name as primary identity).
2. **When** — opens the Conditions secondary drawer (trace filters or custom-graph picker, with a JSON code-mode toggle).
3. **Type picker** — the existing `NOTIFY_TRIGGER_ACTIONS` / `PERSIST_TRIGGER_ACTIONS` classification ([ADR-026](./026-per-trigger-dispatch-timing.md)) surfaced as Notification (Slack, Email) vs Action (Add to dataset, Add to annotation queue).
4. **Setup** — opens the Configuration secondary drawer, type-aware:
   - *Email:* recipients, subject template, body template (Liquid + Markdown via [ADR-036](./036-liquid-templates-for-trigger-notifications.md)), live preview pane.
   - *Slack:* webhook URL, message type (plain / Block Kit), template, live preview pane.
   - *Dataset:* dataset picker + column mapping.
   - *Annotation queue:* annotators.
5. **Cadence** — notify-only. Opens the Cadence secondary drawer with `notificationCadence` and `traceDebounceMs` ([ADR-026](./026-per-trigger-dispatch-timing.md)). Hidden entirely for Action-category triggers.
6. **Test fire** — an inline test-fire button (notify-only) plus an in-session history of recent attempts.

Each section row collapses to a one-line summary of its current state; the secondary drawers are width-toggleable (default `xl`, expand to `2xl` for editor work).

### Provider model behind the drawer

The drawer is provider-agnostic. Each action type ships as a provider definition with three peer files under `src/automations/providers/definitions/<name>/`:

- `shared.ts` — cross-cutting metadata + Zod schema for `actionParams`. Pure data; both client and server import.
- `client.tsx` — UI half: `Icon`, `ConfigForm`, slice shape + helpers (`initialSlice`, `isComplete`, `summary`, `fromTriggerRow`, `toActionParams`). For notify providers, also `testFireTarget` + `templatesFromSlice`.
- `server.ts` — dispatch + test-fire hooks.

Two registries (`client.ts`, `server.ts` at the providers folder root) pair definitions to action types. Adding a new action type is a new folder; the drawer doesn't change.

The drawer's draft state is a Zustand store keyed by section; a pure reducer (`draftReducer.ts`) drives transitions. Sections live in `src/features/automations/components/`; the secondary drawers under `secondaries/`.

### Stateless preview + test-fire

The existing `previewTemplate` / `testFireTemplate` procedures read a *saved* `Trigger` by id. To work during creation (before any row exists), they are refactored to operate on the **draft payload** — channel, recipients/webhook, templates, and the trigger identity — supplied inline. The same stateless endpoints serve edit (pre-filled from the saved trigger) and create (from the in-progress draft) identically. Test fire keeps its [ADR-036](./036-liquid-templates-for-trigger-notifications.md) guarantees: email recipients are validated against team membership, and the non-suppressible banner is backend-injected.

### Client-side draft, persist once

**Create holds a client-side draft and persists once on Save** — no partially-configured `Trigger` rows are written to the database mid-flow. **Edit** pre-fills every section from the saved trigger.

### Dispatch-health view on the settings list

Enrich the automations list, plus a per-automation detail panel, with an operational view sourced from the existing dispatch records:

- **Last triggered** and **fired count** — from `TriggerSent` ([ADR-030](./030-transactional-outbox-for-stake-sensitive-dispatch.md)), which already records every `(triggerId, traceId)` dispatch. Available immediately.
- **Pending / failed / dead** — counts from `ReactorOutbox` ([ADR-030](./030-transactional-outbox-for-stake-sensitive-dispatch.md)) grouped by `status` for the trigger.
- **Template-health warnings** — "rendered with the default due to a template error" and "N missing variables", the ADR-036 operator signals, surfaced from the outbox row's `lastError` / its `renderDiagnostics` field. The "N missing variables" count is now persisted: the dispatcher captures `missingVariables` from each custom email/Slack template render and stamps it onto the dispatched payload, and the PG audit adapter writes it to `ReactorOutbox.renderDiagnostics` (`{ missingVariables: string[] }`, NULL on a clean render). This resolves the earlier gap where `renderTriggerEmail` / `renderTriggerSlack` computed the missing-variable set but the dispatcher dropped it before it reached the audit row.
- **Cadence and debounce** — the ADR-026 `notificationCadence` (notify triggers only) and `traceDebounceMs` shown as columns once those phases ship.
- **Edit** opens the staged authoring drawer above.

### Querying the outbox by trigger

`ReactorOutbox` rows are keyed by `(reactorName, dedupKey)` and grouped by `groupKey`, both `projectId`-prefixed and embedding the `triggerId` (`${projectId}/${reactorName}:${triggerId}...`). Counting per-trigger health via a `LIKE` on `dedupKey` is unindexed and slow.

**Implementation status (2026-06-24):** the `subjectId` column proposed here has NOT shipped. The operator-surface query falls back to a `LIKE` scan on `dedupKey`; performance is acceptable at current volumes but should be reconsidered before a per-trigger health list becomes a hot page. Adding the column + backfilling is a small extension to the ADR-030 schema — track as follow-up.

### Layering

A read-only `TriggerHealthService` (or an extension of `TriggerService`) reads `TriggerSent` and `ReactorOutbox` through repositories and returns a per-trigger health summary; a tRPC query feeds the list. Transport stays thin — no aggregation logic in the router.

### Sequencing dependency

The pending/failed/dead and template-health signals require **notify dispatch to flow through `ReactorOutbox`** (ADR-030 + ADR-026 fully wired). Therefore:

- **Ship now:** last-triggered and fired-count (from `TriggerSent`).
- **Ship with outbox-backed notify dispatch:** pending / failed / dead and template-health warnings.

The list is built so the outbox-derived columns light up when that dispatch wiring lands, rather than requiring a second redesign.

## Rationale

### Why one drawer for create + edit

- **Discoverability is the core win.** Templates, conditions, and cadence are all reachable in the one place a user already is when creating an automation. The "create then go hunt in a menu" path disappears.
- **Progressive disclosure scales.** Section rows that open into secondary drawers keep the main pane scannable regardless of how many capabilities a type accumulates. Action-specific fields appear only after a type is chosen.
- **Category-first mirrors the dispatch contract.** Notification-vs-Action means the UI taxonomy and the ADR-026 dispatch classification are the same taxonomy, so cadence naturally attaches to the notify branch only.

### Why section rows + secondary drawers, not a linear wizard

A stepper forces a single path and blocks revisiting earlier choices; section rows let a user jump back to any section without unwinding. The secondary-drawer pattern (Conditions, Configuration, Cadence) gives editor-heavy stages the room they need (live Monaco preview, Block Kit renderer) without crushing the main pane.

### Why client-side draft over incremental persistence

Writing an `active=false` draft trigger per section would reuse the existing by-id endpoints but leaves abandoned rows and partial state in the database. Holding the draft client-side keeps the DB clean; the cost is making preview / test fire stateless.

### Why the provider model

The drawer renders four action types today, and the architecture has to absorb new ones (custom webhook, open incident, …) without growing combinatorially. A provider registry — one folder per action with `shared` / `client` / `server` peers — keeps the drawer's main code agnostic and gives reviewers one place to look when classifying a new action.

### Why settings is the right home for dispatch health

Operators manage automations in settings; putting health next to the edit action (rather than in a separate ops tool) keeps "see a problem → fix the automation" a one-screen loop, and satisfies the ADR-036 operator-activity promise without a new top-level surface.

### Why reuse `TriggerSent` and `ReactorOutbox` directly

These tables already hold exactly the firing and dispatch-outcome data; surfacing them avoids a parallel metrics store that could drift from reality.

### Why an indexed `subjectId` over `dedupKey LIKE`

A trigger's health view is a per-row UI query that must be cheap; an unindexed prefix scan over the outbox is not acceptable. The column is cheap to add and also useful for any future "show me this trigger's dispatch log" view.

### Why graceful degradation by sequencing

We do not block the management surface on the deferred dispatch wiring: the always-available `TriggerSent` columns ship first, and the outbox columns are additive when the dispatch path lands.

## Consequences

- **`AddAutomationDrawer`, the inline `TriggerForm` ("Customize Message"), and `EditTriggerTemplatesDrawer` are replaced** by the staged drawer. The Liquid editor pieces from ADR-036 (Monaco Liquid, the preview/Block-Kit components, the variable contract) are reused as the Configuration secondary's notify sub-form; only the drawer shell and the `⋯`-menu wiring change.
- **`previewTemplate` / `testFireTemplate` change shape** from "by triggerId" to "by draft payload". The `TriggerTemplateService` gains a draft-context builder alongside the saved-trigger one; recipient validation moves to the service.
- **The drawer becomes launchable from settings**, not just the traces view, because conditions are now an in-drawer section.
- **A new read path over `ReactorOutbox`** — a `TriggerHealthService` + repository method + tRPC query — plus an indexed `subjectId` column on the outbox table.
- **The automations list page becomes the operator activity surface** referenced by ADR-036.
- **Outbox-derived columns depend on outbox-backed notify dispatch.** Until ADR-030 + ADR-026 fully wire, they render as "—"/empty; only `TriggerSent`-derived columns are populated. This is an explicit, documented two-phase rollout, not a bug.
- **Migration**: existing triggers open in the new drawer with every section pre-filled; no data migration is required (the drawer reads the same `Trigger` columns, including the ADR-036 template columns and the ADR-026 cadence/debounce columns).
- **A new domain folder `src/automations/`** holds the provider model + `cadences.ts` (the shared cadence constants). The drawer + UI live under `src/features/automations/`. Keeps client-only UI separate from cross-cutting domain types.

## References

- [ADR-030](./030-transactional-outbox-for-stake-sensitive-dispatch.md) — `TriggerSent` + `ReactorOutbox` schemas the dispatch-health view reads; `subjectId` extension
- [ADR-026](./026-per-trigger-dispatch-timing.md) — cadence + debounce columns the cadence secondary edits
- [ADR-036](./036-liquid-templates-for-trigger-notifications.md) — Liquid templates + test-fire banner the Configuration secondary edits
- Code touched: `src/components/AddAutomationDrawer.tsx`, `src/components/EditTriggerTemplatesDrawer.tsx`, `src/pages/[project]/automations.tsx`, `src/server/api/routers/automations.ts`, `src/server/app-layer/triggers/trigger-template.service.ts`, `src/automations/**`, `src/features/automations/**`
