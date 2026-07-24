# ADR-028: Trace facet sidebar — numeric presentation modes and facet perspectives

**Date:** 2026-06-15

**Status:** Proposed

## Context

Round 5 of the traces-v2 filter work tackles three papercuts in the facet
sidebar (`langwatch/src/features/traces-v2/components/FilterSidebar/`). Two of
them are pure tuning and need no architectural decision:

- **Default value cap.** Each categorical facet currently lists its top
  `MAX_VISIBLE_FACETS = 10` values before a "+N more" expander
  (`constants.ts`). We will lower this to **5** so a facet column reads at a
  glance. This is a one-constant change, specified in
  [specs/traces-v2/search.feature](../../../specs/traces-v2/search.feature)
  under "High-cardinality facets" — no decision to record here.

The other two changes do warrant a decision because they extend the facet
**state model** and the facet **value pipeline**, and each has viable
alternatives:

1. **Numeric facets have only one presentation.** A facet whose registry
   `kind === "range"` (cost, duration, tokens, ttft, ttlt, promptTokens,
   completionTokens, tokensPerSecond, spans, promptVersion, evaluatorScore)
   renders as a double-handled slider (`RangeSection` → `SimpleSlider`) and
   serialises as `field:[from TO to]`. For small-cardinality **integer**
   dimensions (prompt version 1..N, span count 1..12) a slider is the wrong
   tool — users want to tick the specific values that exist. The backend only
   returns `{min, max}` for range facets today and explicitly throws "Cannot
   drill into range facet", so there is no value list to tick. The query
   language grammar (`server/app-layer/traces/query-language/grammar.ts`)
   supports only continuous `[from TO to]` ranges — there is no numeric set
   syntax (`spans IN (1,3,7)`).

2. **Facet organisation is a single flat, drag-reorderable column.** The
   sidebar renders facets in one ordered list with no group headers; the
   `FacetManagerPopover` ("Configure") lists every facet grouped under nine
   `FACET_GROUPS` headers. Ordering and grouping are held by a single,
   global `facetLensStore` arrangement (`{ sectionOrder, groupOrder,
   sectionOpen }`); its `FacetLens` shape already carries unused `id`/`name`
   fields, i.e. it was built to hold more than one named arrangement. We want
   the manager to present **the full facet set through three task-oriented
   perspectives** — Observability, LLM, Cost & Performance — each re-grouping and
   re-ordering all facets, with the sidebar following the active choice.

   Note a terminology hazard: traces-v2 already has a **lens** concept in
   `viewStore` (`builtInLenses`, the toolbar `LensTabs`) — but those are
   **trace-list** sort/filter/grouping presets (All, Errors, Expensive
   Traces…), a different control from the facet sidebar arrangement. The two
   stores are independent: selecting a toolbar lens does not touch the facet
   arrangement. See
   [specs/traces-v2/lens-preset-groups.feature](../../../specs/traces-v2/lens-preset-groups.feature)
   for the trace-list lenses.

Behavioural contracts for the two decisions live in
[specs/traces-v2/numeric-facet-modes.feature](../../../specs/traces-v2/numeric-facet-modes.feature)
and
[specs/traces-v2/facet-perspectives.feature](../../../specs/traces-v2/facet-perspectives.feature).

## Decision

### A. Numeric facets gain a second presentation: **Range** and **Discrete**

A numeric (range-kind) facet may be presented two ways, chosen per facet:

- **Range** — the existing double-handled slider; serialises `field:[from TO
  to]`. Unchanged, and the only mode for floats and wide integer ranges.
- **Discrete** — a multi-select list of the integer values present, **reusing
  the categorical `FacetSection` UI and its multi-value (OR) selection
  pipeline**. A selection serialises through the same exact-match path a
  categorical facet uses (a value set), with the ClickHouse translator
  emitting **numeric equality** on the column for each picked value.

Eligibility and gating:

- The mode toggle appears **only on numeric facets** — i.e. sections whose
  descriptor kind is `range`.
- **Discrete is offered only for integer facets with a bounded value set.**
  The author declares integer-ness on the registry definition (e.g.
  `integer: true` on `RangeFacetDef`); the toggle enables Discrete only when
  the backend also reports a distinct-value count at or below a threshold
  (e.g. ≤ 30). Floats (cost, latency, score) and high-spread integers (raw
  token totals) stay Range-only and show no Discrete option.
- The backend gains a **discrete-values descriptor** for eligible integer
  facets: discover the full distinct set of integer values with counts
  (`GROUP BY` column) plus the distinct-count guard the toggle reads. The
  guard decides whether the descriptor is offered at all; once it passes,
  every distinct value is returned so the selector hides none. This is
  additive — range facets keep returning `{min, max}` for Range mode.

Persistence and naming:

- The chosen mode is a **per-project, per-facet user setting**, a sibling of
  facet visibility — **not** stored in the lens/perspective arrangement, so
  switching perspective never changes a facet's mode. Each facet has a
  registry **default** mode (e.g. `promptVersion`, `spans` default to
  Discrete; everything else to Range).
- The two modes are named **Range** and **Discrete** in code and UI
  (tooltip + the facet manager).
- The mode is switchable from **two entry points**: an inline icon in the
  facet header, sitting beside the existing search and expand/collapse icons
  and shown only on numeric facets; and the facet manager.

