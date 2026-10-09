# @langwatch/auth-process

The server half of [auth](../README.md). Signing in and staying signed in: the browser session, the signed-out front door (passwords, passkeys, two-step verification, identity providers), impersonation, and the CLI's bootstrap, session and token flow.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("auth").withRepositories(authRepositories).withChannels(authChannels).withApi(AuthModule).withTransports(authTrpcTransport, signInSecurityTrpcTransport, authCliDeviceFlowRest, authRest).withEventing(authEventing).withEventing(authLifecycleEventing).withTasks(…).withTransportFacts(…)`, `src/auth.module.ts:24`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AuthApi`)

Everything the auth module does for a caller: the signed-in browser session, and the signed-out front door that stands before they have one — one interface because it is one module, meeting at the same person.

Peers call these through the token, declared at `../contract/src/auth.api.ts:105`; nothing else in this package is public.

#### `offersPasskeys`

Whether this deployment offers passkeys. `PASSKEYS_ENABLED` has one owner, this module; a peer asks rather than declaring the variable a second time.

```typescript
offersPasskeys(): boolean;
```

#### `offersTwoStepVerification`

Whether this deployment offers two-step verification (`MFA_ENROLLMENT_OPEN`, owned here). The account-security offer asks rather than redeclaring it.

```typescript
offersTwoStepVerification(): boolean;
```

#### `getSignedInWith`

How this person signed in on this session, read off the factors it recorded. `unknown` where the session recorded none or is not theirs: never a guess.

```typescript
getSignedInWith(input: { userId: string; sessionId: string }): Promise<SignedInWith>;
```

#### `issuesOwnPasswords`

Whether this deployment issues its own passwords beside a federated provider (D09, `LOCAL_PASSWORDS_ENABLED`). Email mode issues them anyway.

```typescript
issuesOwnPasswords(): boolean;
```

#### `findDialableIdentityProviderOrigins`

Identity-provider origins an operator runs on private addresses (`SSO_TRUSTED_IDP_ORIGINS`, plus the worktree simulator outside production). One owner, this module: issuer discovery asks rather than redeclaring them.

```typescript
findDialableIdentityProviderOrigins(): string[];
```

#### `findMountedSocialMethodIds`

The social providers this deployment mounted, by the id the sign-in rail dials.

```typescript
findMountedSocialMethodIds(): string[];
```

#### `getImpersonation`

The impersonation this session carries: a lapsed, half-written or self-naming claim, one whose actor is not the session's user, or a session that is gone, reads as none.

```typescript
getImpersonation(input: { sessionId: string }): Promise<SessionImpersonationState>;
```

#### `startImpersonation`

Records the {actor, subject} claims on the session (D06); the actor is its own user.

```typescript
startImpersonation(input: Readonly<{ sessionId: string; reason: string }> & Omit<SessionImpersonation, "reason">): Promise<void>;
```

#### `stopImpersonation`

Clears the claims, returning the session to its own user without ending it; idempotent.

```typescript
stopImpersonation(input: { sessionId: string }): Promise<void>;
```

#### `verifyBrowserSession`

Whether Better Auth accepts the token. Carries the RAW auth-session id an impersonation starts/stops against; a process with no sign-in door composed answers null, so callers are anonymous rather than failing.

```typescript
verifyBrowserSession(input: { headers: Headers }): Promise<BrowserSessionVerification>;
```

#### `resolveBrowserSession`

A missing, revoked, expired, or unusable session resolves as anonymous.

```typescript
resolveBrowserSession(input: { verified: VerifiedBrowserSession; }): Promise<BrowserSessionResolution>;
```

#### `getCliAccessSession`

The CLI token door's verifier: the session and its severing key, or `invalid_credentials`.

```typescript
getCliAccessSession(input: { authorization: string; }): Promise<CliAccessSession & Readonly<{ tokenKey: string }>>;
```

#### `issueProjectCliSession`

Mints the person-bound session a sign-in approved: an access token capped and locked at one project, and a rotating refresh token. Refuses when the person is no longer an active member who can view that project.

```typescript
issueProjectCliSession(input: { userId: string; organizationId: string; projectId: string; clientLabel: string; }): Promise<CliSessionTokens>;
```

#### `refreshCliSession`

Rotates a refresh token into a new pair, keeping its person and project. The old token ends; an unknown, expired or revoked one refuses as `invalid_grant`.

```typescript
refreshCliSession(input: { refreshToken: string }): Promise<CliSessionTokens>;
```

