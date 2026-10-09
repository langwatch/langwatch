# @langwatch/feature-flag-process

The server half of [feature-flag](../README.md). Feature flags: evaluation, operator administration and the browser's authorized reads, sharing one registry, targeting rules and cache invalidation; also experiment enrolment.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("feature-flag").withRepositories(featureFlagRepositories).withApi(FeatureFlagModule).withTransports(featureFlagTrpcTransport)`, `src/feature-flag.module.ts:12`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`FeatureFlagApi`)

The one canonical feature flag capability: evaluation, operator administration and the browser's authorized reads share this API because they share the registry, targeting rules and cache invalidation.

Peers call these through the token, declared at `../contract/src/feature-flag.api.ts:45`; nothing else in this package is public.

#### `isEnabled`

Full resolution: environment override, then force-enable list, then the operator store's targeting rules, then the registry default. Throws `UnknownFeatureFlagError` for a key the registry does not define.

```typescript
isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean>;
```

#### `resolveFrontendFlags`

Every browser-visible flag for one signed-in target, in one pass, bounded by `FRONTEND_FEATURE_FLAGS`. An anonymous browser has its own, narrower surface below.

```typescript
resolveFrontendFlags(target: AuthenticatedExperimentTarget): Promise<FrontendFeatureFlagMap>;
```

#### `resolvePublicAnonymousFlags`

The flags a signed-out browser may resolve, bounded by `PUBLIC_ANONYMOUS_FEATURE_FLAGS` — reachable by anybody, so it must never disclose the name or value of an ordinary frontend flag.

```typescript
resolvePublicAnonymousFlags(target: { kind: "anonymous"; anonymousId: string; }): Promise<PublicAnonymousFlagMap>;
```

#### `resolveExperimentCatalogue`

Every experiment this target may see, with its effective value and reason. An experiment it cannot see is absent, not present-and-false — a signed-out visitor learns nothing about non-public experiments.

```typescript
resolveExperimentCatalogue(target: ExperimentEvaluationTarget): Promise<ExperimentCatalogueEntry[]>;
```

#### `setUserExperimentEnrolment`

A person's own enrolment: joining requires the experiment available to the target; leaving removes the row (not a stored negative) so a later tenant `enabled` still reaches them. Throws for an unknown/unavailable key.

```typescript
setUserExperimentEnrolment(input: UserExperimentEnrolmentInput): Promise<void>;
```

#### `setExperimentTenantPolicy`

An owner's policy for one exact tenant scope the caller authorized. Validates the key is a registered experiment; an unreleased experiment's policy changes nothing until release. Throws for a non-experiment key.

```typescript
setExperimentTenantPolicy(input: ExperimentTenantPolicyInput): Promise<void>;
```

#### `listOperatorCatalogue`

```typescript
listOperatorCatalogue(): Promise<OperatorFeatureFlagCatalogue>;
```

#### `setEnabled`

```typescript
setEnabled(input: FeatureFlagWrite & { enabled: boolean }): Promise<void>;
```

#### `setRules`

```typescript
setRules(input: FeatureFlagWrite & { rules: FeatureFlagRules }): Promise<void>;
```

#### `clearStoredFlag`

```typescript
clearStoredFlag(input: FeatureFlagWrite): Promise<void>;
```

#### `isEnabledForCaller`

One flag for the tenant a signed-in caller named, authorized at that tenant's tier first. A project is checked against the organization that owns it, so a caller cannot pair a project with an org it is not in.

```typescript
isEnabledForCaller(input: FeatureFlagReadForCaller): Promise<boolean>;
```

#### `isEnabledByOrganizationForCaller`

The flag for each organization the caller belongs to. Organizations they are not a member of are absent rather than present-and-false, so the answer cannot be read as a membership oracle.

```typescript
isEnabledByOrganizationForCaller(input: OrganizationFeatureFlagsForCaller): Promise<Record<string, boolean>>;
```

#### `resolveFrontendFlagsForCaller`

Every browser-visible flag for the exact tenant target the caller may view.

```typescript
resolveFrontendFlagsForCaller(input: FeatureFlagTargetRequestForCaller): Promise<FrontendFeatureFlagMap>;
```

#### `listExperimentsForCaller`

The caller's experiments for that target, with tenant policy present only for a caller who may manage it: policies are manager data, and a viewer sees the entry without them.

```typescript
listExperimentsForCaller(input: FeatureFlagTargetRequestForCaller): Promise<ExperimentCatalogueEntry[]>;
```

#### `setExperimentEnrolmentForCaller`

The caller's own enrolment, for a target they may view.

```typescript
setExperimentEnrolmentForCaller(input: ExperimentEnrolmentForCaller): Promise<void>;
```

#### `setExperimentTenantPolicyForCaller`

A tenant policy, for a caller who may manage experiments in that scope.