### B. The facet manager gains three built-in **perspectives**

Introduce three built-in perspectives — **Observability**, **LLM**,
**Cost & Performance** — each a complete arrangement (ordering + sub-grouping)
of **all** facets, surfacing the sub-groups relevant to that lens first.

- **Modelled as built-in `facetLensStore` arrangements.** Seed three named
  `FacetLens` presets (the store's latent `id`/`name`) and add an
  `activePerspectiveId`. The active perspective supplies the `groupOrder` and
  `sectionOrder` the sidebar already consumes, so the sidebar reorders to
  match with no new rendering path. A user's drag-reorder is preserved as a
  derived "Custom" arrangement layered on the active perspective rather than
  overwriting a built-in.
- **A perspective switcher** sits at the top of the `FacetManagerPopover`
  (between its "Facets in sidebar" header and the search box). The manager
  re-renders its grouped checklist in the active perspective's order; the
  sidebar follows.
- **Finer sub-groups.** Refine `FACET_GROUPS` into a finer logical set — split
  "Cost & Performance" into Cost / Latency / Volume and split Prompts out of
  Custom — so each perspective has meaningful lead groups. Each perspective is
  an ordering over this shared set; **all facets appear in every
  perspective**.
- **The sidebar stays a flat, header-less ordered column.** Perspectives
  reorder it; the grouped, sub-headed view lives in the manager. This honours
  the deliberate flat-sidebar design (a code comment in `FilterSidebar.tsx`
  records that choice) — the user picked the switcher-in-manager model, not
  in-sidebar headers.
- **Named "perspectives" in the UI**, never "lenses", to avoid colliding with
  the toolbar `viewStore` lenses.

## Rationale / Trade-offs

**Discrete via the categorical pipeline, not a new grammar.** The categorical
facet path already does value discovery, multi-select, OR-grouping, and
exact-match serialisation. Rendering an integer dimension as a categorical
value list reuses all of it; the only genuinely new work is a backend query
that lists the distinct integers (and their count) and a translator that
matches them as numbers rather than strings. The rejected alternative —
teaching the query grammar a numeric set syntax (`spans IN (1,3,7)`) — is more
work for the same user-visible result and duplicates the OR machinery
categorical facets already own. Gating Discrete on declared integer-ness plus
a bounded distinct count keeps the slider as the default for the dimensions
where ticking individual values would be absurd (cost, latency, raw tokens).

**Mode stored per-facet, not per-perspective.** A facet's presentation is a
property of the facet and the user's habit, not of the task lens they are
viewing through. Storing it alongside visibility (per project) keeps it stable
across perspective switches; folding it into the lens arrangement would make
mode flip-flop as the user changes perspective — surprising and unwanted.

**Perspectives reuse `facetLensStore`.** The store was already shaped for
named arrangements and already drives the sidebar order, so three built-ins +
an active id is the smallest change that delivers the switcher. A separate new
store would duplicate the ordering/grouping plumbing; piggybacking on
`viewStore` would entangle facet arrangement with trace-list sort/filter and
re-introduce the exact terminology confusion we are trying to avoid. The
trade-off is that `facetLensStore` grows an active-selection concept and a
localStorage migration (below).

## Consequences

- **Backend.** A new discrete-values descriptor/query for eligible integer
  facets (distinct values + counts + distinct-count guard) and numeric
  equality translation for discrete selections. Range facets are unchanged.
- **Registry.** `RangeFacetDef` carries integer-ness and a default mode;
  `FACET_GROUPS` is refined into finer sub-groups. `getFacetGroupId` and the
  pinned `__tests__/facetGroups.unit.test.ts` update with it.
- **State / storage.** `facetLensStore` gains built-in perspectives + an
  active id; a new per-project per-facet "numeric mode" setting joins the
  visibility settings. Persisted `groupOrder` referencing the old nine group
  ids must be tolerated (unknown ids dropped, missing ids appended) so saved
  arrangements survive the sub-group refactor.
- **UI.** A perspective switcher in the `FacetManagerPopover`; a mode-toggle
  icon in the numeric facet header; the Discrete presentation reuses
  `FacetSection`. The sidebar gains no group headers.
- **Naming is now load-bearing.** "Perspective" (facet arrangement) and "lens"
  (trace-list preset) are deliberately distinct terms; future work must keep
  them apart.
- **Out of scope / deferred.** Sparse true-distinct values for wide integer
  facets, numeric set syntax in the query language, and user-authored
  perspectives beyond the three built-ins are not part of this change.

## References

- Specs:
  - specs/traces-v2/numeric-facet-modes.feature
  - specs/traces-v2/facet-perspectives.feature
  - specs/traces-v2/search.feature (default value cap → 5; Range facets)
- Related: specs/traces-v2/lens-preset-groups.feature,
  specs/traces-v2/view-system.feature (the separate trace-list lens system)
- Key code: `FilterSidebar/constants.ts` (`MAX_VISIBLE_FACETS`,
  `FACET_GROUPS`), `FilterSidebar/RangeSection.tsx`,
  `FilterSidebar/FacetManagerPopover.tsx`, `stores/facetLensStore.ts`,
  `server/app-layer/traces/facet-registry.ts`
