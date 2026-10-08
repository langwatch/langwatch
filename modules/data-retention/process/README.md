# @langwatch/data-retention-process

The server half of [data-retention](../README.md). Data retention: the retention policy per scope, the pins that keep data past it, and its metering.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("data-retention").withRepositories(dataRetentionRepositories).withApi(DataRetentionModule).withTransports(dataRetentionTrpcTransport).withEventing(dataRetentionSeatPolicyEventing)`, `src/data-retention.module.ts:16`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`DataRetentionApi`)

The callable server boundary for retention policy, pins, and metering.

Peers call these through the token, declared at `../contract/src/data-retention.api.ts:27`; nothing else in this package is public.

#### `getPlatformDefaultRetentionDays`

The days a row with no override in its cascade is kept for, which is this deployment's own fact: a peer stamping a TTL reads it here rather than claiming `LANGWATCH_DEFAULT_RETENTION_DAYS` a second time.

```typescript
getPlatformDefaultRetentionDays(): number;
```

#### `getResolvedForProject`

```typescript
getResolvedForProject(input: { projectId: string }): Promise<ResolvedRetention>;
```

#### `getRetentionDays`

```typescript
getRetentionDays(input: { projectId: string; category: RetentionCategory }): Promise<number>;
```

#### `listOrganizationRules`

```typescript
listOrganizationRules(input: { organizationId: string }): Promise<RetentionPolicy[]>;
```

#### `setForScope`

The system write, for a plan change that resets an organization's window.

```typescript
setForScope(input: { organizationId: string; scope: ScopeAssignment; category: RetentionCategory; retentionDays: number; }): Promise<RetentionPolicy>;
```

#### `pin`

```typescript
pin(input: PinTraceInput): Promise<PinnedTrace>;
```

#### `unpin`

```typescript
unpin(input: UnpinTraceInput): Promise<void>;
```

#### `autoPin`

```typescript
autoPin(input: UnpinTraceInput): Promise<PinnedTrace>;
```

#### `autoUnpin`

```typescript
autoUnpin(input: UnpinTraceInput): Promise<void>;
```

#### `isPinned`

```typescript
isPinned(input: UnpinTraceInput): Promise<boolean>;
```

#### `findPin`

```typescript
findPin(input: UnpinTraceInput): Promise<PinnedTrace | null>;
```

#### `listByProject`

```typescript
listByProject(input: { projectId: string }): Promise<PinnedTrace[]>;
```

#### `getPinnedTraceIds`

```typescript
getPinnedTraceIds(input: { projectId: string }): Promise<string[]>;
```

#### `getRetroactiveMutationProgress`

```typescript
getRetroactiveMutationProgress(input: RetroactiveMutationProjectInput): Promise<RetroactiveMutationProgress[]>;
```

#### `getTotalStorageBytes`

```typescript
getTotalStorageBytes(input: StorageMeterTenantInput): Promise<number>;
```

#### `getTotalStorageBytesForTenants`

```typescript
getTotalStorageBytesForTenants(input: StorageMeterTenantsInput): Promise<number>;
```

#### `getPolicySnapshot`

The retention settings surface. The door authorises each scope write on its target; these refuse a target outside `organizationId` and plan-gate on it.

```typescript
getPolicySnapshot(input: { projectId: string } & RetentionCallerInput): Promise<RetentionPolicySnapshot>;
```

#### `getScopeStorageUsage`

```typescript
getScopeStorageUsage(input: { projectId: string; scope: ScopeAssignment } & RetentionCallerInput): Promise<RetentionStorageUsage>;
```

#### `previewScopeRemoval`

```typescript
previewScopeRemoval(input: { organizationId: string; scope: ScopeAssignment } & RetentionCallerInput): Promise<ResolvedRetention>;
```

#### `changeScopeRetention`

```typescript
changeScopeRetention(input: { organizationId: string; scope: ScopeAssignment; category: RetentionCategory; retentionDays: number; } & RetentionCallerInput): Promise<RetentionPolicy>;
```

#### `removeForScope`

```typescript
removeForScope(input: { organizationId: string; scope: ScopeAssignment; category: RetentionCategory; } & RetentionCallerInput): Promise<void>;
```

#### `applyRetentionToExistingData`

Rewrites the project's existing rows to the retention the cascade resolves, never to a caller-supplied value: a `project:update` caller must not be able to contract data to any number it names.

```typescript
applyRetentionToExistingData(input: { projectId: string; category: RetentionCategory } & RetentionCallerInput): Promise<{ tables: string[]; appliedRetentionDays: number }>;
```

#### `killRetroactiveMutation`

```typescript
killRetroactiveMutation(input: KillRetroactiveMutationInput & RetentionCallerInput): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `dataRetention`

Contract `../contract/src/data-retention.trpc.ts:51`, router `src/transport/data-retention.trpc.ts:28`.

