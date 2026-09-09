# ADR-141: The invariants a single file can be checked against

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:**
[One clock](../../../specs/tooling/lint-temporal-only.feature),
[id origin](../../../specs/tooling/lint-id-generation-origin.feature),
[environment boundaries](../../../specs/tooling/lint-environment-boundaries.feature),
[secrets through the source chain](../../../specs/tooling/lint-secrets-through-source.feature),
[plan literals](../../../specs/tooling/lint-plan-literals.feature),
[raw Hono mounts](../../../specs/tooling/lint-no-raw-hono-mount.feature),
[API context services](../../../specs/tooling/lint-api-context-services.feature),
[the ast-grep invariants](../../../specs/tooling/lint-platform-invariants.feature)

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
| `langwatch/id-generation-origin` | plugin | Ids are ksuids behind a kind prefix: no `nanoid`, no `uuid`, no `crypto.randomUUID()`. |
| `langwatch/environment-boundaries` | plugin | Only a `platform/config/` module or a process boot file reads `process.env`. |
| `langwatch/secrets-through-source` | plugin | A key classified in `@langwatch/secrets/keys.json` is never read straight from the environment. See ADR-132. |
| `langwatch/plan-literals` | plugin | Two or more plan limit fields in one object outside `@langwatch/plans` is a second plan definition. |
| `langwatch/no-raw-hono-mount` | plugin | Mount through `app.access(policy)`; a verb on the raw Hono app is a route the access policy never saw. |
| `langwatch/api-context-services` | plugin | An API class does not construct services, cast its context to recover them, take per-request resolvers, or double-await one call. |
| `no-inline-dynamic-import` | ast-grep | Inline `import(...)` where a top-level `import` belongs. The CLI boot path is the documented exception. |
| `no-localhost-fallback` | ast-grep | No `?? "http://localhost:..."`. A required variable is validated in the Zod schema and consumed without a fallback. |
| `require-fetch-timeout` | ast-grep | `fetch(...)` carries `signal: AbortSignal.timeout(ms)`, or it hangs as long as the peer holds the socket. |
| `no-export-star-shim` | ast-grep | `export * from "..."` is a backwards-compatibility shim; update the consumers instead. |
| `no-double-type-assertion` | ast-grep | `x as unknown as T` switches the type checker off; a single `as T` at least has to prove an overlap. |
| `no-explicit-any` | ast-grep | Prefer `unknown` and narrowing, or a real type. |
| `no-clickhouse-env-skip-guard` | ast-grep | An inverted ClickHouse skip guard means "always skip", so the suite reports green having run nothing. |

Every plugin rule here is a candidate for oxlint configuration and is
deliberately not written there yet: ADR-135 records the classification, the
718 baseline entries in the way, and the message-quality cost.

`no-explicit-any` is in ast-grep rather than as `typescript/no-explicit-any`
for one measured reason: the built-in fires 1,395 times, so it is off in the
config. The ast-grep rule is a warning that reaches review on changed lines
instead of a failure nobody can clear.

## Consequences

Each of these rules is cheap to satisfy at the moment of writing and expensive
to satisfy later, which is the shape that justifies a linter rather than a
review convention. The cost is a set of exemptions that have to be maintained
by hand: the boundary helpers for `Date`, the config and boot paths for
`process.env`, the CLI startup path for `import()`. An exemption list that
grows is the signal the invariant is wrong, not that the rule is annoying.

`no-clickhouse-env-skip-guard` is here rather than under test quality on
purpose: an inverted skip guard is not a bad test, it is a suite that reports
success without running, which is the failure mode this repository has been
bitten by.
