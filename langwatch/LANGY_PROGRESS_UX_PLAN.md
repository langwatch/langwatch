# Langy progress/status UX for open-ended agent work — design plan

Research pass 2026-07-15 (file-level machinery audit + industry synthesis).
Status: DESIGN — Phase 1 is buildable immediately with zero backend changes.

## 0. What exists today

- Frame vocabulary (`services/langyagent/internal/frames/frames.go`): delta,
  reasoning, status, progress, heartbeat, card, tool, final, error, handoff.
  Emitters: opencode adapter (delta/reasoning/tool/heartbeat/handoff); app.go
  emits exactly ONE status ("Getting ready…", the cold-start placeholder the
  transport clears on first output). **`progress` and `card` have ZERO
  emitters** — the whole chain (relay appendMilestone, milestone stream entry,
  transport routing, `LangyStreamCard.tsx` stub, `StreamingStatusLine`'s bar,
  `useLangyTurnSignals`) is plumbed end-to-end but dead; `metrics`/`segment`
  hardcoded null.
- ADR-046 split: status/progress/reasoning/milestone are live-edge only.
  Durable per turn: tool_call_* (with command/input) + agent_responded
  (AnswerParts) → the per-turn fold. That's why tool cards survive refresh and
  status lines don't.
- Tool rendering (`LangyToolActivity.tsx`): capability cards + pending shells,
  the GitHub fixed-stage track (stages derived from tool parts — the
  "derive from what ran, never from narration" precedent), generic activity
  cards. **`todowrite`/`todoread` are already mapped** (`langyToolLabel.ts`) —
  but only to a generic shimmering "Planning…" card; the todos payload is
  thrown away.
- opencode: `todowrite` is a first-class tool `{todos: [{content, status:
  pending|in_progress|completed|cancelled}]}`, whole-list rewrite per call —
  so **the plan already crosses our wire as tool input**, lands durable via
  tool_call_initiated, persists as a tool part on the final message. No new
  opencode surface needed.
- AGENTS.md rules 10/12 ban plan narration in prose (correct) but never
  mention the todo tools — the structured channel sits unused.

## 1. Industry synthesis (Claude Code, ChatGPT agent, Devin, Cursor, Copilot
Workspace, Manus, AI SDK, MCP, AG-UI)

1. Plan-first checklist, 3-state items, EXACTLY ONE in-progress, active
   present-continuous label.
2. Progress = X of N plan items — never a fabricated percent (MCP progress is
   the only numeric standard; `total` optional, `message` = current step).
3. Step timeline with tool output attached to the step.
4. Collapse on completion (steps → one line; task → summary).
5. Plans are durable/replayable; ephemeral status lines are not.
6. Standards to align with: AI SDK `data-*` parts with stable id for in-place
   reconciliation (+ `transient` for ephemeral); AG-UI STEP_* +
   STATE_SNAPSHOT/DELTA.

## 2. Design

### Model: plan-mirroring from todowrite, snapshot-typed

The agent maintains its opencode todo list; the platform mirrors it as a typed
`plan` frame `{items: [{content, status}], revision?}` — a FULL SNAPSHOT per
frame (todowrite rewrites the list anyway; last-snapshot-wins is idempotent
under frameNonce dedup; no JSON-Patch needed). The MANAGER derives it in
opencode.go's tool branch when a settled tool part is todowrite (manager as
sole frame author), and suppresses the redundant todowrite tool card.

Why not skill-authored echo conventions: magic-words protocols are exactly
what this codebase killed (`[langy:progress:pushed]`, `[langy:connect-github]`
— see MessageContent.tsx comments); todowrite content is already on the wire,
matches model training, and is structurally validatable (cap items/length at
the relay).

Step attachment: TEMPORAL, not declared — every tool call starting while item
k is the unique in_progress item belongs to k. Pure function of stream order
(client-side, later fold-side), like githubProgressFromToolParts. Degrades
gracefully.

