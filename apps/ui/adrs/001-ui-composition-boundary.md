# ADR-001: UI composition adopts the governed frontend boundary

**Date:** 2026-08-28

**Status:** Accepted

**Related:**
[Frontend feature boundary ADR](../../../packages/architecture-lint/adrs/004-frontend-feature-boundaries.md),
[ADR-101: feature package surfaces](../../../dev/docs/adr/101-feature-package-surfaces.md),
and [ADR-111: physical application workspaces](../../../dev/docs/adr/111-physical-application-workspaces.md).

## Context

`apps/ui` must compose product experiences that often span several backend
domains without becoming a mirror of the backend feature catalogue. A Trace
Explorer may present Prompt, Evaluation, Scenario and Trace concepts, while the
backend keeps separate owners for those domains.

The opposite extreme is also unsafe: globally importable frontend features,
components, hooks and utilities would recreate the coupling in `platform/app`.
Importing a Prompt reference into Trace Explorer must not make Prompt tables,
stores, transport hooks or the whole Prompt Studio importable there.

## Decision

`apps/ui` adopts the frontend boundary enforced by architecture-lint ADR-004.
Its source has four governed roots:

```text
apps/ui/src/
├── app/       # bootstrap, providers, router, shell and registration
├── platform/  # browser transport, session, navigation, telemetry and storage
├── features/  # independent user-facing capabilities and page composition
└── testing/   # browser test support
```

A frontend feature describes a user-facing capability. It does not have to
share a name or a one-to-one ownership relationship with a backend feature. It
may compose several explicitly declared feature-web contributions.

The dependency direction is:

```text
app ────────► features ────────► declared feature-web exports
 │                │                         │
 └────────► platform ◄──────────────────────┘
```

`platform` cannot import a product feature. Frontend features cannot import one
another's implementation, backend server packages, app source, generated
Prisma, or browser-unsafe code. Browser fetch, tRPC, session, navigation and
storage adapters belong in `platform`; feature pages receive narrow named
capabilities from composition.

Governed feature-web packages expose exact `screens/<name>` and
`surfaces/<name>` entries. A screen is a complete owner-only experience and is
importable only by its owning frontend feature. A surface is a small reusable
contribution with controlled data and actions. Consuming one surface does not
open the package root or any sibling screen, store, query or internal module.
The frontend catalogue records each allowed edge.

Globally openable drawers keep a feature owner. Other features request a typed
overlay intent through a platform port; the application overlay registry is
the sole importer of the drawer implementation. Composition hubs such as Trace
Explorer may declare many surfaces, but that rationale and exact edge set must
remain visible in the catalogue.

## Alternatives considered

A one-to-one mirror of backend features was rejected because real product
screens compose multiple domains. Unrestricted feature imports were rejected
because one useful component would expose an entire feature. Generic shared
component, hook and utility folders were rejected because they erase ownership.

## Consequences

Cross-feature UI composition is explicit, narrow and reviewable. Browser
capabilities have one direction and product pages do not become global
dependency buckets. Adding a new screen, surface, overlay or composition-hub
edge requires an intentional catalogue and lint change.
