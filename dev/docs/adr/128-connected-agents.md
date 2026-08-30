# ADR-128: Connected agents: a decorated function is a simulation target

**Date:** 2026-08-30

**Status:** Accepted

## Context

Connecting an agent to Agent Testing is where customers drop. An HTTP agent needs a public URL, a body template that matches the platform's call, credentials in the agent config, and a `traceparent` middleware so the judge can read the agent's own traces; the connect-agent skill needs seven steps for it. A code agent stores Python in the agent config and runs it in nlpgo, away from the customer's real dependencies and secrets. For local work, `langwatch agent dev` (ADR-098) fronts a local server with a Cloudflare quick tunnel and rewrites the agent URL; ADR-098 records "an authenticated outbound relay through our own infrastructure, auth via the existing API key" as the intended successor of that tunnel.

What the platform already has: a WebSocket server on the app's HTTP listener, path routed so more upgrade paths can share it (`server/websockets/trpc-ws.ts`); a presence pattern in Redis with an in-memory fallback (`server/scenarios/browser-tab/scenario-tab-registry.ts`, ADR-093); Redis pub/sub for cross-pod signals (`scenario:cancel`); a scenario child process with no database and no Redis that reaches the outside only over HTTP, so every target is prefetched into the job; an `Agent` model with no status, no last-seen time, no environment and no owner; run parameters declared per scenario with a name, a description, a default and a secret flag, resolved per target since comparison mode; API keys with an owner (`ApiKey.userId`, null for a service key) and a legacy project key that belongs to nobody.

## Decision

We will ship **connected agents**: a customer decorates the function that runs their agent, the SDK opens an outbound WebSocket to LangWatch, registers the agent with its environment, its instance identity and its parameter schema, and then receives simulation turns over that socket, runs the function and replies. The platform shows the agent Online while at least one instance is connected. This is the recommended way to connect an agent; HTTP agents, code agents and `langwatch agent dev` stay supported.

### SDK surface

Python: `@langwatch.connect_agent(name, environment=None, description=None, parameters=None, enabled=None, instance_label=None, timeout=120, concurrency=None, sticky=False, api_key=None, endpoint=None, project_id=None)`. TypeScript: `connectAgent(options, handler)` from `langwatch/agent` with the same options in camelCase. The same word, connect, in every doc, skill and MCP description.

The platform sends the same **turn fields** on every call: `messages` (the full conversation, OpenAI-style), `new_messages` (the delta since the last turn), `thread_id` (the platform's conversation id), `session` (the agent's own per-conversation memory, see below), `trace_id`. The Python SDK reads the signature once at decoration and passes exactly the names the function declares (`**kwargs` receives all of them), so a function never sees an unexpected keyword argument and never misses a field it declared. A first parameter annotated `langwatch.AgentCall` receives one object with every field. TypeScript handlers receive one object `{ messages, newMessages, threadId, session, params, traceId }`.

Every other parameter with a default is a **run parameter**. Python reads the type from the annotation (`str`, `int`, `float`, `bool`; `Literal` and `Enum` become a closed option list; `Optional`), the default from the default value, and description or overrides from `Annotated[T, langwatch.Param(...)]`; anything else falls back to pydantic's JSON schema and is presented as text. TypeScript takes a definition map (`{ model: { options: [...], default: "..." } }`, typed through generics), any Standard JSON Schema object (`schema["~standard"].jsonSchema`), or a plain JSON Schema; the SDK never takes a zod instance as a value. Turn field names are never run parameters. A run parameter the platform did not send takes its default; one with no default that the run did not supply is refused before the function runs.

The function returns a string, one message, a list of messages, or `AgentReply(output, session=...)` (`{ output, session }` in TypeScript). **`session`** is an opaque JSON value the agent keeps per conversation (an id today, a token or a cursor tomorrow): `None` on the first turn, echoed back on every later turn of the same `thread_id`. The platform holds it for the run in the scenario child's adapter layer, so it works across N production instances with no stickiness and no process-level map. The echo lives in the shared adapter layer so code agents (a `session` output field) and HTTP agents (`sessionPath`, `{{ session }}`) can adopt it later.

