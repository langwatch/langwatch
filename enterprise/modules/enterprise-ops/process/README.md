# @langwatch/enterprise-ops-process

The server half of [enterprise-ops](../README.md). Operator views over Enterprise subjects: issued licences and their seats and bindings.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("enterprise-ops").withApi(EnterpriseOpsModule).withTransports(licenseRegistryTrpcTransport, selfHostedInstancesTrpcTransport, selfHostedNoticesTrpcTransport)`, `src/enterprise-ops.module.ts:9`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EnterpriseOpsApi`)

The operator views over enterprise subjects (ARCHITECTURE.md section 3): each op admits Cloud admin staff through OpsApi, then forwards to the owner's Api.

Peers call these through the token, declared at `../contract/src/enterprise-ops.api.ts:30`; nothing else in this package is public.

#### `listIssuedLicenses`

```typescript
listIssuedLicenses(input: { page: number; pageSize: number; search?: string; operator: OpsOperator | null; } & IssuedLicenseFilters): Promise<IssuedLicensePage>;
```

#### `getIssuedLicense`

```typescript
getIssuedLicense(input: { id: string; operator: OpsOperator | null }): Promise<IssuedLicenseView>;
```

#### `issueLicense`

```typescript
issueLicense(input: { customer: LicenseCustomer; email: string; planType: string; maxMembers: number; maxMembersLite?: number; maxMessagesPerMonth?: number; /** ISO 8601. The instant the term ends. */ expiresAt: string; terms?: LicenseTermsInput; operator: OpsOperator | null; }): Promise<SignedIssuedLicense>;
```

#### `registerLegacyLicense`

```typescript
registerLegacyLicense(input: { licenseKey: string; organizationId: string; operator: OpsOperator | null; }): Promise<IssuedLicenseView>;
```

#### `revokeIssuedLicense`

```typescript
revokeIssuedLicense(input: { id: string; reason: string; operator: OpsOperator | null; }): Promise<IssuedLicenseView>;
```

#### `reissueLicense`

```typescript
reissueLicense(input: { id: string; maxMembers?: number; maxMembersLite?: number; maxMessagesPerMonth?: number; /** ISO 8601. The instant the new term ends. */ expiresAt: string; operator: OpsOperator | null; }): Promise<SignedIssuedLicense>;
```

#### `changeLicenseSeats`

```typescript
changeLicenseSeats(input: { id: string; maxMembers: number; operator: OpsOperator | null; }): Promise<SeatChangeResult>;
```

#### `resetLicenseInstanceBinding`

```typescript
resetLicenseInstanceBinding(input: { id: string; operator: OpsOperator | null; }): Promise<IssuedLicenseView>;
```

#### `updateLicenseTerms`

```typescript
updateLicenseTerms(input: { id: string; operator: OpsOperator | null } & LicenseTermsInput): Promise<IssuedLicenseView>;
```

#### `linkLicenseToOrganization`

```typescript
linkLicenseToOrganization(input: { id: string; organizationId: string; operator: OpsOperator | null; }): Promise<IssuedLicenseView>;
```

#### `listActivationCodes`

```typescript
listActivationCodes(input: { page: number; pageSize: number; organizationId?: string; operator: OpsOperator | null; }): Promise<ActivationCodePage>;
```

#### `issueActivationCode`

```typescript
issueActivationCode(input: { organizationId: string; organizationName: string; email: string; planType: string; maxMembers: number; maxMembersLite?: number; licenseTermDays: number; services?: string[]; /** ISO 8601. The instant the code stops working. */ expiresAt: string; reusable?: boolean; operator: OpsOperator | null; }): Promise<IssuedActivationCode>;
```

#### `revokeActivationCode`

```typescript
revokeActivationCode(input: { id: string; operator: OpsOperator | null; }): Promise<ActivationCodeView>;
```

#### `listSelfHostedInstances`

```typescript
listSelfHostedInstances(input: { page: number; pageSize: number; search?: string; operator: OpsOperator | null; } & SelfHostedInstanceFilters): Promise<SelfHostedInstancePage>;
```

#### `getSelfHostedInstance`

```typescript
getSelfHostedInstance(input: { id: string; operator: OpsOperator | null; }): Promise<SelfHostedInstanceDetail>;
```

#### `summarizeSelfHostedInstances`

```typescript
summarizeSelfHostedInstances(input: { operator: OpsOperator | null; }): Promise<SelfHostedInstanceSummary>;
```

#### `findUpgradeDiagnostics`

The upgrade diagnostics one install sent, newest first.

```typescript
findUpgradeDiagnostics(input: { instanceRowId: string; operator: OpsOperator | null; }): Promise<UpgradeDiagnosticsReport[]>;
```

