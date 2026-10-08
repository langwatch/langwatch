# @langwatch/identity-process

The server-side runtime of the identity platform
([ADR-101](../../dev/docs/adr/101-identity-pipeline-and-identifiers.md),
[ADR-115](../../dev/docs/adr/115-identity-ships-as-packages.md)), in the
module's service/repository shape (ARCHITECTURE.md §3.2): **service classes
over repository interfaces**, with no storage engine and no event-sourcing framework in the
package.

```text
 IdentityHeadsRepository (interface)          reads over the Identifier projection
                                              and User.userHashKey
 IdentityLedger (interface)                   commit(command, facts) — THE emission
                                              seam; the app appends waited, stages
                                              onto the queue, and waits for the fold
 IdentityVerificationRepository (interface)   the PKCE record: replace / find / consume
 IdentityBackfillRepository (interface)       the legacy rows a pass adopts and proves
 IdentityUsersRepository (interface)          the guarded userHashKey write and the
                                              user's email a ceremony records

 IdentityGuardsService                veto-before-write; shared by the calling path and
                               the queue's staged re-run. A promotion and an
                               erasure also ROUTE: they read the whole person and
                               state one fact per stream that has to move, which
                               is what a per-identifier fold cannot sweep for
                               itself (ADR-127)
 IdentityService               attach / verify / markPrimary / detach / erase
 VerificationCeremonyService   magic link + PKCE, id-pinned, single-use
 IdentityBackfillService       one user's pass: adopt → establish → detach → prove

 IdentityCeremonyWrites        the write surface sliced by ROLE, so a collaborator
 IdentityVerificationWrites    takes a named contract rather than a Pick<> of the
 IdentityAdoptionWrites        service class (IdentityService implements all three)

 crypto/                       deriveIdentifierId · computeIdentifierHash ·
                               mintUserHashKey · s256Challenge
 identity-command-id           every form a command id takes, in one place
 identity-backfill-plan        what the legacy rows imply, as a pure plan
 ./better-auth                 IdentityCeremonies — what a row write MEANS,
                               bound to better-auth's databaseHooks — and
                               createIdentityStorageAdapter, better-auth's whole
                               `database:` entry. The only contact with the library
```

Nothing here reads the environment or a database. The write gate, the
clock and the command-id minter arrive as closures; this package implements
the five interfaces with Prisma and its event-sourcing pipeline
(`repositories/prisma/`, `eventing/`), and the process container builds every
service once from the module's registries (ARCHITECTURE.md §5). The pure half — vocabulary, facts, the reducer, the
refusal errors — is
[`@langwatch/identity-contract`](../contract/README.md).

Server-only by construction: nothing in the browser reaches this package,
and the app's frontend-boundary test fails the build if that changes, so
`node:crypto` lives on the root entry rather than behind a subpath.

better-auth appears only as a PEER, and only on the `./better-auth` subpath.
The root entry — and therefore every service — is free of the library
entirely.

`createIdentityStorageAdapter` IS better-auth's `database:` entry (ADR-116
§1): the implementation `createAdapterFactory` is built AROUND, never a
wrapper over a finished one. That distinction is mechanical, not stylistic.
better-auth satisfies its own `join: { account: true }` with a second query
issued through the instance the factory was built around, and runs sign-up
inside `adapter.transaction` — both below any wrapper, and both on this
adapter at this level. Inside it, the per-user gate routes between
better-auth's own published Prisma engine (legacy users, verbatim) and
event-sourced storage (latched users: linkage as facts, secrets in
`AccountCredential`, reads from `Identifier` ⋈ `AccountCredential`). It still
implements no storage of its own — the identity branch runs on the
`IdentityAccountsPort` / `IdentityResolutionPort` ports the app fills with
Prisma, and the legacy branch is the library's engine handed in.

The gate ships closed, so every user takes the legacy branch until an
operator enrolls one;
`src/__tests__/identity-storage-adapter-legacy.unit.test.ts` walks the whole
flow over both engines and compares the transcripts, which is what makes
that a checked claim rather than an asserted one.

