# @langwatch/gateway-process

The server half of [gateway](../README.md). The AI Gateway: virtual keys, gateway debits and the gateway's internal door, plus the agent cache and voice provider credentials it serves.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("gateway").withRepositories(gatewayRepositories).withChannels(gatewayChannels).withApi(GatewayModule).withTransports(agentCacheRest, elevenLabsWebhookRest, gatewayInternalRest, gatewayBudgetTrpcTransport, gatewayCacheRuleTrpcTransport, gatewayGuardrailTrpcTransport, gatewayPlatformRest, gatewaySpendRest, gatewaySpendEventTrpcTransport, gatewayUsageTrpcTransport, virtualKeyTrpcTransport).withEventing(gatewayGovernanceEventsEventing).withEventing(gatewaySpendEventing).withEventing(gatewayRealtimeSessionEventing).withEventing(gatewayPulledUsageLedgerEventing).withEventing(gatewayInstantEvalJudgeSpendEventing).withEventing(gatewayConnectManagedKeyEventing).withTasks(…).withTransportFacts(…)`, `src/gateway.module.ts:52`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`GatewayApi`)

Peers call these through the token, declared at `../contract/src/gateway.api.ts:570`; nothing else in this package is public.
It extends `GatewayInternalProtocol`.

#### `internalDoor`

The door that verifies the Go data plane's signed calls. A peer family the data plane also calls (the hosted Connect routes) binds it, not a copy.

```typescript
internalDoor(): RestIdentity;
```

#### `getAgentCacheEntry`

```typescript
getAgentCacheEntry(input: { projectId: string; name: string; }): Promise<{ name: string; value: string }>;
```

#### `putAgentCacheEntry`

```typescript
putAgentCacheEntry(input: GatewayAgentCacheWriteInput): Promise<{ name: string; ttl_seconds: number }>;
```

#### `claimAgentCacheEntry`

```typescript
claimAgentCacheEntry(input: GatewayAgentCacheWriteInput): Promise<{ name: string; claimed: boolean; ttl_seconds: number }>;
```

#### `deleteAgentCacheEntry`

```typescript
deleteAgentCacheEntry(input: { projectId: string; name: string }): Promise<void>;
```

#### `receiveElevenLabsWebhook`

```typescript
receiveElevenLabsWebhook(input: { modelProviderId: string; rawBody: string; signature: string | undefined; }): Promise<GatewayElevenLabsWebhookAnswer>;
```

#### `getElevenLabsApiCredential`

Throws `voice_key_missing` when the row is not ElevenLabs or holds no key.

```typescript
getElevenLabsApiCredential(input: { modelProviderId: string; }): Promise<GatewayElevenLabsApiCredential>;
```

#### `getTwilioCredential`

Main's `getTwilioCredential`; throws `voice_key_missing` for a non-Twilio or keyless row.

```typescript
getTwilioCredential(input: { modelProviderId: string }): Promise<GatewayTwilioCredential>;
```

#### `assertOrganizationExists`

Refuses an organization id that names no organization.

```typescript
assertOrganizationExists(organizationId: string): Promise<void>;
```

#### `findProjectOrganization`

The organization a project belongs to, or null when the project is unknown.

```typescript
findProjectOrganization(projectId: string): Promise<string | null>;
```

#### `organizationIdForProject`

The organization behind the project a REST credential authenticated as.

```typescript
organizationIdForProject(projectId: string): Promise<string>;
```

#### `actorForCredential`

Identity a REST credential authorizes as, plus a stable audit-row actor id.

```typescript
actorForCredential(input: { projectId: string; credential: GatewayRequestCredential }): { actor: GatewayCaller; actorUserId: string; };
```

#### `getKeyCaller`

Any API key the key door admitted, as the organization it acts in and who a write is recorded as. The door asked the route's permission; this asks none.

```typescript
getKeyCaller(input: { caller: GatewayKeyCaller }): Promise<GatewayAuthorizedKeyCaller>;
```

#### `authorizeOrganizationWideOperation`

Tenant-wide write by project credential, checked at the organization.

```typescript
authorizeOrganizationWideOperation(input: { actor: GatewayCaller; organizationId: string; permission: string; }): Promise<void>;
```

#### `listBudgetsWithHealth`

```typescript
listBudgetsWithHealth(organizationId: string): Promise<GatewayBudgetListWithHealth>;
```

#### `listProjectBudgetsWithHealth`

```typescript
listProjectBudgetsWithHealth(projectId: string): Promise<GatewayBudgetListWithHealth>;
```

#### `listBudgetScopeTargets`

```typescript
listBudgetScopeTargets(budgets: { scopeType: string; scopeId: string }[], organizationId: string | null): Promise<Map<string, GatewayBudgetScopeTarget>>;
```

#### `findBudgetDetail`

```typescript
findBudgetDetail(input: { id: string; organizationId: string; }): Promise<GatewayBudgetDetail | null>;
```

#### `getBudgetDetail`

The budget's detail; throws the handled 404 when this organization holds none by that id.

```typescript
getBudgetDetail(input: { id: string; organizationId: string }): Promise<GatewayBudgetDetail>;
```

#### `createBudget`

```typescript
createBudget(input: CreateGatewayBudgetInput): Promise<GatewayBudgetResource>;
```

#### `updateBudget`

```typescript
updateBudget(input: UpdateGatewayBudgetInput): Promise<GatewayBudgetResource>;
```

#### `archiveBudget`

```typescript
archiveBudget(input: ArchiveGatewayBudgetInput): Promise<GatewayBudgetResource>;
```

#### `resetBudget`

```typescript
resetBudget(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource>;
```

#### `listBudgetPageWithHealth`

A cursor page of an organization's budgets, with live health, for the credentialed listing.

```typescript
listBudgetPageWithHealth(input: { organizationId: string; limit: number; cursor: { createdAt: Instant; id: string } | null; scopeTypes?: readonly string[] | undefined; externalId?: string | undefined; }): Promise<GatewayBudgetPageWithHealth>;
```

#### `getBudgetWithHealth`

One budget with live health; throws `budget_not_found` outside this organization.

```typescript
getBudgetWithHealth(input: { id: string; organizationId: string }): Promise<GatewayBudgetHealth>;
```

#### `budgetScopeReach`

Whether any active key could produce traffic against this budget's own scope target.

```typescript
budgetScopeReach(input: { organizationId: string; scope: { scopeType: string; scopeId: string }; }): Promise<GatewayBudgetScopeReachResult>;
```

#### `resolveProviderLabels`

Provider row id to its display label, for a whole page in one read.

```typescript
resolveProviderLabels(budgets: readonly { providerKey: string | null }[]): Promise<Map<string, string>>;
```

#### `listGroupTargets`

```typescript
listGroupTargets(organizationId: string): Promise<readonly GatewayGroupTarget[]>;
```

#### `groupMemberCounts`

Member count per-GROUP allowance covers, batched over a page.

```typescript
groupMemberCounts(budgets: readonly { scopeType: string; scopeId: string }[]): Promise<Map<string, number>>;
```

#### `resolveApplicableBudgets`

The budgets one debit lands on, as the spend graph resolves them.

```typescript
resolveApplicableBudgets(input: GatewayBudgetResolutionTarget): Promise<GatewayResolvedBudget[]>;
```

#### `checkBudget`

Main's `GatewayBudgetService.check` (budget.service.ts:1241), read by the CLI.

```typescript
checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult>;
```

#### `insertSpendDebit`

Main's ClickHouse budget `insertDebit` (budget.clickhouse.repository.ts:615).

```typescript
insertSpendDebit(rows: readonly GatewayBudgetDebitRow[]): Promise<void>;
```

#### `appendBudgetChange`

Main's ingest `BUDGET_UPDATED` append (ingestionRoutes.ts:825).

```typescript
appendBudgetChange(input: GatewayBudgetChangeInput): Promise<void>;
```

#### `listCacheRules`

```typescript
listCacheRules(organizationId: string): Promise<GatewayCacheRuleResource[]>;
```

#### `listCacheRulePage`

Cursor page of org cache rules, priority-ordered.

```typescript
listCacheRulePage(input: { organizationId: string; limit: number; cursor: GatewayCacheRuleCursor | null; }): Promise<GatewayCacheRuleResource[]>;
```

#### `findCacheRule`

```typescript
findCacheRule(input: { id: string; organizationId: string; }): Promise<GatewayCacheRuleResource | null>;
```

#### `getCacheRule`

The organization's cache rule; throws the handled 404 when it holds none by that id.

```typescript
getCacheRule(input: { id: string; organizationId: string }): Promise<GatewayCacheRuleResource>;
```

#### `createCacheRule`

```typescript
createCacheRule(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
```

#### `updateCacheRule`

```typescript
updateCacheRule(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
```

#### `archiveCacheRule`

```typescript
archiveCacheRule(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
```

#### `listGuardrails`

```typescript
listGuardrails(projectId: string): Promise<GatewayGuardrailResource[]>;
```

#### `findGuardrail`

```typescript
findGuardrail(input: { id: string; projectId: string }): Promise<GatewayGuardrailResource | null>;
```

#### `createGuardrail`

```typescript
createGuardrail(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
```

#### `updateGuardrail`

```typescript
updateGuardrail(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
```

