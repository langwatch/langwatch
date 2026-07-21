# Langy event-sourcing rework — remaining plan

Working plan for `feat/langy-rework`. Consolidates the earlier step plan, the
new turn-projection data-model decision, the new streaming shape, the Go
self-drive migration, progressive rendering, the service/repository cleanup, and
the GitHub-flow rewrite. This is the source of truth for "what's left"; update it
as steps land.

---

## STATE CONFIRMED (2026-07-12) — one keystone blocks everything: worker self-drive

Verified end-to-end this session (Go build/vet green; TS typecheck clean except the
3 known pre-existing errors; three independent code maps of Go worker / TS control
plane / GitHub flow). **The Go structural rework is DONE. The self-drive is NOT wired.
The two halves do not meet yet.** Concretely:

- **Go signed-frame stack is BUILT but DORMANT.** `internal/frames` (signed union:
  delta/status/progress/heartbeat/card/tool/final/error, each `.Sign()`) and
  `internal/frameauth` (HMAC signer + `MintRunToken`) are cross-language-pinned by
  `specs/langy/langy-frame-auth.vectors.json` — and have **zero live callers**. No
  runToken is ever minted, injected into the manager, or used to sign a live frame.
- **Worker still answers a turn IN-BAND.** `/worker/{create,revive,continue}` →
  `transport/rpc/handlers.go` `chatHandler` → streams **unsigned hand-rolled `langy.*`
  NDJSON** on the HTTP response body (`adapters/opencode/opencode.go`). **Two
  unreconciled frame vocabularies** (live unsigned `langy.*` vs dormant signed
  `internal/frames`). `internal/turnfold` parses the live `langy.*`, not the signed union.
- **No Go→relay push.** The only outbound POSTs from the worker are the **Finalizer**
  (`/api/internal/langy/turn/{turnId}/result`, durable FINAL only) and the **Revoker**.
  Nothing POSTs to `/api/internal/langy/relay/frames`.
- **TS relay is BUILT + MOUNTED but UNFED.** `routes/langy-relay.ts` (POST /relay/frames,
  internal-secret) → `services/langy/streaming/langyTurnRelay.ts` (HMAC-verify → dedup →
  write token buffer + heartbeat). No producer drives it.
- **The LIVE path is still the interim executor.** `spawnAgent.reactor` →
  `LangyWorkerPool.submit` → `runTurn` (`services/langy/execution/langy-turn.processor.ts`,
  1014 LOC) holds the worker response open, reads NDJSON in-band, and is the **sole
  writer** of the Redis token buffer (G1) and the `langy:hb` liveness key (G2). The
  GitHub PR flow is inlined here (G4). Booted from `workers/startWorkers.ts`.
- `reconcileAgentTurn.reactor` **not renamed**. Interim `services/langy/langyGithub*`
  modules are **dead** (self-tests only). tRPC create/continue/onTurnStream +
  `LangyTurnService` + turn fold + runToken column (mig 00051) are all in place.

### The remaining plan, sequenced (each milestone gates the next)

**M1 — SELF-DRIVE keystone (Go + TS). Unblocks all of S3. Build/typecheck-verifiable
here; runtime-gated for the real stream.**
1. *Go runToken lifecycle*: TS passes the per-conversation `runToken` (already server-only
   in CH, `service.getRunToken`) to the manager on the create/continue call; the **manager**
   holds it for the turn and is the SOLE signer (opencode never sees it — see
   `app/agent.go` docstring). Assemble `frameauth.Identity{projectId,userId,conversationId,
   turnId}` on the live path.
2. *Go unify + sign + push*: replace the hand-rolled `langy.*` emission in
   `adapters/opencode/opencode.go` with the `internal/frames` signed union; add a
   controlplane adapter (sibling to Finalizer) that PUSHES each signed `OutputFrame`
   — including first-class `heartbeat` — out-of-band to `POST /relay/frames`. Worker holds
   ONE push connection per turn (LB pins → in-order). `/worker/create` returns an ack; the
   in-band response stream is retired (hard-cut — settled §12). Fold `turnfold` onto the
   signed union (collapses M2 of the review). Panic-guard the push + heartbeat goroutines (H2).
3. *TS relay becomes the live writer*: once Go pushes, `LangyTurnRelay` writes buffer (G1) +
   refreshes liveness from frame freshness (G2). Retire `langy:hb` as a separately-owned key
   (heartbeat = newest stream entry).
