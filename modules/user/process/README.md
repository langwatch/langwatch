# @langwatch/user-process

The server half of [user](../README.md). Users: profiles and avatars, account and single sign-on status, and the sign-in record.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("user").withRepositories(userRepositories).withChannels(userChannels).withApi(UserModule).withTransports(meRest, userAvatarRest, userTrpcTransport).withEventing(userLifecycleEventing).withTasks(…).withMigrations(…)`, `src/user.module.ts:15`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`UserApi`)

Portable User use cases exposed to process peers and transports.

Peers call these through the token, declared at `../contract/src/user.api.ts:62`; nothing else in this package is public.

#### `findById`

```typescript
findById(input: { id: string }): Promise<UserProfile | null>;
```

#### `updateProfile`

Changes the name only; an address change is `updateEmail`, behind auth's door.

```typescript
updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
```

#### `updateEmail`

Writes a normalized address and nothing else; auth's door ends the sessions after it.

```typescript
updateEmail(input: UpdateUserEmailInput): Promise<UserProfile>;
```

#### `personalCallerFor`

```typescript
personalCallerFor(input: { project: { isPersonal: boolean; ownerUserId: string | null }; callerUserId: string | undefined; }): string;
```

#### `getProfiles`

```typescript
getProfiles(input: UserProfilesInput): Promise<UserFullProfile[]>;
```

#### `getAccountInfo`

```typescript
getAccountInfo(input: UserIdInput): Promise<UserAccountInfo>;
```

#### `getSsoStatus`

```typescript
getSsoStatus(input: UserIdInput): Promise<UserSsoStatus>;
```

#### `updateLastLogin`

```typescript
updateLastLogin(input: UserIdInput): Promise<void>;
```

#### `recordSignIn`

Stamps the sign-in unless an operator is browsing as this account.

```typescript
recordSignIn(input: { caller: UserCaller }): Promise<void>;
```

#### `getTraceExplorerTourPreference`

```typescript
getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference>;
```

#### `dismissTraceExplorerTour`

```typescript
dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference>;
```

#### `getLangyCodeAccessPreference`

```typescript
getLangyCodeAccessPreference(input: UserIdInput): Promise<UserCodeAccessPreference>;
```

#### `setLangyCodeAccessPreference`

```typescript
setLangyCodeAccessPreference(input: UserIdInput & UserCodeAccessPreference): Promise<void>;
```

#### `getNotificationPreference`

The person's own answer about one topic's browser notifications.

```typescript
getNotificationPreference(input: UserNotificationTopicInput): Promise<UserNotificationPreference>;
```

#### `setNotificationPreference`

```typescript
setNotificationPreference(input: SetUserNotificationPreferenceInput): Promise<UserNotificationPreference>;
```

#### `isOperator`

Whether the account behind an id holds the platform-operator grant.

```typescript
isOperator(input: { userId: string }): Promise<boolean>;
```

#### `findByEmail`

The account an address belongs to, ignoring case; the exact address wins over case-twins.

```typescript
findByEmail(input: UserEmailInput): Promise<UserProfile | null>;
```

#### `create`

Mints a directory account with no sign-in method of its own.

```typescript
create(input: CreateUserInput): Promise<UserProfile>;
```

#### `createPasskeyUser`

Mints an account whose only sign-in method is the passkey about to be registered.

```typescript
createPasskeyUser(input: CreatePasskeyUserInput): Promise<CreatedUser>;
```

#### `adoptUnconfirmedAccount`

An address proof adopts the unfinished account on it: one transaction confirms the address and drops every sign-in method set before the proof; memberships stay (rulings 2026-10-06).

```typescript
adoptUnconfirmedAccount(input: UserEmailInput): Promise<AdoptUnconfirmedAccountOutcome>;
```

#### `registerCredentialAccount`

Mints the account auth's register door cleared, its address proof already spent (D-A1U-2).

```typescript
registerCredentialAccount(input: CredentialAccountInput): Promise<CreatedUser>;
```

#### `hasPassword`

```typescript
hasPassword(input: UserIdInput): Promise<boolean>;
```

#### `setFirstPassword`

```typescript
setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult>;
```

#### `getPasskeyOffer`

Whether to offer this person a passkey or two-step verification now, on this session.

```typescript
getPasskeyOffer(input: UserIdInput & { sessionId: string | null }): Promise<UserSecureAccountOffer>;
```

#### `dismissPasskeyNudge`

```typescript
dismissPasskeyNudge(input: UserIdInput): Promise<void>;
```

#### `findJoinOfferDismissedDomains`

The company domains this person said "no thanks" to being offered (D12).

```typescript
findJoinOfferDismissedDomains(input: UserIdInput): Promise<string[]>;
```

#### `dismissJoinOffer`

Remembers a "no thanks" for one domain; saying it twice changes nothing.

```typescript
dismissJoinOffer(input: UserIdInput & { domain: string }): Promise<void>;
```

#### `rotatePassword`

Verifies the current password and replaces it, as ONE operation.

```typescript
rotatePassword(input: RotateUserPasswordInput): Promise<UserPasswordRotationOutcome>;
```

#### `findAuth0DatabaseAccount`

The Auth0 database identity, or absent where the person holds only social ones.

```typescript
findAuth0DatabaseAccount(input: { userId: string; }): Promise<{ providerAccountId: string } | null>;
```

#### `listLinkedAccounts`

```typescript
listLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]>;
```

#### `unlinkAccount`

```typescript
unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome>;
```

#### `unlinkOwnAccount`

Removes one of the caller's own sign-in methods, refusing the last one.

```typescript
unlinkOwnAccount(input: UnlinkUserAccountInput): Promise<void>;
```

#### `deactivate`

Retires an account, never the last active operator, in one write; records no fact.

```typescript
deactivate(input: UserLifecycleChangeInput): Promise<UserProfile>;
```

#### `recordDeactivated`

Records a written retirement as user's fact, at the instant the database stamped.

```typescript
recordDeactivated(input: UserLifecycleChangeInput): Promise<void>;
```

#### `reactivate`

```typescript
reactivate(input: UserLifecycleChangeInput): Promise<UserProfile>;
```

#### `reactivateAccount`

Restores a retired account. Operators only.

```typescript
reactivateAccount(input: { userId: string; caller: UserCaller }): Promise<void>;
```

#### `setAvatar`

```typescript
setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult>;
```

#### `setOwnAvatar`

Throttles, then stores the caller's own uploaded photo.

```typescript
setOwnAvatar(input: SetOwnAvatarInput): Promise<UserAvatarResult>;
```

#### `removeAvatar`

```typescript
removeAvatar(input: RemoveUserAvatarInput): Promise<void>;
```

#### `getAvatarUrl`

A signed URL for an uploaded avatar; anything that is not one is refused as not found.

```typescript
getAvatarUrl(input: UserAvatarRestParams): Promise<UserAvatarUrl>;
```

#### `findLastHomePath`

```typescript
findLastHomePath(input: UserIdInput): Promise<string | null>;
```

#### `setLastHomePath`

```typescript
setLastHomePath(input: SetUserHomePathInput): Promise<void>;
```

#### `requestBudgetIncrease`

```typescript
requestBudgetIncrease(input: UserApiRequestBudgetIncreaseInput & { userId: string }): Promise<UserBudgetIncreaseRequested>;
```

#### `getHomePagePickerState`

```typescript
getHomePagePickerState(input: { userId: string; organizationId: string; }): Promise<UserHomePagePickerState>;
```

#### `getKeyProject`

The identity of the project a calling key belongs to, for `/api/me/project`.

```typescript
getKeyProject(input: { projectId: string }): Promise<MeProject>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(): Promise<UserUsageCount>;
```

#### `countUsageForMembers`

The same figures for one organization, counted over the members the caller names.

```typescript
countUsageForMembers(input: { memberUserIds: readonly string[] }): Promise<UserUsageCount>;
```

#### `hasAccountOnDomain`

Whether anybody with an address on this domain has an account; no address leaves.

```typescript
hasAccountOnDomain(input: { domain: string }): Promise<boolean>;
```

#### `hasAnyAccount`

Whether the installation holds any account at all; false only on a fresh install.

```typescript
hasAnyAccount(): Promise<boolean>;
```

## REST transport

### `meRest`

|             |                              |
| ----------- | ---------------------------- |
| Declared at | `src/transport/me.rest.ts:8` |
| Base URL    | `/api/me`, twin `/api/v1/me` |
| Addressing  | dated                        |
| Credential  | project                      |
| Versions    | `2026-08-07`                 |

#### `GET /project` · `getApiMeProject`

Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key targets without any further access.

Permission `project:view`. Declared at `src/transport/me.rest.ts:12`.

Answers at `/api/me/project`, `/api/v1/me/project`; also, undocumented, `/api/me/2026-08-07/project`, `/api/v1/me/2026-08-07/project`, `/api/me/latest/project`, `/api/v1/me/latest/project`.

```typescript
// Response: meProjectResponseSchema, ../contract/src/user-rest.schemas.ts:11
interface Response {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
}
```

### `userAvatarRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/user-avatar.rest.ts:36` |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `GET,HEAD /api/user-avatar/:projectId/:userAvatarId` · `readUserAvatarBytes`

Deferred scope: a key reads the avatars its own project stores, which the runtime pins; the object's purpose and owner kind are what gate the bytes. Declared at `src/transport/user-avatar.rest.ts:43`.

Answers at `/api/user-avatar/:projectId/:userAvatarId`.

```typescript
// Params: userAvatarRestParamsSchema, ../contract/src/user-rest.schemas.ts:21
interface Params {
  projectId: string;
  userAvatarId: string;
}
// Response: inline, src/transport/user-avatar.rest.ts:47
type Response = unknown;
```

## tRPC transport

### `user`

Contract `../contract/src/user.trpc.ts:40`, router `src/transport/user.trpc.ts:36`.

| Procedure                             | Kind     | Gate                                                                                                                                                           | Input                                         | Output                                 |
| ------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| `user.getAvatarUrl`                   | query    | No permission: a photo shows wherever a person is shown, across organizations; the object's purpose and owner kind gate it                                     | `userAvatarRestParamsSchema`                  | `userAvatarUrlSchema`                  |
| `user.getTraceExplorerTourPreference` | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userTourPreferenceSchema`             |
| `user.dismissTraceExplorerTour`       | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userTourPreferenceSchema`             |
| `user.getNotificationPreference`      | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiNotificationTopicInputSchema`         | `userNotificationPreferenceSchema`     |
| `user.setNotificationPreference`      | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiSetNotificationPreferenceInputSchema` | `userNotificationPreferenceSchema`     |
| `user.isAdmin`                        | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userApiIsAdminSchema`                 |
| `user.updateLastLogin`                | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | –                                      |
| `user.getSsoStatus`                   | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userSsoStatusSchema`                  |
| `user.getAccountInfo`                 | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userAccountInfoSchema`                |
| `user.getLinkedAccounts`              | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userApiLinkedAccountsSchema`          |
| `user.unlinkAccount`                  | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiUnlinkAccountInputSchema`             | `userApiSuccessSchema`                 |
| `user.secureAccountNudge`             | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userSecureAccountOfferSchema`         |
| `user.dismissSecureAccountNudge`      | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userApiSuccessSchema`                 |
| `user.updateName`                     | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiUpdateNameInputSchema`                | `userApiUpdatedNameSchema`             |
| `user.hasPassword`                    | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userApiHasPasswordSchema`             |
| `user.reactivate`                     | mutation | No permission: operator-only for the named account; the application enforces operator standing itself, against the platform operator list rather than a tenant | `userApiUserInputSchema`                      | `userApiSuccessSchema`                 |
| `user.setAvatar`                      | mutation | Permission `organization:view`                                                                                                                                 | `userApiSetAvatarInputSchema`                 | `userAvatarResultSchema`               |
| `user.removeAvatar`                   | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiEmptyInputSchema`                     | `userApiSuccessSchema`                 |
| `user.requestBudgetIncrease`          | mutation | Permission `organization:view`                                                                                                                                 | `userApiRequestBudgetIncreaseInputSchema`     | `userApiBudgetIncreaseRequestedSchema` |
| `user.setLastHomePath`                | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                          | `userApiSetLastHomePathInputSchema`           | `userApiOkSchema`                      |
| `user.homePagePickerState`            | query    | Permission `organization:view`                                                                                                                                 | `userApiOrganizationInputSchema`              | `userApiHomePagePickerStateSchema`     |

```typescript
// user.getAvatarUrl
type Input = z.infer<typeof userAvatarRestParamsSchema>; // ../contract/src/user-rest.schemas.ts:21
// Output: userAvatarUrlSchema, ../contract/src/user.ts:258
interface Output {
  url: string;
}