#### `findCliTokenRecordsForUser`

Every CLI token this person still holds; lapsed and unreadable ones are skipped.

```typescript
findCliTokenRecordsForUser(input: { userId: string }): Promise<CliTokenRecordEntry[]>;
```

#### `revokeCliTokens`

Revokes the named CLI tokens of this person, or every one they hold when none are named. A key outside their own index revokes nothing.

```typescript
revokeCliTokens(input: { userId: string; tokenKeys?: readonly string[] | undefined; }): Promise<{ revokedCount: number }>;
```

#### `listBrowserSessions`

What this person is signed in on, newest first, and how each signed in. The reading half of ending a session: a list with no action on it leaves somebody who lost a laptop with nothing to do.

```typescript
listBrowserSessions(input: { userId: string; currentSessionId?: string | undefined; }): Promise<readonly BrowserSessionInventoryEntry[]>;
```

#### `endBrowserSession`

End ONE of this person's sessions, found in their OWN list rather than deleted by id, so naming somebody else's session ends nothing. Ending the session doing the reading raises `session_is_current`.

```typescript
endBrowserSession(input: { userId: string; sessionId: string; currentSessionId?: string | undefined; }): Promise<{ ended: number }>;
```

#### `endBrowserSessionsForIdentifier`

Ends every one of this person's sessions one sign-in method minted, and no others.

```typescript
endBrowserSessionsForIdentifier(input: { userId: string; identifierId: string; }): Promise<{ ended: number }>;
```

#### `revokeAllBrowserSessions`

```typescript
revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
```

#### `revokeBrowserSession`

```typescript
revokeBrowserSession(input: { sessionId: string }): Promise<void>;
```

#### `revokeOtherBrowserSessions`

```typescript
revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void>;
```

#### `deactivateUser`

Retires an account: user's write refuses the last active operator, then every browser session and CLI token ends, then user records the fact. A refused write ends nothing.

```typescript
deactivateUser(input: UserLifecycleChangeInput): Promise<UserProfile>;
```

#### `deactivateAccount`

The same retirement, for oneself or by a platform operator who is not impersonating.

```typescript
deactivateAccount(input: { userId: string; caller: UserCaller }): Promise<void>;
```

#### `changeUserEmail`

Writes the address through user, then ends every session that cached the old one.

```typescript
changeUserEmail(input: UpdateUserEmailInput): Promise<UserProfile>;
```

#### `setOwnFirstPassword`

Fills an empty credential slot through user, then ends every other session (D-A1U-4).

```typescript
setOwnFirstPassword(input: SetOwnFirstPasswordInput): Promise<void>;
```

#### `changeOwnPassword`

Verifies the current password and replaces it, then ends every other session.

```typescript
changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void>;
```

#### `registerCredentialAccount`

The signup form's door (D-A1U-2): the origin, the mode, the throttle and the sign-up policy, then the address proof is spent and user mints the account.

```typescript
registerCredentialAccount(input: RegisterCredentialAccountInput): Promise<CreatedUser>;
```

#### `isWithinBudget`

Whether this attempt is inside the budget the door asked for, and how long to wait when it is not — the refusal's words name the seconds.

```typescript
isWithinBudget(input: Readonly<{ key: string; windowSeconds: number; max: number }>): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number | undefined }>>;
```

#### `route`

Where this address signs in. The decision object IS the contract.

```typescript
route(input: Readonly<{ identifier: string | null; breakGlass: boolean }>): Promise<RoutingDecision>;
```

#### `addressIsRegistered`

Whether an account already exists for this address.

```typescript
addressIsRegistered(input: Readonly<{ email: string }>): Promise<boolean>;
```

#### `assertSignUpOrigin`

The `/api/auth/*` origin rule for a sign-up that writes before any such call: `origin`, or with none `referer`, must match the configured address. Throws `auth_invalid_origin`.

```typescript
assertSignUpOrigin(input: Readonly<{ origin: string | null; referer: string | null }>): Promise<void>;
```

#### `requestSignUpVerification`

Mails a fresh confirmation link. Asking twice sends twice.

```typescript
requestSignUpVerification(input: Readonly<{ email: string }>): Promise<void>;
```

#### `requestNewAccountVerification`

Mails a sign-up confirmation link, refusing an address that already has an account. Where the installation has no email at all, it mails nothing and answers an unconfirmed proof.

```typescript
requestNewAccountVerification(input: Readonly<{ email: string; callbackUrl?: string }>): Promise<SignUpVerificationRequest>;
```