Spec: `specs/identity/identifier-model.feature`,
`specs/identity/identity-storage-adapter.feature`,
`modules/identity/specs/package-boundary.feature`.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("identity").withRepositories(identityRepositories).withApi(IdentityModule).withTransports(identityLookupTrpcTransport, identityTrpcTransport, joinRequestTrpcTransport, twoStepVerificationTrpcTransport).withTransportFacts(…).withEventing(identityEventing).withEventing(identityPipelineEventing).withEventing(joinRequestEventing).withEventing(ssoConnectionEventing).withMigrations(…)`, `src/identity.module.ts:19`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`IdentityLookupApi`)

The platform operator's identity lookup (D05). The door admits only ops:manage at the platform and hides the surface from everyone else; every act is recorded.

Peers call these through the token, declared at `../contract/src/identity-lookup.ts:188`; nothing else in this package is public.

#### `lookupAddress`

```typescript
lookupAddress(input: { address: string; operator: IdentityLookupOperator; }): Promise<IdentityLookupAnswer>;
```

#### `getLookupPerson`

```typescript
getLookupPerson(input: { userId: string; address: string; operator: IdentityLookupOperator; }): Promise<LookupPersonDetail>;
```

#### `findLookupActivity`

```typescript
findLookupActivity(input: { operator: IdentityLookupOperator; }): Promise<LookupOperatorActivityRow[]>;
```

#### `findDomainClaimQueue`

```typescript
findDomainClaimQueue(input: { operator: IdentityLookupOperator }): Promise<LookupDomainClaim[]>;
```

#### `confirmProposedSignIn`

```typescript
confirmProposedSignIn(input: { userId: string; proposalId: string; operator: IdentityLookupOperator; }): Promise<void>;
```

#### `rejectProposedSignIn`

```typescript
rejectProposedSignIn(input: { userId: string; proposalId: string; operator: IdentityLookupOperator; }): Promise<void>;
```

#### `detachLookupMethod`

```typescript
detachLookupMethod(input: { userId: string; identifierId: string; operator: IdentityLookupOperator; }): Promise<void>;
```

#### `endLookupSessions`

A null `identifierId` ends every session; an id ends that method's.

```typescript
endLookupSessions(input: { userId: string; identifierId: string | null; operator: IdentityLookupOperator; }): Promise<void>;
```

#### `resendLookupInvitation`

```typescript
resendLookupInvitation(input: { organizationId: string; inviteId: string; operator: IdentityLookupOperator; }): Promise<LookupInvitationExpiry>;
```

#### `extendLookupInvitation`

```typescript
extendLookupInvitation(input: { organizationId: string; inviteId: string; operator: IdentityLookupOperator; }): Promise<LookupInvitationExpiry>;
```

#### `recordRefusedLookup`

A caller the door refused (Q51): recorded within a shared stranger budget, never thrown.

```typescript
recordRefusedLookup(input: { operator: IdentityLookupOperator; action: string; args: Readonly<Record<string, string | null>>; }): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `identityLookup`

Contract `../contract/src/identity-lookup.trpc.ts:24`, router `src/transport/identity-lookup.trpc.ts:51`.

| Procedure                              | Kind     | Gate                             | Input                   | Output                         |
| -------------------------------------- | -------- | -------------------------------- | ----------------------- | ------------------------------ |
| `identityLookup.resolve`               | query    | Platform permission `ops:manage` | inline                  | `identityLookupAnswerSchema`   |
| `identityLookup.person`                | query    | Platform permission `ops:manage` | inline                  | inline                         |
| `identityLookup.recentActivity`        | query    | Platform permission `ops:manage` | inline                  | inline                         |
| `identityLookup.claimQueue`            | query    | Platform permission `ops:manage` | inline                  | inline                         |
| `identityLookup.confirmProposedSignIn` | mutation | Platform permission `ops:manage` | `proposalInputSchema`   | inline                         |
| `identityLookup.rejectProposedSignIn`  | mutation | Platform permission `ops:manage` | `proposalInputSchema`   | inline                         |
| `identityLookup.detachMethod`          | mutation | Platform permission `ops:manage` | inline                  | inline                         |
| `identityLookup.endSessions`           | mutation | Platform permission `ops:manage` | inline                  | inline                         |
| `identityLookup.resendInvitation`      | mutation | Platform permission `ops:manage` | `invitationInputSchema` | `lookupInvitationExpirySchema` |
| `identityLookup.extendInvitation`      | mutation | Platform permission `ops:manage` | `invitationInputSchema` | `lookupInvitationExpirySchema` |