// user.getTraceExplorerTourPreference
// Input: userApiEmptyInputSchema, ../contract/src/user.schemas.ts:15
type Input = Record<string, unknown>;
// Output: userTourPreferenceSchema, ../contract/src/user.ts:183
interface Output {
  dismissed: boolean;
  dismissedAt: unknown | null;
}

// user.dismissTraceExplorerTour
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
type Output = z.infer<typeof userTourPreferenceSchema>; // ../contract/src/user.ts:183

// user.getNotificationPreference
// Input: userApiNotificationTopicInputSchema, ../contract/src/user.schemas.ts:18
interface Input {
  topic: "langy";
}
// Output: userNotificationPreferenceSchema, ../contract/src/user.ts:203
interface Output {
  topic: "langy";
  choice: "enabled" | "declined" | null;
}

// user.setNotificationPreference
// Input: userApiSetNotificationPreferenceInputSchema, ../contract/src/user.schemas.ts:21
interface Input {
  topic: "langy";
  choice: "enabled" | "declined";
}
type Output = z.infer<typeof userNotificationPreferenceSchema>; // ../contract/src/user.ts:203

// user.isAdmin
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
// Output: userApiIsAdminSchema, ../contract/src/user.responses.ts:15
interface Output {
  isAdmin: boolean;
}

