# @langwatch/presence-process

The server half of [presence](../README.md). Presence: who else is looking at this project, where they are, and where their cursor is.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("presence").withRepositories(presenceRepositories).withApi(PresenceModule).withTransports(presenceTrpcTransport).withEventing(presenceSettingsEventing)`, `src/presence.module.ts:15`.

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

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `presence_settings` (aggregate `global`)

Declared at `src/eventing/presence-settings.pipeline.ts:37`.

| Kind            | Name                                 | Handles                                                                                      | Declared at                                     |
| --------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| peer subscriber | `presenceProjectCreated`             | `lw.project.created` from [project](../../project/README.md)                                 | `src/eventing/presence-settings.pipeline.ts:44` |
| peer subscriber | `presenceProjectSettingChanged`      | `lw.project.presence_setting_changed` from [project](../../project/README.md)                | `src/eventing/presence-settings.pipeline.ts:50` |
| peer subscriber | `presenceOrganizationSettingChanged` | `lw.organization.presence_setting_changed` from [organization](../../organization/README.md) | `src/eventing/presence-settings.pipeline.ts:61` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