```typescript
// identityLookup.resolve
// Input: inline, ../contract/src/identity-lookup.trpc.ts:26
interface Input {
  address: string;
}
type Output = z.infer<typeof identityLookupAnswerSchema>; // ../contract/src/identity-lookup.ts:65

// identityLookup.person
// Input: inline, ../contract/src/identity-lookup.trpc.ts:30
interface Input {
  userId: string;
  address: string;
}
// Output: lookupPersonDetailSchema.nullable() (inline, ../contract/src/identity-lookup.trpc.ts:31)

// identityLookup.recentActivity
// Input: inline, ../contract/src/identity-lookup.trpc.ts:34
type Input = Record<string, unknown>;
// Output: inline, ../contract/src/identity-lookup.trpc.ts:35
type Output = {
  auditId: string;
  operatorUserId: string | null;
  operatorName: string | null;
  act: string;
  address: string | null;
  atMs: number;
}[];

// identityLookup.claimQueue
// Input: inline, ../contract/src/identity-lookup.trpc.ts:38
type Input = Record<string, unknown>;
// Output: inline, ../contract/src/identity-lookup.trpc.ts:39
type Output = {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  domain: string;
  waitingSinceMs: number;
}[];

// identityLookup.confirmProposedSignIn
// Input: proposalInputSchema, ../contract/src/identity-lookup.trpc.ts:14
interface Input {
  userId: string;
  proposalId: string;
}
// Output: inline, ../contract/src/identity-lookup.trpc.ts:43
type Output = unknown;

// identityLookup.rejectProposedSignIn
type Input = z.infer<typeof proposalInputSchema>; // ../contract/src/identity-lookup.trpc.ts:14
// Output: inline, ../contract/src/identity-lookup.trpc.ts:47
type Output = unknown;

// identityLookup.detachMethod
// Input: inline, ../contract/src/identity-lookup.trpc.ts:50
interface Input {
  userId: string;
  identifierId: string;
}
// Output: inline, ../contract/src/identity-lookup.trpc.ts:51
type Output = unknown;

// identityLookup.endSessions
// Input: inline, ../contract/src/identity-lookup.trpc.ts:55
interface Input {
  userId: string;
  identifierId?: string | null;
}
// Output: inline, ../contract/src/identity-lookup.trpc.ts:61
type Output = unknown;

// identityLookup.resendInvitation
// Input: invitationInputSchema, ../contract/src/identity-lookup.trpc.ts:19
interface Input {
  organizationId: string;
  inviteId: string;
}
// Output: lookupInvitationExpirySchema, ../contract/src/identity-lookup.ts:172
interface Output {
  expiresAtMs: number | null;
}

// identityLookup.extendInvitation
type Input = z.infer<typeof invitationInputSchema>; // ../contract/src/identity-lookup.trpc.ts:19
type Output = z.infer<typeof lookupInvitationExpirySchema>; // ../contract/src/identity-lookup.ts:172
```

### `identity`

Contract `../contract/src/identity.trpc.ts:25`, router `src/transport/identity.trpc.ts:25`.

| Procedure                               | Kind     | Gate                                                                                                                                                              | Input                             | Output                         |
| --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------ |
| `identity.completeVerification`         | mutation | No permission: completes the session user's own email verification; the ceremony proves the record is pinned to that user, and no organization scope applies      | `completeVerificationInputSchema` | inline                         |
| `identity.myTestArrival`                | query    | No permission: answers where the session user's own sign-in leaves them; the caller usually belongs to no organization yet, which is the condition being reported | `emptyInputSchema`                | `ssoTestArrivalStandingSchema` |
| `identity.myIdentifiers`                | query    | No permission: lists the session user's own sign-in identifiers; no organization scope applies and no other account is reachable                                  | `emptyInputSchema`                | inline                         |
| `identity.myMethodsLastUsed`            | query    | No permission: reads when the session user's own sign-in methods last minted a session; no organization scope applies and no other account is reachable           | `emptyInputSchema`                | `methodsLastUsedSchema`        |
| `identity.addEmailIdentifier`           | mutation | No permission: adds an identifier to the session user's own account; no organization scope applies                                                                | inline                            | `emailIdentifierAddedSchema`   |
| `identity.resendIdentifierConfirmation` | mutation | No permission: re-sends the session user's own address confirmation; the ceremony proves the identifier is theirs                                                 | inline                            | inline                         |
| `identity.removeIdentifier`             | mutation | No permission: removes an identifier from the session user's own account; the identity guards decide, and no organization scope applies                           | inline                            | inline                         |

