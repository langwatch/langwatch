---
name: feature-migration
description: Move a LangWatch feature slice from the application into strict contract, server, or web packages while preserving behaviour and composing one service graph.
---

# Feature migration

Use the latest feature inventory. If none exists or ownership is unclear, run
`feature-inventory` first.

## Build one vertical slice

1. Read root `AGENTS.md`, the feature catalogue entry, ADR, spec, public
   contracts, old implementation, callers, and tests.
2. Characterise externally observable behaviour before changing it: response
   fields, errors, auth, ordering, pagination, units, query selection, side
   effects, concurrency, retries, and idempotency.
3. Extend only the package surfaces the slice needs:
   - contract: portable Zod 4 values/errors and one callable `<Feature>Api`
     interface with its same-named runtime token in `<feature>.api.ts`;
   - server: one concrete service with private repositories/ports/adapters;
     concrete collaborators use private constructors, `static create` factories
     and ECMAScript `#private` state;
   - web: reusable controlled presentation and browser behaviour.

   For the four server layers (port, repository, service, adapter) and the
   typed-Prisma seam every Postgres-backed feature keeps, follow
   `dev/docs/best_practices/service-repository-adapter-port.md`. The
   `typed-prisma-seam` lint rejects any new file that reintroduces
   `database: object` + `as PrismaClient` — the shape that was the old
   convention.

4. Use `defineFeature(...).withApp(...)` and the canonical `FeatureSetup`
   factory. Apps implement their API with callable methods and own services in
   ECMAScript private fields. These rules also apply to Enterprise server features.
   Compose one concrete graph at the process root. Inject complete peer APIs,
   typed configuration, clocks/IDs, and technical ports. Do not use a
   callback bag or service locator.
5. Rewire every production caller in the slice. Transport handlers call the
   composed service directly; application UI retains routing and data hooks.
6. Move equivalent tests and delete displaced implementations. Leave a
   compatibility adapter only when a live transport/import still needs it, and
   keep it behaviour-free.
7. Update the feature ADR/spec and relevant developer docs to current concise
   facts. Record exact remaining seams rather than claiming the feature is done.

## Verify

Keep small cohesive transformations as functions. Use services, repositories
and adapters when behaviour coordinates dependencies, persistence, policy or
effects. A collaborator must own a real responsibility; do not trade a giant
utility module for chains of forwarding wrappers. Check readability separately
from passing tests and lint.

Use failing lint output as the repair list. Give each delegated task an owning
feature, exact paths, preserved behaviours and focused checks; the lint repair
messages supply recurring architecture instructions. Do not weaken a rule,
raise a baseline, remove meaningful tests or rename the same dependency bag to
make a failure disappear. Add a rule only for a recurring, deterministically
recognizable failure that existing rules do not cover.

Before crossing core/Enterprise roots, compare original source ownership and
license with the accepted placement ADR. Keep Enterprise implementation under
its owner; deleting an SPDX marker is not a boundary correction.

Run contract/server/web typechecks and tests as applicable, focused app tests,
Oxfmt, Oxc, strict architecture lint, test-quality review, and diff check.
Never bless new code with a migration baseline. Do not stage or commit unrelated
shared-worktree changes.