// user.updateLastLogin
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15

// user.getSsoStatus
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
// Output: userSsoStatusSchema, ../contract/src/user.ts:180
interface Output {
  pendingSsoSetup: boolean;
}

// user.getAccountInfo
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
// Output: userAccountInfoSchema, ../contract/src/user.ts:177
interface Output {
  createdAt: unknown;
}

// user.getLinkedAccounts
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
// Output: userApiLinkedAccountsSchema, ../contract/src/user.responses.ts:32
type Output = {
  id: string;
  provider: string;
  providerAccountId: string;
}[];

// user.unlinkAccount
// Input: userApiUnlinkAccountInputSchema, ../contract/src/user.schemas.ts:44
interface Input {
  accountId: string;
}
// Output: userApiSuccessSchema, ../contract/src/user.responses.ts:9
interface Output {
  success: true;
}

// user.secureAccountNudge
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
// Output: userSecureAccountOfferSchema, ../contract/src/user.ts:350
interface Output {
  offer: boolean;
  passkey: boolean;
  twoStep: boolean;
  signedInWith: "password" | "passkey" | "federated" | "unknown";
}

// user.dismissSecureAccountNudge
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
type Output = z.infer<typeof userApiSuccessSchema>; // ../contract/src/user.responses.ts:9

// user.updateName
// Input: userApiUpdateNameInputSchema, ../contract/src/user.schemas.ts:27
interface Input {
  name: string;
}
// Output: userApiUpdatedNameSchema, ../contract/src/user.responses.ts:21
interface Output {
  name: string;
}