```typescript
setExperimentTenantPolicyForCaller(input: ExperimentTenantPolicyForCaller): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `featureFlag`

Contract `../contract/src/feature-flag.trpc.ts:30`, router `src/transport/feature-flag.trpc.ts:28`.

| Procedure                                  | Kind     | Gate                                                                                                                                                 | Input                                 | Output                              |
| ------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------- |
| `featureFlag.isEnabled`                    | query    | Service-authorized: TENANT_READ_PERMISSIONS; the feature's own resolver authorizes the exact tenant target before any flag is read or written        | `featureFlagReadInputSchema`          | `enabledOutputSchema`               |
| `featureFlag.isEnabledForAnyOrganization`  | query    | Service-authorized: TENANT_READ_PERMISSIONS; the feature's own resolver authorizes the exact tenant target before any flag is read or written        | `organizationFeatureFlagsInputSchema` | `enabledOutputSchema`               |
| `featureFlag.isEnabledForEachOrganization` | query    | Service-authorized: TENANT_READ_PERMISSIONS; the feature's own resolver authorizes the exact tenant target before any flag is read or written        | `organizationFeatureFlagsInputSchema` | `enabledByOrganizationOutputSchema` |
| `featureFlag.resolve`                      | query    | Service-authorized: TENANT_READ_PERMISSIONS; the feature's own resolver authorizes the exact tenant target before any flag is read or written        | `featureFlagTargetRequestSchema`      | `resolvedFlagsOutputSchema`         |
| `featureFlag.experiments`                  | query    | Service-authorized: EXPERIMENT_PERMISSIONS; the feature's own resolver authorizes the exact tenant target before any flag is read or written         | `featureFlagTargetRequestSchema`      | `experimentsOutputSchema`           |
| `featureFlag.setExperimentEnrolment`       | mutation | Service-authorized: TENANT_READ_PERMISSIONS; the feature's own resolver authorizes the exact tenant target before any flag is read or written        | `experimentEnrolmentInputSchema`      | `experimentWriteOutputSchema`       |
| `featureFlag.setExperimentTenantPolicy`    | mutation | Service-authorized: featureFlags:manageExperiments; the feature's own resolver authorizes the exact tenant target before any flag is read or written | `experimentTenantPolicyInputSchema`   | `experimentWriteOutputSchema`       |

```typescript
// featureFlag.isEnabled
type Input = z.infer<typeof featureFlagReadInputSchema>; // ../contract/src/feature-flag.schemas.ts:66
// Output: enabledOutputSchema, ../contract/src/feature-flag.trpc.ts:20
interface Output {
  enabled: boolean;
}

// featureFlag.isEnabledForAnyOrganization
type Input = z.infer<typeof organizationFeatureFlagsInputSchema>; // ../contract/src/feature-flag.schemas.ts:79
type Output = z.infer<typeof enabledOutputSchema>; // ../contract/src/feature-flag.trpc.ts:20

// featureFlag.isEnabledForEachOrganization
type Input = z.infer<typeof organizationFeatureFlagsInputSchema>; // ../contract/src/feature-flag.schemas.ts:79
// Output: enabledByOrganizationOutputSchema, ../contract/src/feature-flag.trpc.ts:21
interface Output {
  enabledByOrganizationId: Record<string, boolean>;
}

// featureFlag.resolve
type Input = z.infer<typeof featureFlagTargetRequestSchema>; // ../contract/src/feature-flag.schemas.ts:86
// Output: resolvedFlagsOutputSchema, ../contract/src/feature-flag.trpc.ts:24
interface Output {
  flags: Record<string, boolean>;
}

// featureFlag.experiments
type Input = z.infer<typeof featureFlagTargetRequestSchema>; // ../contract/src/feature-flag.schemas.ts:86
type Output = z.infer<typeof experimentsOutputSchema>; // ../contract/src/feature-flag.trpc.ts:25

// featureFlag.setExperimentEnrolment
type Input = z.infer<typeof experimentEnrolmentInputSchema>; // ../contract/src/feature-flag.schemas.ts:90
// Output: experimentWriteOutputSchema, ../contract/src/feature-flag.trpc.ts:28
interface Output {
  ok: true;
}

// featureFlag.setExperimentTenantPolicy
type Input = z.infer<typeof experimentTenantPolicyInputSchema>; // ../contract/src/feature-flag.schemas.ts:98
type Output = z.infer<typeof experimentWriteOutputSchema>; // ../contract/src/feature-flag.trpc.ts:28
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: feature-flag declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf          | Environment variable                                                                           | Declared at                                 |
| ------ | ------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| config | `forceEnable` | `FEATURE_FLAG_FORCE_ENABLE`                                                                    | `../contract/src/feature-flag.config.ts:56` |
| config | `overrides`   | ≈ `Object.fromEntries( FEATURE_FLAGS.filter(isEnvOverridable).map((definition) => [ definiti…` | `../contract/src/feature-flag.config.ts:57` |
| config | `legacy`      | ≈ `Object.fromEntries( FEATURE_FLAGS.flatMap((definition: FeatureFlagDefinition) => definiti…` | `../contract/src/feature-flag.config.ts:63` |

<!-- readme:generated:end -->
