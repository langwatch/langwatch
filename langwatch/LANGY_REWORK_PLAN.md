# Langy event-sourcing rework — remaining plan

Working plan for `feat/langy-rework`. Consolidates the earlier step plan, the
new turn-projection data-model decision, the new streaming shape, the Go
self-drive migration, progressive rendering, the service/repository cleanup, and
the GitHub-flow rewrite. This is the source of truth for "what's left"; update it
as steps land.

---

## Where things stand

| Commit | What |
|--------|------|
| `4f292b28d` | **Step T — per-turn fold projection (DONE, verified).** Added `langyConversationTurn` (a second fold over the same aggregate, keyed per `conversationId:turnId`), the repository trio, CH migration `00050`, constants, and pipeline/registry/presets wiring. Fold unit tests + spec. Zero new typecheck errors; langy unit suite green. `QuestionParts` reserved for S2. |
| `12c47e430` | **V — vocabulary rework (DONE, verified).** Renamed the conversation commands/events to the domain scheme, split the single tool-call terminal into `tool_call_succeeded` + `tool_call_failed`. Zero new typecheck errors; langy unit suite green. Specs + Go comment aligned. |
| `0556ff696` | S1a — GitHub credentials moved into app-layer service/repo/client. |
| `177f1df5a` | Browser transport migrated to tRPC `langy.onTurnStream`; Hono streaming + fast lane deleted. |
| `068c7faa5` | `langy.onTurnStream` tRPC subscription (durable-buffer relay). |
| `f7d65e63b` | Durable HTTP-final turn ingest + agent finalizer + progress heartbeat. |

### Vocabulary (current, post-V)

| Command (imperative) | Event (past tense) |
|----------------------|--------------------|
| `ContinueConversation` | `conversation_continued` |
| `CreateAgentResponse` | `agent_response_started` |
| `InitiateToolCall` | `tool_call_initiated` |
| `SucceedToolCall` | `tool_call_succeeded` |
| `FailToolCall` | `tool_call_failed` |
| `FailAgentResponse` | `agent_response_failed` |
| `RecordAgentResponse` | `agent_responded` |
| kept | `conversation_archived`, `conversation_metadata_updated`, `conversation_handoff_pending/consumed`, `conversation_title_generated` |
| ephemeral (not commands) | `status_reported`, `progress_reported` (Redis buffer only, never durable) |

Deferred out of V to S2: `CreateConversation` / `conversation_started` (that's
S2's headline — no producer or test exists for it yet, so it stays out until the
conversation service is built).

---

## The data-model decision (NEW) — a turn is a second projection

**One aggregate, two fold projections.** The conversation stays a single
event-sourced aggregate (`langy_conversation`, `aggregateId = conversationId`,
`TenantId = projectId`). We add a **second fold projection** over the *same*
event stream that folds each turn into its own document.

- `langyConversationState` (exists) — one document **per conversation**: the
  spine (owner, title, status, counts, activity, sharing, handoff, archived).
  Table `langy_conversations`.
- `langyConversationTurn` (**new**) — one document **per `(conversationId,
  turnId)`**: the whole turn folded into its final render state.

These are two *projections of one aggregate*, not two aggregates. They read the
same events and key their stored document differently. "interaction / tool-call /
card" are **events**, not aggregates.

### Why this is feasible (framework already supports it)

- `AbstractFoldProjection` exposes an optional `key?: (event) => string` — "custom
  key extractor for cross-cutting projections."
- The executor uses `const key = context.key ?? context.aggregateId`
  (`foldProjectionExecutor.ts`), and the router wires `groupKeyFn: fold.key`
  (`projectionRouter.ts`). So a fold whose `key(event)` returns
  `` `${conversationId}:${turnId}` `` stores/loads **one document per turn**.
- Precedent for a composite aggregate key: `experiment-run-processing`
  (`makeExperimentRunKey(experimentId, runId)`).
