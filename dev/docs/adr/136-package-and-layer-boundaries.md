# ADR-136: Which package may name which, and in which direction

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:**
[Package boundaries](../../../specs/tooling/lint-package-boundaries.feature),
[browser imports of server values](../../../specs/tooling/lint-web-imports-server-shaped-value.feature),
[feature package boundaries](../../../packages/architecture-enforcer/specs/feature-package-boundaries.feature),
[frontend feature boundaries](../../../packages/architecture-enforcer/specs/frontend-feature-boundaries.feature),
[API transport through the framework](../../../packages/architecture-enforcer/specs/api-transport-through-framework.feature),
[the API package surface](../../../packages/architecture-enforcer/specs/api-package-surface.feature)

**Related:** [ADR-070: modular package architecture](./070-modular-package-architecture.md),
[ADR-101: feature package surfaces](./101-feature-package-surfaces.md),
[ADR-111: physical application workspaces](./111-physical-application-workspaces.md),
[ADR-128: public REST and internal tRPC](./128-public-rest-and-internal-trpc.md),
[ADR-135: the toolchain](./135-lint-and-format-toolchain.md)

## Context

ADR-070 and ADR-101 say what the module graph is meant to look like: a module
is a contract, a server and an optional web package; the contract is
transport-neutral; a web package never depends on a server one; only a
composition root wires a feature server package; core never depends on
Enterprise. Those are one-way dependencies, and a one-way dependency is
maintained by nothing at all unless something refuses the import.

The cost of not refusing it is measured, not theoretical. One value import of a
server-shaped package in a browser module put 576 declaration files into
`apps/ui`, 251 of them a SQL query builder. One value import from server code
into a component package pulled 2,020 modules and 212 MB of resident memory
into every backend process. Both were single lines that read as harmless in
review, and both were found by profiling rather than by reading.

Direction is only half of it. The rest of this family is about what a package
*publishes*: an `exports` map that actually lists its entry points, a public
`.d.ts` that does not leak Prisma or private repository types, a declaration
project whose references match its manifest, and a server package that does not
export factories no application ever constructs.

## Decision

Import direction is checked per import, in the plugin, because it needs the
importing file's role and the target's manifest. Everything that needs the
package graph, the catalogue or more than one manifest is architecture-enforcer.
A type-only import is always allowed: types are erased, and the browser program
never loads the graph behind them.

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/package-boundaries` | plugin | Thirteen message ids, one per shape: `webImportsServer`, `serverImportsBrowser`, `coreImportsEnterprise`, `contractRuntime`, `schemaBoundary`, `crossFeature`, `compositionRoot`, `featureLayer`, `sealedExports`, `packageEscape`, `prismaContainment`, `deadAlias`, `retiredPackageRuntime`. |
| `langwatch/web-imports-server-shaped-value` | plugin | A browser module may not value-import a package whose declarations are the server's. |
| `langwatch/service-does-not-open-a-channel` | plugin | A file under `services/` may not open the event bus, Redis pub/sub, an HTTP client, an AWS client, a mail sender or Slack; the conduit is a channel and the service takes its interface (ADR-144 decision 9). |
| `boundary-signature-mirrors` | architecture-enforcer | A boundary signature mirroring another type through `Parameters`/`ReturnType`, or hiding a nested `any` cast. |
| `enterprise-source-license` | architecture-enforcer | Every `enterprise/` source file carries its SPDX licence header. |
| `application-boundaries` | architecture-enforcer | One application may not import another's source, nor the wrong Enterprise composition. |
| `frontend-ui-boundaries` | architecture-enforcer | Every `apps/ui` production file has an owner in the catalogue, and no forbidden web cross-import. |
| `cycles` | architecture-enforcer | No circular manifest dependency among workspace packages. |
| `port-modules` | architecture-enforcer | A strict port module is exactly one exported abstract class named `*Port`. |
| `manifests` | architecture-enforcer | Every manifest declares an explicit `exports` map, no private or accidental entry point, no retired Zod, no cross-application dependency. |
| `global-app-access` | architecture-enforcer | No new use of the legacy `getApp` service locator, against a shrink-only baseline. |
| `declarations` | architecture-enforcer | A package's public `.d.ts` does not leak Prisma, application source or private repository types. |
| `composed-exports` | architecture-enforcer | A server package does not export a factory no application entrypoint constructs. |
| `declaration-project-references` | architecture-enforcer | Declaration-project references do not cycle, dangle, or drift from the manifest. |
| `contract-build-config` | architecture-enforcer | A contract package's declaration build is configured, and src-only. |
| `api-transport-boundaries` | architecture-enforcer | A transport handler does not reach raw request or response context. |
| `api-transport-framework` | architecture-enforcer | A REST or tRPC file goes through `@langwatch/api` rather than hand-rolling the framework or skipping output validation. |
| `service-projection-boundaries` | architecture-enforcer | A domain service does not depend on a collaborator exposing projection-store writes. |
| `eventing-roles` | architecture-enforcer | A projection, subscriber or process manager stays inside its role: no I/O, no awaiting, no fabricated durable events. |
| `architecture-records` | architecture-enforcer | Every non-application ownership root owns a boundary ADR with the required sections and at least one spec. |
| `feature-configuration` | architecture-enforcer | Two applications do not each bind the same environment variable through their own config schema. |

`sealedExports` is why `package-boundaries` cannot become
`no-restricted-imports`: it reads the *target* package's `exports` map to
decide whether a subpath is published, and a glob cannot know that. The
`featureLayer` check has the same problem in the other direction - it needs the
layer rank of both ends of the import. See ADR-135.

## Consequences

The rules that matter most here fire on one line and are argued about in terms
of megabytes, which is an uncomfortable conversation to have in review and an
easy one to have with a linter. `frontend-boundary.unit.test.ts` walks the real
value-import graph transitively from the application entrypoints, so a chain
that reaches a browser package through three intermediate modules is still
caught; that test is the backstop for the per-import rules.

`architecture-records` is the rule that makes this family self-sustaining: a
new ownership root cannot land without its own boundary ADR and spec. It reads
package-local `adrs/` folders, not this repository-wide index, so a module
documents its own boundary next to the code.
