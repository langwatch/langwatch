# @langwatch/enterprise-licensing-process

The server half of [licensing](../README.md). Licences: validating and storing a signed licence, the plan it grants, and the platform access and single sign-on gates it decides.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("licensing").withRepositories(licensingRepositories).withApi(LicensingModule).withTransports(licenseTrpcTransport, connectTrpcTransport, connectHostedRest, connectHostRest).withTransportFacts(…).withEventing(licenseSyncEventing).withEventing(licensingCustomerEventing).withTasks(…).withMigrations(…)`, `src/licensing.module.ts:23`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`LicensingApi`)

The portable signed-license capability supplied to process peers.

Peers call these through the token, declared at `../contract/src/licensing.api.ts:66`; nothing else in this package is public.

#### `resolve`

```typescript
resolve(input: ResolvePlanInput): Promise<EntitlementGrant>;
```

#### `inspectPlatformAccess`

Every license on this deployment, the instance key first, until one permits the platform.

```typescript
inspectPlatformAccess(): Promise<PlatformLicenseAccess>;
```

#### `getActivePlan`

```typescript
getActivePlan(organizationId: string): Promise<PlanInfo>;
```

#### `getSelfHostedPlan`

```typescript
getSelfHostedPlan(organizationId: string): Promise<PlanInfo>;
```

#### `validateAndStoreLicense`

```typescript
validateAndStoreLicense(input: { organizationId: string; licenseKey: string; }): Promise<StoreLicenseResult>;
```

#### `getLicenseStatus`

```typescript
getLicenseStatus(organizationId: string): Promise<LicenseStatus>;
```

#### `removeLicense`

```typescript
removeLicense(organizationId: string): Promise<RemoveLicenseResult>;
```

#### `getSsoGateStatus`

Why a deployment configured for single sign-on is not using it.

```typescript
getSsoGateStatus(): Promise<SsoGateStatus>;
```

#### `isPlatformSsoLicensed`

Whether a signed license on this deployment permits platform single sign-on.

```typescript
isPlatformSsoLicensed(): Promise<boolean>;
```

#### `getDomainClaimAuthority`

Whether the licence may prove a claimed single sign-on domain, and for whom.

```typescript
getDomainClaimAuthority(): Promise<DomainClaimLicenseAuthority>;
```

#### `uploadLicense`

Validates a pasted key and stores it, answering the plan it grants.

```typescript
uploadLicense(input: StoreLicenseInput): Promise<PlanInfo>;
```

#### `licenseRevision`

Changes on every license this process stores or removes, so a gate can re-read at once.

```typescript
licenseRevision(): Promise<number>;
```

#### `activateLicenseWithCode`

Redeems an activation code with LangWatch and stores the license it minted, through the same validation as a pasted key.

```typescript
activateLicenseWithCode(input: { organizationId: string; code: string }): Promise<PlanInfo>;
```

#### `issueLicense`

The license registry (ADR-156). Every issue path writes a row here, so a license LangWatch signed never exists without one, and the hosted routes judge a presented token against the row rather than the blob.

```typescript
issueLicense(input: IssueLicenseInput): Promise<SignedIssuedLicense>;
```

#### `generateLicenseKey`

Signs a license with licensing's own key, as main's `generateLicenseKey` did for a Stripe licence purchase. Records nothing: the caller records it.

```typescript
generateLicenseKey(input: GenerateLicenseKeyInput): Promise<GenerateLicenseOutput>;
```

#### `recordIssuedLicense`

Records a license another flow already signed: the purchase, the script.

```typescript
recordIssuedLicense(input: { licenseKey: string; source: Extract<IssuedLicenseSource, "PURCHASE" | "SCRIPT">; organizationId?: string; }): Promise<IssuedLicenseView>;
```

#### `registerLegacyLicense`

Registers a license signed before the registry existed.

```typescript
registerLegacyLicense(input: { licenseKey: string; organizationId: string; operatorId: string; }): Promise<IssuedLicenseView>;
```

#### `revokeIssuedLicense`

```typescript
revokeIssuedLicense(input: { id: string; operatorId: string; reason: string; }): Promise<IssuedLicenseView>;
```

#### `reissueLicense`

Signs a replacement for a license, held until the install presents it.

```typescript
reissueLicense(input: { id: string; maxMembers?: number; maxMembersLite?: number; maxMessagesPerMonth?: number; /** ISO 8601. The instant the new term ends. */ expiresAt: string; operatorId: string; }): Promise<SignedIssuedLicense>;
```

#### `changeLicenseSeats`

```typescript
changeLicenseSeats(input: { id: string; maxMembers: number; operatorId: string; }): Promise<SeatChangeResult>;
```

#### `resetLicenseInstanceBinding`

```typescript
resetLicenseInstanceBinding(input: { id: string }): Promise<IssuedLicenseView>;
```

#### `updateLicenseTerms`

```typescript
updateLicenseTerms(input: { id: string; operatorId: string } & LicenseTermsInput): Promise<IssuedLicenseView>;
```

#### `linkLicenseToOrganization`

```typescript
linkLicenseToOrganization(input: { id: string; organizationId: string; operatorId: string; }): Promise<IssuedLicenseView>;
```

#### `getIssuedLicense`

```typescript
getIssuedLicense(input: { id: string }): Promise<IssuedLicenseView>;
```

#### `listIssuedLicenses`

```typescript
listIssuedLicenses(input: { page: number; pageSize: number; search?: string; }): Promise<IssuedLicensePage>;
```

#### `resolveConnectCredential`

Who a presented `lwl_` bearer is, for a hosted route on LangWatch Cloud.

```typescript
resolveConnectCredential(input: { token: string; instanceId: string | null | undefined; }): Promise<ConnectCredentialResolution>;
```

#### `recordLicenseSync`

One daily sync from a connected install; a refusal throws its credential code.

```typescript
recordLicenseSync(input: ConnectPresentedCredential & { body: LicenseSyncBody }): Promise<LicenseSyncAnswer>;
```

#### `getConnectStatus`

The install end of Connect (ADR-156, section 9). A self-hosted deployment calls LangWatch with the license it already holds; these are what its own screens and workers read and write.

```typescript
getConnectStatus(input: { organizationId: string }): Promise<ConnectStatus>;
```

#### `findEnabledConnectServices`

The hosted services this organization's license names and has left on.

```typescript
findEnabledConnectServices(input: { organizationId: string }): Promise<ConnectService[]>;
```

#### `setConnectService`

```typescript
setConnectService(input: { organizationId: string; service: string; enabled: boolean; }): Promise<{ enabledServices: ConnectService[] }>;
```

#### `setConnectCap`

Moves the customer's own hosted usage cap, up to the contract maximum.

```typescript
setConnectCap(input: { organizationId: string; capUsd: number; }): Promise<{ capUsd: number; maximumCapUsd: number }>;
```

#### `getInstanceId`

The identity this install presents to LangWatch, minted on first use.

```typescript
getInstanceId(): Promise<string>;
```

#### `isConnectServiceEnabled`

Whether one hosted service is both entitled here and switched on.

```typescript
isConnectServiceEnabled(input: { organizationId: string; service: ConnectService; }): Promise<boolean>;
```

#### `getConnectServiceState`

Whether the license names one hosted service, and whether it is still on; no network call.

```typescript
getConnectServiceState(input: { organizationId: string; service: ConnectService; }): Promise<ConnectServiceState>;
```

#### `classifyThroughConnect`

Judges one text on LangWatch for an install that holds a license. The install has no judge key of its own, so the judgement happens there and is charged against the budget the license carries.

```typescript
classifyThroughConnect(input: { organizationId: string; text: string; questions: readonly unknown[]; }): Promise<ConnectClassifyAnswer>;
```

#### `refreshLicense`

Runs the daily sync by hand and reports what it changed.

```typescript
refreshLicense(input: { organizationId: string }): Promise<LicenseRefreshOutcome>;
```

#### `syncLicenses`

The daily pass over every organization whose license names a hosted service.

```typescript
syncLicenses(): Promise<void>;
```

#### `findInstanceIdentity`

The install's identity row; empty where it never minted one. Reads, never mints.

```typescript
findInstanceIdentity(): Promise<InstanceIdentityView[]>;
```

#### `getConnectDeployment`

Whether Connect may call out, whether a license names a hosted service, and both hosts.

```typescript
getConnectDeployment(): Promise<ConnectDeploymentView>;
```

#### `recordUsageReportOutcome`

How the last usage report went: no `error` when it landed.

```typescript
recordUsageReportOutcome(input: { error?: string }): Promise<void>;
```

#### `setUsageReportSwitches`

What a customer switched off in the usage report; an absent switch is left alone.

```typescript
setUsageReportSwitches(input: { optionalMetricsOptOut?: boolean; hostnameOptOut?: boolean; }): Promise<void>;
```

#### `classifyForHostedCaller`

The hosted end of Connect (ADR-156 §5), which only LangWatch Cloud composes: whether the calling key belongs to an entitled license.

```typescript
classifyForHostedCaller(input: { caller: HostedCaller; payload: unknown; /** The calling install's request: a judgement it no longer waits for is abandoned. */ signal?: AbortSignal; }): Promise<HostedClassifyAnswer>;
```

#### `getHostedUsage`

What the caller spent against every budget that applies to it.

```typescript
getHostedUsage(input: { caller: HostedCaller }): Promise<HostedUsageAnswer>;
```

#### `setHostedBudgetCap`

The customer moves its own hosted cap, up to the contract maximum.

```typescript
setHostedBudgetCap(input: { caller: HostedCaller; payload: unknown }): Promise<HostedCapAnswer>;
```

#### `getContractTerms`

What a customer's licenses add up to commercially, right now.

```typescript
getContractTerms(input: { organizationId: string }): Promise<ContractTerms>;
```

#### `getConnectedSeats`

The seats a connected customer holds and last reported, for its statement and overview.

```typescript
getConnectedSeats(input: { organizationId: string }): Promise<ConnectedSeats>;
```

#### `findSeatChanges`

Every seat change that raised a linked license, oldest first; one customer's when named.

```typescript
findSeatChanges(input: { organizationId?: string }): Promise<LicenseSeatChange[]>;
```

#### `raiseContractCommit`

Raises the prepaid commit a renewal or top-up invoice agreed.

```typescript
raiseContractCommit(input: { organizationId: string; byUsdCents: number; operatorId: string; }): Promise<IssuedLicenseView>;
```

#### `syncContractBudget`

Re-derives the contract budget's cap from the license terms.

```typescript
syncContractBudget(input: { organizationId: string; operatorId: string }): Promise<void>;
```

#### `resetContractBudget`

Starts a new budget window: spend so far no longer counts.

```typescript
resetContractBudget(input: { organizationId: string; operatorId: string }): Promise<void>;
```

#### `findConnectServicesForManagedKey`

The hosted services the active license behind one managed key is entitled to, empty when no active license names that key. The gateway resolves a CONNECT key's scope through this and never reads `IssuedLicense` itself.

```typescript
findConnectServicesForManagedKey(input: { virtualKeyId: string; organizationId: string; }): Promise<ConnectService[]>;
```

#### `issueActivationCode`

Activation codes (ADR-156, section 5): the short code a fresh install pastes instead of a license blob. Minting and revoking are the the admin console's; redeeming is a public route an install calls once.

```typescript
issueActivationCode(input: IssueActivationCodeInput): Promise<IssuedActivationCode>;
```

#### `listActivationCodes`

```typescript
listActivationCodes(input: { page: number; pageSize: number; organizationId?: string; }): Promise<ActivationCodePage>;
```

#### `revokeActivationCode`

```typescript
revokeActivationCode(input: { id: string; operatorId: string }): Promise<ActivationCodeView>;
```

#### `redeemActivationCode`

One install presenting one code as its bearer, answered with one license, once.

```typescript
redeemActivationCode(input: ConnectPresentedCredential): Promise<ActivationAnswer>;
```

#### `recordUsageReport`

The registry of self-hosted installs (ADR-156, section 10). A report presents no credential, so the customer on a row is resolved from the license bound to that instance and never from the report.

```typescript
recordUsageReport(input: IncomingUsageReport): Promise<SelfHostedSignal[]>;
```

#### `listSelfHostedInstances`

```typescript
listSelfHostedInstances(input: { page: number; pageSize: number; search?: string; }): Promise<SelfHostedInstancePage>;
```

#### `getSelfHostedInstance`

```typescript
getSelfHostedInstance(input: { id: string }): Promise<SelfHostedInstanceDetail>;
```

## REST transport

### `connectHostRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/connect-host.rest.ts:29` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `POST /api/connect/v1/license/sync` · `recordLicenseSync`

Public: a self-hosted install presents its license token or activation code as the bearer; no gateway and no session stand in front of the connect host. Hidden from the OpenAPI document. Declared at `src/transport/connect-host.rest.ts:34`.

Answers at `/api/connect/v1/license/sync`.

```typescript
// Body: licenseSyncBodySchema, ../contract/src/license-sync.ts:16
interface Body {
  version: string;
  seats: {
    members: number;
    liteMembers: number;
  };
}
type Headers = z.infer<typeof connectHostHeadersSchema>; // ../contract/src/license-sync.ts:31
// Response: connectSyncAnswerSchema, ../contract/src/connect-install.ts:25
interface Response {
  services: string[];
  license?: string;
}
```

#### `POST /api/connect/v1/license/activate` · `redeemActivationCode`

Public: a self-hosted install presents its license token or activation code as the bearer; no gateway and no session stand in front of the connect host. Hidden from the OpenAPI document. Declared at `src/transport/connect-host.rest.ts:49`.

Answers at `/api/connect/v1/license/activate`.

```typescript
// Body: connectActivationRequestSchema, ../contract/src/license-sync.ts:37
type Body = Record<string, unknown>;
type Headers = z.infer<typeof connectHostHeadersSchema>; // ../contract/src/license-sync.ts:31
// Response: connectActivationAnswerSchema, ../contract/src/connect-install.ts:34
interface Response {
  license: string;
  planType: string;
  maxMembers: number;
  expiresAt: string;
  services: string[];
}
```

### `connectHostedRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/connect-hosted.rest.ts:42` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | internal_secret                           |

#### `POST /api/internal/gateway/connect/instant-evals-classify` · `classifyForHostedCaller`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/connect-hosted.rest.ts:48`.