4. *TS rewire dispatch*: `spawnAgent.reactor` dispatches the turn to the worker directly
   (POST /worker/create|continue with runToken+prompt+creds, **not** holding the response);
   drop `LangyWorkerPool`/`setPool` late-binding.

**Self-retry recovery reactor (SETTLED with Alex — the point of event-sourcing the turn).**
The `reconcileAgentTurn` reactor (renamed `agentTurnLiveness` in M2) must SELF-RETRY a stalled
turn, NOT terminalize it on first lapse. Mechanism, fully event-sourced: the per-turn liveness
timer fires on a lapsed heartbeat ⇒ emit a durable retry event that increments a `RetryCount` on
the conversation fold and re-arms the timer with a LONGER delay (backoff); a retry reactor
re-drives the turn (re-dispatch, same turnId — safe via the Go `ClaimTurn(turnId)` idempotency,
review "F") and pushes an EPHEMERAL "retrying…" frame to the frontend (buffer/broadcast, never a
durable event). **3 attempts total**: the first two stalls back off + re-drive + emit "retrying";
the **3rd stall gives up** → `failAgentResponse`. Re-drive re-derives the turn inputs from the
event log (durable question in `conversation_continued`/turn-fold `QuestionParts`; session key +
system re-minted) — the single-use handoff is already consumed. Requires Go `ClaimTurn(turnId)` +
a bounded recently-completed set (review "F") so a merely-slow worker never double-runs. Only
re-drive on a genuinely-dead worker (heartbeat lapsed), never on any error.

**STRUCTURE directive (Alex): nothing under `src/server/services/langy/`.** It all moves to
`src/server/app-layer/langy/` (worker port, streaming/relay/buffer/handoff/frame-auth, credential
service, github). Fold the moves into M2/M3/M4 cleanup, keeping routes→service→repository
discipline. New code goes straight into `app-layer/langy/`.

**DISPATCH SITES — SETTLED with Alex (do NOT add a pre-command dispatch).** Three agent
contacts per turn, all sharing the `turnId` so Go `ClaimTurn` collapses them to one run:
(1) **warm** BEFORE the command (safe — Acquire only, never Claim/PostMessage, so it cannot
orphan a turn); (2) the **spawnAgent reactor** dispatch AFTER `agent_response_started` is durably
committed (fire-and-forget OK here — the durable event guarantees the retry backstop exists);
(3) the **self-retry reactor** re-drive. **NO optimistic pre-command inline dispatch** — Alex's
reason: a dispatch before the command is durable has no guaranteed retry, so a lost command
orphans a running agent. Warm hides the cold-start latency instead.

**runToken race FIXED (this session).** The self-drive dispatch needs the runToken, which
`getRunToken` reads off the ClickHouse fold (seconds of projection lag) → a brand-new
conversation's first-turn dispatch would find `null`. Fix: the runToken now rides the **Redis
handoff** — the turn service mints it (new, instant) or reads it (continue, folded into the
parallel Phase-3 reads) and stashes it before the command dispatches; `spawnAgent.reactor` reads
`handoff.runToken` (dropped `getRunToken` dep + the null-skip; registry simplified).
`createConversation` now takes the runToken from the caller. Typecheck clean; turn-service (12) +
relay (15) tests green.

**M2b SELF-RETRY — DONE (this session, typecheck-clean; runtime-gated).** Landed SIMPLER than the
locked design below (Alex steered it): **no dedicated retry event, no fold column, no Redis
counter** — the retry IS the GroupQueue re-firing a reactor that throws. Reactors never fire on
replay/refold, so a throw + a time-based give-up are both safe.
- **The "intentional retry" signal:** `app-layer/langy/langy-turn-retry.error.ts` `LangyTurnDispatchRetry`
  — a plain (non-CRITICAL) Error, so `isRetryableJobError` classifies it RETRYABLE and the queue
  re-stages with exponential backoff up to `JOB_RETRY_CONFIG.maxAttempts`. NO event emitted (replay-safe).
- **spawnAgent reactor:** on a non-accepted dispatch → THROW `LangyTurnDispatchRetry` (was: log +
  give up). Reads the handoff via `read` (peek) not `take`, so the re-fire re-reads inputs. Turn-id
  idempotent (Go ClaimTurn), so a re-fire racing a now-live worker is a benign no-op.
