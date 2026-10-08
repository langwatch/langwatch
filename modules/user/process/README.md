# @langwatch/user-process

The server half of [user](../README.md). Users: profiles and avatars, account and single sign-on status, and the sign-in record.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("user").withRepositories(userRepositories).withApi(UserModule).withTransports(meRest, userAvatarRest, userTrpcTransport).withEventing(userLifecycleEventing).withTasks(…).withMigrations(…).withTransportFacts(…)`, `src/user.module.ts:13`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`UserApi`)

Portable User use cases exposed to process peers and transports.

Peers call these through the token, declared at `../contract/src/user.api.ts:70`; nothing else in this package is public.

#### `findById`

```typescript
findById(input: { id: string }): Promise<UserProfile | null>;
```

#### `updateProfile`

```typescript
updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
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

#### `createCredentialUser`

```typescript
createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser>;
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

The signup form's whole path: the mode gate, the throttle and the mint.

```typescript
registerCredentialAccount(input: RegisterCredentialAccountInput): Promise<CreatedUser>;
```

#### `hasPassword`

```typescript
hasPassword(input: UserIdInput): Promise<boolean>;
```

#### `setFirstPassword`

```typescript
setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult>;
```

#### `setOwnFirstPassword`

Fills an empty credential slot, then ends every other session.

```typescript
setOwnFirstPassword(input: SetOwnFirstPasswordInput): Promise<void>;
```

#### `changeOwnPassword`

Verifies the current password, replaces it, then ends every other session.

```typescript
changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void>;
```

#### `getPasskeyNudgeStatus`

```typescript
getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus>;
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

#### `listBrowserSessions`

What this person is signed in on, and how each session signed in.

```typescript
listBrowserSessions(input: { userId: string; currentSessionId?: string | undefined; }): Promise<UserBrowserSession[]>;
```

#### `endBrowserSession`

Ends ONE of this person's own sessions; the current one is refused.

```typescript
endBrowserSession(input: { userId: string; sessionId: string; currentSessionId?: string | undefined; }): Promise<UserBrowserSessionEnded>;
```

#### `revokeOtherBrowserSessions`

```typescript
revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void>;
```

#### `revokeAllBrowserSessions`

```typescript
revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
```

#### `deactivate`

Retires an account and ends its sessions and CLI tokens; never the last active operator.

```typescript
deactivate(input: UserLifecycleChangeInput): Promise<UserProfile>;
```

#### `reactivate`

```typescript
reactivate(input: UserLifecycleChangeInput): Promise<UserProfile>;
```

#### `deactivateAccount`

Retires an account and ends every credential family that outlives it.