#### `archiveGuardrail`

```typescript
archiveGuardrail(input: ArchiveGatewayGuardrailInput): Promise<void>;
```

#### `listVisibleVirtualKeys`

Organization keys narrowed to what this person can see. Visibility is membership-based, not permission-based, so a non-member gets an empty list rather than a refusal.

```typescript
listVisibleVirtualKeys(input: { organizationId: string; userId: string; }): Promise<GatewayVirtualKeyRecord[]>;
```

#### `isVirtualKeyVisible`

Whether one already-loaded key is visible to this person.

```typescript
isVirtualKeyVisible(input: { organizationId: string; userId: string; virtualKey: GatewayVirtualKeyRecord; }): Promise<boolean>;
```

#### `getVisibleVirtualKeyForUser`

One key for a by-id read under that same rule: a key outside the caller's membership set is answered as not found, so nothing leaks its existence.

```typescript
getVisibleVirtualKeyForUser(input: { organizationId: string; id: string; userId: string; }): Promise<GatewayVirtualKeyRecord>;
```

#### `findPersonalVirtualKeys`

Live keys held by a person (any person when unnamed), newest first: main's personal-key reads.

```typescript
findPersonalVirtualKeys(input: { organizationId?: string; principalUserId?: string; }): Promise<GatewayVirtualKeyRecord[]>;
```

#### `findVirtualKeyById`

```typescript
findVirtualKeyById(id: string, organizationId: string): Promise<GatewayVirtualKeyRecord | null>;
```

#### `getExistingVirtualKey`

One key anchored to this organization, without any visibility rule.

```typescript
getExistingVirtualKey(input: { organizationId: string; id: string; }): Promise<GatewayVirtualKeyRecord>;
```

#### `getVirtualKeyCaller`

Who a virtual key route was called by, with the one project the credential acts in or none. The door asked the route's permission; each key's own scopes are asked where it is read.

```typescript
getVirtualKeyCaller(input: { caller: GatewayVirtualKeyCaller; }): Promise<GatewayAuthorizedVirtualKeyCaller>;
```

#### `visibleToVirtualKeyCaller`

A page narrowed to what the caller reads: for one project, org-scoped keys, its team's and its own; for a key naming no project, the keys it holds `virtualKeys:view` on. Applied to the page, not the query, so a page can be shorter than `limit` without the walk done.

```typescript
visibleToVirtualKeyCaller(input: { caller: GatewayAuthorizedVirtualKeyCaller; virtualKeys: readonly GatewayVirtualKeyRecord[]; }): Promise<GatewayVirtualKeyRecord[]>;
```

#### `getVirtualKeyForCaller`

One key under that same rule, or the not-found refusal.

```typescript
getVirtualKeyForCaller(input: { caller: GatewayAuthorizedVirtualKeyCaller; id: string; permission: string; }): Promise<GatewayVirtualKeyRecord>;
```

#### `getVirtualKeyPage`

A page of an organization's keys, newest first, for the credentialed listing.

```typescript
getVirtualKeyPage(input: { organizationId: string; limit: number; cursor: { createdAt: Instant; id: string } | null; externalId?: string | undefined; }): Promise<GatewayVirtualKeyRecord[]>;
```

#### `toVirtualKeyCamelDtos`

The camelCase projection, for a page of keys in ONE destination read.

```typescript
toVirtualKeyCamelDtos(input: { virtualKeys: readonly GatewayVirtualKeyRecord[]; }): Promise<VirtualKeyCamelDtoResponse[]>;
```

#### `toVirtualKeyCamelDto`

```typescript
toVirtualKeyCamelDto(virtualKey: GatewayVirtualKeyRecord): Promise<VirtualKeyCamelDtoResponse>;
```

#### `toVirtualKeySnakeDtos`

The published snake_case projection, batched the same way.

```typescript
toVirtualKeySnakeDtos(input: { virtualKeys: readonly GatewayVirtualKeyRecord[]; }): Promise<GatewayVirtualKeySnakeDto[]>;
```

#### `toVirtualKeySnakeDto`

```typescript
toVirtualKeySnakeDto(virtualKey: GatewayVirtualKeyRecord): Promise<GatewayVirtualKeySnakeDto>;
```

#### `parseVirtualKeyBudget`

Parses a REST budget-write field against the same schema the tRPC door validates with.

```typescript
parseVirtualKeyBudget(input: unknown): | { success: true; data: VirtualKeyBudgetInput } | { success: false; error: { message: string } };
```

#### `createVirtualKey`

```typescript
createVirtualKey(input: GatewayVirtualKeyCreateCommand): Promise<GatewayMintedVirtualKey>;
```

#### `updateVirtualKey`

```typescript
updateVirtualKey(input: GatewayVirtualKeyUpdateCommand): Promise<GatewayVirtualKeyRecord>;
```

#### `rotateVirtualKey`

```typescript
rotateVirtualKey(input: GatewayVirtualKeyCommand): Promise<GatewayMintedVirtualKey>;
```

#### `revokeVirtualKey`

```typescript
revokeVirtualKey(input: GatewayVirtualKeyCommand): Promise<GatewayVirtualKeyRecord>;
```

#### `revokeManagedInternal`

Ends a managed key for the feature that owns it; customer-facing revocation refuses one. A key already gone is left alone, so this is safe to repeat, which is what makes revoking a license retryable.

```typescript
revokeManagedInternal(input: { virtualKeyId: string; organizationId: string; actorId: string; }): Promise<void>;
```

#### `invalidateManagedInternal`

Tells every gateway to resolve a managed key again, unchanged, through the change feed each already polls — for cached state outside the key row, such as the install a license is bound to.

```typescript
invalidateManagedInternal(input: { virtualKeyId: string; organizationId: string }): Promise<void>;
```

#### `setManagedKeyConnectServicesInternal`

The platform services a CONNECT key may serve, replaced whole; empty serves none. Only the feature holding the license gate writes it, never a transport.

```typescript
setManagedKeyConnectServicesInternal(input: { virtualKeyId: string; organizationId: string; services: readonly string[]; }): Promise<void>;
```

#### `setManagedKeyLicenseInternal`

The license a CONNECT key serves: the registry hash of its token, the bound install and its end. Written by licensing at activation and on every sync.

```typescript
setManagedKeyLicenseInternal(input: { virtualKeyId: string; organizationId: string; tokenHash: string; instanceId: string | null; expiresAt: Instant | null; }): Promise<void>;
```

#### `setConnectUpstreamInternal`

Where one organization's gateway reaches LangWatch-hosted models, replaced whole. Only licensing writes it, and it clears it on every change of license, service or Connect.

```typescript
setConnectUpstreamInternal(input: GatewayConnectUpstream): Promise<void>;
```

#### `clearConnectUpstreamInternal`

Drops the organization's hosted provider slot. Safe to repeat.

```typescript
clearConnectUpstreamInternal(input: { organizationId: string }): Promise<void>;
```

#### `disableVirtualKey`

```typescript
disableVirtualKey(input: GatewayVirtualKeyDisableCommand): Promise<GatewayVirtualKeyRecord>;
```

#### `enableVirtualKey`

```typescript
enableVirtualKey(input: GatewayVirtualKeyCommand): Promise<GatewayVirtualKeyRecord>;
```

#### `authorizeVirtualKeyScopeSelection`

Manage on every draft scope and on the trace destination, before any read.

```typescript
authorizeVirtualKeyScopeSelection(input: { actor: GatewayCaller; organizationId: string; scopes: readonly GatewayVirtualKeyScope[]; traceProjectId?: string | null; }): Promise<void>;
```

#### `authorizeVirtualKeyCreate`

The whole create pre-flight, including the guardrail references. A project credential names its project: a key for exactly that project needs create, not manage.

```typescript
authorizeVirtualKeyCreate(input: { actor: GatewayCaller; /** A session's impersonator: no key is minted while one acts as a member. */ impersonatorId?: string | undefined; organizationId: string; scopes: readonly GatewayVirtualKeyScope[]; traceProjectId?: string | null; guardrailAttachments?: unknown; callerProjectId?: string; }): Promise<void>;
```

#### `authorizeVirtualKeyUpdate`

The update pre-flight: standing on the key, plus manage on any new scope. Answers the stored key it judged, so a caller that needs it does not read the row a second time.

```typescript
authorizeVirtualKeyUpdate(input: { actor: GatewayCaller; organizationId: string; id: string; scopes?: readonly GatewayVirtualKeyScope[]; traceProjectId?: string | null; guardrailAttachments?: unknown; }): Promise<GatewayVirtualKeyRecord>;
```

#### `authorizeVirtualKeyOperation`

One permission on one of the key's existing scopes, over the same read.

```typescript
authorizeVirtualKeyOperation(input: { actor: GatewayCaller; /** A session's impersonator: a rotation is refused while one acts as a member. */ impersonatorId?: string | undefined; organizationId: string; id: string; permission: string; }): Promise<GatewayVirtualKeyRecord>;
```

#### `isSpendSourceAvailable`

Whether this deployment has the spend source a key's cost is read from.

```typescript
isSpendSourceAvailable(): boolean;
```

#### `getDeploymentAddresses`

Where the gateway runs for this deployment, as configured; undefined where nothing says.

```typescript
getDeploymentAddresses(): GatewayDeploymentAddresses;
```