- **reconcileAgentTurn → agentTurnLiveness (renamed + rewritten):** on a stalled turn (heartbeat
  lapsed) it re-drives — read handoff → `worker.dispatch` → ephemeral "Reconnecting…" (`appendStatus`)
  → THROW to re-check via the queue. Give-up is TIME-based: `Date.now() - foldState.LastActivityAt >
  MAX_STALL_MS` (3× heartbeat grace) → `failAgentResponse`. No counter (refold-safe: reactors are
  live-only). Deps gained `worker` + `handoffStore.read`; wired in pipeline.ts + pipelineRegistry
  (`agentTurnLivenessReactor`), old file deleted, comments/refs updated.
- **Handoff `read` (peek):** `LangyTurnHandoffStore.read` added (no delete); spawnAgent + liveness both
  use it so a re-drive reuses the same inputs (300s TTL covers the retry window).
- **G6 428-remint still deferred:** a persistent 428 just exhausts the retries for now.

--- superseded design note (kept for context) ---
**Key constraint found:**
`CreateAgentResponseCommand` is idempotency-keyed `…:turn-start:${turnId}`, so re-emitting
`agent_response_started` to re-drive is a NO-OP (deduped). So the retry needs a DEDICATED event:
- **New event `agent_turn_retry_scheduled`** {conversationId, turnId, attempt} — event type +
  version constant + zod schema + typeguard + `ScheduleAgentTurnRetryCommand` + `.withCommand`
  registration. Fold handler = bump `LastActivityAt` only (NO new column ⇒ NO CH migration; the
  `attempt` rides the event, read from the TRIGGERING event when the delayed timer fires).
- **Rename** `reconcileAgentTurn.reactor` → `agentTurnLiveness.reactor`. Arm on
  `agent_response_started` + `tool_call_*` + `agent_turn_retry_scheduled`. On fire, if heartbeat
  lapsed: `attemptsSoFar = triggering event is retry_scheduled ? event.data.attempt : 0`; if
  `< MAX(2)` → emit `scheduleAgentTurnRetry(attempt=attemptsSoFar+1)` (RE-ARMS the timer, backoff
  via a per-attempt delay if the reactor `delay` can be a fn, else fixed), push an EPHEMERAL
  "retrying…" status frame (`buffer.appendStatus`), and DIRECTLY re-dispatch (`worker.dispatch`,
  reading the handoff); else → `failAgentResponse` (give up). A `tool_call_*` re-arm means progress
  ⇒ attempt resets to 0 (healthy). Reactor deps gain: `worker` (dispatch), `handoffStore` (read),
  `buffer` (appendStatus + liveness), `conversations` (scheduleRetry + failTurn).
- **Handoff peek, not take:** add `LangyTurnHandoffStore.read` (no delete); change `spawnAgent`
  from `take`→`read` so retries reuse the same inputs (TTL 300s covers 3 attempts ~90s). Replay is
  already guarded, so single-use-delete is unnecessary.
- **Credential edge (G6, deferred):** a re-dispatch to a worker whose key was revoked on death
  gets 428; full fix re-mints (`mintLangySessionApiKeyForUser` by userId, re-stash handoff). Until
  then the retry recovers slow-worker (ClaimTurn dedup) + recently-dead-worker-with-valid-key.

**M2 EXECUTION LOG (this session):**
- **M2a DONE (Go `ClaimTurn` idempotency, review F)** — `app.Worker.Claim() bool` →
  `ClaimTurn(turnID) ClaimOutcome` (Granted/AlreadyHandled/Busy). Worker tracks `currentTurnID`
  + a bounded (64) FIFO recently-completed set; same in-flight turnId or recently-completed →
  benign no-op (StartTurn returns a no-op runner → 202), different turn → busy (409), empty turnId
  degrades to the boolean guard. Makes the self-retry re-drive safe (a slow worker never
  double-runs). `claim_turn_test.go` + updated pool/app/transport tests; full module green.