// user.hasPassword
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
// Output: userApiHasPasswordSchema, ../contract/src/user.responses.ts:18
interface Output {
  hasPassword: boolean;
}

// user.reactivate
// Input: userApiUserInputSchema, ../contract/src/user.schemas.ts:58
interface Input {
  userId: string;
}
type Output = z.infer<typeof userApiSuccessSchema>; // ../contract/src/user.responses.ts:9

// user.setAvatar
// Input: userApiSetAvatarInputSchema, ../contract/src/user.schemas.ts:60
interface Input {
  organizationId: string;
  imageDataUrl: string;
}
// Output: userAvatarResultSchema, ../contract/src/user.ts:254
interface Output {
  image: string;
}

// user.removeAvatar
type Input = z.infer<typeof userApiEmptyInputSchema>; // ../contract/src/user.schemas.ts:15
type Output = z.infer<typeof userApiSuccessSchema>; // ../contract/src/user.responses.ts:9

// user.requestBudgetIncrease
// Input: userApiRequestBudgetIncreaseInputSchema, ../contract/src/user.schemas.ts:73
interface Input {
  organizationId: string;
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
  period?: string;
  message?: string;
}
// Output: userApiBudgetIncreaseRequestedSchema, ../contract/src/user.responses.ts:35
interface Output {
  ok: true;
  sentTo: string;
}

