# langy — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md),
alongside the worked example [`dataset.md`](./dataset.md).

**Headline: langy is not dataset.** R1 and R6 — the two rules dataset failed
worst — langy passes outright. What it has instead is a **dead persistence
half**: an entire five-repository abstraction and eleven of the contract's
thirty-three operations that no production wiring reaches, sitting behind a
plain `throw` in the middle of the service every door calls.

Three of the eighteen problems below are live defects rather than shape
complaints: the egress allow-list procedure is wired to the dead half and will
throw for its first caller (P1); the warm path mints a worker credential its
twin revokes and it does not (P7); and the server and the browser have drifted
to different definitions of which CLI verbs return a collection (P15).

## 1. What is there now

**35,515 lines, 204 non-test files** across three packages:

| package        | non-test files | lines  |
| -------------- | -------------- | ------ |
| `server/src`   | 85             | 15,111 |
| `contract/src` | 39             | 7,603  |
| `web/src`      | 80             | 12,801 |

Server layer inventory (`server/src`, non-test):

| dir                             | files | lines |
| ------------------------------- | ----- | ----- |
| `services/`                     | 19    | 4,546 |
| `streaming/`                    | 13    | 2,956 |
| `adapters/`                     | 15    | 2,046 |
| `transport/api-trpc/`           | 2     | 1,179 |
| `repositories/prisma/`          | 9     | 1,063 |
| `projections/`                  | 4     | 604   |
| `intents/`                      | 2     | 508   |
| `ports/`                        | 7     | 489   |
| `app/`                          | 1     | 474   |
| `subscribers/`                  | 1     | 335   |
| `repositories/` (abstract)      | 6     | 310   |
| `processes/`                    | 3     | 309   |
| `api/public/`                   | 1     | 56    |
| root (`index.ts`, `testing.ts`) | 2     | 236   |

The stack a customer request travels, transport to datastore:

```
  platform/app tRPC root  ──► 18 procedures         transport/api-trpc/langy.api.ts   (1,050 ln)
  platform/app Hono routes ─┐  2 procedures         transport/api-trpc/langy-egress.api.ts (129)
        │                   │
        ▼                   │
  app/langy.app.ts          │  LangyApp            23 methods  ← 13 one-line pass-throughs
        │                   │                                  ← 4 real cross-service rules
        │                   └──►  .langyService  ═══════════╗  ESCAPE HATCH, 6 call sites
        ▼                                                   ║
  services/langy.service.ts     LangyService       33 methods║ ← 19 same-name delegations
        │                       (implements the              ║ ← 11 DEAD behind `this.persistence`
        │                        contract's 33 abstracts)    ║ ←  3 real
        ├───────────────┬──────────────┬─────────────┬───────╝
        ▼               ▼              ▼             ▼
  LangyConversation  LangyTurn    LangyMessage  LangyCredential   LangyFeedbackPromptPolicy
    Service (1,274)   Service(62)   Service(94)   Service(236)      (ports/, 96)
    26 methods        3 methods ← ALL THREE one-line delegations
        │                │
        │                ├─► LangyTurnStartService (236) ─► LangyTurnPreparationService (435)
        │                │        └─► LangyTurnBaseDependenciesService (117, stateless)
        │                │        └─► LangyTurnAttemptService (87)
        │                │        └─► LangyTurnOverrideService (57)
        │                ├─► LangyTurnStopService (67)
        │                └─► LangyTurnWarmService (121)
        ▼                                    ▼
  repositories/*.repository.ts (abstract)   repositories/langy.repository.ts
        │                                    5 abstract classes, 10 signatures
        ▼                                    ZERO production implementations
  repositories/prisma/*.repository.ts        ─── dead limb ───
```

Alongside, correctly placed and correctly shaped: `projections/` (4 classes),
`intents/` (command definitions), `processes/`, `subscribers/` (3 factories),
`adapters/eventing.*` (8 files).

**`startTurn` crosses seven objects** between the tRPC procedure and the first
repository call. Two of the seven add nothing.

## 2. Problems

### P1 — A whole repository layer, and 11 contract operations, are dead (R3, R5, R8)

`services/langy.service.ts:91-109` gives `LangyService` two construction modes.
Production uses only one:

```ts
// services/langy.service.ts:104-109   ← test-only
static create(options: Repositories, feedbackPrompt: LangyFeedbackPromptPolicy)

// services/langy.service.ts:112-129   ← the only production path
static createComposed(conversations, turns, messages, credentials, feedbackPrompt, relayOptions?)
```

`createComposed` passes `null` as `repositories` (`services/langy.service.ts:121`).
The only caller is `adapters/langy.langy.adapter.ts:201`. `LangyService.create` is
called from exactly two places, both in one unit test
(`repositories/__tests__/langy.service.unit.test.ts:61,142`).

So `private get persistence()` (`services/langy.service.ts:151-156`) throws
`Error("Langy persistence is not configured")` in every production process, and
**eleven of the contract's thirty-three operations are unreachable or broken**:

| method                                         | line           | reached by                                                |
| ---------------------------------------------- | -------------- | --------------------------------------------------------- |
| `listConversations`                            | `:158`         | nothing                                                   |
| `getConversation`                              | `:164`         | nothing                                                   |
| `createConversation`                           | `:173`         | nothing                                                   |
| `archiveConversation`                          | `:179`         | nothing                                                   |
| `startTurn` → `startTurnForConversation`       | `:185`, `:436` | nothing                                                   |
| `listMessages`                                 | `:208`         | nothing                                                   |
| `resolveCredential`                            | `:214`         | nothing                                                   |
| `relay`                                        | `:237`         | nothing                                                   |
| `stopTurn` (the `userId === undefined` branch) | `:203-205`     | nothing                                                   |
| **`tryGetEgressAllowlist`**                    | `:218`         | **`LangyApp.egressAllowlist`, `app/langy.app.ts:352`**    |
| **`trySetEgressAllowlist`**                    | `:225`         | **`LangyApp.setEgressAllowlist`, `app/langy.app.ts:360`** |

The last two are a **latent production fault, not merely dead code**. The
`langyEgress` router is mounted at `platform/app/src/server/api/root.ts:887`,
its `get` procedure calls `ctx.app.langy.egressAllowlist`
(`transport/api-trpc/langy-egress.api.ts:106`), and that reaches
`this.persistence.credentials`. The first client that calls it gets a plain
`Error` degraded to a generic "unknown error". No caller exists today — a grep
for `langyEgress.` across `platform/app/src` and `packages` finds only the
transport's own definition — so the fault is armed, not firing.