```typescript
deactivateAccount(input: { userId: string; caller: UserCaller }): Promise<void>;
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

#### `ensurePersonalWorkspace`

```typescript
ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace>;
```

#### `findPersonalWorkspace`

```typescript
findPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null>;
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
type Response = z.infer<typeof meProjectResponseSchema>; // ../contract/src/user-rest.schemas.ts:11
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
type Params = z.infer<typeof userAvatarRestParamsSchema>; // ../contract/src/user-rest.schemas.ts:21
// Response: "bytes" (inline, src/transport/user-avatar.rest.ts:47)
```

## tRPC transport

### `user`

Contract `../contract/src/user.trpc.ts:47`, router `src/transport/user.trpc.ts:46`.

| Procedure                             | Kind     | Gate                                                                                                                                                         | Input                                         | Output                                 |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------- |
| `user.register`                       | mutation | Public: the signup form's own backend: it mints the account a caller would otherwise need to already hold                                                    | `userApiRegisterInputSchema`                  | `createdUserSchema`                    |
| `user.getAvatarUrl`                   | query    | No permission: a photo shows wherever a person is shown, across organizations; the object's purpose and owner kind gate it                                   | `userAvatarRestParamsSchema`                  | `userAvatarUrlSchema`                  |
| `user.getTraceExplorerTourPreference` | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userTourPreferenceSchema`             |
| `user.dismissTraceExplorerTour`       | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userTourPreferenceSchema`             |
| `user.getNotificationPreference`      | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiNotificationTopicInputSchema`         | `userNotificationPreferenceSchema`     |
| `user.setNotificationPreference`      | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiSetNotificationPreferenceInputSchema` | `userNotificationPreferenceSchema`     |
| `user.isAdmin`                        | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userApiIsAdminSchema`                 |
| `user.updateLastLogin`                | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | –                                      |
| `user.getSsoStatus`                   | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userSsoStatusSchema`                  |
| `user.getAccountInfo`                 | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userAccountInfoSchema`                |
| `user.getLinkedAccounts`              | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userApiLinkedAccountsSchema`          |
| `user.unlinkAccount`                  | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiUnlinkAccountInputSchema`             | `userApiSuccessSchema`                 |
| `user.secureAccountNudge`             | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userSecureAccountOfferSchema`         |
| `user.dismissSecureAccountNudge`      | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userApiSuccessSchema`                 |
| `user.updateName`                     | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiUpdateNameInputSchema`                | `userApiUpdatedNameSchema`             |
| `user.browserSessions`                | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | inline                                 |
| `user.endBrowserSession`              | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEndBrowserSessionInputSchema`         | `userApiBrowserSessionEndedSchema`     |
| `user.hasPassword`                    | query    | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userApiHasPasswordSchema`             |
| `user.setPassword`                    | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiSetPasswordInputSchema`               | `userApiSuccessSchema`                 |
| `user.changePassword`                 | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiChangePasswordInputSchema`            | `userApiSuccessSchema`                 |
| `user.deactivate`                     | mutation | No permission: self-service for the named account; the application enforces self-or-operator itself, against the platform operator list rather than a tenant | `userApiUserInputSchema`                      | `userApiSuccessSchema`                 |
| `user.reactivate`                     | mutation | No permission: self-service for the named account; the application enforces self-or-operator itself, against the platform operator list rather than a tenant | `userApiUserInputSchema`                      | `userApiSuccessSchema`                 |
| `user.setAvatar`                      | mutation | Permission `organization:view`                                                                                                                               | `userApiSetAvatarInputSchema`                 | `userAvatarResultSchema`               |
| `user.removeAvatar`                   | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiEmptyInputSchema`                     | `userApiSuccessSchema`                 |
| `user.requestBudgetIncrease`          | mutation | Permission `organization:view`                                                                                                                               | `userApiRequestBudgetIncreaseInputSchema`     | `userApiBudgetIncreaseRequestedSchema` |
| `user.setLastHomePath`                | mutation | No permission: operates on the session user's own account, so no tenant scope applies                                                                        | `userApiSetLastHomePathInputSchema`           | `userApiOkSchema`                      |
| `user.homePagePickerState`            | query    | Permission `organization:view`                                                                                                                               | `userApiOrganizationInputSchema`              | `userApiHomePagePickerStateSchema`     |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `user_lifecycle` (aggregate `user_account`)

Declared at `src/eventing/user-lifecycle.pipeline.ts:62`. Events: `userDeactivatedEventSchema`, `userReactivatedEventSchema`, `userRegisteredEventSchema`, `userCreatedEventSchema`, `userErasedEventSchema`.

| Kind            | Name                    | Handles                                                                                                                                              | Declared at                                  |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| command         | `recordUserDeactivated` | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:73` |
| command         | `recordUserReactivated` | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:74` |
| command         | `recordUserRegistered`  | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:75` |
| command         | `recordUserCreated`     | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:76` |
| command         | `recordUserErased`      | –                                                                                                                                                    | `src/eventing/user-lifecycle.pipeline.ts:77` |
| process manager | `userLifecycleFacts`    | every 1 d (`USER_FACTS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneFacts`, `recordErased`, `recordRegistered`, `recordCreated` (outbox) | `src/eventing/user-lifecycle.pipeline.ts:78` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                        |
| ------ | --------------- | -------------------- | ---------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/user.config.ts:6` |

<!-- readme:generated:end -->
