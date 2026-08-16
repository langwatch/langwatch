# ADR-081: Governed analytics SQL blocks user-supplied table functions, by AST policy and by grants

**Date:** 2026-08-03

**Status:** Accepted

## Context

The governed analytics SQL API ([#6480](https://github.com/langwatch/langwatch/issues/6480))
accepts native ClickHouse SQL from an authenticated API client and runs it
against `analytics.*` as a single shared restricted database identity. Tenant
isolation is carried by row policies keyed on a per-query capability, and
read-only enforcement by `readonly = 1` in a settings profile — both provisioned
by `platform/app/src/server/analytics/governed-sql/provisioning.ts` and proven
against the deployed ClickHouse image by the isolation suite.

ClickHouse **table functions** sit awkwardly inside that model. They are read
operations, so `readonly = 1` does not touch them; several of them read from
somewhere other than the database, which makes them the SSRF and
arbitrary-file-read surface of any SQL API. `url()` fetches a URL the caller
chooses — including a link-local metadata endpoint. `s3()`, `remote()`,
`postgresql()`, `mysql()` and `mongodb()` open outbound connections. `file()`
reads the server's filesystem.

We already refuse them once, on the ops EXPLAIN endpoint, with a name-list regex
(`TABLE_FUNCTION_RE` in `platform/app/src/server/ops/explain-core.ts`). That guard
predates this API and covers a different, narrower surface.

The database layer's behaviour here is **not uniform**, and the policy has to be
written against what was measured rather than what is assumed:

- `url`, `s3`, `remote`, `file` and `postgresql` are already refused for the
  restricted identity by grants — ClickHouse error 497, "not enough privileges".
  No `SOURCES` grant is issued, and none will be.
- `merge()` is **not** a bypass. Measured against the deployed image, it
  respects the row policies bound to the objects it merges, and the isolation
  suite pins that.
- `numbers`, `values`, `view` and `generateRandom` reach no stored data at all.
  The database permits them, and permitting them is correct: there is nothing
  behind them to contain.

So the honest statement of the situation is that the database already refuses
everything dangerous, and permits a handful of table functions that are inert.

## Decision

**The gateway's AST validator refuses every user-supplied table function,
positionally and without a name list.** A `TableExpression` carrying a
`table_function` field is a `TABLE_FUNCTION` violation whatever that function is
called, including the inert ones. The database's grants stay exactly as they
are, and remain the enforcing boundary. Neither layer is removed in favour of
the other.

The validator keeps **no list of table-function names**. The check is on the
grammatical position, so a list would always be a subset of "all of them", and a
second list is a second thing to keep in sync with ClickHouse's releases.
`TABLE_FUNCTION_RE` stays where it is, serving the ops endpoint it was written
for; the governed API does not import it and does not copy it.

## Rationale / Trade-offs

The tempting alternative is to allow the inert ones, since the measurements say
they expose nothing. We rejected it for three reasons.

First, "inert" is a property of today's ClickHouse, re-established by reading
release notes. `generateRandom` and `view` are inert in the version we run; the
question of whether they still are has to be re-answered on every upgrade, by
someone who knows to ask it. A positional rule has no such question.

Second, a name list is a denylist wearing an allowlist's clothes. Whichever way
it is written, a table function ClickHouse adds after we wrote it lands on the
side we did not choose — and for a name-keyed *allow* list the new function is
refused, which is fine, while for the name-keyed *deny* list it is permitted,
which is not. Refusing the position avoids picking a side at all.

Third, the value of the inert ones to a customer is close to zero. `numbers()`
and `values()` generate rows; a caller who wants a synthetic series can write
one with `arrayJoin` or a range, and a caller who wants `view()` wants a
subquery. We are not withholding anything an analytical question needs.

The cost accepted is a slightly smaller SQL surface than ClickHouse offers, and
a caller who writes `FROM numbers(10)` gets a refusal for a query that would
have been harmless. That refusal names the rule and the position, so it is a
one-line fix rather than a mystery.

## Consequences

- Every governed query is refused at the gateway before it reaches the database
  if it names any table function. The database refusal (grants) still stands
  behind it, and the isolation suite still proves the grant half independently —
  a validator-only test may not stand in for it.
- The reachable read surface of the API is exactly: the datasets the schema
  catalog lists, reached by name. "Which table functions are safe this quarter"
  is not a question anyone has to hold.
- Widening this is a deliberate act with an obvious shape: add a rule to
  `NODE_RULES`/`TableExpression` in
  `platform/app/src/server/analytics/governed-sql/validation/validate.ts`, and
  amend this ADR. It cannot happen by accident, and it cannot happen by a
  dependency upgrade.
- The two guards say different things on purpose and must not be merged: the
  gateway rule is about keeping the surface uniform, and the grants are what
  actually stop an SSRF. Any future write-up that claims the AST rule is
  preventing a leak the database would otherwise allow is wrong, and the
  measurements above are why.

## References

- Issue [#6480](https://github.com/langwatch/langwatch/issues/6480) — governed analytics SQL API
- `specs/analytics/governed-sql-api.feature` — the behavioural contract
- `platform/app/src/server/analytics/governed-sql/provisioning.ts` — the grants, row policies and settings profile
- `platform/app/src/server/analytics/governed-sql/validation/validate.ts` — the default-deny AST walk
- `platform/app/src/server/ops/explain-core.ts` — `TABLE_FUNCTION_RE`, the ops endpoint's separate name-list pre-check
- [ADR-045](./045-domain-errors-handled-boundary.md) — how the refusal reaches the caller
