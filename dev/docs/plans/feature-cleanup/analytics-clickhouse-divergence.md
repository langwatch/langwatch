# Analytics ClickHouse: the copy with the tests was not the copy that runs

Status: fixed for analytics, open as a repo-wide pattern.

## What was found

`aggregation-builder`, `field-mappings`, `filter-translator` and
`metric-translator` existed twice, ~5,700 lines each side:

|                    | `platform/app/src/server/analytics/clickhouse/` | `packages/features/analytics/server/src/clickhouse/`                     |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------ |
| Reached at runtime | no — zero importers outside its own directory   | yes: `presets.ts` → `AnalyticsAdapter` → `ClickHouseAnalyticsRepository` |
| Test files         | 22                                              | 1                                                                        |
| Test cases         | 385                                             | a single characterization test                                           |

Every assertion was pointed at the dead half.

## Why they diverged

Not by drift. The extraction had to break one dependency, and the way it broke it
removed a compile-time guarantee.

`FilterField` — the union of every field a filter may name — lived in
`platform/app/src/server/filters/types.ts`, which a feature package cannot import.
So the package copy widened:

```ts
// platform (dead)                       // package (live)
Record<FilterField, FilterHandler|null>  Record<string, FilterHandler|null>
field: FilterField                       field: string
field as FilterField                     field as string   // casts nothing
```

The table is exhaustive on purpose: `translateFilter` falls back to a no-op when a
field has no handler, and the _type_ was the only thing preventing that. Widened,
a new filter field compiles fine and is silently ignored at query time. The same
widening hit the aggregation builder's four `filters` parameters.

## Fix

1. `filterFieldsEnum` / `FilterField` published from `@langwatch/analytics-contract`,
   where both trees can reach it.
2. Handler table, parameter and the three casts narrowed back. Sabotage-checked:
   deleting the `spans.model` entry now fails with `TS2741`.
3. Twelve test files moved onto the live modules — 340 cases, suite 28 → 369 —
   and the platform duplicates deleted.

No handler was actually missing. This bought back the guard; it did not fix a
live gap.

## Still open here

- Nine `.integration.test.ts` files (37 cases) and
  `join-time-bound-partition-column.unit.test.ts` still test the dead modules.
  They need testcontainers or a `~/` alias, so they need the package to grow
  integration infrastructure before the dead cluster can go.
- `metric: z.string().min(1)` on `analyticsSeriesSchema` is the same shape of
  widening one level up — the metric registry is still platform-only, so the
  wire contract cannot name its own vocabulary. Bigger job, not attempted.
- `analyticsReadInputSchema` takes `filters: z.record(z.string(), …)`. Narrowing
  it to `filterFieldsEnum` would reject unknown fields at the boundary instead of
  ignoring them — a deliberate API behaviour change, so it is a decision, not a
  cleanup.

## The general case

465 `legacy-feature-fragment` entries name a file that exists in both trees; 35
have same-named feature modules. Analytics is the second confirmed instance of
the pattern after the monitor preconditions in `8f5f5696e8` (preview knew 30
fields, execution knew 17).

The shape repeats: extraction hits a type or helper it cannot import, widens or
re-implements to get unblocked, and the tests stay behind with the original. The
tell is cheap to check — for each fragment pair, which copy has importers, and
which has the tests. When the answer differs, the tests are guarding nothing.
