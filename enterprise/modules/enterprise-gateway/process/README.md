# @langwatch/enterprise-gateway-process

The server half of [enterprise-gateway](../README.md). The Enterprise half of the AI Gateway: routing policies and personal gateway keys.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("enterprise-gateway").withRepositories(enterpriseGatewayRepositories).withApi(EnterpriseGatewayModule).withTransports(routingPolicyTrpcTransport, personalVirtualKeysTrpcTransport)`, `src/enterprise-gateway.module.ts:9`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EnterpriseGatewayApi`)

Routing policies and personal gateway keys: the Enterprise half of the AI Gateway.

Peers call these through the token, declared at `../contract/src/enterprise-gateway.api.ts:29`; nothing else in this package is public.

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

### `routingPolicy`

Contract `../contract/src/routing-policy.trpc.ts:26`, router `src/transport/routing-policy.trpc.ts:9`.

| Procedure                       | Kind     | Gate                                | Input                            | Output                                     |
| ------------------------------- | -------- | ----------------------------------- | -------------------------------- | ------------------------------------------ |
| `routingPolicy.list`            | query    | Permission `routingPolicies:view`   | `listRoutingPoliciesInputSchema` | inline                                     |
| `routingPolicy.get`             | query    | Permission `routingPolicies:view`   | `policyInOrganization`           | `routingPolicySchema`                      |
| `routingPolicy.tierSuggestions` | query    | Permission `routingPolicies:view`   | inline                           | inline                                     |
| `routingPolicy.create`          | mutation | Permission `routingPolicies:manage` | inline                           | `routingPolicySchema`                      |
| `routingPolicy.update`          | mutation | Permission `routingPolicies:manage` | inline                           | `routingPolicySchema`                      |
| `routingPolicy.setDefault`      | mutation | Permission `routingPolicies:manage` | `policyInOrganization`           | `routingPolicySchema`                      |
| `routingPolicy.delete`          | mutation | Permission `routingPolicies:manage` | `policyInOrganization`           | `enterpriseGatewayWriteAcknowledgedSchema` |

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
