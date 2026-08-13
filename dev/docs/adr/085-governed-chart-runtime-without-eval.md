# ADR-085: The governed chart runtime runs without `eval`

**Date:** 2026-08-05

**Status:** Accepted

## Context

The governed SQL workbench lets a member write a Vega-Lite specification and
draw the result of their own query with it. That is a member-authored program
running in the browser, so two things have to be true at once: the chart runtime
must be contained, and the containment must survive a Content-Security-Policy
that forbids `unsafe-eval`.

Both halves of the stack reach for `new Function` by default:

- **Vega** compiles the expressions in a specification to JavaScript source and
  evaluates it.
- **Ajv**, which validates a specification against the official Vega-Lite v6
  JSON Schema, compiles the *schema* to a validate function at runtime — a
  ~1.6 second `new Function` call over a 1.9 MB document.

The application's deployed policy still carries `unsafe-eval` for unrelated
scripts, which is exactly what makes this dangerous to leave alone: nothing
would look wrong today, and the day the policy is tightened the chart layer
would stop validating specifications while continuing to render them. A
validator that fails open is worse than no validator.

## Decision

We will run the whole governed chart path without `eval`, and prove it.

1. **The schema validator is generated ahead of time.**
   `scripts/generate-vega-lite-validator.ts` compiles the bundled official
   Vega-Lite v6 schema with Ajv's standalone code generation and writes a
   checked-in module,
   `src/features/analytics-query/visualization/vegaLiteSchemaValidator.generated.js`.
   The browser loads a function that already exists. The schema is used
   verbatim — nothing is pruned or rewritten, so "the bundled official schema
   decides schema validity" stays literally true.

2. **Vega interprets rather than compiles.** The view is embedded with
   `ast: true`, which makes `vega-embed` parse expressions into a syntax tree
   and evaluate them with `vega-interpreter` — a dependency it already carries,
   resolved as `vega.expressionInterpreter ?? opts.expr ?? <its own>`. We do not
   pass `expr`: `vega@6` exports no `expressionInterpreter`, so `ast: true`
   already reaches the interpreter, and a direct dependency would put a second
   copy of it in the bundle to change nothing.

3. **Data is injected, never accepted.** A specification names datasets; it
   never carries them. `buildGovernedVegaSpec` deletes whatever the caller wrote
   under `datasets` and builds that block from the registry the renderer was
   given. The policy already refuses a caller-supplied `datasets`; this is the
   second lock, and it is the one that holds if the first is ever loosened.

4. **Everything Vega is behind one lazy import.**
   `LazyGovernedSqlChartMode` is the only way in. A source-graph test asserts
   that no module in the feature reaches a Vega package except through
   `GovernedSqlChartMode`.

Two guards keep the generated validator honest: regenerating must reproduce the
committed bytes (Ajv's standalone output is deterministic across processes), and
its verdict and errors must match a validator Ajv compiles from the installed
schema at test time, for every fixture in the corpus.

## Rationale / Trade-offs

The generated module is 7.7 MB of source (795 KB gzipped), against 1.9 MB of
schema JSON plus Ajv itself on the runtime-compile path. We accepted the larger
artefact for three reasons: it is inside the lazily loaded chart chunk, which
already carries the Vega runtime; it removes a 1.6 second compile from the first
keystroke; and it is the only version that works under the policy the feature is
built for.

Two smaller options were measured and rejected. Compiling with `allErrors: false`
generates *more* code (8.2 MB), not less, and would reduce every refusal to a
root-level "must match a schema in `anyOf`" that names nothing a member could
fix. Stripping annotation-only keywords (`description`, `$comment`) from the
schema before compiling brings it to 5.5 MB / 492 KB gzipped, but requires a
JSON-Schema-aware traversal that must never confuse a `description` *keyword*
with a property *named* `description` — a correctness risk carried by the whole
schema in exchange for 300 KB inside a chunk that is already megabytes. It
remains available if the checked-in size becomes the binding constraint.

## Consequences

- Validation now costs nothing at runtime and cannot be defeated by a stricter
  policy.
- `pnpm generate:vega-validator` has to be re-run when `vega-lite` or `ajv`
  moves. The drift guard fails loudly if it is not, naming the command.
- The generated file is excluded from Biome (past 1 MB it trips `maxSize` into a
  pathless "ignored file" notice) and carries `@ts-nocheck`, so `checkJs` parses
  it without checking 7.7 MB of machine-written code.
- A future contributor who imports `GovernedSqlChartMode` directly instead of
  the lazy boundary puts the whole Vega runtime in the entry chunk. The
  source-graph test is what catches that, because nothing about it would look
  wrong.

## Boundary: this is a rendering-time control, not admission control

Everything above runs in the browser of the member who wrote the specification,
at the moment it is drawn. That is the whole of what it protects: this member,
this render, this session. It is not a check on what may be *stored*.

Nothing persists a specification today — it lives in memory for as long as the
result is on screen — which is what makes rendering-time validation sufficient
for now. The moment a specification can be saved, shared, or replayed for
someone else, a spec that reaches a second person's browser has been admitted by
whatever wrote it, and the browser that renders it is the wrong place to decide
that. Any such path re-validates server-side at write, against the same policy,
before the specification is stored.

## References

- Related ADRs: [081](./081-governed-sql-table-function-and-ssrf-policy.md),
  [082](./082-governed-analytics-views-invoker-column-grants-final-dedup.md),
  [083](./083-governed-sql-diagnostics-read-the-single-parse.md)
- `specs/analytics/governed-sql-workbench.feature`
- Issue #6577
