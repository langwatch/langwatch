# Langy v2 — Product Requirements Doc

> Status: **Draft for alignment**
> Owner: aryan@langwatch.ai
> Last updated: 2026-05-06
> Related PR: [#3211 — feat(sage): in-product AI assistant with propose-apply pattern](https://github.com/langwatch/langwatch/pull/3211)

This doc defines the vision, scope, and non-goals for Langy v2. The behavioral
contract lives in `specs/assistant/*.feature`. Implementation lives in
`langwatch/src/components/langy/` and `langwatch/src/server/routes/langy.ts`.

---

## 1. Vision

Langy is the AI assistant for LangWatch. Its job is to make the platform easy
to use and easy to implement for people who are not LLM engineers. It helps
non-technical users understand what is happening in their LLM systems, make
the right changes safely (via propose-apply), and get nudged toward the next
useful step.

Langy is a **single-loop agent** with a curated tool surface. It is not a
multi-agent orchestrator. It is not a general-purpose chatbot. It is a
LangWatch-shaped colleague that knows the product cold and explains it in
plain language.

North-star reference: PostHog AI. One agent, many surfaces, streamed visibility
into every tool call, project-level memory file, evals driven by real
production traces (not synthetic suites).

**Engineers are not the primary user of Langy.** Engineers will reach for the
MCP server, the CLI, or Claude Code in their editor. Langy must remain useful
to them, but is not optimized for them. Wherever a design tension emerges
between "fast for engineers" and "approachable for non-technical users",
Langy resolves toward the latter.

---

## 2. Personas

| Persona | Rank | Why they use Langy |
|---|---|---|
| **PM / non-technical operator** | Primary | Drive LangWatch without writing code — understand traces, set up evaluators, run experiments, ship LLM features safely. Needs plain-language explanations, no jargon, no JSON. |
| **Founder / solo dev** | Secondary | Onboarding to LangWatch for the first time, needs Langy to teach the platform as they go |
| **LLM Ops engineer** | Tertiary | Quick spot-checks inside the product. For deep work they use the MCP server, CLI, or Claude Code in their editor — not Langy. |

**Implications of putting non-technical operators first** (these flow into
goals, tool design, and UX in later sections):

- Plain-language tone: no "evaluator schema", "tool call", "tRPC mutation", "tracing span"
- Proposal cards explain *what will change for the user* before any config detail
- Errors are written for humans ("I couldn't find that experiment") not stack traces
- Langy actively *teaches* LangWatch concepts as it works (a glossary tool / inline definitions)
- Read-only safety net matters more — non-technical users are more vulnerable to bad mutations, so destructive proposals require an extra confirmation
- Visual output beats text dumps — tables, charts, before/after diffs, not JSON
- Engineers' workflows (MCP, CLI, Claude Code) are explicit non-goals here

---

## 2a. Design principles

Tiebreakers when the team disagrees. Read these before any non-trivial design call.

1. **Trust above all.** The minimum trust bar of the product is sacred. A bad answer
   that looks confident is worse than no answer. A misleading chart is worse than no
   chart. Anything that erodes trust takes precedence over speed, polish, or
   ambition.
2. **Plain language by default; expert mode is one toggle away.** Default to
   explanation, confirmations, visual output. A single toggle flips Langy into
   expert mode: terse, raw, fewer confirmations. Engineers stay in flow; non-
   technical users stay safe.
3. **Propose, never apply unilaterally.** Mutations always go through a proposal
   the user must accept. Destructive proposals require an extra confirmation.
4. **Reuse, don't rebuild.** Charts come from the existing analytics components.
   Mutations go through existing services. Auth/permissions go through existing
   middleware. Langy is a new surface, not a parallel platform.
5. **Single loop, not multi-agent.** One agent keeps full context and switches
   modes (PostHog's lesson). Sub-agents are a non-goal.
6. **Memory must be visible and editable.** Anything Langy remembers must be
   inspectable on a settings page with one-click delete. Hidden memory is hostile.
7. **Dogfood with engineers.** PostHog's quality compounds because engineers use
   their own AI daily. We do the same. Non-technical UX rises *because* technical
   bar is met, not in spite of it.
8. **Lenses must never lie.** When v3 ships generative views, accuracy of the
   visualization is the gating criterion. A wrong lens kills trust faster than a
   wrong sentence.

---

## 3. Current state (v1, what's on this branch)

- Mounted globally on all `/[project]/*` routes via `DashboardLayout`
- Hono route at `/api/langy/chat`, Vercel AI SDK `streamText`, hardcoded `openai/gpt-5`
- 17 tools: read state (evaluators, prompts, datasets, workbench, failing rows) + 10 `propose_*` mutations
- Propose-apply pattern: tool returns a `LangyProposal`; UI shows Apply/Discard; per-page handlers map to tRPC mutations
- No conversation persistence; no project memory; no proactive suggestions
- All queries scoped by `projectId`; `hasProjectPermission(... "evaluations:view")` gate at route entry
- **No tests exist for the feature.** A spec was claimed to exist but does not.

---

## 4. Goals (v2)

1. **Memory: cross-session conversation history (L3) + project knowledge file (L4).** Editable, scoped per-user-per-project.
2. **Post-turn inline proactive suggestions.** Langy emits an optional "next step" chip at the end of each assistant turn (see §7). No background worker.
3. **Mode toggle.** Default = non-expert (plain language, confirmations, visual). Expert = terse, raw, fewer confirmations. Destructive ops always confirm regardless of mode. Per-user preference, persisted.
4. **Default-provider integration.** Langy uses the project's configured default LLM provider — no hardcoded fallback. If no model is configured, the route returns a clear "configure a model first" error.
5. **OSS-included with BYO keys.** Langy ships in self-hosted LangWatch. Customers bring their own API credentials, same as the rest of the platform.
6. **Self-observability (dogfood).** Every Langy LLM call is itself a trace in a dedicated LangWatch project. We dogfood our own observability on our own product.
7. **Evaluation harness.** A way to replay real Langy traces and grade them. Weekly review ritual ("Traces Hour").
8. **Tests.** Every scenario in `specs/assistant/*.feature` has a binding test.
9. **Framework migration to Mastra** — gain sessions, memory, workflows, evals natively. Keep the 17 tools.
10. **Hardening** — rate limit, tool-output validation, structured error surfaces.

## 5. Non-goals (v2)

- ❌ **Lenses / generative UI** — deferred to v3 (see §10)
- ❌ Multi-agent orchestration / sub-agents (PostHog's lesson — single loop)
- ❌ Episodic memory (auto-extracted "facts about the user") — defer to v3
- ❌ Pre-injecting semantic retrieval — make it a tool the agent calls
- ❌ Gemini/Vertex/ADK migration
- ❌ Voice / multimodal input
- ❌ Public API for Langy (it stays first-party)

---

## 6. Memory model

```
┌────────────────────────────────────────────────────────────────────────┐
│  Tier  │ Description                              │ v1 │ v2 │ v3+      │
├────────┼──────────────────────────────────────────┼────┼────┼──────────┤
│  L1    │ Within-turn (system prompt + tool calls) │ ✅ │ ✅ │ ✅       │
│  L2    │ Within-conversation history              │ ✅ │ ✅ │ ✅       │
│  L3    │ Cross-session history (per user/project) │ ❌ │ ✅ │ ✅       │
│  L4    │ Project knowledge file (editable)        │ ❌ │ ✅ │ ✅       │
│  L5    │ Episodic memory (auto-extracted facts)   │ ❌ │ ❌ │ explore  │
│  L6    │ Semantic retrieval (lazy, tool-driven)   │ ❌ │ ✅ │ ✅       │
│  L7    │ Per-project vector embeddings            │ ❌ │ ❌ │ deferred │
└────────────────────────────────────────────────────────────────────────┘
```

### L3 — cross-session conversation history

- Persist `(projectId, userId, conversationId, messages, createdAt, updatedAt)`
- **Scoped per-user** — one user's chats are never visible to another user, even
  in the same project. We may relax to per-team in v3+; for v2 we do not mix.
- **Opt-in "share this conversation with the team"** per-conversation toggle —
  when on, makes a single conversation visible to other members of the project.
  Off by default. Sharing a conversation is logged (audit trail).
- New chat by default; "Recent" list opens a picker (your own + any explicitly
  shared with you).
- Conversations are soft-deletable; hard-delete after 90 days of no activity
  (configurable).
- Stored in Postgres alongside other project data (no new infra).

### L4 — project knowledge file

- One file per project: `LangyProjectMemory`
- **Auto-generated as a background job at project-creation time.** By the time
  the user first opens Langy, the file is already there. No visible "let me
  learn about this project" UX. The magic is in showing up prepared.
- Initial generation reads project state (evaluators, prompts, sample traces if
  any) and produces a thin starter doc. It improves as data accumulates.
- **Refresh** happens on user request (button in settings) or when the file is
  older than 30 days (non-blocking banner offers refresh). User-initiated
  refresh **streams** the regeneration — the user sees Langy compose the new
  doc in real time, builds trust.
- Auto-bootstrap is **silent** (no streaming UI). User-initiated refresh is
  **streaming** (visible composition).
- **Always editable** in a settings page — the user is the source of truth.
  Markdown editor.
- Always injected into the system prompt. Token budget cap: **≤2k tokens for v2**.
  If longer, summarized on read with a cheap model; user always sees the full
  file in settings.
- **Cap revisit trigger:** raise to 4k if (a) median project memory regularly
  exceeds 80% of the 2k cap, or (b) users repeatedly ask Langy to remember
  things that won't fit. Revisit decision at v2.5.

### L6 — semantic retrieval (lazy)

- New tools: `search_traces`, `search_prompts`, `search_past_runs`
- Backed by existing Postgres + ClickHouse data via filtered queries
- Agent decides when to call. Do not pre-inject.

### L7 — per-project vector embeddings (NOT YET IMPLEMENTED, future)

> **Status: deferred. Captured here so we don't paint v2 into a corner.**

A future version of Langy may store **per-project vector embeddings** over
project artifacts (traces, prompts, evaluators, datasets, conversations) so
that semantic similarity search becomes a real tool rather than a keyword
filter. This unlocks:

- "Find traces that look like this failing one" (true semantic similarity)
- "Recall what this user asked about last quarter" (episodic memory L5)
- "Compare projects" (cross-project retrieval, with consent)

Why deferred:
- Adds infra (pgvector, Weaviate, Qdrant, or similar)
- Embedding model choice and chunking strategy are real engineering work
- Quality bar must be earned (a wrong vector match is a confidence trap)
- Current data scale doesn't yet justify it

Pre-conditions for re-evaluation:
- L4 project memory regularly exceeds 4k tokens
- Users start asking time-spanning recall questions ("what did I tell you 3
  months ago about X?")
- We have the eng bandwidth to support a new infra component

When we ship this, the design will be: per-project (one namespace per
projectId), with multitenancy enforced at query time, and never crossing
projects unless an explicit cross-project consent exists. Spec to be written
in a follow-up PRD.

### Memory budget rule

Pinned (system prompt + L4) + recalled (tool results) ≤ 15% of context.
If exceeded, summarize before injecting.

### Privacy & safety

- Settings page: "What Langy remembers about this project"
- One-click clear (per-conversation, per-project, per-user)
- L3/L4 never crosses project or organization boundaries
- All memory writes pass through the same permission middleware as the rest of the app

---

## 7. Proactive suggestions (post-turn inline)

**Architecture:** suggestions are produced **inline by the chat agent at the
end of each assistant turn**. There is no separate cron worker, no background
loop, no "suggestions" table. The agent emits a structured "next step" block
as the last part of its response.

**Why this is the right shape:**
- The agent already has full context (the question, the answer, the project
  memory) — it is the best-positioned thing in the system to know what's next.
- No new infra. No drift between agent's view and worker's view.
- Cheaper: one LLM call produces both answer and suggestion.
- Smarter: suggestions are conversational, not generic ("you said X, so try Y"
  rather than a templated nudge).

**Output shape:**

After answering, Langy may emit zero or one suggestion of the form:

```json
{
  "kind": "suggestion",
  "label": "Add a hallucination evaluator",
  "rationale": "3 rows in this experiment look like fabrications.",
  "actionKind": "open_proposal" | "open_url" | "ask_followup",
  "payload": { ... }
}
```

**UI:** rendered as a single dismissible chip beneath the assistant message.
Click → triggers the action. Dismiss → records the kind in
`LangyUserPreferences.dismissedSuggestionKinds`.

**Rules:**
- Zero or one per turn (never two)
- Suggestions are *suggestions*, not commands — clicking one does not
  auto-apply, it opens the relevant proposal or page
- Dismissible, with "don't show this kind again" memory
- The agent is instructed (via system prompt) to skip suggestions when:
  - The conversation is in active troubleshooting (don't interrupt)
  - The previous turn already resulted in an applied proposal
  - The user explicitly said "stop suggesting things"

**Out of scope (deferred):** page-context proactive nudges that fire without
a user message ("you opened the workbench and 3 rows are failing — want help?").
That would require a different trigger (page view) and re-introduces a
worker-shaped problem. Revisit in v3 alongside lenses if signal demands it.

---

## 8. Architecture & framework

### Decision: Mastra, not Google ADK

- ADK-JS is real but Google-flavored; most value (Vertex Agent Engine, Cloud Trace, A2UI) is GCP-locked. We deploy to our own K8s.
- ADK-Python adds a TS↔Python boundary for features Mastra has natively in TS.
- Mastra: TS-native, sessions/memory/evals/workflows on top of the same Vercel AI SDK primitives we already use.

### Target topology

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (Next.js)                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  LangyContext + LangySidebar                               │ │
│  │  - chat UI, proposal cards, stop button                    │ │
│  │  - per-page proposal handlers                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                          │ POST /api/langy/chat (SSE)            │
└──────────────────────────┼───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  langwatch (Hono route in Next.js)                               │
│  - auth + projectId + permissions guard                          │
│  - delegate to Mastra agent                                      │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Mastra agent: "langy"                                           │
│  - tools (17 → grow over time)                                   │
│  - memory: Postgres-backed sessions + project memory file        │
│  - evals harness (replay traces)                                 │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Provider via getVercelAIModel(projectId, model)                 │
│  - default: project-configured model, fallback openai/gpt-5      │
└──────────────────────────────────────────────────────────────────┘

(separate process, cron-driven)
┌──────────────────────────────────────────────────────────────────┐
│  langy-suggestions worker                                        │
│  - per-project tick: scan recent state → produce 0-1 suggestion  │
│  - writes to Postgres; UI polls or subscribes                    │
└──────────────────────────────────────────────────────────────────┘
```

K8s deployment is a *milestone*, not a v2 requirement. The Mastra agent runs
in-process inside the Next.js app for v2; we extract it to its own service
when (a) we need it scaled independently, or (b) it gets in the way of the
main app's deploy cadence.

---

## 8a. Lenses (v3 — captured here so the v2 design does not paint us into a corner)

A **lens** is an ephemeral, agent-rendered view of LangWatch data tailored to the
current question. Langy uses *existing* LangWatch analytics components (charts,
tables, trace lists) and assembles them as a one-shot view inside the chat.

### Examples

| Lens | Trigger | What renders |
|---|---|---|
| Trace lens | "Show failing traces last hour" | Filtered trace list + summary stats |
| Evaluator preview | "If I added this evaluator, what would my last 100 traces look like?" | Side-by-side: current vs hypothetical |
| Comparison | "Compare prompt v2 vs v3" | Diff + metric deltas |
| Cohort | "Show me Stripe's traces from this week" | Filtered slice |
| Health | "Is anything breaking right now?" | Langy picks the relevant charts itself |

### Rendering rules

- Lenses render **inside the chat panel**. The chat expands horizontally to fit
  the lens; the conversation stays visible above. The user can scroll back to
  prior messages without losing the lens.
- Lenses **reuse existing analytics components** — no parallel chart system.
- Lenses are **ephemeral by default** (they vanish when the conversation is closed).
- "Pin this lens" is an explicit one-click action that saves the lens.

### Save model — open question for v3

Two options, decision deferred:

- **(a) Per-section pinned lenses** — lens saved to the section it relates to
  (experiments has its own pinned lenses, evaluations has its own, traces has
  its own). Matches existing "saved view" patterns. Discoverable in context.
  *Recommended.*
- **(b) Global Lenses page** — separate top-level area for pinned lenses.
  Simpler conceptually, but adds a new navigation primitive and divorces the
  lens from where it's useful.

### What lenses are NOT

- Not workspaces. A lens answers one question.
- Not mutations. A lens shows; it never changes data.
- Not infinite. A lens has a token / row budget. If the slice is too big, Langy
  asks the user to narrow it.

### Why deferred

Lenses are generative UI. That is materially harder than chat: every lens type
is a new surface, accuracy of the visualization is the trust bar, and bad
lenses kill trust faster than bad sentences. We earn the right to ship lenses
by getting memory and proactive suggestions solid first.

---

## 9. Safety & multitenancy

- Every tool reads/writes through the existing service layer (no direct Prisma in tools)
- `projectId` filter on every query (CLAUDE.md rule, enforced)
- Tool output validation: if the agent passes back an evaluator ID it didn't receive from a `list_*` tool in this conversation, reject
- Rate limit per (userId, projectId): N messages per minute, M tool calls per message (`stepCountIs(8)` already exists; pair with a Redis counter)
- Destructive proposals (delete, archive) require an explicit confirmation step in the UI — already in place via `destructive: true` flag

---

## 10. Evaluation strategy

- Every Langy conversation is a trace in LangWatch (dogfood)
- Weekly **Traces Hour**: 30 min reviewing 10 random conversations from the past week, tag failure modes
- Failure modes feed back as scenarios in `specs/assistant/*.feature`
- Synthetic evals are nice-to-have, not the primary signal (PostHog's lesson)

---

## 11. Phasing

### v2

**Phase 1 — Foundations (test what already exists)**
- Write `.feature` files for the v1 baseline behavior ✅ (done in this PRD round)
- Bind tests to baseline scenarios; CI green
- No new behavior

**Phase 2 — Memory**
- L3 cross-session conversation history (UI + storage)
- L4 project memory file (init flow + edit page + injection)
- Settings page for "what Langy remembers" with one-click delete
- Lazy semantic retrieval tools (search_traces, search_prompts, search_past_runs)

**Phase 3 — Mode toggle + hardening**
- Per-user expert/non-expert preference
- Tone + confirmation rules per mode
- Rate limits, model-per-project, tool-output validation

**Phase 4 — Mastra migration**
- Move agent loop into Mastra
- Reuse memory primitives from Mastra where they fit
- Keep all 17 tools intact

**Phase 5 — Post-turn inline suggestions**
- System-prompt instruction to emit zero-or-one suggestion at end of turn
- UI: dismissible chip beneath each assistant message
- Dismissal memory in `LangyUserPreferences.dismissedSuggestionKinds`
- (No worker, no cron — entirely inside the chat loop)

**Phase 6 — Eval harness**
- Trace replay
- Traces Hour ritual

### v3

**Phase 7 — Lenses (generative UI)**
- Inline rendering inside expanding chat panel
- Reuse existing analytics components
- Pin/save model (per-section vs global — decide at start of v3)
- Trust gate: accuracy benchmarks before public ship

**Phase 8 — Episodic memory** (only if v2 memory is solid and there's signal it's needed)

K8s extraction of the agent loop: only when justified by independent scaling
needs or deploy-cadence friction. Not before.

---

## 12. Open questions (need your input)

All v2-scope questions are answered. Captured in §13.

Decisions made through this PRD discussion:
- ~~Vision framing~~ → "AI assistant for LangWatch", PM-first with expert toggle
- ~~Lenses scope~~ → v3, render in-chat with expanding panel, reuse analytics
- ~~Mode toggle~~ → yes, v2; destructive ops confirm regardless of mode
- ~~Dogfood approach~~ → engineers first (PostHog model)
- ~~Buyer profile~~ → mix of all three; Langy must demo well to all
- ~~Per-user vs per-project memory~~ → per-user, with opt-in conversation share
- ~~L4 size cap~~ → 2k for v2; revisit trigger documented in §6
- ~~Default model~~ → project's configured default; clear error if none
- ~~Proactive suggestion shape~~ → post-turn inline, no worker
- ~~OSS / self-hosted~~ → included, BYO API keys
- ~~Self-observability~~ → yes, dogfood Langy on Langy

---

## 13. Non-decisions captured (for posterity)

- We considered Google ADK and rejected it — see §8
- We considered LangGraph-JS and deferred — only revisit if we need durable resumable branching workflows
- We considered episodic (L5) memory and deferred to v3
- We considered making Langy multi-agent and rejected — single loop, switch_mode-style scaling
- We considered lenses for v2 and deferred to v3 — memory + proactive must be solid first
- We considered global "Lenses" navigation and lean toward per-section pinned lenses (decision deferred to v3 kickoff)
- We considered building Langy primarily for engineers and rejected — engineers use MCP/CLI/Claude Code; Langy targets non-technical operators with an expert-mode escape hatch

---

## 14. References

- PostHog AI architecture: https://posthog.com/handbook/engineering/ai/architecture
- PostHog: 8 learnings from 1 year of agents: https://posthog.com/blog/8-learnings-from-1-year-of-agents-posthog-ai
- PostHog: building AI features: https://posthog.com/newsletter/building-ai-features
- Google ADK: https://adk.dev/
- Mastra: https://mastra.ai
