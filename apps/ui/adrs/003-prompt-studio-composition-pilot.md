# ADR-003: Prompt Studio is the first UI composition pilot

**Date:** 2026-08-28

**Status:** Accepted

**Related:**
[Frontend feature boundary ADR](../../../packages/architecture-lint/adrs/004-frontend-feature-boundaries.md),
[Prompt service boundary](../../../packages/features/prompt/adrs/001-prompt-service-boundary.md),
[ADR-001: UI composition boundary](./001-ui-composition-boundary.md),
and [the platform exit ledger](../../../dev/docs/plans/core-application-feature-extraction-plan.md).

## Context

Prompt contains both useful reusable presentation and a large Prompt Studio
experience coupled to legacy application hooks and transports. It is the first
feature-web package used to prove that reusable UI can be shared without making
the complete feature importable everywhere.

## Decision

`@langwatch/prompt-web` exposes these exact roles:

```text
screens/prompt-studio       # owner-only complete experience
surfaces/prompt-reference   # narrow reusable contribution
surfaces/prompt-version
surfaces/variable-type
```

The UI catalogue governs the package and every allowed consumer. Prompt Studio
is owner-only; Trace Explorer or another feature may use an approved Prompt
surface but cannot import the studio, Prompt tables, package root, stores,
queries or deep source.

The current move is an export-boundary pilot, not a claim that Prompt Studio is
complete. Completion requires the real page, its controlled browser behaviour
and narrow Prompt transport adapters to compose inside the owning `apps/ui`
frontend feature. Legacy Prompt paths are not declared compliant by renaming or
mapping them.

## Alternatives considered

Moving the whole studio in one cut was rejected because its dependency closure
is too broad to prove safely alongside the new boundary. Publishing a package
root or generic Prompt components was rejected because consumers could reach
far more than the UI they need. Treating the migrated tab pieces as a completed
screen was rejected because it would make the ledger misleading.

## Consequences

Prompt is a concrete fixture for owner-only screens and narrow surfaces. Other
feature-web packages can follow the same rule, while the remaining Prompt page
and transport work stays an explicit dependency-closed slice.
