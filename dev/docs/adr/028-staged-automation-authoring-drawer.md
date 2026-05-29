# ADR-028: Staged automation authoring drawer (unified create + edit)

**Date:** 2026-05-29

**Status:** Proposed

## Context

Authoring a LangWatch automation (a `Trigger`) is currently spread across three
disconnected UI surfaces:

1. **`AddAutomationDrawer`** (`automation` drawer) — creation. Opened from the
   traces view, it inherits the active `filterParams.filters` as the trigger
   condition, presents a flat form (name, a radio list of all four action
   types, and the action-specific field), and saves.
2. **The inline "Customize Message" form** (`automations.tsx` `TriggerForm`) —
   edits `name` / `alertType` / `message` on an existing trigger, reached from
   the per-row `⋯` menu.
3. **`EditTriggerTemplatesDrawer`** ([ADR-026](./026-liquid-templates-for-trigger-notifications.md),
   Phase 3) — edits the Liquid email/Slack templates, also behind the `⋯` menu.

This split has three problems:

- **Discoverability.** Templates are invisible during creation; a user must
  create the trigger, find it in settings, open the `⋯` menu, and pick
  "Customize Templates". In practice users don't find it at all.
- **The flat creation form doesn't scale.** We are adding per-trigger cadence
  ([ADR-025](./025-notify-persistent-action-classification.md)), templates with
  live preview ([ADR-026](./026-liquid-templates-for-trigger-notifications.md)),
  and a test-fire step. Stacking all of that into one always-visible form is
  unusable; the action-specific fields already only make sense once a type is
  chosen.
- **Creation is anchored to the traces view.** Because the condition is taken
  from the ambient `filterParams`, there is no self-contained way to create an
  automation from settings.

## Decision

Replace all three surfaces with **one staged authoring drawer** — a collapsible
accordion of stages — used for both **create** and **edit**. A completed stage
collapses to a one-line summary; any stage can be reopened; a stage gates the
next until it validates.

### Stages

1. **Category** — *Notification* vs *Action*. This is the existing
   `NOTIFY_TRIGGER_ACTIONS` / `PERSIST_TRIGGER_ACTIONS` classification
   ([ADR-025](./025-notify-persistent-action-classification.md)) surfaced to the
   user, not a new concept.
2. **Type** — *Notification:* Slack, Email. *Action:* Add to dataset, Add to
   annotation queue.
3. **Conditions ("When")** — the trigger filters. The drawer carries its own
   condition editor (reusing the `EditAutomationFilterDrawer` field/code modes)
   so it is **self-contained**: required when launched from settings,
   pre-filled from `filterParams` when launched from the traces view.
4. **Configuration** — per type:
   - *Email:* recipients, subject template (with variable autocomplete), body
     template (Markdown + Liquid), plus the basic `name` / `alertType` /
     `message` fields that the legacy "Customize Message" form owned.
   - *Slack:* webhook URL, message type (plain / Block Kit), template.
   - *Dataset:* dataset picker + column mapping.
   - *Annotation queue:* annotators.
   The notify sub-forms embed the [ADR-026](./026-liquid-templates-for-trigger-notifications.md)
   editor components (Monaco Liquid editor, live preview, Block Kit render).
5. **Cadence** — notify-only. Rendered as a **visible-but-disabled** stage
   ("Coming soon: batch notifications into digests") until the
   [ADR-025](./025-notify-persistent-action-classification.md) cadence phase
   ships. Hidden entirely for Action-category triggers (persist always
   dispatches immediately).
6. **Test** — an optional test fire (meaningful for notify types), reusing the
   Phase 3 test-fire path.
7. **Save** — persists once.

### One component for create and edit

The same drawer backs both flows. **Create holds a client-side draft and
persists once on Save** — no partially-configured `Trigger` rows are written to
the database mid-flow. **Edit** pre-fills every stage from the saved trigger and
reopens at the Configuration stage by default. The per-row `⋯` "Customize
Message" and "Customize Templates" items collapse into a single "Edit" that
opens this drawer.

### Preview and test fire become stateless

