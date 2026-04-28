# PRD Change Log

Changes made to PRDs during review and iteration sessions. These must be carried into tech specs. Sorted by date, most recent first.

## 2026-04-28 (Phase 2 → 3A Bridge: drawer follow-ups, AI on-ramp, prompt rollup)

### TraceDrawer Prompts Tab + Unified ChipBar
- **Affected:** PRD-004, PRD-010
- **Change:** TraceDrawer gains a third tab type alongside Trace Summary and ephemeral span tabs: **Prompts**. The tab only renders when the trace touches at least one prompt (`promptCount > 0` from the rollup projection — see PRD-023). Inside the tab: one card per prompt, grouped by selected vs last-used, each linking back to the originating span via the new add-to-filter chip. The header chips collapsed into a single unified `ChipBar` row driving status, scope, scenario, prompt, error, and cost chips with the same render/click contract.
- **Why:** Prompts are first-class debugging context for agent traces — surfacing them as a tab (not just metadata) lets users jump from "which prompt ran" to "which span used it" in one click. The previous chip-soup header was hard to scan.
- **Spec note:** `SpanTabBar` decides Prompts tab visibility from the trace-level prompt rollup. `ChipBar` consumes `useTraceHeaderChips` to render an ordered list of chips with consistent click handlers (most chips push a filter into `filterStore` and close the drawer-overlay state).

### AI Query Composer in SearchBar
- **Affected:** PRD-003, PRD-003a (extension), trace-v2.md (Phase 4 → Phase 3A bring-forward)
- **Change:** SearchBar grows a sparkles button that opens an **AI query composer** popover. User describes what they want in natural language; server returns a structured action (lens config + filters or filter delta), which the client applies. The composer is the first user-visible AI surface and validates the "ask, don't configure" pillar before the broader Phase 4 intelligence work. Implemented under `components/ai/` and the `tracesV2.aiAction` tRPC procedure.
- **Why:** We brought a thin AI on-ramp forward from Phase 4+ to dogfood the LensConfig-as-LLM-output approach early, and to give the SearchBar a clear answer to the "I don't know the syntax" failure mode.
- **Spec note:** Treat `aiQuery` output as untrusted — validate against the LensConfig schema before applying. Failure path falls back to leaving the current lens unchanged with a toast.

### Trace-Level Prompt Rollup Projection (PRD-023 implementation)
- **Affected:** PRD-023
- **Change:** Added a projection step that walks span attributes and rolls `langwatch.prompt.selected.id`, `langwatch.prompt.id`, `langwatch.prompt.version.number`, and `langwatch.prompt.version.id` up to the trace summary, keyed to the source `SpanId` so the UI can deep-link from a facet match back to the span that produced it. Powers the new Prompts sidebar group and the `prompt.*` search syntax.
- **Spec note:** `parsePromptReference` now also surfaces `langwatch.prompt.version.id`. Sidebar Prompts group is collapsed-by-default and only renders when the projection has data for the current filter scope.

### Welcome Dialog Rebrand to Beta + EmptyState Onboarding Rework
- **Affected:** PRD-001
- **Change:** Welcome dialog rebranded as the v2 **Beta** announcement with a refined MeshGradient + crossfade. EmptyState replaced with `TracesEmptyOnboarding` — a tabbed flow with three segments (Coding Agent, MCP, Manual) plus an inline `PatIntegrationInfoCard` that mints a PAT inline so users don't bounce to settings. The "explore with sample data" path is preserved but now flows through `useSampleData`.
- **Why:** The previous two-card layout assumed every user already had a PAT and an integration choice. The tabbed layout matches how new users actually start (pick how they want to integrate, then mint a PAT for that flow).
- **Spec note:** PRD-001's "Two cards side-by-side" section is superseded by the tabbed flow. Each tab lifts the matching screen from the main onboarding flow rather than reimplementing them. EmptyState gating now reads from `useProjectHasTraces` so the empty view only shows when truly empty.

### Refresh Signal + Empty-State Gating + Drawer↔Table Coherence
- **Affected:** PRD-002, PRD-004, PRD-022
- **Change:** Refreshing inside the drawer now also invalidates `tracesV2.list`, so duration/cost/status fields the projection just refreshed don't stay stale on the row underneath the drawer. Refresh progress reworked from a periodic spinner into a **continuous wave** that gates against a `MIN_REFRESH_VISIBLE_MS` floor so flashes don't appear on fast refreshes. Empty-state UI is gated against the same signal, so a "you have no traces" view never flashes during a refresh.
- **Spec note:** PRD-022's invalidation matrix should call out drawer-refresh → list invalidation. The `freshnessSignal` store and `MIN_REFRESH_VISIBLE_MS` are the single source of truth for "is the list currently mid-refresh."

