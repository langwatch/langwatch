# ADR-004: Frontend features expose owner-only screens and narrow surfaces

**Date:** 2026-08-28

**Status:** Accepted

**Behavioural contract:**
[Frontend feature boundary lint](../specs/frontend-feature-boundaries.feature)

**Related:**
[ADR-001: feature package boundaries](./001-feature-package-boundaries.md),
[ADR-101: feature package surfaces](../../../dev/docs/adr/101-feature-package-surfaces.md),
[ADR-111: physical application workspaces](../../../dev/docs/adr/111-physical-application-workspaces.md),
and [ADR-112: singular feature ownership](../../../dev/docs/adr/112-singular-feature-ownership.md).

## Context

`apps/ui` is the browser composition root, not a second catalogue of backend
features. A user-facing capability such as Trace Explorer may compose trace,
prompt, evaluation and scenario presentation; Prompt Studio may later compose
workflow and model-provider presentation. Requiring a frontend feature to map
one-to-one to a server feature would falsely describe those pages and encourage
application code to reach into implementation packages.

The opposite failure is a browser monolith with broad `components`, `hooks`,
`utils` and feature folders that can import every other feature. A convenient
Prompt reference in Trace Explorer must not make Prompt tables, routes, stores,
queries or the whole Prompt Studio importable. Existing package-root exports
and legacy application paths cannot demonstrate that distinction.

## Decision

Frontend features are independent, user-facing capabilities. `apps/ui` has one
central frontend catalogue at `src/features/catalogue.json`; it is separate
from `packages/features/catalogue.json` and does not claim server ownership.
The catalogue explicitly opts feature-web packages into governance. Each
frontend feature entry has a lower-kebab-case name, an exact root beneath
`src/features`, its owner-only screen imports and its approved external surface
imports. Adding an edge changes this catalogue, so composition growth is
visible in review. Routes, overlay intents and composition-hub rationale are
named catalogue extensions, not version-0 fields.

The browser application has only these production roots:

```text
apps/ui/src/
├── index.ts      # package entry only
├── app/          # bootstrap, providers, router, shell and overlay registry
├── platform/     # browser-safe transport, session, navigation, telemetry, storage
├── features/     # catalogue and user-facing composition capabilities
└── testing/      # browser test support
```

No other production root is allowed. A helper stays with its frontend feature
unless it is a browser capability in `platform`, a Design System primitive, or
a deliberately public feature-web contribution.

Feature web packages distinguish complete experiences from reusable pieces:

```text
packages/features/prompt/web/src/
├── screens/prompt-studio/       # owner-only Prompt Studio experiences
├── surfaces/prompt-reference/   # narrow controlled cross-feature contribution
├── surfaces/prompt-version/
└── surfaces/variable-type/
```

`screens/<name>` is an exact owner-only package export and may be imported only
by the frontend feature that declares it in the central catalogue. It may
expose private composition pieces while a screen is being migrated, but that
does not count as a completed screen until the owning frontend feature composes
the runnable experience. A screen may compose its own package's surfaces and
private implementation, but never owns application routing, fetch or tRPC
hooks, session lookup, cache policy, navigation or toasts. Those controlled
data and actions are provided by its owning frontend feature.

`surfaces/<name>` is an exact package export for a small, controlled UI
contribution. A consumer must declare that exact surface in the central
catalogue. A surface accepts portable values and named controlled actions; it
does not fetch, navigate, read session state, import an app API client, or
import another feature web package. Its complete production dependency closure
may reach only that surface directory, portable feature contracts, the Design
System and browser-safe third-party dependencies. It may not reach `screens`,
`internal`, sibling source folders, stores, transport, queries or routes. This
makes a Prompt reference usable in Trace Explorer without making Prompt Studio
or Prompt persistence-shaped UI usable.

Feature-web package root exports and wildcard exports are not a public UI door
for governed frontend packages. Importers use the declared `screens/<name>` or
`surfaces/<name>` subpath; source-path and undeclared subpath imports remain
sealed under ADR-001.

Frontend features cannot import another frontend feature's implementation.
They may import the Design System, their declared feature-web screens and
surfaces, portable feature contracts, and browser capabilities from `platform`.
`platform` cannot import product features. `app` imports feature route
installers and the overlay registry, but product pages do not become a second
global composition bucket.

A composition hub is a frontend feature whose catalogue entry has an explicit
rationale and an exact declared set of surfaces, for example Trace Explorer.
Hubs may compose many declared surfaces, but may never import a foreign screen
or bypass its package export. Hub rationale, overlay intent declarations and
graph metrics are planned extensions after the Prompt pilot; version 0 enforces
only exact screen/surface declarations and closures.

