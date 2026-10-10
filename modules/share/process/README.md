# @langwatch/share-process

The server half of [share](../README.md). Share links: creating, resolving and revoking them, and the retention pin an active link holds on its trace.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("share").withRepositories(shareRepositories).withApi(ShareModule).withTransports(shareTrpcTransport, pinnedTraceTrpcTransport).withEventing(shareTraceSharingRevocationEventing)`, `src/share.module.ts:10`.

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

#### `countTraceShares`

How many trace links the project holds, asked before sharing is switched off.

```typescript
countTraceShares(input: ShareProjectScope): Promise<number>;
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

```typescript
// pinnedTrace.pin
// Input: pinnedTracePinInputSchema, ../contract/src/pinned-trace.trpc.ts:16
interface Input {
  projectId: string;
  traceId: string;
  reason?: string;
}
// Output: pinnedTraceSchema, ../../data-retention/contract/src/data-retention.ts:55
interface Output {
  id: string;
  projectId: string;
  traceId: string;
  userId: string | null;
  source: "manual" | "share";
  reason: string | null;
  createdAt: unknown;
}

// pinnedTrace.unpin
// Input: pinnedTraceScopeSchema, ../contract/src/pinned-trace.trpc.ts:11
interface Input {
  projectId: string;
  traceId: string;
}
// Output: inline, ../contract/src/pinned-trace.trpc.ts:30
type Output = unknown;

// pinnedTrace.getPin
type Input = z.infer<typeof pinnedTraceScopeSchema>; // ../contract/src/pinned-trace.trpc.ts:11
// Output: inline, ../contract/src/pinned-trace.trpc.ts:34
type Output = {
  id: string;
  projectId: string;
  traceId: string;
  userId: string | null;
  source: "manual" | "share";
  reason: string | null;
  createdAt: unknown;
} | null;

// pinnedTrace.listByProject
// Input: pinnedTraceProjectInputSchema, ../contract/src/pinned-trace.trpc.ts:21
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/pinned-trace.trpc.ts:38
type Output = {
  id: string;
  projectId: string;
  traceId: string;
  userId: string | null;
  source: "manual" | "share";
  reason: string | null;
  createdAt: unknown;
}[];
```

### `share`

Contract `../contract/src/share.trpc.ts:35`, router `src/transport/share.trpc.ts:11`.

| Procedure                    | Kind     | Gate                        | Input                             | Output            |
| ---------------------------- | -------- | --------------------------- | --------------------------------- | ----------------- |
| `share.listForResource`      | query    | Permission `traces:share`   | `shareListForResourceInputSchema` | inline            |
| `share.createShare`          | mutation | Permission `traces:share`   | `shareCreateInputSchema`          | `shareLinkSchema` |
| `share.revoke`               | mutation | Permission `traces:share`   | `shareRevokeInputSchema`          | inline            |
| `share.countTraceShares`     | query    | Permission `project:manage` | `shareProjectInputSchema`         | inline            |
| `share.revokeAllTraceShares` | mutation | Permission `project:update` | `shareProjectInputSchema`         | inline            |

```typescript
// share.listForResource
// Input: shareListForResourceInputSchema, ../contract/src/share.trpc.ts:12
interface Input {
  projectId: string;
  resourceType: "TRACE" | "THREAD";
  resourceId: string;
}
// Output: shareLinkSchema.array() (inline, ../contract/src/share.trpc.ts:43)

// share.createShare
// Input: shareCreateInputSchema, ../contract/src/share.trpc.ts:22
interface Input {
  projectId: string;
  resourceType: "TRACE";
  resourceId: string;
  visibility?: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  expiresAt?: unknown | null;
  maxViews?: number | null;
}
type Output = z.infer<typeof shareLinkSchema>; // ../contract/src/share.ts:11

// share.revoke
// Input: shareRevokeInputSchema, ../contract/src/share.trpc.ts:31
interface Input {
  projectId: string;
  id: string;
}
// Output: inline, ../contract/src/share.trpc.ts:52
type Output = unknown;

// share.countTraceShares
// Input: shareProjectInputSchema, ../contract/src/share.trpc.ts:33
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/share.trpc.ts:56
type Output = number;

// share.revokeAllTraceShares
type Input = z.infer<typeof shareProjectInputSchema>; // ../contract/src/share.trpc.ts:33
// Output: inline, ../contract/src/share.trpc.ts:60
type Output = unknown;
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `share_trace_sharing_revocation` (aggregate `global`)

Declared at `src/eventing/share-trace-sharing-revocation.pipeline.ts:40`.

| Kind            | Name                                    | Handles                                                                                    | Declared at                                                  |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| peer subscriber | `shareProjectTraceSharingDisabled`      | `lw.project.trace_sharing_disabled` from [project](../../project/README.md)                | `src/eventing/share-trace-sharing-revocation.pipeline.ts:47` |
| peer subscriber | `shareOrganizationTraceSharingDisabled` | `lw.organization.trace_sharing_disabled` from [organization](../../organization/README.md) | `src/eventing/share-trace-sharing-revocation.pipeline.ts:64` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
