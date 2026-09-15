# ADR-004: UI consumes the shared design system and its workshop

**Date:** 2026-08-28

**Status:** Accepted

**Related:**
[Design System boundary](../../../packages/design-system/adrs/001-design-system-boundary.md),
[ADR-002: platform application parity shell](./002-platform-app-parity-shell.md),
and [the Design System README](../../../packages/design-system/README.md).

## Context

The UI application and feature-web packages need the same production tokens,
Chakra system, accessible primitives and reusable components. Keeping an
app-local theme or copying components into each feature would make isolated
rendering diverge and create inconsistent product UI.

The shared component catalogue also needs a place to develop high-quality
prefabricated UI without confusing file-size taxonomy with ownership.

## Decision

`apps/ui` consumes `@langwatch/design-system`; it does not own another token
set, provider, theme or global shared-component folder. The Design System stays
under `packages` so future applications may consume it. Feature identity and
product behaviour remain in feature-web packages rather than flowing back into
the Design System.

The Design System owns its Storybook and renders stories with the real
`DesignSystemProvider` and colour modes. Its catalogue uses intent-based groups:

- Foundations: tokens, colour, typography, spacing and motion;
- Primitives: small accessible building blocks;
- Components: reusable controls with a stable product-wide contract; and
- Patterns: app-independent prefabricated compositions for recurring workflows.

A Pattern is admitted because its behaviour and API are reusable, not because
it is physically large. Product pages, router-aware links, feature stores,
transport hooks and session-aware components remain with their UI or feature
owner. Interactive prefab stories gain browser interaction and accessibility
coverage as they are promoted.

## Alternatives considered

Keeping shared UI in the app was rejected because other feature-web packages
would depend on the composition root. Moving all current app components into
the Design System was rejected because many contain feature and transport
behaviour. An atoms/molecules/organisms hierarchy was rejected as the primary
taxonomy because component size does not describe ownership, stability or
reuse.

## Consequences

Production, Storybook, `apps/ui` and feature-web packages use one visual
foundation. Prefabs gain an explicit quality and ownership bar. Some app-aware
components must first be split into a controlled reusable view and an owning
composition adapter before they can move.