Lifecycle: the decorator registers the function in a process-wide registry and starts one shared connection per process, lazily. Nothing happens without an API key. `enabled` defaults to true, except when `CI` is truthy; `LANGWATCH_AGENT_CONNECT=0` disables it. In Python the connection runs on a daemon thread with its own asyncio loop (`websockets`), forks restart it (`os.register_at_fork`), and `langwatch.agent.serve()` blocks a script whose only job is the agent. In TypeScript the socket keeps the event loop alive while connected. Both send `deregister` on SIGINT, SIGTERM and exit, reconnect with exponential backoff (1 s to 30 s with jitter), and answer the server's pings.

### Identity: name and environment are columns

One `Agent` row per (project, name, environment, scope). `environment` is resolved by the SDK: the explicit argument, then `LANGWATCH_AGENT_ENVIRONMENT`, then `APP_ENV`, `ENVIRONMENT`, `NODE_ENV`, else `development`. When the environment is `development` the agent is **personal**: scoped to the key's owner (`ownerUserId`, a personal API key) or to the machine (`hostLabel`, a project or service key). Any other environment is shared. The row's `identityKey` is `<name>@<environment>` plus `/user:<id>` or `/host:<label>`, unique per project; `register` upserts by it, and a reconnect un-archives the same row. `config` for a connected agent holds `{ description, parameters, timeoutMs, concurrency, sticky, sdk }` and nothing runtime; runtime state lives in `lastSeenAt` and in Redis.

Environment is not a target dimension: every downstream surface works on agent ids, so `support-agent` in `production` against `support-agent` in `development` is two targets in the comparison mode that already exists. Target labels read `support-agent · production` and `support-agent · development (Rogério)`. The agents list groups rows by name.

A personal agent can be targeted only by its owner: `SuiteService.prepareRun` receives the actor (the session user in tRPC, `apiKeyUserId` on REST and MCP) and refuses with `agent_owner_only` (403) when it differs from `ownerUserId`. A legacy project key names nobody and can never target a personal agent. Host-scoped development agents are visible and runnable by the team. The run dialog hides teammates' personal agents behind a toggle and renders them disabled.

Production with N pods is one row and N instances; the dispatcher picks one per call.

### Transport: an outbound relay over WebSocket

`GET /api/agents/connect` upgrades on the app's HTTP server, next to `/api/trpc-ws`. Auth is the API key in `Authorization: Bearer` (plus `X-Project-Id` when the key is not single-project) resolved by `resolveApiKey`; ingestion keys and langy session keys are refused; the key needs `scenarios:manage`. No Origin check, since this is not cookie auth. One socket carries every agent of a process.

The scenario child calls `POST /api/agents/:id/call` with the project key (the child has no Redis and no database), and so do the Test button, `langwatch agent run` and MCP `platform_run_agent`; the route needs `scenarios:create` and the agent's project. The route dispatches to a live instance and answers with the function's output.

Dispatch is durable and at most once. The dispatcher writes the envelope to Redis (`agent_call:v1:<callId>`, EX = deadline + slack) and to the instance's pending set before it publishes a nudge on the instance channel; the pod that holds the socket reads the key, never the message body, and rescans the pending set when an instance re-registers. The SDK sends `ack` when the function starts; the dispatcher retries on another instance only before `ack`. The result lands in `agent_result:v1:<callId>` (EX 60 s) plus a nudge on one reply channel per pod; the dispatcher polls the result key as the fallback. A pod that loses a socket publishes the instance as gone, and the dispatcher fails that instance's calls with `agent_disconnected` at once. Scenario cancellation rides the HTTP request: the child's socket dies with the child, the route sees the abort and sends `cancel`.

Presence: ZSET `agent_instance:v1:<projectId>:<agentId>` (member instanceId, score last seen, TTL 30 s, refreshed on pong every 10 s) plus a per-instance hash (hostname, username, pid, sdk, label, pod, connectedAt, maxConcurrency). Online means at least one live member. `Agent.lastSeenAt` is written at most once a minute; a daily sweep archives connected agents unseen for 30 days. Without Redis the registry is in memory and `connect` is refused on a deployment with more than one app replica (`LANGWATCH_APP_REPLICAS`, default 1).