#### `usageSummary`

```typescript
usageSummary(input: { organizationId: string; virtualKeyIds: string[]; window: GatewayUsageWindow; }): Promise<GatewayUsageSummary>;
```

#### `usageSummaryForVirtualKey`

```typescript
usageSummaryForVirtualKey(input: { organizationId: string; virtualKeyId: string; window: GatewayUsageWindow; model?: string; }): Promise<GatewayVirtualKeyUsageSummary>;
```

#### `budgetOverviewForUser`

Every budget binding this member's own keys in this organization, with spend and scope phrasing.

```typescript
budgetOverviewForUser(input: { organizationId: string; userId: string; /** Adds up to three top models to each personal budget. */ includeTopModels?: boolean; }): Promise<GatewayBudgetOverviewForUser>;
```

#### `getPersonalBudget`

The /me budget banner: the gateway's own check at a projected cost of zero on the caller's personal key, so the banner and the command line's pre-check agree.

```typescript
getPersonalBudget(input: { userId: string; organizationId: string; }): Promise<GatewayPersonalBudget>;
```

#### `spendByVirtualKey`

```typescript
spendByVirtualKey(input: { organizationId: string; virtualKeyIds: readonly string[]; window: GatewayUsageWindow; }): Promise<Map<string, { spentUsd: string; requests: number }>>;
```

#### `getVirtualKeySpend`

One key's spend over the window, zero when it spent none; refused without a spend source.

```typescript
getVirtualKeySpend(input: { organizationId: string; virtualKeyId: string; window: GatewayUsageWindow; }): Promise<{ spentUsd: string; requests: number }>;
```

#### `loadDirectBudgetsForKeys`

The budget each named key carries of its own, with this period's spend.

```typescript
loadDirectBudgetsForKeys(input: { organizationId: string; virtualKeyIds: readonly string[]; now: Instant; }): Promise<Map<string, GatewayVirtualKeyDirectBudget>>;
```

#### `listApplicableBudgets`

Every budget that would constrain a draft or an existing key.

```typescript
listApplicableBudgets(input: { target: GatewayApplicableBudgetTarget; }): Promise<GatewayApplicableBudget[]>;
```

#### `isOrganizationMember`

Whether a person belongs to this organization.

```typescript
isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean>;
```

#### `listApplicableBudgetsForSelection`

The budgets an existing key (as stored, if the caller sees it) or a draft (if the caller may manage every scope in it) would run under; a draft's principal must be an organization member.

```typescript
listApplicableBudgetsForSelection(input: { selection: VirtualKeyApiApplicableBudgetsInput; userId: string; caller: GatewayCaller; }): Promise<GatewayApplicableBudget[]>;
```

#### `listVirtualKeySpendThisMonth`

This month's spend and direct budget for every key the person sees; refused where the deployment has no spend source, rather than a $0.00 indistinguishable from no spend.

```typescript
listVirtualKeySpendThisMonth(input: { organizationId: string; userId: string; }): Promise<VirtualKeySpendThisMonth>;
```

#### `recordPricedSpend`

Appends one confirmed outcome the caller priced itself. The spine takes the price as given: a judgement's model is not in the registry, so the drain path's re-rating would answer zero for it.

```typescript
recordPricedSpend(input: GatewayPricedSpend): Promise<GatewayPricedSpendResult>;
```

#### `sumSpendNanoUsdByRequestType`

What one request type has cost these tenants, in integer nano-USD, over the whole ledger or the window given. Confirmed rows only, and 0 where this deployment has no spend source: an absent ledger was never written to.

```typescript
sumSpendNanoUsdByRequestType(input: GatewaySpendByRequestTypeQuery): Promise<number>;
```

#### `listConfirmedSpendByRequestType`

The confirmed rows `sumSpendNanoUsdByRequestType` sums, one page at a time, for a copy that needs each request (ADR-174 decision 17). An empty page where there is no spend source.

```typescript
listConfirmedSpendByRequestType(input: GatewayConfirmedSpendQuery): Promise<GatewayConfirmedSpendPage>;
```

#### `listSpendEventsPage`

One page of the spend-event ledger for a project, newest first, with virtual-key names resolved. With no ClickHouse spend source the page is empty and `clickHouseDisabled`, so a door renders disabled rather than zero.

```typescript
listSpendEventsPage(input: GatewaySpendEventsPageQuery): Promise<GatewaySpendEventPage>;
```

#### `listSpendEventsAcrossTenants`

Spend events across these tenants in these statuses, newest first by occurrence then request id; an empty page where this deployment has no spend source.

```typescript
listSpendEventsAcrossTenants(input: GatewaySpendEventsAcrossTenantsQuery): Promise<GatewaySpendEventsAcrossTenantsPage>;
```

#### `findSpendEventAcrossTenants`

One request's spend row across these tenants, null when none holds it.

```typescript
findSpendEventAcrossTenants(input: GatewaySpendEventAcrossTenantsQuery): Promise<SpendEventRow | null>;
```

#### `findSpendDaysForOrganizationProjects`

The metered lane per UTC day across these tenants' ledgers, inclusive days, oldest first; none for no tenants or no ledger. Main's governance `sumDaysForOrganizationProjects`, served by the ledger's owner.

```typescript
findSpendDaysForOrganizationProjects(input: { tenantIds: readonly string[]; fromDay: string; toDay: string; }): Promise<GatewaySpendDay[]>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<GatewayUsageCount>;
```

#### `getPrincipalSpendSummary`

One user's principal-scope ledger totals and most-used model (main's personal usage).

```typescript
getPrincipalSpendSummary(input: { projectId: string; userId: string; window: GatewayPrincipalSpendWindow; }): Promise<GatewayPrincipalSpendSummary>;
```

#### `findPrincipalDailySpend`

One user's principal-scope ledger spend per UTC day, oldest first.

```typescript
findPrincipalDailySpend(input: { projectId: string; userId: string; window: GatewayPrincipalSpendWindow; }): Promise<GatewayPrincipalDailySpend[]>;
```

#### `findPrincipalModelSpend`

One user's principal-scope ledger spend per model, most spent first.

```typescript
findPrincipalModelSpend(input: { projectId: string; userId: string; window: GatewayPrincipalSpendWindow; }): Promise<GatewayPrincipalModelSpend[]>;
```

## REST transport

### `agentCacheRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/agent-cache.rest.ts:17` |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `GET /api/agent-cache/:name` · `getApiAgentCacheByName`

Read an agent cache entry

Permission `agentCache:manage`. Declared at `src/transport/agent-cache.rest.ts:21`.

Answers at `/api/agent-cache/:name`, `/api/v1/agent-cache/:name`.

```typescript
// Params: gatewayAgentCacheNameParamsSchema, ../contract/src/gateway-agent-cache.schemas.ts:22
interface Params {
  name: string;
}
// Response: gatewayAgentCacheEntrySchema, ../contract/src/gateway-agent-cache.schemas.ts:49
interface Response {
  name: string;
  value: string;
}
```

#### `PUT /api/agent-cache/:name` · `putApiAgentCacheByName`

Store an agent cache entry

Permission `agentCache:manage`. Declared at `src/transport/agent-cache.rest.ts:34`.

Answers at `/api/agent-cache/:name`, `/api/v1/agent-cache/:name`.

```typescript
type Params = z.infer<typeof gatewayAgentCacheNameParamsSchema>; // ../contract/src/gateway-agent-cache.schemas.ts:22
// Body: gatewayAgentCacheWriteSchema, ../contract/src/gateway-agent-cache.schemas.ts:33
interface Body {
  value: string;
  ttl_seconds?: number;
}
// Response: gatewayAgentCacheWrittenSchema, ../contract/src/gateway-agent-cache.schemas.ts:50
interface Response {
  name: string;
  ttl_seconds: number;
}
```

#### `POST /api/agent-cache/:name/claim` · `postApiAgentCacheByNameClaim`

Claim an agent cache entry

Permission `agentCache:manage`. Declared at `src/transport/agent-cache.rest.ts:52`.

Answers at `/api/agent-cache/:name/claim`, `/api/v1/agent-cache/:name/claim`.

```typescript
type Params = z.infer<typeof gatewayAgentCacheNameParamsSchema>; // ../contract/src/gateway-agent-cache.schemas.ts:22
type Body = z.infer<typeof gatewayAgentCacheWriteSchema>; // ../contract/src/gateway-agent-cache.schemas.ts:33
// Response: gatewayAgentCacheClaimedSchema, ../contract/src/gateway-agent-cache.schemas.ts:54
interface Response {
  name: string;
  ttl_seconds: number;
  claimed: boolean;
}
```

#### `DELETE /api/agent-cache/:name` · `deleteApiAgentCacheByName`

Delete an agent cache entry

Permission `agentCache:manage`. Declared at `src/transport/agent-cache.rest.ts:71`.

Answers at `/api/agent-cache/:name`, `/api/v1/agent-cache/:name`.

```typescript
type Params = z.infer<typeof gatewayAgentCacheNameParamsSchema>; // ../contract/src/gateway-agent-cache.schemas.ts:22
// Response: gatewayAgentCacheDeletedSchema, ../contract/src/gateway-agent-cache.schemas.ts:58
interface Response {
  name: string;
  deleted: boolean;
}
```

