# ADR-029: Trace table per-evaluator eval columns

**Date:** 2026-06-16

**Status:** Proposed

## Context

The trace table (`langwatch/src/features/traces-v2/components/TraceTable/`)
surfaces evaluations through a single `"evaluations"` column — the "Evals"
summary, which renders every evaluator's latest chip for a trace
(`registry/cells/trace/EvaluationsCell.tsx`). There is no way to pull one
specific evaluator's result out into its own column. Operators who watch a
particular evaluator (a Faithfulness score, a Prompt-Injection verdict) want
that one number in a dedicated, scannable column next to duration and cost —
not buried in a chip cluster.

`specs/traces-v2/evaluations.feature` already anticipated this under "Individual
eval columns", referencing a `makeEvalCellDef` factory that would derive
`eval:<evaluatorId>` columns from the evaluators seen in visible rows. None of
it is built: `makeEvalCellDef` does not exist, and the column system is
entirely static.

The static column model is the crux this decision has to break:

- **Column options are a fixed enumerated set.** The Columns dropdown
  (`Toolbar/ColumnsDropdown.tsx`) renders checkboxes from
  `LENS_CAPABILITIES[grouping].columns` — a compile-time array of
  `{id, label, section, pinned}` in `lens/capabilities.ts`. The trace
  capability lists ~26 columns including the `"evaluations"` summary.
- **Column defs are a fixed map.** `buildTraceColumns(ids)` in
  `TraceTable/columns.ts` looks each id up in the static `traceColumnDefs`
  record and **silently drops unknown ids**.
- **Cell renderers are a fixed registry.** `RegistryRow` renders each body
  cell via `pickCell(registry, column.id, …)`, reading `registry.cells[id]`
  from the static trace registry.
- **`reconcileColumns` drops anything not in the capability.** A column id not
  present in `capability.columns` is stripped from the persisted lens on load.

The data is already there: `TraceListItem.evaluations: TraceEvalResult[]` ships
on every row, each carrying `{evaluatorId, evaluatorName, status, score,
passed, label}` (`types/trace.ts`). The evaluator *list* for the picker is
already discoverable via the `tracesV2.discover` "evaluator" facet
(`useTraceFacets`), scoped to evaluators with runs in the active time range.

Behavioural contract: see
[specs/traces-v2/evaluations.feature](../../../specs/traces-v2/evaluations.feature)
("Per-evaluator eval columns").

User decisions taken before drafting (the four design forks):

1. **Explicit picker**, not auto-derive from visible rows.
2. **Per-field columns** — a column targets one evaluator *and* one field
   (Score / Verdict / Label); one evaluator can back several columns.
3. **Time-range evaluators plus free-text** — the picker is a typeahead over
   discovered evaluators but accepts an arbitrary typed evaluator key.
4. **Sorting deferred** — render-only this round.

## Decision

### A. A compound dynamic column id: `eval:<field>:<evaluatorKey>`

Per-evaluator columns get a structured id parsed by the column-build path:

- `field` ∈ `score | verdict | label`.
- `evaluatorKey` is **everything after the second colon** — it may itself
  contain `:` or `/` (langevals types like `ragas/faithfulness`, or free-text).

Field-first ordering makes parsing unambiguous when the evaluator key contains
delimiters: split on the first two colons, `field = parts[1]`, `evaluatorKey =
rest`. The `eval:` prefix is the discriminator every consumer keys off.

### B. `makeEvalCellDef` factory + cell, assembled in `useTraceLensColumns`

- **`makeEvalCellDef({ evaluatorKey, field, label })`** returns a
  `CellDef<TraceListItem>` (alongside `EvaluationsCell`). The cell resolves the
  trace's **latest** run for `evaluatorKey` — matching against `evaluatorId`
  first, then `evaluatorName` (so a free-text *name* still matches), reusing
  the latest-wins dedup already in `EvaluationsCell` — then renders the chosen
  field:
  - **score** → formatted `score` + a status-coloured dot (`evalChipColor`);
    em-dash when no run or `score == null`.
  - **verdict** → `passed === true` → "Pass" (green dot), `false` → "Fail"
    (red dot); em-dash when no run or `passed == null`.
  - **label** → the categorical `label` text; em-dash when no run or
    `label == null`.
- **Both the TanStack `ColumnDef` and the `CellDef` are synthesised in
  `useTraceLensColumns`**, not in the static maps. The hook already owns the
  `{columns, registry, minWidth}` bundle. It parses `eval:` ids out of the
  logical column list, builds a `ColumnDef` per id (accessor returns the field
  value — wired for future sort — header = resolved label, `enableSorting:
  false`), and **merges** the matching `CellDef`s into the registry it hands
  down (`{...registry, cells: {...registry.cells, ...evalCells}}`). `columns.ts`
  and the static registry stay untouched and fully static.

### C. `reconcileColumns` preserves `eval:` ids

Any id matching the `eval:` prefix is treated as always-valid and is **never
dropped**, even though it is absent from `capability.columns`. Pinned-column
handling is unchanged. This is what lets a saved eval column survive a reload
when its evaluator has no runs in the current range.

Note the cell synthesis in §B keys off `columnOrder` **directly**, not off the
reconciled set — so eval columns still render on the legacy custom-lens loader
path that bypasses `reconcileColumns`
([specs/traces-v2/view-system.feature](../../../specs/traces-v2/view-system.feature)
records that an unknown *static* id renders nothing there; an `eval:` id instead
resolves to its synthesised cell).

### D. The Columns dropdown "Evaluations" section gains an add-form

