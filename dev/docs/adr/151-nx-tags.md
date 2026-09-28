# ADR-151: Nx tags carry the layer, and boundaries are checked over them

**Date:** 2026-09-19

**Status:** Accepted. Superseded in part 2026-09-23: `dev/nx/tags-plugin.mjs` and
`pnpm check:boundaries` no longer exist, so the tags and the "40 violations"
baseline below are history; see the last section.

## Context

ADR-150 made Nx the task runner. It infers one project per pnpm workspace
member from `package.json`, which means the graph already knows every project
and every declared edge between them — but it knows nothing about what a
project *is*. `modules/trace/browser` and `packages/time` are the same kind of
node to it.

Meanwhile the architecture's boundary rules are stated in prose and enforced,
where they are enforced at all, per file: browser never imports process, a kit
is a leaf, a contract is portable, `packages/` holds no feature code. The
`@langwatch/architecture-enforcer` registry owns the file-level half. Nothing
answered the package-level question "may this project depend on that one at
all", and the answer was not written down anywhere a tool could read.

Nx's own answer is tags plus `@nx/enforce-module-boundaries`. The obstacle was
that the rule shipped for ESLint, which this repository does not have and will
not add — oxlint plus the enforcer are the only JavaScript linters. `@nx/oxlint`
now ships the same rule as an oxlint plugin, which removes that obstacle in
principle; Consequences records why it does not load here yet.

Two measurements motivated doing this now rather than later. Applying the
constraint set found `@langwatch/gateway-browser` depending on
`@langwatch/trace-process` — a browser package on a process package, the rule
violated most flatly — and `@langwatch/prompt-browser-kit` reaching into two
module browser packages, which is what dragged those packages into every
consumer's TypeScript program. Both had been invisible.

## Decision

**Tags are derived from the layout, never hand-listed.** `dev/nx/tags-plugin.mjs`
is an Nx inference plugin that computes a project's tags from its path. A
package cannot carry a wrong tag, disagree with its directory, or forget to
declare one, because no `package.json` states its tags at all. The plugin reads
JSON only and never touches the TypeScript compiler API, so it is unaffected by
the TS 7 API removal that broke `@nx/js/typescript` (nrwl/nx#36104).

Every project carries a `layer:`, most carry a `scope:`, module halves carry a
`tier:` and a `runtime:`. Applications and the generated install lists carry no
tier, because naming an enterprise half is precisely their job.

**`packages/` is a ladder, not a layer.** A single `layer:framework` bucket
permits any framework package to depend on any other, which constrains nothing
and admits cycles. The 45 packages sit on rungs — `primitive`, `client`,
`repository`/`migration`/`observability`, `eventing`/`transport`/`design`,
`runtime` — and a rung may depend only on its own and lower ones. `client` is
the raw datastore or vendor conduit; `repository` is owned state and the rung
that may name a client.

**`dev/nx/module-boundaries.json` is the one constraint set**, so that the graph
check and the oxlint rule — whenever it can run — answer from one file and
cannot disagree.

**Test and tooling packages are legal targets from everywhere.** They are
build-time dependencies of nearly every package and Nx's graph does not
separate `devDependencies`; a constraint that refused them would report several
hundred findings that are all correct code.

**Two rules stay file-level, deliberately.** Tags describe packages, so they
cannot express "only files under `repositories/prisma/**` may name Prisma" —
`layer:process` is therefore permitted to depend on `layer:client`, and the
precise rule remains the enforcer's. Contract-to-contract is likewise permitted
here and tracked separately.

## Consequences

`pnpm check:boundaries` reports **40 violations** over 224 projects, which is
the starting baseline. They are genuine findings rather than taxonomy noise: a
browser package on a process package, a kit on two browser packages, clients
and contracts reaching up the ladder, and ten cases of core code depending on
enterprise code.

The graph check has one blind spot worth stating, because it is the reason to
install the oxlint plugin rather than rely on the script: Nx builds edges from
*declared* dependencies, so an import of a package that `package.json` does not
list is invisible to it. `prompt-browser-kit` importing
`@langwatch/workflow-browser` was exactly that — undeclared, therefore absent
from the graph, therefore also absent from `nx affected`, which would replay a
stale green for that package. The oxlint rule reads import statements and does
not share the blind spot.

Enabling enforcement in the linter is one install and one config block:

```shell
nx add @nx/oxlint
```

```jsonc
// .oxlintrc.jsonc
{
  "jsPlugins": ["@nx/oxlint/boundaries-plugin"],
  "rules": {
    "@nx/enforce-module-boundaries": ["error", { /* dev/nx/module-boundaries.json */ }]
  }
}
```

That rule is marked experimental by Nx and rides the oxlint JavaScript plugin
API, which is outside oxlint's semantic versioning.

It also does not load here yet, and the reason is structural rather than
incidental. `@nx/oxlint/boundaries-plugin` pulls in
`@typescript-eslint/type-utils`, which reads the classic compiler API off the
`typescript` module and crashes against 7.0.2:

```
× Failed to load JS plugin: @nx/oxlint/boundaries-plugin
  TypeError: Cannot read properties of undefined (reading 'Intrinsic')
```

Two consequences. The failure is **silent** — oxlint reports it and still exits
0, so a configured-but-unloadable rule reads as enforcement while checking
nothing, which is worse than no rule. And Nx's own remedy is the alias in
their TS 7 guide, aliasing `typescript` to 6.x workspace-wide; this repository
declines that, because `tsc` must stay TS 7 and eight files in
`packages/test-harness` import `typescript/unstable/*`, which 6.x does not
expose.

The narrow path, if the rule is wanted, is a pnpm override scoping 6.x to the
`typescript-eslint` chain alone, leaving the `typescript` that supplies `tsc`
at 7. The store already holds `@typescript-eslint/type-utils` built against
6.0.3, so the resolution exists.

Until then `pnpm check:boundaries` is the enforcement, and its blind spot to
undeclared imports is a known gap rather than a hidden one.

## Amendment, 2026-09-23: the graph check is gone

`dev/nx/tags-plugin.mjs` is not in the tree, so no project carries a derived
tag, and the lint review of 2026-09-23 deleted `pnpm check:boundaries`. The
"40 violations" starting count above measured a check that no longer runs.
`dev/nx/module-boundaries.json` remains, read by nothing.

Package-level boundaries are enforced per import by `langwatch/package-boundaries`
(ADR-137), which reads import statements and so does not share the
declared-dependency blind spot described above, and per manifest by the
`cycles`, `manifests` and `browser-package-closure` policies of
`pnpm lint:architecture`.