### `elevenLabsWebhookRest`

|             |                                               |
| ----------- | --------------------------------------------- |
| Declared at | `src/transport/elevenlabs-webhook.rest.ts:23` |
| Base URL    | none: each route's path is its address        |
| Addressing  | literal                                       |
| Credential  | project                                       |

#### `POST /api/elevenlabs/webhook/:modelProviderId` · `receiveElevenLabsWebhook`

Public: ElevenLabs delivers this callback publicly; the application verifies the raw bytes against the provider row's stored HMAC secret. Declared at `src/transport/elevenlabs-webhook.rest.ts:27`.

Answers at `/api/elevenlabs/webhook/:modelProviderId`.

```typescript
// Params: gatewayElevenLabsWebhookParamsSchema, ../contract/src/gateway-elevenlabs-webhook.schemas.ts:3
interface Params {
  modelProviderId: string;
}
// Rawbody: "text" (inline, src/transport/elevenlabs-webhook.rest.ts:29)
// Response: inline, src/transport/elevenlabs-webhook.rest.ts:32
type Response = unknown;
```

### `gatewayInternalRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/gateway-internal.rest.ts:114` |
| Base URL    | none: each route's path is its address       |
| Addressing  | literal                                      |
| Credential  | internal_secret                              |

#### `GET /api/internal/gateway/health` · `gatewayInternalHealth`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:122`.

Answers at `/api/internal/gateway/health`.

#### `POST /api/internal/gateway/resolve-key` · `gatewayInternalResolveKey`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:129`.

Answers at `/api/internal/gateway/resolve-key`.

```typescript
// Rawbody: "text" (inline, src/transport/gateway-internal.rest.ts:130)
type Headers = z.infer<typeof gatewayInternalHeadersSchema>; // ../contract/src/gateway-internal.schemas.ts:267
```

#### `POST /api/internal/gateway/codex/refresh` · `gatewayInternalCodexRefresh`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:140`.

Answers at `/api/internal/gateway/codex/refresh`.

```typescript
// Rawbody: "text" (inline, src/transport/gateway-internal.rest.ts:141)
```

#### `GET /api/internal/gateway/config/:vk_id` · `gatewayInternalConfig`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:148`.

Answers at `/api/internal/gateway/config/:vk_id`.

```typescript
// Params: gatewayInternalConfigParamsSchema, ../contract/src/gateway-internal.schemas.ts:25
interface Params {
  vk_id: string;
}
type Headers = z.infer<typeof gatewayInternalHeadersSchema>; // ../contract/src/gateway-internal.schemas.ts:267
```

#### `GET /api/internal/gateway/changes` · `gatewayInternalChanges`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:158`.

Answers at `/api/internal/gateway/changes`.

```typescript
// Query: gatewayInternalChangesQuerySchema, ../contract/src/gateway-internal.schemas.ts:271
interface Query {
  organization_id?: string;
  since?: string;
  timeout_s?: string;
}
```

#### `POST /api/internal/gateway/guardrail/check` · `gatewayInternalGuardrailCheck`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:165`.

Answers at `/api/internal/gateway/guardrail/check`.

```typescript
// Rawbody: "text" (inline, src/transport/gateway-internal.rest.ts:166)
```

#### `GET /api/internal/gateway/budget-bucket-spend` · `gatewayInternalBudgetBucketSpend`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:173`.

Answers at `/api/internal/gateway/budget-bucket-spend`.

```typescript
// Query: gatewayInternalBucketQuerySchema, ../contract/src/gateway-internal.schemas.ts:276
interface Query {
  budget_id?: string;
  end_user_id?: string;
}
```

#### `POST /api/internal/gateway/spend-commands` · `gatewayInternalSpendCommands`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:180`.

Answers at `/api/internal/gateway/spend-commands`.

```typescript
// Rawbody: "text" (inline, src/transport/gateway-internal.rest.ts:181)
```

#### `POST /api/internal/gateway/realtime-sessions` · `gatewayInternalReserveRealtimeSession`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:189`.

Answers at `/api/internal/gateway/realtime-sessions`.

```typescript
// Rawbody: "text" (inline, src/transport/gateway-internal.rest.ts:190)
```

#### `PATCH /api/internal/gateway/realtime-sessions/:session_id` · `gatewayInternalPatchRealtimeSession`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:197`.

Answers at `/api/internal/gateway/realtime-sessions/:session_id`.

```typescript
// Params: gatewayInternalSessionParamsSchema, ../contract/src/gateway-internal.schemas.ts:147
interface Params {
  session_id: string;
}
// Rawbody: "text" (inline, src/transport/gateway-internal.rest.ts:202)
```

#### `POST /api/internal/gateway/realtime-sessions/:session_id/usage` · `gatewayInternalReportRealtimeSessionUsage`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:211`.

Answers at `/api/internal/gateway/realtime-sessions/:session_id/usage`.

```typescript
type Params = z.infer<typeof gatewayInternalSessionParamsSchema>; // ../contract/src/gateway-internal.schemas.ts:147
// Rawbody: "text" (inline, src/transport/gateway-internal.rest.ts:216)
```

#### `GET /api/internal/gateway/bootstrap` · `gatewayInternalBootstrap`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/gateway-internal.rest.ts:229`.

Answers at `/api/internal/gateway/bootstrap`.

### `gatewayPlatformRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/gateway-platform.rest.ts:242` |
| Base URL    | `/api/gateway/v1`                            |
| Addressing  | v1-in-path                                   |
| Credential  | project                                      |

#### `GET /virtual-keys` · `getApiGatewayV1VirtualKeys`

List virtual keys

Permission `virtualKeys:view`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:251`.

Answers at `/api/gateway/v1/virtual-keys`.

```typescript
// Query: gatewayVirtualKeyListQuerySchema, ../contract/src/gateway-platform.schemas.ts:180
interface Query {
  cursor?: string;
  limit?: number;
  external_id?: string;
}
// Response: z.object({ data: z.array(gatewayVirtualKeyDtoSchema), next_cursor: gatewayNextCursorSchem… (inline, src/transport/gateway-platform.rest.ts:256)
```

#### `POST /virtual-keys` · `postApiGatewayV1VirtualKeys`

Create virtual key

Permission `virtualKeys:create`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:283`.

Answers at `/api/gateway/v1/virtual-keys`.

```typescript
type Body = z.infer<typeof gatewayCreateVirtualKeySchema>; // ../contract/src/gateway-platform.schemas.ts:231
// Response: z.object({ virtual_key: gatewayVirtualKeyDtoSchema, secret: z.string().optional().describ… (inline, src/transport/gateway-platform.rest.ts:289)
```

#### `GET /virtual-keys/:id` · `getApiGatewayV1VirtualKeysById`

Get virtual key

Permission `virtualKeys:view`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:348`.

Answers at `/api/gateway/v1/virtual-keys/:id`.

```typescript
// Params: gatewayIdParamsSchema, ../contract/src/gateway-platform.schemas.ts:326
interface Params {
  id: string;
}
// Response: z.object({ virtual_key: gatewayVirtualKeyDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:352)
```

#### `GET /virtual-keys/:id/spend` · `getApiGatewayV1VirtualKeysByIdSpend`

Read a virtual key's spend

Permission `gatewayUsage:view`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:365`.

Answers at `/api/gateway/v1/virtual-keys/:id/spend`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Query: gatewayVkSpendWindowSchema, ../contract/src/gateway-platform.schemas.ts:200
interface Query {
  from?: number;
  to?: number;
}
// Response: gatewaySpendSummaryDtoSchema, ../contract/src/gateway-platform.schemas.ts:116
interface Response {
  virtual_key_id: string;
  spent_usd: string;
  requests: number;
  window: {
    from: number;
    to: number;
  };
}
```

#### `PATCH /virtual-keys/:id` · `patchApiGatewayV1VirtualKeysById`

Update virtual key

Permission `virtualKeys:update`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:403`.

Answers at `/api/gateway/v1/virtual-keys/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
type Body = z.infer<typeof gatewayUpdateVirtualKeySchema>; // ../contract/src/gateway-platform.schemas.ts:249
// Response: z.object({ virtual_key: gatewayVirtualKeyDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:408)
```

#### `POST /virtual-keys/:id/rotate` · `postApiGatewayV1VirtualKeysByIdRotate`

Rotate virtual key secret

Permission `virtualKeys:rotate`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:447`.

Answers at `/api/gateway/v1/virtual-keys/:id/rotate`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Body: gatewayRotateVirtualKeyBodySchema, ../contract/src/gateway-platform.schemas.ts:329
type Body = Record<string, unknown>;
// Response: z.object({ virtual_key: gatewayVirtualKeyDtoSchema, secret: z.string() }) (inline, src/transport/gateway-platform.rest.ts:452)
```

#### `POST /virtual-keys/:id/disable` · `postApiGatewayV1VirtualKeysByIdDisable`

Disable virtual key

Permission `virtualKeys:update`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:477`.

Answers at `/api/gateway/v1/virtual-keys/:id/disable`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Body: gatewayDisableVkSchema, ../contract/src/gateway-platform.schemas.ts:263
interface Body {
  reason?: string;
}
// Response: z.object({ virtual_key: gatewayVirtualKeyDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:482)
```

