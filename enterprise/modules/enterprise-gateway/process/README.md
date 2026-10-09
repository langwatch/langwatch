# @langwatch/enterprise-gateway-process

The server half of [enterprise-gateway](../README.md). The Enterprise half of the AI Gateway: routing policies and personal gateway keys.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("enterprise-gateway").withRepositories(enterpriseGatewayRepositories).withApi(EnterpriseGatewayModule).withTransports(routingPolicyTrpcTransport, personalVirtualKeysTrpcTransport)`, `src/enterprise-gateway.module.ts:13`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EnterpriseGatewayApi`)

Routing policies and personal gateway keys: the Enterprise half of the AI Gateway.

Peers call these through the token, declared at `../contract/src/enterprise-gateway.api.ts:30`; nothing else in this package is public.

#### `listRoutingPolicies`

Policies in an organization, optionally narrowed to one scope's choices.

```typescript
listRoutingPolicies(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]>;
```

#### `getRoutingPolicy`

```typescript
getRoutingPolicy(input: FindRoutingPolicyInput): Promise<RoutingPolicy>;
```

#### `findDefaultRoutingPolicies`

The default policies binding a personal workspace, most specific first (team, then organization).

```typescript
findDefaultRoutingPolicies(input: ResolveDefaultRoutingPolicyInput): Promise<RoutingPolicy[]>;
```

#### `countRoutingPolicies`

How many policies an organization holds (governance's setup checklist).

```typescript
countRoutingPolicies(input: { organizationId: string }): Promise<number>;
```

#### `getPersonalContext`

The caller's personal workspace, provisioned lazily, and the routing policy it inherits.

```typescript
getPersonalContext(input: { userId: string; organizationId: string }): Promise<PersonalContext>;
```

#### `routingPolicyTierSuggestions`

```typescript
routingPolicyTierSuggestions(input: Omit<SuggestTierTargetsInput, "limit">): TierTargetSuggestion[];
```

#### `createRoutingPolicy`

```typescript
createRoutingPolicy(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
```

#### `updateRoutingPolicy`

```typescript
updateRoutingPolicy(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
```

#### `setDefaultRoutingPolicy`

```typescript
setDefaultRoutingPolicy(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy>;
```

#### `deleteRoutingPolicy`

```typescript
deleteRoutingPolicy(input: DeleteRoutingPolicyInput): Promise<void>;
```

#### `listPersonalVirtualKeys`

The actor's own personal keys, or anyone's under `virtualKeys:viewOtherPersonal`.

```typescript
listPersonalVirtualKeys(input: { organizationId: string; targetUserId?: string; actorUserId: string; }): Promise<PersonalVirtualKey[]>;
```

#### `issuePersonalVirtualKey`

Mints one of the actor's own personal keys; the secret answers exactly once.

```typescript
issuePersonalVirtualKey(input: { organizationId: string; label: string; routingPolicyId?: string; actorUserId: string; /** A session's impersonator: no key is minted while one acts as a member. */ impersonatorId?: string | undefined; }): Promise<IssuedPersonalVirtualKeyAnswer>;
```

#### `revokePersonalVirtualKey`

```typescript
revokePersonalVirtualKey(input: { organizationId: string; id: string; actorUserId: string; }): Promise<void>;
```

#### `personalVirtualKeyList`

The CLI's reads and mints, unguarded: the governance CLI door admits the caller first.

```typescript
personalVirtualKeyList(input: ListPersonalVirtualKeysInput): Promise<PersonalVirtualKey[]>;
```

#### `personalVirtualKeyEnsureDefault`

```typescript
personalVirtualKeyEnsureDefault(input: EnsureDefaultPersonalVirtualKeyInput): Promise<IssuedPersonalVirtualKey>;
```

#### `personalVirtualKeyIssue`

```typescript
personalVirtualKeyIssue(input: IssuePersonalVirtualKeyInput): Promise<IssuedPersonalVirtualKey>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `personalVirtualKeys`

Contract `../contract/src/personal-virtual-keys.trpc.ts:14`, router `src/transport/personal-virtual-keys.trpc.ts:22`.

| Procedure                            | Kind     | Gate                                                                                            | Input  | Output                                     |
| ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------ |
| `personalVirtualKeys.list`           | query    | No permission: own keys only, unless virtualKeys:viewOtherPersonal is held at this organization | inline | inline                                     |
| `personalVirtualKeys.issuePersonal`  | mutation | Permission `organization:view`                                                                  | inline | `issuedPersonalVirtualKeyAnswerSchema`     |
| `personalVirtualKeys.revokePersonal` | mutation | Permission `organization:view`                                                                  | inline | `enterpriseGatewayWriteAcknowledgedSchema` |

```typescript
// personalVirtualKeys.list
// Input: inline, ../contract/src/personal-virtual-keys.trpc.ts:16
interface Input {
  organizationId: string;
  targetUserId?: string;
}
// Output: personalVirtualKeySchema.array() (inline, ../contract/src/personal-virtual-keys.trpc.ts:17)

// personalVirtualKeys.issuePersonal
// Input: inline, ../contract/src/personal-virtual-keys.trpc.ts:21
interface Input {
  organizationId: string;
  label: string;
  routingPolicyId?: string;
}
// Output: issuedPersonalVirtualKeyAnswerSchema, ../contract/src/personal-virtual-key.ts:46
interface Output {
  id: string;
  label: string;
  secret: string;
  baseUrl: string;
  displayPrefix: string;
  routingPolicyId: string | null;
}

// personalVirtualKeys.revokePersonal
// Input: inline, ../contract/src/personal-virtual-keys.trpc.ts:36
interface Input {
  organizationId: string;
  id: string;
}
// Output: enterpriseGatewayWriteAcknowledgedSchema, ../contract/src/enterprise-gateway.api.ts:78
interface Output {
  ok: boolean;
}
```

### `routingPolicy`

Contract `../contract/src/routing-policy.trpc.ts:27`, router `src/transport/routing-policy.trpc.ts:9`.

| Procedure                       | Kind     | Gate                                | Input                            | Output                                     |
| ------------------------------- | -------- | ----------------------------------- | -------------------------------- | ------------------------------------------ |
| `routingPolicy.list`            | query    | Permission `routingPolicies:view`   | `listRoutingPoliciesInputSchema` | inline                                     |
| `routingPolicy.get`             | query    | Permission `routingPolicies:view`   | `policyInOrganization`           | `routingPolicySchema`                      |
| `routingPolicy.tierSuggestions` | query    | Permission `routingPolicies:view`   | inline                           | inline                                     |
| `routingPolicy.personalContext` | query    | Permission `organization:view`      | inline                           | `personalContextSchema`                    |
| `routingPolicy.create`          | mutation | Permission `routingPolicies:manage` | inline                           | `routingPolicySchema`                      |
| `routingPolicy.update`          | mutation | Permission `routingPolicies:manage` | inline                           | `routingPolicySchema`                      |
| `routingPolicy.setDefault`      | mutation | Permission `routingPolicies:manage` | `policyInOrganization`           | `routingPolicySchema`                      |
| `routingPolicy.delete`          | mutation | Permission `routingPolicies:manage` | `policyInOrganization`           | `enterpriseGatewayWriteAcknowledgedSchema` |

```typescript
// routingPolicy.list
// Input: listRoutingPoliciesInputSchema, ../contract/src/routing-policy.ts:42
interface Input {
  organizationId: string;
  selectableForScope?: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  };
}
// Output: routingPolicySchema.array() (inline, ../contract/src/routing-policy.trpc.ts:30)

