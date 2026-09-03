# ADR-001: The design system is one browser-safe Chakra package

**Date:** 2026-08-21

**Status:** Accepted

**Behavioural contract:**
[Design system foundations and boundary](../specs/design-system-boundary.feature)

**Related:**
[ADR-101: feature package surfaces](../../../dev/docs/adr/101-feature-package-surfaces.md)
and [ADR-102: runtime composition roots](../../../dev/docs/adr/102-runtime-composition-roots.md).

## Context

The LangWatch Chakra system currently lives in a page module more than a
thousand lines long. `theme.ts` re-exports it from that page, one provider uses
the custom system while another mounts Chakra's `defaultSystem`, and the base
theme imports a Langy feature theme. Tokens, semantic tokens, recipes, provider
code, overlay policy and reusable components therefore depend in the wrong
direction.

The `components/ui` directory is also not one boundary. It contains true Chakra
primitives and reusable components alongside router-aware links, product error
handling, privacy behaviour, project-copy dialogs, app layouts and Langy-aware
drawers. Moving the directory wholesale would make the design system depend on
the app and product features it is meant to support.

Feature web packages need one stable browser foundation before they can leave
the app. That foundation must include the actual tokens and system used in
production, not test-only wrappers around Chakra defaults.

## Decision

Create one physical `@langwatch/design-system` package:

```text
packages/design-system/
├── src/
│   ├── system/
│   │   ├── foundations/
│   │   ├── semantic-tokens/
│   │   ├── recipes/
│   │   ├── slot-recipes/
│   │   ├── global-css.ts
│   │   └── create-system.ts
│   ├── provider/
│   ├── overlays/
│   ├── components/
│   ├── icons/
│   └── testing/
├── adrs/
└── specs/
```

Tokens remain in this package. A second raw-token package is not created while
all known consumers use Chakra and React. If a non-React client later needs a
language-neutral token artifact, that is a separate export and packaging
decision.

The package exports `designSystemConfig`, the default `system`, and
`createDesignSystem(...extensions)`. Configuration is merged in this order:

```text
Chakra defaultConfig
        ↓
LangWatch designSystemConfig
        ↓
feature and enterprise theme extensions
```

The design system never imports a feature theme. The app composition root adds
`langyThemeConfig` and any enterprise extension when it creates its system.
`DesignSystemProvider` accepts that composed system and otherwise uses the
package default. No route mounts a nested `defaultSystem` provider.

The package owns raw palette foundations, semantic tokens, genuinely global
design CSS, recipes, slot recipes, color-mode behaviour, reduced-graphics
policy, overlay-depth policy, framework-neutral Chakra wrappers, reusable
product-wide components and normalized product-wide icons. The host app owns
font loading and transport, analytics, routing and session providers.

A component moves only when its API can be expressed using React, Chakra and
design-system values. Router-aware links, app layouts, product privacy and
redaction UI, project-copy dialogs, prompt/agent message components and feature
themes remain with their owners. Dialog, drawer and toaster are split into
generic visual shells plus app adapters for error rendering or Langy
coordination.

The initial public surface uses explicit export-map entries for system,
provider, color mode, testing, icons and each supported component. There is no
wildcard export for `src`, `components` or internals. React, React DOM, Chakra
and Emotion are peer dependencies; `next-themes` and one icon implementation
are package dependencies.

### Public surfaces and transports

The supported surface is the explicit component, system, provider, color-mode,
icon and testing export map. The package has no API or background transport.

### Dependencies

React, React DOM, Chakra and Emotion are peer dependencies. The design system
does not import feature packages, app aliases, routers, Prisma or server code.

### Persistence

The design system owns no persistence and accepts no database records. Saved
user or feature preferences are adapted to browser-safe props before entering
the package.

### Runtime and registration

Importing the package has no registration side effect. The browser app creates
the composed Chakra system and mounts the provider explicitly.

### Environment and configuration

The design system reads no environment variables. Public branding or runtime
configuration is validated by the app and passed as semantic provider values,
not raw environment names.

### Errors

Reusable components report recoverable UI state through props and ordinary
React boundaries. App-specific logging, routing and error presentation remain
outside the package.

### Contracts and validation

Chakra tokens, recipes and component props are the browser contract. Package
type generation and independent TypeScript compilation validate them; any
portable data inputs use schemas owned by their feature contract rather than
server or Prisma types.

Components moved into the package are stabilized to Chakra v3 and accessible
defaults. Modal dialogs trap focus and prevent background interaction unless a
modeless variant is explicitly selected. Tooltip content is non-interactive,
icon-only controls are labelled, form controls have accessible names, focus
indicators remain visible, responsive components define a small-screen
strategy, and motion respects reduced-motion preferences.

Package tests mount the actual LangWatch system. Chakra type generation runs
from the packaged config so custom tokens and recipe variants are checked by
consumers. Browser tests cover focus, keyboard and overlay behaviour; unit
tests cover token emission, recipes and component contracts. Storybook is not
a prerequisite for establishing this boundary.

## Alternatives considered

A separate tokens package would add versioning and generation machinery without
a present non-React consumer. Moving all of `components/ui` would pull app and
feature dependencies into the package. Keeping tokens in the app while moving
components would make the package render differently in isolation and leave
feature packages dependent on app composition.

Wrapping every Chakra layout primitive would create a second UI framework.
Feature web code may use Chakra layout primitives directly; the design system
owns shared semantics, recipes and components whose behaviour must remain
consistent.

## Consequences

- Feature web packages gain one browser-safe design dependency.
- Production, package and test rendering use the same semantic tokens and
  recipes.
- Feature-specific visual identities extend the system without reversing the
  dependency.
- App-aware components must be split or left with their feature rather than
  moved mechanically.
- Explicit exports and accessibility fixes increase initial extraction work.
- The app may keep short-lived compatibility re-exports while imports move,
  but new code targets the package directly.