#### `sendMyAddressConfirmation`

Starts identity's PKCE ceremony for the signed-in caller's own address, metered per caller; refuses an account with no address, and an installation that cannot send email.

```typescript
sendMyAddressConfirmation(input: Readonly<{ actorId: string; email: string | null; codeChallenge: string }>): Promise<EmailIdentifierAdded>;
```

#### `getMyAddressConfirmation`

The caller's own address and whether it is confirmed; unconfirmed where it has none.

```typescript
getMyAddressConfirmation(input: Readonly<{ email: string | null }>): Promise<AddressConfirmation>;
```

#### `getSignUpEnrollment`

The methods a proven address may enrol, validating the proof without spending it; a proof that is missing, expired or another address's raises `auth_no_address_to_confirm`.

```typescript
getSignUpEnrollment(input: Readonly<{ email: string; addressProof: string }>): Promise<SignUpEnrollment>;
```

#### `getPriorSession`

Classifies the caller's own session cookie; only an expired one names its address.

```typescript
getPriorSession(input: Readonly<{ headers: Headers }>): Promise<PriorSession>;
```

#### `findSessionAmr`

The amr the session recorded; empty when the session is gone.

```typescript
findSessionAmr(input: { sessionId: string }): Promise<string[]>;
```

#### `findAssertedAmrForIdentifiers`

The distinct amr across unexpired sessions these people minted through these identifiers.

```typescript
findAssertedAmrForIdentifiers(input: { userIds: readonly string[]; identifierIds: readonly string[]; }): Promise<string[]>;
```

#### `disableTwoStepVerification`

Turns the caller's authenticator off: the code is checked first, then the password re-proof, where a mismatch raises `identity_mfa_password_invalid`.

```typescript
disableTwoStepVerification(input: { headers: Headers; password?: string | undefined; code: string; }): Promise<void>;
```

#### `claimSignUpAddressProof`

Spends the single-use proof a spent link minted for an address with no account. False for a proof that is missing, expired, spent or another address's.

```typescript
claimSignUpAddressProof(input: Readonly<{ token: string; email: string }>): Promise<boolean>;
```

#### `claimUnconfirmedSignUpAddressProof`

Spends an unconfirmed proof, minted where the installation could not send email. False for a proof that is missing, expired, spent, another address's, or once email works.

```typescript
claimUnconfirmedSignUpAddressProof(input: Readonly<{ token: string; email: string }>): Promise<boolean>;
```

#### `linkProviderAccount`

Creates the provider account a confirmed link proposal earned, through Better Auth, so the ordinary account ceremony runs; the issuer is the connection's own, else the provider's.

```typescript
linkProviderAccount(input: Readonly<{ userId: string; connectionId: string | null; provider: string; subject: string; normalizedEmail: string; }>): Promise<void>;
```

#### `readInviteLanding`

The invitation behind a code. Missing and revoked both raise `invite_not_found` to prevent code guessing; expired raises `invite_expired` for recovery (D11).

```typescript
readInviteLanding(input: Readonly<{ inviteCode: string }>): Promise<InviteLanding>;
```

#### `requestFreshInvite`

Tells the organization's admins that somebody holding a stale code is waiting. Mints nothing: letting a stale code refresh itself would make the expiry decorative.

```typescript
requestFreshInvite(input: Readonly<{ inviteCode: string }>): Promise<void>;
```

#### `resolveAuthProvider`

Which sign-in mode the deployment offers. ADR-027: reports "email" whenever the license gate denies SSO, so the page never auto-redirects to a disabled identity provider. Single source of truth.

```typescript
resolveAuthProvider(): Promise<string>;
```

#### `retireLegacySsoAccess`

Retires the federated accounts a retiring SSO connection minted, and says how many still stand. Auth owns every `Account` row, so a cutover asks rather than deleting them itself (ADR-129).

```typescript
retireLegacySsoAccess(input: LegacySsoAccessQuery): Promise<{ retired: number; remaining: number }>;
```

#### `countLegacySsoAccess`

The same reading, retiring nothing: what a finalization re-reads between its steps to see whether legacy access is actually gone.

```typescript
countLegacySsoAccess(input: LegacySsoAccessQuery): Promise<number>;
```

#### `findFederatedAccountProviders`

Which identity providers this person holds an account through, each named once. Auth owns every `Account` row, so a peer deciding something about them asks rather than reading them (ADR-129).

```typescript
findFederatedAccountProviders(input: { userId: string }): Promise<string[]>;
```

