# LangWatch Trace v2

Single source of truth for project status, history, and roadmap.

## Current State

**Phase 2 (Lens Engine) — mock complete, PRDs complete.**

All work so far is against mock data in this repo (`observe-exp`). The production app lives in a separate codebase. This repo is the design/spec/prototype workspace.

## Timeline

| Date | What happened |
|------|---------------|
| 2026-04-22 | Design doc approved. 7 vendor competitive analysis complete. Approach D (Foundation + Intelligence Spikes) chosen. |
| 2026-04-22 | Phase 0 schema validation: queried dev ClickHouse, confirmed grouping by session/user/service/model all feasible. |
| 2026-04-22–23 | Phase 1 foundation: 16 PRDs written (001–016), 2 ADRs, mock implemented. |
| 2026-04-23 | CEO review restructured phases. Lens engine elevated from Phase 5 to Phase 2. AI features moved to Phase 4+. |
| 2026-04-23 | Phase 2 lens engine: 5 PRDs written (017–021), mock implemented. Sidebar/toolbar polish pass. |

## Phase Roadmap

| Phase | Name | Repo | Data | Status |
|-------|------|------|------|--------|
| 1 | Foundation UI | observe-exp | Mock | **Complete** — 16 PRDs, mock built |
| 2 | Lens Engine | observe-exp | Mock | **Complete** — 5 PRDs, mock built |
| 3A | App Networking Layer | Production repo | Mock → Real | Outlined in design doc |
| 3B | tRPC Backend | Production repo | Real (ClickHouse) | Future |
| 4+ | Intelligence Features | Production repo | Real | Future |

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
- **Smart default lenses** — use view analytics (PRD-021) to generate personalized defaults
- **Lens templates per persona** — pre-configured for Engineer, PM, QA, Compliance, Finance
- **Timeline density scrubber** — trace volume overlay above table, acts as time zoom
- **Widescreen three-column layout** — span list | timeline/waterfall | span detail at ≥1440px, bidirectional selection sync

### Future (separate scope)

- **Multiplayer** — cursor presence, comments, tagging (needs WebSocket/Liveblocks layer)
- **Aggregate Intelligence** — trend views, cost anomaly attribution, semantic search, critical path analysis, agent/service maps

## Key Decisions

Decisions are logged in [CHANGELOG-PRDS.md](CHANGELOG-PRDS.md) with rationale. Major ones:

- **"Lens" terminology** — user-facing and internal. Not "view" or "preset."
- **One design with density controls** — not three modes (pro/clean/AI-forward). Pro mode is the base.
- **Status as 2px border, not column** — saves 40px, eyes scan left edge naturally.
- **User feedback is an event, not an evaluation** — thumbs up/down in Events accordion, automated scores in Evals.
- **Built-in lenses never show draft dot** — exploration is not modification.
- **Mock is throwaway** — this repo's mock validates the design; production code lives elsewhere.

## Documentation Index

### Strategy
- [Design Doc](design/trace-v2.md) — Problem statement, personas, product philosophy, approach rationale. The "why."

### Specifications
- [PRDs](prds/) — 21 PRDs covering Phase 1 (001–016) and Phase 2 (017–021). The "what."
- [PRD Tracker](prds/TODO-PRDS.md) — Completion status of all PRDs.
- [CHANGELOG-PRDS.md](CHANGELOG-PRDS.md) — Decision changes from review sessions, with rationale.
- Specs (to be written per PRD during implementation). The "how."

### Decisions
- [ADR-001: Visualization Types](decisions/adr-001-visualization-types.md) — Why Waterfall + Flame Graph + Span List.
- [ADR-002: Phasing Strategy](decisions/adr-002-phasing-strategy.md) — Foundation first, differentiators loose.

### Design System
- [DESIGN.md](DESIGN.md) — Color tokens, component mappings, Chakra UI strategy.

### Mock Implementation
- [Mock Phase 1 Notes](../mocks/v2/MOCK-PHASE-1-NOTES.md) — Implementation rules and patterns for Phase 1 mock.
- [Mock Phase 2 Notes](../mocks/v2/MOCK-PHASE-2-NOTES.md) — Implementation rules for Phase 2 lens engine mock.

### Research
- [research/outcomes/](../research/outcomes/) — 7 vendor analysis reports + internal concept design.
