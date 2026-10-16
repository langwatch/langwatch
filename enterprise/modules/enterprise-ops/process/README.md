# @langwatch/enterprise-ops-process

The server half of [enterprise-ops](../README.md). Operator views over Enterprise subjects: issued licences and their seats and bindings.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("enterprise-ops").withApi(EnterpriseOpsModule).withTransports(licenseRegistryTrpcTransport, selfHostedInstancesTrpcTransport)`, `src/enterprise-ops.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EnterpriseOpsApi`)

The operator views over enterprise subjects (ARCHITECTURE.md section 3): each op admits Cloud admin staff through OpsApi, then forwards to the owner's Api.

Peers call these through the token, declared at `../contract/src/enterprise-ops.api.ts:29`; nothing else in this package is public.

#### `listIssuedLicenses`

```typescript
listIssuedLicenses(input: { page: number; pageSize: number; search?: string; includeTesting?: boolean; operator: OpsOperator | null; }): Promise<NamedIssuedLicensePage>;
```

#### `getIssuedLicense`

```typescript
getIssuedLicense(input: { id: string; operator: OpsOperator | null; }): Promise<NamedIssuedLicenseView>;
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

#### `listTestingLicenseTokens`

```typescript
listTestingLicenseTokens(input: { page: number; pageSize: number; operator: OpsOperator | null; }): Promise<NamedTestingLicenseTokenPage>;
```

#### `createTestingLicenseServiceToken`

```typescript
createTestingLicenseServiceToken(input: { name: string; expiresInDays?: number; operator: OpsOperator | null; }): Promise<MintedTestingLicenseToken>;
```

#### `revokeTestingLicenseToken`

```typescript
revokeTestingLicenseToken(input: { id: string; operator: OpsOperator | null; }): Promise<TestingLicenseTokenView>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `licenseRegistry`

Contract `../contract/src/license-registry.trpc.ts:44`, router `src/transport/license-registry.trpc.ts:23`.

| Procedure                                          | Kind     | Gate                             | Input                                         | Output                               |
| -------------------------------------------------- | -------- | -------------------------------- | --------------------------------------------- | ------------------------------------ |
| `licenseRegistry.getAll`                           | query    | Platform permission `ops:view`   | `listIssuedLicensesInputSchema`               | `namedIssuedLicensePageSchema`       |
| `licenseRegistry.getById`                          | query    | Platform permission `ops:view`   | `licenseIdInputSchema`                        | `namedIssuedLicenseViewSchema`       |
| `licenseRegistry.issue`                            | mutation | Platform permission `ops:manage` | `issueLicenseInputSchema`                     | `signedIssuedLicenseSchema`          |
| `licenseRegistry.registerLegacy`                   | mutation | Platform permission `ops:manage` | `registerLegacyLicenseInputSchema`            | `issuedLicenseViewSchema`            |
| `licenseRegistry.revoke`                           | mutation | Platform permission `ops:manage` | `revokeIssuedLicenseInputSchema`              | `issuedLicenseViewSchema`            |
| `licenseRegistry.reissue`                          | mutation | Platform permission `ops:manage` | `reissueLicenseInputSchema`                   | `signedIssuedLicenseSchema`          |
| `licenseRegistry.changeSeats`                      | mutation | Platform permission `ops:manage` | `changeLicenseSeatsInputSchema`               | `seatChangeResultSchema`             |
| `licenseRegistry.resetInstanceBinding`             | mutation | Platform permission `ops:manage` | `licenseIdInputSchema`                        | `issuedLicenseViewSchema`            |
| `licenseRegistry.updateTerms`                      | mutation | Platform permission `ops:manage` | `updateLicenseTermsInputSchema`               | `issuedLicenseViewSchema`            |
| `licenseRegistry.linkToOrganization`               | mutation | Platform permission `ops:manage` | `linkLicenseToOrganizationInputSchema`        | `issuedLicenseViewSchema`            |
| `licenseRegistry.activationCodes`                  | query    | Platform permission `ops:view`   | `listActivationCodesInputSchema`              | `activationCodePageSchema`           |
| `licenseRegistry.issueActivationCode`              | mutation | Platform permission `ops:manage` | `issueActivationCodeInputSchema`              | `issuedActivationCodeSchema`         |
| `licenseRegistry.revokeActivationCode`             | mutation | Platform permission `ops:manage` | `revokeActivationCodeInputSchema`             | `activationCodeViewSchema`           |
| `licenseRegistry.testingLicenseTokens`             | query    | Platform permission `ops:manage` | `listTestingLicenseTokensInputSchema`         | `namedTestingLicenseTokenPageSchema` |
| `licenseRegistry.createTestingLicenseServiceToken` | mutation | Platform permission `ops:manage` | `createTestingLicenseServiceTokenInputSchema` | `mintedTestingLicenseTokenSchema`    |
| `licenseRegistry.revokeTestingLicenseToken`        | mutation | Platform permission `ops:manage` | `revokeTestingLicenseTokenInputSchema`        | `testingLicenseTokenViewSchema`      |

```typescript
// licenseRegistry.getAll
// Input: listIssuedLicensesInputSchema, ../../licensing/contract/src/license-registry.ts:20
interface Input {
  page?: number;
  pageSize?: number;
  search?: string;
  includeTesting?: boolean;
}
type Output = z.infer<typeof namedIssuedLicensePageSchema>; // ../contract/src/license-registry.responses.ts:30

