# Langy v2 — implementation plan

> Companion to `PRD.md`, `memory-design.md`, `architecture.md`.
> The PRD says *what*. The architecture says *how it fits*.
> This doc says *what we build, in what order, in what PR*.
>
> Status: **Draft for review.**
> Last updated: 2026-05-06

## How to read this doc

Each phase below is a vertical slice of work. Inside each phase, **PRs are
ordered**: do PR-N before PR-N+1 within the phase. Across phases, you can
parallelize where dependencies don't bind.

For each PR:
- **Goal** — what is true after this merges
- **Files** — the concrete touch list
- **Tests** — what must pass (binds to `.feature` scenarios where applicable)
- **Verification** — how you know it works (manual + automated)
- **Risks** — what could go wrong; mitigations

A PR is too big if it can't be reviewed in 30 minutes. Split it.

---

## Phase 0 — Cleanup & alignment (1 PR, ~half a day)

**Goal:** the branch is named, the spec is canonical, the v1 code is unchanged
but understood. We are ready to test what already exists.

### PR-0.1: Spec alignment + dead-code audit

- **Files:**
  - `specs/assistant/*` (already drafted in this session — review and merge)
  - `langwatch/src/components/langy/*` — note any TODOs/unused exports
  - `langwatch/src/server/routes/langy.ts` — confirm tool surface vs PRD §3

- **Outcome:** PRD and `.feature` files are merged on a feature branch off
  `feat/sage-assistant`. No code changes yet.

- **Verification:** spec docs render correctly on GitHub; team review on PRD.

---

## Phase 1 — Foundations: test what exists (3 PRs, ~3-5 days)

**Goal:** every scenario in `langy-baseline.feature` has a passing test.
This is the regression net before we change anything.

### PR-1.1: Test infra for Langy

- **Goal:** test scaffolding exists (factories, helpers, fixtures).
- **Files:**
  - `langwatch/src/server/routes/__tests__/langy.test-utils.ts` — request helpers
  - `langwatch/src/components/langy/__tests__/test-utils.tsx` — render helpers, mocked LangyContext
  - Test fixtures for fake project + evaluators + prompts
- **Tests:** none yet (this is infra)
- **Verification:** `pnpm test:unit` runs the (empty) Langy test suite without errors.

### PR-1.2: Bind unit/integration tests to baseline scenarios

- **Goal:** `langy-baseline.feature` scenarios pass.
- **Files:**
  - `langwatch/src/server/routes/__tests__/langy.chat.integration.test.ts` — auth, permission gate, project isolation, tool call surface
  - `langwatch/src/components/langy/__tests__/LangySidebar.integration.test.tsx` — open/close, proposal card render, Apply/Discard
  - `langwatch/src/components/langy/__tests__/ProposalCard.integration.test.tsx` — destructive variant, Applied state
- **Tests:** every `langy-baseline.feature` scenario bound
- **Verification:** `pnpm test:integration` green; spec coverage = 100%.
- **Risks:** existing v1 code may not be testable as-is (e.g., hardcoded model). Mitigation: add minimal seams (env override for model in tests) without changing prod behavior.

### PR-1.3: Self-observability scaffolding

- **Goal:** every Langy LLM call emits a trace to a dogfood project.
- **Files:**
  - `langwatch/src/server/routes/langy.ts` — wrap streamText with trace export
  - `langwatch/src/server/observability/langy-tracer.ts` — new helper
  - Config: dogfood project ID and API key in env
- **Tests:** unit test that asserts a trace is emitted on a happy-path call
- **Verification:** local run shows a Langy trace in the dogfood project.

---

## Phase 2 — Memory (5 PRs, ~2 weeks)

**Goal:** L3 (cross-session history), L4 (project memory), and L6 (lazy
retrieval) all working end-to-end. `langy-memory.feature` scenarios pass.

### PR-2.1: Schema + migrations

- **Goal:** the four tables exist in dev and migrations are reviewed.
- **Files:**
  - `langwatch/prisma/schema.prisma` — add `LangyConversation`, `LangyMessage`, `LangyProjectMemory`, `LangyProjectMemoryHistory`, `LangyUserPreferences`
  - `langwatch/prisma/migrations/<timestamp>_langy_memory/migration.sql`
- **Tests:** schema-level — Prisma client compiles; multitenancy middleware enforces `projectId` on Langy models.
- **Verification:** `pnpm start:prepare:files` regenerates types; CI green.
- **Risks:** schema drift if someone changes during review. Mitigation: rebase often.

### PR-2.2: LangyConversationService + LangyMessageService + tests

- **Goal:** create/list/load/delete conversations and messages, with multitenancy enforced.
- **Files:**
  - `langwatch/src/server/services/langy/LangyConversationService.ts`
  - `langwatch/src/server/services/langy/LangyMessageService.ts`
  - `langwatch/src/server/services/langy/index.ts`
  - Unit tests under `__tests__/`
- **Tests:** binds `langy-memory.feature` scenarios:
  - "Conversation history is scoped per user within a project"
  - "Conversation history never crosses projects"
  - "Delete a conversation"
  - "Idle conversations are hard-deleted after 90 days" (cron unit-tested in 2.5)
