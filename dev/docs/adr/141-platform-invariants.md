# ADR-141: The invariants a single file can be checked against

**Date:** 2026-09-09

**Status:** Proposed. Amended 2026-09-23: the ast-grep rows and three plugin rules
are gone, and the fetch timeout is a plugin rule (see the last section).

**Behavioural contract:**
[One clock](../../../specs/tooling/lint-temporal-only.feature),
[id origin](../../../specs/tooling/lint-id-generation-origin.feature),
[environment boundaries](../../../specs/tooling/lint-environment-boundaries.feature),
[a service given its config](../../../specs/tooling/lint-service-loads-its-own-config.feature),
[plan literals](../../../specs/tooling/lint-plan-literals.feature),
[fetch timeouts](../../../specs/tooling/lint-require-fetch-timeout.feature),
[boot hooks](../../../specs/tooling/lint-no-boot-hook-outside-guard.feature),
[inline dynamic imports](../../../specs/tooling/lint-no-inline-dynamic-import.feature),
[the explicit-any scope](../../../specs/tooling/lint-platform-invariants.feature)

**Related:** [ADR-132: secrets are not configuration](./132-secrets-are-not-config.md),
[ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md),
[ADR-131: the plans catalogue](./131-plans-catalogue.md),
[ADR-135: the toolchain](./135-lint-and-format-toolchain.md)

## Context

Some platform decisions are true of every file and provable from one file. One
clock. One id scheme. One place the environment is read. One catalogue of plan
facts. Every route through the access policy. Each of those decisions has an
ADR or a package behind it, and each was, before these rules, held up entirely
by whether the next person happened to know about it.

They share a failure mode: the violation is invisible in review and expensive
later. A second `new Date()` does not fail; it produces a moment in a different
time model that only diverges under a timezone or a leap second. A
`randomUUID()` id does not fail; it sorts wrongly and says nothing about what
it names, forever, because ids are permanent. A `process.env.OPENAI_API_KEY`
does not fail; it reads a value that skipped classification and redaction, so
the next log line leaks it. A second copy of a plan limit does not fail; it
quotes a customer a different number on a different page.

## Decision

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/temporal-only` | plugin | No `Date` in governed source: not `new Date`, `Date.now`, `Date.parse`, `Date.UTC`, nor a value typed `Date`. The Prisma seam, the two named conversion helpers and the time package keep theirs. |
| `langwatch/id-generation-origin` | plugin | Ids are ksuids behind a kind prefix: no `nanoid`, no `uuid`, no `crypto.randomUUID()`. An `idempotencyKey` is not an id and is exempt. |
| `langwatch/idempotency-key-is-stable` | plugin | An `idempotencyKey` is not minted where the request is built, because every attempt would then carry a different key. Derive it from the request's own content, or bind it once for the operation it identifies. |
| `langwatch/environment-boundaries` | plugin | Only an app's `src/main.ts` or `src/config.ts` reads `process.env`; a module declares the key in its config schema and takes the parsed value. |
| `langwatch/service-loads-its-own-config` | plugin | A service does not declare its own `loadConfig`/`resolveConfig`/`readConfig`; config is a named member of the argument `create` takes. See fc80f65635. |
| `langwatch/plan-literals` | plugin | Two or more plan limit fields in one object outside `@langwatch/plans` is a second plan definition. |
| `langwatch/require-fetch-timeout` | plugin | A `fetch` in a channel carries an abort signal, or it hangs as long as the peer holds the socket. |
| `langwatch/no-boot-hook-outside-guard` | plugin | A process lifecycle listener is registered only by the boot guard: the `Server` for a long-running process, `bootNodeExecutable` for a one-shot. |
| `langwatch/no-inline-dynamic-import` | plugin | No inline `import(…)`; a dependency is a top-level import. |
| `langwatch/em-dash-in-copy` | plugin | No em dash in customer-facing copy. |

Every plugin rule here is a candidate for oxlint configuration and is
deliberately not written there yet: ADR-135 records the classification and the
message-quality cost. (The 718 baseline entries once in the way are gone.)

`no-explicit-any` was deleted from ast-grep under ADR-135's class-A migration
and its built-in replacement, `typescript/no-explicit-any`, was measured
rather than adopted: 1,782 findings across 336 files, 294 of them beyond
anything the ast-grep rule ever matched (751 findings/175 files), and no
`oxlint-baseline.json` rows to re-key, since ast-grep never wrote to that
file. `pnpm lint:oxlint` runs `--quiet`, which makes a "warn" severity
invisible and an unbaselined "error" a hard failure on every one of the
1,782 - neither is what "enabled" should mean, so `typescript/no-explicit-any`
carries no row here and no config line. See `specs/tooling/lint-platform-invariants.feature`.
On 2026-09-23 it was enabled at `error` for TypeScript source outside tests, by
an `overrides` block rather than workspace-wide (ADR-135).

## Consequences

Each of these rules is cheap to satisfy at the moment of writing and expensive
to satisfy later, which is the shape that justifies a linter rather than a
review convention. The cost is a set of exemptions that have to be maintained
by hand: the boundary helpers for `Date`, the config and boot paths for
`process.env`, the CLI startup path for `import()`. An exemption list that
grows is the signal the invariant is wrong, not that the rule is annoying.


## Amendment, 2026-09-17: `no-inline-dynamic-import` (ast-grep) deleted as a duplicate

The ast-grep half was narrower than the `langwatch/no-inline-dynamic-import`
oxlint plugin rule it duplicated — scoped to `apps/**` + `packages/**`, missing
every file under `modules/**` — and worded differently for the same shape. The
plugin rule is the one of record now; its files, fixtures and this table row
are gone.

## Amendment, 2026-09-23: ast-grep, secrets and the Hono rules are gone

ast-grep was removed. `require-fetch-timeout` became a plugin rule scoped to
channels; `no-localhost-fallback`, `no-double-type-assertion` and
`no-clickhouse-env-skip-guard` were deleted (the last had no live target, and
`langwatch/stand-in-cast` refuses the double cast); `no-export-star-shim` was
deleted because the tree's barrels are legitimate `export *`.

`langwatch/secrets-through-source` was deleted: it held an empty key set and
never fired. `langwatch/no-raw-hono-mount` and `langwatch/api-context-services`
were deleted with the shapes they guarded. `no-console` and
`no-restricted-imports` joined this family as native rules scoped to process
source (ADR-135).
