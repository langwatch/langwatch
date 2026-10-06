# @langwatch/share-process

The server half of [share](../README.md). Share links: creating, resolving and revoking them, and the retention pin an active link holds on its trace.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("share").withRepositories(shareRepositories).withApi(ShareModule).withTransports(shareTrpcTransport, pinnedTraceTrpcTransport)`, `src/share.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ShareApi`)

Every share-link operation, plus the retention pin an active link holds. A pin is retention state, but a trace unpinned under a live link cannot be redeemed, so share is the door that guards it.

Peers call these through the token, declared at `../contract/src/share.api.ts:21`; nothing else in this package is public.

#### `listForResource`

```typescript
listForResource(input: ShareResourceInput): Promise<ShareLink[]>;
```

#### `resolveForViewer`

```typescript
resolveForViewer(input: ResolveShareInput): Promise<ShareWithProject>;
```

#### `createShare`

```typescript
createShare(input: CreateShareInput): Promise<ShareLink>;
```

#### `revokeById`

```typescript
revokeById(input: RevokeShareInput): Promise<void>;
```

#### `unshare`

```typescript
unshare(input: ShareResourceInput): Promise<void>;
```

#### `revokeAllTraceShares`

```typescript
revokeAllTraceShares(projectId: string): Promise<void>;
```

#### `pinTrace`

```typescript
pinTrace(input: PinTraceInput): Promise<PinnedTrace>;
```

#### `unpinTrace`

```typescript
unpinTrace(input: TracePinInput): Promise<void>;
```

#### `findTracePin`

```typescript
findTracePin(input: TracePinInput): Promise<PinnedTrace | null>;
```

#### `listTracePins`

```typescript
listTracePins(input: ShareProjectScope): Promise<PinnedTrace[]>;
```

#### `findCachedPayload`

```typescript
findCachedPayload(input: SharedPayloadCacheInput): Promise<unknown>;
```

#### `cachePayload`

```typescript
cachePayload(input: SharedPayloadCacheInput & { payload: unknown }): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `pinnedTrace`

Contract `../contract/src/pinned-trace.trpc.ts:23`, router `src/transport/pinned-trace.trpc.ts:11`.

| Procedure                   | Kind     | Gate                        | Input                           | Output              |
| --------------------------- | -------- | --------------------------- | ------------------------------- | ------------------- |
| `pinnedTrace.pin`           | mutation | Permission `project:update` | `pinnedTracePinInputSchema`     | `pinnedTraceSchema` |
| `pinnedTrace.unpin`         | mutation | Permission `project:update` | `pinnedTraceScopeSchema`        | inline              |
| `pinnedTrace.getPin`        | query    | Permission `traces:view`    | `pinnedTraceScopeSchema`        | inline              |
| `pinnedTrace.listByProject` | query    | Permission `traces:view`    | `pinnedTraceProjectInputSchema` | inline              |

### `share`

Contract `../contract/src/share.trpc.ts:35`, router `src/transport/share.trpc.ts:11`.

| Procedure                    | Kind     | Gate                        | Input                             | Output            |
| ---------------------------- | -------- | --------------------------- | --------------------------------- | ----------------- |
| `share.listForResource`      | query    | Permission `traces:share`   | `shareListForResourceInputSchema` | inline            |
| `share.createShare`          | mutation | Permission `traces:share`   | `shareCreateInputSchema`          | `shareLinkSchema` |
| `share.revoke`               | mutation | Permission `traces:share`   | `shareRevokeInputSchema`          | inline            |
| `share.revokeAllTraceShares` | mutation | Permission `project:update` | `shareProjectInputSchema`         | inline            |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: share declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
