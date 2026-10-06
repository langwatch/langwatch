# @langwatch/entitlement-process

The server half of [entitlement](../README.md). What a plan allows, and what has been used and spent against it, so the allowance a banner quotes and the usage a panel shows are the same answer.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("entitlement").withRepositories(entitlementRepositories).withApi(EntitlementModule).withTransports(planTrpcTransport, usageLimitsTrpcTransport, organizationSpendTrpcTransport).withEventing(entitlementUsageWarningEventing)`, `src/entitlement.module.ts:12`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EntitlementApi`)

What a plan allows, and what has been used and spent against it. One capability, because the allowance a banner quotes and the reading a usage panel shows have to be the same answer.

Peers call these through the token, declared at `../contract/src/entitlement.api.ts:21`; nothing else in this package is public.

#### `getActivePlan`

```typescript
getActivePlan(input: ResolvePlanInput): Promise<Plan>;
```

#### `getUsage`

```typescript
getUsage(input: GetUsageInput): Promise<UsageStats>;
```

#### `assertWithinUsageLimit`

Throws `ERR_PLAN_LIMIT` (402) once the organization spent its monthly allowance.

```typescript
assertWithinUsageLimit(input: { organizationId: string }): Promise<void>;
```

#### `sendUsageLimitWarning`

```typescript
sendUsageLimitWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
```

#### `listOrganizationSpend`

```typescript
listOrganizationSpend(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]>;
```

#### `requestBound`

The numeric ceiling one request dimension answers under the organization's active plan (enterprise for ENTERPRISE/OPEN_SOURCE, free for FREE/LAUNCH, paid otherwise). `LANGWATCH_REQUEST_BOUNDS` overrides win over tier values.

```typescript
requestBound(input: { key: RequestBoundKey; organizationId: string }): Promise<number>;
```

#### `resolvePlanNextStep`

Where this plan upgrades next, priced from the organization's own model and currency.

```typescript
resolvePlanNextStep(input: Readonly<{ plan: Plan; organizationId: string }>): Promise<PlanNextStep>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `costs`

Contract `../contract/src/entitlement.trpc.ts:40`, router `src/transport/organization-spend.trpc.ts:12`.

| Procedure                                 | Kind  | Gate                           | Input                        | Output |
| ----------------------------------------- | ----- | ------------------------------ | ---------------------------- | ------ |
| `costs.getAggregatedCostsForOrganization` | query | Permission `organization:view` | `aggregatedCostsInputSchema` | inline |

### `plan`

Contract `../contract/src/entitlement.trpc.ts:17`, router `src/transport/plan.trpc.ts:9`.

| Procedure            | Kind  | Gate                           | Input                                | Output       |
| -------------------- | ----- | ------------------------------ | ------------------------------------ | ------------ |
| `plan.getActivePlan` | query | Permission `organization:view` | `entitlementOrganizationScopeSchema` | `planSchema` |

### `limits`

Contract `../contract/src/entitlement.trpc.ts:23`, router `src/transport/usage-limits.trpc.ts:12`.

| Procedure                                   | Kind     | Gate                             | Input                                | Output                    |
| ------------------------------------------- | -------- | -------------------------------- | ------------------------------------ | ------------------------- |
| `limits.getUsage`                           | query    | Permission `organization:view`   | `entitlementOrganizationScopeSchema` | `usageStatsSchema`        |
| `limits.checkAndSendUsageLimitNotification` | mutation | Permission `organization:manage` | `sendUsageLimitWarningInputSchema`   | `usageLimitWarningSchema` |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `entitlement_usage_warning` (aggregate `global`)

Declared at `src/eventing/entitlement-usage-warning.pipeline.ts:31`.

| Kind            | Name                           | Handles                                                                                       | Declared at                                             |
| --------------- | ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| process manager | `entitlementUsageWarningSweep` | every 1 d (`USAGE_WARNING_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/entitlement-usage-warning.pipeline.ts:36` |

## Configuration

| Kind   | Leaf            | Environment variable       | Declared at                                |
| ------ | --------------- | -------------------------- | ------------------------------------------ |
| config | `requestBounds` | `LANGWATCH_REQUEST_BOUNDS` | `../contract/src/entitlement.config.ts:20` |
| config | `isSaas`        | `IS_SAAS`                  | `../contract/src/entitlement.config.ts:22` |

<!-- readme:generated:end -->