A working implementation is already right there and used by the turn path:
`services/langy-credential.service.ts:212` and `:223`, reached via
`services/langy-turn-base-dependencies.service.ts:51`. The façade simply points
at the wrong one of the two.

Supporting the dead half: `repositories/langy.repository.ts:16-45` declares
`ConversationRepository`, `TurnRepository`, `MessageRepository`,
`CredentialRepository` and `RelayRepository` — 5 abstract classes, 10 signatures,
**zero production implementations**. Each is extended exactly once, in
`repositories/__tests__/langy.service.unit.test.ts:26,32,36,39,48`. That is R4's
"seam to nowhere" in its purest form: an abstraction whose only subclass is the
test that proves the abstraction works.

### P2 — `api/public/langy.api.ts` is 56 lines of dead pass-through (R3)

`LangyPublicApi` (`api/public/langy.api.ts:17`) has 8 methods, every one a
parse-then-delegate two-liner. It is **never constructed**: its only mentions in
the whole repository are its own definition and the re-export at `index.ts:24`.
Six of its eight methods call the P1 methods that throw.

### P3 — `LangyTurnService` is 3-for-3 pass-through (R3)

`services/langy-turn.service.ts:20-62`. Every public method body is a single
delegation:

- `:42` `return this.start.startConversationTurn(input);`
- `:51` `return this.stop.stopTurn(input);`
- `:60` `return this.warm.warmConversationWorker(input);`

Its only rule is one defaulting line, `:28`
`finalParts: deps.finalParts ?? LangyFinalPartsService.create()`. R3's test —
"if N of a class's M methods are one-line delegations and the class holds no
rules of its own, the class goes" — is met at 3 of 3.

It also hand-copies two collaborator signatures rather than importing them:
`:45-50` duplicates `services/langy-turn-stop.service.ts:23-28`, and `:54-58`
duplicates `services/langy-turn-warm.service.ts:21-25`. And `:7-17` is eleven
lines of pure re-export from `langy-turn.shared.ts`.

### P4 — 19 more same-name delegations on `LangyService` (R3)

The `no-same-name-delegation-ts` detector reports **22 hits inside
`packages/features/langy`, and zero identity functions**:

```
uvx --from ast-grep-cli==0.42.3 ast-grep scan -c dev/lint/ast-grep/sgconfig.yml \
  --filter 'no-identity-function-ts|no-same-name-delegation-ts' --json=compact
```

19 are in `services/langy.service.ts` (`:269, :279, :288, :296, :304, :312,
:316, :326, :334, :340, :349, :353, :372, :380, :384, :391, :403, :418, :427`);
3 are P3's. Combined with P1's 11 dead methods, **30 of `LangyService`'s 33
methods are either a delegation or a throw.** The three that do real work are
`openRelayConnection` (`:131`), `stopTurn`'s branch selection (`:191`) and
`archiveConversation` (`:179` — itself dead).

### P5 — The app facade has an escape hatch that six callers use (R3, R8)

`app/langy.app.ts:146` exposes `get langyService(): LangyService`. Its own
docblock (`:135-145`) explains why, and R3 permits one facade — but the effect
is that **four operations never pass through the facade at all**:

- `platform/app/src/server/routes/langy-api.ts:233` — `startConversationTurn`
- `platform/app/src/server/routes/langy-api.ts:256` — hands the raw service on
- `platform/app/src/server/routes/langy-internal.ts:138,155,204` — `turnExists`,
  `ingestAgentTurnResult`, `revokeWorkerSessionKey`
- `platform/app/src/server/routes/langy-relay.ts:66` — `openRelayConnection`

`langy-api.ts:233` calls `startConversationTurn` **directly**, so the HTTP door
skips the `idempotencyKey ?? requestId` alias rule that `LangyApp.startTurn`
(`app/langy.app.ts:315-318`) exists to make single. That is precisely the
"two doors answering differently" the facade's docblock says it prevents.

The tRPC door is clean by contrast: all 18 procedures go through
`ctx.app.langy.*` and reach nothing else.

`LangyApp` itself is 13-of-23 pass-through (`app/langy.app.ts:160, 170, 185,
210, 219, 228, 233, 238, 249, 290, 339, 367, 372`). That is acceptable — the
layout requires this facade and it holds four genuine rules (`isVisibleToCaller`
`:196`, `canWatchTurn` `:385`, `startTurn` `:304`, `watchForMissedTerminal`
`:432`).

### P6 — Fake optionality, and one guard tree that cannot fire (R5)

`LangyService` holds six nullable fields (`services/langy.service.ts:93-99`)
behind five `throw` guards (`:133, :153, :243, :250, :257, :264`). In
`createComposed`, `conversations`/`turns`/`messages`/`credentials` are **always**
supplied (`adapters/langy.langy.adapter.ts:201-210`), so the four
`"Langy runtime is not configured"` throws at `:243, :250, :257, :264` are
unreachable, and `:153` is reachable only along the dead paths of P1.

In the turn family, `services/langy-turn.shared.ts:47-66` declares nine
optional or nullable dependencies. Checked against both composition roots
(`platform/app/src/server/app-layer/presets.ts:2528-2563` for production,
`:3695-3723` for the test app):

| dep                    | declared | production                                | test app     | verdict                                                                                                    |
| ---------------------- | -------- | ----------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `worker \| null`       | `:54`    | conditional (`presets.ts:2542`)           | `null`       | **genuinely optional**                                                                                     |
| `tokenBuffer \| null`  | `:55`    | redis-gated (`:2543`)                     | `null`       | **genuinely optional**                                                                                     |
| `accessStore \| null`  | `:63`    | redis-gated (`:2561`)                     | `null`       | **genuinely optional**                                                                                     |
| `handoffStore \| null` | `:64`    | redis-gated (`:2562`)                     | `null`       | **genuinely optional**                                                                                     |
| `promptProjectId?`     | `:52`    | env (`:2532`)                             | env          | **genuinely optional**                                                                                     |
| `harness?`             | `:57`    | **always** (`:2550`)                      | omitted      | test-only optionality                                                                                      |
| `finalParts?`          | `:48`    | never passed                              | never passed | **fake** — defaulted at `langy-turn.service.ts:28`, then used unguarded at `langy-turn-stop.service.ts:59` |
| `messages \| null`     | `:65`    | **always** (`langy.langy.adapter.ts:198`) | always       | **fake** — nothing can pass null; guard at `langy-turn-preparation.service.ts:119` is dead                 |

