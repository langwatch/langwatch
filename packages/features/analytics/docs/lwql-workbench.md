# LangWatchQL workbench + LangWatchQL chart surface

Patterns to follow when extending `packages/features/analytics/web/` and its
application composition adapters under `platform/app/src/features/analytics-query/`.
See [ADR-002](../adrs/002-lwql-chart-runtime-without-eval.md) for why the
chart runtime avoids `eval`, and
`../specs/analytics-lwql-workbench.feature` for the behavioral contract.

## Request state: draft / submitted / outcome

`components/langwatch-ql-workbench.tsx` owns reusable workbench layout and
browser state. It accepts named query/schema command ports, the page period,
and narrow toolbar, error, and lazy-chart render ports; it does not import app
hooks, tRPC, or router code. The app adapter owns those ports and no workbench
behaviour.

`@langwatch/analytics-web/visualization` is browser-chunk-safe policy and
theme support. The generated-schema save admission path is deliberately the
separate `@langwatch/analytics-contract/visualization/validation` export, so server-side chart
saves cannot make ordinary visualization imports eager.

Deliberate app residue is limited to `useLangWatchQLQuery`,
`useLangWatchQLSchema`, `useSavedChartWiring`/`useSavedWorkbenchCharts` (tRPC
transport and saved-chart persistence), `useLangwatchVegaTokens` (resolved app
theme), `LazyLangWatchQLChartMode` (the Next SSR-off boundary), and the
saved-chart toolbar/dialog composition. The forwarding and test-adapter modules
remain only for app test import compatibility and carry no feature behaviour.

`logic/lwql-request-state.ts` is the one reducer for the workbench's
request lifecycle. It keeps three things apart:

- `draft` — what the member is typing.
- `submitted` — the last snapshot sent, `null` until the first submission.
- `outcome` — the answer, carrying **its own copy** of the snapshot that
  produced it.

All transitions go through `lwqlRequestReducer`. Do not mutate this
state, add a fourth field, or read `submitted` from a component — every reader
outside the reducer goes through `isLangWatchQLResultStale` or
`lwqlActionLabel`.

- **Staleness and the action label (`Run query` vs `Reload`) compare the draft
  against `outcome.snapshot`, never `submitted`.** They differ the moment a
  second submission is abandoned before it answers: run A, edit to B, run B,
  abandon B. `submitted` is now B while the visible result is still A's — a
  check against `submitted` would call A's rows current for a request that
  never ran, and would say `Reload` for a request that would actually rerun B.
- A submission while one is in flight is a no-op (`withSubmission` returns
  state unchanged) — this is how the controller knows not to issue a second
  request.
- An answer whose `submissionId` doesn't match the one being awaited is
  dropped — this is what makes an aborted or superseded response harmless even
  when the transport delivers it anyway.

## Backend answers only

There is no frontend SQL validator and no invented schema. The schema shown in
`LangWatchQLSchemaBrowser` and fed to Monaco completion comes from the same live
schema response the backend serves — do not hardcode table/column lists or
duplicate backend validation logic in a component.

Every failure renders through the code-keyed error registry, never a wire
message:

- `readLangWatchQLFailure` (`logic/lwql-failure.ts`) lifts the
  _structure_ a registry entry cannot carry — violation positions, clause
  names, missing parameter names — off `meta`. It never carries the words a
  member reads; those come from the presentation registry keyed by `code`
  (`error-handling.md`).
- Everything read off `meta` is parsed defensively (`isRecord`, type guards on
  every field) because it crossed a wire — a malformed payload degrades to "no
  extra detail," never a crash in the pane that was about to explain the
  failure.
- `lwqlUnavailablePayload()` mints a client-side payload carrying the
  `lwql_unavailable` code so the _availability_ answer (a boolean, not
  a failure) renders through the same registry copy as a real refusal, rather
  than a second hand-written copy of the words.

## Value fidelity

`logic/lwql-value-format.ts` decides what a result cell _says_; never
reach for `Number()` on a value from a LangWatchQL result.

- **64-bit integers and high-precision decimals arrive as digit strings** when
  the ClickHouse profile has 64-bit quoting on. `Number("9007199254740993")` is
  `9007199254740992` — coercion silently drops precision that survived the
  wire. A value typed `string` is rendered and copied as that exact string.
- **`missing`, `null`, `emptyString`, `nan`, and `infinity` are distinct
  `LangWatchQLCell` variants** (beside `scalar` and `structured`), not
  collapsible into each other, into a blank, or into an ordinary `0` — which is
  just a `scalar`. `describeLangWatchQLValue` and
  `readLangWatchQLCell` are the only places that classify a raw value —
  `Object.hasOwn` (not an `undefined` check) is what tells a row that doesn't
  carry the column apart from one carrying `NULL`.
- `lwqlCellText` / `lwqlCellCopyText` are the only places the
  visible/copied token per kind is decided. A structured value's `copy` is
  compact JSON; a scalar's `copy` is its exact text. `missing` copies as
  nothing (`null` from `lwqlCellCopyText`), never as the literal word
  `"missing"`.

## The chart governance chain