Secondary channel (feed later): status/progress frames for in-step granularity
— (a) manager statuses at transitions it truly knows (spawned, session
created, resuming from handoff); (b) CLI-envelope-derived sub-status
("Searching traces…" — the envelope already knows). MCP-style structured
progress lines from agent-written scripts: Phase 3+, only if usage demands.

### UI: `LangyPlanCard` as the turn's spine

- Items: completed → green check; in_progress → pulsing dot +
  langyThinkingShimmerStyles; pending dimmed; cancelled struck.
- Header overline "PLAN · 3/7". No percent bar for open-ended work (the
  StreamingStatusLine bar stays reserved for enumerable work via `progress`).
- Current step EXPANDED: tool/capability cards + pending shells nest under it;
  reasoning glimpse / status sub-line renders inside the current step row.
  LangyThinkingLine remains the no-plan fallback. Completed steps collapse to
  one line, re-expandable.
- On settle: collapses to "Completed 7 steps" (expandable), prose below. On
  failure/handoff: freezes honestly — done stays green, current shows failure.
- No plan ⇒ exactly today's UI. Zero regression path.
- Refresh: plan folds durable (checklist survives reload mid- and post-turn);
  ephemeral in-step signals correctly vanish.
- GitHub fixed-stage card stays; converges onto the plan model later.

### Wire + fold

- Phase 1: NONE (plan folds client-side from the already-durable todowrite
  tool parts).
- Phase 2: additive `plan` frame member (frames.go + langyRelayFrameSchema);
  relay appendPlan → stream entry {type:"plan"} → transport routes as a
  MESSAGE-LEVEL data part (`data-langy-plan`, stable part id, reconciles in
  place) — plan is render state, not an out-of-band signal. New durable event
  `plan_updated` (snapshot, last-write-wins) → `Plan` on the turn doc. One
  event per todowrite call — "meaningful transition" class, ADR-046-compliant.
- Step attribution stays derived — no wire field, replayable from event order.

### Agent side

AGENTS.md addition: "For multi-step work (3+ distinct actions), maintain your
todo list with todowrite before starting; update as each step completes; keep
exactly one item in_progress. The user sees it as a live checklist. Never
narrate the plan in prose — the plan lives in the tool, prose carries
results." Item copy: user-outcome verbs, never tool names (copywriting.md).
Skills note the checklist renders live. Non-compliance: today's UI, nothing
breaks. Trust: plan items are model text in a checklist — same class as prose
deltas; relay caps count/length.

## 3. Increments

**Phase 1 — client-side plan fold + prompt (ZERO backend changes).**
AGENTS.md rule; `langyPlan.ts` logic module folding a message's todowrite tool
parts into {items, currentIndex} + temporal attribution; `LangyPlanCard` +
nesting in LangyToolActivity/MessageContent; suppress the generic "Planning"
card. Durable + live already (tool parts).

**Phase 2 — first-class plan frame + durable fold + real statuses.** Manager-
derived plan frames; relay/buffer/transport as reconciling data part;
plan_updated event + Plan on turn doc; retire Phase-1 parsing. Replace
"Getting ready…" with manager lifecycle statuses; envelope-derived sub-status
in the current step; wire `metrics` off capability digests into
StreamingStatCard.

**Phase 3 — in-step progress + artifacts.** `progress` frames with real totals
for enumerable loops (suite runs); "workspace artifact" card ("Wrote crunch.js
· ran 3 times · last exit 0" — from file-write + shell tool parts); converge
the GitHub card; dev-mode step-timeline replay off the turn doc.

Sources: opencode tool docs + tool/todo.ts; Claude Code TodoWrite/Task docs;
MCP progress spec; AI SDK data-parts docs; AG-UI docs; ChatGPT agent, Devin,
Cursor Plan Mode, Copilot Workspace, Manus product docs.
