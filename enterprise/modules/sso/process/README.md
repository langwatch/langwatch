# @langwatch/enterprise-sso-process

The server half of [sso](../README.md). Single sign-on: what a deployment may federate with, connections and claimed domains, and the operator's ledger.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("sso").withApi(SsoModule).withTransports(ssoConnectionTrpcTransport, ssoSetupTrpcTransport)`, `src/sso.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`SsoApi`)

Single sign-on: what a deployment may federate with, and the operator's ledger.

Peers call these through the token, declared at `../contract/src/sso.api.ts:77`; nothing else in this package is public.

#### `platformAllowed`

Whether this deployment's licence permits platform single sign-on.

```typescript
platformAllowed(): Promise<boolean>;
```

#### `providerIsMounted`

Whether the configured provider has credentials this build can mount.

```typescript
providerIsMounted(): boolean;
```

#### `resolveProvider`

The provider a sign-in page should offer, or `"email"`.

```typescript
resolveProvider(): Promise<string>;
```

#### `getSignInProviderMounts`

The configured providers, with callbacks under Better Auth's own `baseUrl`. The Microsoft provider hands each sign-in's id token claims to `onMicrosoftProfile` before its lookup.

```typescript
getSignInProviderMounts(input: { baseUrl: string; onMicrosoftProfile?: (profile: Record<string, unknown>) => Promise<void>; }): Promise<SignInProviderMounts>;
```

#### `listConnections`

```typescript
listConnections(input: ListSsoConnectionsInput, by: SsoOperator): Promise<AdminSsoConnectionPage>;
```

#### `findConnection`

`undefined` when no connection carries that id.

```typescript
findConnection(input: SsoConnectionByIdInput, by: SsoOperator): Promise<AdminSsoConnection | undefined>;
```

#### `registerConnection`

```typescript
registerConnection(input: RegisterSsoConnectionInput, by: SsoOperator): Promise<void>;
```

#### `claimDomain`

```typescript
claimDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void>;
```

#### `approveDomainClaim`

```typescript
approveDomainClaim(input: SsoDomainTarget, by: SsoOperator): Promise<void>;
```

#### `rejectDomainClaim`

```typescript
rejectDomainClaim(input: RejectSsoDomainClaimInput, by: SsoOperator): Promise<void>;
```

#### `attestDomain`

```typescript
attestDomain(input: AttestSsoDomainInput, by: SsoOperator): Promise<void>;
```

#### `activateConnection`

```typescript
activateConnection(input: ActivateSsoConnectionInput, by: SsoOperator): Promise<void>;
```

#### `suspendConnection`

```typescript
suspendConnection(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void>;
```

#### `resumeConnection`

```typescript
resumeConnection(input: SsoConnectionTarget, by: SsoOperator): Promise<void>;
```

#### `requestTeardown`

```typescript
requestTeardown(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void>;
```

#### `findConnectionHistoryForOperator`

The administrator's history read, across tenants; `undefined` for an unknown id.

```typescript
findConnectionHistoryForOperator(input: SsoConnectionByIdInput, by: SsoOperator): Promise<SsoConnectionHistoryEntry[] | undefined>;
```

#### `getMigrationProgressForOperator`

One cutover's members, paged; no migration where the connection is missing.

```typescript
getMigrationProgressForOperator(input: OperatorSsoMigrationProgressInput, by: SsoOperator): Promise<{ migration: SsoSetupMigration | null }>;
```

#### `startLegacyMigrationForOperator`

The replacement for a grandfathered connection, registered by an operator.

```typescript
startLegacyMigrationForOperator(input: SsoSetupStartMigrationInput, by: SsoOperator): Promise<SsoSetupRegistered>;
```

#### `findConnectionHistory`

What happened to one of the caller's own connections, newest first. The organization is the caller's, so this is the administrator's read rather than the operator's; identity owns the facts and the words.

```typescript
findConnectionHistory(input: SsoSetupConnectionInput): Promise<SsoConnectionHistoryEntry[]>;
```

#### `watchConnectionHistory`

A tick per change to that same history, for as long as the caller listens. The signal names the connection and nothing else.

```typescript
watchConnectionHistory(input: SsoSetupConnectionInput & { signal?: AbortSignal }): AsyncGenerator<SsoHistoryActivity>;
```

#### `getSetup`

Where this organization's setup stands, with the addresses this module serves folded in beside identity's own reading of the journey. Who is looking decides the proof offered: a platform operator may use the licence.

```typescript
getSetup(input: SsoSetupOrganizationInput, by: SsoAdministrator): Promise<SsoSetupPageView>;
```

#### `getSelfServeContext`

Which tier this organization's own setup runs under (D05): the deployment, what its licence authorizes, and whether it was opted in.

