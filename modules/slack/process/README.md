# @langwatch/slack-process

The server half of [slack](../README.md). A project's Slack connections: the bot tokens automations post with, and the claims that keep two automations from fighting over one channel.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("slack").withRepositories(slackRepositories).withChannels(slackChannels).withApi(SlackModule).withTransports(slackIntegrationTrpcTransport, slackRest)`, `src/slack.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`SlackApi`)

A project's Slack connections and the claims automations hold on them (ARCHITECTURE.md §3).

Peers call these through the token, declared at `../contract/src/slack.api.ts:16`; nothing else in this package is public.

#### `listSlackConnections`

Main's `slackIntegration.list`; with no `actorId` (an API key) nothing reads as manageable.

```typescript
listSlackConnections(input: { projectId: string; actorId?: string; }): Promise<SlackConnectionList>;
```

#### `createSlackConnection`

```typescript
createSlackConnection(input: { projectId: string; actorId: string; name: string; kind: SlackConnectionKind; scopeType: SlackConnectionScopeType; scopeId: string; secret: string; }): Promise<SlackManagedConnection>;
```

#### `updateSlackConnection`

```typescript
updateSlackConnection(input: { projectId: string; actorId: string; id: string; name?: string; scopeType?: SlackConnectionScopeType; scopeId?: string; secret?: string; force?: boolean; }): Promise<SlackManagedConnection>;
```

#### `deleteSlackConnection`

Refused with `slack_connection_in_use` while any claim exists.

```typescript
deleteSlackConnection(input: { projectId: string; actorId: string; id: string; }): Promise<SlackConnectionDeleted>;
```

#### `getUsableSlackConnection`

Main's `getUsableByProject`: throws `slack_integration_missing` when out of reach.

```typescript
getUsableSlackConnection(input: { id: string; projectId: string }): Promise<SlackConnectionView>;
```

#### `findUsableSlackSecret`

Main's `findUsableSecret`: zero or one decrypted secret.

```typescript
findUsableSlackSecret(input: { id: string; projectId: string }): Promise<SlackConnectionSecret[]>;
```

#### `findOrCreateSlackConnectionForSecret`

```typescript
findOrCreateSlackConnectionForSecret(input: { organizationId: string; projectId: string; kind: SlackConnectionKind; secret: string; actorId: string; }): Promise<{ id: string; wasCreated: boolean }>;
```

#### `claimConnection`

Idempotent on (connectionId, claimant.id); refreshes the label.

```typescript
claimConnection(input: { connectionId: string; projectId: string; claimant: SlackConnectionClaimant; }): Promise<void>;
```

#### `releaseConnection`

Idempotent: releasing nothing is fine.

```typescript
releaseConnection(input: { connectionId: string; projectId: string; claimantId: string; }): Promise<void>;
```

#### `listSlackConnectionClaims`

Every claim in the install, a page at a time by claim id: a claimant releases stale ones.

```typescript
listSlackConnectionClaims(input: { after?: string; limit?: number; }): Promise<SlackConnectionClaimPage>;
```

## REST transport

### `slackRest`

|             |                                                            |
| ----------- | ---------------------------------------------------------- |
| Declared at | `src/transport/slack.rest.ts:40`                           |
| Base URL    | `/api/slack-connections`, twin `/api/v1/slack-connections` |
| Addressing  | dated                                                      |
| Credential  | project                                                    |
| Versions    | `2026-08-07`                                               |

#### `GET /` · `getApiSlackConnections`

List the Slack connections this project can deliver through: its own and its organization's, by name. Never returns a token or webhook URL.

Permission `project:view`. Declared at `src/transport/slack.rest.ts:44`.

Answers at `/api/slack-connections`, `/api/v1/slack-connections`; also, undocumented, `/api/slack-connections/2026-08-07`, `/api/v1/slack-connections/2026-08-07`, `/api/slack-connections/latest`, `/api/v1/slack-connections/latest`.

```typescript
// Response: z.array(slackConnectionRestResponseSchema) (inline, src/transport/slack.rest.ts:46)
```

## tRPC transport

### `slackIntegration`

Contract `../contract/src/slack.trpc.ts:57`, router `src/transport/slack.trpc.ts:12`.

| Procedure                 | Kind     | Gate                      | Input               | Output                         |
| ------------------------- | -------- | ------------------------- | ------------------- | ------------------------------ |
| `slackIntegration.list`   | query    | Permission `project:view` | `listInputSchema`   | `slackConnectionListSchema`    |
| `slackIntegration.create` | mutation | Permission `project:view` | `createInputSchema` | `slackManagedConnectionSchema` |
| `slackIntegration.update` | mutation | Permission `project:view` | `updateInputSchema` | `slackManagedConnectionSchema` |
| `slackIntegration.delete` | mutation | Permission `project:view` | `deleteInputSchema` | `slackConnectionDeletedSchema` |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: slack declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf                     | Environment variable          | Declared at               |
| ------ | ------------------------ | ----------------------------- | ------------------------- |
| secret | `fingerprintKey`         | `CREDENTIALS_SECRET`          | `src/app/slack.app.ts:42` |
| secret | `fingerprintKeyFallback` | `NEXTAUTH_SECRET`             | `src/app/slack.app.ts:43` |
| secret | `fingerprintKeyPrevious` | `CREDENTIALS_SECRET_PREVIOUS` | `src/app/slack.app.ts:45` |

<!-- readme:generated:end -->