- **Verification:** unit tests green.

### PR-2.3: Conversation routes + UI integration

- **Goal:** Langy chat persists messages and supports a Recent list.
- **Files:**
  - `langwatch/src/server/routes/langy.ts` — wire chat to `LangyConversationService` + `LangyMessageService`
  - `langwatch/src/server/routes/langy-conversations.ts` — new GET/PATCH/DELETE routes
  - `langwatch/src/components/langy/RecentConversations.tsx` — new
  - `langwatch/src/components/langy/LangySidebar.tsx` — wire Recent panel
- **Tests:** binds:
  - "Conversation history persists across page reloads"
  - "Start a new conversation"
  - "View recent conversations"
- **Verification:** manual: send messages, reload, verify persistence; run `pnpm test:integration`.

### PR-2.4: LangyProjectMemoryService + bootstrap worker

- **Goal:** project memory bootstraps automatically when a project is created.
- **Files:**
  - `langwatch/src/server/services/langy/LangyProjectMemoryService.ts`
  - `langwatch/src/server/workers/bootstrapLangyProjectMemory.ts`
  - Hook into project-creation flow (find existing hook in `langwatch/src/server/services/projects/...`)
  - System-prompt update in `langwatch/src/server/routes/langy.ts` to inject project memory
- **Tests:** binds:
  - "First-time project memory init"
  - "Project memory is injected into every conversation"
  - "Project memory token budget is enforced"
- **Verification:** create a fresh project; within 30s, `LangyProjectMemory` row exists; first chat shows Langy already knowing the project.
- **Risks:** worker fails silently. Mitigation: ops alert on bootstrap failure; fallback re-attempt on first chat open.

### PR-2.5: Project memory edit + refresh + settings UI

- **Goal:** users can view, edit, and refresh project memory.
- **Files:**
  - `langwatch/src/server/routes/langy-project-memory.ts` — GET, PUT, POST refresh (SSE streaming)
  - `langwatch/src/pages/[project]/settings/langy.tsx` — new settings page
  - Markdown editor component (reuse existing if present, otherwise add a simple one)
- **Tests:** binds:
  - "Edit project memory"
  - "Stale project memory prompts a refresh"
  - "View what Langy remembers about me in this project"
  - "Clear all my Langy memory in this project"
- **Verification:** manual end-to-end on the settings page.

### PR-2.6: Lazy retrieval tools (L6)

- **Goal:** `search_traces`, `search_prompts`, `search_past_runs` exist and work.
- **Files:**
  - `langwatch/src/server/routes/langy.ts` — register three new tools
  - Backed by existing services (TraceService, PromptService, etc.) with new search methods if not present
- **Tests:** binds:
  - "Langy retrieves traces via tool, not pre-injection"
- **Verification:** ask Langy "find traces with hallucinations"; tool is called; tool result feeds the answer.

---

## Phase 3 — Mode toggle + hardening (3 PRs, ~1 week)

**Goal:** non-expert/expert toggle works; rate-limit + tool-output validation in place.

### PR-3.1: User preferences

- **Goal:** `LangyUserPreferences` row managed; mode toggle in UI.
- **Files:**
  - `LangyUserPreferencesService` + tests
  - `langwatch/src/server/routes/langy-preferences.ts`
  - `LangySidebar` toggle UI
  - System prompt in chat route reads `mode` and adjusts tone rules
- **Tests:**
  - mode persists across sessions
  - mode flips system-prompt instructions
- **Verification:** toggle expert mode; Langy responses get tighter; refresh page; mode persists.

### PR-3.2: Rate limiting

- **Goal:** per-user-per-project rate limit; per-message tool-call cap.
- **Files:**
  - `langwatch/src/server/middleware/rate-limit-langy.ts` — new
  - Wire into `/api/langy/chat`
  - Use existing Redis if present
- **Tests:** rate-limit unit + integration; ensure 429 with structured error.
- **Verification:** flood the route, get throttled.

### PR-3.3: Tool-output validation + structured errors

- **Goal:** the agent cannot reference IDs it didn't receive from a `list_*` tool in this conversation; routes return structured errors.
- **Files:**
  - `langwatch/src/server/routes/langy.ts` — wrap tool registration with a validator
  - Conversation-scoped ID set tracked in agent state
- **Tests:**
  - tool with hallucinated ID → graceful error result, not crash
  - structured error envelope on all 4xx/5xx
- **Verification:** intentional hallucinated ID test passes.

---

## Phase 4 — Mastra migration (3 PRs, ~1.5 weeks)

**Goal:** the agent loop is owned by Mastra; tools and memory plumbing reuse v2 services.

### PR-4.1: Mastra spike behind a feature flag

- **Goal:** Mastra runs the agent for a small % of internal users; A/B against Vercel AI SDK path.
- **Files:**
  - `langwatch/package.json` — add Mastra
  - `langwatch/src/server/services/langy/mastra-agent.ts` — new agent definition with the 17 tools
  - Feature flag wired into `/api/langy/chat`
