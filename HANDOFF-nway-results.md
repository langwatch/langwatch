# Handoff: finish the N-way Comparison merge (#5101, PR #5528)

## Context

LangWatch had two preference-judging evaluators that did the same job:

- `langevals/pairwise_compare` (#5100, shipped) — exactly 2 candidates, `variantA` / `variantB`
- `langevals/select_best_compare` (#5101, unreleased) — N candidates

They have been **merged into one "Comparison" flow**: one picker card, one config
form, one result column, one judge (`select_best_compare`, renamed to display as
"Comparison — pairwise or multi-candidate preference judging").

Back-compat contract is **"read old, write new"**: experiments saved with the legacy
two-slot `pairwise` config still load, render, and re-run. `pairwise_compare.py` stays
runnable (deleting it 404s old monitors) but is deprecated and hidden from new
evaluator creation. `src/experiments-v3/utils/normalizeComparison.ts` is the **single**
place that reads `.pairwise` — a second `.pairwise` read anywhere else is how the two
shapes start diverging again.

Work happens in the worktree `issue5101-n-way-compare`, branch
`feat/nway-select-best-standalone`. Read `specs/experiments/comparison.feature`
before touching anything — it is the requirements doc.

## What is already done (4 commits, all green)

| Commit | What |
|---|---|
| `71bb749f6` | Unified spec; judge renamed; `pairwise_compare` deprecated; both generated catalogs updated |
| `c054849da` | One config shape (`comparisonEvaluatorConfigSchema`); one orchestrator path (`generateComparisonCells`); one picker card / config form / editor path |
| `289a7e942` | One workbench column; N-way header scoreboard; `useTargetNames`; `disambiguateNames`; shared `labelNamesVariant` |

`pnpm typecheck` is clean. `npx vitest run src/experiments-v3 src/server/experiments-v3`
is 381/381 green.

Key shapes to know:

```ts
// src/experiments-v3/utils/computeAggregates.ts
export type ComparisonAggregate = {
  evaluatorId: string;
  variants: string[];
  winsByLabel: Record<string, number>; // keyed by the identifier the judge returned
  ties: number;
  decidedRows: number;
  topCount: number;
  topLabel?: string;                   // unset when 2+ share the lead
  totalCost: number;
};
```

**Why `winsByLabel` is keyed by raw identifier, not variant id:** the judge returns the
winning candidate's *prompt handle* (`"concise-support-v2"`), not its internal
`target_XYZ` id. Resolving a handle needs `useTargetName`, a hook, which cannot be
called once per variant from a loop. So the aggregate stays handle-free and the
renderer resolves names via `useTargetNames` (batched `api.useQueries`) and matches
with `labelNamesVariant({ label, target, resolvedName })`.

## The remaining work

### 1. Generalize the results view to N variants — **this is the main task**

`src/components/batch-evaluation-results/` still models a comparison as exactly two
slots. **This is where the per-variant win breakdown belongs** (the workbench header
deliberately shows only `"<winner> wins"` with counts in a tooltip; the full breakdown
is a results-page concern).

Today, in `types.ts`:

- `BatchPairwiseColumn` has `variantAId` / `variantAName` / `variantBId` / `variantBName`
- `BatchPairwiseVerdict.label` is the union `"A" | "B" | "tie"`
- `detectPairwiseColumns` (~L499) normalizes every verdict into an A/B slot and
  **`continue`s on any winner that is neither slot** (the `// orphan id we couldn't
  classify` branch, ~L692). A 3-way run therefore silently drops the third variant's wins.
- Variant identity comes from `inputs.candidate_a_id` / `inputs.candidate_b_id`. The
  merged orchestrator now emits **`inputs.candidates`**, an ordered
  `Array<{ id, output, cost?, duration? }>` (see `orchestrator.ts` ~L1178). Old runs
  still have `candidate_a_id` / `candidate_b_id` — keep reading them as a fallback.
- `isPairwiseEvaluator` (~L554) sniffs for the substring `"pairwise"` in
  `ev.evaluator` / `ev.name`. It must also match `select_best_compare` / `"comparison"`,
  or comparison columns created after the rename go undetected.

`PairwiseWinRateChart.tsx` is hardcoded to exactly 3 bars (`counts.A`, `counts.B`,
`counts.tie`) with a 2-colour palette.

Do this:

- `BatchPairwiseColumn` → `BatchComparisonColumn` with
  `variants: Array<{ id: string | null; name: string }>` in judge order.
- `BatchPairwiseVerdict` → `BatchComparisonVerdict` with
  `winnerId: string | null` (`null` = tie) instead of the `"A" | "B" | "tie"` union.
- `detectPairwiseColumns` → `detectComparisonColumns`; read `inputs.candidates` first,
  fall back to `candidate_a_id` / `candidate_b_id`, then to the observed-labels
  heuristic. Drop the orphan-id `continue` — with N variants, any observed non-tie
  label that resolves through `targetIdByAnyKey` is a real winner.
- `PairwiseWinRateChart` → `WinRateChart`: one bar per variant plus a Tie bar,
  cycling a colour palette. Keep the 280px card width and `chartHeight` so it stays
  at parity with its Cost / Latency siblings in `ComparisonCharts`.
- `BatchPairwiseWinnerCell` → `ComparisonWinnerCell`.
- Update `SingleRunTable.tsx` (21 refs), `ComparisonCharts.tsx` (21), `types.ts` (32),
  `BatchEvaluationResults.tsx` (6), `tableUtils.ts` (3), `BatchTargetCell.tsx` (1),
  and the two touched tests.
- **`csvExport.ts` has no pairwise handling at all today.** If a comparison verdict
  should appear in the CSV, that is a new feature — confirm before adding.

Reuse, don't re-derive: `extractWinnerOutputText` (types.ts ~L476) already peels
structured outputs down to a display string; keep it.

**Existing 3-way runs are already in the database and currently under-count.** A
regression test must execute `detectComparisonColumns` against a fixture whose winner
is the third variant and assert the win lands — not merely assert the type changed.

### 2. Reconcile the spec

`specs/experiments/comparison.feature:79-82` currently says:

```gherkin
Scenario: Column scoreboard reflects the per-variant tally
  Given 30 rows have been evaluated where variant_1 wins 14, variant_2 wins 10, variant_3 wins 4, and 2 ties
  When I view the Comparison column header
  Then I see the win tally broken down per variant, including ties
```

The header does **not** show a per-variant breakdown by design — it shows
`"<winner> wins"` with the tally in a hover tooltip. Split this into two scenarios:
a terse header one, and a results-view one asserting the per-variant win-rate chart.
The spec is the requirements doc, so fix the spec to match the intended design rather
than bending the design to the spec.

### 3. Cleanup

- `src/components/evaluators/EvaluatorTypeSelectorContent.tsx:35` maps
  `langevals/pairwise_compare` → `llm_judge`, so the deprecated judge is still offered
  when creating a new evaluator. Hide it from the picker while keeping it *resolvable*
  for existing rows (`getEvaluatorIncludingCustom` must keep finding it, or old
  monitors 404).
- `src/server/evaluations/evaluators.generated.ts:879` — the `select_best_compare`
  default prompt in the generated registry has drifted from `DEFAULT_SELECT_BEST_PROMPT`
  in `select_best_compare.py`. Regenerate **carefully**: running the generator on a
  machine without `ragas` / `openai-moderation` installed silently deletes those
  evaluators from the catalog (a 2223-line deletion). Hand-apply the two blocks, run
  `pnpm copy:langevals-types`, then grep to confirm the catalog is still complete.
  Note the generator emits `description` as a JS template literal — **no backticks in
  Python docstrings**, they terminate the literal and break prettier.
- Surface `randomizeOrder` as a toggle in `ComparisonConfigForm`. It is in the schema
  and defaults to `true`, but has no UI. It is what replaced pairwise's
  `swap_and_confirm` (2 judge calls, A/B swapped) with a 1-call deterministic shuffle
  seeded on `row_index`. The bias-mitigation downgrade is an accepted, deliberate loss.

### 4. Verify end-to-end and screenshot

Local stack (langevals is **not** started by `pnpm dev` — start it separately):

```bash
cd langwatch && pnpm dev                              # app :5560, api :6560, nlpgo :5561
cd langevals && uv run python langevals/server.py     # :5562
```

The api server (`tsx src/server.mts`) does **not** watch — restart it after any
server-side edit. Do not `pkill -f "src/server.mts"`; it kills the shell. Kill by PID
from `ss -tulpn`.

Verify, with screenshots for the PR:

1. **N = 3** — three prompt variants, one Comparison column. Real verdicts, three
   different winners, real costs. Confirms the deterministic shuffle works.
2. **N = 2** — identical UI to the old pairwise column.
3. **Legacy read** — an experiment saved with a `pairwise` config loads, renders,
   and re-runs.
4. **Results page** — the win-rate chart shows one bar per variant plus Tie, and a
   3-way run's third variant is counted.

Use `gpt-5-mini` for every judge / fixture (cheapest and most capable; never `gpt-4o`
or `gpt-4.1-mini`). Icon convention: **Swords** everywhere a comparison is identified;
**Trophy** only where a winner is declared.

## Conventions that will bite you

- Outside-in TDD: spec → integration test → unit test → code.
- BDD naming: `describe("given X")` / `describe("when Y")` / `it("does thing")` —
  never `it("should ...")`.
- Hooks return state and callbacks, never JSX. Hooks in `.ts`, components in `.tsx`.
- Never call a hook inside `.map()`. Either batch with `api.useQueries` (see
  `useTargetNames`) or render a per-item child component (see `WinnerLabel` in
  `ComparisonCell.tsx`).
- Never re-export for backwards compatibility — update the importers.
- Zod + `z.infer`, never a hand-written twin type.
- `pnpm typecheck` (tsgo), not `tsc`. `pnpm test:unit path/to/file`, no `--`.
- Run tests after every change.