```typescript
// identity.completeVerification
// Input: completeVerificationInputSchema, ../contract/src/identity.trpc.ts:17
interface Input {
  identifierId: string;
  verificationId: string;
  token: string;
  codeVerifier: string;
}
// Output: inline, ../contract/src/identity.trpc.ts:28
interface Output {
  verified: true;
}

// identity.myTestArrival
// Input: emptyInputSchema, ../contract/src/identity.trpc.ts:14
type Input = Record<string, unknown>;
// Output: ssoTestArrivalStandingSchema, ../contract/src/sso-admission.ts:71
type Output = {
  testing: true;
  connectionId: string;
  organizationId: string;
  organizationName: string;
} | {
  testing: false;
};

// identity.myIdentifiers
type Input = z.infer<typeof emptyInputSchema>; // ../contract/src/identity.trpc.ts:14
// Output: inline, ../contract/src/identity.trpc.ts:36
type Output = {
  identifierId: string;
  accountId: string | null;
  provider: "credential" | "email" | "passkey" | "google" | "github" | "gitlab" | "azure-ad" | "oidc" | "saml" | "auth0-legacy" | "okta-legacy";
  value: string | null;
  isPrimary: boolean;
  confirmed: boolean;
  resendable: boolean;
  removable: boolean;
  refusalCode: string | null;
  demotesFirst: boolean;
}[];

// identity.myMethodsLastUsed
type Input = z.infer<typeof emptyInputSchema>; // ../contract/src/identity.trpc.ts:14
// Output: methodsLastUsedSchema, ../contract/src/account-identifiers.ts:34
interface Output {
  byIdentifier: Record<string, string>;
  secondFactorAt: string | null;
}

// identity.addEmailIdentifier
// Input: inline, ../contract/src/identity.trpc.ts:43
interface Input {
  email: string;
  codeChallenge: string;
}
// Output: emailIdentifierAddedSchema, ../contract/src/account-identifiers.ts:30
interface Output {
  identifierId: string;
}

// identity.resendIdentifierConfirmation
// Input: inline, ../contract/src/identity.trpc.ts:48
interface Input {
  identifierId: string;
  codeChallenge: string;
}
// Output: inline, ../contract/src/identity.trpc.ts:50
interface Output {
  sent: true;
}

// identity.removeIdentifier
// Input: inline, ../contract/src/identity.trpc.ts:53
interface Input {
  identifierId: string;
}
// Output: inline, ../contract/src/identity.trpc.ts:54
interface Output {
  removed: true;
}
```

### `identity.joinRequests`

Contract `../contract/src/join-request.trpc.ts:35`, router `src/transport/join-request.trpc.ts:104`.