```typescript
getSelfServeContext(input: SsoSetupOrganizationInput): Promise<SsoSelfServeContext>;
```

#### `getMigrationProgress`

One cutover's members, paged. The migration is null where the organization is running none — identity's own shape, kept whole, because "no cutover" is an answer rather than an absence the caller has to handle.

```typescript
getMigrationProgress(input: SsoSetupMigrationProgressInput): Promise<{ migration: SsoSetupMigration | null }>;
```

#### `setupClaimDomain`

The domain ceremony the organization runs itself (ADR-123), where `claimDomain` above is the operator's. Both end at the same aggregate; what differs is who may call and what the history names.

```typescript
setupClaimDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainClaimOutcome>;
```

#### `setupProveDomain`

The record to publish, or nothing left to do. Answered once.

```typescript
setupProveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProof>;
```

#### `setupRemoveDomain`

```typescript
setupRemoveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<void>;
```

#### `setupCheckDomainRecord`

```typescript
setupCheckDomainRecord(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProved>;
```

#### `setupCheckDomainFile`

```typescript
setupCheckDomainFile(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProved>;
```

#### `setupRegister`

The rest of the journey: registering the provider, saying who it admits, and the two ways a connection leaves. The removals are NOT plan-gated — a lapsed plan must strand nobody.

```typescript
setupRegister(input: SsoSetupRegisterInput, by: SsoAdministrator): Promise<SsoSetupRegistered>;
```

#### `setupStartLegacyMigration`

The replacement for a grandfathered connection, and the two levers of the cutover that follows.

```typescript
setupStartLegacyMigration(input: SsoSetupStartMigrationInput, by: SsoAdministrator): Promise<SsoSetupRegistered>;
```

#### `setupSelectMigrationRoute`

```typescript
setupSelectMigrationRoute(input: SsoSetupMigrationRouteInput, by: SsoAdministrator): Promise<void>;
```

#### `setupFinalizeLegacyMigration`

The end of the cutover, on the replacement: what it takes with it is identity's to decide, and it re-reads the evidence itself.

```typescript
setupFinalizeLegacyMigration(input: SsoSetupConnectionInput, by: SsoAdministrator): Promise<void>;
```

#### `setupRename`

The word on the card, which routes nothing and is never plan-gated.

```typescript
setupRename(input: SsoSetupRenameInput, by: SsoAdministrator): Promise<void>;
```

#### `findIdentityProvider`

The settings the edit form is prefilled with, never the client secret. Null for a grandfathered connection, which has none of its own.

```typescript
findIdentityProvider(input: SsoSetupConnectionInput): Promise<SsoSetupIdentityProviderView | null>;
```

#### `setupUpdateIdentityProvider`

Replaces what the connection dials on the same id, so the redirect address registered at the provider stays. Plan-gated like registering.

```typescript
setupUpdateIdentityProvider(input: SsoSetupUpdateIdentityProviderInput, by: SsoAdministrator): Promise<void>;
```

#### `setupSetArrivals`

```typescript
setupSetArrivals(input: SsoSetupArrivalsInput, by: SsoAdministrator): Promise<void>;
```

#### `setupActivate`

Turn the connection on, on the strength of what it has already recorded: the test sign-in's account is resolved where the facts are, never supplied here. Plan-gated, because going live is the purchase.

```typescript
setupActivate(input: SsoSetupConnectionInput, by: SsoAdministrator): Promise<void>;
```

#### `setupDiscardConnection`

```typescript
setupDiscardConnection(input: SsoSetupConnectionInput, by: SsoAdministrator): Promise<void>;
```

#### `setupRemoveConnection`

```typescript
setupRemoveConnection(input: SsoSetupRemovalInput, by: SsoAdministrator): Promise<void>;
```

#### `findBreakGlassGrants`

The way back in (D05): who can still sign in when the identity provider cannot. NONE of these is plan-gated — a lapsed subscription must never be the reason an organization cannot reach its own recovery path.

```typescript
findBreakGlassGrants(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassGrant[]>;
```

#### `findBreakGlassCandidates`

The organization's administrators, as the picker names them.

```typescript
findBreakGlassCandidates(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassCandidate[]>;
```

#### `setupGrantBreakGlass`

Never self-served: the grantor is the administrator this surface authenticated, never an argument.

```typescript
setupGrantBreakGlass(input: SsoBreakGlassGrantInput, by: SsoAdministrator): Promise<SsoBreakGlassBinding>;
```

#### `setupRenewBreakGlass`

```typescript
setupRenewBreakGlass(input: SsoBreakGlassRenewalInput, by: SsoAdministrator): Promise<SsoBreakGlassRenewal>;
```

#### `setupRevokeBreakGlass`

