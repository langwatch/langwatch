# @langwatch/data-retention-process

The server half of [data-retention](../README.md). Data retention: the retention policy per scope, the pins that keep data past it, and its metering.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("data-retention").withRepositories(dataRetentionRepositories).withApi(DataRetentionModule).withTransports(dataRetentionTrpcTransport).withEventing(dataRetentionProjectScopeEventing).withMigrations(…)`, `src/data-retention.module.ts:13`.

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
setForScope(input: { scope: ScopeAssignment; category: RetentionCategory; retentionDays: number; }): Promise<RetentionPolicy>;
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

The retention settings surface. Each operation authorizes and plan-gates the caller against the scope it acts on, never against a project id the input also carries: the two can belong to different organizations.

```typescript
getPolicySnapshot(input: { projectId: string } & RetentionCallerInput): Promise<RetentionPolicySnapshot>;
```

#### `getScopeStorageUsage`

```typescript
getScopeStorageUsage(input: { projectId: string; scope: ScopeAssignment } & RetentionCallerInput): Promise<RetentionStorageUsage>;
```

#### `previewScopeRemoval`

```typescript
previewScopeRemoval(input: { scope: ScopeAssignment } & RetentionCallerInput): Promise<ResolvedRetention>;
```

#### `changeScopeRetention`

```typescript
changeScopeRetention(input: { scope: ScopeAssignment; category: RetentionCategory; retentionDays: number; } & RetentionCallerInput): Promise<RetentionPolicy>;
```

#### `removeForScope`

```typescript
removeForScope(input: { scope: ScopeAssignment; category: RetentionCategory } & RetentionCallerInput): Promise<void>;
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

Contract `../contract/src/data-retention.trpc.ts:45`, router `src/transport/data-retention.trpc.ts:35`.

| Procedure                                | Kind     | Gate                                                                                                                                                                                                          | Input                                    | Output                                   |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `dataRetention.getRules`                 | query    | Permission `project:view`                                                                                                                                                                                     | `retentionProjectScopeSchema`            | `retentionPolicySnapshotSchema`          |
| `dataRetention.setForScope`              | mutation | Service-authorized: SCOPE_TARGETED_PERMISSIONS; The authorized target is the organization, team or project named by `scope`, which the app resolves — the `projectId` this input also carries is not acted on | inline                                   | `retentionPolicySchema`                  |
| `dataRetention.previewScopeRemoval`      | query    | Service-authorized: SCOPE_TARGETED_PERMISSIONS; The authorized target is the organization, team or project named by `scope`, which the app resolves — the `projectId` this input also carries is not acted on | `retentionScopeTargetInputSchema`        | `resolvedRetentionSchema`                |
| `dataRetention.removeForScope`           | mutation | Service-authorized: SCOPE_TARGETED_PERMISSIONS; The authorized target is the organization, team or project named by `scope`, which the app resolves — the `projectId` this input also carries is not acted on | inline                                   | –                                        |
| `dataRetention.triggerRetroactiveUpdate` | mutation | Permission `project:update`                                                                                                                                                                                   | `retentionTriggerRetroactiveInputSchema` | `retroactiveRetentionUpdateResultSchema` |
| `dataRetention.getMutationProgress`      | query    | Permission `traces:view`                                                                                                                                                                                      | `retroactiveMutationProjectInputSchema`  | inline                                   |
| `dataRetention.killMutation`             | mutation | Permission `project:update`                                                                                                                                                                                   | `killRetroactiveMutationInputSchema`     | –                                        |
| `dataRetention.getScopeStorageUsage`     | query    | Permission `traces:view`                                                                                                                                                                                      | `retentionScopeTargetInputSchema`        | `retentionStorageUsageSchema`            |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `data_retention_project_scope` (aggregate `data_retention_project_scope`)

Declared at `src/eventing/data-retention-project-scope.pipeline.ts:17`.

| Kind                 | Name                                         | Handles | Declared at                                                |
| -------------------- | -------------------------------------------- | ------- | ---------------------------------------------------------- |
| peer fold projection | `≈ dataRetentionProjectScopePeerFold(store)` | –       | `src/eventing/data-retention-project-scope.pipeline.ts:22` |

## Configuration

| Kind   | Leaf                  | Environment variable               | Declared at                                   |
| ------ | --------------------- | ---------------------------------- | --------------------------------------------- |
| config | `platformDefaultDays` | `LANGWATCH_DEFAULT_RETENTION_DAYS` | `../contract/src/data-retention.config.ts:15` |
| config | `isSaas`              | `IS_SAAS`                          | `../contract/src/data-retention.config.ts:17` |
| config | `nodeEnvironment`     | `NODE_ENV`                         | `../contract/src/data-retention.config.ts:19` |

<!-- readme:generated:end -->