- **M2b DONE** — self-retry (throw-to-retry via the GroupQueue; see the M2b section above).
- **M2c DONE** — deleted the dead interim executor: `langy-turn.processor` (runTurn), `langy-worker-pool`,
  `langy-turn-recovery`, `langy-turn-reconciler` + 6 tests (incl. the two github-flow tests that drove
  runTurn). All were a dead cluster (spawnAgent dispatches directly now). Cleared the
  `langy-turn.processor.ts:818` pre-existing type error. G4 (GitHub PR flow) was already dead in the
  self-drive model — its re-home is a fresh #24 feature, not a preservation. `langy-turn-errors`,
  `langy-final-parts`, `githubCommand`, `githubPrDetails` kept (used / #24 targets).
- **M2d DONE** — moved ALL of `src/server/services/langy/*` → `src/server/app-layer/langy/*` (27 source
  + tests, `git mv` renames so history is preserved; `streaming/` + `execution/` subdirs kept). Rewrote
  every import `services/langy` → `app-layer/langy` across `.ts` + `.tsx`. `services/langy` is gone.
  Typecheck clean (only the pre-existing `langy.ts:546 opts.signal`); 37 moved tests pass.
- **M2 COMPLETE.**

**M3 (S4) — DONE this session (scoped honestly; two items are actually #24).**
- **M3a DONE — deleted the vestigial `ProjectSecret langy_api_key_secret`.** Removed `provisionLangyApiKey`
  + `getLangyApiKeyToken` (dead) + `LANGY_API_KEY_NAME`/`LANGY_API_KEY_SECRET_NAME` from
  `app-layer/langy/langyApiKey.ts` (kept `LANGY_CANDIDATE_PERMISSIONS` — the session key uses it),
  dropped the unused imports, and removed the eager `provisionLangyApiKey` call in `project.ts`
  (project.create). The per-turn per-user session key (`mintLangySessionApiKey`) fully supersedes it.
  Typecheck-clean (only pre-existing `langy.ts:546`).
- **M3c DONE (already delivered in M1) — progressive per-call tool rendering (G3).** Verified end to
  end: Go `framesFor` emits ToolStart/ToolEnd PER CALL as opencode events land (not batched); the relay
  writes each as a live buffer card (`appendTool`) + a durable event (`recordToolCall*`); the UI renders
  via `LangyStreamCard`/`LangyToolActivity`. The `card`-frame → `appendMilestone` → `LangyStreamCard`
  plumbing for special cards is wired. (Special-card CONTENT — the enrichment card, the PR card — is a
  follow-up feature: the PR card is #24; the enrichment card is a Langy-MCP-result feature. The pipe is ready.)
- **M3b DEFERRED to #24 — permit-release reconcile.** It requires detecting whether a turn opened a PR
  (`reserve` INCR is the count; `release` DECR only when NO PR). That PR detection/accounting IS the
  GitHub PR flow (G4 / #24). Current behavior (reserve, never release) is SAFE (cap never bypassed) but
  over-restrictive (a GitHub-connected user's non-PR turns still burn slots); #24 fixes it with the flow.

**Net: M1 + M2 + M3 landed this session (M3b/M3-cards fold into #24). Next = the paused M4 (#24 GitHub rewrite).**

**GITHUB DEFERRED OUT OF THIS PR (Alex) — gated OFF, NOT deleted.** All GitHub code stays in the tree
(re-adding it later would be painful/error-prone). One guard,
`app-layer/langy/langyGithub.enabled.ts` `LANGY_GITHUB_ENABLED = false` (TODO #24), makes it inert:
- **`LangyCredentialService`** — the GitHub token mint (`getAccessToken`) is wrapped in
  `if (LANGY_GITHUB_ENABLED)`, so no token is ever resolved into a turn's credentials ⇒ the Go
  capability seam is inert (no token ⇒ no GitHub access).
- **`langy-turn.service`** — the PR permit is reserved only when `credentials.githubToken` exists
  (no token ⇒ no PR ⇒ no permit). So with GitHub off nothing reserves ⇒ the M3b permit-RELEASE
  concern is moot for this PR (nothing to release), and non-GitHub turns no longer over-reserve.
- Frontend connect card (`LangyGitHubConnectCard`) is already inert (its trigger
  `langy_github_not_connected` was produced by the deleted `runTurn`); no persistent connect button.
- Kept: `langyGithub*` modules, `githubCommand`, `githubPrDetails`, the OAuth connect route + app-layer
  credential service, the permit functions. #24 flips `LANGY_GITHUB_ENABLED = true` + re-homes the PR flow.
- RESIDUAL (minor, optional Go follow-up): the worker still ships the `github` skill, so an agent MAY
  attempt `gh` and fail gracefully (no token). Removing the skill when GitHub is off is a Go-side nicety,
  not needed for correctness.

**M2 — S3 deletions + rename (TS; gated on M1 landing + runtime-confirmed).**
- Delete `runTurn`/`langy-turn.processor.ts`, `langy-worker-pool.ts`, `langy-turn-recovery.ts`,
  `langy-turn-reconciler.ts` (+ tests); clean `startWorkers.ts`.
- Re-home the pieces that lived in `runTurn`: **G4** GitHub PR flow → its own service (also #24),
  **G5** server recovery (keep or drop = product call), **G6** 428 re-mint → relay acquire path,
  **G7** control-plane-worker drain-terminalization → deliberate answer.
- Rename `reconcileAgentTurn.reactor` → `agentTurnLiveness.reactor` (mechanical; job-dedup
  namespace caveat at the deploy boundary).

**M3 — S4 progressive rendering + cleanup (TS).** Per-call durable tool events as frames land
(G3, relay-side); distinct special cards (enrichment/PR/trace-download/preview) in order;
permit-release reactor on terminal; delete the vestigial `ProjectSecret langy_api_key_secret`.

**M4 — #24 GitHub flow rewrite (TS, last).** Inject Redis/crypto/clock/locker into
`LangyGithubCredentialsService` (drop module-level `connection`/`encrypt`); split
org-membership (`isOrganizationMember`/`findFirstAdminUserId`) off the creds repo; delete the
dead interim `langyGithub*` modules; domain errors + zod on the OAuth callback + credential
shape; move the PR turn-flow off `runTurn`. Go: close the `GH_USER_ID` gap (SKILL.md:36 wants
it; `adapters/github` doesn't inject it).

**Go polish (mostly done; residual):** H2 panic guards on the remaining bare goroutines fold
into M1.2; L1 `Credentials.Complete()` dead-code delete; L2 `extractHandoffToken`→`_test.go`;
scrub the stale TS-coupled comments in `opencode.go`/`config.go` (land with M1/M2).

### M1 EXECUTION LOG (this session) — DONE, build+test+typecheck green (runtime still gated)

- **M1.2 DONE (Go cutover)** — the worker self-drives. opencode `StreamSession` emits typed
  `internal/frames` via an `emit` callback (delta/tool/heartbeat), verbatim Stream-A dropped;
  `ChatSink` is `Emit(frames.Frame)`; a `frameSink` tees into `turnfold` + pushes via the new
  `app.FrameRelay`/`FrameStream` port (impl `controlplane.RelayClient`). `app.Chat`→`StartTurn`
  (sync Acquire+Claim → 202/409/503/428) + detached `driveTurn` (opens relay, streams, emits
  final/error, keeps Finalizer backstop). ADR-048 handoff → `frames.Handoff` + `domain.ErrTurnHandedOff`
  (finalize-on-handoff preserved). Heartbeat/panic-guarded. `/worker/*` returns 202. Full module
  build/vet/gofmt/test green; all opencode/app/transport/turnfold/frames tests rewritten to frames.
- **M1.3 DONE (TS relay)** — `LangyTurnRelay` handles every Go frame incl. the new `handoff`
  (schema + `recordTurnHandoff` → conversation_handoff_pending; NOT a failure). It is the live
  buffer+liveness writer once Go pushes. 15 relay tests green. (langy:hb retirement deferred to M2.)
- **M1.4 DONE (TS dispatch)** — `spawnAgent.reactor` dispatches via new `LangyWorkerPort.dispatch()`
  (POST /worker/{intent} + runToken+userId, reads status only, body cancelled — output goes to the
  relay), carrying the runToken from `conversations.getRunToken`. `LangyWorkerPool`/`setPool` dropped;
  `bootLangyTurnProcessor` (old pool + runTurn + interval sweep) removed from startWorkers. 428 re-mint
  (G6) deferred to M2; non-accepted dispatch left to the self-retry reactor. Typecheck clean (only the
  3 known pre-existing errors remain, one in the runTurn deletion target).

### M1.x (superseded) — earlier partial log

- **M1.1 — turn-request contract.** `chatRequest` (transport/rpc/handlers.go) + `app.ChatRequest`
  now carry `runToken` + `userId` (additive/optional; an older control plane omits them). Threaded
  transport→app. The TS side does not SEND them yet — that rides M1.4's dispatch rewire.
- **M1.2a — Go→relay push transport (tested).** New `adapters/controlplane/relay.go`:
  `RelayClient.Open(ctx, endpoint, runToken, frameauth.Identity) → *RelayStream`; `RelayStream.Emit(frames.Frame)`
  SIGNS (frameauth, fresh nonce) → one ndjson line over a pipe body to `POST /api/internal/langy/relay/frames`
  (Bearer `LANGY_INTERNAL_SECRET`, no client Timeout — streaming, ctx-cancelled); `Close()` EOFs the body,
  waits the relay tally, reports non-2xx. `ErrRelayDisabled` = no secret/endpoint/runToken ⇒ caller falls back,
  never a turn failure. `relay_test.go` stands up a fake relay that runs `frameauth.Verify` on every line —
  proves the client signs correctly + streams IN ORDER; covers non-2xx + disabled + emit-after-close.

### M1 CUTOVER — remaining, precise (the security-sensitive, runtime-gated core)

This is the wiring step (the branch's pattern: build pieces first, wire last). NOT build-verifiable
in halves — a `StreamSession` signature change ripples through the port, so land it as ONE slice with
its tests updated. **Cannot be runtime-verified without Redis + the live agent** — build + `go test` +
tsgo is the bar here; the real stream is proven only with `all-local` + the worker up.

- **Behavioral decision (settled here): `/worker/{create,continue}` keeps a SYNCHRONOUS Acquire+Claim**
  so the busy-guard still returns 409 to the dispatcher pre-stream (today's `worker.Claim()==false` →
  `ErrConversationBusy`). Only the OUTPUT path goes async: after Claim, the turn streams to the relay in a
  detached, panic-guarded goroutine and the handler returns `202` immediately. So it is "fire-and-forget
  output", not "fire-and-forget dispatch" — the 409 semantics the TS caller relies on survive.
- **Go — flip the sink to frames+push (adapters/opencode/opencode.go + app):**
  1. `StreamSession` stops writing raw ndjson to an `io.Writer`; it emits typed `internal/frames` values via
     an `emit func(frames.Frame) error` callback. Map: text delta → `frames.Delta`; tool start/end (the
     `toolCallTracker`) → `frames.ToolStart`/`ToolEnd`; the `progressInterval` ticker → `frames.Heartbeat`
     (first-class, replaces `langy.progress`). DROP the verbatim opencode Stream-A line (the relay only speaks
     the union; the durable final is built from the typed frames). Panic-guard the heartbeat + emit goroutines
     (review H2). Delete the hand-rolled `langyTokenFrame`/`langyToolFrame`/`langyProgressFrame` structs (kills
     the two-vocabularies drift, review M2/M3).
  2. `app.ChatSink` (app/ports.go) becomes a typed frame sink: `Emit(frames.Frame) error` + terminal helpers,
     NOT an `io.Writer`. The accumulator (`internal/turnfold`) folds the SAME typed frames into the durable
     final (it already borrows `frames.ToolCall`) — one decode path.
  3. `app.Chat`: after Claim, open a `RelayStream` (new `app.FrameRelay` port impl'd by `controlplane.RelayClient`,
     injected via `WithFrameRelay`; built from `req.identity()` = `{ProjectID,UserID,ConversationID,TurnID}` + `req.RunToken`).
     Stream frames into it; on terminal emit `frames.Final`/`frames.Error`; `Close()`. KEEP `finalizeCompletedTurn`
     (the Finalizer stays the durable-final backstop — `ingestAgentTurnResult` is turnId-idempotent, so relay-final +
     Finalizer collapse to one event). If `RunToken`=="" → `ErrRelayDisabled` → skip the push (older control plane).
  4. `transport/rpc/handlers.go`: `/worker/*` handler returns `202` after the synchronous Claim; the detached
     turn drives the relay push. Rename the vestigial `chatHandler`/`chatRequest`/"/chat" comments (M3).
  5. `cmd/root.go` + `deps.go`: construct `controlplane.NewRelayClient(internalSecret)`, inject via `app.WithFrameRelay`.
- **TS — M1.3 (relay is the live writer):** already built; once Go pushes, `LangyTurnRelay` writes the buffer (G1)
  + refreshes liveness from frame freshness (G2). Retire `langy:hb` as a separately-owned key (heartbeat = newest
  stream entry). Verify `onTurnStream` still tails correctly.
- **TS — M1.4 (rewire dispatch, drop pool):** `spawnAgent.reactor` POSTs `/worker/create|continue` directly with
  the dispatch body INCLUDING `runToken` (from `service.getRunToken`) + `userId`, and does NOT hold the response
  (fire-and-forget output; treats 202 as accepted, 409 as busy). Drop `LangyWorkerPool`/`setPool` late-binding.
  `runTurn` stops being the live driver here (its DELETION is M2, once runtime-confirmed).

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