Answers at `/api/internal/gateway/connect/instant-evals-classify`.

```typescript
// Body: hostedServiceEnvelopeSchema, ../contract/src/connect-hosted.ts:25
interface Body {
  virtual_key_id: string;
  organization_id: string;
  project_id: string;
  payload: unknown;
}
type Response = z.infer<typeof hostedClassifyAnswerSchema>; // ../contract/src/connect-hosted.ts:107
```

#### `POST /api/internal/gateway/connect/usage` · `getHostedUsage`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/connect-hosted.rest.ts:61`.

Answers at `/api/internal/gateway/connect/usage`.

```typescript
type Body = z.infer<typeof hostedServiceEnvelopeSchema>; // ../contract/src/connect-hosted.ts:25
type Response = z.infer<typeof hostedUsageAnswerSchema>; // ../contract/src/connect-hosted.ts:83
```

#### `POST /api/internal/gateway/connect/budget` · `setHostedBudgetCap`

Authenticated: the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs. Hidden from the OpenAPI document. Declared at `src/transport/connect-hosted.rest.ts:68`.

Answers at `/api/internal/gateway/connect/budget`.

```typescript
type Body = z.infer<typeof hostedServiceEnvelopeSchema>; // ../contract/src/connect-hosted.ts:25
// Response: hostedCapAnswerSchema, ../contract/src/connect-hosted.ts:115
interface Response {
  cap_usd: number;
  maximum_cap_usd: number;
}
```