// routingPolicy.get
// Input: policyInOrganization, ../contract/src/routing-policy.trpc.ts:15
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof routingPolicySchema>; // ../contract/src/routing-policy.ts:22

// routingPolicy.tierSuggestions
// Input: inline, ../contract/src/routing-policy.trpc.ts:38
interface Input {
  organizationId: string;
  tier: "complex" | "reasoning" | "fast";
  boundProviderTypes?: string[];
}
// Output: inline, ../contract/src/routing-policy.trpc.ts:44
type Output = {
  modelId: string;
  name: string;
  provider: string;
  recommended?: boolean;
}[];

// routingPolicy.personalContext
// Input: inline, ../contract/src/routing-policy.trpc.ts:47
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof personalContextSchema>; // ../contract/src/routing-policy.ts:175

// routingPolicy.create
// Input: z.object({ organizationId: z.string(), scopes: z .array(routingPolicyScopeEntrySchema) .m… (inline, ../contract/src/routing-policy.trpc.ts:52)
type Output = z.infer<typeof routingPolicySchema>; // ../contract/src/routing-policy.ts:22

// routingPolicy.update
// Input: inline, ../contract/src/routing-policy.trpc.ts:67
interface Input {
  organizationId: string;
  id: string;
  name?: string;
  modelProviderIds?: string[];
  description?: string | null;
  modelAliases?: Record<string, string>;
  defaultModel?: string | null;
  policyRules?: Record<string, unknown>;
}
type Output = z.infer<typeof routingPolicySchema>; // ../contract/src/routing-policy.ts:22

// routingPolicy.setDefault
type Input = z.infer<typeof policyInOrganization>; // ../contract/src/routing-policy.trpc.ts:15
type Output = z.infer<typeof routingPolicySchema>; // ../contract/src/routing-policy.ts:22

// routingPolicy.delete
type Input = z.infer<typeof policyInOrganization>; // ../contract/src/routing-policy.trpc.ts:15
type Output = z.infer<typeof enterpriseGatewayWriteAcknowledgedSchema>; // ../contract/src/enterprise-gateway.api.ts:78
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: enterprise-gateway declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf               | Environment variable    | Declared at                                       |
| ------ | ------------------ | ----------------------- | ------------------------------------------------- |
| config | `gatewayPublicUrl` | `LW_GATEWAY_PUBLIC_URL` | `../contract/src/enterprise-gateway.config.ts:13` |
| config | `gatewayLegacyUrl` | `LW_GATEWAY_BASE_URL`   | `../contract/src/enterprise-gateway.config.ts:14` |
| config | `isSaas`           | `IS_SAAS`               | `../contract/src/enterprise-gateway.config.ts:16` |

<!-- readme:generated:end -->
