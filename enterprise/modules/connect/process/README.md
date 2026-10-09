# @langwatch/enterprise-connect-process

The server half of [connect](../README.md). The hosted end of LangWatch Connect: the gateway's hosted-service routes, their judge and spend metering through instant-eval, and the contract-budget cap kept in the gateway's budget table.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("connect").withApi(ConnectModule).withTransports(connectHostedRest).withTransportFacts(…)`, `src/connect.module.ts:9`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ConnectApi`)

The hosted end of Connect (ADR-156 §5), which only LangWatch Cloud serves: a self-hosted install's calls, made under the managed key its license runs on.

Peers call these through the token, declared at `../contract/src/connect.api.ts:11`; nothing else in this package is public.

#### `classifyForHostedCaller`

Judges one text for a caller whose license is entitled to instant evals.

```typescript
classifyForHostedCaller(input: { caller: HostedCaller; payload: unknown; /** The calling install's request: a judgement it no longer waits for is abandoned. */ signal?: AbortSignal; }): Promise<HostedClassifyAnswer>;
```

#### `getHostedUsage`

What the caller spent against every budget that applies to it.

```typescript
getHostedUsage(input: { caller: HostedCaller }): Promise<HostedUsageAnswer>;
```

#### `setHostedBudgetCap`

The customer moves its own hosted cap, up to the contract maximum.

```typescript
setHostedBudgetCap(input: { caller: HostedCaller; payload: unknown }): Promise<HostedCapAnswer>;
```

## REST transport

### `connectHostedRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/connect-hosted.rest.ts:65` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | internal_secret                           |

#### `POST /api/internal/gateway/connect/instant-evals-classify` · `classifyForHostedCaller`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/connect-hosted.rest.ts:71`.

Answers at `/api/internal/gateway/connect/instant-evals-classify`.

```typescript
// Rawbody: "text" (inline, src/transport/connect-hosted.rest.ts:72)
type Response = z.infer<typeof hostedClassifyAnswerSchema>; // ../contract/src/connect-hosted.ts:34
```

#### `POST /api/internal/gateway/connect/usage` · `getHostedUsage`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/connect-hosted.rest.ts:86`.

Answers at `/api/internal/gateway/connect/usage`.

```typescript
// Rawbody: "text" (inline, src/transport/connect-hosted.rest.ts:87)
type Response = z.infer<typeof hostedUsageAnswerSchema>; // ../../licensing/contract/src/connect-hosted.ts:72
```

#### `POST /api/internal/gateway/connect/budget` · `setHostedBudgetCap`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/connect-hosted.rest.ts:94`.

Answers at `/api/internal/gateway/connect/budget`.

```typescript
// Rawbody: "text" (inline, src/transport/connect-hosted.rest.ts:95)
// Response: hostedCapAnswerSchema, ../contract/src/connect-hosted.ts:42
interface Response {
  cap_usd: number;
  maximum_cap_usd: number;
}
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: connect declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