## tRPC transport

### `connect`

Contract `../contract/src/connect.trpc.ts:18`, router `src/transport/connect.trpc.ts:15`.

| Procedure            | Kind     | Gate                             | Input               | Output                     |
| -------------------- | -------- | -------------------------------- | ------------------- | -------------------------- |
| `connect.status`     | query    | Permission `organization:view`   | `organizationInput` | `connectStatusSchema`      |
| `connect.setService` | mutation | Permission `organization:manage` | inline              | `connectServicesSetSchema` |
| `connect.setCap`     | mutation | Permission `organization:manage` | inline              | `connectCapSetSchema`      |

```typescript
// connect.status
// Input: organizationInput, ../contract/src/connect.trpc.ts:16
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof connectStatusSchema>; // ../contract/src/connect-install.ts:177

// connect.setService
// Input: inline, ../contract/src/connect.trpc.ts:25
interface Input {
  organizationId: string;
  service: "instant_evals" | "managed_models";
  enabled: boolean;
}
// Output: connectServicesSetSchema, ../contract/src/connect-install.ts:192
interface Output {
  enabledServices: ("instant_evals" | "managed_models")[];
}

// connect.setCap
// Input: inline, ../contract/src/connect.trpc.ts:34
interface Input {
  organizationId: string;
  capUsd: number;
}
// Output: connectCapSetSchema, ../contract/src/connect-install.ts:196
interface Output {
  capUsd: number;
  maximumCapUsd: number;
}
```