| Procedure                                  | Kind     | Gate                                                                                                                                                                                                                     | Input                                   | Output                            |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------- |
| `identity.joinRequests.lookup`             | query    | No permission: the caller is asking about organizations they are not in yet, so there is no scope to hold a permission on; the handler answers only for the session's OWN verified addresses and reveals nothing else    | inline                                  | `joinRequestLookupSchema`         |
| `identity.joinRequests.offer`              | query    | No permission: the same own-verified-address answer `lookup` gives, minus the domains this caller has dismissed; no other person's organizations are reachable                                                           | inline                                  | `joinRequestLookupSchema`         |
| `identity.joinRequests.dismissOffer`       | mutation | No permission: the caller silencing their own offer, on the domain their own session's verified address holds                                                                                                            | inline                                  | `joinRequestWriteAckSchema`       |
| `identity.joinRequests.admitAutomatically` | mutation | No permission: admits the caller to an organization that opted into admitting their own verified domain; the handler re-derives the match server-side and admits nothing else                                            | `joinRequestApiAdmitInputSchema`        | `joinRequestAdmittedSchema`       |
| `identity.joinRequests.mine`               | query    | No permission: the caller's own pending requests, keyed by their session id                                                                                                                                              | inline                                  | `joinRequestMineSchema`           |
| `identity.joinRequests.request`            | mutation | No permission: asking to join is the one action a non-member takes on an organization; the handler proves the organization was OFFERED to this caller's verified domain and refuses anything else as if it did not exist | `joinRequestApiRequestInputSchema`      | `joinRequestFiledSchema`          |
| `identity.joinRequests.withdraw`           | mutation | No permission: the requester withdrawing their own request, matched on the session's user id                                                                                                                             | `joinRequestApiWithdrawInputSchema`     | `joinRequestWriteAckSchema`       |
| `identity.joinRequests.pending`            | query    | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiOrganizationScopeSchema` | `joinRequestPendingSchema`        |
| `identity.joinRequests.approve`            | mutation | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiDecisionInputSchema`     | `joinRequestWriteAckSchema`       |
| `identity.joinRequests.reject`             | mutation | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiDecisionInputSchema`     | `joinRequestWriteAckSchema`       |
| `identity.joinRequests.joining`            | query    | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiOrganizationScopeSchema` | `joinRequestJoiningSchema`        |
| `identity.joinRequests.setJoining`         | mutation | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiSetJoiningInputSchema`   | `joinRequestJoiningChangedSchema` |
| `identity.joinRequests.automaticJoins`     | query    | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiOrganizationScopeSchema` | `joinRequestAutomaticJoinsSchema` |
| `identity.joinRequests.getJoinAdmissions`  | query    | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiAdmissionsInputSchema`   | inline                            |

```typescript
// identity.joinRequests.lookup
// Input: inline, ../contract/src/join-request.trpc.ts:42
type Input = unknown;
// Output: joinRequestLookupSchema, ../contract/src/join-request.trpc.ts:33
type Output = unknown;

// identity.joinRequests.offer
// Input: inline, ../contract/src/join-request.trpc.ts:47
type Input = unknown;
type Output = z.infer<typeof joinRequestLookupSchema>; // ../contract/src/join-request.trpc.ts:33

// identity.joinRequests.dismissOffer
// Input: inline, ../contract/src/join-request.trpc.ts:52
type Input = Record<string, unknown>;
// Output: joinRequestWriteAckSchema, ../contract/src/join-request.responses.ts:63
interface Output {
  success: true;
}

// identity.joinRequests.admitAutomatically
// Input: joinRequestApiAdmitInputSchema, ../contract/src/join-request.trpc-schemas.ts:29
interface Input {
  origin?: "web" | "cli";
}
// Output: joinRequestAdmittedSchema, ../contract/src/join-request.responses.ts:35
interface Output {
  organization: {
    organizationId: string;
    name: string;
    colleagueCount: number;
  } | null;
}

// identity.joinRequests.mine
// Input: inline, ../contract/src/join-request.trpc.ts:62
type Input = unknown;
// Output: joinRequestMineSchema, ../contract/src/join-request.responses.ts:20
type Output = {
  joinRequestId: string;
  requestedAt: unknown;
  expiresAt: unknown | null;
  organizationId: string;
}[];

// identity.joinRequests.request
// Input: joinRequestApiRequestInputSchema, ../contract/src/join-request.trpc-schemas.ts:23
interface Input {
  organizationId: string;
  origin?: "web" | "cli";
}
// Output: joinRequestFiledSchema, ../contract/src/join-request.responses.ts:26
interface Output {
  joinRequestId: string;
  state: "PENDING" | "APPROVED";
}

// identity.joinRequests.withdraw
// Input: joinRequestApiWithdrawInputSchema, ../contract/src/join-request.trpc-schemas.ts:33
interface Input {
  joinRequestId: string;
}
type Output = z.infer<typeof joinRequestWriteAckSchema>; // ../contract/src/join-request.responses.ts:63

// identity.joinRequests.pending
// Input: joinRequestApiOrganizationScopeSchema, ../contract/src/join-request.trpc-schemas.ts:10
interface Input {
  organizationId: string;
}
// Output: joinRequestPendingSchema, ../contract/src/join-request.responses.ts:67
type Output = {
  joinRequestId: string;
  requestedAt: unknown;
  expiresAt: unknown | null;
  userId: string;
  name: string;
  domain: string;
  seat: "MEMBER" | "DEVELOPER";
}[];

