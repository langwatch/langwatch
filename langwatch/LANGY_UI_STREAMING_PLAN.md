# Langy — UI + streaming build plan (feat/langy-frontend, PR #5706)

Living plan for the UI-fidelity + real-time-streaming push. Calibrated against
`langy-full-experience-reference.html`. Dev stack: app `:5600`
(`admin@local.langwatch.dev`), Go agent `:8080`, Redis/PG/CH on host ports.

## Phase 1 — Visual redesign (the punch list)
- [x] Drop the useless `project:` context chip (chips only for real resources).
- [x] Compact provider-aware model pill (`LangyModelPill`), replacing the heavy shared `ModelSelector` trigger.
- [x] Model search in the pill menu, auto-focused on open.
- [ ] Thinking shimmer: bigger + calmer (13px, gentler sweep) — not tiny/over-the-top.
- [ ] Reference-grade error card (`LangyError`): warn/crit/info variants, icon tile, mono code chip, meta kv pills, action + trace link.
- [~] Panel shell — INTERIM: flush-right dock, rounded-left corners + left shadow, no gutter. (The full-height floating-inset version created an awful gap + the collapse badge looked bad — reverted.) See "Parked" below.
- [ ] Composer: full-width text box flush at the bottom of the panel.
- [ ] Type + colour polish to the reference tokens (warm neutrals, brand orange).

## Phase 2 — Structured errors (server seam that was never built)
- [ ] Implement `serializeStreamError` in `routes/langy.ts` (referenced in a comment, never written).
- [ ] `attachTurnStream.emit` must emit an AI-SDK **error part** for buffer `error` entries (today they are silently dropped → hard failures look like an empty stream). Client `readLangyStreamError` + `LangyError` already parse/render it.

## Phase 3 — Event-driven tool pipeline (the core flow)
Today the Go manager drops every opencode event except text deltas; `attachTurnStream.emit`
emits only text. So no tool activity, no mid-stream status, no mapped cards.
- [ ] Go manager (`opencode.go`): forward tool lifecycle events as compact `langy.tool` frames (id, name, state start/delta/end/error, input, result).
- [ ] Turn processor (`langy-turn.processor.ts`): parse `langy.tool` → durable `tool_call_started` / `tool_call_completed` (ALL tools, not just github.open_pr) + buffer `tool` entries. Heartbeats already exist; fast deltas already work.
- [ ] Event schema + fold: tool events fold into turn state → event-driven recovery / replay after refresh.
- [ ] `attachTurnStream.emit`: translate `tool`/`status`/`progress` buffer entries → AI-SDK tool parts + `data-*` parts.
- [ ] Wire `useLangyTurnSignals` (currently a hard null stub) to consume status/progress/metrics.
- [ ] Client renders mapped UI states (already ~built: `LangyToolActivity` + capability cards, `StreamingStatusLine`, `StreamingStatCard`). Terminal tool result → final nice card like the reference.

## Phase 5 — Langy-scoped custom palette (do LAST, with care)
Give the whole Langy component tree its own token set (CSS custom properties on
the panel root), distinct from the app's cool greys:
- Light: warmer **beige/cream** surfaces (not white/cool-grey).
- Dark: **softer, lifted grey** (not near-black).
- Keep the brand orange accent + semantic colours; scope so nothing leaks to the
  rest of the app. Apply via `--langy-*` vars on the panel root, style all Langy
  components through them.

## Phase 4 — Composer command / autocomplete system
- [ ] `#` to reference + trigger actions on cards above (e.g. `#good`); plain-text autocomplete to a card's buttons ("good" → clicks the matching action).
- [ ] `/` slash commands for special actions; `/model` to change model, `/feedback`, `/new`, etc.

## Panel shell — DECIDED (drawer interaction model)
Interaction study: https://claude.ai/code/artifact/cba8bf01-02d5-4b4e-bad9-8cca39a9d849
- Shell = Notion model: circular **bottom-right launcher** opens; collapse via header ✕. (done)
- **User picks the mode: Floating (A) or Sidebar (B).** Persisted.
  - Floating = card overlays content; floats above a drawer.
  - Sidebar = full-height right dock; pushes content; a drawer nests to its left.
- **Small screens: take turns** — when a drawer opens and there isn't room, Langy
  yields to the launcher bubble (idea C), springs back when the drawer closes.
- **Context (E) always layers on**: whatever drawer/selection is open rides into
  the composer as a chip. Wire this independent of the layout call.
Build order: [1] mode pick + Floating/Sidebar layouts + header toggle (in progress)
→ [2] richer context (selected/in-view/filtered/drawer-open) → [3] small-screen yield.

## Test references
- GitHub connect (popup) for the connect-card flow:
  `http://localhost:5600/api/github-langy/connect?mode=popup&organizationId=woe7CXxV5K0OUY3hWKOXG`

## Known real bug (separate, noted)
- The `search_traces` tool itself errors "Cannot read properties of undefined (reading 'traces')" — a tool/skill bug, surfaced as prose today. Phase 3 makes it a structured tool-error card; the underlying tool fix is its own follow-up.
