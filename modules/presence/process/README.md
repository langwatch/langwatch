# @langwatch/presence-process

The server half of [presence](../README.md). Presence: who else is looking at this project, where they are, and where their cursor is.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("presence").withRepositories(presenceRepositories).withApi(PresenceModule).withTransports(presenceTrpcTransport)`, `src/presence.module.ts:9`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`PresenceApi`)

Who else is looking at this project, where they are, and where their cursor is.

Peers call these through the token, declared at `../contract/src/presence.api.ts:36`; nothing else in this package is public.

#### `isEnabledForProject`

```typescript
isEnabledForProject(input: PresenceProjectInput): Promise<boolean>;
```

#### `update`

One browser session's heartbeat: its location now, and that it is still here. `user` is the presenter the door resolved (authenticated id, session name and image), never the payload's.

```typescript
update(input: PresenceUpdateInput): Promise<void>;
```

#### `leave`

```typescript
leave(input: PresenceLeaveInput): Promise<void>;
```

#### `list`

```typescript
list(input: PresenceProjectInput): Promise<PresenceSession[]>;
```

#### `broadcastCursor`

```typescript
broadcastCursor(input: PresenceCursorInput): Promise<void>;
```

#### `events`

```typescript
events(input: PresenceProjectInput & { signal?: PresenceStreamSignal }): AsyncGenerator<PresenceEvent>;
```

#### `cursors`

```typescript
cursors(input: PresenceCursorSubscription & { signal?: PresenceStreamSignal }): AsyncGenerator<PresenceCursorEvent>;
```

#### `getTenantEmitter`

{@link PresenceBroadcastFabric}: the tenant's live-update signals.

```typescript
getTenantEmitter(tenantId: string): PresenceTenantEmitter;
```

#### `cleanupTenantEmitter`

{@link PresenceBroadcastFabric}: releases the tenant emitter a subscription borrowed.

```typescript
cleanupTenantEmitter(tenantId: string): void;
```

#### `publishProjectEvent`

```typescript
publishProjectEvent(input: PresenceProjectEvent): Promise<void>;
```

#### `readHints`

The read hints of one user, organisation and project until the signal aborts.

```typescript
readHints(input: ReadHintsWatchInput): AsyncIterable<ReadHint>;
```

#### `upgradeReadHints`

The upgrade runner's platform-scoped hints, for the Ops Upgrades pages, until the abort.

```typescript
upgradeReadHints(input: UpgradeReadHintsWatchInput): AsyncIterable<ReadHint>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `presence`

Contract `../contract/src/presence.trpc.ts:26`, router `src/transport/presence.trpc.ts:26`.

| Procedure                          | Kind         | Gate                           | Input                              | Output                       |
| ---------------------------------- | ------------ | ------------------------------ | ---------------------------------- | ---------------------------- |
| `presence.update`                  | mutation     | Permission `traces:view`       | `presenceUpdateRequestSchema`      | `presenceAcknowledgedSchema` |
| `presence.leave`                   | mutation     | Permission `traces:view`       | `presenceLeaveRequestSchema`       | `presenceAcknowledgedSchema` |
| `presence.cursor`                  | mutation     | Permission `traces:view`       | `presenceCursorRequestSchema`      | `presenceAcknowledgedSchema` |
| `presence.onPresenceUpdate`        | subscription | Permission `traces:view`       | `presenceProjectInputSchema`       | `presenceEventSchema`        |
| `presence.onPresenceCursor`        | subscription | Permission `traces:view`       | `presenceCursorSubscriptionSchema` | `presenceCursorEventSchema`  |
| `presence.onOrganizationReadHints` | subscription | Permission `organization:view` | `organizationReadHintsInputSchema` | `readHintSchema`             |
| `presence.onProjectReadHints`      | subscription | Permission `project:view`      | `projectReadHintsInputSchema`      | `readHintSchema`             |
| `presence.onUpgradeReadHints`      | subscription | Platform permission `ops:view` | inline                             | `readHintSchema`             |

```typescript
// presence.update
type Input = z.infer<typeof presenceUpdateRequestSchema>; // ../contract/src/presence.ts:119
// Output: presenceAcknowledgedSchema, ../contract/src/presence.ts:179
interface Output {
  ok: true;
}

// presence.leave
// Input: presenceLeaveRequestSchema, ../contract/src/presence.ts:128
interface Input {
  projectId: string;
  sessionId: string;
}
type Output = z.infer<typeof presenceAcknowledgedSchema>; // ../contract/src/presence.ts:179

// presence.cursor
// Input: presenceCursorRequestSchema, ../contract/src/presence.ts:159
interface Input {
  projectId: string;
  sessionId: string;
  payload: {
    anchor: string;
    x: number;
    y: number;
  };
}
type Output = z.infer<typeof presenceAcknowledgedSchema>; // ../contract/src/presence.ts:179

// presence.onPresenceUpdate
// Input: presenceProjectInputSchema, ../contract/src/presence.ts:101
interface Input {
  projectId: string;
}
type Output = z.infer<typeof presenceEventSchema>; // ../contract/src/presence.ts:70

// presence.onPresenceCursor
// Input: presenceCursorSubscriptionSchema, ../contract/src/presence.ts:169
interface Input {
  projectId: string;
  anchor: string;
  sessionId: string;
}
type Output = z.infer<typeof presenceCursorEventSchema>; // ../contract/src/presence.ts:93

// presence.onOrganizationReadHints
// Input: organizationReadHintsInputSchema, ../contract/src/read-hints.ts:16
interface Input {
  organizationId: string;
}
// Output: readHintSchema, ../contract/src/read-hints.ts:12
interface Output {
  path: string;
}

// presence.onProjectReadHints
// Input: projectReadHintsInputSchema, ../contract/src/read-hints.ts:22
interface Input {
  organizationId: string;
  projectId: string;
}
type Output = z.infer<typeof readHintSchema>; // ../contract/src/read-hints.ts:12

// presence.onUpgradeReadHints
// Input: inline, ../contract/src/presence.trpc.ts:64
type Input = unknown;
type Output = z.infer<typeof readHintSchema>; // ../contract/src/read-hints.ts:12
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: presence declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