#### `getUpgradeDiagnosticsDownload`

A five-minute link to one bundle: the sensitive read, so it asks `ops:manage`.

```typescript
getUpgradeDiagnosticsDownload(input: { id: string; operator: OpsOperator | null; }): Promise<UpgradeDiagnosticsDownload>;
```

#### `findSelfHostedNotices`

```typescript
findSelfHostedNotices(input: { operator: OpsOperator | null }): Promise<SelfHostedNoticeView[]>;
```

#### `createSelfHostedNotice`

```typescript
createSelfHostedNotice(input: CreateSelfHostedNoticeInput & { operator: OpsOperator | null }): Promise<SelfHostedNoticeView>;
```

#### `updateSelfHostedNotice`

```typescript
updateSelfHostedNotice(input: UpdateSelfHostedNoticeInput & { operator: OpsOperator | null }): Promise<SelfHostedNoticeView>;
```

#### `publishSelfHostedNotice`

```typescript
publishSelfHostedNotice(input: { id: string; operator: OpsOperator | null; }): Promise<SelfHostedNoticeView>;
```

#### `withdrawSelfHostedNotice`

```typescript
withdrawSelfHostedNotice(input: { id: string; operator: OpsOperator | null; }): Promise<SelfHostedNoticeView>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `licenseRegistry`

Contract `../contract/src/license-registry.trpc.ts:40`, router `src/transport/license-registry.trpc.ts:23`.

| Procedure                              | Kind     | Gate                             | Input                                  | Output                       |
| -------------------------------------- | -------- | -------------------------------- | -------------------------------------- | ---------------------------- |
| `licenseRegistry.getAll`               | query    | Platform permission `ops:view`   | `listIssuedLicensesInputSchema`        | `issuedLicensePageSchema`    |
| `licenseRegistry.getById`              | query    | Platform permission `ops:view`   | `licenseIdInputSchema`                 | `issuedLicenseViewSchema`    |
| `licenseRegistry.issue`                | mutation | Platform permission `ops:manage` | `issueLicenseInputSchema`              | `signedIssuedLicenseSchema`  |
| `licenseRegistry.registerLegacy`       | mutation | Platform permission `ops:manage` | `registerLegacyLicenseInputSchema`     | `issuedLicenseViewSchema`    |
| `licenseRegistry.revoke`               | mutation | Platform permission `ops:manage` | `revokeIssuedLicenseInputSchema`       | `issuedLicenseViewSchema`    |
| `licenseRegistry.reissue`              | mutation | Platform permission `ops:manage` | `reissueLicenseInputSchema`            | `signedIssuedLicenseSchema`  |
| `licenseRegistry.changeSeats`          | mutation | Platform permission `ops:manage` | `changeLicenseSeatsInputSchema`        | `seatChangeResultSchema`     |
| `licenseRegistry.resetInstanceBinding` | mutation | Platform permission `ops:manage` | `licenseIdInputSchema`                 | `issuedLicenseViewSchema`    |
| `licenseRegistry.updateTerms`          | mutation | Platform permission `ops:manage` | `updateLicenseTermsInputSchema`        | `issuedLicenseViewSchema`    |
| `licenseRegistry.linkToOrganization`   | mutation | Platform permission `ops:manage` | `linkLicenseToOrganizationInputSchema` | `issuedLicenseViewSchema`    |
| `licenseRegistry.activationCodes`      | query    | Platform permission `ops:view`   | `listActivationCodesInputSchema`       | `activationCodePageSchema`   |
| `licenseRegistry.issueActivationCode`  | mutation | Platform permission `ops:manage` | `issueActivationCodeInputSchema`       | `issuedActivationCodeSchema` |
| `licenseRegistry.revokeActivationCode` | mutation | Platform permission `ops:manage` | `revokeActivationCodeInputSchema`      | `activationCodeViewSchema`   |

```typescript
// licenseRegistry.getAll
// Input: listIssuedLicensesInputSchema, ../../licensing/contract/src/license-registry.ts:28
interface Input {
  status?: "active" | "inactive";
  audience?: "customer" | "internal";
  page?: number;
  pageSize?: number;
  search?: string;
}
type Output = z.infer<typeof issuedLicensePageSchema>; // ../../licensing/contract/src/issued-license.ts:100