// identity.joinRequests.approve
// Input: joinRequestApiDecisionInputSchema, ../contract/src/join-request.trpc-schemas.ts:39
interface Input {
  organizationId: string;
  joinRequestId: string;
}
type Output = z.infer<typeof joinRequestWriteAckSchema>; // ../contract/src/join-request.responses.ts:63

// identity.joinRequests.reject
type Input = z.infer<typeof joinRequestApiDecisionInputSchema>; // ../contract/src/join-request.trpc-schemas.ts:39
type Output = z.infer<typeof joinRequestWriteAckSchema>; // ../contract/src/join-request.responses.ts:63

// identity.joinRequests.joining
type Input = z.infer<typeof joinRequestApiOrganizationScopeSchema>; // ../contract/src/join-request.trpc-schemas.ts:10
// Output: joinRequestJoiningSchema, ../contract/src/join-request.responses.ts:79
interface Output {
  domainJoin: "off" | "request" | "auto";
  joinDomains: string[];
  joinerRole: "MEMBER" | "DEVELOPER";
}

// identity.joinRequests.setJoining
// Input: joinRequestApiSetJoiningInputSchema, ../contract/src/join-request.trpc-schemas.ts:46
interface Input {
  organizationId: string;
  domainJoin: "off" | "request" | "auto";
  domains?: string[];
  joinerRole?: "MEMBER" | "DEVELOPER";
}
// Output: joinRequestJoiningChangedSchema, ../contract/src/join-request.responses.ts:89
interface Output {
  previous: "off" | "request" | "auto";
  next: "off" | "request" | "auto";
  previousDomains: string[];
  nextDomains: string[];
  previousJoinerRole: "MEMBER" | "DEVELOPER";
  nextJoinerRole: "MEMBER" | "DEVELOPER";
}

// identity.joinRequests.automaticJoins
type Input = z.infer<typeof joinRequestApiOrganizationScopeSchema>; // ../contract/src/join-request.trpc-schemas.ts:10
// Output: joinRequestAutomaticJoinsSchema, ../contract/src/join-request.responses.ts:50
type Output = {
  joinRequestId: string;
  userId: string;
  name: string;
  domain: string;
  joinedAt: unknown | null;
}[];

// identity.joinRequests.getJoinAdmissions
// Input: joinRequestApiAdmissionsInputSchema, ../contract/src/join-request.trpc-schemas.ts:55
interface Input {
  organizationId: string;
  userIds: string[];
}
// Output: inline, ../contract/src/join-request.trpc.ts:102
type Output = {
  userId: string;
  domain: string;
  automatic: boolean;
}[];
```

### `twoStepVerification`

Contract `../contract/src/two-step-verification.trpc.ts:16`, router `src/transport/two-step-verification.trpc.ts:30`.

| Procedure                            | Kind     | Gate                                                                                                                                                                                    | Input                     | Output                                   |
| ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| `twoStepVerification.account`        | query    | No permission: the caller's own two-step verification, answered for the session's user id alone                                                                                         | inline                    | `twoStepAccountStandingSchema`           |
| `twoStepVerification.disable`        | mutation | No permission: the caller turning off their own two-step verification, matched on the session's user id; the password and a current code are the proof                                  | inline                    | `twoStepDisabledSchema`                  |
| `twoStepVerification.standing`       | query    | No permission: the caller asking whether an organization's second-factor requirement holds them; answered for the session's own user id, and the same shape for a member and a stranger | `organizationInputSchema` | `organizationMfaStandingSchema`          |
| `twoStepVerification.requirement`    | query    | Permission `organization:manage`                                                                                                                                                        | `organizationInputSchema` | `organizationMfaRequirementSchema`       |
| `twoStepVerification.setRequirement` | mutation | Permission `organization:manage`                                                                                                                                                        | inline                    | `organizationMfaRequirementChangeSchema` |
| `twoStepVerification.memberFactors`  | query    | Permission `organization:manage`                                                                                                                                                        | `organizationInputSchema` | inline                                   |

```typescript
// twoStepVerification.account
// Input: inline, ../contract/src/two-step-verification.trpc.ts:18
type Input = Record<string, unknown>;
// Output: twoStepAccountStandingSchema, ../contract/src/two-step-verification.ts:17
interface Output {
  offered: boolean;
  enabled: boolean;
  holdsPasskey: boolean;
  requiringOrganizations: {
    organizationId: string;
    name: string;
    slug: string;
  }[];
}