Concurrency: each instance advertises `maxConcurrency` (default 1 in development, 4 elsewhere); the platform counts in-flight calls per instance in Redis under the call TTL, picks the instance with the most free slots, and answers 429 with `Retry-After` when every instance is full; the adapter waits with jitter up to a bounded budget. Thread affinity is a rendezvous-hash hint; `sticky=True` pins a thread to an instance and fails it with `agent_instance_lost` when that instance is gone.

Timeouts: `timeoutMs` default 120 s, cap 300 s, always under the child's 15 min lifetime; a deadline is the typed `agent_call_timeout`. The first call of a thread waits up to 15 s for an instance before `agent_offline`.

Payload caps live in one constants module and are sized for multimodal turns: envelope 32 MiB, result 16 MiB, session 64 KiB, socket frame 64 MiB, overridable on self-hosted with `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`. The envelope carries the turn fields, the parameters, the `traceparent` and the run reference only.

Remote-trace judging: the `connected` type is treated like `http`; the SDK adopts the envelope's `traceparent` as the parent context before it calls the function, so the customer's spans land in the turn's trace with no middleware.

Rolling deploys: agent sockets get their own shutdown phase after the HTTP drain and close with code 1012, so the SDK reconnects at once; it re-announces its in-flight call ids in `register`.

### Parameters declared by the agent

`scenarioParameterDefinitionSchema` gains optional `type` (`string`, `number`, `boolean`) and `options` (max 50). The gateway normalizes the SDK's schema into that shape at `register` (20 per agent, the scenario name grammar, unsupported types downgraded to text with a note). Declared definitions in scope are the scenarios' union plus each target's agent; unknown names are checked per target; a value outside a closed list is refused before scheduling with `scenario_parameter_option_invalid`. `declaredDefaults` takes scenario declarations first, then the agent's, in the one browser-safe module both sides use. The run dialog's parameter fields become a `ParameterLineField` with key and value suggestions built from the same definitions.

## Rationale / Trade-offs

An outbound relay removes every reason a customer had to stop: no public URL, no template, no credentials in our config, no middleware, and the process they already run is the connection. The customer's full server runs the simulation, which is what end-to-end agent testing means.

Rows per environment instead of a target dimension keep the target pipeline, the comparison view, the CLI, MCP and REST untouched; the cost is a grouped list and a label suffix. Deriving personal scope from the environment name means a developer gets isolation without learning a flag; a team that wants a shared dev box names it.

WebSocket egress is the one new requirement on the customer's side; the frame contract is transport neutral so an HTTP long-poll transport can be added without touching the SDK API. Durable call keys plus explicit `ack` give at-most-once delivery; a call that started is never repeated on another instance, since it may have side effects. Stateless-by-contract with an opt-in pin was chosen over always-sticky routing, because rendezvous hashing reshuffles threads on every scale-up and the platform's contract already sends the full history.

Security is the property that makes the design acceptable to a customer's security team, so it is stated as one block. The connection is outbound only: the customer's process opens one TLS connection to LangWatch, nothing listens on their side, there is no public URL, no tunnel and no firewall rule. No credentials are shared: the only credential is the LangWatch API key they already hold and rotate; LLM keys, databases and internal APIs stay inside their process. LangWatch sends the conversation, the declared parameters, the session value and the trace context, and can only invoke the function the customer decorated; an instance receives calls only for the agents it registered on its own socket, and the envelope carries no field outside the contract. The key needs `scenarios:manage` to connect and `scenarios:create` to run, a personal key never exceeds its owner's permissions, and personal development agents are owner-only at scheduling. The key travels in a header, never in the URL, so it never lands in access logs; TLS uses the system trust store with no verify-off option, and a private CA is configured with the standard `SSL_CERT_FILE` or `NODE_EXTRA_CA_CERTS`. The guarantee is that LangWatch can only invoke the function they chose to expose with the inputs they declared, not that the function is safe.