`worker` is the worst of the genuine ones: three absence policies that disagree.
`services/langy-turn-start.service.ts:86-88` throws
`LangyAgentUnavailableError`; `services/langy-turn-warm.service.ts:74`
silently returns `{ warmed: false }`; `services/langy-turn-stop.service.ts:64`
optional-chains to a resolved promise. Same missing dependency, three answers.

### P7 — The warm path mints a session key it never revokes (correctness)

`services/langy-turn-warm.service.ts:98-103` mints an API key and writes it onto
the credentials. Its twin in the start path,
`services/langy-turn-preparation.service.ts:225-232`, performs the same five
steps and adds one more line at `:232`:

```ts
args.attempt.retainSessionKey(minted.apiKeyId);
```

which registers the compensating revoke in
`services/langy-turn-attempt.service.ts:38-40`, executed by `abort()` at
`:69-76`. Warm has no equivalent, and `sessionKeys.revoke` is called from only
two places in the package (`langy-turn-attempt.service.ts:71` and
`adapters/eventing.langy-conversation-runtime.adapter.ts:119`), neither
reachable from warm. When `worker.warm` rejects at
`services/langy-turn-warm.service.ts:105-118`, the catch only logs.

**Honest bound:** the key is not leaked forever. The hourly reap
(`intents/langy-session-key-reap.intent.ts:14-15`, "revokes every elapsed,
unrevoked Langy session key") collects it once its own TTL elapses. So the
defect is _a live worker credential that outlives its failed warm by up to its
full expiry_, where the start path revokes immediately. It is the divergence
between two copies of the same five steps that makes it a bug rather than a
policy.

### P8 — Five of seven files in `ports/` export no port (R4, `strict-port-module`)

`ports/*.port.ts` must export an abstract class whose name ends in `Port`. Five
do not, and all five are on the architecture-lint baseline
(`packages/architecture-lint/src/port-module-baseline.json:21-25`):

| file                                       | lines | what it actually holds                                             |
| ------------------------------------------ | ----- | ------------------------------------------------------------------ |
| `ports/langy-ids.port.ts`                  | 4     | one `as const` map. Not a port in any sense                        |
| `ports/langy-effect.port.ts`               | 38    | 3 constants + 2 interfaces + 1 function type                       |
| `ports/langy-feedback-prompt.port.ts`      | 96    | **`LangyFeedbackPromptPolicy`, a service**, plus a Redis interface |
| `ports/langy-frame-auth.port.ts`           | 139   | 5 pure crypto functions + 3 interfaces                             |
| `ports/langy-conversation-process.port.ts` | 79    | zod schemas + inferred types                                       |

Meanwhile a real port lives in the wrong directory: `LangyPromptPort` is
declared at `services/langy-prompt-registry.service.ts:48`.

The ports that are real, with their implementation counts:

| port                                                  | impls                                                                                                                                               | verdict                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `LangyAnalyticsEventSinkPort`                         | 2 — `adapters/langy-analytics-event-storage.adapter.ts:44` + `platform/app/src/runtime/app/features/langy-analytics-event.clickhouse.adapter.ts:74` | **Keep**                     |
| `LangyWorkerPort`                                     | 2 — `adapters/unavailable-langy-worker.adapter.ts:11` + `adapters/langy-worker-http.adapter.ts:64`                                                  | **Keep**                     |
| `LangyWorkerMetricsPort`                              | 2 — `adapters/null-langy-worker-metrics.adapter.ts:3` + `platform/app/src/runtime/app/features/langy.ts:7`                                          | **Keep**                     |
| `LangyHarnessPort`                                    | 1, cross-package (`presets.ts:2550`)                                                                                                                | **Keep** — genuine inversion |
| `LangyTurnContextPort`                                | 1, cross-package (`presets.ts:2553`)                                                                                                                | **Keep**                     |
| `LangyTurnMetricsPort`                                | 1, cross-package (`presets.ts:2554`)                                                                                                                | **Keep**                     |
| `LangyGithubPermitPort`                               | 1, cross-package (`presets.ts:2546`)                                                                                                                | **Keep**                     |
| `LangyModelPort`                                      | 1, cross-package (`presets.ts:2532`)                                                                                                                | **Keep**                     |
| `LangyPromptPort`                                     | 1, cross-package (`AppPromptRuntime`, `presets.ts:2531`)                                                                                            | **Keep**, move file          |
| `LangySessionKeyPort`                                 | 1, **same package** — `services/langy-session-key.service.ts:60`                                                                                    | **Delete**                   |
| the 5 abstracts in `repositories/langy.repository.ts` | 0                                                                                                                                                   | **Delete** (P1)              |

One shape note, not a defect: the five cross-package ports are declared as
`abstract class` yet satisfied by object literals in `presets.ts`. The `abstract
class` buys nothing there over an interface — TypeScript matches them
structurally.

### P9 — Comment blocks past the ceiling, and 19.5% of the server is prose (R7)

2,950 of 15,111 server lines are comment. Two blocks exceed the 60-line ceiling
`packages/architecture-lint/src/comment-blocks.ts:9` enforces:

- **`services/langy-conversation-memory.service.ts:1-68`** — 68 lines. Opens
  with a verbatim incident transcript ("Langy created a scenario … the user had
  to say 'no, run the scenario you just made'"), then Go worker-pool internals
  (`app/workerpool/pool.go`), then `── WHERE THE FACTS COME FROM ──` and
  `── SECURITY ──` headed sections. The security argument (§1 prompt injection,
  §2 authorisation) is worth keeping in some form; the incident narrative and
  the cross-service plumbing history are ADR material.
- **`contract/src/cards/derived-safe.ts:1-66`** — 66 lines, `── WHY AN
ALLOWLIST AT ALL ──` plus a wire-compatibility note on `blockId`. Already
  cites ADR-060 §3; the prose largely restates it.

Files where comment outweighs code:

| file                                            | comment | code | ratio   |
| ----------------------------------------------- | ------- | ---- | ------- |
| `streaming/langy-streaming.constants.ts`        | 49      | 19   | **2.6** |
| `services/langy-prompt-registry.service.ts`     | 66      | 52   | 1.3     |
| `ports/langy-conversation-process.port.ts`      | 38      | 34   | 1.1     |
| `ports/langy-frame-auth.port.ts`                | 64      | 64   | 1.0     |
| `services/langy-conversation-memory.service.ts` | 187     | 188  | 0.99    |
| `streaming/langy-turn-order.ts`                 | 37      | 38   | 0.97    |
| `streaming/langy-relay-frame.ts`                | 113     | 117  | 0.96    |
| `transport/api-trpc/langy-egress.api.ts`        | 55      | 66   | 0.83    |

`services/langy-prompt-registry.service.ts:1-37` is the clearest ADR candidate:
37 lines describing where prompt rows live, which is explicitly "a deployment
decision (see ADR-050)" — the comment says so itself at `:31`.

The distribution is lopsided rather than uniformly heavy. The two densest,
largest files in the turn family carry **zero** comments:
`services/langy-turn-preparation.service.ts` (435 lines, 0 comment) and
`services/langy-turn-base-dependencies.service.ts` (117 lines, 0 comment). The
former reads a six-element `Promise.allSettled` tuple by position at `:131`
(`[currentResult, , runTokenResult, modelsAllowedResult]`) and `:237`
(`[, handoffResult, , , memoryResult, overrideResult]`) with the index-to-meaning
mapping written down nowhere. That is the opposite failure and it should be
fixed in the same pass.

### P10 — `web/src/index.ts` is 77 `export *` lines (R8)

`web/src/index.ts:1` re-exports the entire contract package; lines 2-77 re-export
every behaviour, component, hook and store module. Every one of the 173
importers outside the package imports the bare specifier `@langwatch/langy-web`
— not one uses a subpath — so the barrel is load-bearing today, but nothing
records which of its several hundred symbols anyone actually needs.

The server's `index.ts` is better: 171 lines, no `export *`, 115 named symbols.
But **80 of those 115 have no consumer outside `packages/features/langy`.**
Among them: `LangyPublicApi` (dead, P2), `LangyEventingPorts`,
`LangyTrustedMessagePort`, `LangyFinalPartsService`, `LangyCliEnvelopeService`,
`LangyFrameDedupStore`, `LangyResourceLinksStore`, `NullLangyWorkerMetricsAdapter`,
`computeFrameMac`, `mintRunToken`, `newFrameNonce`, `signFrame`, `verifyFrame`,
`serializeLangyTurnError`, `langyAgentErrorFromErrorFrame`,
`createLangyConversationProcessingPipeline`, `createAgentTurnLivenessSubscriber`,
`createLangyTurnAdmissionLifecycleSubscriber`, `runLangySessionKeyReap`,
`settlementFromEvents`, and every `LANGY_*_MS` / `LANGY_*_SECONDS` constant.

### P11 — 32 error classes across 5 files in 2 packages (R8, layout only)

`contract/src/langy.errors.ts` (18), `adapters/langy.turn-errors.adapter.ts` (10),
`contract/src/langy.ts`, `ports/langy-turn-runtime.port.ts`, `app/langy.app.ts`
(`LangySessionRequiredError`, `:78`). Ten `HandledError` subclasses living in a
file called `*.adapter.ts` is a filename lying about its contents; dataset's
target tree puts these in `errors/`.

This is **naming and placement only** — see the keep list for why R6 itself is
clean.

### P12 — Two modules named `.service.ts` that contain no service (R2)

- `services/langy-conversation-memory.service.ts` — 398 lines, **zero classes**,
  3 exported pure functions (`:147`, `:221`, `:308`), one consumer
  (`services/langy-turn-preparation.service.ts:14-18`). Pure renderers over a
  message list. These are `utils/`.
- `services/langy-prompt-value.service.ts` — 12 lines: one constant and one pure
  string sanitiser (`:5`). Also `utils/`.
- `adapters/eventing.langy-type-guards.adapter.ts` — 102 lines, 14 pure
  predicates, no adapter.

Conversely, `services/langy-turn-base-dependencies.service.ts:12` is
`private constructor() {}` — an empty constructor, no fields, and every call
site discards the instance immediately
(`services/langy-turn-start.service.ts:48`,
`services/langy-turn-warm.service.ts:62`, both
`LangyTurnBaseDependenciesService.create().resolve({...})`). Because it holds no
state, `deps` is threaded through four signatures as a parameter (`:19, :32,
:56, :88`). R2 inverted: a class costume over what is really a function.

### P13 — `LangyConversationService` is three services (R2)

`services/langy-conversation.service.ts:259-1274` — 1,274 lines, 26 public
methods across three distinct responsibilities:

- **conversation lifecycle** (10): `getById :336`, `getEventsAfter :379`,
  `tryFindByIdVisible :454`, `getAll :471`, `getPage :493`,
  `ensureConversation :542`, `createConversation :584`, `forkById :627`,
  `deleteById :1176`, `updateById :1196`, `clearAllForUser :1234`
- **turn recording** (9): `acceptTurn :767`, `recordUserMessage :728`,
  `recordToolCallStarted :811`, `recordToolCallCompleted :848`,
  `recordPlanUpdated :900`, `failTurn :926`, `turnExists :974`,
  `ingestAgentTurnResult :986`, `finalizeTurn :1143`
- **handoff and tokens** (4): `tryGetRunToken :712`, `tryGetPendingHandoff :1071`,
  `recordTurnHandoff :1087`, `consumeHandoff :1112`

It is also the only file in the package with a 28-line mid-file comment block
(`:946-973`).

### P14 — Duplication between the warm and start paths (R8)

Beyond P7's mint, five blocks are near-verbatim copies:

| what                              | warm                                | start (via preparation)                              | divergence                                                                 |
| --------------------------------- | ----------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| base-dependency resolve           | `langy-turn-warm.service.ts:61-70`  | `langy-turn-start.service.ts:47-56`                  | warm adopts any requested id; start requires `adoptConversationId`         |
| model selection                   | `langy-turn-warm.service.ts:73`     | `langy-turn-start.service.ts:120`                    | warm returns `{warmed:false}`; start throws `LangyModelNotConfiguredError` |
| models allow-list                 | `langy-turn-warm.service.ts:76-82`  | `langy-turn-preparation.service.ts:115-118, 147-163` | warm returns false; start throws `LangyModelNotAllowedError`               |
| GitHub permit + credential strip  | `langy-turn-warm.service.ts:83-86`  | `langy-turn-preparation.service.ts:182-184, 200-202` | warm `check`, start `reserve`                                              |
| probe → mint → mutate credentials | `langy-turn-warm.service.ts:87-104` | `langy-turn-preparation.service.ts:212-232`          | **P7**                                                                     |

Some divergence is intentional (warm must never fail a page load). But five
copies with four intentional differences and one unintentional one is the shape
that produced P7, and will produce the next one.

### P15 — `streaming/` duplicates a contract constant, and the copies have drifted (R8)

`streaming/langy-capability-progress.ts:44-52` keeps a private `COLLECTION_VERBS`
set. The contract already exports one, `CLI_COLLECTION_VERBS`
(`contract/src/cards/registry.ts:245-255`). They are not the same set any more:

| verb                                                     | server copy | contract |
| -------------------------------------------------------- | ----------- | -------- |
| `search` `query` `list` `versions` `list-runs` `records` | yes         | yes      |
| `results`                                                | **yes**     | no       |
| `tag`                                                    | no          | **yes**  |
| `types`                                                  | no          | **yes**  |

The web side imports the contract's copy
(`web/src/behaviour/langy-capability-registry.ts:42`), so **server and browser
now pluralise different verb sets for the same CLI result.**
`contract/src/cards/__tests__/registry.unit.test.ts:112-114` asserts
`CLI_COLLECTION_VERBS.has("types")` — a guarantee the server copy silently
breaks, and no test covers the server copy at all.

The same file also keeps a 32-entry `NOUNS` singular/plural table
(`streaming/langy-capability-progress.ts:9-42`) parallel to the contract's
`CARDS_BY_RESOURCE` (`contract/src/cards/registry.ts:303+`), which already keys
per-resource and per-verb wording. Its header (`:1-8`) justifies the duplication
as avoiding a UI import — but the contract is not the UI, and both sides already
depend on it.

Three more duplications in the same directory:

- **The terminal-frame predicate, five times.**
  `streaming/langy-turn-tail.ts:80-81` (`isTerminal`) and
  `streaming/langy-turn-settlement-waiter.ts:146-148` (`isTerminalFrame`) are
  byte-identical logic under two names in two files — and `langy-turn-tail.ts:1`
  already imports from the other. Open-coded three more times at
  `streaming/langy-token-buffer.ts:693`,
  `transport/api-trpc/langy.api.ts:991` and `:1032`.
- **`humanize` / `capitalize`, four implementations** of title-casing a CLI
  resource word: `streaming/langy-capability-progress.ts:84-88`,
  `web/src/behaviour/langy-capability-registry.ts:309-316` and `:319-321`,
  `platform/app/src/features/langy/logic/langyToolLabel.ts:153-159`,
  `platform/app/src/features/langy/components/capabilities/LangyDeclarativeCard.tsx:53-55`.
- **`safeJson`** (`streaming/langy-turn-relay.ts:989-995`) duplicates
  `platform/app/src/utils/safeJsonParse.ts:1-8` body-for-body.

### P16 — `streaming/` shape: two un-written classes, one 181-line method (R2, R7)

Six of the thirteen files are classes on the same `static create({ redis })`
shape and are correct. Two of the seven free-function modules are R2 hits:

- `streaming/langy-turn-settlement-waiter.ts` — six of seven functions thread the
  same `{ conversationId, turnId, signal }` plus a store:
  `awaitTurnSettlement` (`:208-217`), `watchBufferForTerminal` (`:150-153`),
  `armBufferWatch` (`:172-177`). `awaitTurnSettlement` also owns a connection
  lifecycle itself — `:182` `input.redis.duplicate()`, `:190`
  `blockingRedis.disconnect()`. `{ langy, redis }` are the constructor fields
  that were never written.
- `streaming/langy-turn-tail.ts` — the shared bundle is _already declared as a
  type_: `interface TailDeps` at `:83-93`, spread into `followLiveEdge`
  (`:107-119`) and `streamTurnEntries` (`:185-188`). `TailDeps` is the missing
  constructor, written out longhand.

`streaming/langy-turn-relay.ts` (995 lines) is one class, `LangyTurnRelay`
(`:336-986`), 11 methods. **`apply` is 181 lines** (`:560-740`) — a single
`switch (frame.type)` at `:567` over ~12 variants — and `applyTool` is 94
(`:742-835`). Those two are 40% of the file. It is otherwise clean on R1: the
redis handle is bound to a local in `create` (`:385`), used only to construct
four stores (`:386-392`), and never stored — the constructor (`:370`) takes only
behavioural ports, and `:364-367` explicitly says the link cache is not an
instance field.

R7 in `streaming/`: two blocks of 20+ lines. `streaming/langy-turn-order.ts:1-22`
is pure incident history (the durable record _used to_ store tool calls before
text, so a refreshing reader lost the middle of a turn) — ADR material.
`streaming/langy-turn-relay.ts:1-20` is legitimate module orientation; keep it.
Three sub-threshold blocks are also post-mortems rather than explanations:
`streaming/langy-turn-tail.ts:168-184` (a removed `AbortSignal.timeout` that
capped every stream at two minutes), `streaming/langy-relay-frame.ts:84-97`
(a Gemini thought-signature blob that exceeded Postgres's btree index limit and
parked a queue group), and `streaming/langy-token-buffer.ts:1-18` (restating
ADR-044).

And a dead one: **`streaming/langy-token-buffer.ts:728-732` is an orphaned JSDoc
at end of file.** The class closes at `:726`; the file's last bytes are a
comment block describing an `adaptRedis` helper, with no declaration after it.
`grep -rn "adaptRedis"` across `packages/` and `platform/` returns nothing.

### P17 — `LangyTokenBuffer` is the package's most-leaked internal (R8)

Seven files outside the feature import it. Two construct it directly from a raw
redis handle — `platform/app/src/runtime/app/internal-api/langy.router.ts:88`
and `platform/app/src/server/app-layer/presets.ts:1786` — and two immediately
narrow it:

```ts
platform/app/src/server/app-layer/langy/ui-actions/ui-action.service.ts:149
  Pick<LangyTokenBuffer, "appendUiAction">
platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts:498-499
  Pick<LangyTokenBuffer, …>
```

A consumer writing `Pick<>` over your class is telling you the interface it
actually wanted. Two of them agree; that is the port worth extracting, and it is
a better use of `ports/` than the five files in P8 that hold no port at all.

### P18 — Two loggers on one channel; one is never called (R7)

`services/langy-turn-start.service.ts:11,23` builds
`createLogger("langwatch:langy:turn-start")`; `grep -c 'logger\.'` on that file
returns 0. The live logger under that same channel name is
`services/langy-turn-preparation.service.ts:31`. A Loki query on
`langwatch:langy:turn-start` therefore returns lines from a file whose name no
longer matches the channel. Same file, `:6`, imports
`LangyModelNotAllowedError` and never uses it — the throw moved to
`services/langy-turn-preparation.service.ts:162`.

## 3. What it should look like

The move is **delete the dead persistence half and collapse two pass-through
layers**, not restructure the feature. The event-sourcing side, the streaming
side and the repositories the code actually uses are all left alone.

```
contract/src/
  langy.service.ts             ~250   33 abstracts → 22. The 11 of P1 go.
  langy.errors.ts              ~390   unchanged
  cards/derived-safe.ts        ~200   66-line header → ~8 + an ADR link

server/src/
  app/langy.app.ts             ~520   LangyApp holds the four services DIRECTLY.
                                      Gains turnExists / ingestAgentTurnResult /
                                      revokeWorkerSessionKey / openRelayConnection
                                      as real methods; the `langyService` getter goes.
  services/
    langy-conversation.service.ts  ~640   lifecycle only (11 methods)
    langy-turn-recording.service.ts ~430  acceptTurn · tool calls · plan · fail ·
                                          finalize · ingest (9 methods)
    langy-turn-handoff.service.ts  ~180   run token · handoff (4 methods)
    langy-turn-start.service.ts    ~236
    langy-turn-preparation.service.ts ~400  + the tuple destructures NAMED
    langy-turn-warm.service.ts     ~90    shares P14's five blocks with start
    langy-turn-stop.service.ts     ~67
    langy-turn-attempt.service.ts  ~87
    langy-turn-override.service.ts ~57
    langy-credential.service.ts    ~236
    langy-message.service.ts       ~94
    langy-final-parts.service.ts   ~200
    langy-cli-envelope.service.ts  ~232
    langy-session-key.service.ts   ~175   no longer `extends LangySessionKeyPort`
    langy-feedback-prompt.service.ts ~90  moved OUT of ports/
    langy-prompt-registry.service.ts ~90  40-line header → ~6 + ADR-050 link
  ports/
    langy-worker.port.ts           ~60   LangyWorkerPort + LangyWorkerMetricsPort
    langy-turn-runtime.port.ts     ~60   harness · context · metrics · permits · model
    langy-prompt.port.ts           ~12   MOVED from services/
    langy-analytics-event-sink.port.ts ~17
  utils/
    langy-conversation-memory.ts   ~330  was …-memory.service.ts, 68-line header → ~10
    langy-prompt-value.ts          ~12   was …-value.service.ts
    langy-turn-identity.ts         ~60   from langy-turn.shared.ts
    langy-frame-auth.ts            ~90   was ports/langy-frame-auth.port.ts
    langy-event-type-guards.ts     ~102  was adapters/eventing.…-type-guards.adapter.ts
    langy-ids.ts                   ~4    was ports/langy-ids.port.ts
  errors/
    langy-turn.errors.ts           ~430  was adapters/langy.turn-errors.adapter.ts
  streaming/
    langy-turn-relay.ts            ~995   `apply` split by frame family
    langy-token-buffer.ts          ~727   orphaned JSDoc at :728-732 deleted
    langy-turn-settlement.ts       ~103   the port two consumers already Pick<>
    langy-turn-settlement-waiter.ts ~200  → class LangyTurnSettlementWaiter
    langy-turn-tail.ts             ~180   → class LangyTurnTail (TailDeps = its fields)
    langy-capability-progress.ts    ~50   NOUNS + COLLECTION_VERBS → the contract
    …the other 7 unchanged
  repositories/  projections/  intents/  processes/  subscribers/
  adapters/  transport/           unchanged
```

**Deleted outright:** `services/langy.service.ts` (442), `services/langy-turn.service.ts`
(62), `api/public/langy.api.ts` (56), `repositories/langy.repository.ts` (45),
`repositories/__tests__/langy.service.unit.test.ts`, `services/langy-turn.shared.ts`
as a module (169 → split into `utils/` and the owning services), and
`LangySessionKeyPort` from `ports/langy-turn-runtime.port.ts`.

**≈ 74 server files, ≈ 13,600 lines. Two layers removed from every request.**

### The composition, after

`PostgresLangyAdapter.build` stops returning the contract's abstract class and
returns the app instead. The four services become `LangyApp`'s constructor
fields, which is what the 19 delegations of P4 were standing in for.

```ts
// adapters/langy.langy.adapter.ts
build(options: LangyServiceCompositionOptions): LangyApp {
  if (this.app) return this.app;

  const conversations = LangyConversationService.create(/* … */);
  const recording    = LangyTurnRecordingService.create(/* … */);
  const handoff      = LangyTurnHandoffService.create(/* … */);
  const messages     = LangyMessageService.create(/* … */);
  const credentials  = LangyCredentialService.create(/* … */);
  const turns        = LangyTurnStartService.create({ ...options.turns, conversations, credentials, /* … */ });

  this.app = LangyApp.create({
    conversations, recording, handoff, messages, credentials, turns,
    stop:  LangyTurnStopService.create(/* … */),
    warm:  LangyTurnWarmService.create(/* … */),
    feedback: LangyFeedbackPromptService.create({ redis: options.feedbackPromptRedis ?? null }),
    relay: options.relay ?? null,
    redis: options.redis ?? null,
    broadcast: options.broadcast,
  });
  return this.app;
}
```

`LangyApp` then answers the four operations the Hono routes reach for today, so
`langyService` and its six bypass call sites (P5) go with it:

```ts
export class LangyApp {
  // … the 23 methods it already has, minus the getter …

  /** The worker posting its result back over /api/internal/langy. */
  turnExists(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    return this.recording.turnExists(input);
  }
  ingestAgentTurnResult(input: LangyTurnResultInput): Promise<void> {
    return this.recording.ingestAgentTurnResult(input);
  }
  revokeWorkerSessionKey(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<LangySessionKeyRevocation> {
    return this.credentials.revokeWorkerSessionKey(input);
  }
  openRelayConnection(): LangyRelayConnection {
    if (!this.relay) throw new LangyRelayNotConfiguredError();
    return LangyTurnRelay.create({ conversations: this.conversations, ...this.relay });
  }
}
```

Six delegations replace 19 delegations plus 11 throws plus an escape hatch, and
`platform/app/src/server/routes/langy-api.ts:233` starts a turn through the same
method the tRPC door uses — so the `idempotencyKey` alias rule is finally single.

### The egress fix, which is P1's live half

One line each, and the dead repository goes with them:

```ts
// app/langy.app.ts
async egressAllowlist(input: { projectId: string }): Promise<LangyEgressState> {
  return toEgressState(await this.credentials.tryGetEgressAllowlist(input));
}

async setEgressAllowlist(input: { projectId: string; allowlist: LangyEgressAllowlist }): Promise<LangyEgressState> {
  return toEgressState(await this.credentials.trySetEgressAllowlist(input));
}
```

`LangyCredentialService.tryGetEgressAllowlist` / `trySetEgressAllowlist`
(`services/langy-credential.service.ts:212,223`) are already correct, already
tested, and already used by the turn path.

### The warm/start mint, which is P7

Extract the shared five steps into `LangyTurnPreparationService` and give warm
the same compensation seam, so there is one copy and one policy:

```ts
// services/langy-turn-preparation.service.ts
async ensureWorkerCredentials(args: {
  worker: LangyWorkerPort;
  session: LangyCredentialSession;
  credentials: LangyCredentials;
  projectId: string; userId: string; conversationId: string; model: string;
  /** Warm passes a store that revokes on dispatch failure; start passes the turn attempt. */
  retain: (apiKeyId: string) => void;
}): Promise<{ alreadyAlive: boolean }> {
  if (await args.worker.probe(buildWorkerProbeArgs(args))) return { alreadyAlive: true };
  const minted = await this.deps.sessionKeys.mint({
    session: args.session, projectId: args.projectId,
    organizationId: args.credentials.organizationId,
  });
  args.credentials.langwatchApiKey = minted.token;
  args.credentials.langwatchApiKeyId = minted.apiKeyId;
  args.retain(minted.apiKeyId);              // ← warm can no longer forget this
  return { alreadyAlive: false };
}
```

## 4. Keep list

- **R1 is clean and should stay that way.** No service, streaming module, adapter
  or projection in the package names `PrismaClient`, `Prisma.TransactionClient`,
  `$transaction`, `$executeRaw` or `$queryRaw`. The only mentions in all 85
  server files are the eleven type positions in
  `repositories/prisma/langy-database.port.ts:1-17`, which is the repository
  layer's own narrow database surface. This is what dataset is being fixed _to_.
- **R6 is clean.** All 18 contract error classes (`contract/src/langy.errors.ts:39-382`)
  and all 10 server ones (`adapters/langy.turn-errors.adapter.ts:33-241`) extend
  `HandledError` with a stable code. There is **no** `Record<string, {status}>`
  keyed on `error.name` and **no** `instanceof` ladder in any transport —
  `grep -n "error.name\|instanceof\|Record<string"` over the turn-errors adapter
  returns nothing. `platform/app/src/features/errors/logic/presentation.ts`
  carries 47 `langy_*` entries against the contract's 21 declared codes. Only
  P11's file placement is at issue; the mechanism is right.
- **`app/langy.app.ts`** — required by the layout, and it holds four real
  cross-service rules. It grows in the target, it does not go.
- **The five cross-package ports** (`LangyHarnessPort`, `LangyTurnContextPort`,
  `LangyTurnMetricsPort`, `LangyGithubPermitPort`, `LangyModelPort`) and
  `LangyPromptPort` — one implementation each, all in `platform/app`. Genuine
  inversions; the feature must not reach the app. Only `LangyPromptPort`'s file
  location changes.
- **`LangyWorkerPort`, `LangyWorkerMetricsPort`, `LangyAnalyticsEventSinkPort`**
  — two implementations each. Real polymorphism.
- **`projections/` (4), `intents/` (2), `processes/` (3), `subscribers/` (1) and
  the eight `adapters/eventing.*` files** — event-sourcing code correctly inside
  the server package, correctly shaped: projections are classes, intents are
  command definitions, subscribers are factories. Untouched.
- **`repositories/` and `repositories/prisma/`** apart from
  `langy.repository.ts` — 6 abstract + 8 Prisma implementations, one-to-one,
  every one used. `repositories/prisma/prisma.langy-turn-admission.repository.ts`
  (377 lines) is a hot correctness path (admission claim/commit/abort with
  retry and lease fencing) already inside its quality ceiling; the only
  complaint would be method length. Leave it.
- **`streaming/`'s six store classes** — `LangyTurnRelay`, `LangyTokenBuffer`,
  `LangyFrameDedupStore`, `LangyResourceLinksStore`, `LangyTurnHandoffStore`,
  `LangyTurnAccessStore`. All on the same `static create({ redis })` shape, all
  correct. `streaming/langy-turn-settlement.ts`, `langy-turn-order.ts`,
  `langy-capability-progress.ts` and `langy-relay-frame.ts` are genuinely
  free-function modules over plain values — R2 permits those, and they should
  stay that way.

  **Correction to this review's brief:** `streaming/langy-turn-relay.ts` does
  **not** value-import from a `components/` path. Its twelve imports (`:32-58`)
  reach `@langwatch/langy-contract`, `../services/`, `../adapters/`, `../ports/`
  and four siblings; `grep -rn "components/" streaming/` returns nothing. The
  only `components/` string in the server package is a `@see` doc reference at
  `services/langy-cli-envelope.service.ts:27`, and the path it names is written
  as `src/features/langy/components/…` when the file actually lives at
  `platform/app/src/features/langy/components/…` — R7's "any comment naming a
  file path" rot, and it should be corrected in commit 6.

  `CLAUDE.md`'s frontend-boundary note still lists
  `packages/features/langy/server/src/streaming/langy-turn-relay.ts` among the
  imports that predate the guard. That entry is stale and should be dropped —
  the enforcing test, `platform/app/src/server/__tests__/frontend-boundary.unit.test.ts`,
  walks the real graph, so nothing has regressed; only the prose is out of date.

- **`contract/src/event-sourcing/` and `contract/src/inline-channel/`** — folds,
  cursors and the fence parser, each with its own unit test. Correct as they are.
- **`web/`** — 80 files, 12,801 lines. Outside this review's scope beyond P10.
  The `behaviour/` split (33 pure modules, each with a colocated unit test) is
  the shape a React feature should have; do not consolidate it.

## 5. Cost and order

Seven commits, smallest risk first, each leaving the suite green.

1. **Fix the egress delegation** (P1's live half). Two method bodies in
   `app/langy.app.ts:351-362` repointed from `dependencies.langy` to the
   credential service. Removes an armed production fault; no structural change.
   Add a test that calls `langyEgress.get` through the composed app, which is
   what would have caught it.
2. **Delete the dead persistence limb.** `repositories/langy.repository.ts`,
   `api/public/langy.api.ts`, `LangyService.create`, `private get persistence`,
   the 11 methods of P1, `repositories/__tests__/langy.service.unit.test.ts`,
   and the 11 abstracts from `contract/src/langy.service.ts`. Pure subtraction
   once commit 1 has moved the only live caller. ~600 lines.
3. **Fix the warm-path mint** (P7) and extract P14's five shared blocks into
   `LangyTurnPreparationService.ensureWorkerCredentials`. Delete
   `LangyTurnService` (P3), promoting its three collaborators to `LangyApp`
   fields. Correctness win plus one layer.
4. **Collapse `LangyService` into `LangyApp`** (P4, P5). `PostgresLangyAdapter.build`
   returns `LangyApp`; the four Hono bypass sites move onto real app methods;
   the `langyService` getter goes. Touches `presets.ts:2515`, `:2914`, `:3676`
   and three route files. The largest commit, and the one that needs the
   `langy.router.ts` / `langy-api.ts` / `langy-internal.ts` / `langy-relay.ts`
   tests run together.
5. **Split `LangyConversationService`** (P13) into lifecycle / recording /
   handoff, and make `harness`, `finalParts` and `messages` required (P6). The
   test app gains a `harness` stub; the two dead guards go.
6. **De-duplicate `streaming/`** (P15, P16, P17). Delete the server's
   `COLLECTION_VERBS` and `NOUNS` in favour of the contract's
   `CLI_COLLECTION_VERBS` / `CARDS_BY_RESOURCE` — this is a **behaviour change**
   (the server starts treating `tag` and `types` as collections and stops
   treating `results` as one), so it needs its own commit and a test pinning
   server and web to the same set. Then one `isTerminalFrame` for the five
   copies, one `humanize`, `safeJson` from `platform/app/src/utils/safeJsonParse.ts`.
   Turn `langy-turn-settlement-waiter.ts` and `langy-turn-tail.ts` into the two
   classes their parameter lists already describe, extract the `Pick<>` both
   consumers of `LangyTokenBuffer` converged on into a real port, and split
   `LangyTurnRelay.apply` (`:560-740`) by frame family.
7. **Layout and prose.** Move the five non-ports out of `ports/` and
   `LangyPromptPort` in (P8); move the two `.service.ts` non-services and the
   type guards to `utils/`, the ten error classes to `errors/` (P11, P12); cut
   the two over-ceiling comment blocks, the four heaviest headers and the four
   incident narratives to ADR links, and name the two `allSettled` tuples in
   `langy-turn-preparation.service.ts:131,237` (P9, P16); delete the orphaned
   JSDoc at `streaming/langy-token-buffer.ts:728-732`, the unused logger and
   import at `langy-turn-start.service.ts:6,11,23` (P18), and the stale path in
   `services/langy-cli-envelope.service.ts:27`; trim `index.ts` to the 35 symbols
   with external consumers (P10). Mechanical, reviewable file by file, and it
   clears five entries from
   `packages/architecture-lint/src/port-module-baseline.json`.

## 6. Blast radius

Non-test files outside `packages/features/langy/` that import each package:

| package                     | importers |
| --------------------------- | --------- |
| `@langwatch/langy-web`      | 93        |
| `@langwatch/langy-contract` | 49        |
| `@langwatch/langy-server`   | 17        |

The 17 server importers:

```
platform/app/src/server/app-layer/presets.ts          ← the composition root
platform/app/src/server/app-layer/app.ts
platform/app/src/server/app-layer/config.ts
platform/app/src/server/app-layer/langy/ui-actions/ui-action.service.ts
platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts
platform/app/src/server/routes/langy-ui-actions.ts
platform/app/src/runtime/app/internal-api/langy.router.ts
platform/app/src/runtime/app/features/langy.ts
platform/app/src/runtime/app/features/langy-credentials.adapter.ts
platform/app/src/runtime/app/features/langy-streaming.adapter.ts
platform/app/src/runtime/app/features/langy-title-generation.adapter.ts
platform/app/src/runtime/app/features/langy-turn-settlement.adapter.ts
platform/app/src/runtime/app/features/langy-session-key-metrics.adapter.ts
platform/app/src/runtime/app/features/langy-analytics-event.clickhouse.adapter.ts
platform/app/src/features/langy/logic/langyChatTransport.ts
platform/app/src/features/langy/stores/langyDevLog.ts
packages/architecture-lint/src/test-colocation.ts
```

Plus three route files that reach the service through `LangyApp.langyService`
and are therefore in commit 4's blast radius:
`platform/app/src/server/routes/langy-api.ts`,
`platform/app/src/server/routes/langy-internal.ts`,
`platform/app/src/server/routes/langy-relay.ts`.

Of `index.ts`'s 115 exported symbols, **35 have a consumer outside the feature**.
The most-used: `LangyTurnRequest` (7 files), `LANGY_CANDIDATE_PERMISSIONS` (6),
`LangyTokenBuffer` (6), `LangyConversationProcessingEvent` (3),
`LangySessionKeyService` (3), `LangyStreamEntry` (3), `LangyTrpcApi` (2),
`LangyTurnAccessStore` (2), `LangyTurnHandoffStore` (2),
`EventingLangyMaintenanceAdapter` (2), `LangyTitleGenerator` (2),
`LangySessionKeyMetricsPort` (2), `LangyAnalyticsEventRecord` (2). Single-consumer
but load-bearing: `PostgresLangyAdapter`, `LangyApp`, `LangyEgressTrpcApi`,
`createLangyWorkerPort`, `UnavailableLangyWorkerAdapter`,
`AGENT_CHAT_TIMEOUT_MS`, `decideSyntheticTerminal`, `awaitTurnSettlement`,
`abortableDelay`.

**Nothing outside the feature imports any of the eleven dead operations, the
five dead repositories, or `LangyPublicApi`.** Commits 1-3 are internal.
