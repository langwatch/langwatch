# ADR-093: one automation flow — the subject choice replaces the kind split, and Slack becomes a project integration

**Date:** 2026-08-12

**Status:** Proposed

**Builds on:** [ADR-043](./043-automation-facet-model.md) (the facet model — the facets survive unchanged; this ADR collapses the Type facet's presets), [ADR-037](./037-automation-operator-surfaces.md) (operator surfaces), [ADR-041](./041-modern-block-kit-notification-template-suite.md) (templates), [ADR-044](./044-scheduled-reports-automation-kind.md) (schedules, which stay separate).

**Relates to:** [ADR-052](./052-automations-on-process-manager-substrate.md) (dispatch is untouched), [#6717](https://github.com/langwatch/langwatch/issues/6717) (the decisions this records), [#6716](https://github.com/langwatch/langwatch/issues/6716) (the bug bash that motivated them), PR [#6891](https://github.com/langwatch/langwatch/pull/6891) (the public-API contract this must not break).

**Spec:** `specs/automations/source-merge.feature`

## Context

Two bug bashes, four weeks apart, hit the automations surface and reached the same conclusion: the split between "Automation" and "Alert" is a distinction the product draws that customers do not. "The alert I set up for Slack is actually an automation" is a verbatim finding. The two kinds differ only in **where the input comes from** — a trace search versus a graph metric — yet the split shows up as two type cards, two near-identical list tables, two vocabularies in copy, and a type-lock rule (#6716) that needs a tooltip to explain itself.

The same sessions found the Slack bot token pasted into every automation separately. One workspace, one bot, N copies of the credential — N places to rotate it, and a composer that opens with a wall of token-setup text before it will let the author pick a channel.

ADR-043 already did the structural work: every automation is one object seen through orthogonal facets (name / type / subject / cadence / severity / delivery), and the three kinds are presets over those facets. The internal draft field is even named `source` already — only the UI label says "Type". What is left is to finish the thought: two of the three presets are the same preset.

The composer has a second, independent problem the 2026-08-04 call agreed on without agreeing on the fix: the drawer asks for too much at once. A previous restructuring attempt taught one concrete lesson — losing the overview while editing was the annoying part, not the number of fields.

These decisions were settled by Alex on 2026-08-12 and are recorded here, not relitigated: merge Automation + Alert into one flow (Schedule stays separate); drop the Type card — the flow opens with what the automation watches, and no separate source label is shown to customers at all; steps for the composer (not accordion-trimming); Builder stays the condition editor's default with Code as the toggle; one unified list table; project-level Slack integration; multi-channel delivery deferred.

## Decision

### 1. One flow, one opening question

An **automation** is one thing: it watches something, applies a rule, and delivers. The former "Alert" is an automation that watches a graph. **Schedule remains a separate concept** — the clock is not something to watch, and a report has no rule.

There is no type card and no source card left to pick — not even a renamed one. The flow opens with the subject itself: **"What should this automation watch?" — a trace filter or a graph** — and the subject's configuration follows inline. Choosing the subject *is* choosing what was formerly the kind; the rule shape follows from it (a filter → per-trace conditions, Builder by default with Code as the toggle — decided, not open; a graph → series + operator/threshold/window). Asking "which source?" and then "which subject?" was two questions with one answer, so the first question is deleted rather than renamed. "Source" stops being a customer-facing concept entirely; it survives only as a derived wire field (§2).

```
   CURRENT IA                              TARGET IA
   ──────────                              ─────────
   AUTOMATIONS                             AUTOMATIONS
   ├─ Overview                             ├─ Overview
   ├─ Automations   ──┐ two tables,        ├─ Automations ── ONE table,
   ├─ Alerts        ──┘ same columns       │    Watches + Delivery columns,
   └─ Schedules                            │    filter chips: Filter | Graph
                                           └─ Schedules   (own tab, unchanged)
   Composer: three Type cards, THEN        Composer: the subject IS step 1
   a subject                               ┌─ What should this automation watch? ─┐
   ┌────────────┐┌───────────┐┌──────────┐ │ ◉ A trace filter   ○ A graph        │
   │ Automation ││ Alert     ││ Schedule │ │ ┌─────────────────────────────────┐ │
   │ (trace)    ││ (graph)   ││ (clock)  │ │ │ subject configuration, inline   │ │
   └────────────┘└───────────┘└──────────┘ │ └─────────────────────────────────┘ │
                                           └─────────────────────────────────────┘
                                           Schedules: created from their own
                                           entry point, never a third option
```

Internally nothing renames: the draft reducer's `ConditionSource` (`"trace" | "customGraph" | "report"`) does not change. This is UI copy, information architecture, and wire naming — not a semantic change.

**What a saved automation watches cannot change.** This is stated as a rule of the merged flow, not a leftover: the graph slot (`customGraphId @unique` — one automation per graph) and the report calendar make the conversion a create-plus-delete, which is exactly what the public API already enforces as `trigger_kind_immutable` (#6891). The #6716 "type-lock" finding dissolves — there is no type to lock, and the Watch step simply renders locked on edit with the same explanation. Severity (`alertType`) keeps its current behaviour: offered for graph-watching automations, absent for filter-watching ones.

### 2. Wire compatibility: `kind` stays the discriminator, `source` is derived

The public API shipped full parity days ago (#6891): `triggerKind` immutability, action immutability, typed per-channel `actionParams`, `graphAlert`/`report` as top-level fields. Clients exist against that contract. So:

**`kind` does not collapse.** It remains the stored and wire discriminator. `source` is a derived, bijective alias published alongside it — and it is *wire vocabulary only*: no UI label says "source" (§1 deleted the question), but an API field still needs an honest name for the axis, and "where the input comes from" is that name.

| Stored `triggerKind` | Wire `kind` (unchanged) | Wire `source` (new, read + write) | In the UI |
|---|---|---|---|
| `AUTOMATION` | `AUTOMATION` | `trace_search` | Watches a trace filter |
| `ALERT` | `ALERT` | `graph_metric` | Watches a graph |
| `REPORT` | `REPORT` | `schedule` | Schedule (separate surface) |

- **Reads** publish both fields, always consistent.
- **Writes** accept either. Sending both is allowed when they agree; a mismatched pair is refused with a stable code (`trigger_source_kind_mismatch`) rather than one silently winning.
- **Deprecation posture:** `kind` is documented as the compatibility name and `source` as the preferred one. `kind` is not scheduled for removal — that would be a versioned API break this ADR does not make. An old kind-based client keeps working with zero changes, forever as far as this ADR is concerned.
- **Error codes are wire contract:** `trigger_kind_immutable` keeps its code — clients match on codes, and renaming a shipped code is a break dressed up as tidiness. The presentation-registry copy for it changes to speak of the subject ("what this automation watches cannot change; create a new automation instead").

tRPC (the dashboard's own API) needs no new field: the UI derives its labels from `triggerKind` exactly as it does today.

### 3. Data model: no migration

```
   Trigger row (prisma)                     What changes
   ────────────────────                     ────────────
   triggerKind  AUTOMATION|ALERT|REPORT  ←  NOTHING. The enum is the storage
   action       TriggerAction (one)         encoding of source. Zero row
   filters / filterQuery                    rewrites, zero enum renames,
   customGraphId (@unique) + actionParams   zero new columns for the merge.
   templates, cadence, debounce, alertType
```

The merge is presentation and contract, not storage. `triggerKind: ALERT` *means* "watches a graph"; a stored enum that no longer matches the UI vocabulary is a comment problem, not a data problem, and renaming a deployed enum buys churn with no behaviour. The one schema addition this ADR makes is the Slack integration table (§5), which is additive.

`check-feature-parity`-bound specs that speak of "alerts" as a distinct kind (`specs/automations/*.feature`) keep binding — the behaviour they pin (graph evaluation, incident open/resolve, report scheduling) is untouched. The spec accompanying this ADR (`source-merge.feature`) covers the merged surface and ships `@unimplemented` until the reference implementation binds it.

### 4. The composer becomes a wizard — linear to create, hub-and-spoke to edit

Steps were chosen over accordion-trimming, and with the type card deleted (§1) the wizard is three steps. The sequence, and what each asks:

```
   CREATE (linear, with a persistent step rail)

   ┌──────────────┐   ┌────────────┐   ┌──────────┐
   │ 1 WATCH      │ → │ 2 DELIVERY │ → │ 3 REVIEW │ → Save
   └──────────────┘   └────────────┘   └──────────┘
   Watch:    "What should this automation watch?" — a trace filter or
             a graph — with the subject configured inline and the rule
             shape following the choice:
             filter → conditions (Builder default, Code toggle),
                      live match preview + firing-rate estimate
             graph  → graph + series + operator/threshold/window;
                      an empty graph list offers creating one, or a
                      template that ships one (§6)
             Pre-answered and locked when entered from a graph page or
             a use-case template.
   Delivery: ONE channel (email | Slack | webhook | dataset | queue),
             its configuration + templates, and the delivery timing
             (digest cadence + settle window). When and where it sends
             is one decision, so timing rides with the channel; the
             threshold's time window stays in Watch, where it
             modulates *firing*, not sending.
   Review:   the whole automation on one screen — name (editable here
             and in the header throughout), what it watches, the rule,
             delivery, severity, test fire, Save

   EDIT (hub-and-spoke: the overview IS the home screen)

                  ┌────────────────────────────┐
                  │  REVIEW / OVERVIEW         │ ← opens here, always
                  │  ┌─────────┐ [edit] ───────┼──→ Watch step ────┐
                  │  ├─────────┤ [edit] ───────┼──→ Delivery step ─┤
                  │  └─────────┘               │                   │
                  │  (inside Watch, the        │ ←── done ─────────┘
                  │   filter↔graph choice      │
                  │   renders locked; the      │
                  │   subject stays editable)  │
                  └────────────────────────────┘
```

The Aug-4 lesson is designed in rather than remembered: **the overview never disappears.** Creating shows a step rail with each completed step's one-line summary, clickable to go back. Editing opens the Review screen directly — never the Watch step — and each section's edit affordance enters *that step alone*, returning to the overview on done. The facet vocabulary (ADR-043) is unchanged; steps are how the facets are *sequenced*, not a new model. In particular, Cadence stays a first-class facet at the data and draft level — only its wizard seating is decided here (it renders inside Delivery).

The staged secondary-drawer machinery (`FacetSection`, secondary drawers for provider configuration) is reused as step content — this is a re-chroming of navigation, not a rebuild of the sections.

### 5. Slack becomes a project integration

**The decision:** the bot token is configured once per project and rotated in one place; the composer only ever asks for a channel.

**Storage.** A dedicated table, not a `ProjectSecret` row: the integration carries customer-facing metadata and its own surface, where `ProjectSecret` is anonymous machinery (its consumer today is the Langy virtual key). Encryption uses the existing `encrypt()`/`decrypt()` helpers (`platform/app/src/utils/encryption.ts`, AES-256-GCM), the same ones the per-automation token uses today.

```prisma
model ProjectSlackIntegration {
  id                String   @id            // ksuid
  projectId         String   @unique        // one integration per project
  project           Project  @relation(fields: [projectId], references: [id])
  botTokenEncrypted String                  // encrypt() ciphertext, never returned to clients
  slackTeamId       String                  // from auth.test at save — pins the workspace
  slackTeamName     String                  // display only
  createdById       String
  updatedById       String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([projectId])
}
```

`projectId @unique` is the frozen per-project decision made structural. It does not paint sharing into a corner: widening to team/org later means adopting the scoped-resources junction shape (`dev/docs/best_practices/scoped-resources.md`), a migration this table's shape converts into cleanly. Saving validates the token against Slack (`auth.test`) and stores the workspace identity next to the ciphertext, so the settings card can say *which* workspace is connected without ever returning the token; reads return presence + workspace metadata only.

**Settings surface.** A Slack card on the Integrations settings page, beside the GitHub App card (`platform/app/src/pages/settings/integrations.tsx`). The card's form picks the project with `ScopeChipPicker` (`allowedScopeTypes={["PROJECT"]}`, `singleSelect`) per `scope-selector-and-badges.md` — never a hand-rolled select — and shows per-project connection state with the project scope badge. Rotation is the same form: paste a new token, `auth.test` revalidates, the ciphertext is replaced. Writes require `project:update` at the picked project.

**Token resolution at dispatch** (and for the composer's channel discovery, so the picker lists the workspace delivery will actually hit):

```
   Slack delivery needs a token
        │
        ▼
   1. actionParams.slackBotToken on the automation?   ── yes ──▶ use it (LEGACY)
        │ no                                                     most specific wins;
        ▼                                                        a project token must
   2. ProjectSlackIntegration for the project?        ── yes ──▶ use it (TARGET)
        │ no
        ▼
   3. fail the delivery: HandledError `slack_integration_missing`
      (fault: customer; remediation: connect Slack in settings)
```

Most-specific-first is deliberate, and it is the safety property: an existing automation carrying its own token — possibly for a *different workspace* than the one the project later connects — is never silently retargeted by someone setting up the integration. The cost is that rotation-in-one-place covers legacy rows only after they migrate, so migration is explicit and cheap:

**Migration of existing per-automation tokens.**

- New and edited automations **never store a token again**. The composer's Slack step drops the token field entirely: integration present → channel picker; integration absent → "Connect Slack for this project" pointing at settings (or inline for authors with `project:update`).
- An automation that still carries its own token says so everywhere it appears — a nudge on its list row and in its drawer, "Uses its own Slack token — switch to the project integration" — with one action: **"Use the project integration"**, which clears the stored credential (delivery falls through to step 2 above). The settings card shows "N automations in this project still use their own Slack token" with the same action in bulk. The rotation-coverage gap most-specific-first accepts (§ rationale) is handled by making it loud, never by silence.
- Over the API, the existing kept-sentinel contract becomes the migration lever: `SLACK_BOT_TOKEN_KEPT` keeps the stored legacy ciphertext (unchanged), an explicit `null` clears it, absent-on-create stores nothing. No forced backfill: both storage locations are honoured for as long as legacy rows exist, and the count on the settings card is the progress meter.

**What this does to the redaction machinery.** Less than it looks like. The credential split (`persistActionParamsFor` / `redactActionParamsFor`, the Slack provider's persist hook in `server/app-layer/automations/providers/slack/server.ts`) assumes action immutability and encrypts/redacts `actionParams.slackBotToken`; all of that stays, demoted to the legacy path — it must keep working verbatim for existing rows and for the kept-sentinel round-trip. The project token never enters `actionParams`, so it never enters the redaction problem: it lives in its own column, is decrypted only at dispatch and channel discovery, and no read path returns it. The `slackBotTokenSet: true` read flag gains a sibling the composer needs anyway: the tRPC read exposes whether the *project* integration is connected, so the UI can distinguish "legacy own token" / "project integration" / "nothing". The webhook channel's header-value credentials are untouched — webhooks are not part of this integration.

This also strengthens the deferred multi-channel story: a future delivery row that needs Slack only needs a channel id, not a credential.

### 6. Use-case templates ship their graph

The #6716 finding: pick "Error spike" and the automation still has no graph behind it — the template saves no work. In the merged flow, graph-watching use-case cards (`AutomationsEducation.tsx`) carry a **graph specification** in their prefill, not just a name and an action. The Watch step shows it as a pre-filled rule over a graph that does not exist yet ("Creates graph: *Error rate*"), editable like any other. Saving creates the graph and the automation in one service call; if the automation write is refused, the just-created graph is deleted — a template must not strand orphan graphs (#6896 already tracks orphan graphs as a defect class).

Templates always create a **new** graph rather than binding an existing one: `customGraphId` is `@unique`, so reusing a graph the user already has an automation on would be refused, and guessing which existing graph the user meant is exactly the dead end the finding describes. Trace-filter cards are unchanged (they already seed working filters).

## Rationale / trade-offs

**Why `source` does not replace `kind` on the wire.** A bijection means either name carries full information, so the only question is who pays: renaming costs every existing client a change and buys nothing they can observe; aliasing costs a mapping table in one place. #6891 landed days ago and its clients are the contract. The same logic keeps `trigger_kind_immutable`'s code.

**Why the row keeps `triggerKind`.** The merge changes what the product *says*, not what it *stores*. A three-value enum whose values map 1:1 onto the three sources is already the right storage; a migration that renames enum values rewrites history for vocabulary.

**Why the first step is the subject, not a renamed type card.** Renaming "Type" to "Source" would have kept two questions — "which source?" then "which subject?" — that always have one answer between them: the subject *is* where the input comes from. So the picker is deleted, not relabelled, and the flow opens on the thing itself. The word "source" retreats to the wire (§2), where an axis needs a field name even when no screen says it.

**Why most-specific-first for the token.** Decided, with the alternative rejected by name: project-wins makes rotation instantly cover legacy rows — attractive — but lets connecting the integration silently repoint a live delivery at a different workspace, which is a data-exposure shape this same bug bash already produced once by another route (the trace-ID preview incident). Silent retargeting is the worse failure, so it loses. The cost most-specific-first accepts — rotation not covering legacy rows until they migrate — is handled by visibility rather than by precedence: the settings-card count plus the per-automation nudge on the row and in the drawer (§5) keep every unmigrated token loud until it is gone. Explicit migration is a click; silent retargeting is an incident.

**Why a wizard and not fewer fields.** The call agreed the drawer asks too much *at once*; the fields themselves are each load-bearing. Steps bound what is visible at a time without cutting capability, and the Review-as-home pattern directly answers the one measured failure of the previous attempt (losing the overview while editing).

**Why the delivery timing lives in the Delivery step.** Decided: when and where it sends is one decision, so the digest cadence and settle window sit with the channel the author is already configuring. ADR-043's first-class Cadence facet is preserved at the data and draft level — timing controls keep their single home in the model — and only the wizard seating is decided here. The threshold's evaluation window is part of the rule's meaning, not of delivery, so it stays in the Watch step.

## Consequences

- Customer vocabulary shrinks: "automation" (defined by what it watches) and "schedule". No customer-facing label says "type" or "source" at all. Copy, docs, and empty states stop needing to explain the automation/alert distinction; the delete-copy noun defect class (#6716) loses its fuel.
- The type-lock question closes as by-design: what an automation watches is immutable, stated in the flow and enforced by the existing API contract.
- The unified list must keep row actions coherent with the View drawer's new role as the in-depth history view (#6899): View for history and what-happens-next, Edit for the wizard overview, Delete confirmed. One table, one row-action model.
- New failure modes ship with stable codes and presentation-registry entries: `trigger_source_kind_mismatch`, `slack_integration_missing`, `slack_integration_invalid_token` (rotation/save-time `auth.test` failure). Each lands with the unit that introduces it, in `logic/codes.ts` (sorted) + `presentation.ts` in the same change.
- Legacy per-automation tokens remain honoured indefinitely; the settings card's count is the measure of the migration's progress, and nothing breaks at zero adoption.
- The analytics "create alert from a graph" affordance (#6716, both sessions) becomes an entry into the wizard with the Watch step pre-answered — the graph picked, the choice locked — no special flow.

## Deferred — explicitly out of this ADR

- **Multi-channel delivery** (one automation → email + Slack + webhook at once). Future ADR. The open data-model question (a `TriggerDelivery` junction vs a `deliveries` JSON array, and how dispatch keys off `action`) is *not* pre-decided here; this ADR only refuses to obstruct it: source/rule stay independent of delivery count, and the project-level token removes the per-delivery credential problem.
- **Team/org-shared Slack integrations** (one workspace serving many projects). The `@unique projectId` table migrates into the scoped-resources junction shape if wanted.
- **Automatic healing of legacy tokens** (falling through to the project token when a stored token fails `invalid_auth`). Attractive, but it reintroduces silent retargeting through the back door; revisit with delivery-failure surfacing (#6716 G3 territory).
- **Schedules inside the wizard.** Schedule keeps its current composer path; unifying its authoring shell can ride a later polish pass without design risk.
- **Code-editor default flip and Builder retirement** — *decided, not deferred*: Builder stays the default, Code stays the toggle. Recorded so the earlier musings do not resurface as an open question.

## Reference implementation plan

Phase-2 structure per the bug-bash plan: **one reference PR first, no fan-out until it lands.**

### R0 — the reference PR (one PR, feature-flagged)

Everything behind a `release_automations_source_merge` feature flag; flag off is byte-identical behaviour.

**Scope:** the merged three-step wizard for create and edit (subject-first Watch step, both subjects, Review-as-home), the vocabulary change everywhere the flow speaks (no type card, no source label), and the unified list as a **read-only view** (one table, Watches + Delivery columns; Schedules tab untouched).

**Files (owned):**
- `platform/app/src/features/automations/components/AutomationTypePicker.tsx` → retired into the Watch step; the subject choice absorbs the picker
- `platform/app/src/features/automations/AutomationDrawer.tsx` + new `features/automations/components/wizard/**` (step shell, rail, review screen — reusing `FacetSection` and the secondary drawers as step content)
- `platform/app/src/features/automations/logic/draftReducer.ts` (step state only; `ConditionSource` values unchanged)
- `platform/app/src/pages/[project]/automations.tsx` (flag-gated merged table, read-only slice)
- feature-flag registry entry; `specs/automations/source-merge.feature` scenarios for the wizard + list view upgraded from `@unimplemented` to bound tags with `@scenario` annotations on the covering tests

**Explicitly NOT in R0:** any Prisma migration; any public-API change; the Slack integration; template-ships-graph; list filter chips and row-action changes; View-drawer changes; presentation-registry additions; any change visible with the flag off.

### Fan-out units (after R0 lands; strict file ownership, two agents never share a file)

| Unit | Scope | Files (owned) | Depends on |
|---|---|---|---|
| F1 | Wire `source` on the public API: read alias, write acceptance, `trigger_source_kind_mismatch`; MCP + CLI + OpenAPI regen | `platform/app/src/app/api/triggers/[[...route]]/app.ts`, `mcp/typescript/src/**`, `sdks/typescript/src/cli/commands/triggers/**`, generated OpenAPI | R0 |
| F2 | `ProjectSlackIntegration`: migration, service + new tRPC router (setup / rotate / remove / legacy-token census), Integrations settings card with `ScopeChipPicker`, `slack_integration_invalid_token` | `platform/app/prisma/` (new migration), new `server/app-layer/automations/slack-integration/**`, new router file, `pages/settings/integrations.tsx`, `features/errors/logic/codes.ts` + `presentation.ts` entries | R0 |
| F3 | Dispatch + composer consume the integration: resolution order, `slack_integration_missing`, channel discovery via the resolved token, Slack step drops the token field | `server/app-layer/automations/providers/slack/server.ts`, `server/app-layer/automations/delivery/**` (Slack sites), `features/automations/providers/slack/**` | F2 |
| F4 | Legacy-token migration affordances: "Use the project integration" per automation + bulk from settings, kept-sentinel `null`-clears path over the API | slack-integration router/service (owned by the F2 seam), settings card components, the composer's legacy-token notice inside `providers/slack/**` (sequence with F3 — same directory, so F4 starts after F3 merges) | F3 |
| F5 | Templates ship their graph: graph spec in prefill, create-graph-and-bind service seam, orphan cleanup on refusal | `features/automations/components/page/AutomationsEducation.tsx`, `server/api/routers/automations.ts` (upsert seam) + graph service touchpoint | R0 |
| F6 | Unified list interactivity: filter/graph + delivery filter chips, row-action coherence with the View drawer, the legacy-token row nudge, flag removal at the end | `pages/[project]/automations.tsx`, `features/automations/components/page/**` | R0 (+#6899 landed; the nudge's data needs F2) |
| F7 | Spec binding: upgrade the remaining `@unimplemented` scenarios as each unit lands (one PR per unit's scenarios, riding that unit) | the unit's own test files | each unit |

Sequencing: R0 → F1 ∥ F2 ∥ F5 ∥ F6 → F3 → F4. The flag comes out in F6, last, once the merged surface is the only surface.

## References

- [#6717](https://github.com/langwatch/langwatch/issues/6717) — the recorded decisions; [#6716](https://github.com/langwatch/langwatch/issues/6716) — defects folded in where Phase-2-shaped (template-ships-graph, type-lock); [#6896](https://github.com/langwatch/langwatch/issues/6896) — deferred follow-ups adjacent to this design
- PR [#6891](https://github.com/langwatch/langwatch/pull/6891) — public-API parity and the immutability codes this ADR preserves; PR [#6899](https://github.com/langwatch/langwatch/pull/6899) — the View drawer as in-depth history
- `dev/docs/best_practices/scoped-resources.md`, `scope-selector-and-badges.md` — the settings-surface rules §5 follows
- `dev/docs/best_practices/error-handling.md` / [ADR-045](./045-domain-errors-handled-boundary.md) — the handled-error contract for the new codes
- `specs/automations/source-merge.feature` — the behavioural contract (all `@unimplemented` until R0)