#### `changeFederatedPassword`

Changes the password the Auth0 tenant holds for this person's database identity: the current one is proven first. Main's `changeFederatedPassword`; whether a tenant is configured is decided on each call.

```typescript
changeFederatedPassword(input: AuthFederatedPasswordChange): Promise<AuthFederatedPasswordOutcome>;
```

#### `getSsoSetupStatus`

Whether this person still owes the single sign-on their address's organization pins, asked of the accounts they hold now: live, never stored.

```typescript
getSsoSetupStatus(input: { userId: string; email: string; }): Promise<{ pendingSsoSetup: boolean }>;
```

#### `getSignInSecuritySettings`

The organization's two sign-in security rules, all zero when unset.

```typescript
getSignInSecuritySettings(input: { organizationId: string }): Promise<SignInSecuritySettings>;
```

#### `saveSignInSecuritySettings`

Saves both rules, asking for the Enterprise plan only when a rule turns on from fully off, then ends every member session already past the window.

```typescript
saveSignInSecuritySettings(input: SaveSignInSecurityInput): Promise<SaveSignInSecurityResult>;
```

#### `releaseHeldAccount`

Releases a member the organization holds after a fifth consecutive lock-out.

```typescript
releaseHeldAccount(input: { organizationId: string; userId: string; actorUserId: string; }): Promise<ReleaseHeldAccountResult>;
```

#### `countUsage`

The usage report's figure (ADR-156, section 10), install-wide.

```typescript
countUsage(input: { at: number }): Promise<AuthUsageCount>;
```

#### `countUsageForMembers`

The same figure for one organization, counted over the members the caller names.

```typescript
countUsageForMembers(input: { memberUserIds: readonly string[]; at: number; }): Promise<AuthUsageCount>;
```

## REST transport

### `authCliDeviceFlowRest`

|             |                                                 |
| ----------- | ----------------------------------------------- |
| Declared at | `src/transport/auth-cli-device-flow.rest.ts:88` |
| Base URL    | none: each route's path is its address          |
| Addressing  | literal                                         |
| Credential  | project                                         |

#### `POST /api/auth/cli/device-code` · `startCliDeviceCode`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:93`.

Answers at `/api/auth/cli/device-code`, `/api/v1/auth/cli/device-code`.

```typescript
// Rawbody: "text" (inline, src/transport/auth-cli-device-flow.rest.ts:94)
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:97
type Response = unknown;
```

#### `POST /api/auth/cli/exchange` · `exchangeCliDeviceCode`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:102`.

Answers at `/api/auth/cli/exchange`, `/api/v1/auth/cli/exchange`.

```typescript
// Rawbody: "text" (inline, src/transport/auth-cli-device-flow.rest.ts:103)
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:106
type Response = unknown;
```

#### `POST /api/auth/cli/refresh` · `refreshCliDeviceSession`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:111`.

Answers at `/api/auth/cli/refresh`, `/api/v1/auth/cli/refresh`.

```typescript
// Rawbody: "text" (inline, src/transport/auth-cli-device-flow.rest.ts:112)
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:115
type Response = unknown;
```

#### `GET /api/auth/cli/lookup` · `lookupCliDeviceCode`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:125`.

Answers at `/api/auth/cli/lookup`, `/api/v1/auth/cli/lookup`.

```typescript
// Query: lookupQuerySchema, ../contract/src/auth-cli-device-flow.schemas.ts:61
interface Query {
  user_code?: string;
}
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:128
type Response = unknown;
```

#### `POST /api/auth/cli/approve` · `approveCliDeviceCode`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:133`.

Answers at `/api/auth/cli/approve`, `/api/v1/auth/cli/approve`.

```typescript
// Rawbody: "text" (inline, src/transport/auth-cli-device-flow.rest.ts:134)
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:137
type Response = unknown;
```

#### `POST /api/auth/cli/deny` · `denyCliDeviceCode`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:142`.

Answers at `/api/auth/cli/deny`, `/api/v1/auth/cli/deny`.

```typescript
// Rawbody: "text" (inline, src/transport/auth-cli-device-flow.rest.ts:143)
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:146
type Response = unknown;
```

#### `POST /api/auth/cli/logout` · `endCliDeviceSession`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:156`.

Answers at `/api/auth/cli/logout`, `/api/v1/auth/cli/logout`.

```typescript
// Rawbody: "text" (inline, src/transport/auth-cli-device-flow.rest.ts:157)
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:160
type Response = unknown;
```