// twoStepVerification.disable
// Input: inline, ../contract/src/two-step-verification.trpc.ts:23
interface Input {
  password?: string;
  code: string;
}
// Output: twoStepDisabledSchema, ../contract/src/two-step-verification.ts:84
interface Output {
  disabled: true;
}

// twoStepVerification.standing
// Input: organizationInputSchema, ../contract/src/two-step-verification.trpc.ts:14
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof organizationMfaStandingSchema>; // ../contract/src/two-step-verification.ts:43

// twoStepVerification.requirement
type Input = z.infer<typeof organizationInputSchema>; // ../contract/src/two-step-verification.trpc.ts:14
// Output: organizationMfaRequirementSchema, ../contract/src/two-step-verification.ts:62
interface Output {
  mfaRequired: boolean;
  offered: boolean;
  connection: {
    connected: boolean;
    assertedFactors: ("pwd" | "otp" | "pin" | "saml" | "oidc" | "phw" | "hwk" | "swk" | "mfa")[];
    assertsSecondFactor: boolean;
  };
}

// twoStepVerification.setRequirement
// Input: inline, ../contract/src/two-step-verification.trpc.ts:40
interface Input {
  organizationId: string;
  mfaRequired: boolean;
}
// Output: organizationMfaRequirementChangeSchema, ../contract/src/two-step-verification.ts:69
interface Output {
  previous: boolean;
  next: boolean;
}

// twoStepVerification.memberFactors
type Input = z.infer<typeof organizationInputSchema>; // ../contract/src/two-step-verification.trpc.ts:14
// Output: z.array(organizationMemberFactorSchema) (inline, ../contract/src/two-step-verification.trpc.ts:45)
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `identity_maintenance` (aggregate `global`)

Declared at `src/eventing/identity.pipeline.ts:51`.