The decorator never fails the customer's application. A missing API key, a key that reaches several projects without a project id, an invalid or wrong-type key, a missing permission, an unreachable endpoint or a refused registration each produce one warning line that names the fix (the `refused` frame carries a precise `code`, and `project_required` lists the projects the key can reach), and the application starts as if the decorator were absent.

Nothing on the market registers presence and a parameter schema from the function definition itself; Inngest, Trigger.dev, Stripe `listen` and ngrok each cover one half.

## Consequences

The connect-agent flow becomes: install the SDK, decorate the function, start the process. Docs, skills and MCP descriptions recommend it first. `Agent` gains `environment`, `ownerUserId`, `hostLabel`, `identityKey` and `lastSeenAt`, and a new type `connected` that reaches every type switch (repository, suite targets, execution types, adapter registry). The app gains one WebSocket path, a Redis key family and a daily sweep. Self-hosted deployments need WebSocket upgrade on `/api/agents/connect` and a read timeout above the 15 s ping; without Redis they need one app replica.

ADR-098's transport note is fulfilled by this ADR; `langwatch agent dev` stays for HTTP agents.

## Contract

Frames are JSON text over the socket, every frame `{ "type": ..., "protocol": 1, ... }`.

| Direction | `type` | Fields |
|---|---|---|
| SDK to platform | `register` | `sdk { name, version, language }`, `instance { id, hostname, username, pid, startedAt, label?, inFlightCallIds[] }`, `agents[] { name, environment, description?, parameters (JSON Schema object), concurrency?, timeoutMs?, sticky? }` |
| platform to SDK | `registered` | `agents[] { name, environment, id, url, parameterNotes[] }`, `heartbeatIntervalMs`, `instanceId` |
| platform to SDK | `refused` | `{ code, message, meta? }` then close; codes `api_key_invalid`, `project_required` (`meta.projects[] { id, name }`), `permission_denied`, `key_type_not_allowed`, `replica_count_unsupported`, `parameters_invalid`, `environment_invalid`, `protocol_invalid` |
| platform to SDK | `call` | `{ callId, agentId, threadId, messages, newMessages, params, session, traceparent, deadlineAt, run { scenarioRunId?, scenarioName?, batchRunId? } }` |
| SDK to platform | `ack` | `{ callId }` when the function starts |
| SDK to platform | `result` | `{ callId, output, session? }` or `{ callId, error { code, message } }` |
| platform to SDK | `cancel` | `{ callId }` |
| SDK to platform | `deregister` | graceful shutdown |

Error codes (`HandledError`, presentation entries in `features/errors/logic/presentation.ts`): `agent_offline`, `agent_owner_only`, `agent_call_timeout`, `agent_call_failed`, `agent_disconnected`, `agent_instance_lost`, `agent_busy`, `agent_parameter_invalid`, `agent_register_refused`, `agent_register_only` (REST create or update of a `connected` agent), `agent_payload_too_large`, `scenario_parameter_option_invalid`.

Redis keys (`server/connected-agents/keys.ts`): `agent_instance:v1:<projectId>:<agentId>` (ZSET), `agent_instance_meta:v1:<instanceId>` (hash), `agent_inflight:v1:<instanceId>` (counter), `agent_call:v1:<callId>` (envelope), `agent_pending:v1:<instanceId>` (ZSET of call ids), `agent_result:v1:<callId>`, `agent_thread:v1:<agentId>:<threadId>` (sticky pin); channels `agent_call:v1:<instanceId>`, `agent_reply:v1:<podId>`, `agent_instance_gone:v1`.

## References

- Related ADRs: ADR-093 (Redis is an owned client), ADR-094 (simulation execution substrate), ADR-097 (remote-trace judging), ADR-098 (`agent dev` tunnel)
- Specs: `specs/agents/connected-agents.feature`, `specs/python-sdk/agent-decorator.feature`, `specs/typescript-sdk/agent-wrapper.feature`, `specs/features/agent-testing/parameter-autocomplete.feature`