#### `GET /api/auth/cli/device-approval` · `watchCliDeviceApproval`

Public: the device flow authenticates the caller inside its own handlers (the CLI half by device code and refresh token, the browser half by the session cookie the process resolves) and answers its own 401, 403 and RFC 8628 refusals. Declared at `src/transport/auth-cli-device-flow.rest.ts:170`.

Answers at `/api/auth/cli/device-approval`, `/api/v1/auth/cli/device-approval`.

```typescript
// Query: deviceApprovalQuerySchema, ../contract/src/auth-cli-device-flow.schemas.ts:64
interface Query {
  device_code: string;
}
// Response: inline, src/transport/auth-cli-device-flow.rest.ts:173
type Response = unknown;
```

### `authRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/auth.rest.ts:89`        |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `POST /api/auth/validate` · `validateProjectAuthToken`

Public: the Better Auth session and OAuth handshake; the framework manages its own session, and the session poll, the logout and the legacy token check each answer their own refusal. Declared at `src/transport/auth.rest.ts:94`.

Answers at `/api/auth/validate`.

```typescript
type Headers = z.infer<typeof VALIDATE_HEADERS>; // src/transport/auth.rest.ts:63
// Response: inline, src/transport/auth.rest.ts:97
interface Response {
  projectSlug: string;
}
```

#### `GET /api/auth/session` · `readBrowserAuthSession`

Public: the Better Auth session and OAuth handshake; the framework manages its own session, and the session poll, the logout and the legacy token check each answer their own refusal. Declared at `src/transport/auth.rest.ts:105`.

Answers at `/api/auth/session`.

```typescript
type Headers = z.infer<typeof COOKIE_HEADERS>; // src/transport/auth.rest.ts:68
// Response: inline, src/transport/auth.rest.ts:108
type Response = unknown;
```

#### `GET /api/auth/logout` · `endBrowserSessionAndRedirect`

Public: the Better Auth session and OAuth handshake; the framework manages its own session, and the session poll, the logout and the legacy token check each answer their own refusal. Declared at `src/transport/auth.rest.ts:113`.

Answers at `/api/auth/logout`.

```typescript
// Response: inline, src/transport/auth.rest.ts:115
type Response = unknown;
```

#### `POST /api/auth/logout` · `endBrowserSession`

Public: the Better Auth session and OAuth handshake; the framework manages its own session, and the session poll, the logout and the legacy token check each answer their own refusal. Declared at `src/transport/auth.rest.ts:118`.

Answers at `/api/auth/logout`.

```typescript
// Response: inline, src/transport/auth.rest.ts:120
type Response = unknown;
```

#### `ALL /api/auth/*` · `betterAuthHandshake`

Public: the Better Auth session and OAuth handshake; the framework manages its own session, and the session poll, the logout and the legacy token check each answer their own refusal. Declared at `src/transport/auth.rest.ts:128`.

Answers at `/api/auth/*`.

```typescript
// Response: inline, src/transport/auth.rest.ts:130
type Response = unknown;
```

## tRPC transport

### `auth`

Contract `../contract/src/auth.trpc.ts:40`, router `src/transport/auth.trpc.ts:89`.

