# ADR-001: Feature package boundaries are executable

**Date:** 2026-08-21

**Status:** Accepted

**Behavioural contract:**
[Feature package boundary lint](../specs/feature-package-boundaries.feature)

**Related:**
[ADR-101: feature package surfaces](../../../dev/docs/adr/101-feature-package-surfaces.md),
[ADR-102: runtime composition roots](../../../dev/docs/adr/102-runtime-composition-roots.md),
[ADR-111: physical application workspaces](../../../dev/docs/adr/111-physical-application-workspaces.md),
[ADR-112: singular feature ownership](../../../dev/docs/adr/112-singular-feature-ownership.md),
and [ADR-003: unified Oxc toolchain](./003-unified-oxc-toolchain.md).

## Context

Separate workspace packages only improve architecture if their boundaries
cannot be bypassed. TypeScript can follow a long relative path outside a
package, package managers can expose an accidental wildcard, type-only imports
can couple browser code to server declarations, and a generated Prisma type can
leak through an exported service signature without loading Prisma at runtime.
These are all “prison escapes”: the directory looks sealed while consumers can
still reach its internals.

The source checks need to be fast enough to run with ordinary lint. Oxlint's
JavaScript plugin API can derive a rule from the current filename and inspect
imports and syntax in its native traversal. Workspace manifests, cycles,
emitted declarations and Markdown architecture records are repository-level
concerns and remain in a small graph-aware companion check.

The first feature packages must not wait for a later cleanup to establish this
gate. Agents, Entitlements, shared Configuration, the Design System, and the
architecture tool itself should be born behind the same record requirements
that future packages inherit.

## Decision

Create an Oxlint plugin plus a private workspace tool named
`@langwatch/architecture-lint`. Root lint runs the Oxlint source rules first,
then the deterministic workspace CLI.

```text
packages/architecture-lint/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts
│   ├── workspace.ts              # package discovery and role classification
│   ├── manifests.ts              # names, dependencies and exports
│   ├── architecture-records.ts   # required ADR/spec structure
│   ├── declarations.ts           # emitted public API scan
│   ├── policies/
│   │   ├── feature-layout.ts
│   │   ├── package-roles.ts
│   │   ├── public-exports.ts
│   │   ├── cross-feature.ts
│   │   └── prisma-containment.ts
│   └── index.ts
├── oxlint-plugin.mjs              # source/import/style rules
├── tests/
│   ├── fixtures/
│   └── feature-package-boundaries.test.ts
├── adrs/
└── specs/
```

The linter discovers core feature surfaces at
`packages/features/<feature>/{contract,server,web}` and enterprise surfaces at
`packages/enterprise/features/<feature>/{contract,server,web}`. Each surface is
a physical package. Its manifest name must match its location:

```text
core:       @langwatch/<feature>-<role>
enterprise: @langwatch/enterprise-<feature>-<role>
```

Missing optional roles are valid. Unexpected directories containing a
`package.json`, duplicate package names and a feature directory containing its
own package manifest are errors.

`packages/features/catalogue.json` is the authoritative ownership map for core
and Enterprise features. It registers each singular feature identifier, exact
root, classification and sorted product subjects. `feature.json` selects only
the strict layout version. Contract and server production filenames must
correspond to a subject owned by their registered feature after architectural
suffixes such as `.service`, `.port`, `.adapter`, `.repository`,
`.projection`, `.commands`, `.queries`, and `.events` are removed.

Every subject has exactly one owner. A local manifest edit cannot acquire an
adjacent subject, and a package cannot export a service, repository, store,
adapter or schema named for another feature's subject. Adding a feature or
subject is an architectural expansion: the catalogue, feature ADR and
behavioural spec change together. This preserves coherent subordinate concepts
without allowing a broad feature name to become a catch-all.

ADR-111 adds four non-feature enterprise packages at fixed paths beneath one
legal ownership root:

```text
packages/enterprise/LICENSE.md                    # governs the entire tree
packages/enterprise/package.json                 # @langwatch/enterprise
packages/enterprise/composition/api/             # @langwatch/enterprise-api
packages/enterprise/composition/worker/          # @langwatch/enterprise-worker
packages/enterprise/composition/web/             # @langwatch/enterprise-web
```

The root package follows portable contract rules and owns catalogue vocabulary.
The legal notice must exist before any enterprise package is accepted, and
package metadata must not claim that a descendant is Apache-only. Each
composition package may import enterprise implementation packages only for its
named runtime and must not contain implementation itself. The three composition
packages cannot depend on one another. No other package manifest is allowed
directly beneath the enterprise ownership root; product licensing is an
ordinary strict enterprise feature rather than another aggregate role.

### Package roles determine allowed dependencies

Production source and runtime dependencies follow these rules:

- `contract` may use portable dependencies such as Zod, but not React, Chakra,
  Node built-ins, Prisma, tRPC/Hono server code, Eventing, Group Queue, its own
  server/web package or app aliases;
- `server` may depend on its own contract and server-safe infrastructure, but
  not React, Chakra, its own web package or another feature's server package;
- `web` may depend on its own contract, React, Chakra and the Design System,
  but not Node built-ins, Prisma, tRPC server, Hono, Eventing, Group Queue, an
  app source path or any feature server package;
- a feature may depend on another feature only through that feature's contract;
- a core package may not depend on an enterprise package; and
- the complete package graph must be acyclic.

Only designated application composition modules and the three enterprise
composition packages may import compatible feature installation entry points.
Ordinary app handlers, services and browser code use feature contracts or
capabilities supplied by their runtime. The rule prevents the composition-root
exception from turning into permission for the whole application or enterprise
tree to reach server implementations.

Development-only test dependencies may include test runners and Node tooling,
but production `src` imports remain subject to the role rules. Tests may reach
private files inside their own physical package; they may not reach another
package's internals.

### Export maps are the only doors

Every feature surface has an explicit `exports` map. Wildcard subpaths,
`./src/*`, repository, adapter and internal wiring exports are forbidden.
Contract packages initially expose only `.`. Server and web packages may expose
additional named entry points only when the ADR for that feature identifies
them as supported composition surfaces.

Imports of a workspace package are resolved against that package's export map.
An undeclared subpath is an error even if a file exists on disk. A relative
import whose resolved target leaves the importing physical package is also an
error. Package source cannot use app aliases (`~/`, `@app/`, `@ee/`) or relative
paths to `platform/app`.

These checks apply to type-only imports as well. A type dependency is still an
architectural dependency and can leak server or persistence vocabulary into a
public declaration.

### Prisma is contained twice

Only files beneath `server/src/repositories/prisma/` may import a generated
Prisma client or `@prisma/client`. The source check catches direct imports. Each
feature package's declaration build is then scanned; any public `.d.ts` that
mentions Prisma, a generated client path, a private repository or an app path
fails the gate.

The same declaration scan prevents an apparently portable contract or web
package from re-exporting a forbidden type indirectly.

Governed feature contracts use Zod 4 through `zod`, and any other governed
feature package that declares Zod uses the same major. The manifest check
rejects older Zod majors, while the source rule rejects `zod/v3`,
`@hono/zod-validator` and `hono-openapi/zod`. REST adapters consume contract
schemas through Standard Schema instead of coupling a feature to a
Hono-specific schema adapter.

### Failures are actionable and adoption is strict

The CLI reports policy, importer, line, specifier and the allowed alternative,
then exits non-zero. Fixture tests cover one valid package graph and every
forbidden edge. There is no per-file escape comment or baseline for new feature
packages: an exception changes architecture and therefore requires changing the
policy and its ADR deliberately.

The first rollout enforces every nested feature package and every repository
import that targets one of those packages. It does not attempt to classify all
legacy app folders as features. As code moves into the new roots, it becomes
strict immediately.

### Source shape is enforced by Oxlint