### `license`

Contract `../contract/src/licensing.trpc.ts:22`, router `src/transport/licensing.trpc.ts:14`.

| Procedure                  | Kind     | Gate                                                                                                                                                                                                                                          | Input                            | Output                        |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------- |
| `license.getStatus`        | query    | Permission `organization:view`                                                                                                                                                                                                                | `licenseOrganizationQuerySchema` | `licenseStatusSchema`         |
| `license.getSsoGateStatus` | query    | No permission: the single sign-on gate is a property of the deployment, not of a tenant, so there is no scope to check against; it stays behind a session because an anonymous visitor has no business learning that an install is unlicensed | inline                           | `ssoGateStatusSchema`         |
| `license.upload`           | mutation | Permission `organization:manage`                                                                                                                                                                                                              | `storeLicenseInputSchema`        | `licenseUploadedSchema`       |
| `license.activate`         | mutation | Permission `organization:manage`                                                                                                                                                                                                              | inline                           | `licenseUploadedSchema`       |
| `license.remove`           | mutation | Permission `organization:manage`                                                                                                                                                                                                              | `licenseOrganizationQuerySchema` | `licenseRemovedSchema`        |
| `license.refresh`          | mutation | Permission `organization:manage`                                                                                                                                                                                                              | `licenseOrganizationQuerySchema` | `licenseRefreshOutcomeSchema` |

