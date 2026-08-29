# ADR-001: Identity ships as a feature, not as root packages

**Date:** 2026-08-29

**Status:** Accepted

**Behavioural contract:**
[Identity package boundary](../specs/package-boundary.feature)

**Related:**
[ADR-115: identity ships as packages](../../../../dev/docs/adr/115-identity-ships-as-packages.md),
[ADR-101: the identity platform](../../../../dev/docs/adr/101-identity-platform.md)

Supersedes the package LOCATION in ADR-115; its boundaries are unchanged.

## Context

ADR-115 split identity into `@langwatch/identity` (pure vocabulary),
`@langwatch/identity-server` (guards, services, ports) and, later,
`@langwatch/identity-eventing` (envelopes, commands, folds, pipelines). All
three landed at the `packages/` root, mirroring `packages/authz` and
`packages/authz-server`, which is where those two lived at the time.

`authz` has since moved to `packages/features/authz/{contract,server}`, and the
strict feature layout that move established is now what every other feature
follows. Identity was the last vertical still sitting beside the shared
infrastructure packages, which put it in the one place the feature catalogue
does not look.

## Decision

Identity is a feature.

| Was                          | Is now                                |
| ---------------------------- | ------------------------------------- |
| `packages/identity`          | `packages/features/identity/contract` |
| `packages/identity-server`   | `packages/features/identity/server`   |

`@langwatch/identity` is renamed `@langwatch/identity-contract`, because the
feature layout derives a package's name from its role: a package at
`packages/features/<feature>/<role>` must be called
`@langwatch/<feature>-<role>`. `@langwatch/identity-server` already matched and
keeps its name. The dependency direction ADR-115 set — contract knows nothing of
the server, the server owns the guards — is untouched.

## `@langwatch/identity-eventing` stays where it is

It is not moving with the other two, for two reasons that are worth recording
rather than discovering again:

**The layout has three roles and none of them is "eventing".** A feature package
may be `contract`, `server` or `web`; anything else is a `feature-layout`
violation by name. Event-sourcing code normally lives in a feature's `server`
role — the strict layout has `projections/`, `processes/`, `intents/`,
`stores/` and `subscribers/` precisely for it, and the log, metric and trace
features all do this.

**But folding it into `server` would merge two zod majors.** `identity-contract`
and `identity-server` are on `zod@^3.25.76`; `identity-eventing` is on
`zod@^4.4.3`. One package cannot hold both, and choosing either version
rewrites schemas on the other side of a boundary where `instanceof ZodError`
stops matching — a failure that surfaces as a 500 rather than as a type error.

Folding it in would also contradict ADR-115's rule that the server runtime never
imports the event-sourcing framework, which is the reason the package was split
out in the first place.

So the move waits on the zod alignment. Until then `@langwatch/identity-eventing`
is a root package that depends on two feature packages, which the layout permits.

### Contracts and validation

`@langwatch/identity-contract` owns the vocabulary, the fact and command zod
schemas, the reducer and the errors. Nothing about that changed here.

### Persistence

Not applicable to this decision. Neither package has a storage engine — every
repository arrives as a port, and the app implements them with Prisma — and this
move does not touch a single one.

### Public surfaces and transports

Not applicable to this decision. `@langwatch/identity-server` keeps both entry
points it had, `.` and `./better-auth`, at the same specifiers. No route, no
procedure and no HTTP surface changes; a consumer that imported
`@langwatch/identity-server` before imports exactly that afterwards.

### Dependencies

`identity-contract` depends on nothing in the workspace. `identity-server`
depends on `identity-contract`, `@langwatch/handled-error`,
`@langwatch/observability` and `@langwatch/ksuid`, with `better-auth` as a peer.
The rename changed the SPECIFIER `@langwatch/identity` to
`@langwatch/identity-contract` in 855 files and nothing else about the graph.

`@langwatch/identity-eventing` continues to depend on both, from outside the
feature tree, for the reasons above.

### Runtime and registration

Not applicable to this decision. The one composition root stays
`platform/app/src/server/app-layer/identity/runtime.ts`, and ADR-115's rule
stands: a new consumer imports from the runtime or it is wrong.

### Environment and configuration

Not applicable to this decision. Neither package reads `process.env`; the
package-boundary test in
`platform/app/src/server/__tests__/identity-package-boundaries.unit.test.ts`
enforces that, and its two package roots were repointed as part of this move.

### Errors

Not applicable to this decision. The error classes and their codes are
unchanged.

## Alternatives considered

**Move all three and fold `identity-eventing` into `server`.** Rejected on the
zod majors: the two sides are on `zod@3` and `zod@4`, and one package cannot
hold both.

**Add an `eventing` role to the feature layout.** Rejected as out of scope — it
is a change to the architecture rules every feature is checked against, and the
zod split would still block the move afterwards.

**Leave identity at the `packages/` root.** Rejected: it was the last vertical
outside the feature tree, so the catalogue, the layout checks and the
feature-suite CI job all skipped it.

## Consequences

The strict feature layout now applies to identity, and it does not currently
satisfy it: the source files are named for what they are rather than for the
layout's grammar, and the tests sit in `src/__tests__/`. Those violations are
now VISIBLE, which they were not while the packages lived outside the feature
tree. Bringing the file names into the grammar is a separate change.

`retired-package-runtime` also now reports what it could not see before: both
packages are on `zod@^3.25.76`, a major the workspace has retired.

## Status of `identity-eventing` on this branch

Separately, and predating this move: its four pipelines call
`definePipeline<T>()` with no arguments and then chain `.withName(...)
.withAggregateType(...)`. `@langwatch/eventing` now takes
`definePipeline<T>({ name, aggregate })`, and every other caller in the
workspace passes it. Five of its test files fail on that, and it does not
typecheck. Adapting the four pipelines is a real migration — `aggregate` wants
an `AggregateDefinition`, not the string `withAggregateType` took — and is not
part of this move.