#### `POST /virtual-keys/:id/enable` · `postApiGatewayV1VirtualKeysByIdEnable`

Enable virtual key

Permission `virtualKeys:update`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:507`.

Answers at `/api/gateway/v1/virtual-keys/:id/enable`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Body: gatewayEnableVirtualKeyBodySchema, ../contract/src/gateway-platform.schemas.ts:332
type Body = Record<string, unknown>;
// Response: z.object({ virtual_key: gatewayVirtualKeyDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:512)
```

#### `POST /virtual-keys/:id/revoke` · `postApiGatewayV1VirtualKeysByIdRevoke`

Revoke virtual key

Permission `virtualKeys:delete`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:531`.

Answers at `/api/gateway/v1/virtual-keys/:id/revoke`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Body: gatewayRevokeVirtualKeyBodySchema, ../contract/src/gateway-platform.schemas.ts:335
type Body = Record<string, unknown>;
// Response: z.object({ virtual_key: gatewayVirtualKeyDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:536)
```

#### `GET /budgets` · `getApiGatewayV1Budgets`

List budgets

Permission `gatewayBudgets:view`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:557`.

Answers at `/api/gateway/v1/budgets`.

```typescript
// Query: gatewayBudgetListQuerySchema, ../contract/src/gateway-platform.schemas.ts:185
interface Query {
  cursor?: string;
  limit?: number;
  scope_type?: string;
  external_id?: string;
}
// Response: z.object({ data: z.array(gatewayPlatformBudgetDtoSchema), spend_available: z.boolean(), n… (inline, src/transport/gateway-platform.rest.ts:562)
```

#### `GET /budgets/:id` · `getApiGatewayV1BudgetsById`

Get budget

Permission `gatewayBudgets:view`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:601`.

Answers at `/api/gateway/v1/budgets/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Response: z.object({ budget: gatewayPlatformBudgetDtoSchema, spend_available: z.boolean() }) (inline, src/transport/gateway-platform.rest.ts:605)
```

#### `POST /budgets` · `postApiGatewayV1Budgets`

Create budget

Permission `gatewayBudgets:create`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:618`.

Answers at `/api/gateway/v1/budgets`.

```typescript
type Body = z.infer<typeof gatewayCreateBudgetSchema>; // ../contract/src/gateway-platform.schemas.ts:271
// Response: z.object({ budget: gatewayPlatformBudgetDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:623)
```

#### `PATCH /budgets/:id` · `patchApiGatewayV1BudgetsById`

Update budget

Permission `gatewayBudgets:update`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:663`.

Answers at `/api/gateway/v1/budgets/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Body: gatewayUpdateBudgetSchema, ../contract/src/gateway-platform.schemas.ts:298
interface Body {
  name?: string;
  description?: string | null;
  limit_usd?: number | string;
  on_breach?: "block" | "warn";
  timezone?: string | null;
  external_id?: string | null;
  metadata?: Record<string, string>;
}
// Response: z.object({ budget: gatewayPlatformBudgetDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:668)
```

#### `DELETE /budgets/:id` · `deleteApiGatewayV1BudgetsById`

Archive budget