```typescript
// license.getStatus
// Input: licenseOrganizationQuerySchema, ../contract/src/licensing.trpc.ts:17
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof licenseStatusSchema>; // ../contract/src/license.ts:219

// license.getSsoGateStatus
// Input: inline, ../contract/src/licensing.trpc.ts:31
type Input = Record<string, unknown>;
// Output: ssoGateStatusSchema, ../contract/src/license.ts:250
interface Output {
  configuredProvider: string | null;
  licensed: boolean;
  mounted: boolean;
}

// license.upload
// Input: storeLicenseInputSchema, ../contract/src/license.commands.ts:6
interface Input {
  organizationId: string;
  licenseKey: string;
}
type Output = z.infer<typeof licenseUploadedSchema>; // ../contract/src/license.ts:266

// license.activate
// Input: inline, ../contract/src/licensing.trpc.ts:40
interface Input {
  organizationId: string;
  code: string;
}
type Output = z.infer<typeof licenseUploadedSchema>; // ../contract/src/license.ts:266

// license.remove
type Input = z.infer<typeof licenseOrganizationQuerySchema>; // ../contract/src/licensing.trpc.ts:17
// Output: licenseRemovedSchema, ../contract/src/license.ts:271
interface Output {
  success: true;
  removed: true;
}

// license.refresh
type Input = z.infer<typeof licenseOrganizationQuerySchema>; // ../contract/src/licensing.trpc.ts:17
// Output: licenseRefreshOutcomeSchema, ../contract/src/connect-install.ts:201
type Output =
  | {
      outcome: "unchanged";
    }
  | {
      outcome: "updated";
      maxMembers: number;
      expiresAt: string;
    };
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `license_sync` (aggregate `global`)

Declared at `src/eventing/license-sync.pipeline.ts:57`.

| Kind            | Name                        | Handles                                                                                     | Declared at                                |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| process manager | `licenseSync`               | every 2 min (`LICENSE_SYNC_FIRST_DELAY_MS = 2 * 60 * 1000`); intents `sync` (outbox)        | `src/eventing/license-sync.pipeline.ts:63` |
| peer subscriber | `configuredLicenseOnSignUp` | `lw.organization.signed_up` from [organization](../../../../modules/organization/README.md) | `src/eventing/license-sync.pipeline.ts:62` |

### Pipeline `licensing_customer` (aggregate `licensing_customer`)

Declared at `src/eventing/licensing-customer.pipeline.ts:67`. Events: `selfHostedCustomerLicensedEventSchema`, `connectServiceSwitchedEventSchema`, `licenseSyncFinishedEventSchema`, `licenseStoredEventSchema`, `licenseClearedEventSchema`, `managedKeyRetiredEventSchema`, `managedKeyInvalidatedEventSchema`.

| Kind    | Name                               | Handles | Declared at                                      |
| ------- | ---------------------------------- | ------- | ------------------------------------------------ |
| command | `recordSelfHostedCustomerLicensed` | –       | `src/eventing/licensing-customer.pipeline.ts:80` |
| command | `recordConnectServiceSwitched`     | –       | `src/eventing/licensing-customer.pipeline.ts:81` |
| command | `recordLicenseSyncFinished`        | –       | `src/eventing/licensing-customer.pipeline.ts:82` |
| command | `recordLicenseStored`              | –       | `src/eventing/licensing-customer.pipeline.ts:83` |
| command | `recordLicenseCleared`             | –       | `src/eventing/licensing-customer.pipeline.ts:84` |
| command | `recordManagedKeyRetired`          | –       | `src/eventing/licensing-customer.pipeline.ts:85` |
| command | `recordManagedKeyInvalidated`      | –       | `src/eventing/licensing-customer.pipeline.ts:86` |

### Tasks

Run by the tasks process, before serve.

| Task               | Class                 | Declared at                             |
| ------------------ | --------------------- | --------------------------------------- |
| `generate-license` | `GenerateLicenseTask` | `src/tasks/generate-license.task.ts:17` |

## Configuration

| Kind   | Leaf                     | Environment variable                 | Declared at                              |
| ------ | ------------------------ | ------------------------------------ | ---------------------------------------- |
| secret | `instanceLicenseKey`     | `LANGWATCH_LICENSE_KEY`              | `src/app/licensing.app.ts:184`           |
| secret | `licensePrivateKey`      | `LANGWATCH_LICENSE_PRIVATE_KEY`      | `src/app/licensing.app.ts:185`           |
| config | `publicKey`              | `LANGWATCH_LICENSE_PUBLIC_KEY`       | `../contract/src/licensing.config.ts:45` |
| config | `connectDisabled`        | `LANGWATCH_CONNECT_DISABLED`         | `../contract/src/licensing.config.ts:52` |
| config | `connectGatewayEndpoint` | `LANGWATCH_CONNECT_GATEWAY_ENDPOINT` | `../contract/src/licensing.config.ts:53` |
| config | `connectLicenseEndpoint` | `LANGWATCH_CONNECT_LICENSE_ENDPOINT` | `../contract/src/licensing.config.ts:57` |
| config | `connectInstanceId`      | `LANGWATCH_CONNECT_INSTANCE_ID`      | `../contract/src/licensing.config.ts:62` |
| config | `isSaas`                 | `IS_SAAS`                            | `../contract/src/licensing.config.ts:70` |
| config | `serviceVersion`         | `SERVICE_VERSION`                    | `../contract/src/licensing.config.ts:72` |
| config | `otelResourceAttributes` | `OTEL_RESOURCE_ATTRIBUTES`           | `../contract/src/licensing.config.ts:73` |
| config | `outboundProxy`          | `HTTPS_PROXY`                        | `../contract/src/licensing.config.ts:75` |

<!-- readme:generated:end -->