### FilterSidebar Facet Group "Is Modified" Dot + Expanded Facets
- **Affected:** PRD-003, PRD-017
- **Change:** Each facet **group** in the sidebar now shows a small dot when any facet inside it has a non-default value, mirroring the lens draft dot pattern. The sidebar facet inventory expanded with: `rootSpanName`, guardrail evaluations, annotation presence, `containsAi`, error message text, token counts, and `ttlt` (time to last token). Sidebar still respects locked facets per built-in lens.
- **Why:** Users were missing that "I left a filter on three groups ago" — the dot makes ambient state legible without forcing a sidebar scroll. New facets cover the most-asked questions from internal dogfooding.
- **Spec note:** Compare each group's facets against the lens's saved filter AST; any difference flips the group's `isModified` flag. Locked facets still render collapsed and non-interactive.

### Density Extracted to Its Own Global Store
- **Affected:** STANDARDS.md, PRD-002, PRD-017
- **Change:** Density moved out of `viewStore` into a dedicated `densityStore` (with `DensityProvider` consuming it). Density is no longer part of LensConfig — it's a per-user preference that survives lens switches.
- **Why:** Treating density as part of LensConfig caused users to lose their preferred density when switching lenses, which they consistently reported as broken.
- **Spec note:** PRD-017's LensConfig schema should NOT include density. Update STANDARDS.md store list to add `densityStore` and note it persists separately.

---

## 2026-04-24 (Draft State Reversal)

### All Lenses Show Draft Dot (Reverses Previous Decision)
- **Affected:** PRD-017
- **Change:** Draft state dot now applies to ALL lenses, including built-in ones. Previously, built-in lenses never showed the dot. Now, modifying columns, grouping, sort, or filters on any lens shows the blue dot. For built-in lenses, the dot nudges users toward "Save as new lens" since built-ins can't be overwritten. For custom lenses, behavior unchanged (Save, Save as new, Revert).
- **Why:** Without the dot on built-in lenses, users customize a view, switch tabs, and lose everything with no warning. The dot is ambient awareness that a configuration is worth saving — not a guilt signal.
- **Reverses:** "Built-in Lenses Never Show Draft Dot" (2026-04-23). The original concern was the dot feeling like "you've done something wrong." The revised view: the dot feeling like "you might want to keep this."
- **Spec note:** Remove `!lens.isBuiltIn` guard from draft state tracking in viewStore. Built-in lens context menu gains "Save as new lens..." and "Reset to defaults" (greyed out when no draft). `selectLens` clears draft state for the lens being navigated away from.

## 2026-04-23 (CEO Review + Phase 2 Scoping + Feedback Iteration)

### Eval Run History (Multiple Runs per Trace)
- **Affected:** PRD-009
- **Change:** The same eval type can run multiple times on the same trace (e.g., when a new span arrives). The eval card shows the MOST RECENT run with an inline run history indicator: sparkline for numeric evals, colored dots for pass/fail evals. Click to expand full timeline showing all runs with scores, timestamps, reasoning, and what triggered each re-evaluation (which span was added/updated). Accordion count shows distinct eval TYPES, not total runs.
- **Why:** Users need to see the eval trajectory. "It failed at this point, then passed when that span completed" is the debugging story.
- **Spec note:** Query must return all runs per eval type per trace, ordered by timestamp. Sparkline is an inline SVG. Run history timeline is expandable within the card. Each run stores which span triggered it.

