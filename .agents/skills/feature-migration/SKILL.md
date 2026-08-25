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
   - contract: portable Zod 4 values/errors and the canonical abstract service;
   - server: one concrete service with private repositories/ports/adapters;
   - web: reusable controlled presentation and browser behaviour.
4. Compose one concrete graph at the process root. Inject complete cross-feature
   services, typed configuration, clocks/IDs, and technical ports. Do not use a
   callback bag or service locator.
5. Rewire every production caller in the slice. Transport handlers call the
   composed service directly; application UI retains routing and data hooks.
6. Move equivalent tests and delete displaced implementations. Leave a
   compatibility adapter only when a live transport/import still needs it, and
   keep it behaviour-free.
7. Update the feature ADR/spec and relevant developer docs to current concise
   facts. Record exact remaining seams rather than claiming the feature is done.

## Verify

Run contract/server/web typechecks and tests as applicable, focused app tests,
Oxfmt, Oxc, strict architecture lint, test-quality review, and diff check.
Never bless new code with a migration baseline. Do not stage or commit unrelated
shared-worktree changes.