```typescript
setupRevokeBreakGlass(input: SsoBreakGlassBindingInput, by: SsoAdministrator): Promise<SsoBreakGlassBinding>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `ssoConnections`

Contract `../contract/src/sso-connection.trpc.ts:31`, router `src/transport/sso-connection.trpc.ts:48`.

| Procedure                             | Kind     | Gate                                                                                                                                                  | Input                                     | Output                              |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| `ssoConnections.getAll`               | query    | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `listSsoConnectionsInputSchema`           | `backofficeSsoConnectionPageSchema` |
| `ssoConnections.getById`              | query    | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoConnectionByIdSchema`                 | inline                              |
| `ssoConnections.getHistory`           | query    | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoConnectionByIdSchema`                 | inline                              |
| `ssoConnections.getMigrationProgress` | query    | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `operatorSsoMigrationProgressInputSchema` | inline                              |
| `ssoConnections.startLegacyMigration` | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoSetupStartMigrationSchema`            | `ssoSetupRegisteredSchema`          |
| `ssoConnections.register`             | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `registerSsoConnectionInputSchema`        | –                                   |
| `ssoConnections.claimDomain`          | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoDomainTargetSchema`                   | inline                              |
| `ssoConnections.approveDomainClaim`   | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoDomainTargetSchema`                   | inline                              |
| `ssoConnections.rejectDomainClaim`    | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `rejectSsoDomainClaimInputSchema`         | inline                              |
| `ssoConnections.attestDomain`         | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `attestSsoDomainInputSchema`              | inline                              |
| `ssoConnections.activate`             | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `activateSsoConnectionInputSchema`        | inline                              |
| `ssoConnections.suspend`              | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoConnectionReasonInputSchema`          | inline                              |
| `ssoConnections.resume`               | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoConnectionTargetSchema`               | inline                              |
| `ssoConnections.requestTeardown`      | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `ssoConnectionReasonInputSchema`          | inline                              |

### `ssoSetup`

Contract `../contract/src/sso-setup.trpc.ts:40`, router `src/transport/sso-setup.trpc.ts:44`.