Permission `gatewayBudgets:delete`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:694`.

Answers at `/api/gateway/v1/budgets/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Response: z.object({ budget: gatewayPlatformBudgetDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:698)
```

#### `POST /budgets/:id/reset` · `postApiGatewayV1BudgetsByIdReset`

Reset budget period

Permission `gatewayBudgets:update`. Credential `api_key`. Declared at `src/transport/gateway-platform.rest.ts:712`.

Answers at `/api/gateway/v1/budgets/:id/reset`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Query: gatewayResetBudgetQuerySchema, ../contract/src/gateway-platform.schemas.ts:196
interface Query {
  end_user_id?: string;
}
// Body: gatewayResetBudgetSchema, ../contract/src/gateway-platform.schemas.ts:267
interface Body {
  reason?: string;
}
// Response: z.object({ budget: gatewayPlatformBudgetDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:718)
```

#### `GET /cache-rules` · `getApiGatewayV1CacheRules`

List cache-control rules

Permission `gatewayCacheRules:view`. Declared at `src/transport/gateway-platform.rest.ts:746`.

Answers at `/api/gateway/v1/cache-rules`.

```typescript
// Query: gatewayPageQuerySchema, ../contract/src/gateway-platform.schemas.ts:169
interface Query {
  cursor?: string;
  limit?: number;
}
// Response: z.object({ data: z.array(gatewayPlatformCacheRuleDtoSchema), next_cursor: gatewayNextCurs… (inline, src/transport/gateway-platform.rest.ts:750)
```

#### `GET /cache-rules/:id` · `getApiGatewayV1CacheRulesById`

Get a cache rule

Permission `gatewayCacheRules:view`. Declared at `src/transport/gateway-platform.rest.ts:778`.

Answers at `/api/gateway/v1/cache-rules/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Response: z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:781)
```

#### `POST /cache-rules` · `postApiGatewayV1CacheRules`

Create a cache rule

Permission `gatewayCacheRules:create`. Declared at `src/transport/gateway-platform.rest.ts:793`.

Answers at `/api/gateway/v1/cache-rules`.

```typescript
type Body = z.infer<typeof gatewayCreateCacheRuleSchema>; // ../contract/src/gateway-platform.schemas.ts:308
// Response: z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:797)
```

#### `PATCH /cache-rules/:id` · `patchApiGatewayV1CacheRulesById`

Update a cache rule

Permission `gatewayCacheRules:update`. Declared at `src/transport/gateway-platform.rest.ts:826`.

Answers at `/api/gateway/v1/cache-rules/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
type Body = z.infer<typeof gatewayUpdateCacheRuleSchema>; // ../contract/src/gateway-platform.schemas.ts:317
// Response: z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:830)
```

#### `DELETE /cache-rules/:id` · `deleteApiGatewayV1CacheRulesById`

Archive a cache rule

Permission `gatewayCacheRules:delete`. Declared at `src/transport/gateway-platform.rest.ts:859`.

Answers at `/api/gateway/v1/cache-rules/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Response: z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }) (inline, src/transport/gateway-platform.rest.ts:862)
```

#### `GET /providers` · `getApiGatewayV1Providers`

List provider bindings

Permission `gatewayProviders:view`. Declared at `src/transport/gateway-platform.rest.ts:886`.

Answers at `/api/gateway/v1/providers`.

```typescript
// Response: inline, src/transport/gateway-platform.rest.ts:888
type Response = unknown;
```

#### `POST /providers` · `postApiGatewayV1Providers`

Bind a model provider to the gateway

Permission `gatewayProviders:manage`. Declared at `src/transport/gateway-platform.rest.ts:901`.

Answers at `/api/gateway/v1/providers`.

```typescript
// Body: gatewayRetiredProviderBindingBodySchema, ../contract/src/gateway-platform.schemas.ts:338
type Body = Record<string, unknown>;
// Response: inline, src/transport/gateway-platform.rest.ts:904
type Response = unknown;
```

#### `PATCH /providers/:id` · `patchApiGatewayV1ProvidersById`

Update provider binding

Permission `gatewayProviders:update`. Declared at `src/transport/gateway-platform.rest.ts:917`.

Answers at `/api/gateway/v1/providers/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
type Body = z.infer<typeof gatewayRetiredProviderBindingBodySchema>; // ../contract/src/gateway-platform.schemas.ts:338
// Response: inline, src/transport/gateway-platform.rest.ts:921
type Response = unknown;
```

#### `DELETE /providers/:id` · `deleteApiGatewayV1ProvidersById`

Disable provider binding

Permission `gatewayProviders:manage`. Declared at `src/transport/gateway-platform.rest.ts:933`.

Answers at `/api/gateway/v1/providers/:id`.

```typescript
type Params = z.infer<typeof gatewayIdParamsSchema>; // ../contract/src/gateway-platform.schemas.ts:326
// Response: inline, src/transport/gateway-platform.rest.ts:936
type Response = unknown;
```

### `gatewaySpendRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/gateway-spend.rest.ts:56` |
| Base URL    | none: each route's path is its address   |
| Addressing  | literal                                  |
| Credential  | organization                             |

#### `GET /api/gateway/v1/spend-summaries` · `listGatewaySpendSummaries`

List spend summaries

Permission `gatewaySpend:view`. Entitlement `webhook_endpoints`. Declared at `src/transport/gateway-spend.rest.ts:65`.

Answers at `/api/gateway/v1/spend-summaries`.

```typescript
type Query = z.infer<typeof gatewaySpendSummariesQuerySchema>; // ../contract/src/features/spend/gateway-spend-rest.schemas.ts:319
type Response = z.infer<typeof gatewaySpendSummariesPageSchema>; // ../contract/src/features/spend/gateway-spend-rest.schemas.ts:360
```

#### `GET /api/gateway/v1/spend-events` · `listGatewaySpendEvents`

List spend events

Permission `gatewaySpend:view`. Entitlement `webhook_endpoints`. Declared at `src/transport/gateway-spend.rest.ts:81`.

Answers at `/api/gateway/v1/spend-events`.

```typescript
type Query = z.infer<typeof gatewaySpendEventsQuerySchema>; // ../contract/src/features/spend/gateway-spend-rest.schemas.ts:135
type Response = z.infer<typeof gatewaySpendEventsPageSchema>; // ../contract/src/features/spend/gateway-spend-rest.schemas.ts:367
```

#### `GET /api/gateway/v1/end-users/:id/spend` · `getGatewayEndUserSpend`

Read one end user's spend

Permission `gatewaySpend:view`. Entitlement `webhook_endpoints`. Declared at `src/transport/gateway-spend.rest.ts:97`.

Answers at `/api/gateway/v1/end-users/:id/spend`.

```typescript
// Params: gatewayEndUserSpendParamsSchema, ../contract/src/features/spend/gateway-spend-rest.schemas.ts:162
interface Params {
  id: string;
}
// Query: gatewayEndUserSpendQuerySchema, ../contract/src/features/spend/gateway-spend-rest.schemas.ts:155
interface Query {
  window?: "day" | "week" | "month";
  from?: number;
  to?: number;
  virtual_key_id?: string;
}
type Response = z.infer<typeof gatewayEndUserSpendResponseSchema>; // ../contract/src/features/spend/gateway-spend-rest.schemas.ts:373
```

## tRPC transport

### `gatewayBudgets`

Contract `../contract/src/features/budget/gateway-budget.trpc.ts:25`, router `src/transport/gateway-budget.trpc.ts:78`.

| Procedure                       | Kind     | Gate                               | Input                                     | Output                            |
| ------------------------------- | -------- | ---------------------------------- | ----------------------------------------- | --------------------------------- |
| `gatewayBudgets.list`           | query    | Permission `gatewayBudgets:view`   | `gatewayBudgetApiOrganizationInputSchema` | `gatewayBudgetListSchema`         |
| `gatewayBudgets.listForProject` | query    | Permission `gatewayBudgets:view`   | `gatewayBudgetApiProjectInputSchema`      | `gatewayBudgetListSchema`         |
| `gatewayBudgets.get`            | query    | Permission `gatewayBudgets:view`   | `gatewayBudgetApiBudgetInputSchema`       | `gatewayBudgetDetailSchema`       |
| `gatewayBudgets.groupTargets`   | query    | Permission `gatewayBudgets:create` | `gatewayBudgetApiOrganizationInputSchema` | `gatewayBudgetGroupTargetsSchema` |
| `gatewayBudgets.personalBudget` | query    | Permission `organization:view`     | `gatewayBudgetApiOrganizationInputSchema` | `gatewayPersonalBudgetSchema`     |
| `gatewayBudgets.create`         | mutation | Permission `gatewayBudgets:create` | `gatewayBudgetApiCreateInputSchema`       | `gatewayBudgetDtoResponseSchema`  |
| `gatewayBudgets.update`         | mutation | Permission `gatewayBudgets:update` | `gatewayBudgetApiUpdateInputSchema`       | `gatewayBudgetDtoResponseSchema`  |
| `gatewayBudgets.archive`        | mutation | Permission `gatewayBudgets:delete` | `gatewayBudgetApiBudgetInputSchema`       | `gatewayBudgetDtoResponseSchema`  |
| `gatewayBudgets.reset`          | mutation | Permission `gatewayBudgets:update` | `gatewayBudgetApiResetInputSchema`        | `gatewayBudgetDtoResponseSchema`  |

```typescript
// gatewayBudgets.list
// Input: gatewayBudgetApiOrganizationInputSchema, ../contract/src/features/budget/gateway.budget.ts:452
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof gatewayBudgetListSchema>; // ../contract/src/gateway.responses.ts:173

// gatewayBudgets.listForProject
// Input: gatewayBudgetApiProjectInputSchema, ../contract/src/features/budget/gateway.budget.ts:455
interface Input {
  projectId: string;
}
type Output = z.infer<typeof gatewayBudgetListSchema>; // ../contract/src/gateway.responses.ts:173

// gatewayBudgets.get
// Input: gatewayBudgetApiBudgetInputSchema, ../contract/src/features/budget/gateway.budget.ts:458
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof gatewayBudgetDetailSchema>; // ../contract/src/gateway.responses.ts:182

// gatewayBudgets.groupTargets
type Input = z.infer<typeof gatewayBudgetApiOrganizationInputSchema>; // ../contract/src/features/budget/gateway.budget.ts:452
// Output: gatewayBudgetGroupTargetsSchema, ../contract/src/gateway.responses.ts:203
type Output = {
  id: string;
  name: string;
  memberCount: number;
}[];

// gatewayBudgets.personalBudget
type Input = z.infer<typeof gatewayBudgetApiOrganizationInputSchema>; // ../contract/src/features/budget/gateway.budget.ts:452
type Output = z.infer<typeof gatewayPersonalBudgetSchema>; // ../contract/src/gateway.responses.ts:326

// gatewayBudgets.create
type Input = z.infer<typeof gatewayBudgetApiCreateInputSchema>; // ../contract/src/features/budget/gateway.budget.ts:463
type Output = z.infer<typeof gatewayBudgetDtoResponseSchema>; // ../contract/src/gateway.responses.ts:209

// gatewayBudgets.update
// Input: gatewayBudgetApiUpdateInputSchema, ../contract/src/features/budget/gateway.budget.ts:494
interface Input {
  organizationId: string;
  id: string;
  name?: string;
  description?: string | null;
  limitUsd?: number | string;
  onBreach?: "BLOCK" | "WARN";
  timezone?: string | null;
}
type Output = z.infer<typeof gatewayBudgetDtoResponseSchema>; // ../contract/src/gateway.responses.ts:209

// gatewayBudgets.archive
type Input = z.infer<typeof gatewayBudgetApiBudgetInputSchema>; // ../contract/src/features/budget/gateway.budget.ts:458
type Output = z.infer<typeof gatewayBudgetDtoResponseSchema>; // ../contract/src/gateway.responses.ts:209

// gatewayBudgets.reset
// Input: gatewayBudgetApiResetInputSchema, ../contract/src/features/budget/gateway.budget.ts:504
interface Input {
  organizationId: string;
  id: string;
  endUserId?: string;
  reason?: string;
}
type Output = z.infer<typeof gatewayBudgetDtoResponseSchema>; // ../contract/src/gateway.responses.ts:209
```

### `gatewayCacheRules`

Contract `../contract/src/gateway-cache-rule.trpc.ts:40`, router `src/transport/gateway-cache-rule.trpc.ts:50`.

| Procedure                   | Kind     | Gate                                  | Input                        | Output                      |
| --------------------------- | -------- | ------------------------------------- | ---------------------------- | --------------------------- |
| `gatewayCacheRules.list`    | query    | Permission `gatewayCacheRules:view`   | `organizationScopeSchema`    | inline                      |
| `gatewayCacheRules.get`     | query    | Permission `gatewayCacheRules:view`   | `cacheRuleIdSchema`          | `gatewayCacheRuleDtoSchema` |
| `gatewayCacheRules.create`  | mutation | Permission `gatewayCacheRules:create` | `cacheRuleCreateInputSchema` | `gatewayCacheRuleDtoSchema` |
| `gatewayCacheRules.update`  | mutation | Permission `gatewayCacheRules:update` | `cacheRuleUpdateInputSchema` | `gatewayCacheRuleDtoSchema` |
| `gatewayCacheRules.archive` | mutation | Permission `gatewayCacheRules:delete` | `cacheRuleIdSchema`          | `gatewayCacheRuleDtoSchema` |

```typescript
// gatewayCacheRules.list
// Input: organizationScopeSchema, ../contract/src/gateway-cache-rule.trpc.ts:16
interface Input {
  organizationId: string;
}
// Output: gatewayCacheRuleDtoSchema.array() (inline, ../contract/src/gateway-cache-rule.trpc.ts:43)

// gatewayCacheRules.get
// Input: cacheRuleIdSchema, ../contract/src/gateway-cache-rule.trpc.ts:17
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof gatewayCacheRuleDtoSchema>; // ../contract/src/gateway.responses.ts:109

// gatewayCacheRules.create
type Input = z.infer<typeof cacheRuleCreateInputSchema>; // ../contract/src/gateway-cache-rule.trpc.ts:19
type Output = z.infer<typeof gatewayCacheRuleDtoSchema>; // ../contract/src/gateway.responses.ts:109

// gatewayCacheRules.update
type Input = z.infer<typeof cacheRuleUpdateInputSchema>; // ../contract/src/gateway-cache-rule.trpc.ts:29
type Output = z.infer<typeof gatewayCacheRuleDtoSchema>; // ../contract/src/gateway.responses.ts:109

// gatewayCacheRules.archive
type Input = z.infer<typeof cacheRuleIdSchema>; // ../contract/src/gateway-cache-rule.trpc.ts:17
type Output = z.infer<typeof gatewayCacheRuleDtoSchema>; // ../contract/src/gateway.responses.ts:109
```

### `gatewayGuardrails`

Contract `../contract/src/gateway-guardrail.trpc.ts:41`, router `src/transport/gateway-guardrail.trpc.ts:12`.

| Procedure                   | Kind     | Gate                                  | Input                        | Output                           |
| --------------------------- | -------- | ------------------------------------- | ---------------------------- | -------------------------------- |
| `gatewayGuardrails.list`    | query    | Permission `gatewayGuardrails:view`   | `projectScopeSchema`         | inline                           |
| `gatewayGuardrails.get`     | query    | Permission `gatewayGuardrails:view`   | `guardrailIdSchema`          | inline                           |
| `gatewayGuardrails.create`  | mutation | Permission `gatewayGuardrails:manage` | `guardrailCreateInputSchema` | `gatewayGuardrailResourceSchema` |
| `gatewayGuardrails.update`  | mutation | Permission `gatewayGuardrails:manage` | `guardrailUpdateInputSchema` | `gatewayGuardrailResourceSchema` |
| `gatewayGuardrails.archive` | mutation | Permission `gatewayGuardrails:manage` | `guardrailIdSchema`          | `guardrailArchivedSchema`        |

```typescript
// gatewayGuardrails.list
// Input: projectScopeSchema, ../contract/src/gateway-guardrail.trpc.ts:16
interface Input {
  projectId: string;
}
// Output: gatewayGuardrailResourceSchema.array() (inline, ../contract/src/gateway-guardrail.trpc.ts:44)

// gatewayGuardrails.get
// Input: guardrailIdSchema, ../contract/src/gateway-guardrail.trpc.ts:17
interface Input {
  projectId: string;
  id: string;
}
// Output: gatewayGuardrailResourceSchema.nullable() (inline, ../contract/src/gateway-guardrail.trpc.ts:48)

// gatewayGuardrails.create
// Input: guardrailCreateInputSchema, ../contract/src/gateway-guardrail.trpc.ts:19
interface Input {
  projectId: string;
  name: string;
  description?: string | null;
  evaluatorId: string;
  direction: "PRE" | "POST" | "STREAM_CHUNK";
  failureMode?: "FAIL_OPEN" | "FAIL_CLOSED";
}
type Output = z.infer<typeof gatewayGuardrailResourceSchema>; // ../contract/src/gateway-guardrail.ts:23

// gatewayGuardrails.update
// Input: guardrailUpdateInputSchema, ../contract/src/gateway-guardrail.trpc.ts:28
interface Input {
  projectId: string;
  id: string;
  name?: string;
  description?: string | null;
  evaluatorId?: string;
  direction?: "PRE" | "POST" | "STREAM_CHUNK";
  failureMode?: "FAIL_OPEN" | "FAIL_CLOSED";
}
type Output = z.infer<typeof gatewayGuardrailResourceSchema>; // ../contract/src/gateway-guardrail.ts:23

// gatewayGuardrails.archive
type Input = z.infer<typeof guardrailIdSchema>; // ../contract/src/gateway-guardrail.trpc.ts:17
// Output: guardrailArchivedSchema, ../contract/src/gateway-guardrail.trpc.ts:39
interface Output {
  ok: true;
}
```

### `gatewaySpendEvents`

Contract `../contract/src/features/spend/gateway-spend-event.trpc.ts:30`, router `src/transport/gateway-spend-event.trpc.ts:12`.

| Procedure                 | Kind  | Gate                           | Input             | Output                        |
| ------------------------- | ----- | ------------------------------ | ----------------- | ----------------------------- |
| `gatewaySpendEvents.list` | query | Permission `gatewayUsage:view` | `listInputSchema` | `gatewaySpendEventPageSchema` |

```typescript
// gatewaySpendEvents.list
type Input = z.infer<typeof listInputSchema>; // ../contract/src/features/spend/gateway-spend-event.trpc.ts:12
type Output = z.infer<typeof gatewaySpendEventPageSchema>; // ../contract/src/gateway.responses.ts:249
```

### `gatewayUsage`

Contract `../contract/src/gateway-usage.trpc.ts:30`, router `src/transport/gateway-usage.trpc.ts:22`.

| Procedure                           | Kind  | Gate                                                                                                                                                                                     | Input                                  | Output                                |
| ----------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------- |
| `gatewayUsage.summary`              | query | Service-authorized: gatewayUsage:view; usage is summed only over the keys the caller's membership in this organization makes visible; the membership filter in the resolver is the check | `usageSummaryInputSchema`              | `gatewayUsageSummarySchema`           |
| `gatewayUsage.summaryForVirtualKey` | query | Service-authorized: gatewayUsage:view; the key is loaded within this organization and must be visible to the caller's membership set; a miss is answered as not found                    | `usageSummaryForVirtualKeyInputSchema` | `gatewayVirtualKeyUsageSummarySchema` |

```typescript
// gatewayUsage.summary
// Input: usageSummaryInputSchema, ../contract/src/gateway-usage.trpc.ts:15
interface Input {
  organizationId: string;
  fromDate: string;
  toDate: string;
}
type Output = z.infer<typeof gatewayUsageSummarySchema>; // ../contract/src/gateway.responses.ts:270

// gatewayUsage.summaryForVirtualKey
// Input: usageSummaryForVirtualKeyInputSchema, ../contract/src/gateway-usage.trpc.ts:21
interface Input {
  organizationId: string;
  virtualKeyId: string;
  fromDate: string;
  toDate: string;
  model?: string;
}
type Output = z.infer<typeof gatewayVirtualKeyUsageSummarySchema>; // ../contract/src/gateway.responses.ts:294
```

### `virtualKeys`

Contract `../contract/src/virtual-key.trpc.ts:24`, router `src/transport/virtual-key.trpc.ts:34`.

| Procedure                       | Kind     | Gate                                                                                                                                                                                                                                                                                                                  | Input                                       | Output                              |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| `virtualKeys.list`              | query    | Service-authorized: virtualKeys:view; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; only keys whose scopes intersect the caller's membership in this organization are returned                                                                              | `virtualKeyApiOrganizationInputSchema`      | inline                              |
| `virtualKeys.get`               | query    | Service-authorized: virtualKeys:view; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; the key must exist in this organization and intersect the caller's membership set, and a miss is answered as not found                                                  | `virtualKeyApiKeyInputSchema`               | `virtualKeyCamelDtoSchema`          |
| `virtualKeys.spendThisMonth`    | query    | Service-authorized: virtualKeys:view; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; spend is reported only for keys visible to the caller's membership in this organization                                                                                 | `virtualKeyApiOrganizationInputSchema`      | `virtualKeySpendThisMonthSchema`    |
| `virtualKeys.applicableBudgets` | query    | Service-authorized: virtualKeys:view, virtualKeys:manage; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; for an existing key, its visibility in this organization, and for a draft, manage on every scope in it, both checked before any budget data is read | `virtualKeyApiApplicableBudgetsInputSchema` | `virtualKeyApplicableBudgetsSchema` |
| `virtualKeys.create`            | mutation | Service-authorized: virtualKeys:manage; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; manage on every requested scope, and every scope anchored to this organization, both before the key is minted                                                         | `virtualKeyApiCreateInputSchema`            | `virtualKeyMintedSchema`            |
| `virtualKeys.update`            | mutation | Service-authorized: virtualKeys:update, virtualKeys:manage; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; update on one of the key's existing scopes, plus manage on every new scope when re-scoping                                                        | `virtualKeyApiUpdateInputSchema`            | `virtualKeyCamelDtoSchema`          |
| `virtualKeys.rotate`            | mutation | Service-authorized: virtualKeys:rotate; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; rotate on one of the key's existing scopes                                                                                                                            | `virtualKeyApiKeyInputSchema`               | `virtualKeyMintedSchema`            |
| `virtualKeys.revoke`            | mutation | Service-authorized: virtualKeys:delete; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; delete on one of the key's existing scopes                                                                                                                            | `virtualKeyApiKeyInputSchema`               | `virtualKeyCamelDtoSchema`          |
| `virtualKeys.disable`           | mutation | Service-authorized: virtualKeys:update; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; update on one of the key's existing scopes                                                                                                                            | `virtualKeyApiDisableInputSchema`           | `virtualKeyCamelDtoSchema`          |
| `virtualKeys.enable`            | mutation | Service-authorized: virtualKeys:update; the scopes a virtual key lives in are data the application loads, so the per-scope check happens there; update on one of the key's existing scopes                                                                                                                            | `virtualKeyApiKeyInputSchema`               | `virtualKeyCamelDtoSchema`          |

```typescript
// virtualKeys.list
// Input: virtualKeyApiOrganizationInputSchema, ../contract/src/virtual-key.schemas.ts:23
interface Input {
  organizationId: string;
}
// Output: virtualKeyCamelDtoSchema.array() (inline, ../contract/src/virtual-key.trpc.ts:27)

// virtualKeys.get
// Input: virtualKeyApiKeyInputSchema, ../contract/src/virtual-key.schemas.ts:26
interface Input {
  organizationId: string;
  id: string;
}
type Output = z.infer<typeof virtualKeyCamelDtoSchema>; // ../contract/src/gateway.responses.ts:18

// virtualKeys.spendThisMonth
type Input = z.infer<typeof virtualKeyApiOrganizationInputSchema>; // ../contract/src/virtual-key.schemas.ts:23
// Output: virtualKeySpendThisMonthSchema, ../contract/src/gateway.responses.ts:62
type Output = {
  virtualKeyId: string;
  spentUsd: string;
  requests: number;
  budget: {
    budgetId: string;
    window: string;
    limitUsd: string;
    periodSpentUsd: string | null;
    resetsAt: string;
  } | null;
}[];

// virtualKeys.applicableBudgets
// Input: virtualKeyApiApplicableBudgetsInputSchema, ../contract/src/virtual-key.schemas.ts:42
interface Input {
  organizationId: string;
  virtualKeyId?: string | null;
  scopes: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
  traceProjectId?: string | null;
  principalUserId?: string | null;
}
type Output = z.infer<typeof virtualKeyApplicableBudgetsSchema>; // ../contract/src/gateway.responses.ts:83

// virtualKeys.create
type Input = z.infer<typeof virtualKeyApiCreateInputSchema>; // ../contract/src/virtual-key.schemas.ts:74
type Output = z.infer<typeof virtualKeyMintedSchema>; // ../contract/src/gateway.responses.ts:51

// virtualKeys.update
type Input = z.infer<typeof virtualKeyApiUpdateInputSchema>; // ../contract/src/virtual-key.schemas.ts:92
type Output = z.infer<typeof virtualKeyCamelDtoSchema>; // ../contract/src/gateway.responses.ts:18

// virtualKeys.rotate
type Input = z.infer<typeof virtualKeyApiKeyInputSchema>; // ../contract/src/virtual-key.schemas.ts:26
type Output = z.infer<typeof virtualKeyMintedSchema>; // ../contract/src/gateway.responses.ts:51

// virtualKeys.revoke
type Input = z.infer<typeof virtualKeyApiKeyInputSchema>; // ../contract/src/virtual-key.schemas.ts:26
type Output = z.infer<typeof virtualKeyCamelDtoSchema>; // ../contract/src/gateway.responses.ts:18

// virtualKeys.disable
// Input: virtualKeyApiDisableInputSchema, ../contract/src/virtual-key.schemas.ts:32
interface Input {
  organizationId: string;
  id: string;
  reason?: string;
}
type Output = z.infer<typeof virtualKeyCamelDtoSchema>; // ../contract/src/gateway.responses.ts:18

// virtualKeys.enable
type Input = z.infer<typeof virtualKeyApiKeyInputSchema>; // ../contract/src/virtual-key.schemas.ts:26
type Output = z.infer<typeof virtualKeyCamelDtoSchema>; // ../contract/src/gateway.responses.ts:18
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `gateway_connect_managed_key` (aggregate `gateway_connect_managed_key`)

Declared at `src/eventing/gateway-connect-managed-key.pipeline.ts:49`. Events: `gatewayManagedKeyProvisionedEventSchema`.

| Kind            | Name                                  | Handles                                                                                                    | Declared at                                               |
| --------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| command         | `recordManagedKeyProvisioned`         | –                                                                                                          | `src/eventing/gateway-connect-managed-key.pipeline.ts:55` |
| peer subscriber | `gatewayConnectManagedKeyIssued`      | `lw.licensing.connect_credential_issued` from [licensing](../../../enterprise/modules/licensing/README.md) | `src/eventing/gateway-connect-managed-key.pipeline.ts:57` |
| peer subscriber | `gatewayConnectManagedKeyRetired`     | `lw.licensing.managed_key_retired` from [licensing](../../../enterprise/modules/licensing/README.md)       | `src/eventing/gateway-connect-managed-key.pipeline.ts:63` |
| peer subscriber | `gatewayConnectManagedKeyInvalidated` | `lw.licensing.managed_key_invalidated` from [licensing](../../../enterprise/modules/licensing/README.md)   | `src/eventing/gateway-connect-managed-key.pipeline.ts:70` |

### Pipeline `governance_events_processing` (aggregate `governance_subject`)

Declared at `src/eventing/gateway-governance-events.pipeline.ts:34`. Events: `gatewayVkLifecycleEventSchema`, `gatewayBudgetCrossingEventSchema`.

| Kind    | Name                   | Handles | Declared at                                             |
| ------- | ---------------------- | ------- | ------------------------------------------------------- |
| command | `recordVkLifecycle`    | –       | `src/eventing/gateway-governance-events.pipeline.ts:39` |
| command | `recordBudgetCrossing` | –       | `src/eventing/gateway-governance-events.pipeline.ts:40` |

### Pipeline `gateway_instant_eval_judge_spend` (aggregate `global`)

Declared at `src/eventing/gateway-instant-eval-judge-spend.pipeline.ts:32`.

| Kind            | Name                              | Handles                                                                                            | Declared at                                                    |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| peer subscriber | `gatewayInstantEvalJudgeSpendRow` | `lw.instant_eval_judge.spend_priced` from [instant-eval-judge](../../instant-eval-judge/README.md) | `src/eventing/gateway-instant-eval-judge-spend.pipeline.ts:39` |

### Pipeline `gateway_pulled_usage_ledger` (aggregate `global`)

Declared at `src/eventing/gateway-pulled-usage-ledger.pipeline.ts:32`.

| Kind            | Name                      | Handles                                                                                          | Declared at                                               |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| peer subscriber | `gatewayPulledUsageDebit` | `lw.obs.pulled_usage.priced` from [governance](../../../enterprise/modules/governance/README.md) | `src/eventing/gateway-pulled-usage-ledger.pipeline.ts:39` |

### Pipeline `gateway_realtime_session_maintenance` (aggregate `global`)

Declared at `src/eventing/gateway-realtime-session.pipeline.ts:41`.

| Kind            | Name                              | Handles                                                                                                                                           | Declared at                                            |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| process manager | `gatewayRealtimeSessionReconcile` | every 1 min (`GATEWAY_REALTIME_SESSION_RECONCILE_INTERVAL_MS = realtimeSessionReconciliationConfig.tickIntervalMs`); intents `reconcile` (outbox) | `src/eventing/gateway-realtime-session.pipeline.ts:46` |

### Pipeline `gateway_spend_processing` (aggregate `gateway_request`)

Declared at `src/eventing/gateway-spend.pipeline.ts:103`. Events: `gatewaySpendAdmittedEventSchema`, `gatewaySpendConfirmedEventSchema`, `gatewaySpendFailedEventSchema`, `gatewaySpendSettledEventSchema`.

| Kind                       | Name                                                               | Handles                                                                                | Declared at                                  |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| command                    | `admitSpend`                                                       | –                                                                                      | `src/eventing/gateway-spend.pipeline.ts:116` |
| command                    | `confirmSpend`                                                     | –                                                                                      | `src/eventing/gateway-spend.pipeline.ts:117` |
| command                    | `failSpend`                                                        | –                                                                                      | `src/eventing/gateway-spend.pipeline.ts:118` |
| command                    | `settleSpend`                                                      | –                                                                                      | `src/eventing/gateway-spend.pipeline.ts:119` |
| process manager            | `≈ this.options.gatewayDebits.name`                                | ≈ applier `this.options.gatewayDebits.applier`                                         | `src/eventing/gateway-spend.pipeline.ts:121` |
| process manager            | `spendSettlement`                                                  | every 5 min (`SETTLEMENT_SWEEP_INTERVAL_MS = 5 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/gateway-spend.pipeline.ts:127` |
| ClickHouse fold projection | `≈ GatewaySpendFoldProjection.create({ store: this.foldStore() })` | –                                                                                      | `src/eventing/gateway-spend.pipeline.ts:115` |

### Tasks

Run by the tasks process, before serve.

| Task                       | Class                        | Declared at                                      |
| -------------------------- | ---------------------------- | ------------------------------------------------ |
| `trace-destination-report` | `TraceDestinationReportTask` | `src/tasks/trace-destination-report.task.ts:161` |

## Configuration

| Kind   | Leaf                          | Environment variable                    | Declared at                            |
| ------ | ----------------------------- | --------------------------------------- | -------------------------------------- |
| secret | `internalSecret`              | `LW_GATEWAY_INTERNAL_SECRET`            | `src/app/gateway.app.ts:1149`          |
| secret | `jwtSecret`                   | `LW_GATEWAY_JWT_SECRET`                 | `src/app/gateway.app.ts:1150`          |
| secret | `virtualKeyPepper`            | `LW_VIRTUAL_KEY_PEPPER`                 | `src/app/gateway.app.ts:1151`          |
| config | `spendSettlementGraceMs`      | `LW_SPEND_SETTLEMENT_GRACE_MS`          | `../contract/src/gateway.config.ts:26` |
| config | `internalUrl`                 | `LW_GATEWAY_INTERNAL_URL`               | `../contract/src/gateway.config.ts:28` |
| config | `controlPlaneUrl`             | `GATEWAY_CONTROL_PLANE_URL`             | `../contract/src/gateway.config.ts:30` |
| config | `publicBaseUrl`               | `BASE_HOST`                             | `../contract/src/gateway.config.ts:32` |
| config | `baseUrl`                     | `LW_GATEWAY_BASE_URL`                   | `../contract/src/gateway.config.ts:34` |
| config | `publicUrl`                   | `LW_GATEWAY_PUBLIC_URL`                 | `../contract/src/gateway.config.ts:36` |
| config | `isSaas`                      | `IS_SAAS`                               | `../contract/src/gateway.config.ts:38` |
| config | `allowLoopbackVoiceProviders` | `VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS` | `../contract/src/gateway.config.ts:40` |
| config | `foldCacheTtlSeconds`         | `LANGWATCH_FOLD_CACHE_TTL_SECONDS`      | `../contract/src/gateway.config.ts:41` |

<!-- readme:generated:end -->
