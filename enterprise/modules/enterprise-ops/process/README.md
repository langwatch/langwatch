# @langwatch/enterprise-ops-process

The server half of [enterprise-ops](../README.md). Operator views over Enterprise subjects: issued licences and their seats and bindings.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("enterprise-ops").withApi(EnterpriseOpsModule).withTransports(licenseRegistryTrpcTransport, selfHostedInstancesTrpcTransport)`, `src/enterprise-ops.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EnterpriseOpsApi`)

The operator views over enterprise subjects (ARCHITECTURE.md section 3): each op admits Cloud admin staff through OpsApi, then forwards to the owner's Api.

Peers call these through the token, declared at `../contract/src/enterprise-ops.api.ts:22`; nothing else in this package is public.

#### `listIssuedLicenses`

```typescript
listIssuedLicenses(input: { page: number; pageSize: number; search?: string; operator: OpsOperator | null; }): Promise<IssuedLicensePage>;
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
listSelfHostedInstances(input: { page: number; pageSize: number; search?: string; operator: OpsOperator | null; }): Promise<SelfHostedInstancePage>;
```

#### `getSelfHostedInstance`

```typescript
getSelfHostedInstance(input: { id: string; operator: OpsOperator | null; }): Promise<SelfHostedInstanceDetail>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `licenseRegistry`

Contract `../contract/src/license-registry.trpc.ts:34`, router `src/transport/license-registry.trpc.ts:19`.

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

### `selfHostedInstances`

Contract `../contract/src/license-registry.trpc.ts:91`, router `src/transport/self-hosted-instance.trpc.ts:14`.

| Procedure                     | Kind  | Gate                           | Input                                | Output                           |
| ----------------------------- | ----- | ------------------------------ | ------------------------------------ | -------------------------------- |
| `selfHostedInstances.getAll`  | query | Platform permission `ops:view` | `listSelfHostedInstancesInputSchema` | `selfHostedInstancePageSchema`   |
| `selfHostedInstances.getById` | query | Platform permission `ops:view` | `selfHostedInstanceIdInputSchema`    | `selfHostedInstanceDetailSchema` |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: enterprise-ops declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