| Procedure                                | Kind     | Gate                        | Input                                    | Output                                   |
| ---------------------------------------- | -------- | --------------------------- | ---------------------------------------- | ---------------------------------------- |
| `dataRetention.getRules`                 | query    | Permission `project:view`   | `retentionProjectScopeSchema`            | `retentionPolicySnapshotSchema`          |
| `dataRetention.setForScope`              | mutation | Gate ≈ `WRITE_ON_SCOPE`     | inline                                   | `retentionPolicySchema`                  |
| `dataRetention.previewScopeRemoval`      | query    | Gate ≈ `WRITE_ON_SCOPE`     | `retentionScopeWriteInputSchema`         | `resolvedRetentionSchema`                |
| `dataRetention.removeForScope`           | mutation | Gate ≈ `WRITE_ON_SCOPE`     | inline                                   | –                                        |
| `dataRetention.triggerRetroactiveUpdate` | mutation | Permission `project:update` | `retentionTriggerRetroactiveInputSchema` | `retroactiveRetentionUpdateResultSchema` |
| `dataRetention.getMutationProgress`      | query    | Permission `traces:view`    | `retroactiveMutationProjectInputSchema`  | inline                                   |
| `dataRetention.killMutation`             | mutation | Permission `project:update` | `killRetroactiveMutationInputSchema`     | –                                        |
| `dataRetention.getScopeStorageUsage`     | query    | Permission `traces:view`    | `retentionScopeTargetInputSchema`        | `retentionStorageUsageSchema`            |

```typescript
// dataRetention.getRules
// Input: retentionProjectScopeSchema, ../contract/src/data-retention.trpc.ts:27
interface Input {
  projectId: string;
}
type Output = z.infer<typeof retentionPolicySnapshotSchema>; // ../contract/src/data-retention.snapshot.ts:44

// dataRetention.setForScope
// Input: inline, ../contract/src/data-retention.trpc.ts:67
interface Input {
  projectId: string;
  scope: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  };
  organizationId: string;
  category: "traces" | "scenarios" | "experiments";
  retentionDays: 0 | number;
}
// Output: retentionPolicySchema, ../contract/src/data-retention.ts:165
interface Output {
  id: string;
  organizationId: string;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
  category: "traces" | "scenarios" | "experiments";
  retentionDays: 0 | number;
  createdAt: unknown;
  updatedAt: unknown;
}

// dataRetention.previewScopeRemoval
// Input: retentionScopeWriteInputSchema, ../contract/src/data-retention.trpc.ts:41
interface Input {
  projectId: string;
  scope: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  };
  organizationId: string;
}
// Output: resolvedRetentionSchema, ../contract/src/data-retention.ts:189
interface Output {
  traces: number;
  scenarios: number;
  experiments: number;
}

// dataRetention.removeForScope
// Input: inline, ../contract/src/data-retention.trpc.ts:87
interface Input {
  projectId: string;
  scope: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  };
  organizationId: string;
  category: "traces" | "scenarios" | "experiments";
}

// dataRetention.triggerRetroactiveUpdate
// Input: retentionTriggerRetroactiveInputSchema, ../contract/src/data-retention.trpc.ts:46
interface Input {
  projectId: string;
  category: "traces" | "scenarios" | "experiments";
}
// Output: retroactiveRetentionUpdateResultSchema, ../contract/src/data-retention.ts:249
interface Output {
  tables: string[];
  appliedRetentionDays: number;
}

// dataRetention.getMutationProgress
// Input: retroactiveMutationProjectInputSchema, ../contract/src/data-retention.ts:144
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/data-retention.trpc.ts:97
type Output = {
  mutationId: string;
  table: string;
  isDone: boolean;
  partsToDo: number;
  createTime: string;
  category: "traces" | "scenarios" | "experiments" | null;
}[];

// dataRetention.killMutation
// Input: killRetroactiveMutationInputSchema, ../contract/src/data-retention.ts:157
interface Input {
  projectId: string;
  mutationId: string;
}

// dataRetention.getScopeStorageUsage
// Input: retentionScopeTargetInputSchema, ../contract/src/data-retention.trpc.ts:35
interface Input {
  projectId: string;
  scope: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  };
}
// Output: retentionStorageUsageSchema, ../contract/src/data-retention.snapshot.ts:67
interface Output {
  totalBytes: number;
  projectCount: number;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `data_retention_seat_policy` (aggregate `global`)

Declared at `src/eventing/data-retention-seat-policy.pipeline.ts:32`.

| Kind            | Name                          | Handles                                                                                         | Declared at                                              |
| --------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| peer subscriber | `dataRetentionSeatActivation` | `lw.billing.subscription_started` from [billing](../../../enterprise/modules/billing/README.md) | `src/eventing/data-retention-seat-policy.pipeline.ts:38` |

## Configuration

| Kind   | Leaf                  | Environment variable               | Declared at                                   |
| ------ | --------------------- | ---------------------------------- | --------------------------------------------- |
| config | `platformDefaultDays` | `LANGWATCH_DEFAULT_RETENTION_DAYS` | `../contract/src/data-retention.config.ts:15` |
| config | `isSaas`              | `IS_SAAS`                          | `../contract/src/data-retention.config.ts:17` |
| config | `nodeEnvironment`     | `NODE_ENV`                         | `../contract/src/data-retention.config.ts:19` |

<!-- readme:generated:end -->