The Phase 3 `previewTemplate` / `testFireTemplate` procedures read a *saved*
`Trigger` by id. To work during creation (before any row exists), they are
refactored to operate on the **draft payload** — channel, recipients/webhook,
templates, and the trigger identity (`name`, `alertType`, `message`) — supplied
inline. The same stateless endpoints then serve edit (pre-filled from the saved
trigger) and create (from the in-progress draft) identically. Test fire keeps
its [ADR-026](./026-liquid-templates-for-trigger-notifications.md) guarantees:
email recipients are validated against team membership, and the non-suppressible
banner is backend-injected.

## Rationale / Trade-offs

- **Discoverability is the core win.** Templates, conditions, and (later)
  cadence are all reachable in the one place a user already is when creating an
  automation. The "create then go hunt in a menu" path disappears.
- **Progressive disclosure scales.** An accordion that reveals the next stage as
  the current one validates keeps the surface small regardless of how many
  capabilities a type accumulates. Action-specific fields appear only after a
  type is chosen — which the flat form already half-did with conditional blocks.
- **Category-first mirrors the dispatch contract.** Leading with
  Notification-vs-Action means the UI taxonomy and the
  [ADR-025](./025-notify-persistent-action-classification.md) dispatch
  classification are the same taxonomy, so cadence naturally attaches to the
  notify branch only.
- **Accordion over a linear wizard.** A stepper forces a single path and blocks
  revisiting earlier choices; an accordion lets a user jump back to change the
  type or tweak a filter without unwinding. Trade-off: we must compute and show
  per-stage completion summaries and handle "later stage invalidated by an
  earlier edit" (e.g., switching type clears type-specific config).
- **Client-side draft over incremental persistence.** Writing an
  `active=false` draft trigger per stage would reuse the existing by-id
  endpoints but leaves abandoned rows and partial state in the database.
  Holding the draft client-side keeps the DB clean; the cost is making preview /
  test fire stateless.
- **Self-contained conditions stage.** Adds a step the old create flow got "for
  free" from the traces filter, but it is the price of being able to author from
  settings. Pre-filling from `filterParams` preserves the fast path from traces.

## Consequences

- **`AddAutomationDrawer`, the inline `TriggerForm` ("Customize Message"), and
  `EditTriggerTemplatesDrawer` are replaced by one staged drawer.** The Phase 3
  editor pieces (`liquidMonaco`, the preview/Block-Kit components, the variable
  contract) are reused as the Configuration stage's notify sub-form; only the
  drawer shell and the `⋯`-menu wiring change.
- **`previewTemplate` / `testFireTemplate` change shape** from "by triggerId" to
  "by draft payload". The `TriggerTemplateService` gains a draft-context builder
  alongside the saved-trigger one; recipient validation moves to the service.
- **The drawer becomes launchable from settings**, not just the traces view,
  because conditions are now an in-drawer stage.
- **The cadence stage is a forward hook** — present and visibly disabled — so
  the [ADR-025](./025-notify-persistent-action-classification.md) cadence work
  lands as "enable the stage", not "add a stage".
- **Management/observability is a sibling concern** handled in
  [ADR-029](./029-automation-management-and-health-surface.md): the settings
  list shows last-triggered / pending / failures, and its Edit action opens this
  drawer.
- **Migration**: existing triggers open in the new drawer with every stage
  pre-filled; no data migration is required (the drawer reads the same `Trigger`
  columns, including the [ADR-026](./026-liquid-templates-for-trigger-notifications.md)
  template columns).

## References

- Related ADRs:
  - [ADR-025](./025-notify-persistent-action-classification.md) — notify/persist classification + cadence (the Category and Cadence stages)
  - [ADR-026](./026-liquid-templates-for-trigger-notifications.md) — Liquid templates + test-fire banner (the Configuration and Test stages)
  - [ADR-029](./029-automation-management-and-health-surface.md) — the settings management/health surface this drawer is launched from
- Code touched: `src/components/AddAutomationDrawer.tsx`, `src/components/EditTriggerTemplatesDrawer.tsx`, `src/pages/[project]/automations.tsx`, `src/server/api/routers/automations.ts`, `src/server/app-layer/triggers/trigger-template.service.ts`
