# Connected agents restore plan (ADR-128)

**Written:** 2026-09-03
**Branch:** `feat/strict-feature-layout-v0`
**Rule in force (Alex):** nothing that is a feature on `origin/main` may be absent
on this branch. The connected-agent TRANSPORT (WebSocket gateway, HTTP long-poll,
the `/api/v1/agents` REST family with `call`, `connect/*` and `test`, presence
projection, parameter normalisation, agent identity) shipped on main under
ADR-128 and has no counterpart here. The spec-lift of 2026-09-03 recorded its
tests as retired on grep evidence that the code was absent; that reading was
wrong under the rule, and this plan reverses it by restoring the code and
lifting the tests with their `@scenario` lines verbatim.

Source of truth for every module named below: `git show origin/main:<path>`.
Nothing is recreated under `platform/` (that tree is deletes-only).

Related: `dev/docs/adr/128-connected-agents.md` (on `origin/main`; not yet on
this branch — Slice 0 brings it over unchanged),
`specs/agents/connected-agents.feature`,
`specs/features/agents/connected-agents-ui.feature`,
`specs/experiments-v3/connected-agent-target.feature`,
`dev/docs/plans/spec-rebind-manifest.md` rows 191–196 and 874,
`dev/docs/plans/restructure-bug-hunt-2026-09-03.md` ("Connected agents have no
transport on this branch").

---

## 1. What exists on the branch, and what does not

### 1.1 Surviving core — NOT copied again; tests repoint here

| `origin/main` module (`platform/app/src/server/connected-agents/`) | Branch survivor | Notes |
| --- | --- | --- |
| `protocol.ts` | `packages/features/agent/contract/src/connected-agent.protocol.ts` | Same frames. Main imported the parameter-name grammar from `~/server/scenarios/parameters`; the branch restates it so the contract stays zod-only. `parameterNameSchema` is exported. |
| `constants.ts` | `packages/features/agent/contract/src/connected-agent.constants.ts` | Same names. `relayPayloadCaps(overrideMb?)` takes the override as an argument; the process config reads `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB` and passes it (Slice 7). |
| `errors.ts` | `packages/features/agent/contract/src/connected-agent.errors.ts` | All eleven classes present, `remediation` from `@langwatch/handled-error`. Codes are already in `packages/handled-error/src/app-codes.ts` and `presentation.ts`. |
| `keys.ts` + `state-store.ts` | `packages/features/agent/server/src/adapters/connected-agent-state.adapter.ts` | Key family and both stores (`createRedisStateStore`, `createMemoryStateStore`) in one adapter. |
| `instance.registry.ts` | `packages/features/agent/server/src/adapters/connected-agent-registry.adapter.ts` | `InstanceRegistry`, `InstanceMeta`, `LiveInstance`. |
| `call-envelope.ts` | `packages/features/agent/server/src/adapters/connected-agent-envelope.adapter.ts` | `StoredCall`, `StoredResult`, nudges, `buildCallEnvelope`, `resultCapViolation`. `CallOutcome` moved to the contract (`connected-agent.dispatch.ts`). |
| `call.dispatcher.ts` | `packages/features/agent/server/src/adapters/connected-agent-dispatch.adapter.ts` | `CallDispatcher`, `DispatchParams`. `DispatchCall`/`DispatchAgent` live in `connected-agent.dispatch.ts` (contract). |
| `runtime.ts` | `packages/features/agent/server/src/services/connected-agent-runtime.service.ts` | `createConnectedAgentRuntime`, `getConnectedAgentRuntime`, `closeConnectedAgentRuntime`, plus `installConnectedAgentRedis(redis)` replacing main's `tryGetApp()?.redis`. **Nobody calls `installConnectedAgentRedis` in `apps/api` or `apps/worker` today** (`grep -rn installConnectedAgentRedis apps` is empty), so both processes run the dispatcher on a memory store. Slice 7 fixes this. |
| `scenarios/execution/serialized-adapters/connected-agent.adapter.ts` | `packages/features/scenario/server/src/adapters/serialized-connected-agent.adapter.ts` | The child's relay client (`POST {endpoint}/api/v1/agents/:id/call`). Registered for `type: "connected"` in `serialized-agent-registry.adapter.ts`. |
| `suites/connected-targets.ts` (`assertConnectedAgentsRunnable`) | `packages/features/suite/server/src/services/connected-target.service.ts` | Exported from `@langwatch/suite-server`. |
| `experiments-v3/execution/connectedTarget.ts`, `connectedCell` | `packages/features/experiment/server/src/processes/experiment-connected-target.process.ts`, `services/experiment-run-orchestrator.service.ts` (`relayDispatch = getConnectedAgentRuntime().dispatcher.dispatch`) | Already bound to `specs/experiments-v3/connected-agent-target.feature`. Runs on a memory store until Slice 7. |
| `components/agents/connected/*` (UI) | `packages/features/scenario/web/src/ui/sections/agents/connected/{connected-agents-section,connected-agent-drawer,connect-from-code-drawer}.tsx`, `connected-agent-rows.ts`, `connect-snippets.ts` + `__tests__` | Lifted with their `@scenario` lines. Registered as drawers in `apps/ui/src/features/simulations/ui/sections/simulations-drawers.tsx` (`agentConnectedDetail`, `agentConnectFromCode`). **`ConnectedAgentsSection` has no consumer** — nothing renders it (Slice 8). |
| `agent-testing/run/offline-targets.ts`, target picker | `packages/features/scenario/web/src/ui/sections/agent-testing/run/offline-targets.ts`, `target-section.tsx` + tests | Bound. Reads `status`/`instances` off `agents.getAll`, which the branch does not yet supply (Slice 6). |
| `scenarios/parameters` (grammar + caps) | `packages/features/scenario/contract/src/scenario.parameters.ts` | What `parameter-spec.ts` imports. |
| `Agent` Prisma model | `packages/prisma-client/prisma/schema.prisma` lines 2792–2815 | `environment`, `ownerUserId`, `hostLabel`, `identityKey`, `lastSeenAt`, `archivedAt`, `@@unique([projectId, identityKey])`, `@@index([projectId, lastSeenAt])` are all present. No migration is needed. |
| `Agent` contract type | `packages/features/agent/contract/src/agent.ts`, `config/connected.ts` | Carries the five connected columns and `connectedAgentConfigSchema` (`ConnectedAgentConfig` replaces main's `ConnectedComponentConfig`). |

### 1.2 Absent — restored by this plan

| `origin/main` path | Lines | Branch destination (strict grammar) | Exported name(s) |
| --- | --- | --- | --- |
| `platform/app/src/server/connected-agents/identity.ts` | 142 | `packages/features/agent/contract/src/connected-agent.identity.ts` | `DEVELOPMENT_ENVIRONMENT`, `MAX_ENVIRONMENT_LENGTH`, `MAX_HOST_LABEL_LENGTH`, `sanitizeEnvironment`, `isValidEnvironment`, `sanitizeHostLabel`, `ConnectedAgentScope`, `deriveScope`, `identityKeyOf`, `scopeColumns`, `parseConnectedReference`. Browser-safe by main's own docblock ("so the run dialog and the CLI can build the same keys"), which is why it is a contract module beside `connected-agent.protocol.ts`, not a server service. |
| `platform/app/src/server/agents/connected-agent-visibility.ts` | 69 | Split: `CONNECTED_AGENT_UNSEEN_DAYS`, `connectedAgentSeenCutoff`, `isConnectedAgentStale` → `packages/features/agent/contract/src/connected-agent.visibility.ts` (framework-free predicate the browser reads). `connectedAgentVisibleWhere` (a `Prisma.AgentWhereInput` fragment) → stays private inside `packages/features/agent/server/src/repositories/prisma/prisma.agent.repository.ts`, because only `repositories/prisma/**` may name Prisma types. Applied in `findAll`, `findPage`, `findConnectedByNameAndEnvironment` exactly where main's `agent.repository.ts` lines 253/279/372 apply it. | as listed |
| `platform/app/src/server/connected-agents/parameter-spec.ts` | 298 | `packages/features/agent/server/src/services/connected-agent-parameter-spec.service.ts` | `normalizeParameterSchema`, `NormalizedParameters`. Imports `MAX_PARAMETER_DESCRIPTION_LENGTH`, `MAX_PARAMETER_OPTIONS`, `MAX_PARAMETER_VALUE_LENGTH`, `MAX_SCENARIO_PARAMETER_DEFINITIONS`, `scenarioParameterDefinitionsSchema`, `ScenarioParameterType`, `ScenarioParameterValue` from `@langwatch/scenario-contract` (new dependency of `@langwatch/agent-server`; a server package may depend on another feature's CONTRACT — it already depends on `trace-contract` and `workflow-contract`). `TURN_FIELD_NAMES`, `AgentParameterInvalidError`, `parameterNameSchema` from `@langwatch/agent-contract`. The `services/` folder admits only `<subject>.service.ts`; a pure derivation module goes in as a service (see `strict-feature-source-layout-grammar`). |
| `platform/app/src/server/connected-agents/presence.projection.ts` | 61 | `packages/features/agent/server/src/projections/connected-agent-presence.projection.ts` | `touchAgentLastSeen({ agentId, projectId, repository, now })`, `resetLastSeenThrottle`. Takes the feature's `AgentRepository` (new method `touchLastSeenAt`) instead of `PrismaClient`. `projections/` is a PRIVATE server folder (`PRIVATE_SERVER_EXPORT` in `feature-layout.ts`): do NOT export it from `src/index.ts`; only `connected-agent-session.service.ts` and the lifted tests reach it, by relative import. This is NOT a worker projection: on main it is a throttled synchronous write from the session core in the process that holds the socket, and it stays there (see §5). |
| `platform/app/src/server/connected-agents/presence.read.ts` | 122 | `packages/features/agent/server/src/services/connected-agent-presence.service.ts` | `AgentPresenceStatus`, `AgentInstanceView`, `AgentPresence`, `NO_PRESENCE`, `AgentOwnerView`, `agentPresenceView`, `readAgentPresence({ projectId, agents, runtime })`. Redesign at the seam only: the runtime is a parameter (the app hands in `getConnectedAgentRuntime()`), so a test no longer needs `vi.mock` of the runtime module. |
| `platform/app/src/server/connected-agents/session.core.ts` | 593 | `packages/features/agent/server/src/services/connected-agent-session.service.ts` | `AgentSessionCore`, `ConnectCredentials`, `SessionInfo`, `SessionCoreOptions`. Class name kept; constructor options change from `{ runtime, prisma, replicaCount, now }` to `{ runtime, agents: AgentService, credentials: ConnectCredentialPort, agentPlatformUrl: AgentPlatformUrlBuilder, replicaCount, now }`. Everything main did through `prisma` is either the feature's own service (`registerConnected`, via `AgentService`) or the credential port. `touchAgentLastSeen` is called through the repository the service owns. |
| `platform/app/src/server/connected-agents/long-poll.transport.ts` | 558 | `packages/features/agent/server/src/services/connected-agent-long-poll.service.ts` | `LongPollTransport`, `LongPollTransportOptions`, `RegisterAnswer`, `INSTANCE_TOKEN_HEADER`, `refusalStatus`. Not a Hono module — it is the session table, watches and delivery-once claim under an instance token, which is why it is a service; the three routes that carry it are `agent-connect.api.ts` below. Options as for the session service. |
| `platform/app/src/server/connected-agents/long-poll.process.ts` | 28 | **Dissolves into the composition root** (`apps/api/src/app/api-connected-agents.composition.ts`, §4.1). Main's module was `env` + `prisma` + a module-level singleton; on this branch config and Prisma are the composition's, and one `LongPollTransport` per process is built there and closed in the process's drain. Not a `processes/` artifact: `processes/<name>.process.ts` in the grammar is a long-running background process, and this was a lazily built singleton for request handlers. |
| `platform/app/src/server/connected-agents/connect.gateway.ts` | 391 | `packages/features/agent/server/src/transport/api-ws/connected-agent-connect.api.ts` | `ConnectGateway`, `ConnectGatewayOptions`, `CONNECT_PATH = "/api/v1/agents/connect"`. `mount(router: ConnectUpgradeRouterPort)`. New surface directory `api-ws` under `transport/` (the grammar is `transport/<surface>/<name>.api.ts`, and the surface names the door). Adds `ws@^8.21` to `@langwatch/agent-server` — `ws@8.21.x` is already in `pnpm-lock.yaml` through `sdks/typescript`, so no new third-party package enters the workspace. |
| `platform/app/src/server/websockets/upgrade-router.ts` | 47 | Port: `packages/features/agent/server/src/ports/connect-upgrade-router.port.ts` — `abstract class ConnectUpgradeRouterPort { abstract register(pathname: string, handler: UpgradeHandler): void }` (`ports/` must export an abstract class ending in `Port`). Implementation: `apps/api/src/api-upgrade-router.ts` — main's `createUpgradeRouter(server)` moved verbatim (one `upgrade` listener, path-routed, 404 + destroy for unknown paths), wrapped as `class ApiUpgradeRouter extends ConnectUpgradeRouterPort`. Main's `trpc-ws.ts` is NOT restored: on this branch tRPC subscriptions ride `/api/sse` (commit 3aedccbb74), so the gateway is the router's only registrant. |
| `platform/app/src/app/api/agents/[[...route]]/agents.v1.ts` | 454 | `packages/features/agent/server/src/transport/api-rest/agent-v1.api.ts` | `createAgentV1RestApp({ security, agents: () => AgentApp, agentPlatformUrl, connect, call })` returning `SecuredApp<{ Variables: AppRestProjectVariables }>` over `security.createProjectApp({ basePath: "/api/v1/agents" })` — the shape `coding-agent-v1.api.ts` and `agent-legacy.api.ts` already use, replacing main's `createProjectService(...).version(V1_API_VERSION, v => ...)` builder which does not exist here. Registers, in this order (main's comment: the static `/connect/*` paths first, or `/:id` answers for the segment `connect`): `registerConnectEndpoints`, then list/create/read/update/archive/test, then `registerCallEndpoint`. Every read carries `withConnectedAgentViews` (presence, owner, `parameters`); create/update of `type: "connected"` answer 422 `agent_register_only` (`AgentRegisterOnlyError` exists in `agent.errors.ts`); the `POST /:id/test` route calls `AgentApp.testRun` (the other agent's work, §6). |
| `platform/app/src/app/api/agents/[[...route]]/call.v1.ts` | 298 | `packages/features/agent/server/src/transport/api-rest/agent-call.api.ts` | `registerCallEndpoint`, `relayCallBodySchema`, `relayCallResponseSchema`. `POST /:id/call`, `requires("scenarios:create")`, `bodyLimit` from `@langwatch/api/rest`, dispatches on `runtime.dispatcher`, refuses a personal agent of another person through an `assertRunnable` port (composed in `apps/api` from `@langwatch/suite-server`'s `assertConnectedAgentsRunnable` — a feature server package may not import another feature's server package). |
| `platform/app/src/app/api/agents/[[...route]]/connect.v1.ts` | 316 | `packages/features/agent/server/src/transport/api-rest/agent-connect.api.ts` | `registerConnectEndpoints`, `postedFramesSchema`, `registerAnswerSchema`, `pollAnswerSchema`, `framesAnswerSchema`. `POST /connect/register`, `GET /connect/poll`, `POST /connect/frames` under `handlerManagedAuth({ reason, credential: "apiKey", permissions: ["scenarios:manage"] })` (exists in `@langwatch/api`), authenticating inside the handler through the transport's session service so the refusal is the `refused` frame the SDK reads. `requestBodySchema` (main's `~/server/routes/misc.schemas`) is restated locally as `evaluations-legacy.schemas.ts` does. |
| `platform/app/src/app/api/agents/[[...route]]/app.ts`, `alias.ts` | 50, 38 | `app.ts` dissolves into `createAgentV1RestApp` plus the mount in `apps/api/src/app-rest/app-rest.packaged-families.ts` (new family name `"agents-v1"`). `alias.ts` is already `agent-legacy.api.ts` (family `"agents"`, mounted). Judgment recorded: main served the alias from the SAME handler declarations (`registerAgentEndpoints({ docs: "hidden" })`); the branch's legacy family has its own bodies. Keep `agent-legacy.api.ts` as it is in this plan; the deduplication onto one declaration is a follow-up, because it edits a family that already passes its parity test. |
| `platform/app/src/app/api/agents/agent-platform-url.ts` | 30 | Already `apps/api/src/features/agent/agent-platform-url.ts` — but it dropped the `agentConnectedDetail` branch. Restore the three-way choice (`http` → `agentHttpEditor`, `connected` → `agentConnectedDetail`, else `agentCodeEditor`). One-line edit in `apps/api`, not platform. |
| `platform/app/src/server/agents/agent.service.ts` (connected half) | — | `packages/features/agent/server/src/services/agent.service.ts` gains `registerConnected`, `ownersOf`, `getConnectedByNameAndEnvironment`, the `refuseConnectedUpdate` guard in `create`/`update`, and `declaredAgentParameters`/`toAgentListRow` (the REST list row). `packages/features/agent/contract/src/agent.service.ts` (abstract) gains `registerConnected`, `ownersOf`, `getConnectedByNameAndEnvironment`; `apps/api/src/api.application.ts`'s `MissingAgentService` gains the three `unavailable()` overrides. `ConnectedAgentIdentity` (main's `agent.repository.ts` line 118) becomes a contract type in `connected-agent.identity.ts`. |
| `platform/app/src/server/agents/agent.repository.ts` (connected half) | — | `packages/features/agent/server/src/repositories/agent.repository.ts` (abstract) + `repositories/prisma/prisma.agent.repository.ts` gain `findByIdentityKey`, `findConnectedByNameAndEnvironment`, `reregisterConnected`, `touchLastSeenAt`, `findUserNamesByIds` (for `ownersOf`; a `prisma.user` read on the same client, so it is this repository's), `create` accepting the identity columns with `lastSeenAt: new Date()`, and the visibility fragment on the three reads. |
| `platform/app/src/server/api/routers/agents.ts` `withConnectedAgentViews` (lines 33–65) | — | `packages/features/agent/server/src/app/agent.app.ts`: `AgentAppDependencies` gains `connected?: { presence: (input) => Promise<AgentPresence-by-id>; runtime: () => ConnectedAgentRuntime }` and `getAll`/`getById` answer the enriched view (`parameters`, `owner`, `status`, `instances`). Both doors — `agent.api.ts` (tRPC) and `agent-v1.api.ts` (REST) — read the app, so they cannot disagree, which is what the `app/` folder exists for. |
| `platform/app/src/start.ts` lines 383–396, 478–482 (gateway wiring, shutdown phase) | — | `apps/api/src/app/api-connected-agents.composition.ts` + `apps/api/src/api-http.listener.ts` (upgrade port) + `apps/api/src/api.process.ts` (drain order). §4.1. |
| `LANGWATCH_APP_REPLICAS`, `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB` (`env.mjs`) | — | `apps/api/src/platform/config/api.config.ts` → `infrastructure.connectedAgents.{replicaCount (default 1), relayMaxPayloadMb (optional)}`. `apps/worker/src/platform/config/worker.config.ts` needs neither: the worker never registers an instance and never answers a relay request. |

### 1.3 Grammar check before creating any file

`SERVER_PATTERNS` in `packages/architecture-lint/src/feature-layout.ts`:
`services/<name>.service.ts`, `ports/<name>.port.ts` (abstract class ending in
`Port`), `repositories/prisma/prisma.<name>.repository.ts`,
`projections/<name>.projection.ts`, `adapters/<name>.adapter.ts`,
`transport/<surface>/<name>.api.ts`. There is no `utils`, `types` or `rules`
kind. Contract files follow the existing `connected-agent.<noun>.ts`
precedent (`protocol`, `dispatch`, `constants`, `errors`) — the same
`CONTRACT_ARTIFACT` regex already tolerates them, and the integrator diffs the
`pnpm --filter @langwatch/architecture-lint lint` violation LIST (not the
total) after every slice.

---

## 2. Runtime diagram

```
 customer process                       LangWatch apps/api (N replicas)                        Redis (shared state)
 ───────────────                        ──────────────────────────────                          ────────────────────
 langwatch SDK
 @connect_agent / connectAgent
      │
      │ GET /api/v1/agents/connect  (HTTP Upgrade, Bearer key [+ X-Project-Id])
      ├──────────────────────────────▶ ApiHttpListener.server.on("upgrade")
      │                                └▶ ApiUpgradeRouter (path → handler, else 404+destroy)
      │                                    └▶ ConnectGateway  (transport/api-ws)          ┐
      │  register ──▶  registered/refused    │  AgentSessionCore (services/…-session)      │  agent_instance:v1:<p>:<a>   ZSET
      │  ◀── call     ack/result ──▶         │   ├ ConnectCredentialPort  ← apps/api adapter over ApiKeyService.tryResolveToken
      │  ◀── cancel   deregister ──▶         │   ├ normalizeParameterSchema (services/…-parameter-spec)
      │  ping/pong                           │   ├ AgentService.registerConnected → PrismaAgentRepository (upsert by identityKey)
      │                                      │   ├ touchAgentLastSeen (projections/…-presence)  → Agent.lastSeenAt ≤ 1/min
      │                                      │   └ runtime.registry.register()  ──────────────▶ instance set + meta hash
      │                                      │                                                 agent_pending:v1:<inst>  ZSET
      │  or, when WebSockets are blocked:    │                                                 agent_call:v1:<callId>   (envelope)
      │  POST /connect/register              │  LongPollTransport (services/…-long-poll)        agent_result:v1:<callId>
      │  GET  /connect/poll  (held ≤25 s)    │   session under instance token (httpSessionKey)  pub/sub: agent_instance_calls:v1:<inst>
      │  POST /connect/frames                │   delivery-once claim (callDeliveredKey)                  agent_reply:v1:<pod>
      └──────────────────────────────▶ agent-connect.api.ts (transport/api-rest, handler-managed auth)   agent_instance_gone:v1
                                                                                                        │
 relay callers                                                                                          │
 ─────────────                                                                                          │
 scenario child (apps/worker, no Redis/DB)  ──POST /api/v1/agents/:id/call (project key)──▶ agent-call.api.ts ─┤
   SerializedConnectedAgentAdapter                                                           requires scenarios:create
 Test panel  → tRPC agents.testTurn  → AgentApp.testTurn → AgentTestPort (apps/api adapter)  → runtime.dispatcher.dispatch
 langwatch agent run / MCP platform_run_agent ──POST /:id/call───────────────────────────────▶   CallDispatcher (adapters/…-dispatch)
 experiment connected cell (apps/worker) → relayDispatch = getConnectedAgentRuntime().dispatcher ─┘   pick instance (free slots / sticky pin)
                                                                                                    write envelope + pending, nudge channel
                                                                                                    wait ack → result key or reply nudge
                                                                                                    agent_offline / _busy / _timeout / _disconnected

 installConnectedAgentRedis(redis) MUST be called in BOTH processes (api: queue Redis; worker: groupQueue Redis)
 or each runs its own memory store and a dispatch never sees an instance another process registered.
```

Presence read path: `agents.getAll`/`getById` (tRPC) and `GET /api/v1/agents`
(REST) → `AgentApp` → `readAgentPresence({ runtime })` → one ZSET read per
agent + the meta hash per live instance → `status: online|offline`,
`instances[]`, `owner` (from `ownersOf`), `parameters` (from the config). The
30-day rule (`connectedAgentVisibleWhere`) is applied in the repository reads,
so a stale connected row is simply not listed and is refused as a target.

---

## 3. WebSocket hosting decision

**Decision: host the upgrade on `apps/api`'s own Node HTTP server, beside the
Hono request listener, through an upgrade port on `ApiHttpListener`; keep the
HTTP long-poll transport beside it as main did. Not long-poll only.**

Why the socket is not dropped:

- Both SDKs open the socket FIRST (Python: `websockets` on a daemon thread;
  TypeScript: `ws`) and the three long-poll routes exist "for a network that
  blocks WebSockets" (ADR-128, Transport). Shipping long-poll alone would
  change the primary path of every deployed SDK and is a deleted feature under
  the rule.
- `apps/api/src/api-http.listener.ts` already owns a raw `node:http`
  `createServer(...)` (it needs it for the hosted MCP surface, served ahead of
  Hono through `ApiRawRequestSurfacePort`). An `upgrade` event is a second
  event on the same server object; `@hono/node-server`'s `getRequestListener`
  never sees it. Main did exactly this (`start.ts` lines 383–396) with a
  path-routed `upgrade` listener shared by tRPC-WS and the gateway.
- `ws@8.21.x` is already resolved in the lockfile (via `sdks/typescript`), so
  the dependency edge is new for `@langwatch/agent-server` but the package is
  not new to the workspace.
- There is no other WebSocket server in `apps/api` or `apps/worker` today
  (`grep -rn "websocket\|upgrade" apps/*/src` finds only copy text), and tRPC
  subscriptions moved to `/api/sse`, so the gateway is the only registrant of
  the new router. The 404-and-destroy default for unknown upgrade paths comes
  with main's router and stays.

Shape:

- `ApiHttpListenerOptions` gains `upgrades?: ApiUpgradeSurfacePort` — an
  abstract class in `api-http.listener.ts` next to `ApiRawRequestSurfacePort`:
  `abstract attach(server: http.Server): void`. The constructor calls
  `upgrades.attach(this.server)` after `createServer`. `ApiUpgradeRouter`
  (`apps/api/src/api-upgrade-router.ts`, main's `upgrade-router.ts` body)
  implements both `ApiUpgradeSurfacePort.attach` and the package's
  `ConnectUpgradeRouterPort.register`.
- Drain order (main's `start.ts` shutdown phase `connected-agents`, after the
  HTTP drain): `ApiProcess.close` → listener drain → `ConnectGateway.close()`
  (closes sockets with code 1012 so the SDK reconnects at once) →
  `LongPollTransport.close()` → `closeConnectedAgentRuntime()` → resources.
- Deployment consequence (ADR-128 already states it): the ingress in front of
  `apps/api` must forward the `Upgrade` on `/api/v1/agents/connect` and hold a
  read timeout above 25 s for `/connect/poll`. Under haven/portless the
  `app.<slug>…/api` route must proxy upgrades; verify with a socket client
  against a running stack in Slice 7 (this is the one place `pnpm dev` is
  needed, and it is a manual check, not a test).

---

## 4. Composition wiring

### 4.1 `apps/api`

New file `apps/api/src/app/api-connected-agents.composition.ts`:

```
export abstract class ApiConnectedAgentsAbsenceReportPort {
  abstract withoutSharedStore(replicaCount: number): void;   // memory store on a multi-replica deployment
  abstract withoutDatabase(): void;                          // no registration possible → family not mounted
}

export class ApiConnectedAgentsComposition {
  static tryCompose(options: {
    database: PrismaConnection | undefined;
    redis: RedisConnection | null;                 // this.composedQueueRedis
    agents: AgentService;                          // resolveAgents(...)
    apiKeys: ApiKeyService;                        // the identity half's
    credentials: ApiHandlerManagedCredentials;     // enforceCeiling(scenarios:manage)
    projectsReachableBy: (organizationId) => Promise<{id,name}[]>;  // for `project_required`
    agentPlatformUrl: AgentPlatformUrlBuilder;     // createAgentPlatformUrlBuilder(platformUrl)
    replicaCount: number;                          // config.infrastructure.connectedAgents.replicaCount
    relayMaxPayloadMb?: number;
    report?: ApiConnectedAgentsAbsenceReportPort;
  }): ApiConnectedAgentsComposition | undefined
  readonly runtime: ConnectedAgentRuntime;         // installConnectedAgentRedis(redis) then getConnectedAgentRuntime()
  readonly gateway: ConnectGateway;
  readonly longPoll: LongPollTransport;
  readonly credentials: ConnectCredentialPort;     // ApiConnectCredentialAdapter (below)
  readonly assertRunnable: (…) => Promise<void>;   // @langwatch/suite-server assertConnectedAgentsRunnable + agent owner-name reader
  mount(router: ConnectUpgradeRouterPort): void;   // gateway.mount(router)
  close(): Promise<void>;                          // gateway → longPoll → closeConnectedAgentRuntime
}
```

- `apps/api/src/features/agent/agent-connect-credential.adapter.ts` —
  `class ApiConnectCredentialAdapter extends ConnectCredentialPort`. Main's
  `AgentSessionCore.authenticate` did four things, and each has a branch
  counterpart: `TokenResolver.resolve({ token, projectId })` →
  `ApiKeyService.tryResolveToken(...)` (`@langwatch/api-key-contract`,
  returns `ResolvedApiKeyToken` with `type: apiKey | legacyProjectKey |
  apiKey-org`, `userId`, `ingestionTemplateId`, `project`);
  `assertKeyKindMayConnect` (refuse ingestion keys — `ingestionTemplateId !==
  null` — and the Langy session key by its reserved name) → the adapter;
  `assertKeyMayManageScenarios` → `ApiHandlerManagedCredentials.enforceCeiling({
  resolved, permission: "scenarios:manage" })`; `refusalForMiss` (`project_required`
  with `meta.projects` when an org-scoped key names no project) → the
  `projectsReachableBy` read the composition hands in. The integrator MUST
  read main's `session.core.ts` lines 100–180 and the branch's
  `api-handler-managed-credential.ts` side by side and prove each refusal code
  still fires (`connect.gateway.integration.test.ts` scenarios "An ingestion
  key cannot connect" … "An invalid key cannot connect" are the proof).
- `apps/api/src/features/agent/agent-test.adapter.ts` — the other agent's
  `AgentTestPort` implementation (§6). Not this plan's file; named so the two
  do not collide.
- `apps/api/src/app/api-production.composition.ts`: build
  `ApiConnectedAgentsComposition` beside `resolveAgents`, pass `upgrades:
  ApiUpgradeRouter.create()` into `listener`, call `connected.mount(router)`,
  and add `connected.close()` to the drain (`api.process.ts`, after the
  listener drains). The absence report logs on `LoggedApi…Absence` like the
  agents one.
- `apps/api/src/app-rest/app-rest.packaged-families.ts`: family `"agents-v1"`
  → `createAgentV1RestApp({ security, agents, agentPlatformUrl, connect: {
  transport: () => connected.longPoll, credentials: connected.credentials },
  call: { runtime: () => connected.runtime, assertRunnable:
  connected.assertRunnable } })`. Mounted only when the composition exists;
  `ApiPackagedRestFamilyName` gains the literal. The frozen OpenAPI document
  (`apps/api/src/features/discovery/openapi-document.json`) already lists these
  operations; `api-rest.packaged-families.integration.test.ts` is where the
  route-registry/policy audit will notice the new family.
- `apps/api/src/api.application.ts`: `MissingAgentService` overrides for the
  three new abstract methods; `ApiServices.agents` (`AgentApp`) is built with
  `connected: { presence, runtime }` when the composition exists.
- `apps/api/src/platform/config/api.config.ts`:
  `infrastructure.connectedAgents.replicaCount` from `LANGWATCH_APP_REPLICAS`
  (default 1) and `relayMaxPayloadMb` from `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`.

### 4.2 `apps/worker`

The worker composes NOTHING of the transport, and this is main's shape, not a
gap: the scenario child reaches a connected agent over HTTP with the project
key (`serialized-connected-agent.adapter.ts` — "the child has no Redis and no
database"), the WebSocket and long-poll sessions live in the process that owns
the listener, and `touchAgentLastSeen` is a synchronous, throttled write from
that same session core. Moving `presence.projection` or `long-poll.process`
into the worker would invent an API → worker event for a once-a-minute column
write; that is a redesign, not a lift.

One worker file IS required: `apps/worker/src/app/worker-connected-agent-runtime.composition.ts`
— `installConnectedAgentRedis(eventingOptions.groupQueue.redis)` when Redis is
configured, `closeConnectedAgentRuntime()` in the drain. Reason: the experiment
orchestrator's `relayDispatch` (`experiment-run-orchestrator.service.ts` line
1912) calls `getConnectedAgentRuntime().dispatcher` in the worker; on a memory
store it can never see an instance the API registered, so every connected
experiment column would fail `agent_offline` after the 15 s grace. Wire it in
`worker-production.composition.ts` beside the other Redis consumers (line
~466, `processRedis`). No installer in `apps/worker/src/features/` — there is no
pipeline, job or projection to register, and `catalogue.json`/`job-registry.json`
stay untouched.

### 4.3 `apps/ui` (Slice 8)

`ConnectedAgentsSection` (scenario-web) has no consumer. Main's
`pages/[project]/agents.tsx` split `agents.getAll` into connected and other
agents and rendered the section above the cards, opening `agentConnectedDetail`
on click. On the branch the agents screen is
`packages/features/agent/web/src/screens/agent-management/agent-management.screen.tsx`,
and `agent-web` cannot import `scenario-web` (scenario-web already imports
`@langwatch/agent-web/screens/agent-management`, so the reverse edge is a
cycle). Resolution at the seam: `AgentManagementHostPort`
(`packages/features/agent/web/src/model/agent-management-host.ts`) gains an
optional `connectedSection?: ComponentType<{ agents: ConnectedAgentView[];
onOpen(id): void; onDelete(id): void }>` slot; the screen renders it with the
`type === "connected"` rows when present; `apps/ui/src/features/agent/index.ts`
passes scenario-web's `ConnectedAgentsSection` and the `agentConnectedDetail`
drawer address. `ConnectedAgentView`'s type moves to `@langwatch/agent-contract`
if the slot's prop type needs it (browser-safe, it is presence + owner +
parameters — the same view `AgentApp` answers), which also removes the
`as unknown as ConnectedAgentView[]` cast main carried.

---

## 5. Tests to lift (verbatim `@scenario` lines), and where each lands

Rule from `spec-rebind-manifest.md` §"Lift, never rewrite": `git show
origin/main:<file>` into the destination, rename to `<subject>.<level>.test.ts`,
repoint imports, keep every `@scenario` line as it is. The manifest rows
191–196 and 874 are then corrected from "retired" to the destinations below.
`check-feature-parity.ts` counts only tagged scenarios bound by an `@scenario`
annotation; all of `specs/agents/connected-agents.feature` is tagged
`@unit`/`@integration`, so every unlifted test is a scenario that reads as
unbound today.

| `origin/main` test | Destination | Repoint | Datastore |
| --- | --- | --- | --- |
| `server/connected-agents/__tests__/protocol-and-identity.unit.test.ts` | Split: the three protocol scenarios are ALREADY in `packages/features/agent/contract/src/__tests__/connected-agent-protocol.unit.test.ts`; the four identity scenarios ("The environment is sanitized…", "…personal key belongs to its owner", "…project key is scoped to its host", "An agent in any other environment is shared") → `packages/features/agent/contract/src/__tests__/connected-agent-identity.unit.test.ts` | `../connected-agent.identity` | none |
| `server/connected-agents/__tests__/parameter-spec.unit.test.ts` (6 scenarios) | `packages/features/agent/server/src/services/__tests__/connected-agent-parameter-spec.service.unit.test.ts` | `../connected-agent-parameter-spec.service` | none |
| `server/connected-agents/__tests__/presence.read.unit.test.ts` | `packages/features/agent/server/src/services/__tests__/connected-agent-presence.service.unit.test.ts` | pass a fake `runtime` instead of `vi.mock("../runtime")` | none |
| `server/connected-agents/__tests__/long-poll.unit.test.ts` (3 scenarios) | `packages/features/agent/server/src/services/__tests__/connected-agent-long-poll.service.unit.test.ts` | `createMemoryStateStore` from the state adapter; fake `AgentService`/`ConnectCredentialPort` | none |
| `server/connected-agents/__tests__/gateway-guards.unit.test.ts` (3 scenarios) | `packages/features/agent/server/src/transport/api-ws/__tests__/connected-agent-connect.api.unit.test.ts` | a local `node:http` server + a minimal `ConnectUpgradeRouterPort` fake (main used `createUpgradeRouter` directly — lift its 20 lines into the test as the fake) | none (real `ws` client on loopback) |
| `server/connected-agents/__tests__/call.dispatcher.unit.test.ts` (13 scenarios) | ALREADY `packages/features/agent/server/src/services/__tests__/connected-agent-runtime.service.unit.test.ts` — do not lift again | — | — |
| `server/connected-agents/__tests__/state-store.unit.test.ts` | ALREADY `packages/features/agent/server/src/adapters/__tests__/connected-agent-state.adapter.unit.test.ts` (no `@scenario` lines on main either) | — | — |
| `server/connected-agents/__tests__/connect.gateway.integration.test.ts` (15 scenarios; real Postgres + real Redis + real sockets over two runtimes) | `apps/api/src/features/agent/__tests__/connected-agent-gateway.integration.test.ts` | `ApiConnectedAgentsComposition` over the test Prisma client and `RedisConnectionService().connect({ url: process.env.REDIS_URL … })` as main did (`api-experiment-run.composition.integration.test.ts`'s `testRedis()` is the branch precedent); API-key rows through `@langwatch/api-key-server` | Postgres + Redis |
| `app/api/agents/__tests__/long-poll-route.integration.test.ts` (11 scenarios) | `apps/api/src/features/agent/__tests__/connected-agent-long-poll-route.integration.test.ts` | drive `createAgentV1RestApp(...).hono` the way `api-rest.packaged-families.integration.test.ts` drives a family | Postgres + Redis |
| `app/api/agents/__tests__/call-route.integration.test.ts` (4 scenarios) | `apps/api/src/features/agent/__tests__/connected-agent-call-route.integration.test.ts` | replace `vi.mock("~/server/connected-agents/runtime")` with a fake runtime passed to the family | Postgres |
| `app/api/agents/__tests__/connected-agents-rest.integration.test.ts` (2 scenarios) | `apps/api/src/features/agent/__tests__/agent-v1-connected-rest.integration.test.ts` | same family | Postgres |
| `server/agents/__tests__/connected-agent.service.integration.test.ts` (7 scenarios) | `apps/api/src/features/agent/__tests__/connected-agent-registration.integration.test.ts` — drives `PostgresAgentAdapter.create(...).build()` against the test database. Placed in `apps/api` because `@langwatch/agent-server` has no vitest config and no datastore lane, and this test needs Postgres. | `@langwatch/agent-server` | Postgres |
| `server/agents/__tests__/agent-test-turn.unit.test.ts` (1 scenario, `agent-test-run.feature`) | The other agent's (§6). Its `vi.mock("~/server/connected-agents/runtime")` becomes a fake `AgentTestPort`/runtime; note here only so the two lifts do not both claim it. | — | — |
| `server/suites/__tests__/connected-targets.{unit,integration}.test.ts` | Check `packages/features/suite/server` first: `assertConnectedAgentsRunnable` moved there but the manifest (rows 519, 791) routed these tests to `prompt/server` and `test-harness`, which is wrong. The six integration scenarios ("A teammate cannot target…", "…by name and environment", …) need `getConnectedByNameAndEnvironment` from Slice 2. Lift into `packages/features/suite/server/src/services/__tests__/connected-target.service.{unit,integration}.test.ts` in Slice 5 if not already bound (`grep -rn "@scenario \"A run can address a connected agent by name and environment\"" packages` decides). | `@langwatch/suite-server`, `@langwatch/agent-server` | Postgres (integration) |
| `server/scenarios/execution/__tests__/connected-agent-execution.unit.test.ts` (3 scenarios) | Verify already bound in `packages/features/scenario/server/src/adapters/__tests__/serialized-connected-agent.adapter.unit.test.ts`; lift the missing titles there. | — | none |
| UI: `components/agents/connected/__tests__/*` | ALREADY lifted into `packages/features/scenario/web/src/ui/sections/agents/connected/__tests__/` with all `@scenario` lines. Missing bindings to verify: "Connect from code is the first choice of the new agent flow", "Connect from code opens the connect drawer" (`agent-type-selector-drawer.test.tsx` in agent-web), "An empty agents page still opens the new agent flow" (`agents-empty-state` — manifest row 596). | — | jsdom |

Spec files: `specs/agents/connected-agents.feature` and
`specs/features/agents/connected-agents-ui.feature` are byte-identical to main
on this branch (`git diff origin/main -- specs/agents/connected-agents.feature`
is empty). Do not edit them; do not add `@unimplemented`.

---

## 6. `agents.testRun` / `agents.testTurn` — dependency on this transport, precisely

Another agent restores these two procedures through `AgentTestPort`
(`packages/features/agent/server/src/ports/agent-test.port.ts`, untracked in
the working tree) with an adapter in `apps/api`. What they need from main, by
import:

- `agents.testRun` → `AgentService.testRun` → `scheduleAgentTestRun`
  (`platform/app/src/server/agents/agent-test-run.ts`). Imports: agent-test
  scenario constants, `prefetchScenarioData`/`createDataPrefetcherDependencies`
  (branch: `ScenarioExecutionPrefetcherService` + `prefetchAgentTestData` in
  `packages/features/scenario/server/src/services/`), `withActor`,
  `generateBatchRunId`, `assertConnectedAgentsRunnable` (`@langwatch/suite-server`),
  `getApp()` to enqueue. **It imports nothing from `connected-agents/`.** For a
  `connected` target the prefetcher writes `ConnectedAgentData { endpoint,
  agentId, projectApiKey }` and the child calls `POST /api/v1/agents/:id/call` —
  so a test run of a connected agent needs Slice 5 (the call route) and a live
  instance (Slices 3/4/7) to SUCCEED at runtime, but the procedure's code
  depends only on `scenario-server` and `suite-server`.
- `agents.testTurn` → `sendAgentTestTurn` (`agent-test-turn.ts`). Imports
  `DEFAULT_CALL_TIMEOUT_MS`, `MAX_CALL_TIMEOUT_MS`, `AgentCallTimeoutError`
  (all in `@langwatch/agent-contract` today), `getConnectedAgentRuntime`
  (`@langwatch/agent-server` today) for `dispatchConnectedTurn`,
  `assertConnectedAgentsRunnable`, and the prefetcher + `createAdapter` for the
  other kinds. **It imports nothing this plan restores.** Its connected branch
  is inert until Slice 7 installs Redis into the runtime and Slices 3/4 give an
  instance a way to register: until then `getConnectedAgentRuntime()` is a
  memory store with no instances and every connected `testTurn` answers
  `agent_offline` after the 15 s first-turn grace. That is the same runtime
  dependency the experiment connected cell already has.

Cross-feature rule reminder for that adapter: `@langwatch/agent-server` may not
import `@langwatch/suite-server` or `@langwatch/scenario-server`; the
`AgentTestPort` adapter that reaches both lives in `apps/api/src/features/agent/`.

---

## 7. Integration slices, in order

Each slice: lift → repoint → run the named package suites → run the package's
own `typecheck` script for the packages listed → `pnpm --filter
@langwatch/architecture-lint lint` and diff the violation list. Never the
whole-repo typecheck. Never `git add -A`, stash, restore, checkout `--`, reset
or clean; other agents are editing `packages/features/agent/server/src/app/agent.app.ts`,
`index.ts` and `apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts`
right now — read the working tree, not HEAD, before touching those three.

**Slice 0 — ADR and manifest.** `git show origin/main:dev/docs/adr/128-connected-agents.md
> dev/docs/adr/128-connected-agents.md` (unchanged; the ADR is a feature record).
Correct `spec-rebind-manifest.md` rows 191–196 and 874 to the destinations in
§5. No tests. No typecheck.

**Slice 1 — contract.** `connected-agent.identity.ts`,
`connected-agent.visibility.ts`, `ConnectedAgentIdentity` type, barrel exports;
`connected-agent-identity.unit.test.ts`.
Tests: `pnpm --filter @langwatch/agent-contract test`.
Typecheck: `@langwatch/agent-contract`.

**Slice 2 — agent server domain.** Repository port + Prisma repository methods
and the visibility fragment; `AgentService` connected half; abstract service
additions + `MissingAgentService` overrides in `apps/api/src/api.application.ts`;
`connected-agent-parameter-spec.service.ts` (+ `@langwatch/scenario-contract`
dependency); `connected-agent-presence.projection.ts`;
`connected-agent-presence.service.ts`. Tests: parameter-spec and presence unit
tests in agent-server; `connected-agent-registration.integration.test.ts` in
apps/api.
Tests: `pnpm --filter @langwatch/agent-server test`,
`pnpm --filter @langwatch/platform-api test src/features/agent`.
Typecheck: `@langwatch/agent-contract`, `@langwatch/agent-server`,
`@langwatch/platform-api` (the abstract service grew).

**Slice 3 — session and long-poll services.** `ports/connect-credential.port.ts`,
`connected-agent-session.service.ts`, `connected-agent-long-poll.service.ts`;
`connected-agent-long-poll.service.unit.test.ts` (3 scenarios).
Tests: `pnpm --filter @langwatch/agent-server test`.
Typecheck: `@langwatch/agent-server`.

**Slice 4 — WebSocket gateway.** `ports/connect-upgrade-router.port.ts`,
`transport/api-ws/connected-agent-connect.api.ts`, `ws` dependency;
`connected-agent-connect.api.unit.test.ts` (gateway-guards, 3 scenarios);
`apps/api/src/api-upgrade-router.ts`; `ApiUpgradeSurfacePort` + `upgrades`
option on `ApiHttpListener`.
Tests: `pnpm --filter @langwatch/agent-server test`,
`pnpm --filter @langwatch/platform-api test src/__tests__` (listener tests, if any).
Typecheck: `@langwatch/agent-server`, `@langwatch/platform-api`.

**Slice 5 — REST v1 family.** `agent-v1.api.ts`, `agent-call.api.ts`,
`agent-connect.api.ts`; `agent-platform-url.ts` connected branch; family
`"agents-v1"` in `app-rest.packaged-families.ts`; suite connected-target tests
if unbound. Tests: `connected-agent-call-route`, `agent-v1-connected-rest`,
`connected-agent-long-poll-route` (needs Redis) in apps/api;
`api-rest.packaged-families.integration.test.ts` (route registry / OpenAPI parity).
Tests: `pnpm --filter @langwatch/platform-api test src/features/agent src/app-rest`,
`pnpm --filter @langwatch/suite-server test`.
Typecheck: `@langwatch/agent-server`, `@langwatch/suite-server`, `@langwatch/platform-api`.

**Slice 6 — application views.** `AgentApp` `connected` dependency and enriched
`getAll`/`getById`; `agent.api.ts` (tRPC) answers the view; `ConnectedAgentView`
type where the UI reads it. Tests: `presence.read` scenarios already in Slice 2;
`api-trpc-collaborators.agent-group.integration.test.ts` if it asserts the
`agents` namespace shape.
Tests: `pnpm --filter @langwatch/agent-server test`,
`pnpm --filter @langwatch/platform-api test src/app/__tests__/api-trpc-collaborators.agent-group.integration.test.ts`.
Typecheck: `@langwatch/agent-server`, `@langwatch/platform-api`, `@langwatch/scenario-web`
(its `ConnectedAgentView` consumers).

**Slice 7 — process composition.** `api-connected-agents.composition.ts`,
`agent-connect-credential.adapter.ts`, config leaves, production wiring, drain
order; `worker-connected-agent-runtime.composition.ts` and its call in
`worker-production.composition.ts`; `connected-agent-gateway.integration.test.ts`
(15 scenarios, Postgres + Redis). Manual: with `make haven up`, a `ws` client
upgrade on `https://app.<slug>.langwatch.localhost/api/v1/agents/connect` with
a project key is answered `registered`; the same key over
`POST /connect/register` is answered with an `instanceToken`.
Tests: `pnpm --filter @langwatch/platform-api test`,
`pnpm --filter @langwatch/worker test`.
Typecheck: `@langwatch/platform-api`, `@langwatch/worker`.

**Slice 8 — agents page.** `connectedSection` slot on `AgentManagementHostPort`,
screen renders it, `apps/ui/src/features/agent/index.ts` supplies scenario-web's
`ConnectedAgentsSection` and the drawer address; verify the three UI scenarios
named in §5 are bound.
Tests: `pnpm --filter @langwatch/agent-web test`, `pnpm --filter @langwatch/scenario-web test`,
`pnpm --filter @langwatch/ui test`.
Typecheck: `@langwatch/agent-web`, `@langwatch/scenario-web`, `@langwatch/ui`.

**Slice 9 — parity sweep.** `pnpm --filter @langwatch/architecture-lint
check:feature-parity` for `specs/agents/connected-agents.feature`,
`specs/features/agents/connected-agents-ui.feature`,
`specs/experiments-v3/connected-agent-target.feature`: every tagged scenario
bound, none `@unimplemented`. Update
`dev/docs/plans/restructure-bug-hunt-2026-09-03.md` (the "no transport" bullet
and the seven `/api/v1/agents*` rows) and the exit plan's route inventory.

Slice count: **10** (0–9). Slices 1–4 have no dependency on the other agent's
`AgentTestPort` work; Slice 5's `POST /:id/test` route and Slice 6's `AgentApp`
edits touch the file that agent is editing — coordinate through the working
tree, and let their `testRun`/`testTurn` land first if both are ready.

---

## 8. Named absences and judgment calls recorded

- **No tRPC-over-WebSocket restore.** Main's `trpc-ws.ts` shared the upgrade
  router; this branch serves subscriptions over `/api/sse`. The router has one
  registrant and stays that way.
- **Legacy alias keeps its own bodies** (`agent-legacy.api.ts`) rather than
  main's one-declaration-two-paths shape. Follow-up, not a slice.
- **`LANGWATCH_APP_REPLICAS` defaults to 1** in `api.config.ts`, as in main's
  `env.mjs`. Without Redis and with `replicaCount > 1` every connect is refused
  `replica_count_unsupported` — the deployment reads the absence report at boot.
- **Presence projection and long-poll singleton stay in the API process** (§4.2).
  The brief's suggestion to host them in `apps/worker` was checked against
  main and rejected: neither is a background process there.
- **The worker gets one composition file, not an installer**: Redis into the
  connected runtime for the experiment orchestrator's `relayDispatch`.
- **UI stays in `scenario-web`.** The brief names `packages/features/agent/web`;
  the components were already lifted into scenario-web with their bound tests
  by the UI sprint, and a second move is not lift-and-shift. Recorded as a
  backlog item ("connected UI → agent-web, with `ConnectedAgentView` in the
  agent contract"); Slice 8 wires the missing section through a host slot.
- **`agent-server` gains two dependency edges**: `@langwatch/scenario-contract`
  (parameter grammar) and `ws`. It does NOT gain `@langwatch/api-key-*`: the
  credential resolution is a port satisfied in `apps/api`.
- **`agent-server` has no `vitest.config.ts`** and therefore no datastore lane;
  the Postgres/Redis-backed tests land in `apps/api/src/features/agent/__tests__`
  where the process already runs such tests. If a later slice wants them in the
  package, that is a config decision for the package, not this plan.

## 9. Integration progress (2026-09-03, this pass)

**Done, verified with the named test commands, no deviation from the plan:**

- **Slice 0** — ADR already present on the branch and byte-identical to
  `origin/main` (no action). `spec-rebind-manifest.md` rows 191-196 and 874
  corrected to the §5 destinations.
- **Slice 1** — `connected-agent.identity.ts` (verbatim lift, plus
  `ConnectedAgentIdentity`), `connected-agent.visibility.ts` (framework-free
  half only), both exported from `index.ts`;
  `connected-agent-identity.unit.test.ts` lifted (5 scenarios, all bound).
  `pnpm --filter @langwatch/agent-contract test`: 14/14 passed.
- **Slice 2** — `AgentRepository` port gained `tryFindByIdIncludingArchived`,
  `findByIdentityKey`, `findConnectedByNameAndEnvironment`,
  `reregisterConnected`, `touchLastSeenAt`, `findUserNamesByIds`;
  `PrismaAgentRepository` implements all six plus the private
  `connectedAgentVisibleWhere` fragment applied in `findAll`/`findPage`;
  `AgentsDatabase` port gained `user.findMany`; the mapper carries the five
  identity columns. `AgentService` (contract, abstract) gained
  `registerConnected`/`ownersOf`/`getConnectedByNameAndEnvironment`; the
  server implementation gained the same three plus the `refuseConnectedUpdate`
  guard in `create`/`update`. `MissingAgentService`
  (`apps/api/src/api.application.ts`) got the three `unavailable()`
  overrides. New services: `connected-agent-parameter-spec.service.ts`
  (verbatim logic, `@langwatch/scenario-contract` dependency added to
  `agent-server`'s `package.json`), `connected-agent-presence.projection.ts`
  (private, `repository: AgentRepository` param replacing main's `prisma`),
  `connected-agent-presence.service.ts` (`runtime` as a parameter, no
  `vi.mock`). Both lifted tests (`connected-agent-parameter-spec.service.unit.test.ts`,
  `connected-agent-presence.service.unit.test.ts`) pass.
  `pnpm --filter @langwatch/agent-server test`: 9 files / 93 passed.
  `pnpm --filter @langwatch/architecture-lint test`: 44 files / 596 passed
  (no new grammar violations from the new `services/`/`projections/` files).
  Touched packages: `@langwatch/agent-contract`, `@langwatch/agent-server`,
  `@langwatch/platform-api` (null-object only).

**Not started — Slices 3-9.** Session/long-poll services, the WebSocket
gateway, the REST v1 family, `AgentApp`'s connected view, the process
composition (`apps/api` + `apps/worker`), the agents-page UI slot, and the
final parity sweep remain exactly as this document specifies them. The next
integrator should pick up at Slice 3
(`packages/features/agent/server/src/services/connected-agent-session.service.ts`,
lifted from `origin/main:platform/app/src/server/connected-agents/session.core.ts`,
593 lines, with the constructor redesigned per §1.2's row for that file —
`{ runtime, agents: AgentService, credentials: ConnectCredentialPort,
agentPlatformUrl: AgentPlatformUrlBuilder, replicaCount, now }` replacing
`{ runtime, prisma, replicaCount, now }`). No code for Slices 3-9 exists yet;
nothing was stubbed.

## 10. Integration progress (2026-09-03, second pass)

**Done, verified with the named test commands, no deviation from the plan
except where noted:**

- **Slice 3** — `packages/features/agent/server/src/ports/connect-credential.port.ts`
  (new; `ConnectCredentialPort.resolve` + `ResolvedConnectCredential`) is a
  forced seam: main's `authenticate()` inlined `TokenResolver` and
  `enforceApiKeyCeiling`, both of which live in `@langwatch/api-key-*`, which
  `agent-server` may not depend on (§8's own rule). The port's single
  `resolve` call folds all four of main's steps (resolve, key-kind refusal,
  `scenarios:manage` ceiling, `project_required` naming) into the adapter the
  process supplies; the session service no longer branches on refusal reason
  itself. `connected-agent-session.service.ts` (verbatim lift of
  `session.core.ts`'s logic; class renamed `AgentSessionCore` unchanged).
  **Deviation, recorded**: `SessionCoreOptions` carries one field beyond
  §1.2's shorthand — `agentRepository: AgentRepository` — because
  `connected-agent-presence.projection.ts` (Slice 2) is a private module only
  this service and its own tests may reach by relative import, and it takes
  the repository directly, not through `AgentService`. §1.2's row summarizes
  the constructor as "prisma becomes AgentService or the credential port,"
  which undercounts this one field; the fuller shape is `{ runtime, agents,
  agentRepository, credentials, agentPlatformUrl, replicaCount, now }`.
  `connected-agent-long-poll.service.ts` (verbatim lift of
  `long-poll.transport.ts`, extends `SessionCoreOptions`).
  Tests: `connected-agent-long-poll.service.unit.test.ts` (3 scenarios, all
  `@scenario`-tagged, verbatim titles). `@langwatch/handled-error` added to
  `agent-server`'s `package.json` dependencies (used by `HandledError.isHandled`
  in the session service; was missing and broke resolution).
  `pnpm --filter @langwatch/agent-server test`: 11 files / 100 passed.
  Touched packages: `@langwatch/agent-contract` (no changes needed — already
  complete from Slice 1/2), `@langwatch/agent-server`.

- **Slice 4** — `packages/features/agent/server/src/ports/connect-upgrade-router.port.ts`
  (new; `ConnectUpgradeRouterPort` + `UpgradeHandler`).
  `packages/features/agent/server/src/transport/api-ws/connected-agent-connect.api.ts`
  (verbatim lift of `connect.gateway.ts`; `ConnectGatewayOptions` extends
  `SessionCoreOptions`; `PING_INTERVAL_MS`/`PONG_WAIT_MS`/`PRESENCE_REFRESH_MS`
  read from the contract's `connected-agent.constants.ts` rather than
  restated). `ws@^8.21.0` + `@types/ws@^8.18.1` added to `agent-server`'s
  `package.json` (already resolved in the lockfile via `sdks/typescript`, so
  no new third-party package entered the workspace, matching §3).
  `apps/api/src/api-http.listener.ts` gained `ApiUpgradeSurfacePort` (abstract
  `attach(server)`) and an `upgrades?` option, attached in the constructor
  after `createServer`. `apps/api/src/api-upgrade-router.ts` (new;
  `ApiUpgradeRouter` implements both `ApiUpgradeSurfacePort` and the
  package's `ConnectUpgradeRouterPort` — main's `upgrade-router.ts` body,
  moved verbatim, wrapped as a class per §1.2's row for that file).
  Tests: `connected-agent-connect.api.unit.test.ts` (gateway-guards, 3
  `@scenario`-tagged scenarios, verbatim titles, plus one untagged 404 guard,
  matching main's file exactly).
  `pnpm --filter @langwatch/agent-server test`: 11 files / 100 passed (same
  run as Slice 3 above — both slices verified together).
  `pnpm --filter @langwatch/platform-api test:unit src/__tests__/api-http.listener.integration.test.ts`:
  4/4 passed (no regression from the new `upgrades` option; not yet wired to
  a live gateway — that is Slice 7's `ApiUpgradeRouter.create()` wiring).
  Touched packages: `@langwatch/agent-server`, `@langwatch/platform-api`.

- **Architecture-lint**: `pnpm --filter @langwatch/architecture-lint test`
  ran with one pre-existing, unrelated failure
  (`tests/cli-comment-review.test.ts`, a 5s timeout on an unrelated CLI
  fixture — not touched by this pass): 598/599 passed. `pnpm -s lint` (the
  CLI directly) exits 0; the only non-comment-block findings under
  `packages/features/agent/server` are `eventing-projection-purity` on the
  Slice 2 projection and `fallible-result-naming` on two Slice 2 repository
  methods — pre-existing from the prior pass, not introduced by Slices 3-4.
  `check-feature-parity.ts | grep -c '✗ \['` reads 3235 at the start of this
  pass (a repo-wide count that moves with every agent's concurrent work
  tonight, not a Slice-3/4-scoped number — Slices 3-4 lift no `@scenario`
  frames of their own beyond what is already counted above).

**Not started — Slices 6-9.** `AgentApp`'s connected dependency and enriched
`getAll`/`getById` (Slice 6), the process composition in `apps/api` and
`apps/worker` (Slice 7 — coordinate with `a9b5bb9332cf3e2d9`, who is
mid-flight flattening `api-production.composition.ts`'s collaborator folds;
message them again before editing that file, `api-agents.composition.ts` or
`app-trpc.features.ts`), the agents-page UI slot (Slice 8), and the final
parity sweep (Slice 9) remain exactly as this document specifies. No code for
Slices 6-9 exists yet; nothing was stubbed.

## 11. Integration progress (2026-09-03, third pass — Slice 5)

**Done, verified with the named test commands, no deviation from the plan
except where noted:**

- **Slice 5** — the `/api/v1/agents` REST family, lifted from
  `origin/main:platform/app/src/app/api/agents/[[...route]]/{agents,call,connect}.v1.ts`
  and adapted onto this branch's `SecuredApp`/`.access(policy)` Hono pattern
  (`agent-legacy.api.ts` was the sibling read side by side, as the plan
  instructed; main's `VersionBuilder` framework does not exist here).
  - `packages/features/agent/server/src/transport/api-rest/agent-v1.api.ts`
    (new): `createAgentV1RestApp({security, agents, agentPlatformUrl,
    connectedRuntime?, connect?, call?})`. Registers, in order, the static
    `/connect/*` routes (when `connect` is supplied), then `GET /`, `POST /`,
    `GET /:id`, `PATCH|PUT /:id`, `DELETE /:id`, `POST /:id/test`, then
    `POST /:id/call` (when `call` is supplied) — matching main's stated
    ordering reason (`/connect/*` first, or `/:id` would answer for the
    segment "connect"). `agentResponseSchema` restates main's inline schema
    (presence/owner/parameters/platformUrl); every field, `operationId` and
    response code was checked against the frozen
    `apps/api/src/features/discovery/openapi-document.json` by dumping its
    `/api/v1/agents*` paths and diffing them against this file's
    `describeRoute` blocks — not edited, per the rule.
  - `packages/features/agent/server/src/transport/api-rest/agent-call.api.ts`
    (new): `registerCallEndpoint`, `relayCallBodySchema`,
    `relayCallResponseSchema`, `AssertConnectedAgentsRunnablePort` (a port,
    not an import of `@langwatch/suite-server`'s `assertConnectedAgentsRunnable`
    — agent-server may not depend on suite-server; the port is satisfied by
    `apps/api` in Slice 7).
  - `packages/features/agent/server/src/transport/api-rest/agent-connect.api.ts`
    (new): `registerConnectEndpoints`, `postedFramesSchema`,
    `registerAnswerSchema`, `pollAnswerSchema`, `framesAnswerSchema`. Uses
    `handlerManagedAuth` (from `@langwatch/api`) rather than main's
    `ProjectEndpointMeta`-shaped access object — the branch's `SecuredApp`
    already has this exact escape hatch (`.access(handlerManagedAuth(...))`
    applies no chain), used identically by
    `packages/features/langy/server/src/transport/api-rest/langy-turns.api.ts`,
    which was the precedent read. Restated a local `requestBodySchema()`
    helper (`z.toJSONSchema(schema, {target: "openapi-3.0", reused:
    "inline"})`) for the `register`/`frames` routes' `requestBody` doc block,
    the same way `evaluations-legacy.schemas.ts` does — `zValidator`'s
    auto-generated body doc could not be used here because these two routes
    parse their body by hand (a parse failure must become a `refused` frame,
    not a validator 4xx).
  - `packages/features/agent/server/src/services/agent.service.ts`: added
    `AgentListRow`, `declaredAgentParameters`, `toAgentListRow` (module-level
    exports beside the class, mirroring main's `agent.service.ts` shape) —
    these did not exist yet even though §10's Slice 2 log mentions them; they
    were the one piece of Slice 2's declared scope not actually landed.
    Exported from `packages/features/agent/server/src/index.ts`.
  - `packages/features/agent/server/src/app/agent.app.ts`: added `ownersOf`,
    delegating 1:1 like every other method (needed by the REST rows'
    presence/owner enrichment; `AgentApp` had every other piece of
    `AgentService`'s connected surface delegated already, this one was
    missed).
  - **Bug fixed, not a lift**: `packages/features/agent/contract/src/config/connected.ts`'s
    `connectedParameterDefinitionSchema.type` enum was `["text", "number",
    "boolean"]`; main's equivalent (`connectedComponentSchema` in
    `optimization_studio/types/dsl.ts`) reuses `scenarioParameterDefinitionSchema`
    directly, whose type enum is `["string", "number", "boolean"]` — matching
    the frozen OpenAPI document. `"text"` was never used anywhere else in the
    tree (grepped) and no test named it; changed to `"string"`. Without this
    fix, `declaredAgentParameters`'s return value could not structurally
    satisfy `ScenarioParameterDefinition[]` without an `as unknown as` cast,
    which the rules forbid in production code — fixing the enum removed the
    need for the cast entirely, which is why this was fixed rather than
    routed around.
  - `apps/api/src/features/agent/agent-platform-url.ts`: restored the
    three-way drawer choice (`http` → `agentHttpEditor`, `connected` →
    `agentConnectedDetail`, else `agentCodeEditor`) — confirmed
    `agentConnectedDetail` is a registered drawer in
    `apps/ui/src/features/simulations/index.ts` before wiring it in.
  - Exported the three new modules' public surface from
    `packages/features/agent/server/src/index.ts`.

  **Verification**: `pnpm --filter @langwatch/agent-server test`: 11 files /
  100 passed (unchanged — Slice 5 added no new test files of its own; see
  gaps below). `pnpm --filter @langwatch/agent-contract test`: 4 files / 14
  passed, confirming the `connected.ts` enum fix broke nothing. A temporary
  smoke test (written, run, then deleted — not committed) imported
  `createAgentV1RestApp`, `registerCallEndpoint`, `registerConnectEndpoints`
  from a real vitest transform to catch import/naming errors, since **this
  session was instructed not to run `tsc`/`tsgo` at any scope**, so full type
  checking of these three new files has NOT happened; the root session should
  typecheck `@langwatch/agent-contract`, `@langwatch/agent-server`. `pnpm -s
  lint`: no findings in any file this slice touched or created (checked by
  grepping the full lint output for each filename). `pnpm --filter
  @langwatch/architecture-lint test`: 608/609 (one pre-existing, unrelated
  failure — a NUL byte in `coding-agent-session-clickhouse-dedup.unit.test.ts`,
  not touched by this pass); no new grammar violations traced to
  `transport/api-rest/` or `services/`.

  **Deviations / judgment calls, recorded:**
  - `agent-v1.api.ts` did not reuse main's exact `AgentsApp`/`AgentsVersion`/
    `AgentsGuard`/`RegisterAgents` type names (main's `VersionBuilder`
    abstraction has no counterpart) — the branch's shape is
    `{secured: SecuredApp<...>, deps: AgentsV1Deps}` threaded through four
    private `register*Endpoints` functions plus `createAgentV1RestApp` itself,
    matching `agent-legacy.api.ts`'s own internal shape rather than main's.
  - `AgentPlatformUrlBuilder` is NOT redefined in `agent-v1.api.ts` — it
    imports the type `agent-legacy.api.ts` already exports, to avoid two
    identically-named, differently-declared exports colliding out of
    `index.ts`.
  - `AgentCallDeps`/`ConnectEndpointDeps` are new port-shaped interfaces
    (`assertRunnable`, `runtime`, `transport`) that Slice 7's
    `ApiConnectedAgentsComposition` is expected to satisfy; nothing in
    `apps/api` constructs them yet — see gaps below.

  **Gaps left inside Slice 5's own scope (not deferred to Slice 7):**
  - **The family is not mounted anywhere.** `createAgentV1RestApp` is
    exported and ready, but no `apps/api` composition file calls it yet — that
    requires `ApiConnectedAgentsComposition` (Slice 7: Redis-backed runtime,
    `ApiConnectCredentialAdapter`, the `assertRunnable` port wired from
    `@langwatch/suite-server`), which touches `api-production.composition.ts`
    and `app-rest.packaged-families.ts` (coordination file). Slice 5 as
    written asked for this mounting too; it was deliberately left to Slice 7
    because building even a minimal composition means constructing a real
    Redis-or-memory runtime and a credential adapter, which is Slice 7's
    stated content, not Slice 5's.
  - **No new tests were lifted this pass.** §5's table names
    `connected-agent-call-route`, `agent-v1-connected-rest`,
    `connected-agent-long-poll-route` (all in `apps/api/src/features/agent/__tests__`,
    all needing a mounted family plus Postgres/Redis) and the suite
    `connected-target.service` integration scenarios (needing
    `resolveConnectedReferences`/`isAgentUnseen`/`ownerNamesOf`/
    `agentParameterDefinitionsOf`, which main's `connected-targets.ts` has and
    the branch's 71-line `connected-target.service.ts` does not — confirmed by
    diffing the two; only `assertConnectedAgentsRunnable` was ported in an
    earlier pass). None of these tests can run against a mounted family or a
    real resolver yet, so lifting them now would either not compile or not
    exercise real behavior. **This is the single largest remaining gap**:
    grepping the suite-server tree for the six integration scenario titles
    (`"A teammate cannot target another person's personal agent"`, `"A run
    can address a connected agent by name and environment"`, etc.) confirms
    none are bound.
  - `resolveConnectedReferences`, `isAgentUnseen`, `ownerNamesOf`,
    `agentParameterDefinitionsOf` from main's `connected-targets.ts` were
    never ported to `connected-target.service.ts` in any earlier pass. Restoring
    them (plus the run-scheduling call site that resolves `<name>@<environment>`
    targets before scheduling) is real remaining work under this plan's rule
    that nothing on main may stay absent — it was out of reach this pass given
    the REST family's own size, and is the right place for the next pass to
    start inside `packages/features/suite/server/src/services/connected-target.service.ts`.

**Resume point for the next pass**: Slice 6
(`packages/features/agent/server/src/app/agent.app.ts`'s `connected?:
{presence, runtime}` dependency per §1.2, then `agent.api.ts`'s `getAll`/
`getById` reading it), OR finish Slice 5's two gaps above first
(`connected-target.service.ts`'s missing functions, then mount
`createAgentV1RestApp` once Slice 7's composition exists — these two are
tangled: mounting needs Slice 7, so the suite gap is the one piece of Slice 5
still doable standalone). Either way, message `a9b5bb9332cf3e2d9` before
touching `api-production.composition.ts`, `api-agents.composition.ts` or
`app-trpc.features.ts`.

## 12. Integration progress (2026-09-03, fourth pass — resume after kill)

**Prerequisite fixes, both verified before anything else:**

- `agent-test-scenario.ts`'s `agentTestTarget()` was left between
  `agentTestScenarioConfig`'s docblock and the function itself; moved below
  `agentTestScenarioConfig` with its own 4-line docblock, restoring the
  original docblock to its function.
- `run-parameters.unit.test.ts`'s four new scenarios (closed option lists,
  per-target unknown-name checks, default precedence) were checked against
  `resolveRunParameters`/`scenario-run-parameter.error.ts`: the production
  code already implements `targetDefinitions`, `targetLabel` and
  `scenario_parameter_option_invalid` in full — no production change was
  needed. `pnpm --filter @langwatch/scenario-contract test`: 344/344.

**Done, verified with the named test commands:**

- **Suite gap (standalone, ahead of Slice 6)** —
  `packages/features/suite/server/src/services/connected-target.service.ts`
  gained `resolveConnectedReferences`, `isAgentUnseen`,
  `agentParameterDefinitionsOf`, and `agentOwnerNameReader` (a redesign-at-
  the-seam stand-in for main's `ownerNamesOf`: the branch's
  `AgentService.ownersOf` already does that Prisma read, so this wraps it
  rather than restating a `prisma.user` query — `ownerNamesOf` itself is a
  **named absence**, superseded). All four/five are exported from
  `packages/features/suite/server/src/index.ts`.
  `packages/features/agent/contract/src/agent.queries.ts`'s
  `agentReferenceStateSchema` gained optional `type`, `name`, `ownerUserId`,
  `lastSeenAt` (main's `findManyIncludingArchived` returns full identity
  rows; the branch's `findReferenceStates` returned only `{id, archivedAt}`,
  so target resolution had no way to tell a connected agent apart or check
  staleness/ownership). `prisma.agent.repository.ts`'s `findReferenceStates`
  selects the four new columns.
  `suite.service.ts`'s `run` and `runPlan` now: resolve `<name>@<environment>`
  references before target resolution (`resolveConnectedReferences`), treat
  `isAgentUnseen` the same as `archivedAt` in `resolveTargetReferences`
  (which now also returns `connectedAgents: ConnectedTargetAgent[]` for the
  active targets), and call `assertConnectedAgentsRunnable` before
  `execution.execute`. `runPlan`'s persisted `targets` now carry the
  resolved id, not the `<name>@<environment>` string, matching main's
  `plan.targets` expectation.
  Lifted the six integration scenarios from
  `origin/main:platform/app/src/server/suites/__tests__/connected-targets.integration.test.ts`
  verbatim by `@scenario` title into
  `packages/features/suite/server/src/services/__tests__/connected-target.service.unit.test.ts`
  — **deviation, recorded**: `.unit.test.ts` rather than `.integration.test.ts`,
  because `@langwatch/suite-server` has no datastore lane (no
  `vitest.config.ts`, every existing test in the package is fakes-driven);
  the scenarios run through `SuiteService.runPlan` with an `AgentService`
  fake backed by a small in-memory registry, the same level every other test
  in this file's directory already uses. `result.planName` assertions from
  main's test 5 were dropped: main auto-derives a plan name from target
  labels when the caller sends none (`defaultPlanName`/`readRequestedPlanName`
  in main's `runPlan`), which is a distinct, larger feature the branch's
  `suiteRunPlanInputSchema` does not have (`name` is required, no
  derivation) — **named absence**, out of scope for this gap.
  `pnpm --filter @langwatch/suite-server test`: 9→9 files, 67/67 (+6 for the
  new scenarios). `pnpm --filter @langwatch/agent-contract test`: 14/14.
  `pnpm --filter @langwatch/agent-server test`: 100/100 (schema change is
  additive, no regression).
  Touched packages: `@langwatch/agent-contract`, `@langwatch/agent-server`
  (repository only), `@langwatch/suite-server`.

- **Slice 6** — `packages/features/agent/server/src/app/agent.app.ts` gained
  an optional `connected?: { presence: (input) => Promise<Map<string,
  AgentPresence>> }` dependency (narrower than §1.2's `{presence, runtime}`
  shorthand: `runtime` is folded into the `presence` closure the composition
  root supplies, since nothing else in `AgentApp` needs the raw runtime —
  **recorded deviation**). `getAll`/`getById` now answer the enriched view
  (`parameters` via `declaredAgentParameters`, `owner` via
  `AgentService.ownersOf`, `status`/`instances` via `agentPresenceView`),
  degrading to `NO_PRESENCE`/no owner when `connected` is absent (a process
  that has not yet composed the runtime — true of `apps/api` today, until
  Slice 7). `transport/api-trpc/agent.api.ts`'s `getAll`/`getById` already
  just delegate to `ctx.app.agents.getAll/getById` and spread the result
  through `withLegacyCopyCount`, so the tRPC door answers the view with no
  edit needed there. **Recorded, not fixed this pass**: `agent-v1.api.ts`
  (REST, built in Slice 5 before `AgentApp` had this capability) implements
  its own independent presence/owner enrichment via the same
  `readAgentPresence`/`agentPresenceView`/`toAgentListRow` functions rather
  than going through `AgentApp` — behaviourally consistent (same underlying
  reads) but the plan's "both doors read the app, so they cannot disagree"
  is not yet literally true. A safe de-duplication for a later pass, not a
  correctness gap.
  New test `packages/features/agent/server/src/app/__tests__/agent.app.unit.test.ts`
  (2 scenarios: enrichment present, enrichment absent).
  `apps/api/src/api.application.ts` and `api-packaged-rest.composition.ts`
  still construct `AgentApp` without `connected` (optional field, backward
  compatible) — wiring a real `connected.presence` closure needs
  `ApiConnectedAgentsComposition` (Slice 7).
  `pnpm --filter @langwatch/agent-server test`: 11→12 files, 100→102
  (+2). `pnpm --filter @langwatch/platform-api test:unit src/features/agent`:
  7/7 (narrow path filter — `test:unit src/features/agent`, NOT `test:unit
  run src/features/agent`, which mis-parses as two OR'd patterns and pulls
  in unrelated files).

- **Slice 7, worker half only** — the API half needs
  `ApiConnectedAgentsComposition` inside `api-production.composition.ts`,
  which agent `a8c54399437b5abf2` (the tRPC-flatten lane) was mid-edit on
  for the whole of this pass; it had not signalled the file was free by the
  time this pass ended, so no `apps/api` composition work was attempted.
  The worker half has no such conflict and is done:
  `apps/worker/src/app/worker-connected-agent-runtime.composition.ts` (new)
  — `installWorkerConnectedAgentRuntime({redis, resources?})` calls
  `installConnectedAgentRedis` and registers `closeConnectedAgentRuntime` on
  the `ResourceScope` when Redis is configured, no-ops otherwise. Wired into
  `worker-production.composition.ts` right after `processRedis` is derived
  (~line 454), fixing the gap §4.2 names: the experiment orchestrator's
  `relayDispatch` (`experiment-run-orchestrator.service.ts:1912`) calls
  `getConnectedAgentRuntime().dispatcher` in this process, and before this
  change it always ran on a private memory store that could never see an
  instance the API process registered. Added `@langwatch/agent-server` as a
  direct dependency of `apps/worker/package.json` (was transitive only, via
  `@langwatch/experiment-server`) and ran `pnpm install --filter
  "@langwatch/worker..."` to link it.
  New test `apps/worker/src/app/__tests__/worker-connected-agent-runtime.composition.unit.test.ts`
  (2 scenarios, `@langwatch/agent-server` mocked with `vi.hoisted` to avoid
  touching the real module-singleton runtime).
  **Verified the two config-leaf items (`infrastructure.connectedAgents.
  replicaCount`/`relayMaxPayloadMb` in `api.config.ts`) were deliberately
  NOT added this pass**: every `relayPayloadCaps()` call site in
  `agent-server` (`connected-agent-connect.api.ts`,  `agent-call.api.ts`,
  `agent-connect.api.ts`, `connected-agent-session.service.ts`) already
  calls it with no argument, so a config leaf with no consumer would be
  exactly the "unused config object" trap — this is deferred to land
  together with `ApiConnectedAgentsComposition`, which is what will thread
  the override down.
  `pnpm --filter @langwatch/worker test`: 62→63 files, 510→512 (+2); one
  pre-existing, unrelated file (`worker-production.composition.unit.test.ts`)
  has 2 failures in its "monthly billing roll-up" describe block
  (`resolveClickHouseClient`/`checkpointFindUnique` call-count assertions) —
  **confirmed unrelated by temporarily reverting this pass's two-line
  composition edit and re-running: same 2 failures, same file, before and
  after**. Not touched, not this plan's concern.
  Touched: `apps/worker/src/app/worker-connected-agent-runtime.composition.ts`
  (new), `apps/worker/src/app/worker-production.composition.ts` (2-line
  wiring), `apps/worker/package.json` (1 dependency).

- **Architecture-lint / repo lint**: `pnpm -s lint` — zero findings in any
  file this pass touched or created (checked by grepping the full run's
  output for each filename). `pnpm --filter @langwatch/architecture-lint
  test`: 43→44 files (unchanged), 609/610 (one pre-existing, unrelated NUL-byte
  failure in `coding-agent-session-clickhouse-dedup.unit.test.ts`, already
  recorded in §11 as not touched by this plan).

**Not started — Slice 7 (apps/api half), 8, 9.** `ApiConnectedAgentsComposition`,
`ApiConnectCredentialAdapter`, the config leaves, mounting `createAgentV1RestApp`,
wiring `AgentApp`'s `connected.presence`, the upgrade router, and the drain
order all remain exactly as §4.1 and §7 specify — blocked on
`a8c54399437b5abf2` finishing `api-production.composition.ts`. Slice 8 (agents
page UI slot) and Slice 9 (parity sweep) are untouched; no code for either
exists yet, nothing was stubbed.

**Resume point for the next pass**: message `a8c54399437b5abf2` (or check
whether it has already messaged back) to confirm `api-production.composition.ts`,
`api-agents.composition.ts` and `app-trpc.features.ts` are free, then do
Slice 7's `apps/api` half in the order §4.1 lists: `api.config.ts`'s two
config leaves first (now genuinely wireable), then
`agent-connect-credential.adapter.ts`, then `ApiConnectedAgentsComposition`
itself, then the `app-rest.packaged-families.ts` mount, then `AgentApp`'s
`connected.presence` wiring in `api.application.ts`/`api-packaged-rest.composition.ts`,
then the upgrade router plumbing into `api-http.listener.ts` (already has
the `upgrades?` option from Slice 4 — just needs `ApiUpgradeRouter.create()`
passed in), then the drain order in `api.process.ts`. The 15-scenario
`connect.gateway.integration.test.ts` and the two apps/api-side REST route
integration tests named in §5 land once the composition exists. Slice 8 and
9 are unblocked only once Slice 7 is fully done.