Order matters — each stage bounds what the next has to cope with
(`validateVegaLiteSpec`'s own doc comment names the seven stages in order):
row ceilings → parsed-object check → `$schema` version → size/depth →
bundled v6 schema → LangWatchQL policy → field references.

1. **Validate** — the schema check
   (`visualization/vega-lite-schema.ts`) uses a **generated Ajv standalone
   validator** (`vega-lite-schema-validator.generated.js`), not a runtime
   `ajv.compile()`. Regenerate it with `pnpm generate:vega-validator`
   (`scripts/generate-vega-lite-validator.ts`) whenever `vega-lite` or `ajv`
   moves. A drift guard
   (`vega-lite-schema-validator.unit.test.ts`) fails loudly, naming the command,
   if the committed file doesn't match what regenerating produces byte for
   byte — a runtime `ajv.compile` here is the validator quietly dying under
   the CSP it exists to survive (ADR-002).
2. **Policy** (`visualization/vega-lite-policy.ts`) — the ceilings, allowlists,
   and rule catalogue, applied as one fail-closed walk
   (`applyLangWatchQLVegaPolicy`). A spec may only reference **named, registered
   datasets** — no inline `values`, no caller-supplied top-level `datasets`
   key, no `url` property anywhere in the document (blanket rule, because the
   v6 schema puts `url` on `UrlData`, the `url` encoding channel, `MarkDef`,
   and six mark configs — a position-by-position rule would leak). Adding a
   new rule means adding its id to `LWQL_VEGA_RULE_IDS` and its entry to
   `RULE_CATALOGUE` — the compiler enforces both exist together.
3. **Build** (`visualization/build-langwatch-ql-vega-spec.ts`) — data is injected,
   never accepted: the caller's `datasets` key is deleted, then rebuilt from
   the registry the renderer was given (the second lock; the policy step is
   the first, and this is the one that holds if that one is ever loosened).
   The pinned config is merged **last**, over whatever `config` the member
   wrote — a member may restyle an axis, not the background or font the chart
   renders in.
4. **Render** (`hooks/useLangWatchQLVegaView.ts`) — `vega-embed` is called with
   `ast: true`, which makes it parse expressions into a syntax tree and
   evaluate them with `vega-interpreter` instead of compiling with `new
Function`. Do not add `expr` to `lwqlVegaEmbedOptions` — `vega@6`
   exports no `expressionInterpreter`, so `ast: true` alone already reaches
   the interpreter; passing one explicitly only duplicates it in the bundle.
   The loader is `createNoNetworkVegaLoader()` — every method rejects, so a
   spec that slipped past static validation still cannot reach the network or
   filesystem. **Every path that can end a view calls `result.finalize()`** —
   unmount, a re-embed, and a runtime failure all route through it (see the
   cleanup function and `finalizeInto`). Vega registers global listeners and
   timers; a view dropped without finalizing is a leak that outlives the page.

## The lazy boundary

The app's `LazyLangWatchQLChartMode` render port mounts the package chart mode;
never mount `LangWatchQLChartMode` directly.
Vega, Vega-Lite, vega-embed, and the generated schema validator are several
megabytes that only a member who opens Chart mode needs — one ordinary-looking
static import from `LangWatchQLChartMode` puts all of it in the entry chunk,
and nothing about that import looks wrong at review time.

`vegaLazyBoundary.unit.test.ts` is the tripwire: it walks the static import
graph from `LazyLangWatchQLChartMode.tsx` and from every other source file in
the feature, and fails if anything outside `LangWatchQLChartMode`'s own graph
reaches a Vega package or the generated validator. A new module that imports
Vega (directly or transitively) and isn't reached through the chart-mode
boundary fails this test, not silently ships a bigger bundle.

## Testing conventions for this surface

- **jsdom integration suites mock `~/utils/compat/next-dynamic`.** Monaco and
  the chart boundary are both lazy-loaded through it, and the shim's lazy
  import never resolves under jsdom — mock it to a stub component (see
  `CustomQueryPage.integration.test.tsx`, `LangWatchQLChartMode.integration.test.tsx`)
  so the page under test is the mounted one, not one permanently stuck on a
  loading fallback.
- **Chakra tabs (Table/Chart mode) select on focus, not on a bare click
  event** — use `userEvent.click`, never `fireEvent.click`. A `fireEvent.click`
  leaves the tab's mode unchanged, and every "still visible in the other mode"
  assertion downstream then passes vacuously because nothing moved. Assert
  `aria-selected="true"` after switching to catch this (pattern in
  `LangWatchQLResultPane.integration.test.tsx`'s `selectResultMode`).
- **A node-environment test must never contain the jsdom environment pragma
  string, even in prose.** Vitest reads that pragma out of a file's first
  docblock — writing it inside a comment to say "this file declines jsdom"
  switches the file to jsdom instead of proving it runs under plain node. See
  `modulePurity.unit.test.ts`'s own docblock for how it describes this
  constraint without naming the string.

## References

- [ADR-002](../adrs/002-lwql-chart-runtime-without-eval.md) — why the chart
  runtime runs without `eval`
- `../specs/analytics-lwql-workbench.feature` — full behavioral contract
- `error-handling.md` — the code-keyed error registry this surface builds on
- `platform/app/src/features/analytics-query/` — transport/theme/lazy adapters