| Kind            | Name                        | Handles                                                                                           | Declared at                            |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| process manager | `breakGlassExpiryWarn`      | every 1 h (`BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS = 60 * 60 * 1000`); intents `warn` (outbox)       | `src/eventing/identity.pipeline.ts:71` |
| process manager | `ssoDomainReproofSweep`     | every 8 h (`SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS = 8 * 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/identity.pipeline.ts:87` |
| peer subscriber | `userRegistered`            | `lw.user.registered` from [user](../../user/README.md)                                            | `src/eventing/identity.pipeline.ts:58` |
| peer subscriber | `joinRequestInviteAccepted` | ≈ event type not read                                                                             | `src/eventing/identity.pipeline.ts:63` |
| peer subscriber | `joinRequestMembersInvited` | ≈ event type not read                                                                             | `src/eventing/identity.pipeline.ts:67` |

### Pipeline `join-requests` (aggregate `join_request`)

Declared at `src/eventing/join-request.pipeline.ts:94`. Events: `joinRequestedEventSchema`, `joinApprovedEventSchema`, `joinRejectedEventSchema`, `joinExpiredEventSchema`, `joinWithdrawnEventSchema`.

| Kind                | Name                                                                                | Handles | Declared at                                 |
| ------------------- | ----------------------------------------------------------------------------------- | ------- | ------------------------------------------- |
| command             | –                                                                                   | –       | `src/eventing/join-request.pipeline.ts:112` |
| command             | –                                                                                   | –       | `src/eventing/join-request.pipeline.ts:117` |
| command             | –                                                                                   | –       | `src/eventing/join-request.pipeline.ts:122` |
| command             | –                                                                                   | –       | `src/eventing/join-request.pipeline.ts:127` |
| command             | –                                                                                   | –       | `src/eventing/join-request.pipeline.ts:132` |
| process manager     | `joinRequestLifecycle`                                                              | –       | `src/eventing/join-request.pipeline.ts:139` |
| Postgres projection | `≈ new JoinRequestStateFoldProjection({ store: deps.joinRequestProjectionStore, })` | –       | `src/eventing/join-request.pipeline.ts:107` |

### Pipeline `sso-connections` (aggregate `sso_connection`)

Declared at `src/eventing/sso-connection.pipeline.ts:188`. Events: `connectionRegisteredEventSchema`, `domainClaimedEventSchema`, `domainClaimApprovedEventSchema`, `domainClaimRejectedEventSchema`, `connectionDiscardedEventSchema`, `verificationRequestedEventSchema`, `domainAttestedEventSchema`, `domainWithdrawnEventSchema`, `domainVerifiedEventSchema`, `domainProofWaveredEventSchema`, `domainProofLapsedEventSchema`, `domainProofRecoveredEventSchema`, `connectionActivatedEventSchema`, `connectionSuspendedEventSchema`, `connectionResumedEventSchema`, `teardownRequestedEventSchema`, `connectionTornDownEventSchema`, `connectionArrivalPolicySetEventSchema`, `connectionRenamedEventSchema`, `connectionIdpUpdatedEventSchema`, `replacementConnectionRegisteredEventSchema`, `migrationRouteSelectedEventSchema`, `migrationFinalizationStartedEventSchema`, `migrationFinalizedEventSchema`.

| Kind                | Name                                                                                 | Handles                                                         | Declared at                                   |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------- |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:225` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:230` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:235` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:240` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:245` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:250` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:255` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:260` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:265` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:270` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:275` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:280` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:285` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:290` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:295` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:300` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:305` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:310` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:315` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:320` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:325` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:330` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:335` |
| command             | –                                                                                    | –                                                               | `src/eventing/sso-connection.pipeline.ts:340` |
| process manager     | `connectionTeardown`                                                                 | –                                                               | `src/eventing/sso-connection.pipeline.ts:347` |
| process manager     | `ssoDomainProofNotification`                                                         | –                                                               | `src/eventing/sso-connection.pipeline.ts:350` |
| subscriber          | `scimDirectoryMove`                                                                  | `lw.identity.migration_finalized` from [identity](../README.md) | `src/eventing/sso-connection.pipeline.ts:353` |
| Postgres projection | `≈ new SsoConnectionStateFoldProjection({ store: deps.connectionProjectionStore, })` | –                                                               | `src/eventing/sso-connection.pipeline.ts:220` |

### Pipeline `identity` (aggregate `user_identity`)

Declared at `src/eventing/user-identity.pipeline.ts:90`. Events: `identifierAttachedEventSchema`, `identifierVerifiedEventSchema`, `identifierDeadEndedEventSchema`, `primaryChangedEventSchema`, `identifierDetachedEventSchema`, `userErasedEventSchema`, `linkProposedEventSchema`, `linkConfirmedEventSchema`, `linkRejectedEventSchema`, `mfaEnrolledEventSchema`, `mfaConfirmedEventSchema`, `mfaEnrollmentExpiredEventSchema`, `mfaDisabledEventSchema`, `backupCodeConsumedEventSchema`, `backupCodesRegeneratedEventSchema`, `mfaVerificationFailedEventSchema`.

| Kind                | Name                                                                          | Handles | Declared at                                  |
| ------------------- | ----------------------------------------------------------------------------- | ------- | -------------------------------------------- |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:119` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:124` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:129` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:134` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:139` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:144` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:149` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:154` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:164` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:169` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:174` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:179` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:184` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:189` |
| command             | –                                                                             | –       | `src/eventing/user-identity.pipeline.ts:194` |
| Postgres projection | `≈ new IdentityStateFoldProjection({ store: deps.identityProjectionStore, })` | –       | `src/eventing/user-identity.pipeline.ts:114` |
| Postgres projection | `≈ new MfaEnrollmentStateFoldProjection({ store: deps.mfaProjectionStore, })` | –       | `src/eventing/user-identity.pipeline.ts:159` |

## Configuration

| Kind   | Leaf                          | Environment variable           | Declared at                             |
| ------ | ----------------------------- | ------------------------------ | --------------------------------------- |
| secret | `internalSlackSignupsWebhook` | `SLACK_CHANNEL_SIGNUPS`        | `src/app/identity.app.ts:455`           |
| config | `ssoDomainProofDnsServers`    | `SSO_DOMAIN_PROOF_DNS_SERVERS` | `../contract/src/identity.config.ts:20` |
| config | `isSaas`                      | `IS_SAAS`                      | `../contract/src/identity.config.ts:22` |
| config | `publicBaseUrl`               | `BASE_HOST`                    | `../contract/src/identity.config.ts:24` |

<!-- readme:generated:end -->