| Procedure                          | Kind         | Gate                                                              | Input                                  | Output                        |
| ---------------------------------- | ------------ | ----------------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| `ssoSetup.getSetup`                | query        | Permission `sso:view`                                             | `ssoSetupOrganizationSchema`           | `ssoSetupPageViewSchema`      |
| `ssoSetup.getMigrationProgress`    | query        | Permission `sso:view`                                             | `ssoSetupMigrationProgressSchema`      | inline                        |
| `ssoSetup.getHistory`              | query        | Permission `sso:manage`                                           | `ssoSetupConnectionSchema`             | inline                        |
| `ssoSetup.onHistoryActivity`       | subscription | Permission `sso:manage`                                           | `ssoSetupConnectionSchema`             | `ssoHistoryActivitySchema`    |
| `ssoSetup.claimDomain`             | mutation     | Permission `sso:manage`                                           | `ssoSetupDomainSchema`                 | `ssoDomainClaimOutcomeSchema` |
| `ssoSetup.proveDomain`             | mutation     | Permission `sso:manage`                                           | `ssoSetupDomainSchema`                 | `ssoDomainProofSchema`        |
| `ssoSetup.removeDomain`            | mutation     | Permission `sso:manage`                                           | `ssoSetupDomainSchema`                 | inline                        |
| `ssoSetup.checkDomainRecord`       | mutation     | Permission `sso:manage`                                           | `ssoSetupDomainSchema`                 | `ssoDomainProvedSchema`       |
| `ssoSetup.checkDomainFile`         | mutation     | Permission `sso:manage`                                           | `ssoSetupDomainSchema`                 | `ssoDomainProvedSchema`       |
| `ssoSetup.register`                | mutation     | Permission `sso:manage`; Entitlement `enterprise` (feature `SSO`) | `ssoSetupRegisterSchema`               | `ssoSetupRegisteredSchema`    |
| `ssoSetup.startLegacyMigration`    | mutation     | Permission `sso:manage`; Entitlement `enterprise` (feature `SSO`) | `ssoSetupStartMigrationSchema`         | `ssoSetupRegisteredSchema`    |
| `ssoSetup.selectMigrationRoute`    | mutation     | Permission `sso:manage`; Entitlement `enterprise` (feature `SSO`) | `ssoSetupMigrationRouteSchema`         | inline                        |
| `ssoSetup.finalizeLegacyMigration` | mutation     | Permission `sso:manage`; Entitlement `enterprise` (feature `SSO`) | `ssoSetupConnectionSchema`             | inline                        |
| `ssoSetup.rename`                  | mutation     | Permission `sso:manage`                                           | `ssoSetupRenameSchema`                 | inline                        |
| `ssoSetup.identityProvider`        | query        | Permission `sso:manage`                                           | `ssoSetupConnectionSchema`             | inline                        |
| `ssoSetup.updateIdentityProvider`  | mutation     | Permission `sso:manage`; Entitlement `enterprise` (feature `SSO`) | `ssoSetupUpdateIdentityProviderSchema` | inline                        |
| `ssoSetup.setArrivals`             | mutation     | Permission `sso:manage`; Entitlement `enterprise` (feature `SSO`) | `ssoSetupArrivalsSchema`               | inline                        |
| `ssoSetup.activate`                | mutation     | Permission `sso:manage`; Entitlement `enterprise` (feature `SSO`) | `ssoSetupConnectionSchema`             | inline                        |
| `ssoSetup.breakGlassBindings`      | query        | Permission `sso:view`                                             | `ssoSetupOrganizationSchema`           | inline                        |
| `ssoSetup.breakGlassCandidates`    | query        | Permission `sso:manage`                                           | `ssoSetupOrganizationSchema`           | inline                        |
| `ssoSetup.grantBreakGlass`         | mutation     | Permission `sso:manage`                                           | `ssoBreakGlassGrantInputSchema`        | `ssoBreakGlassBindingSchema`  |
| `ssoSetup.renewBreakGlass`         | mutation     | Permission `sso:manage`                                           | `ssoBreakGlassRenewalInputSchema`      | `ssoBreakGlassRenewalSchema`  |
| `ssoSetup.revokeBreakGlass`        | mutation     | Permission `sso:manage`                                           | `ssoBreakGlassBindingInputSchema`      | `ssoBreakGlassBindingSchema`  |
| `ssoSetup.discardConnection`       | mutation     | Permission `sso:manage`                                           | `ssoSetupConnectionSchema`             | inline                        |
| `ssoSetup.removeConnection`        | mutation     | Permission `sso:manage`                                           | `ssoSetupRemovalSchema`                | inline                        |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: sso declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf               | Environment variable   | Declared at                                               |
| ------ | ------------------ | ---------------------- | --------------------------------------------------------- |
| secret | `–`                | `GOOGLE_CLIENT_SECRET` | `src/app/sso.app.ts:329`                                  |
| config | `authProvider`     | `AUTH_PROVIDER`        | `../../../../packages/config/src/deployment-facts.ts:238` |
| config | `legacyProvider`   | `NEXTAUTH_PROVIDER`    | `../../../../packages/config/src/deployment-facts.ts:240` |
| config | `googleClientId`   | `GOOGLE_CLIENT_ID`     | `../../../../packages/config/src/deployment-facts.ts:241` |
| config | `githubClientId`   | `GITHUB_CLIENT_ID`     | `../../../../packages/config/src/deployment-facts.ts:242` |
| config | `gitlabClientId`   | `GITLAB_CLIENT_ID`     | `../../../../packages/config/src/deployment-facts.ts:243` |
| config | `azureAdClientId`  | `AZURE_AD_CLIENT_ID`   | `../../../../packages/config/src/deployment-facts.ts:244` |
| config | `azureAdTenantId`  | `AZURE_AD_TENANT_ID`   | `../../../../packages/config/src/deployment-facts.ts:245` |
| config | `auth0ClientId`    | `AUTH0_CLIENT_ID`      | `../../../../packages/config/src/deployment-facts.ts:246` |
| config | `auth0Issuer`      | `AUTH0_ISSUER`         | `../../../../packages/config/src/deployment-facts.ts:247` |
| config | `oktaClientId`     | `OKTA_CLIENT_ID`       | `../../../../packages/config/src/deployment-facts.ts:248` |
| config | `oktaIssuer`       | `OKTA_ISSUER`          | `../../../../packages/config/src/deployment-facts.ts:249` |
| config | `cognitoClientId`  | `COGNITO_CLIENT_ID`    | `../../../../packages/config/src/deployment-facts.ts:250` |
| config | `cognitoIssuer`    | `COGNITO_ISSUER`       | `../../../../packages/config/src/deployment-facts.ts:251` |
| config | `oneLoginClientId` | `ONELOGIN_CLIENT_ID`   | `../../../../packages/config/src/deployment-facts.ts:252` |
| config | `oneLoginIssuer`   | `ONELOGIN_ISSUER`      | `../../../../packages/config/src/deployment-facts.ts:253` |
| config | `oidcClientId`     | `OIDC_CLIENT_ID`       | `../../../../packages/config/src/deployment-facts.ts:254` |
| config | `oidcIssuer`       | `OIDC_ISSUER`          | `../../../../packages/config/src/deployment-facts.ts:255` |
| config | `isSaas`           | `IS_SAAS`              | `../contract/src/sso.config.ts:12`                        |
| config | `publicBaseUrl`    | `BASE_HOST`            | `../contract/src/sso.config.ts:12`                        |

<!-- readme:generated:end -->