| Procedure                        | Kind     | Gate                                                                                                                                                                                                                | Input                              | Output                            |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| `auth.signUpEnrollment`          | mutation | Public: returns enrollment methods only to a visitor holding this address's proof                                                                                                                                   | `signUpEnrollmentInputSchema`      | `signUpEnrollmentSchema`          |
| `auth.route`                     | mutation | Public: answers where a signed-out visitor should sign in; org-level routing only, and the engine reads no user data at all                                                                                         | `frontDoorRouteInputSchema`        | `routingDecisionSchema`           |
| `auth.requestSignUpVerification` | mutation | Public: starts a signed-out visitor's own sign-up; no tenant scope exists before an account does                                                                                                                    | `signUpVerificationInputSchema`    | `signUpVerificationRequestSchema` |
| `auth.inviteLanding`             | query    | Public: reads the invitation the caller holds the code for; the code is the authorization, and the answer names no person and no address                                                                            | `frontDoorInviteCodeInputSchema`   | `inviteLandingSchema`             |
| `auth.requestFreshInvite`        | mutation | Public: asks the holder of an expired code's organization to send a new one; mints nothing, names nobody, and is throttled per code and per IP                                                                      | `frontDoorInviteCodeInputSchema`   | `frontDoorAskedSchema`            |
| `auth.myAddressConfirmation`     | query    | No permission: reads the session user's own address confirmation state; no tenant scope is involved and no other account is reachable                                                                               | inline                             | `addressConfirmationSchema`       |
| `auth.sendMyAddressConfirmation` | mutation | No permission: sends the session user's own address confirmation; no tenant scope is involved                                                                                                                       | `frontDoorOwnAddressInputSchema`   | `frontDoorOwnAddressSentSchema`   |
| `auth.priorSession`              | query    | Public: classifies the caller's OWN session cookie so an expired session can carry its address to the sign-in screen; takes no input, names nobody the caller is not already holding a token for, and mints nothing | inline                             | `priorSessionSchema`              |
| `auth.deactivate`                | mutation | No permission: self-service for the named account; the application enforces self-or-operator itself, against the platform operator list rather than a tenant                                                        | `userApiUserInputSchema`           | `userApiSuccessSchema`            |
| `auth.browserSessions`           | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                                                                               | inline                             | inline                            |
| `auth.endBrowserSession`         | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                                                                               | `endBrowserSessionInputSchema`     | `browserSessionsEndedSchema`      |
| `auth.setPassword`               | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                                                                               | `userApiSetPasswordInputSchema`    | `userApiSuccessSchema`            |
| `auth.changePassword`            | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                                                                               | `userApiChangePasswordInputSchema` | `userApiSuccessSchema`            |
| `auth.register`                  | mutation | Public: the signup form's own backend: it mints the account a caller would otherwise need to already hold                                                                                                           | `userApiRegisterInputSchema`       | `createdUserSchema`               |

```typescript
// auth.signUpEnrollment
// Input: signUpEnrollmentInputSchema, ../contract/src/front-door.schemas.ts:49
interface Input {
  email: string;
  addressProof: string;
}
type Output = z.infer<typeof signUpEnrollmentSchema>; // ../contract/src/front-door.responses.ts:87

// auth.route
// Input: frontDoorRouteInputSchema, ../contract/src/front-door.schemas.ts:14
interface Input {
  identifier: string | null;
  breakGlass?: boolean;
}
type Output = z.infer<typeof routingDecisionSchema>; // ../../identity/contract/src/features/signin/signin-routing.ts:141

// auth.requestSignUpVerification
// Input: signUpVerificationInputSchema, ../contract/src/front-door.schemas.ts:26
interface Input {
  email: string;
  callbackUrl?: string;
}
// Output: signUpVerificationRequestSchema, ../contract/src/front-door.responses.ts:12
type Output =
  | {
      sent: true;
    }
  | {
      sent: false;
      addressProof: string;
    };

// auth.inviteLanding
// Input: frontDoorInviteCodeInputSchema, ../contract/src/front-door.schemas.ts:45
interface Input {
  inviteCode: string;
}
// Output: inviteLandingSchema, ../contract/src/front-door.responses.ts:49
interface Output {
  organizationName: string;
  inviterName: string | null;
  alreadyAccepted: boolean;
}

// auth.requestFreshInvite
type Input = z.infer<typeof frontDoorInviteCodeInputSchema>; // ../contract/src/front-door.schemas.ts:45
// Output: frontDoorAskedSchema, ../contract/src/front-door.responses.ts:25
interface Output {
  asked: boolean;
}

// auth.myAddressConfirmation
// Input: inline, ../contract/src/auth.trpc.ts:68
type Input = unknown;
// Output: addressConfirmationSchema, ../contract/src/front-door.responses.ts:62
interface Output {
  email: string | null;
  confirmed: boolean;
  canSendConfirmation: boolean;
}

// auth.sendMyAddressConfirmation
// Input: frontDoorOwnAddressInputSchema, ../contract/src/front-door.schemas.ts:35
interface Input {
  codeChallenge: string;
}
// Output: frontDoorOwnAddressSentSchema, ../contract/src/front-door.responses.ts:19
interface Output {
  sent: true;
  identifierId: string;
}

// auth.priorSession
// Input: inline, ../contract/src/auth.trpc.ts:77
type Input = unknown;
// Output: priorSessionSchema, ../contract/src/front-door.responses.ts:72
type Output =
  | {
      kind: "expired";
      email: string;
    }
  | {
      kind: "unknown";
    };

// auth.deactivate
// Input: userApiUserInputSchema, ../../user/contract/src/user.schemas.ts:58
interface Input {
  userId: string;
}
// Output: userApiSuccessSchema, ../../user/contract/src/user.responses.ts:9
interface Output {
  success: true;
}

// auth.browserSessions
// Input: inline, ../contract/src/auth.trpc.ts:90
type Input = Record<string, unknown>;
// Output: inline, ../contract/src/auth.trpc.ts:91
type Output = {
  sessionId: string;
  identifierId: string | null;
  method: string;
  secondFactorProven: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}[];

// auth.endBrowserSession
// Input: endBrowserSessionInputSchema, ../contract/src/browser-session.ts:106
interface Input {
  sessionId: string;
}
// Output: browserSessionsEndedSchema, ../contract/src/browser-session.ts:109
interface Output {
  ended: number;
}

// auth.setPassword
// Input: userApiSetPasswordInputSchema, ../../user/contract/src/user.schemas.ts:46
interface Input {
  password: string;
}
type Output = z.infer<typeof userApiSuccessSchema>; // ../../user/contract/src/user.responses.ts:9

// auth.changePassword
// Input: userApiChangePasswordInputSchema, ../../user/contract/src/user.schemas.ts:48
interface Input {
  currentPassword: string;
  newPassword: string;
}
type Output = z.infer<typeof userApiSuccessSchema>; // ../../user/contract/src/user.responses.ts:9

// auth.register
// Input: userApiRegisterInputSchema, ../../user/contract/src/user.schemas.ts:29
interface Input {
  name?: string;
  email: string;
  password: string;
  addressProof: string;
}
// Output: createdUserSchema, ../../user/contract/src/user.ts:82
interface Output {
  id: string;
}
```

