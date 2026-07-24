# LangWatch Trace v2

Single source of truth for project status, history, and roadmap.

## Current State

**Phase 2 (Lens Engine) complete + Phase 3A wiring in progress.**

Phase 1 + 2 mock UI is done. Phase 3A real-data wiring (tRPC routers, app-layer hooks, projections) has landed: `tracesV2.list`, `tracesV2.header`, `tracesV2.spanTree`, `tracesV2.evals`, the trace-level prompt rollup projection, and `tracesV2.aiAction` for the AI composer.

## Timeline

| Date | What happened |
|------|---------------|
| 2026-04-22 | Design doc approved. 7 vendor competitive analysis complete. Approach D (Foundation + Intelligence Spikes) chosen. |
| 2026-04-22 | Phase 0 schema validation: queried dev ClickHouse, confirmed grouping by session/user/service/model all feasible. |
| 2026-04-22–23 | Phase 1 foundation: mock implemented for 16 surfaces, 2 ADRs. |
| 2026-04-23 | CEO review restructured phases. Lens engine elevated from Phase 5 to Phase 2. AI features moved to Phase 4+. |
| 2026-04-23 | Phase 2 lens engine: mock implemented (view system, column config, grouping, conditional formatting, view analytics). Sidebar/toolbar polish pass. |
| 2026-04-23 | Data Layer + Prompt Facets bridges drafted to feed Phase 3A. |
| 2026-04-27 | Trace explorer page wired to tRPC: `tracesV2.list/header/spanTree/evals`. Drawer surfaces instrumentation scope + resource attributes; conversation context + back-stack + keyboard shortcuts; refresh progress bar reworked as a continuous wave. |
| 2026-04-28 | Lens-engine polish + AI on-ramp: ChipBar + Prompts tab in TraceDrawer, AI query composer + SearchBar UX polish, trace-level prompt rollup projection, Welcome dialog rebrand to Beta, EmptyState onboarding rework with PAT minting + sample data, refresh signal + empty-state gating, FilterSidebar facet group "is modified" dot, density extracted into its own global store, expanded sidebar facets (traceName, guardrail, annotation, containsAi, errorMessage, tokens, ttlt, …), TraceDrawer follow-ups (add-to-filter chips, drawer↔table cache coherence). |
| 2026-05-01 | PRD documents retired — `specs/traces-v2/` Gherkin feature files are the single source of truth. |

## Phase Roadmap

| Phase | Name | Repo | Data | Status |
|-------|------|------|------|--------|
| 1 | Foundation UI | this repo | Mock | **Complete** — 16 surfaces, mock built |
| 2 | Lens Engine | this repo | Mock | **Complete** — view system, columns, grouping, conditional formatting, view analytics |
| 3A | App Networking Layer | this repo | Real (tRPC + ClickHouse) | **In progress** — `tracesV2` router landed; data-layer wiring + prompt-facet projection live |
| 3B | tRPC Backend Hardening | this repo | Real | In progress (queries, projections, caching) |
| 4+ | Intelligence Features | this repo | Real | Started — `tracesV2.aiAction` composer + lens generation |

### Phase 3A (production frontend)

- State management: TanStack Query + Zustand (4 slices: filter, view, drawer, UI)
- Progressive data loading: 5-level model (table → drawer header → span skeleton → span detail → accordion detail)
- Filter state machine: AST as source of truth, two-way sync
- Mock data hooks replaced with real tRPC calls. Components stay untouched.
- Time range URL params for deep linking
- Auto-collapse sidebar at narrow viewports
- Chakra DatePicker replacing native date inputs
- Table virtualization (TanStack Virtual) replacing pagination

### Phase 3B (tRPC backend)

- New API layer connecting frontend to ClickHouse
- Replaces existing backend
- Export lens as CSV/JSON (server-side for large datasets)
- Team-shared lenses (server-side persistence + auth/permissions)
- Settings page (promoted attributes, column preferences)

### Phase 4+ (intelligence)

- **AI Diagnosis** — "What went wrong?" one-click root cause on any trace
- **AI-Generated Views** — natural language → LensConfig, user never configures manually
- **Frustration Detection** — sentiment analysis on conversation traces
- **Simulation Diff** — prod behavior vs simulation behavior side-by-side (LangWatch's unique asset)
- **Lens comparison / split mode** — precursor to simulation diff
- **Smart default lenses** — use view analytics to generate personalized defaults
- **Lens templates per persona** — pre-configured for Engineer, PM, QA, Compliance, Finance
- **Timeline density scrubber** — trace volume overlay above table, acts as time zoom
- **Widescreen three-column layout** — span list | timeline/waterfall | span detail at ≥1440px, bidirectional selection sync

### Future (separate scope)

- **Multiplayer** — cursor presence, comments, tagging (needs WebSocket/Liveblocks layer)
- **Aggregate Intelligence** — trend views, cost anomaly attribution, semantic search, critical path analysis, agent/service maps

## Key Decisions

- **"Lens" terminology** — user-facing and internal. Not "view" or "preset."
- **One design with density controls** — not three modes (pro/clean/AI-forward). Pro mode is the base.
- **Status as 2px border, not column** — saves 40px, eyes scan left edge naturally.
- **User feedback is an event, not an evaluation** — thumbs up/down in Events accordion, automated scores in Evals.
- **All lenses show draft dot** — modifying a built-in lens nudges users to "Save as new lens."
- **Reversed: "Mock is throwaway"** — Phase 1/2 was built directly in this repo against mock data hooks, then swapped behind the same hook signatures to real tRPC queries in Phase 3A. No separate prototype workspace.

## Documentation Index

### Strategy
- [Design Doc](trace-v2.md) — Problem statement, personas, product philosophy, approach rationale. The "why."

### Specifications
- BDD feature files: [`specs/traces-v2/`](../../../../../specs/traces-v2/) at the repo root — one per surface. The single source of truth for acceptance criteria.

### Decisions
- [ADR-001: Visualization Types](decisions/adr-001-visualization-types.md) — Why Waterfall + Flame Graph + Span List.
- [ADR-002: Phasing Strategy](decisions/adr-002-phasing-strategy.md) — Foundation first, differentiators loose.

### Engineering
- [STANDARDS.md](STANDARDS.md) — File org, React patterns, state, design tokens, testing.
- [trace-architecture.dot](trace-architecture.dot) — Graphviz overview of the data + UI graph.