// licenseRegistry.getById
// Input: licenseIdInputSchema, ../../licensing/contract/src/license-registry.ts:24
interface Input {
  id: string;
}
type Output = z.infer<typeof namedIssuedLicenseViewSchema>; // ../contract/src/license-registry.responses.ts:20

// licenseRegistry.issue
type Input = z.infer<typeof issueLicenseInputSchema>; // ../../licensing/contract/src/license-registry.ts:39
type Output = z.infer<typeof signedIssuedLicenseSchema>; // ../../licensing/contract/src/issued-license.ts:126

// licenseRegistry.registerLegacy
// Input: registerLegacyLicenseInputSchema, ../../licensing/contract/src/license-registry.ts:50
interface Input {
  licenseKey: string;
  organizationId: string;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:84

// licenseRegistry.revoke
// Input: revokeIssuedLicenseInputSchema, ../../licensing/contract/src/license-registry.ts:60
interface Input {
  id: string;
  reason: string;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:84

// licenseRegistry.reissue
// Input: reissueLicenseInputSchema, ../../licensing/contract/src/license-registry.ts:74
interface Input {
  id: string;
  maxMembers?: number;
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  expiresAt: string;
}
type Output = z.infer<typeof signedIssuedLicenseSchema>; // ../../licensing/contract/src/issued-license.ts:126

// licenseRegistry.changeSeats
// Input: changeLicenseSeatsInputSchema, ../../licensing/contract/src/license-registry.ts:84
interface Input {
  id: string;
  maxMembers: number;
}
type Output = z.infer<typeof seatChangeResultSchema>; // ../../licensing/contract/src/issued-license.ts:143

// licenseRegistry.resetInstanceBinding
type Input = z.infer<typeof licenseIdInputSchema>; // ../../licensing/contract/src/license-registry.ts:24
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:84

// licenseRegistry.updateTerms
// Input: updateLicenseTermsInputSchema, ../../licensing/contract/src/license-registry.ts:94
interface Input {
  id: string;
  services?: ("instant_evals" | "managed_models")[];
  seatRateCents?: number | null;
  seatCurrency?: "USD" | "EUR" | null;
  commitUsdCents?: number;
  overageEnabled?: boolean;
  overageMaxUsdCents?: number | null;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:84

// licenseRegistry.linkToOrganization
// Input: linkLicenseToOrganizationInputSchema, ../../licensing/contract/src/license-registry.ts:104
interface Input {
  id: string;
  organizationId: string;
}
type Output = z.infer<typeof issuedLicenseViewSchema>; // ../../licensing/contract/src/issued-license.ts:84

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

// licenseRegistry.testingLicenseTokens
// Input: listTestingLicenseTokensInputSchema, ../../licensing/contract/src/testing-license.ts:102
interface Input {
  page?: number;
  pageSize?: number;
}
type Output = z.infer<typeof namedTestingLicenseTokenPageSchema>; // ../contract/src/license-registry.responses.ts:50

// licenseRegistry.createTestingLicenseServiceToken
// Input: createTestingLicenseServiceTokenInputSchema, ../../licensing/contract/src/testing-license.ts:113
interface Input {
  name: string;
  expiresInDays?: number;
}
type Output = z.infer<typeof mintedTestingLicenseTokenSchema>; // ../../licensing/contract/src/testing-license.ts:127

// licenseRegistry.revokeTestingLicenseToken
// Input: revokeTestingLicenseTokenInputSchema, ../../licensing/contract/src/testing-license.ts:135
interface Input {
  id: string;
}
// Output: testingLicenseTokenViewSchema, ../../licensing/contract/src/testing-license.ts:80
interface Output {
  id: string;
  kind: "personal" | "service";
  name: string | null;
  ownerUserId: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedById: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "revoked";
}
```

### `selfHostedInstances`

Contract `../contract/src/license-registry.trpc.ts:113`, router `src/transport/self-hosted-instance.trpc.ts:14`.

| Procedure                     | Kind  | Gate                           | Input                                | Output                           |
| ----------------------------- | ----- | ------------------------------ | ------------------------------------ | -------------------------------- |
| `selfHostedInstances.getAll`  | query | Platform permission `ops:view` | `listSelfHostedInstancesInputSchema` | `selfHostedInstancePageSchema`   |
| `selfHostedInstances.getById` | query | Platform permission `ops:view` | `selfHostedInstanceIdInputSchema`    | `selfHostedInstanceDetailSchema` |

```typescript
// selfHostedInstances.getAll
// Input: listSelfHostedInstancesInputSchema, ../../licensing/contract/src/self-hosted-instance.ts:84
interface Input {
  page?: number;
  pageSize?: number;
  search?: string;
}
type Output = z.infer<typeof selfHostedInstancePageSchema>; // ../../licensing/contract/src/self-hosted-instance.ts:72

// selfHostedInstances.getById
// Input: selfHostedInstanceIdInputSchema, ../../licensing/contract/src/self-hosted-instance.ts:91
interface Input {
  id: string;
}
type Output = z.infer<typeof selfHostedInstanceDetailSchema>; // ../../licensing/contract/src/self-hosted-instance.ts:115
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: enterprise-ops declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