// user.setLastHomePath
// Input: userApiSetLastHomePathInputSchema, ../contract/src/user.schemas.ts:83
interface Input {
  path: string | null;
}
// Output: userApiOkSchema, ../contract/src/user.responses.ts:12
interface Output {
  ok: true;
}

// user.homePagePickerState
// Input: userApiOrganizationInputSchema, ../contract/src/user.schemas.ts:70
interface Input {
  organizationId: string;
}
// Output: userApiHomePagePickerStateSchema, ../contract/src/user.responses.ts:40
interface Output {
  lastHomePath: string | null;
  firstProjectSlug: string | null;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `user_lifecycle` (aggregate `user_account`)

Declared at `src/eventing/user-lifecycle.pipeline.ts:57`. Events: `userDeactivatedEventSchema`, `userReactivatedEventSchema`, `userRegisteredEventSchema`, `userCreatedEventSchema`, `userErasedEventSchema`.

| Kind            | Name                    | Handles                                                                                                                                              | Declared at                                  |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| command         | `recordUserDeactivated` | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:68` |
| command         | `recordUserReactivated` | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:69` |
| command         | `recordUserRegistered`  | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:70` |
| command         | `recordUserCreated`     | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:71` |
| command         | `recordUserErased`      | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:72` |
| process manager | `userLifecycleFacts`    | every 1 d (`USER_FACTS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneFacts`, `recordErased`, `recordRegistered`, `recordCreated` (outbox) | `src/eventing/user-lifecycle.pipeline.ts:73` |

## Configuration

| Kind   | Leaf                | Environment variable      | Declared at                         |
| ------ | ------------------- | ------------------------- | ----------------------------------- |
| config | `publicBaseUrl`     | `BASE_HOST`               | `../contract/src/user.config.ts:13` |
| config | `passkeysEnabled`   | `PASSKEYS_ENABLED`        | `../contract/src/user.config.ts:15` |
| config | `mfaEnrollmentOpen` | `MFA_ENROLLMENT_OPEN`     | `../contract/src/user.config.ts:16` |
| config | `localPasswords`    | `LOCAL_PASSWORDS_ENABLED` | `../contract/src/user.config.ts:17` |

<!-- readme:generated:end -->