- **Tests:** Mastra path emits the same SSE shape as the legacy path; integration test parity.
- **Verification:** flag flip; engineers dogfood for a week.
- **Risks:** Mastra version compatibility / SSE protocol drift. Mitigation: pin Mastra version; feature-flag rollback.

### PR-4.2: Memory primitives via Mastra

- **Goal:** Mastra session/memory abstractions back the L3/L4 reads (still persisting to our Postgres tables via service-layer adapters).
- **Files:** `mastra-agent.ts` updated; adapter functions to bridge Mastra memory ↔ `LangyConversationService` / `LangyProjectMemoryService`.
- **Tests:** parity with PR-2 tests on the Mastra path.
- **Verification:** flag-flipped users see no behavioral change.

### PR-4.3: Cut over + remove legacy path

- **Goal:** Mastra is the only path. Delete the Vercel AI SDK direct usage.
- **Files:** remove legacy code in `langy.ts`; flag retired.
- **Tests:** all existing tests still pass.
- **Verification:** internal soak; then customer rollout.

---

## Phase 5 — Post-turn inline suggestions (2 PRs, ~3-4 days)

**Goal:** Langy emits a one-chip suggestion at the end of relevant turns.

### PR-5.1: System-prompt instruction + structured output

- **Goal:** Langy emits an optional structured `suggestion` part at the end of a response.
- **Files:**
  - System prompt update in `langy.ts` (or Mastra agent)
  - Output validator that ensures at most one suggestion of valid kind
  - Suggestion type defined in shared types
- **Tests:**
  - "Langy emits at most one suggestion per turn"
  - "Suggestion is part of the same turn, not a follow-up"
  - "No suggestion when the previous turn applied a proposal"
- **Verification:** drive Langy through a few flows; observe suggestions appearing where expected.

### PR-5.2: UI rendering + dismissal

- **Goal:** suggestion chips render below assistant messages; Apply/Dismiss/Don't-show-again work.
- **Files:**
  - `langwatch/src/components/langy/SuggestionChip.tsx` — new
  - `LangySidebar.tsx` — render chip below assistant messages
  - `LangyUserPreferencesService` — wire `dismissedSuggestionKinds`
- **Tests:**
  - "Click suggestion to act"
  - "Dismiss a suggestion"
  - "Don't show this kind again"
- **Verification:** manual; suggestions appear, dismissals stick.

---

## Phase 6 — Eval harness + Traces Hour ritual (2 PRs, ~1 week)

**Goal:** real Langy traces can be replayed and graded; weekly ritual runs.

### PR-6.1: Trace replay

- **Goal:** an internal tool that takes a stored Langy conversation and re-runs it against the current agent.
- **Files:**
  - `langwatch/src/server/services/langy/replay.ts` — new
  - CLI script under `langwatch/scripts/langy-replay.ts`
- **Tests:** unit test on the replay function.
- **Verification:** run the script on a known conversation; output diff.

### PR-6.2: Traces Hour dashboard

- **Goal:** internal page surfacing 10 random recent Langy conversations for review.
- **Files:**
  - `langwatch/src/pages/_internal/langy-traces-hour.tsx`
  - Sampling logic in `LangyConversationService`
- **Tests:** sampling is deterministic per seed.
- **Verification:** team uses it weekly; failure modes captured as new `.feature` scenarios.

---

## Cross-cutting work

These don't fit neatly in a phase but happen alongside:

- **Audit logging** — wire each mutation to the existing audit-log infra (start in PR-2.2; complete by PR-2.5).
- **Backup/restore drill** — run a deletion + restore drill once memory is live; verify hard-delete propagates within 30 days.
- **Docs** — update `dev/docs/` with a Langy section linking to `specs/assistant/`.
- **CHANGELOG** — every Langy phase entry merged.

## Estimated total

≈ **6-8 weeks** for all of v2 if one engineer is full-time on it. Roughly:
- Phase 0+1: 1 week
- Phase 2: 2 weeks
- Phase 3: 1 week
- Phase 4: 1.5 weeks
- Phase 5: 0.5 week
- Phase 6: 1 week
- Slack/review/integration: 0.5-1 week

If two engineers work on it, Phase 4 (Mastra migration) blocks parallelism
because everything funnels through the agent runtime.

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-06 | Test the v1 baseline before any new behavior | Regression net beats clever new code |
| 2026-05-06 | Mastra migration in Phase 4 (after memory ships on the existing path) | Don't migrate runtime and add features simultaneously |
| 2026-05-06 | Bootstrap as a project-creation hook, not lazy first-open | UX magic of being prepared |
| 2026-05-06 | Phase 5 is post-turn only; no worker | Architectural simplification |
| 2026-05-06 | Phase 6 dogfood ritual is shipped as a real feature | Eval signal compounds; only happens if it's a feature, not a calendar reminder |

## Open questions

1. Who does the design pass on the Recent conversations UI and the settings
   page? Worth pairing with a designer before PR-2.3.
2. Is there an existing project-creation hook (Phase 2.4 dependency)? If not,
   that becomes a sub-task within PR-2.4.
3. Can we get internal usage on Mastra via a flag for at least 2 weeks before
   cutover? Affects Phase 4 timeline.