- We do **not** need a parent-sync reactor (the `suiteRunSync.reactor` pattern):
  because it's the same aggregate + same stream, the conversation spine already
  sees every event. No cross-aggregate bridge.

### The turn document (what folds into it)

| Field | Source event(s) |
|-------|-----------------|
| `Status` (`pending`/`running`/`completed`/`failed`) | `agent_response_started` → running; `agent_responded` → completed/failed; `agent_response_failed` → failed |
| `QuestionParts` | `conversation_continued` (needs a shared `turnId` — see below) |
| `AnswerParts` | `agent_responded` (text + tool-output cards + **enrichment card** + **actions** already ride here as parts) |
| `ToolCalls[]` (lifecycle: `toolCallId`, `toolName`, `command`, `input`, `status`, `durationMs`, `errorText`) | `tool_call_initiated` (push), `tool_call_succeeded`/`tool_call_failed` (resolve) |
| `Error` | `agent_responded` (failed) / `agent_response_failed` |
| `StartedAt` / `EndedAt` / timestamps | lifecycle events |

**Rendering = read one turn document.** Clicking a card that triggers an action
happens inside that view; the actions live in `AnswerParts`, so the turn doc is
self-contained.

**Question folding depends on a shared `turnId`.** Today `turnId` is minted at
`startTurn` (after the user message). To fold the question into the turn, the
user message and the agent response must share a `turnId`:
- add optional `turnId` to `conversation_continued`'s schema,
- have S2's `continueConversation` mint the `turnId` and pass it to
  `createAgentResponse` (one turn = one user question + the agent's full response).
Until S2 wires that, the turn fold populates everything except `QuestionParts`
(the answer parts already make it renderable), so the turn fold can land first.

### Persistence + wiring (mirror the conversation-state trio)

- **Migration** `00050_create_langy_conversation_turns.sql` — `ReplacingMergeTree(UpdatedAt)`,
  `ORDER BY (TenantId, ConversationId, TurnId)`, rich fields (`QuestionParts`,
  `AnswerParts`, `ToolCalls`) stored as JSON strings like `langy_messages.Parts`.
- **Repository trio** under `.../langy-conversation-processing/repositories/`:
  `langyConversationTurnState.repository.ts` (interface),
  `.memory.repository.ts`, `.clickhouse.repository.ts`. Add a
  `makeConversationTurnKey(conversationId, turnId)` helper (+ parse) mirroring
  `makeExperimentRunKey`.
- **Constants**: `LANGY_CONVERSATION_PROJECTION_VERSIONS.CONVERSATION_TURN` +
  `LANGY_CONVERSATION_TURN_STATUS`.
- **Pipeline**: a second `.withFoldProjection("langyConversationTurn", …)` (the
  builder holds folds in a Map — multiple are supported).
- **Registry**: build the turn fold store via `RepositoryFoldStore` (cached),
  parallel to `langyConversationStateFoldStore`.
- **Presets**: add `repositories.langyConversationTurnState` (clickhouse vs
  memory on `clickhouseEnabled`), same as `langyConversationState`.
- **Read path**: a repository + app-layer read method (`getTurn` / `listTurns`),
  surfaced through the conversation service — never read from a route directly.
- **Tests**: fold unit tests (lifecycle → document), repository memory tests.
- **Spec**: add a "turn folds into one render document" scenario to
  `specs/langy/langy-event-sourced-conversations.feature`.

---

## Remaining steps (ordered)

### Step T — Turn fold projection ✅ DONE (`4f292b28d`)
Built the `langyConversationTurn` fold + persistence + wiring + tests + spec.
Folds the agent-side lifecycle; `QuestionParts` lights up once S2 shares the
`turnId`. Verified: typecheck + unit.

### S2 — Conversation service + tRPC + per-turn key + inline dispatch

**Decisions (Alex):** (1) conversation creation is an **explicit
`conversation_started` event** + `CreateConversation` command (not implicit in the
first message); (2) per-turn key is **ephemeral, hash-only** (mint → hand to agent
→ forget plaintext; no stored plaintext; S4 deletes the `ProjectSecret`
`langy_api_key_secret`); (3) drive the whole of S2, landing it in verifiable
commits (pause noted at the auth change).

Increments:
- ✅ **A** conversation_started + CreateConversation — `f5abf16c1`.
- ✅ **B** question folds into the turn — `f5abf16c1`. `agent_response_started`
  carries optional `questionParts`; the turn fold folds them into `QuestionParts`
  (chosen over keying the turn fold on `conversation_continued.turnId`, which
  would mint a garbage `conv:` turn doc for any turnless message). `startTurn`
  threads `questionParts`.
- ⬜ **C** lift the ~530-line turn-start pipeline out of `routes/langy.ts`
  (`POST /langy/chat`, lines 372–948) into an app-layer method. This is a DI
  refactor, not a copy: the route today reaches directly for `process.env`
  (`OPENCODE_AGENT_URL`, `LANGY_INTERNAL_SECRET`), `prisma`, `connection`
  (Redis), `LangyCredentialService`, `reserve/releaseLangyGithubPrPermit`, the
  route-local `probeLangyWorker`/`warmLangyWorker`, `getVercelAIModel`,
  `createLangyTurnAccessStore`, `createLangyTurnHandoffStore`. The service method
  must take these as **injected ports** (credential resolver, permit store,
  worker warm/probe port, access store, handoff store, model resolver), returning
  `{conversationId, turnId}` or a `DomainError`. The route keeps only Phase 1
  (session auth, demo gate, rate limit, body zod) + HTTP-status mapping.
  **Order preserved exactly** (it is load-bearing): gate → phase-2 parallel
  (conversation/model/credentials/egress) → conversation-scoped reads (busy-guard
  + handoff) → modelOverride allowlist → probe-then-mint → PR-permit reserve →
  warm → busy-guard 409 → stash access+handoff → await message → dispatch → consume
  handoff. **Real verification needs Redis + the agent + a session — typecheck +
  unit only locally.**
- ⬜ **D** tRPC mutations (`api.langy.createConversation` / `continueConversation`)
  + warm-on-entry; transport calls `getApp().langy.*` only. Route `/langy/chat`
  becomes a thin shim or is retired.

  **`createConversation` and `continueConversation` are the SAME operation
  (Alex).** Both take `{ messages/parts, context (project / trace / pageContext /
  skills), modelOverride }` → record the user message + drive the turn (the whole
  C pipeline). `create` differs only in that it is *semantically first*: it mints
  the conversationId and emits `conversation_started` before the message. So
  `createConversation` = `[conversation_started] + continueConversation`. The
  `conversation_started` event stays lean (owner/title); the first message rides
  `conversation_continued`; context + modelOverride ride the turn (handoff +
  `agent_response_started.questionParts` + system block), exactly as the route
  does now. The thin `service.createConversation` landed in A becomes the internal
  "emit conversation_started" step of this fuller entrypoint.
- ✅ **C** turn-start pipeline lifted into `LangyTurnService` — `bb5146bbb`.
  Injected ports, exact ordering preserved, DomainError→HTTP in the thin route,
  worker probe/warm → `services/langy/langyWorker.ts`, service unit test locks the
  invariants. **Runtime (Redis+agent+session) NOT exercised locally — review gate.**
- 🟡 **E** per-turn ephemeral key — **already satisfied for the session key.**
  `mintLangySessionApiKey` mints via `ApiKeyService.create` (hash-only; the
  plaintext is unrecoverable after the call) and hands the plaintext to the agent
  via the handoff/credentials. No stored session-key plaintext. The *remaining*
  vestigial plaintext is the eager per-project key in `ProjectSecret
  langy_api_key_secret` (written by `provisionLangyApiKey`, read by
  `getLangyApiKeyToken`) — deleting that + dropping the project-key fallback in
  `getOrProvision` is **S4** and runtime-sensitive (the manager's key-reuse on a
  probe hit must be confirmed against the live agent).
- ⬜ **D** tRPC mutations `api.langy.createConversation` / `continueConversation`
  wrapping `getApp().langy.turns.startConversationTurn` (create additionally
  emits `conversation_started`). Must carry Phase-1 rate-limiting
  (`checkLangyMessageRateLimit`) that the Hono route does, map DomainError→
  TRPCError, then migrate `langyChatTransport` off `fetch("/api/langy/chat")` to
  the mutation and retire/shrink the route. **Browser-facing — typecheck-able but
  not runtime-verifiable locally.**
- ⬜ **F** optimistic inline agent dispatch (latency) alongside the `spawnAgent`
  reactor backstop, both idempotent on `turnId`. **Runtime-sensitive** — depends
  on agent-side turnId idempotency; risky without the live agent.

**State:** A, B, C landed and verified (typecheck + unit). E already holds for the
session key. D and F remain and are browser/runtime-gated — do them where Redis +
the agent + a browser session are available.

- `LangyConversationService.createConversation` / `continueConversation` /
  `listConversations` / `getConversation` (+ `getTurn` / `listTurns` from Step T).
  Adds `CreateConversation` / `conversation_started` (the deferred vocabulary).
- Lift the ~530-line turn-start pipeline out of `routes/langy.ts` into the service.
- Mint the `turnId` at `continueConversation` and thread it to
  `createAgentResponse` so the question folds into the turn (Step T dependency).
- Warm the agent at tRPC entry; real dispatch at the command.
- **Per-turn ephemeral API key**: mint → hand to the agent → forget the plaintext
  (hash-only in `ApiKey`). Replaces any stored key.
- Optimistic inline agent call (latency) + `spawnAgent.reactor` backstop; both
  idempotent on `turnId`.
- Transport only calls `getApp().langy.*`. **Verifiable here:** typecheck + unit.

### S3 — Go self-drive + deletions + reactor renames
- The Go agent (`services/langyagent`) becomes the sole driver: writes the token
  buffer, owns the heartbeat, decodes the envelope, POSTs the durable final to
  the `langy-internal` ingest (idempotent on `turnId`).
- **Delete**: `runTurn`, `langy-worker-pool.ts`, `langy-turn-recovery.ts`,
  `langy-turn-reconciler.ts`, `langy-turn.processor.ts` (+ their tests).
- **Rename** the liveness reactor `reconcileAgentTurn.reactor` →
  `agentTurnLiveness.reactor` (and the `reconcileAgentTurnReactor` dep / registry
  wiring). Note the fold/service already speak `failAgentResponse`.
- **Verifiable here:** `go build` / `go test` + typecheck only — **not**
  end-to-end / browser.

### S4 — Progressive rendering + cleanup + PR
- Emit `tool_call_*` per-call **as they land** (no batching to turn-end),
  interleaved. UI renders each the moment it arrives.
- Render **special cards** distinct from a plain tool call: Langy enrichment card,
  PR card, trace download-bar, previews, link-outs.
- **permit-release reactor** (release the per-turn permit/slot on terminal).
- Delete the vestigial `ProjectSecret` `langy_api_key_secret` (superseded by the
  S2 per-turn key).
- Draft the PR.
- **Verifiable here:** partial — browser render unverified locally.

### #24 — GitHub flow rewrite (LAST)
- Ground-up rewrite of OAuth + credentials: inject redis/crypto as deps (no
  module-level connection), domain errors around token-invalid / malformed, zod
  validation, better popup HTML.
- Move `isOrganizationMember` / `findFirstAdminUserId` off the github-creds repo.
- Delete the interim `services/langy/langyGithub*` modules.
- **Verifiable here:** typecheck + unit.

---

## Cross-cutting requirement — service/repository discipline

Every new surface added by the steps above must follow the layering (see
`CLAUDE.md`):
- **Routes → service → repository.** Routes never import or instantiate
  repositories and never hold business logic (validation/guards live in the
  service). tRPC/Hono transport calls `getApp().langy.*` only.
- **Naming**: repositories use `findAll` / `findById`; services use `getAll` /
  `getById`. The turn read path is `repository.findTurn…` → `service.getTurn…`.
- **The turn fold is read through a repository + the conversation service**, never
  queried inline from a route or component loader.
- Prisma queries always carry `projectId`; ClickHouse queries always filter
  `TenantId` first and prune on the partition key.

---

## New streaming model (context for S2–S4)

Two streams per turn (ADR-048), durable path unchanged:
- **Stream A (durable, the truth):** the Redis token buffer bridged to `useChat`,
  the event-sourced **`agent_responded`** final answer, the
  `langy_conversation_updated` broadcast, ephemeral `status_reported` /
  `progress_reported`. Survives refresh (the buffered tail is resume state).
  Transport: tRPC `langy.onTurnStream` (durable-buffer relay); Hono streaming is
  already deleted.
- **Stream B (speed, ephemeral):** raw agent text-delta tokens over per-turn Redis
  pub/sub, for latency.

Progressive events flow OUT interleaved and **never batched to turn-end**:
`conversation_continued → agent_response_started → tool_call_initiated →
tool_call_succeeded | tool_call_failed → … → agent_responded`. The turn fold (Step
T) turns that stream into one render document; the map projection
(`langy_messages`) keeps per-message rows for history text.

---

## Target architecture (updated with the turn fold)

```
 BROWSER (AI-SDK ChatTransport)
     │  api.langy.createConversation / continueConversation   (tRPC mutation)
     │      └─ warms agent on entry ─────────────┐
     ▼                                            ▼
 LangyConversationService (app-layer/langy)   [agent warm pool]
     │  mint per-turn ephemeral key (hash-only in ApiKey)
     │  mint turnId at continueConversation, thread to createAgentResponse
     │  dispatch command (idempotent on turnId)
     ▼
 event-sourcing: langy-conversation-processing  (ONE aggregate: langy_conversation)
     │
     ├─ command ─► EVENT LOG ─┬─► fold: langyConversationState   (per conversation — spine)
     │                        ├─► fold: langyConversationTurn     (per conversationId:turnId — render doc)  ◄── NEW
     │                        └─► map:  langyMessageStorage        (per message — history text)
     │                 │
     │                 ├─► spawnAgent.reactor ──────────► GO AGENT (self-drives)
     │                 │        (backstop dispatch)        • writes token buffer
     │   optimistic ───┘                                    • owns heartbeat
     │   inline call (latency) ─────────────────────────►   • decodes envelope
     │                                                       • POSTs durable final
     ├─ agentTurnLiveness.reactor  (per-turn stall timer)         │
     │                                                    routes/langy-internal.ts
     └─ events stream OUT progressively ◄───────────────────  (ingest, idempotent)
             conversation_continued
             agent_response_started
             tool_call_initiated ───┐  each emitted the moment it happens,
             tool_call_succeeded ───┤  interleaved, NEVER batched to turn-end
             tool_call_failed ──────┘  → turn fold accretes → UI renders as they land:
             agent_responded            plain tool · PR card · Langy card ·
                                        trace download-bar · preview · link-out

 DELETED in S3:  runTurn · langy-worker-pool · langy-turn-recovery ·
                 langy-turn-reconciler · langy-turn.processor
```

---

## Verification per step

| Step | Local verification | Not verifiable locally |
|------|--------------------|------------------------|
| V | ✅ typecheck + unit (done) | — |
| T (turn fold) | ✅ typecheck + unit | — |
| S2 | ✅ typecheck + unit | — |
| S3 | ⚠️ `go build`/`go test` + typecheck | end-to-end / browser |
| S4 | ⚠️ partial | browser render |
| #24 | ✅ typecheck + unit | — |
