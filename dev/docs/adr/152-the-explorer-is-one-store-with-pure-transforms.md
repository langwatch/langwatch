# ADR-152: The Explorer is one store with pure transforms

> Landed from upstream as ADR-140; renumbered here because 140 is taken by another record.

**Date:** 2026-09-20

**Status:** Accepted

## Context

The Trace Explorer kept its page state in three zustand stores: `filterStore` (query text, time range, page, Instant Eval runs), `viewStore` (lens, sort, grouping, columns, drafts) and `selectionStore` (selected traces). Open rows lived in component `useState`, and the result count lived only inside the counts hook.

The stores called each other through module imports. `viewStore` reached into `filterStore` to apply a lens's filter, and `filterStore` reached back for the sort when it reset keyset cursors. A change that spans both, such as "open this lens", was a sequence of calls across modules with no single state value before or after it.

Langy needs to drive the page and to read it. The evaluations workbench already does this through pure transforms over one document (`src/experiments-v3/actions/`): each UI action is `(state, payload) -> state`, the page commits the result, and the backend runs the same function when no page is open. The Explorer had no single state value a transform could take, and no way to answer "what is on screen" without reading three stores and two components.

## Decision

The Explorer is one store. `useExplorerStore` (`stores/explorerStore.ts`) composes four slices created with zustand's `StateCreator`: `querySlice`, `viewSlice`, `selectionSlice` and `rowsSlice`. Slices reach each other through `get()`, not imports. `filterStore.ts`, `viewStore.ts` and `selectionStore.ts` are gone, and consumers import `useExplorerStore` and the slice's own types directly.

`rowsSlice` holds what was outside any store: `expandedRows`, and `results` (`totalHits`, `itemNoun`, `pageTraceIds`, `isSettled`), which the counts hook writes after each read.

`ExplorerState` (`actions/transforms/types.ts`) is the part of the store a transform may touch: `queryText`, `timeRange`, `activeLensId`, `sort`, `grouping`, `columnOrder`, `page`, `pageSize`, `selection`, `expandedRows` and `evalRuns`. A transform is `({ state, payload, context? }) => { state, result? }`, pure, with a closed set of refusal codes (`filter_invalid`, `time_range_invalid`, `preset_unknown`, `lens_not_found`, `sort_column_unknown`, `page_out_of_range`, `page_size_invalid`, `invalid_payload`). The transforms are `setFilter`, `toggleFacet`, `setTimeRange`, `setLens`, `setSort`, `setGrouping`, `setPage`, `setPageSize`, `select` and `expandRow`.

The page applies a transform's result through `commitExplorerState`, an ordered table of steps that calls the store's own actions (lens first, then query, range, grouping, sort, columns, page size, page, selection, open rows, runs). The store's actions stay the only writers, so URL sync, debouncing and draft tracking behave the same for a click and for Langy.

`readLiveExplorer` is the read projection: one function from the store and the results to what Langy is told (`source: "live"`, query, window, lens, sort, page, count, the page's trace ids, active facets, selection, open rows, runs).

The manifest (`actions/manifest.ts`) lists eight `explorer.*` kinds with a zod payload schema and a permission each. The page registers a handler per kind while it is mounted. With no page open, the backend runs the same transform over the default state for the three kinds that can be expressed as a link (`setFilter`, `setTimeRange`, `setLens`) and answers an `href` built by the page's own fragment encoder, labelled "View in Trace Explorer". `explorer.getState` answers `source: "saved"` with the defaults and no count. The rest are refused with `langy_ui_no_browser`.

The Instant Eval run store stays outside. It holds polled counters for a job, not page state, and nothing in a transform reads it.

## Rationale / Trade-offs

One store with slices was chosen over merging the three files into one. The slices keep each file near its old size, `git mv` keeps history and the lint baseline, and the composition is one `create` call.

Transforms return a whole next state instead of calling store actions, which costs a commit step. It buys one function that runs in the browser, on the backend and in a unit test with no store, and a refusal that carries a code before anything changed.

The Explorer has no saved document, unlike the workbench, so the backend cannot apply a change "to the saved state". A link is the only form an away action can take. Actions with no link form (a selection, a page number) are refused rather than answered with a link that drops them.

What is compromised: `commitExplorerState` writes field by field, so a transform that changes five fields causes up to five store updates. They land in one tick and React batches them; a single `setState` would bypass the actions that own URL sync and drafts.

## Consequences

Tests that mocked `filterStore` and `viewStore` separately now mock one module, and a second `vi.mock` of the same path replaces the first, so their factories were merged. Open rows now survive a remount of the lens body, and tests reset them in `beforeEach`.

A new page action is a transform, a schema, a manifest entry and nothing in the page beyond the generic handler. A new piece of page state that Langy should see goes in a slice and in `ExplorerState`, not in component state.

## References

- Related ADRs: ADR-144 (trace search routes on Enter), the Instant Eval runs ADR (upstream ADR-137; its number here is merge-port-B's to land)
- Spec: `specs/traces-v2/explorer-actions.feature`
- Spec: `specs/langy/langy-trace-explorer-actions.feature`
