# ADR-037: Automations use one authoring drawer and one dispatch-health view

**Date:** 2026-05-29

**Status:** Accepted

**Behavioural contract:**
[automation authoring drawer](../../../specs/automations/authoring-drawer.feature)

**Related:** [dispatch timing](./026-per-trigger-dispatch-timing.md),
[notification templates](./036-liquid-templates-for-trigger-notifications.md),
and [automation process managers](./052-automations-on-process-manager-substrate.md).

## Context

An automation operator has two jobs: author the rule and understand whether it
is working. Templates, conditions, cadence and provider configuration belong
to one authoring flow. Firing history, pending work, exhausted delivery and
template warnings belong beside the automation the operator can fix.

Fragmenting these concerns across creation forms, settings menus and generic
ops screens makes capabilities difficult to discover and failures difficult
to act on.

## Decision

The automation settings surface owns two connected views over the same domain:

1. a staged drawer for creating and editing an automation; and
2. a dispatch-health summary with a per-automation detail panel.

### Staged authoring drawer

The drawer uses section rows that open focused secondary drawers:

1. **Identity** — name and automation type.
2. **When** — trace filters or graph selection, with a JSON mode where
   appropriate.
3. **Action class** — Notification or Persist, using the shared ADR-026
   classification.
4. **Setup** — provider-specific destination, mapping and template fields.
5. **Cadence** — notification cadence and trace debounce; cadence is hidden
   for persist actions.
6. **Test fire** — notification-only delivery using the current draft.

Each row collapses to a one-line summary. Secondary drawers are wide enough
for template and JSON editors and may be expanded by the user.

The same drawer handles create and edit. Create keeps a client-side draft and
persists one complete automation on Save. Edit starts from the saved
automation. Closing an unsaved create flow writes no partial row.

Preview and test-fire endpoints accept a validated draft payload rather than
requiring a stored trigger ID. Test fire validates destinations, injects the
non-suppressible test banner on the server and never creates a dispatch claim.

### Provider model

The drawer is provider-agnostic. Each action provider supplies:

- a browser-safe definition and `actionParams` schema;
- a client component, draft helpers, completeness rule and summary; and
- server persistence, secret handling, dispatch and test-fire adapters.

Browser-safe definitions live in the automation contract package. Client
components live in the automation web feature. Server adapters live in the
automation application layer. The drawer renders the registry and does not
switch on provider-specific fields.

### Dispatch-health view

The automation list and detail panel expose:

- last triggered time and total successful claims from `TriggerSent`;
- pending and dead delivery counts from `ProcessManagerOutbox`, scoped by
  `processName = triggerSettlement`, project and `processKey = triggerId`;
- retry attempts and safe error diagnostics from
  `ProcessManagerOutboxAttempt`;
- cadence and debounce configuration; and
- template fallback and missing-variable diagnostics from the automation
  delivery-audit adapter.

`processKey` is the indexed automation identity. Health queries do not parse
message keys or scan JSON payloads to recover a trigger ID.

A read-only `TriggerHealthService` composes the automation repository,
`TriggerSent`, generic process-manager inspection and delivery-audit ports into
a contract-owned summary. The tRPC router transports that summary without
performing aggregation itself.

Generic process-manager ops remain available for cross-feature diagnosis. The
automation view is the product surface: it translates process state and intent
attempts into language an automation operator can act on.

## Alternatives considered

A linear wizard blocks users from jumping between related sections. Writing a
database row per step leaves abandoned, partially configured automations.
Provider-specific branches in the drawer make every new action a central UI
change. A separate automation-health store would duplicate durable dispatch
records and can drift from the delivery state machine.

## Consequences

- Create and edit use one provider-driven authoring surface.
- Conditions, templates, cadence and test fire are discoverable in the same
  flow.
- Draft preview and test fire are stateless with respect to trigger storage.
- Health reads use indexed domain identities and repository/service layering.
- Automation-specific diagnostics remain separate from generic Eventing
  persistence types at the web contract boundary.

## References

- [Automation authoring behaviour](../../../specs/automations/authoring-drawer.feature)
- [Automation dispatch behaviour](../../../specs/automations/process-manager-dispatch.feature)
- [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md)