- The Evaluations section keeps the "Evals" summary checkbox and adds an **"Add
  eval column"** control: an **evaluator combobox** (typeahead over the
  discovered evaluator facet values, free-text accepted) + a **field selector**
  defaulting to **Score** + an Add action. Adding appends
  `eval:<field>:<evaluatorKey>` to `columnOrder` (the existing append-and-toast
  path; the lens enters draft state like any column change).
- Already-added eval columns render as removable/checked entries. Because they
  are not in `capability.columns`, the dropdown **resolves their labels** by
  merging the active dynamic eval columns (derived from `columnOrder`) with the
  capability columns. Label = `${evaluatorName ?? evaluatorKey} · ${FieldLabel}`
  (e.g. "Faithfulness · Score"), evaluator name resolved from the discover
  facet metadata, falling back to the raw key.

### E. Two adjacent round-5 column-picker decisions

The picker redesign that delivers the eval columns also lands two related
behaviour changes, recorded here rather than in a separate ADR:

- **The pinned-column concept is removed.** `LensColumnOption.pinned` and the
  `reconcileColumns` "always retain pinned" pass are deleted; no column
  (Time, Conversation, the group label) is locked. Every column is toggleable
  and reorderable — in the picker and the table header alike. Only the leading
  row-select gutter stays sticky-left; no data column is pinned/frozen. This
  removes the prior mismatch where the picker disabled Time while the table
  header already let it be dragged.
- **The Time column's value format is switchable (relative ↔ ISO).** A
  per-user `timeFormatStore` (localStorage, sibling of density) drives whether
  the Time column renders compact relative ("3m") or full ISO 8601; a
  Relative / ISO toggle sits on the Time row in the picker. `since` and
  `timestamp` remain as separate columns; the time hover card still never
  changes a column's format.

Behavioural contracts: see
[specs/traces-v2/column-configuration.feature](../../../specs/traces-v2/column-configuration.feature)
and [specs/traces-v2/trace-table.feature](../../../specs/traces-v2/trace-table.feature).

## Rationale / Trade-offs

**Explicit picker over auto-derive.** Auto-deriving a column per evaluator seen
in visible rows (the original spec framing) causes column explosion and shifts
columns as the data scrolls — the user wants a stable, opted-in column.

**Per-field, compound id over one-column-per-evaluator.** A single column
showing "the salient value" is simpler, but the user wants to choose Score vs
Verdict vs Label explicitly, and to keep more than one for the same evaluator.
The cost is a compound id and a field selector in the picker; the benefit is a
column that means exactly one thing.

**Assemble dynamic defs in the hook, not the static maps.** Branching
`buildTraceColumns` / mutating the registry would smear dynamic concerns across
files meant to be compile-time-exhaustive (`TraceColumnId` is a union derived
from the static map). Doing the synthesis in `useTraceLensColumns` — which
already bundles columns + registry and can take the evaluator-metadata
dependency — keeps the static layer static and the dynamic layer in one place.

**Discover (range-scoped) + free-text over the full configured set.** The
discover facet already lists evaluators with runs in range — no new backend.
Free-text covers the gap (an evaluator not yet in range, or one the user knows
by id); a key with no matching runs renders an all-em-dash column, which is the
already-specced graceful-degradation behaviour, not an error. Fetching the full
configured-evaluator set would add a query for a case free-text already covers.

**Sorting deferred, but the accessor is wired for it.** The synthesised
`ColumnDef` accessor already returns the field value, so server-side sort keyed
on a specific evaluator can be added later without changing the id grammar or
the cell.

## Consequences

- **New code.** `makeEvalCellDef` factory + the per-evaluator cell (beside
  `EvaluationsCell`); `eval:` parsing + `ColumnDef`/`CellDef` synthesis in
  `useTraceLensColumns`; an add-form in `ColumnsDropdown` (combobox + field
  selector + dynamic-label resolution); `reconcileColumns` preserves `eval:`
  ids. `useTraceLensColumns` (or its caller) takes an evaluator id→name map
  from `useTraceFacets`.
- **Persistence.** Eval ids are saved in `LensConfig.columns` like any column
  and survive reload. A saved eval column whose evaluator is absent from the
  range is kept (not auto-hidden) and renders em-dashes — consistent with
  `column-configuration.feature` ("Eval column for a nonexistent eval type
  shows dash").
- **Free-text keys are opaque.** No validation beyond non-empty; matched
  against `evaluatorId` then `evaluatorName`.
- **No grammar/backend change.** Filtering by evaluator stays on the existing
  sidebar evaluator facet; the cell is render-only and does not add a
  click-to-filter affordance this round.
- **Out of scope / deferred.** Server-side sorting on an eval column; excluding
  a picked evaluator from the "Evals" summary badges (still `@planned`);
  reasoning/status as selectable fields; click-to-filter from the cell.

## References

- Spec: [specs/traces-v2/evaluations.feature](../../../specs/traces-v2/evaluations.feature)
  ("Per-evaluator eval columns")
- Related specs: specs/traces-v2/trace-table.feature (column visibility /
  reorder; Events columns — eval columns now delegate here),
  specs/traces-v2/column-configuration.feature (column visibility / reconcile /
  data gating), specs/traces-v2/view-system.feature (legacy lens loader /
  unknown-id handling), specs/traces-v2/evaluator-filter-label.feature
  (evaluator facet labels)
- Key code: `TraceTable/columns.ts` (`buildTraceColumns`, `traceColumnDefs`),
  `TraceTable/useTraceLensColumns.ts`, `TraceTable/registry/cells/trace/EvaluationsCell.tsx`,
  `TraceTable/registry/RegistryRow.tsx`, `lens/capabilities.ts`
  (`reconcileColumns`, `LensColumnOption`), `Toolbar/ColumnsDropdown.tsx`,
  `hooks/useTraceFacets.ts`, `types/trace.ts` (`TraceEvalResult`)