### Span Tab Shows Span-Specific Exceptions, Events, and Evals
- **Affected:** PRD-006, PRD-004
- **Change:** The span tab now shows exceptions, events, and evals that originate from the selected span (not just I/O and Attributes). These sections only render if the span actually has them (hidden entirely if empty, not empty state). Trace Summary tab still shows ALL hoisted across all spans. Span tab shows only what belongs to this span.
- **Why:** User feedback. "The exception was thrown on this span, but I can't see it when looking at this span's tab. I have to switch back to Trace Summary." Backwards UX.
- **Spec note:** Filter events/exceptions/evals by spanId when rendering span tab. Same components as PRD-005/009, just filtered. No `┈ from [span name]` link needed in span tab (you're already on that span).

### ~~Built-in Lenses Never Show Draft Dot~~ (REVERSED 2026-04-24)
- **Affected:** PRD-017
- **Change:** ~~Draft state (dot indicator) only applies to custom lenses.~~ **Reversed:** All lenses now show the draft dot. See 2026-04-24 entry.
- **Why:** Original concern was the dot feeling like "you've done something wrong." Revised: the dot feeling like "you might want to keep this." Without it, users lose customizations silently when switching tabs.

### Draft Dot is Passive (Not Clickable)
- **Affected:** PRD-017
- **Change:** The dot indicator on custom lens tabs is purely visual. It does not open a dropdown on click. Draft actions (Save, Save as new, Revert) are in the tab's right-click context menu or `⋯` overflow button. This prevents accidental Revert from double-clicking the dot.
- **Why:** User feedback. Clicking the dot accidentally triggered Revert, losing changes. The dot should inform, not act.
- **Spec note:** Remove click handler from dot element. Merge draft actions into the existing context menu (Rename, Duplicate, Delete).

### Error/Warning Row Background Tint
- **Affected:** PRD-002
- **Change:** In addition to the 2px left border, error and warning rows get a very subtle background tint. Error: `red.50` (light) / `red.900` at 10% (dark). Warning: `yellow.50` / `yellow.900` at 10%. Composes with hover state (both visible simultaneously).
- **Why:** User feedback. Border alone is precise but background tint adds ambient awareness. Errors visible from any distance.
- **Spec note:** CSS `backgroundColor` on `<tr>` based on status. Layer with hover background using transparency.

### Eval Cards Made Compact (2 Lines Default)
- **Affected:** PRD-009
- **Change:** Eval cards are now 2 lines by default (was 5-6). Line 1: color dot + name + timestamp + score + run history + span origin + expand chevron. Line 2: reasoning snippet (truncated ~60 chars). Expand (▾) to see full reasoning, metadata, and action links. Score bar replaced by colored dot. Span origin inline on line 1.
- **Why:** User feedback that eval cards are too tall. Compact cards fit more evals in the visible area without scrolling.
- **Spec note:** Collapsed card height ~48px (2 lines at 13px font + padding). Expanded height varies by content.

---

## 2026-04-23 (CEO Review + Phase 2 Scoping Session)

### Terminology Change: "Lenses" not "Views" or "Presets"
- **Affected:** PRD-002, PRD-017, PRD-018, PRD-019, PRD-020, PRD-021, trace-v2.md, ADR-002
- **Change:** User-facing term is "lens" / "lenses". Internal code uses LensConfig. PRD-002's "Lens Preset Tabs" section header updated. All Phase 2 PRDs use "lens" consistently.
- **Why:** User preference. "Lenses" captures the concept of looking at the same data differently.

### Status Column Replaced with 2px Left Border
- **Affected:** PRD-002, PRD-018, PRD-019
- **Change:** Status is no longer a table column. Instead, a 2px left border on each row indicates status: no border = OK, yellow = warning, red = error. Saves ~40px horizontal space. Not sortable (use `@status:error` filter). Group headers show worst status in the group.
- **Why:** Cleaner design, saves space, eyes naturally scan left edge.
- **Spec note:** Remove Status from column definitions, TanStack column config, column visibility dropdown. Add CSS `borderLeft` on `<tr>` based on trace status.

### User Feedback is an Event, Not an Evaluation
- **Affected:** PRD-005, PRD-009, PRD-002
- **Change:** Thumbs up/down, user ratings, annotations are events (PRD-005 Events accordion). Evaluations (PRD-009) are automated scoring only (sentiment, faithfulness, toxicity, etc.). Events column in table shows feedback icon (👍/👎) after event count.
- **Why:** User clarification. Different data types, different meaning. User actions vs automated checks.
- **Spec note:** When displaying events, check for `user.feedback` event type and render with thumbs icon. Don't show feedback in the Evals accordion.

### Timestamps on Eval Cards
- **Affected:** PRD-009
- **Change:** Each eval card shows a timestamp offset (e.g., `+0.8s`) next to the eval name, same pattern as events and exceptions. Eval popover in the table also shows when the eval ran.
- **Why:** User requested "harvest date" on evals. Need to know WHEN the eval ran, not just what it scored.
- **Spec note:** The timestamp is the eval span's start time, rendered as offset from trace start.

### Grouped Table: Column-Aligned Aggregates
- **Affected:** PRD-019
- **Change:** Group header rows use the same column grid as trace rows. Each column shows an automatic aggregate: avg for durations/scores (with "avg " prefix), sum for cost/tokens, `×N` for categorical columns with multiple values, time range for Time column.
- **Why:** Makes scanning groups as easy as scanning a flat table. Aggregates align with the columns they correspond to.
- **Spec note:** Aggregates computed server-side (ClickHouse GROUP BY). Frontend renders in the same column cells. Conditional formatting (PRD-020) applies to aggregate values too.

### Categorical Column Aggregates: Count of Variants
- **Affected:** PRD-019
- **Change:** For string columns (Service, Model, User) in group headers: if all same value, show it. If 2+ distinct values, show `×N` with hover tooltip listing distinct values. Time column shows range: `2m .. 1h`.
- **Why:** User feedback. "×3" is more informative than "mixed" and tells you the cardinality.
- **Spec note:** Query must return distinct count per group per categorical column. Tooltip fetches distinct values on hover (lazy).

### Accordion Count Badges: Position Next to Section Name
- **Affected:** PRD-005
- **Change:** Count badges like "(3)" render immediately after the section name text (e.g., "Events (3)"), not floating to the far right. Keeps the user's eyes in one place. Keyboard shortcut indicators can go on the far right.
- **Why:** User feedback. Eyes are already reading the section name, count should be right there.
- **Spec note:** Change accordion header layout from `justify-content: space-between` to inline flow.

### Span Tab Persistence (PRD-004 Compliance)
- **Affected:** PRD-004 (already correct), mock
- **Change:** Clicking "Trace Summary" tab must NOT close the span tab. It stays open. User can click back to it. This is explicitly in PRD-004 but the mock got it wrong.
- **Why:** User needs to switch back and forth between trace summary and span detail.
- **Spec note:** Tab state: `activeTab: 'trace-summary' | 'span'`. Switching tabs changes activeTab only. `selectedSpanId` persists until explicitly closed (X, Escape, click same span, click empty space in viz).

### Draft State on Filter Changes
- **Affected:** PRD-017
- **Change:** Changing filters (sidebar checkboxes, search bar, sliders) should put the active lens into draft state (dot indicator). Filters are part of the LensConfig.
- **Why:** Filters are part of the lens config. If you change them, the lens is modified.
- **Spec note:** Compare current filter AST against the lens's saved `filters` array. Any difference = draft state.

### Locked Facets on Built-in Lenses (PRD-003 Compliance)
- **Affected:** PRD-003 (already correct), mock
- **Change:** When a lens locks a filter facet (e.g., Errors lens locks Status), the facet section in the sidebar must be collapsed and non-expandable. Shows `🔒 Status: Error (set by Errors lens)`. Already in PRD-003, mock didn't implement it.
- **Why:** Locked facets should be visually distinct and non-interactive.
- **Spec note:** Each lens's `filters` array defines which facets are locked. Locked facets render as collapsed, non-clickable sections with lock icon.

### Phase Renumbering
- **Affected:** trace-v2.md, ADR-002
- **Change:** Phases restructured: Phase 1 (Foundation UI, this repo) -> Phase 2 (Lens Engine, this repo) -> Phase 3A (App Networking Layer, prod repo) -> Phase 3B (tRPC Backend, prod repo) -> Phase 4+ (Intelligence Features, prod repo). Custom/saved lenses moved from old Phase 5 to new Phase 2. AI features moved from old Phase 3 to new Phase 4+.
- **Why:** Lens engine is a differentiator on its own. Mock-first approach means Phases 1-2 in test repo, 3+ in production.
- **Spec note:** All phase references in specs should use the new numbering.

### LLM Two-Row Hover: Treat as Single Unit
- **Affected:** PRD-002 (already correct), mock
- **Change:** For traces with header + I/O sub-rows, hover state must treat BOTH rows as one unit. Already in PRD-002, mock got it wrong.
- **Spec note:** Wrap both `<tr>` elements in a hover group. CSS `:hover` on the group applies to both rows.

### Background Logo When Table is Short
- **Affected:** PRD-002 (new addition)
- **Change:** When the table doesn't have enough rows to fill the visible area, show a centered, very faded (opacity ~0.04) LangWatch logo in the background of the table area below the last row.
- **Why:** Brand identity. Empty space feels intentional, not broken.
- **Spec note:** CSS `background-image` on the table container, centered, no-repeat, with very low opacity. Only visible when content doesn't cover it.

### Trace Peek Fixes
- **Affected:** PRD-012
- **Change:** (1) Peek trigger on LLM two-row traces should work on the combined hover group. (2) Peek z-index must be below the drawer. (3) Visual styling needs refinement.
- **Spec note:** Peek popover z-index < drawer z-index. Peek trigger area = the hover group from the two-row fix above.

### Split/Comparison Mode: Spec Layout Contract
- **Affected:** PRD-019 (future section)
- **Change:** Phase 4+ will add split mode. PRD-019 notes that group headers should use percentage/flex widths (not fixed px) so they adapt to half-width containers. No Phase 2 build, just a note.
- **Spec note:** When implementing group headers, use flex layout, not fixed widths.