// licenseRegistry.getById
// Input: licenseIdInputSchema, ../../licensing/contract/src/license-registry.ts:32
interface Input {
  id: string;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:80

// licenseRegistry.issue
type Input = z.infer<typeof issueLicenseInputSchema>; // ../../licensing/contract/src/license-registry.ts:47
type Output = z.infer<typeof signedIssuedLicenseSchema>; // ../../licensing/contract/src/issued-license.ts:134

// licenseRegistry.registerLegacy
// Input: registerLegacyLicenseInputSchema, ../../licensing/contract/src/license-registry.ts:58
interface Input {
  licenseKey: string;
  organizationId: string;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:80

// licenseRegistry.revoke
// Input: revokeIssuedLicenseInputSchema, ../../licensing/contract/src/license-registry.ts:68
interface Input {
  id: string;
  reason: string;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:80

// licenseRegistry.reissue
// Input: reissueLicenseInputSchema, ../../licensing/contract/src/license-registry.ts:82
interface Input {
  id: string;
  maxMembers?: number;
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  expiresAt: string;
}
type Output = z.infer<typeof signedIssuedLicenseSchema>; // ../../licensing/contract/src/issued-license.ts:134

// licenseRegistry.changeSeats
// Input: changeLicenseSeatsInputSchema, ../../licensing/contract/src/license-registry.ts:92
interface Input {
  id: string;
  maxMembers: number;
}
type Output = z.infer<typeof seatChangeResultSchema>; // ../../licensing/contract/src/issued-license.ts:151

// licenseRegistry.resetInstanceBinding
type Input = z.infer<typeof licenseIdInputSchema>; // ../../licensing/contract/src/license-registry.ts:32
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:80

// licenseRegistry.updateTerms
// Input: updateLicenseTermsInputSchema, ../../licensing/contract/src/license-registry.ts:102
interface Input {
  id: string;
  services?: ("instant_evals" | "managed_models")[];
  seatRateCents?: number | null;
  seatCurrency?: "USD" | "EUR" | null;
  commitUsdCents?: number;
  overageEnabled?: boolean;
  overageMaxUsdCents?: number | null;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:80

// licenseRegistry.linkToOrganization
// Input: linkLicenseToOrganizationInputSchema, ../../licensing/contract/src/license-registry.ts:112
interface Input {
  id: string;
  organizationId: string;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:80

// licenseRegistry.activationCodes
// Input: listActivationCodesInputSchema, ../../licensing/contract/src/activation-code.ts:68
interface Input {
  page?: number;
  pageSize?: number;
  organizationId?: string;
}
type Output = z.infer<typeof activationCodePageSchema>; // ../../licensing/contract/src/activation-code.ts:56

// licenseRegistry.issueActivationCode
// Input: issueActivationCodeInputSchema, ../../licensing/contract/src/activation-code.ts:88
interface Input {
  organizationId: string;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite?: number;
  licenseTermDays: number;
  services?: string[];
  expiresAt: string;
  reusable?: boolean;
}
type Output = z.infer<typeof issuedActivationCodeSchema>; // ../../licensing/contract/src/activation-code.ts:109

// licenseRegistry.revokeActivationCode
// Input: revokeActivationCodeInputSchema, ../../licensing/contract/src/activation-code.ts:98
interface Input {
  id: string;
}
type Output = z.infer<typeof activationCodeViewSchema>; // ../../licensing/contract/src/activation-code.ts:45
```

### `selfHostedInstances`

Contract `../contract/src/license-registry.trpc.ts:97`, router `src/transport/self-hosted-instance.trpc.ts:14`.

| Procedure                                    | Kind     | Gate                             | Input                                | Output                             |
| -------------------------------------------- | -------- | -------------------------------- | ------------------------------------ | ---------------------------------- |
| `selfHostedInstances.getAll`                 | query    | Platform permission `ops:view`   | `listSelfHostedInstancesInputSchema` | `selfHostedInstancePageSchema`     |
| `selfHostedInstances.getById`                | query    | Platform permission `ops:view`   | `selfHostedInstanceIdInputSchema`    | `selfHostedInstanceDetailSchema`   |
| `selfHostedInstances.summary`                | query    | Platform permission `ops:view`   | inline                               | `selfHostedInstanceSummarySchema`  |
| `selfHostedInstances.findDiagnostics`        | query    | Platform permission `ops:view`   | `findUpgradeDiagnosticsInputSchema`  | inline                             |
| `selfHostedInstances.getDiagnosticsDownload` | mutation | Platform permission `ops:manage` | `upgradeDiagnosticsIdInputSchema`    | `upgradeDiagnosticsDownloadSchema` |

```typescript
// selfHostedInstances.getAll
type Input = z.infer<typeof listSelfHostedInstancesInputSchema>; // ../../licensing/contract/src/self-hosted-instance.ts:105
type Output = z.infer<typeof selfHostedInstancePageSchema>; // ../../licensing/contract/src/self-hosted-instance.ts:72

// selfHostedInstances.getById
// Input: selfHostedInstanceIdInputSchema, ../../licensing/contract/src/self-hosted-instance.ts:112
interface Input {
  id: string;
}
type Output = z.infer<typeof selfHostedInstanceDetailSchema>; // ../../licensing/contract/src/self-hosted-instance.ts:136

// selfHostedInstances.summary
// Input: inline, ../contract/src/license-registry.trpc.ts:107
type Input = unknown;
type Output = z.infer<typeof selfHostedInstanceSummarySchema>; // ../../licensing/contract/src/self-hosted-instance.ts:162

// selfHostedInstances.findDiagnostics
// Input: findUpgradeDiagnosticsInputSchema, ../../licensing/contract/src/upgrade-diagnostics.ts:101
interface Input {
  instanceRowId: string;
}
// Output: inline, ../contract/src/license-registry.trpc.ts:112
type Output = {
  id: string;
  instanceId: string;
  stepId: string;
  stepDescription: string | null;
  release: string | null;
  attempt: number;
  trigger: "operator" | "automatic";
  byteLength: number;
  receivedAt: string;
  expiresAt: string;
}[];

// selfHostedInstances.getDiagnosticsDownload
// Input: upgradeDiagnosticsIdInputSchema, ../../licensing/contract/src/upgrade-diagnostics.ts:109
interface Input {
  id: string;
}
// Output: upgradeDiagnosticsDownloadSchema, ../../licensing/contract/src/upgrade-diagnostics.ts:65
interface Output {
  url: string;
  expiresAt: string;
}
```

### `selfHostedNotices`

Contract `../contract/src/self-hosted-notice.trpc.ts:15`, router `src/transport/self-hosted-notice.trpc.ts:14`.

| Procedure                    | Kind     | Gate                             | Input                               | Output                       |
| ---------------------------- | -------- | -------------------------------- | ----------------------------------- | ---------------------------- |
| `selfHostedNotices.getAll`   | query    | Platform permission `ops:view`   | inline                              | inline                       |
| `selfHostedNotices.create`   | mutation | Platform permission `ops:manage` | `createSelfHostedNoticeInputSchema` | `selfHostedNoticeViewSchema` |
| `selfHostedNotices.update`   | mutation | Platform permission `ops:manage` | `updateSelfHostedNoticeInputSchema` | `selfHostedNoticeViewSchema` |
| `selfHostedNotices.publish`  | mutation | Platform permission `ops:manage` | `selfHostedNoticeIdInputSchema`     | `selfHostedNoticeViewSchema` |
| `selfHostedNotices.withdraw` | mutation | Platform permission `ops:manage` | `selfHostedNoticeIdInputSchema`     | `selfHostedNoticeViewSchema` |

```typescript
// selfHostedNotices.getAll
// Input: inline, ../contract/src/self-hosted-notice.trpc.ts:17
type Input = unknown;
// Output: z.array(selfHostedNoticeViewSchema) (inline, ../contract/src/self-hosted-notice.trpc.ts:18)

// selfHostedNotices.create
// Input: createSelfHostedNoticeInputSchema, ../../licensing/contract/src/self-hosted-notice.ts:37
interface Input {
  severity: "info" | "warning" | "security";
  title: string;
  body: string;
  url: string | null;
  fixedIn: string | null;
  expiresAt: string | null;
}
type Output = z.infer<typeof selfHostedNoticeViewSchema>; // ../../licensing/contract/src/self-hosted-notice.ts:78

// selfHostedNotices.update
// Input: updateSelfHostedNoticeInputSchema, ../../licensing/contract/src/self-hosted-notice.ts:48
interface Input {
  id: string;
  severity: "info" | "warning" | "security";
  title: string;
  body: string;
  url: string | null;
  fixedIn: string | null;
  expiresAt: string | null;
}
type Output = z.infer<typeof selfHostedNoticeViewSchema>; // ../../licensing/contract/src/self-hosted-notice.ts:78

// selfHostedNotices.publish
// Input: selfHostedNoticeIdInputSchema, ../../licensing/contract/src/self-hosted-notice.ts:56
interface Input {
  id: string;
}
type Output = z.infer<typeof selfHostedNoticeViewSchema>; // ../../licensing/contract/src/self-hosted-notice.ts:78

// selfHostedNotices.withdraw
type Input = z.infer<typeof selfHostedNoticeIdInputSchema>; // ../../licensing/contract/src/self-hosted-notice.ts:56
type Output = z.infer<typeof selfHostedNoticeViewSchema>; // ../../licensing/contract/src/self-hosted-notice.ts:78
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: enterprise-ops declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
