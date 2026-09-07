---
name: feature-migration-review
description: Audit a LangWatch feature migration before commit for architectural honesty, behaviour parity, coverage parity, composition, and displaced app residue.
---

# Feature migration review

Review the actual diff and the old implementation. Passing package tests is not
proof that the migration is complete.

## Review gates

1. Compare old and new public behaviour field by field: DTOs, auth, error/status
   mapping, sorting, pagination/cursors, money/time units, query tables, retries,
   idempotency, and side effects.
2. Compare deleted tests with canonical coverage. List every lost scenario;
   restore meaningful coverage before approving deletion.
3. Verify singular ownership: one callable Feature API contract, one process-owned
   implementation, private repositories, and no duplicate caller-local service.
   Every server feature, including Enterprise, uses its canonical
   `defineFeature(...).withApp(...)` installer. Browser-only features need no
   invented server. Repository registration is static App metadata, never an
   instance API exposing persistence.
4. Reject callback/capability bags, service locators, `Pick`/`Omit`, inferred
   `Parameters`/`ReturnType` contracts, casts, suppressions, global App/Prisma,
   request-time construction, or package env access. In particular reject the
   `database: object` + `as PrismaClient` seam — the composition root already
   holds a typed `PrismaClient`, and the adapter/repository take it typed.
   `typed-prisma-seam` is the lint; see
   `dev/docs/best_practices/service-repository-adapter-port.md` for the shape.
5. Verify UI packages are controlled and portable. App hooks and tRPC clients
   stay in app composition; package context is not a concealed dependency bag.
6. Search the whole repository for displaced implementation, stale imports,
   deep imports, old tests/docs, and feature fragments left in generic app
   folders. Classify every remaining file as composition/transport or debt.
7. Check feature filenames/layout, deliberate root exports, workspace manifests
   and lock importers, strict contract build config, and concise current ADR/spec.
8. Run focused typechecks/tests, Oxfmt, Oxc, architecture lint, comment review,
   test-quality review, and diff check. Inspect the cached diff before commit.

For recurring findings, identify the existing lint and why it did not prevent
the change: missing coverage, a baseline, an omitted check or stale guidance.
Add or tighten deterministic enforcement with an adversarial fixture before
adding more prompt text. Retain runtime/security parity checks where static
analysis cannot establish behaviour.

Report blockers first, then exact residuals and verified commands. Do not call a
batch complete while a parity, coverage, composition, or package-link gate is
still open.