### `signInSecurity`

Contract `../contract/src/sign-in-security.trpc.ts:16`, router `src/transport/sign-in-security.trpc.ts:12`.

| Procedure                | Kind     | Gate                             | Input                                   | Output                           |
| ------------------------ | -------- | -------------------------------- | --------------------------------------- | -------------------------------- |
| `signInSecurity.get`     | query    | Permission `organization:view`   | `signInSecurityOrganizationInputSchema` | `signInSecuritySettingsSchema`   |
| `signInSecurity.save`    | mutation | Permission `organization:manage` | `saveSignInSecurityInputSchema`         | `saveSignInSecurityResultSchema` |
| `signInSecurity.release` | mutation | Permission `organization:manage` | `releaseHeldAccountInputSchema`         | `releaseHeldAccountResultSchema` |

```typescript
// signInSecurity.get
// Input: signInSecurityOrganizationInputSchema, ../contract/src/sign-in-security.ts:16
interface Input {
  organizationId: string;
}
// Output: signInSecuritySettingsSchema, ../contract/src/sign-in-security.ts:13
interface Output {
  lockoutAfterFailedAttempts: number;
  lockoutMinutes: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
}

// signInSecurity.save
// Input: saveSignInSecurityInputSchema, ../contract/src/sign-in-security.ts:20
interface Input {
  lockoutAfterFailedAttempts: number;
  lockoutMinutes: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
  organizationId: string;
}
// Output: saveSignInSecurityResultSchema, ../contract/src/sign-in-security.ts:26
interface Output {
  ok: true;
  sweptSessions: number;
}

// signInSecurity.release
// Input: releaseHeldAccountInputSchema, ../contract/src/sign-in-security.ts:33
interface Input {
  organizationId: string;
  userId: string;
}
// Output: releaseHeldAccountResultSchema, ../contract/src/sign-in-security.ts:38
interface Output {
  released: boolean;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `auth_lifecycle` (aggregate `user`)

Declared at `src/eventing/auth-lifecycle.pipeline.ts:29`. Events: `sessionStartedEventSchema`, `ssoAutoAddedEventSchema`, `signedUpEventSchema`.

| Kind    | Name                   | Handles | Declared at                                  |
| ------- | ---------------------- | ------- | -------------------------------------------- |
| command | `recordSessionStarted` | –       | `src/eventing/auth-lifecycle.pipeline.ts:34` |
| command | `recordSsoAutoAdded`   | –       | `src/eventing/auth-lifecycle.pipeline.ts:35` |
| command | `recordSignedUp`       | –       | `src/eventing/auth-lifecycle.pipeline.ts:36` |

### Pipeline `sign_in_lock_maintenance` (aggregate `global`)

Declared at `src/eventing/auth.pipeline.ts:33`.

| Kind            | Name             | Handles                                                                               | Declared at                        |
| --------------- | ---------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| process manager | `signInLockReap` | every 1 h (`SIGN_IN_LOCK_REAP_INTERVAL_MS = 60 * 60 * 1000`); intents `reap` (outbox) | `src/eventing/auth.pipeline.ts:38` |

### Tasks

Run by the tasks process, before serve.

| Task                            | Class                           | Declared at                                          |
| ------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `clear-stale-pending-sso-setup` | `ClearStalePendingSsoSetupTask` | `src/tasks/clear-stale-pending-sso-setup.task.ts:11` |

## Configuration

| Kind   | Leaf                          | Environment variable                      | Declared at                                          |
| ------ | ----------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| secret | `session`                     | `NEXTAUTH_SECRET`                         | `src/app/auth.app.ts:278`                            |
| secret | `googleClientSecret`          | `GOOGLE_CLIENT_SECRET`                    | `../../../packages/secrets/src/shared-secrets.ts:52` |
| secret | `githubClientSecret`          | `GITHUB_CLIENT_SECRET`                    | `../../../packages/secrets/src/shared-secrets.ts:53` |
| secret | `gitlabClientSecret`          | `GITLAB_CLIENT_SECRET`                    | `../../../packages/secrets/src/shared-secrets.ts:54` |
| secret | `azureAdClientSecret`         | `AZURE_AD_CLIENT_SECRET`                  | `../../../packages/secrets/src/shared-secrets.ts:55` |
| secret | `auth0ClientSecret`           | `AUTH0_CLIENT_SECRET`                     | `../../../packages/secrets/src/shared-secrets.ts:56` |
| secret | `oktaClientSecret`            | `OKTA_CLIENT_SECRET`                      | `../../../packages/secrets/src/shared-secrets.ts:57` |
| secret | `cognitoClientSecret`         | `COGNITO_CLIENT_SECRET`                   | `../../../packages/secrets/src/shared-secrets.ts:58` |
| secret | `oneLoginClientSecret`        | `ONELOGIN_CLIENT_SECRET`                  | `../../../packages/secrets/src/shared-secrets.ts:59` |
| secret | `oidcClientSecret`            | `OIDC_CLIENT_SECRET`                      | `../../../packages/secrets/src/shared-secrets.ts:60` |
| secret | `auth0ManagementSecret`       | `AUTH0_MGMT_CLIENT_SECRET`                | `src/app/auth.app.ts:281`                            |
| secret | `internalSlackSignupsWebhook` | `SLACK_CHANNEL_SIGNUPS`                   | `src/app/auth.app.ts:283`                            |
| config | `sessionUrl`                  | `NEXTAUTH_URL`                            | `../contract/src/auth.config.ts:20`                  |
| config | `mfaEnrollmentOpen`           | `MFA_ENROLLMENT_OPEN`                     | `../contract/src/auth.config.ts:22`                  |
| config | `passkeysEnabled`             | `PASSKEYS_ENABLED`                        | `../contract/src/auth.config.ts:23`                  |
| config | `passkeyHandleSecret`         | `PASSKEY_HANDLE_SECRET`                   | `../contract/src/auth.config.ts:25`                  |
| config | `trustedIdpOrigins`           | `SSO_TRUSTED_IDP_ORIGINS`                 | `../contract/src/auth.config.ts:27`                  |
| config | `idpSimulatorUrl`             | `LANGWATCH_IDPSIM_URL`                    | `../contract/src/auth.config.ts:28`                  |
| config | `localPasswords`              | `LOCAL_PASSWORDS_ENABLED`                 | `../contract/src/auth.config.ts:30`                  |
| config | `auth0ManagementClientId`     | `AUTH0_MGMT_CLIENT_ID`                    | `../contract/src/auth.config.ts:35`                  |
| config | `signInProviders`             | `AUTH_PROVIDER`                           | `../contract/src/auth.config.ts:37`                  |
| config | `isSaas`                      | `IS_SAAS`                                 | `../contract/src/auth.config.ts:39`                  |
| config | `signUpMode`                  | `SIGN_UP_MODE`                            | `../contract/src/auth.config.ts:41`                  |
| config | `publicBaseUrl`               | `BASE_HOST`                               | `../contract/src/auth.config.ts:43`                  |
| config | `nodeEnvironment`             | `NODE_ENV`                                | `../contract/src/auth.config.ts:44`                  |
| config | `cliRefreshTokenTtlSeconds`   | `LANGWATCH_CLI_REFRESH_TOKEN_TTL_SECONDS` | `../contract/src/auth.config.ts:49`                  |

<!-- readme:generated:end -->