Globally openable drawers remain owned surfaces. The application overlay
registry is the only implementation importer of an overlay surface. Other
frontend features declare a typed overlay intent and request it through the
platform overlay port; they do not import the drawer, its store or its screen.
The pilot documents this ownership; the registry and intent checks are the next
lint increment before a cross-feature overlay lands.

### Prompt pilot

Prompt is the first governed feature-web package. `@langwatch/prompt-web`
replaces its root export with an owner-only `screens/prompt-studio` entry and
narrowly scoped surface exports. The initial screen entry contains migrated tab
presentation and browser behavior; it is an export-boundary pilot, not a claim
that the full Prompt Studio page has moved. Prompt references and version
badges are surfaces only after their closure passes this rule. Prompt tables,
the prompt library and the playground remain owner-only screen work.

The pilot establishes the governed-package catalogue, export map, browser-safe
screen/surface closure and fixtures, then classifies the already portable
Prompt pieces without changing behavior. It does not treat the current
`platform/app` Prompt tree as compliant merely by mapping its paths. A complete
Prompt Studio migration still requires its page, hooks and platform transport
ports to move as one dependency-closed slice.

### Rollout

New `apps/ui` source and each package in `governedWebPackages` are strict
immediately. Existing `platform/app` source remains behind the deterministic
shrinking legacy baseline from ADR-001 until it is deleted. The frontend rule
adds no blanket suppression: each migration names its replacement frontend
feature, screen or surface. Prompt is the first opt-in package; later packages
join only with their public exports, catalogue entries and fixtures.

### Public surfaces and transports

The frontend catalogue, exact web-package exports and the application overlay
port are source-level composition surfaces. They create no HTTP transport.
Browser API clients remain in `apps/ui/src/platform` and use portable
contracts. Frontend features, screens and surfaces never directly use fetch,
HTTP/query clients, router/session/storage globals, Node.js builtins, server
packages, generated Prisma, `AppRouter`, environment modules or legacy app
aliases.

### Dependencies

The frontend graph is acyclic: `app` may depend on `platform` and frontend
features; a frontend feature may depend on `platform`, declared feature-web
exports and portable contracts; `platform` may not depend on a product feature.
Feature-web rules in ADR-001 continue to apply. This ADR narrows browser UI
composition without making frontend names backend feature names.

### Persistence

Browser composition owns no persistence implementation. A surface receives
data and actions; persistence-shaped records and generated Prisma types remain
private to server adapters as required by ADR-001.

### Runtime and registration

`apps/ui` constructs one browser runtime. Feature routes and overlays are
registered deliberately by the application composition root, not by import
side effects. A screen or surface has no import-time registration and no global
application store lookup.

### Environment and configuration

Only `platform` receives the browser's validated public runtime configuration.
Frontend features, screens and surfaces receive typed capabilities or
controlled values and do not read environment modules.

### Errors

Diagnostics name the importing frontend feature, the imported export or source
path, and the applicable alternative: declared surface, owner screen, overlay
intent or platform capability. Screen and surface closure diagnostics name the
forbidden browser capability; surface-local diagnostics include the import path
that escaped the surface directory.

### Contracts and validation

The Prompt pilot validates central-catalogue roots, governed packages, names,
declared screen/surface edges, feature-web export roles, source directions and
the transitive import closure of every screen and surface. Its fixtures prove
allowed owner screens and surfaces as well as forbidden cross-feature,
package-root, deep-source, browser-capability, platform and server edges. The
later hub/overlay rules gain fixtures before enforcement. Existing legacy
findings are tracked only by the checked-in shrinking baseline; no baseline can
admit new `apps/ui` source.

## Alternatives considered

A one-to-one mirror of the backend catalogue was rejected because product
screens routinely compose multiple domain packages. Unrestricted frontend
feature imports were rejected because a single useful component would expose
an entire feature implementation. Generic shared folders were rejected because
they obscure ownership and turn every helper into a potential global coupling.
Allowing all feature-web root exports was rejected because it cannot express
the difference between a complete screen and a narrow reusable surface.

## Consequences

- Frontend features describe product capabilities without duplicating backend
  ownership.
- Cross-feature browser composition is explicit, narrow and reviewable.
- Trace Explorer can legitimately consume Prompt surfaces without consuming
  Prompt Studio.
- Prompt provides the first migration fixture before the policy expands to
  other browser packages.
- `apps/ui` can grow into a runnable application without recreating the
  monolithic folder taxonomy of `platform/app`.
