# ADR-002: UI preserves the platform application shell during migration

**Date:** 2026-08-28

**Status:** Accepted

**Related:**
[ADR-111: physical application workspaces](../../../dev/docs/adr/111-physical-application-workspaces.md),
[ADR-001: UI composition boundary](./001-ui-composition-boundary.md),
and [the platform exit ledger](../../../dev/docs/plans/core-application-feature-extraction-plan.md).

## Context

`platform/app` still owns the live outer providers, route tree, router
compatibility setup and chunk-reload registration. Replacing the visual shell
while extracting feature UI would combine an architecture migration with a UI
redesign and make parity failures difficult to isolate.

## Decision

`@langwatch/ui` owns the exact existing application-shell seam:

```text
outer provider
└── Suspense(fallback={null})
    └── RouterProvider(existing router)
```

`UiDesignSystemShell` mounts the real shared Design System provider.
`platform/app` supplies the live provider and router through
`LegacyUiShellAdapter` until their complete browser-safe dependency closure can
move. The adapter performs only existing compatibility and registration work;
it does not become a second shell implementation.

Routes move incrementally after each page's feature-web presentation and
`apps/ui/src/platform` capabilities are dependency-closed. A route cut preserves
the current URL, outer-provider order, suspense fallback, error behaviour and
router setup unless a separate product decision explicitly changes them.

## Alternatives considered

Building a replacement shell in parallel was rejected because it would change
the UI during an ownership migration. Moving routes before their providers and
transport closure was rejected because it would pull legacy app and server
dependencies into `apps/ui`. Leaving the shell permanently in `platform/app`
was rejected because it prevents the physical application split.

## Consequences

The new UI process has a real, testable shell without claiming that the legacy
application has already moved. `LegacyUiShellAdapter` is deliberate temporary
composition and an explicit deletion target. Shell parity remains the default
until the migration is complete.