The `langwatch/package-boundaries` rule enforces role-safe imports, sealed
subpaths, relative package containment, Prisma adapter containment, composition
root ownership and the prohibition on reading environment variables inside
feature packages. The `langwatch/service-classes` rule requires service modules
to export service classes with a static `create` method and rejects exported
standalone service factories. Private, pure module-local helpers remain valid
implementation details. `langwatch/no-conditional-spread` and Oxlint's
`no-nested-ternary` keep control flow explicit in feature server code.

The plugin operates on production source. Tests may import their test runner
and Node tooling, but cross-package and export-map boundaries still apply.

### Architecture records are part of the package contract

Every governed package ownership root has `adrs/README.md`, at least one boundary ADR
and at least one linked `.feature` file. The boundary ADR must state Context,
Decision, Public surfaces and transports, Dependencies, Persistence, Runtime
and registration, Environment and configuration, Errors, Contracts and
validation, and Consequences. A section may explicitly say a concern does not
apply; omitting the concern is a lint failure. The ADR index must link the
record, and the record must link its executable feature contract.

This check cannot prove architectural prose is wise or current. It does keep
each new package's agreed boundary visible and makes a missing or hollow record
fail in the same gate as a bad dependency.

Workspace discovery, root test filters, packed-file lists and feature-spec
discovery are updated in the same change so nested packages are built, tested,
published where appropriate and checked in CI.

### Public surfaces and transports

The package exports its workspace checker as a programmatic API and provides a
repository-only CLI. The Oxlint plugin is loaded by the root architecture
configuration; none of these surfaces is a product HTTP or worker transport.

### Dependencies

The source rule runs through Oxlint's JavaScript plugin interface. The
workspace checker uses TypeScript only for declaration emission and Node file
APIs for deterministic manifest, graph, ADR, and specification inspection.

### Persistence

Architecture lint owns no persistence. It reads the current source tree and
package manifests without writing a cache, baseline, generated policy file, or
exception registry that could drift from the checked repository.

### Runtime and registration

The root `lint:architecture` script loads the plugin and then invokes the
workspace CLI. Importing the package registers nothing, and CI receives a
non-zero exit only from violations found during that explicit invocation.

### Environment and configuration

The CLI receives its repository root as an argument and the Oxlint plugin uses
the linter working directory. Neither reads product environment variables or
shares the app and worker runtime configuration contract.

### Errors

Policy failures are returned as structured architecture violations containing
the policy, file, optional line and specifier, explanation, and allowed
alternative. The CLI formats all violations and exits non-zero once.

### Contracts and validation

Fixture tests exercise valid and invalid package graphs, source syntax,
declaration leaks, and architecture-record completeness. Required ADR sections
must contain a short explanation or explicitly state why a concern does not
apply, so heading-only records cannot satisfy the gate.

## Alternatives considered

Biome `noRestrictedImports` alone cannot reason about manifests, roles,
relative escape paths or declaration output. A TypeScript-only custom source
scanner duplicates work that Oxlint already performs and is slower in the
ordinary lint loop. TypeScript project references
prevent some missing dependencies but do not stop a declared web-to-server
edge. Package export maps stop normal Node resolution but can be bypassed by
relative filesystem imports inside a monorepo and do not express feature-role
policy.

Adopting a large general-purpose dependency graph framework would add another
configuration language for a small, stable set of LangWatch rules. The
workspace checker uses package manifests and TypeScript declaration emit only
for the checks an AST lint plugin cannot perform.

## Consequences

- New feature packages cannot silently regain monolith dependencies.
- Feature roots and package names use their singular catalogue identifier.
- Product subjects cannot be duplicated or claimed through a local manifest.
- “Contract only” cross-feature collaboration is mechanically checked.
- Export maps become deliberate API design rather than packaging decoration.
- Prisma leaks fail both at source and public declaration boundaries.
- Services, explicit control flow and environment injection are source-linted.
- Missing or structurally incomplete feature ADRs and specs fail the gate.
- Adding a supported package entry point requires an explicit manifest and
  policy change.
- The linter itself needs fixture coverage and maintenance as package roles
  evolve.
