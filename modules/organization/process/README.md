# @langwatch/organization-process

The server half of [organization](../README.md). Organisations and who is in them: membership, invites, teams, groups and personal workspaces, and the sign-up checks that create them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("organization").withRepositories(organizationRepositories).withApi(OrganizationModule).withTransports(organizationTrpcTransport, inviteTrpcTransport, teamTrpcTransport, groupTrpcTransport, licenseEnforcementTrpcTransport, personalWorkspaceFeaturesTrpcTransport, organizationManagementRest, organizationsProvisioningRest, groupsRest, teamsRest).withTransportFacts(…).withEventing(seatLimitEventing).withEventing(organizationLifecycleEventing).withEventing(organizationAuditEventing).withMigrations(…).withTasks(…)`, `src/organization.module.ts:31`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`OrganizationApi`)

Peers call these through the token, declared at `../contract/src/organization.api.ts:239`; nothing else in this package is public.

#### `createAndAssign`

```typescript
createAndAssign(input: Readonly<{ orgName?: string; phoneNumber?: string; signUpData?: Record<string, unknown>; primaryIntent?: OrganizationIntent | null; userDisplayName?: string | null; }>, by: OrganizationCaller): Promise<{ organization: { id: string; name: string }; team: { id: string; slug: string; name: string }; }>;
```

#### `checkSignUp`

Whether this address may create a new account on the installation (`SIGN_UP_MODE`, `SIGN_UP_ALLOWED_DOMAINS`). The default settings answer without a read; `hasAnyAccount` (the caller's read) lets the first account bootstrap an invite-only one.

```typescript
checkSignUp(input: Readonly<{ email: string; hasAnyAccount: boolean }>): Promise<SignUpVerdict>;
```

#### `getPendingInvitation`

The invitation waiting for a caller who belongs to no organization yet, on an installation where accounts are created by invitation. Only addresses the account has proven count.

```typescript
getPendingInvitation(by: OrganizationCaller): Promise<PendingInvitationForCaller>;
```

#### `listPendingInvitationsForCaller`

The oldest pending invitation on each address the caller has PROVEN, in any organization (ADR-171 v6). Carries the invitation code, so verified addresses only.

```typescript
listPendingInvitationsForCaller(by: OrganizationCaller): Promise<PendingInvitationsForCaller>;
```

#### `deleteMember`

```typescript
deleteMember(input: Readonly<{ organizationId: string; userId: string }>, by: OrganizationCaller | null): Promise<void>;
```

#### `setMemberDisabled`

```typescript
setMemberDisabled(input: Readonly<{ organizationId: string; userId: string; disabled: boolean }>, by: OrganizationCaller | null): Promise<void>;
```

#### `assertRemovalKeepsAnAdministrator`

Refuses when taking this member out would leave the organization with no administrator who can sign in. Asked by a caller that writes the membership row itself — a directory deprovision — before it does.

```typescript
assertRemovalKeepsAnAdministrator(input: Readonly<{ organizationId: string; userId: string }>): Promise<void>;
```

#### `getAllForUser`

```typescript
getAllForUser(input: Readonly<{ isDemo: boolean; demoProjectUserId: string; demoProjectId: string }>, by: OrganizationCaller): Promise<FullyLoadedOrganization[]>;
```

#### `readGuidedOnboardingState`

The guided-onboarding record the organization carries, in the column the organization owns. An organization nobody has onboarded reads as the empty state with no variant; an unknown one refuses by name.

```typescript
readGuidedOnboardingState(input: { organizationId: string }): Promise<GuidedOnboardingRecord>;
```

#### `getJoinSetting`

How colleagues on a matching domain get in, in the columns the organization owns; identity's join ledger reads and writes it here.

```typescript
getJoinSetting(input: { organizationId: string }): Promise<OrganizationJoinSetting>;
```

#### `saveJoinSetting`

```typescript
saveJoinSetting(input: { organizationId: string; setting: OrganizationJoinSetting; }): Promise<void>;
```

#### `getSessionPolicy`

The CLI/device session ceiling in days; zero or an unknown organization is unbounded.

```typescript
getSessionPolicy(input: { organizationId: string }): Promise<{ maxSessionDurationDays: number }>;
```

#### `saveSessionPolicy`

```typescript
saveSessionPolicy(input: { organizationId: string; maxSessionDurationDays: number; }): Promise<void>;
```

#### `getSignInSecurityPolicy`

This organization's sign-in security rules (GAC-09, GAC-10). Throws OrganizationNotFoundError.

```typescript
getSignInSecurityPolicy(input: { organizationId: string }): Promise<SignInSecurityPolicy>;
```

#### `updateSignInSecurityPolicy`

```typescript
updateSignInSecurityPolicy(input: { organizationId: string; policy: SignInSecurityPolicy; }): Promise<void>;
```

#### `findSignInSecurityPoliciesForUser`

The rules of the organizations this person belongs to and is not disabled in; read on every session.

```typescript
findSignInSecurityPoliciesForUser(input: { userId: string }): Promise<SignInSecurityPolicy[]>;
```

#### `findConfiguredSignInSecurityPolicies`

Cross-tenant by design: every organization that set any rule, for an address resolving to nobody and the session path's early-out.

```typescript
findConfiguredSignInSecurityPolicies(): Promise<SignInSecurityPolicy[]>;
```

#### `getPricing`

The organization's pricing model and currency, for workers deciding on its behalf. A system read: no caller. An unknown organization has no model and the schema's default currency.

```typescript
getPricing(input: Readonly<{ organizationId: string }>): Promise<{ pricingModel: PricingModel | null; currency: "USD" | "EUR" }>;
```

#### `getDatasetLimits`

The per-file dataset limit an operator set for the organization, in bytes. A system read: no caller. Null when none is set, and for an unknown organization.

```typescript
getDatasetLimits(input: Readonly<{ organizationId: string }>): Promise<{ attachmentMaxBytes: number | null }>;
```

#### `isInstantEvalsOptedIn`

Whether the organization switched Instant Evals on itself; instant-eval's gate reads it.

```typescript
isInstantEvalsOptedIn(input: { organizationId: string }): Promise<boolean>;
```

#### `recordInstantEvalsOptIn`

The organization's own Instant Evals consent; a second call keeps the first record.

```typescript
recordInstantEvalsOptIn(input: { organizationId: string; userId: string }): Promise<void>;
```

#### `writeGuidedOnboardingState`

Replaces the record, leaving every other sign-up answer where it is.

```typescript
writeGuidedOnboardingState(input: { organizationId: string; record: GuidedOnboardingRecord; }): Promise<GuidedOnboardingRecord>;
```

#### `updateSettings`

`by` is the member saving it, or nothing for an organization key with no member.

```typescript
updateSettings(input: UpdateOrganizationSettingsInput, by: Readonly<{ id: string }> | null): Promise<UpdateOrganizationSettingsResult>;
```

#### `getSettings`

```typescript
getSettings(input: { organizationId: string }): Promise<organizationModule.OrganizationSettings>;
```

#### `listTeams`

```typescript
listTeams(input: ListOrganizationTeamsInput): Promise<OrganizationTeamPage>;
```

#### `listMembers`

```typescript
listMembers(input: { organizationId: string; includeDisabled?: boolean; offset?: number; limit?: number; }): Promise<{ members: OrganizationRestMemberSummary[]; totalCount: number }>;
```

#### `getMember`

```typescript
getMember(input: { organizationId: string; userId: string; }): Promise<OrganizationRestMemberSummary & { teams: OrganizationRestMemberTeamBinding[] }>;
```

#### `updateMember`

Changes exactly one of a member's role or disabled status, and reads the member back.

```typescript
updateMember(input: Readonly<{ organizationId: string; userId: string; role?: OrganizationUserRole; disabled?: boolean; }>, by: OrganizationCaller | null): Promise<OrganizationUpdatedMember>;
```

#### `createForProvisioning`

```typescript
createForProvisioning(input: { name: string; slug?: string }): Promise<{ organization: { id: string; name: string }; team: { id: string; slug: string; name: string }; }>;
```

#### `listProvisioningSummaries`

```typescript
listProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]>;
```

#### `findProvisioningSummary`

```typescript
findProvisioningSummary(organizationId: string): Promise<OrganizationProvisioningSummary | null>;
```

#### `getProvisioningSummary`

The self-hosted provisioning door's read: one organization's summary, or `not_found`.

```typescript
getProvisioningSummary(organizationId: string): Promise<OrganizationProvisioningSummary>;
```

#### `deleteProvisionedOrganization`

```typescript
deleteProvisionedOrganization(input: { organizationId: string }): Promise<void>;
```

#### `findSelfHostedCustomers`

Every organization an operator marked as a self-hosted licence customer.

```typescript
findSelfHostedCustomers(): Promise<{ organizationId: string; organizationName: string }[]>;
```

#### `findFoundedBetween`

Organizations founded in [fromMs, toMs], each with its founder and the founder's memberships up to `followUntilMs` (D12's sign-up health).

```typescript
findFoundedBetween(input: { fromMs: number; toMs: number; followUntilMs: number; }): Promise<OrganizationFounding[]>;
```

#### `findRepresentatives`

The organization's longest-standing member, the person a customer's CRM traits are written through, with its name; empty where it has no member.

```typescript
findRepresentatives(input: { organizationId: string; }): Promise<{ userId: string; organizationName: string }[]>;
```

#### `getMemberAccessBreakdown`

The authorization feature's per-member access breakdown, organization's own door onto it.

```typescript
getMemberAccessBreakdown(input: Readonly<{ organizationId: string; userId: string; userName: string | null; userEmail: string | null; }>): Promise<AuthzAccessBreakdownOutput>;
```

#### `createMembership`

Admits somebody on the seat the licence leaves free (ADR-129, ADR-171, admission-seat.ts): a MEMBER's grant lands now with `admittedBy` or an SSO arrival resumes it; a DEVELOPER or Lite (EXTERNAL) row is the whole admission, held `pending` when no seat is free. `seat` is the row's role; `"already-present"` is a concurrent callback or a retry, answered from the row there.

```typescript
createMembership(input: Readonly<{ organizationId: string; userId: string; admittedBy?: Readonly<{ actor: LedgerActor; commandId: string }>; /** The seat the admitting caller decided (ADR-171 v6); absent is the joiner seat. */ seat?: "MEMBER" | "DEVELOPER"; /** Where a join request was made, written on the Developer admission audit row. */ origin?: OrganizationJoinOrigin; }>): Promise<OrganizationAdmission>;
```

#### `isMember`

```typescript
isMember(input: Readonly<{ organizationId: string; userId: string }>): Promise<boolean>;
```

#### `memberOrganizationIds`

```typescript
memberOrganizationIds(input: Readonly<{ userId: string; organizationIds: string[] }>): Promise<string[]>;
```

#### `organizationIdsForMember`

Every organization this person belongs to. Asked by a peer deciding something about the person rather than about a listed organization.

```typescript
organizationIdsForMember(input: Readonly<{ userId: string }>): Promise<string[]>;
```

#### `findBySsoDomain`

The organization an email domain is claimed by for SSO, or null when none claims it.

```typescript
findBySsoDomain(input: Readonly<{ domain: string }>): Promise<{ id: string; name: string; ssoProvider: string | null } | null>;
```

#### `createSsoDomainMembership`

Writes the plain MEMBER row an SSO domain auto-join admits (ADR-116); the caller grants the seat itself. A row already there is `"already-present"`: a concurrent callback.

```typescript
createSsoDomainMembership(input: Readonly<{ organizationId: string; userId: string }>): Promise<"created" | "already-present">;
```

#### `countMembershipsForUser`

How many organizations this person has a membership row in, disabled ones included.

```typescript
countMembershipsForUser(input: Readonly<{ userId: string }>): Promise<number>;
```

#### `getOrganizationMembers`

```typescript
getOrganizationMembers(input: GetOrganizationMembersInput): Promise<string[]>;
```

#### `getOldestTeamId`

```typescript
getOldestTeamId(input: GetOldestTeamInput): Promise<string>;
```

#### `getOrganizationIdByTeamId`

Throws `organization_not_found_for_team` when no organization owns the team.

```typescript
getOrganizationIdByTeamId(input: GetOrganizationIdByTeamIdInput): Promise<string>;
```

#### `findOrganizationWithMembers`

```typescript
findOrganizationWithMembers(input: Readonly<{ organizationId: string; includeDeactivated: boolean }>, by: OrganizationCaller): Promise<OrganizationWithMembersAndTheirTeams | null>;
```

#### `findMemberById`

```typescript
findMemberById(input: Readonly<{ organizationId: string; userId: string }>, by: OrganizationCaller): Promise<OrganizationMemberWithUser | null>;
```

#### `getAllMembers`

```typescript
getAllMembers(input: Readonly<{ organizationId: string }>): Promise<User[]>;
```

#### `findMembersIncludingDeactivated`

Every member row, disabled and deactivated included: governance's identity match reads it.

```typescript
findMembersIncludingDeactivated(input: Readonly<{ organizationId: string }>): Promise<User[]>;
```

#### `findMembersWithDepartments`

Every member's department column with their name (main `department.service.ts:112-119`).

```typescript
findMembersWithDepartments(input: { organizationId: string }): Promise< { userId: string; departmentId: string | null; user: { name: string | null; email: string | null }; }[] >;
```

#### `assignMemberDepartment`

Points one member at a department (or clears it), then has governance date the link; false when no such member (main `department.service.ts:229-282`).

```typescript
assignMemberDepartment(input: { organizationId: string; userId: string; departmentId: string | null; }): Promise<boolean>;
```

#### `findMemberDepartments`

Each named member's department column (main `directoryDepartmentSync.service.ts:207-210`).

```typescript
findMemberDepartments(input: { organizationId: string; userIds: readonly string[]; }): Promise<{ userId: string; departmentId: string | null }[]>;
```

#### `findMemberTeamIds`

The organization's teams the member belongs to (main `aiToolEntry.service.ts:1278`).

```typescript
findMemberTeamIds(input: { organizationId: string; userId: string }): Promise<string[]>;
```

#### `findTeamsWithDepartments`

Every team with its department (main `department.service.ts:121-125`).

```typescript
findTeamsWithDepartments(input: { organizationId: string; }): Promise<{ id: string; name: string; departmentId: string | null }[]>;
```

#### `assignTeamDepartment`

Points one team at a department, or clears it; false when no such team (main `department.service.ts:320-330`).

```typescript
assignTeamDepartment(input: { organizationId: string; teamId: string; departmentId: string | null; }): Promise<boolean>;
```

#### `getInvitedMemberIds`

The organization's members and which of them an invitation brought; explains, never grants.

```typescript
getInvitedMemberIds(input: Readonly<{ organizationId: string }>): Promise<OrganizationInvitedMemberIds>;
```

#### `findAdministrators`

Every administrator who can still sign in, with what to call them. Asked by a peer choosing somebody for a decision of an administrator's weight — a way back in, today — which an id on its own cannot be made.

```typescript
findAdministrators(input: Readonly<{ organizationId: string }>): Promise<OrganizationAdministrator[]>;
```

#### `findUserOrgRoleByTeamId`

```typescript
findUserOrgRoleByTeamId(input: Readonly<{ userId: string; teamId: string }>): Promise<OrganizationUserRole | null>;
```

#### `findPrimaryIntent`

```typescript
findPrimaryIntent(organizationId: string): Promise<OrganizationIntent | null>;
```

#### `ensurePersonalWorkspace`

```typescript
ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace>;
```

#### `ensurePersonalWorkspace`

```typescript
ensurePersonalWorkspace(input: Omit<PersonalWorkspaceInput, "userId">, by: OrganizationCaller): Promise<EnsuredPersonalWorkspace>;
```

#### `getPersonalWorkspace`

Throws `TeamNotFoundError` when the caller has no personal workspace in this organization.

```typescript
getPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace>;
```

#### `getPersonalWorkspace`

```typescript
getPersonalWorkspace(input: Omit<FindPersonalWorkspaceInput, "userId">, by: OrganizationCaller): Promise<PersonalWorkspace>;
```

#### `updateTeamMemberRole`

```typescript
updateTeamMemberRole(input: Readonly<{ teamId: string; userId: string; role: string; customRoleId?: string }>, by: OrganizationCaller): Promise<void>;
```

#### `changeMemberRole`

```typescript
changeMemberRole(input: Readonly<{ organizationId: string; userId: string; role: OrganizationUserRole; teamRoleUpdates?: { teamId: string; userId: string; role: string; customRoleId?: string }[]; planUser?: { id: string; name?: string | null; email?: string | null }; }>, by: OrganizationCaller | null): Promise<{ teamsLeftWithoutAdmin: { id: string; name: string }[] }>;
```

#### `getAuditLogs`

```typescript
getAuditLogs(input: Readonly<{ organizationId: string; projectId?: string; userId?: string; pageOffset: number; pageSize: number; action?: string; startDate?: number; endDate?: number; targetKind?: string; targetId?: string; }>): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }>;
```

#### `getBillingProfile`

```typescript
getBillingProfile(input: GetOrganizationBillingProfileInput): Promise<OrganizationBillingProfile>;
```

#### `getWithAdministrators`

Main's `findWithAdmins`, for the usage-limit mails; throws `OrganizationNotFoundError`.

```typescript
getWithAdministrators(input: Readonly<{ organizationId: string }>): Promise<OrganizationWithAdministrators>;
```

#### `findSupportContact`

The support contact set in settings, else the longest-seated enabled administrator's email.

```typescript
findSupportContact(input: Readonly<{ organizationId: string }>): Promise<string | null>;
```

#### `getTeam`

```typescript
getTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam>;
```

#### `findPersonalTeamOwners`

Main `personal-team-scope.ts:78-81`: the personal teams among the ids, archived too.

```typescript
findPersonalTeamOwners(input: Readonly<{ organizationId: string; teamIds: readonly string[] }>): Promise<{ teamId: string; ownerUserId: string | null }[]>;
```

#### `createTeam`

```typescript
createTeam(input: CreateOrganizationTeamInput): Promise<OrganizationTeam>;
```

#### `addTeamMember`

```typescript
addTeamMember(input: AddOrganizationTeamMemberInput): Promise<void>;
```

#### `getTeamById`

```typescript
getTeamById(input: GetOrganizationTeamByIdInput): Promise<OrganizationTeam>;
```

#### `getTeamBySlugForMember`

```typescript
getTeamBySlugForMember(input: Omit<GetOrganizationTeamBySlugForMemberInput, "userId">, by: OrganizationCaller): Promise<OrganizationTeam>;
```

#### `getTeamWithMembers`

```typescript
getTeamWithMembers(input: Omit<GetOrganizationTeamWithMembersInput, "callerUserId">, by: OrganizationCaller): Promise<OrganizationTeamWithMembers>;
```

#### `listTeamsWithMembers`

```typescript
listTeamsWithMembers(input: Omit<ListOrganizationTeamsWithMembersInput, "callerUserId">, by: OrganizationCaller): Promise<OrganizationTeamWithMembers[]>;
```

#### `listTeamAccess`

```typescript
listTeamAccess(input: ListOrganizationTeamAccessInput): Promise<OrganizationTeamAccess[]>;
```

#### `createTeamWithMembers`

```typescript
createTeamWithMembers(input: Omit<CreateOrganizationTeamWithMembersInput, "actor" | "caller">, by: OrganizationCaller): Promise<OrganizationTeam>;
```

#### `updateTeamWithMembers`

```typescript
updateTeamWithMembers(input: Omit<UpdateOrganizationTeamWithMembersInput, "actor" | "caller">, by: OrganizationCaller): Promise<void>;
```

#### `archiveTeam`

```typescript
archiveTeam(input: GetOrganizationTeamInput): Promise<OrganizationTeam>;
```

#### `removeTeamMember`

```typescript
removeTeamMember(input: Omit<RemoveOrganizationTeamMemberInput, "actor">, by: OrganizationCaller): Promise<void>;
```

#### `listGroups`

```typescript
listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage>;
```

#### `getGroup`

```typescript
getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails>;
```

#### `listGroupsForMember`

```typescript
listGroupsForMember(input: ListMemberOrganizationGroupsInput): Promise<OrganizationGroupSummary[]>;
```

#### `createGroup`

```typescript
createGroup(input: Omit<CreateOrganizationGroupInput, "actor" | "caller">, by: OrganizationCaller): Promise<OrganizationGroup>;
```

#### `renameGroup`

```typescript
renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup>;
```

#### `deleteGroup`

```typescript
deleteGroup(input: Omit<DeleteOrganizationGroupInput, "actor">, by: OrganizationCaller): Promise<void>;
```

#### `addGroupMember`

```typescript
addGroupMember(input: ChangeOrganizationGroupMemberInput, by: OrganizationCaller): Promise<void>;
```

#### `removeGroupMember`

```typescript
removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void>;
```

#### `listGroupBindings`

```typescript
listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupGrant[]>;
```

#### `addGroupGrant`

```typescript
addGroupGrant(input: Omit<AddOrganizationGroupGrantInput, "actor" | "caller">, by: OrganizationCaller): Promise<OrganizationGroupGrant>;
```

#### `removeGroupGrant`

```typescript
removeGroupGrant(input: Omit<RemoveOrganizationGroupGrantInput, "actor">, by: OrganizationCaller): Promise<void>;
```

#### `applyGroupEdits`

```typescript
applyGroupEdits(input: Omit<ApplyOrganizationGroupEditsInput, "actor" | "caller">, by: OrganizationCaller): Promise<void>;
```

#### `resolveBindingScopeNames`

```typescript
resolveBindingScopeNames(input: Readonly<{ organizationId: string; bindings: readonly OrganizationGroupGrant[] }>): Promise<ReadonlyMap<string, string>>;
```

#### `getPersonalWorkspaceFeatures`

```typescript
getPersonalWorkspaceFeatures(input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">, by: OrganizationCaller): Promise<PersonalFeatures>;
```

#### `enableAllPersonalWorkspaceFeatures`

```typescript
enableAllPersonalWorkspaceFeatures(input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">, by: OrganizationCaller): Promise<PersonalFeatures>;
```

#### `disableAllPersonalWorkspaceFeatures`

```typescript
disableAllPersonalWorkspaceFeatures(input: Omit<PersonalWorkspaceFeaturesInput, "callerUserId">, by: OrganizationCaller): Promise<PersonalFeatures>;
```

#### `listVisibleOrganizations`

Every organization the caller can reach, redacted for them.

```typescript
listVisibleOrganizations(input: Readonly<{ isDemo: boolean }>, by: OrganizationCaller): Promise<FullyLoadedOrganization[]>;
```

#### `getScopeGraph`

The caller's scope graph, narrowed; the tRPC host versions it.

```typescript
getScopeGraph(by: OrganizationCaller): Promise<ScopeGraphOrganization[]>;
```

#### `getOrganizationWithMembersForPicker`

One organization with its members, addresses redacted for a non-administrator.

```typescript
getOrganizationWithMembersForPicker(input: Readonly<{ organizationId: string; includeDeactivated: boolean }>, by: OrganizationCaller): Promise<OrganizationWithMembersAndTheirTeams>;
```

#### `getDirectoryCounts`

The Directory's tab badges: how many of each, never the lists.

```typescript
getDirectoryCounts(input: Readonly<{ organizationId: string }>): Promise<OrganizationDirectoryCounts>;
```

#### `getMemberOrRefuse`

One member's full record, refused by name where there is none.

```typescript
getMemberOrRefuse(input: Readonly<{ organizationId: string; userId: string }>, by: OrganizationCaller): Promise<OrganizationMemberWithUser>;
```

#### `createInvitations`

```typescript
createInvitations(input: OrganizationApiCreateInvitationsInput, by: OrganizationCaller): Promise<OrganizationInviteCreated[]>;
```

#### `revokeInvitation`

```typescript
revokeInvitation(input: OrganizationApiInviteScope): Promise<void>;
```

#### `resendInvitation`

```typescript
resendInvitation(input: OrganizationApiInviteScope): Promise<OrganizationInviteResent>;
```

#### `extendInvitation`

A fresh expiry on the same code, and nothing mailed: the link already sent works again.

```typescript
extendInvitation(input: OrganizationApiInviteScope): Promise<OrganizationInviteExtended>;
```

#### `listPendingInvitations`

```typescript
listPendingInvitations(input: Readonly<{ organizationId: string }>): Promise<OrganizationListedInvite[]>;
```

#### `acceptInvitation`

```typescript
acceptInvitation(input: Readonly<{ inviteCode: string }>, by: OrganizationCaller): Promise<OrganizationInviteAccepted>;
```

#### `applyPendingInvite`

Applies the PENDING invitation this address already holds here, for a caller that never saw an invitation code. Its role and team assignments replace a default membership entirely.

```typescript
applyPendingInvite(input: Readonly<{ userId: string; organizationId: string; email: string }>): Promise<OrganizationPendingInviteApplied>;
```

#### `checkInvitesWithinCaller`

Refuses, writing nothing, invitations that would confer more than `by` holds: the check {@link createPaymentPendingInvites} makes, for a caller that must ask before its own write.

```typescript
checkInvitesWithinCaller(input: Readonly<{ organizationId: string; invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[]; }>, by: OrganizationCaller): Promise<void>;
```

#### `createSeatCheckoutWithInvites`

Bounds the invitations by `by`, opens billing's seat checkout, then holds them payment pending against the subscription it opened (C2 A, Round 50). Refuses `grant_exceeds_caller_permissions` before any checkout opens.

```typescript
createSeatCheckoutWithInvites(input: OrganizationApiSeatCheckoutInput, by: OrganizationCaller): Promise<OrganizationSeatCheckoutRedirect>;
```

#### `createPaymentPendingInvites`

Holds a seat checkout's invitations until it is paid, as main's billing did; an address that already holds an open invitation here is skipped. `by` is who invited: nobody is invited to more than they hold (checked before storing; acceptance after payment is `system`).

```typescript
createPaymentPendingInvites(input: Readonly<{ organizationId: string; subscriptionId: string; invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[]; }>, by: OrganizationCaller): Promise<void>;
```

#### `countMemberSeats`

The seats an organization holds: full and lite members, live invitations included, disabled memberships excluded. The one count a licence and a plan read.

```typescript
countMemberSeats(input: Readonly<{ organizationId: string }>): Promise<OrganizationMemberSeats>;
```

#### `checkLimit`

Whether one more of a limited resource fits the organization's plan, for this caller.

```typescript
checkLimit(input: Readonly<{ organizationId: string; limitType: LimitType }>, by: OrganizationCaller): Promise<LimitCheckResult>;
```

#### `checkAllLimits`

Every enforced limit at once, keyed by limit type.

```typescript
checkAllLimits(input: Readonly<{ organizationId: string }>, by: OrganizationCaller): Promise<Record<LimitType, LimitCheckResult>>;
```

#### `reportLimitBlocked`

A client pre-check refused somebody: re-checked, so a fabricated report raises nothing.

```typescript
reportLimitBlocked(input: Readonly<{ organizationId: string; limitType: LimitType }>, by: OrganizationCaller): Promise<void>;
```

#### `changeTeamMemberRole`

One team-role change, with the personal-team, plan and seat guards.

```typescript
changeTeamMemberRole(input: OrganizationApiUpdateTeamMemberRoleInput, by: OrganizationCaller): Promise<void>;
```

#### `readAuditLogs`

The audit trail, once the plan and the project filter have been cleared.

```typescript
readAuditLogs(input: Readonly<{ organizationId: string; projectId?: string; userId?: string; pageOffset: number; pageSize: number; action?: string; startDate?: number; endDate?: number; targetKind?: string; targetId?: string; }>, by: OrganizationCaller): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }>;
```

#### `listTeamsWithProjects`

```typescript
listTeamsWithProjects(input: Readonly<{ organizationId: string }>, by: OrganizationCaller): Promise<TeamWithProjects[]>;
```

#### `listTeamAccessMatrix`

```typescript
listTeamAccessMatrix(input: Readonly<{ organizationId: string }>): Promise<OrganizationTeamAccess[]>;
```

#### `getTeamWithProjects`

```typescript
getTeamWithProjects(input: Readonly<{ organizationId: string; slug: string }>, by: OrganizationCaller): Promise<TeamWithProjects>;
```

#### `updateTeamMembers`

```typescript
updateTeamMembers(input: Omit<UpdateOrganizationTeamWithMembersInput, "actor" | "caller">, by: OrganizationCaller): Promise<void>;
```

#### `createTeamWithGatedMembers`

```typescript
createTeamWithGatedMembers(input: Omit<CreateOrganizationTeamWithMembersInput, "actor" | "caller">, by: OrganizationCaller): Promise<OrganizationTeam>;
```

#### `archiveTeamById`

```typescript
archiveTeamById(input: Readonly<{ teamId: string }>): Promise<void>;
```

#### `removeTeamMemberById`

```typescript
removeTeamMemberById(input: Readonly<{ teamId: string; userId: string }>, by: OrganizationCaller): Promise<void>;
```

#### `listGroupsWithScopeNames`

```typescript
listGroupsWithScopeNames(input: Readonly<{ organizationId: string }>): Promise<GroupListItem[]>;
```

#### `getGroupWithScopeNames`

```typescript
getGroupWithScopeNames(input: GetOrganizationGroupInput): Promise<GroupDetail>;
```

#### `createLicensedGroup`

```typescript
createLicensedGroup(input: Omit<CreateOrganizationGroupInput, "actor" | "caller">, by: OrganizationCaller): Promise<OrganizationGroup>;
```

#### `listMemberGroupsWithScopeNames`

```typescript
listMemberGroupsWithScopeNames(input: ListMemberOrganizationGroupsInput): Promise<GroupMembershipView[]>;
```

#### `initializeOrganization`

```typescript
initializeOrganization(input: OnboardingInitializeOrganizationInput, by: OrganizationCaller): Promise<Omit<OrganizationInitialized, "projectSlug">>;
```

#### `recordIntegrationMethod`

```typescript
recordIntegrationMethod(input: Readonly<{ userId: string; selection: string }>): void;
```

#### `readPersonalWorkspaceFeatures`

```typescript
readPersonalWorkspaceFeatures(input: Readonly<{ projectId: string }>, by: OrganizationCaller): Promise<PersonalFeatures>;
```

#### `enablePersonalWorkspaceFeatures`

```typescript
enablePersonalWorkspaceFeatures(input: Readonly<{ projectId: string }>, by: OrganizationCaller): Promise<PersonalFeatures>;
```

#### `disablePersonalWorkspaceFeatures`

```typescript
disablePersonalWorkspaceFeatures(input: Readonly<{ projectId: string }>, by: OrganizationCaller): Promise<PersonalFeatures>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { organizationIds: readonly string[] }): Promise<OrganizationUsageCount>;
```

#### `listAllIds`

Organization ids on this install ordered by id, a page at a time for fleet-wide scans. No limit reads them all; `next` is null on the last page.

```typescript
listAllIds(input?: OrganizationIdPageInput): Promise<OrganizationIdPage>;
```

## REST transport

### `groupsRest`

|             |                                      |
| ----------- | ------------------------------------ |
| Declared at | `src/transport/group.rest.ts:56`     |
| Base URL    | `/api/groups`, twin `/api/v1/groups` |
| Addressing  | dated                                |
| Credential  | organization                         |
| Versions    | `2026-08-07`                         |

#### `GET /` · `getApiGroups`

List all groups for the organization

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:61`.

Answers at `/api/groups`, `/api/v1/groups`; also, undocumented, `/api/groups/2026-08-07`, `/api/v1/groups/2026-08-07`, `/api/groups/latest`, `/api/v1/groups/latest`.

```typescript
// Query: organizationGroupRestListQuerySchema, ../contract/src/features/group/group.rest.ts:77
interface Query {
  page?: number;
  limit?: number;
}
type Response = z.infer<typeof organizationGroupRestPageSchema>; // ../contract/src/features/group/group.rest.ts:28
```

#### `POST /` · `postApiGroups`

Create a new group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:89`.

Answers at `/api/groups`, `/api/v1/groups`; also, undocumented, `/api/groups/2026-08-07`, `/api/v1/groups/2026-08-07`, `/api/groups/latest`, `/api/v1/groups/latest`.

```typescript
// Body: organizationGroupRestCreateSchema, ../contract/src/features/group/group.rest.ts:83
interface Body {
  name: string;
  bindings?: {
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId?: string;
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
  memberIds?: string[];
}
// Response: organizationGroupRestCreatedSchema, ../contract/src/features/group/group.rest.ts:38
interface Response {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: unknown;
}
```

#### `GET /:groupId` · `getApiGroupsById`

Get a group with members and bindings

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:117`.

Answers at `/api/groups/:groupId`, `/api/v1/groups/:groupId`; also, undocumented, `/api/groups/2026-08-07/:groupId`, `/api/v1/groups/2026-08-07/:groupId`, `/api/groups/latest/:groupId`, `/api/v1/groups/latest/:groupId`.

```typescript
// Params: organizationGroupRestParamsSchema, ../contract/src/features/group/group.rest.ts:99
interface Params {
  groupId: string;
}
type Response = z.infer<typeof organizationGroupRestDetailsSchema>; // ../contract/src/features/group/group.rest.ts:52
```

#### `PATCH /:groupId` · `patchApiGroupsById`

Rename a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:137`.

Answers at `/api/groups/:groupId`, `/api/v1/groups/:groupId`; also, undocumented, `/api/groups/2026-08-07/:groupId`, `/api/v1/groups/2026-08-07/:groupId`, `/api/groups/latest/:groupId`, `/api/v1/groups/latest/:groupId`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/features/group/group.rest.ts:99
// Body: organizationGroupRestRenameSchema, ../contract/src/features/group/group.rest.ts:90
interface Body {
  name: string;
}
// Response: organizationGroupRestRenamedSchema, ../contract/src/features/group/group.rest.ts:45
interface Response {
  id: string;
  name: string;
  slug: string;
}
```

#### `DELETE /:groupId` · `deleteApiGroupsById`

Delete a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:154`.

Answers at `/api/groups/:groupId`, `/api/v1/groups/:groupId`; also, undocumented, `/api/groups/2026-08-07/:groupId`, `/api/v1/groups/2026-08-07/:groupId`, `/api/groups/latest/:groupId`, `/api/v1/groups/latest/:groupId`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/features/group/group.rest.ts:99
// Response: organizationRestSuccessSchema, ../contract/src/features/group/group.rest.ts:74
interface Response {
  success: boolean;
}
```

#### `GET /:groupId/members` · `getApiGroupsByIdMembers`

List members of a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:170`.

Answers at `/api/groups/:groupId/members`, `/api/v1/groups/:groupId/members`; also, undocumented, `/api/groups/2026-08-07/:groupId/members`, `/api/v1/groups/2026-08-07/:groupId/members`, `/api/groups/latest/:groupId/members`, `/api/v1/groups/latest/:groupId/members`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/features/group/group.rest.ts:99
// Response: organizationGroupRestMemberListSchema, ../contract/src/features/group/group.rest.ts:60
interface Response {
  data: {
    userId: string;
    name: string | null;
    email: string | null;
  }[];
}
```

#### `POST /:groupId/members` · `postApiGroupsByIdMembers`

Add a member to a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:182`.

Answers at `/api/groups/:groupId/members`, `/api/v1/groups/:groupId/members`; also, undocumented, `/api/groups/2026-08-07/:groupId/members`, `/api/v1/groups/2026-08-07/:groupId/members`, `/api/groups/latest/:groupId/members`, `/api/v1/groups/latest/:groupId/members`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/features/group/group.rest.ts:99
// Body: organizationGroupRestAddMemberSchema, ../contract/src/features/group/group.rest.ts:95
interface Body {
  userId: string;
}
type Response = z.infer<typeof organizationRestSuccessSchema>; // ../contract/src/features/group/group.rest.ts:74
```

#### `DELETE /:groupId/members/:userId` · `deleteApiGroupsByIdMembersByUserId`

Remove a member from a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:200`.

Answers at `/api/groups/:groupId/members/:userId`, `/api/v1/groups/:groupId/members/:userId`; also, undocumented, `/api/groups/2026-08-07/:groupId/members/:userId`, `/api/v1/groups/2026-08-07/:groupId/members/:userId`, `/api/groups/latest/:groupId/members/:userId`, `/api/v1/groups/latest/:groupId/members/:userId`.

```typescript
// Params: organizationGroupRestMemberParamsSchema, ../contract/src/features/group/group.rest.ts:101
interface Params {
  groupId: string;
  userId: string;
}
type Response = z.infer<typeof organizationRestSuccessSchema>; // ../contract/src/features/group/group.rest.ts:74
```

#### `GET /:groupId/bindings` · `getApiGroupsByIdBindings`

List role bindings for a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:216`.

Answers at `/api/groups/:groupId/bindings`, `/api/v1/groups/:groupId/bindings`; also, undocumented, `/api/groups/2026-08-07/:groupId/bindings`, `/api/v1/groups/2026-08-07/:groupId/bindings`, `/api/groups/latest/:groupId/bindings`, `/api/v1/groups/latest/:groupId/bindings`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/features/group/group.rest.ts:99
// Response: organizationGroupRestBindingListSchema, ../contract/src/features/group/group.rest.ts:64
interface Response {
  data: {
    id: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId: string | null;
    customRoleName: string | null;
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
}
```

#### `POST /:groupId/bindings` · `postApiGroupsByIdBindings`

Add a role binding to a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:231`.

Answers at `/api/groups/:groupId/bindings`, `/api/v1/groups/:groupId/bindings`; also, undocumented, `/api/groups/2026-08-07/:groupId/bindings`, `/api/v1/groups/2026-08-07/:groupId/bindings`, `/api/groups/latest/:groupId/bindings`, `/api/v1/groups/latest/:groupId/bindings`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/features/group/group.rest.ts:99
// Body: organizationGroupGrantInputSchema, ../contract/src/features/group/group.ts:75
interface Body {
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId?: string;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}
// Response: organizationGroupRestBindingSchema, ../contract/src/features/group/group.rest.ts:68
interface Response {
  id: string;
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}
```

#### `DELETE /:groupId/bindings/:bindingId` · `deleteApiGroupsByIdBindingsByBindingId`

Remove a role binding from a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:255`.

Answers at `/api/groups/:groupId/bindings/:bindingId`, `/api/v1/groups/:groupId/bindings/:bindingId`; also, undocumented, `/api/groups/2026-08-07/:groupId/bindings/:bindingId`, `/api/v1/groups/2026-08-07/:groupId/bindings/:bindingId`, `/api/groups/latest/:groupId/bindings/:bindingId`, `/api/v1/groups/latest/:groupId/bindings/:bindingId`.

```typescript
// Params: organizationGroupRestBindingParamsSchema, ../contract/src/features/group/group.rest.ts:106
interface Params {
  groupId: string;
  bindingId: string;
}
type Response = z.infer<typeof organizationRestSuccessSchema>; // ../contract/src/features/group/group.rest.ts:74
```

### `organizationManagementRest`

|             |                                                     |
| ----------- | --------------------------------------------------- |
| Declared at | `src/transport/organization-management.rest.ts:164` |
| Base URL    | `/api/organization`, twin `/api/v1/organization`    |
| Addressing  | dated                                               |
| Credential  | organization                                        |
| Versions    | `2026-08-07`                                        |

#### `GET /` · `getOrganization`

Read the organization profile: name, slug, support contact, presence and trace sharing settings, and the S3 storage shape. The single sign-on fields and the S3 secret are never returned.

Permission `organization:view`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:169`.

Answers at `/api/organization`, `/api/v1/organization`; also, undocumented, `/api/organization/2026-08-07`, `/api/v1/organization/2026-08-07`, `/api/organization/latest`, `/api/v1/organization/latest`.

```typescript
type Response = z.infer<typeof organizationManagementRestSettingsSchema>; // ../contract/src/organization-management.rest.ts:13
```

#### `PATCH /` · `updateOrganization`

Update the organization profile. Partial: only the fields present are written, and the response is exactly what a subsequent GET returns.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:180`.

Answers at `/api/organization`, `/api/v1/organization`; also, undocumented, `/api/organization/2026-08-07`, `/api/v1/organization/2026-08-07`, `/api/organization/latest`, `/api/v1/organization/latest`.

```typescript
// Body: organizationManagementRestUpdateSchema, ../contract/src/organization-management.rest.ts:15
interface Body {
  name?: string;
  supportContact?: string | null;
  presenceEnabled?: boolean;
  traceSharingEnabled?: boolean;
  primaryIntent?: "AGENT_GOVERNANCE" | "LLM_OPS" | null;
  s3Endpoint?: string | null;
  s3AccessKeyId?: string | null;
  s3SecretAccessKey?: string | null;
  s3Bucket?: string | null;
}
type Response = z.infer<typeof organizationManagementRestSettingsSchema>; // ../contract/src/organization-management.rest.ts:13
```

#### `GET /members` · `listOrganizationMembers`

List the organization's members with their organization role and disabled status. Disabled members are included only when includeDisabled=true.

Permission `organization:view`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:196`.

Answers at `/api/organization/members`, `/api/v1/organization/members`; also, undocumented, `/api/organization/2026-08-07/members`, `/api/v1/organization/2026-08-07/members`, `/api/organization/latest/members`, `/api/v1/organization/latest/members`.

```typescript
// Query: organizationManagementRestListMembersQuerySchema, ../contract/src/organization-management.rest.ts:176
interface Query {
  includeDisabled?: "true" | "false";
  offset?: number;
  limit?: number;
}
type Response = z.infer<typeof organizationManagementRestMemberListSchema>; // ../contract/src/organization-management.rest.ts:76
```

#### `GET /members/:userId` · `getOrganizationMember`

Read one member, including the teams they reach through team-scoped role bindings. Personal workspaces are not listed: they are not access an administrator manages.

Permission `organization:view`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:217`.

Answers at `/api/organization/members/:userId`, `/api/v1/organization/members/:userId`; also, undocumented, `/api/organization/2026-08-07/members/:userId`, `/api/v1/organization/2026-08-07/members/:userId`, `/api/organization/latest/members/:userId`, `/api/v1/organization/latest/members/:userId`.

```typescript
// Params: organizationManagementRestUserIdParamsSchema, ../contract/src/organization-management.rest.ts:185
interface Params {
  userId: string;
}
type Response = z.infer<typeof organizationManagementRestMemberWithTeamsSchema>; // ../contract/src/organization-management.rest.ts:65
```

#### `GET /members/:userId/access` · `getOrganizationMemberAccess`

The member's full access breakdown: organization role, group memberships with their bindings, and direct bindings, each with the permissions it grants and the scope it grants them on.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:239`.

Answers at `/api/organization/members/:userId/access`, `/api/v1/organization/members/:userId/access`; also, undocumented, `/api/organization/2026-08-07/members/:userId/access`, `/api/v1/organization/2026-08-07/members/:userId/access`, `/api/organization/latest/members/:userId/access`, `/api/v1/organization/latest/members/:userId/access`.

```typescript
type Params = z.infer<typeof organizationManagementRestUserIdParamsSchema>; // ../contract/src/organization-management.rest.ts:185
type Response = z.infer<typeof organizationManagementRestAccessBreakdownSchema>; // ../contract/src/organization-management.rest.ts:92
```

#### `PATCH /members/:userId` · `updateOrganizationMember`

Change a member's organization role, or disable / re-enable their membership. Send exactly one of role or disabled. Re-enabling consumes a seat, so it is checked against the plan.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:263`.

Answers at `/api/organization/members/:userId`, `/api/v1/organization/members/:userId`; also, undocumented, `/api/organization/2026-08-07/members/:userId`, `/api/v1/organization/2026-08-07/members/:userId`, `/api/organization/latest/members/:userId`, `/api/v1/organization/latest/members/:userId`.

```typescript
type Params = z.infer<typeof organizationManagementRestUserIdParamsSchema>; // ../contract/src/organization-management.rest.ts:185
// Body: organizationManagementRestUpdateMemberSchema, ../contract/src/organization-management.rest.ts:50
interface Body {
  role?: "ADMIN" | "MEMBER" | "EXTERNAL" | "DEVELOPER";
  disabled?: boolean;
}
type Response = z.infer<typeof organizationManagementRestUpdatedMemberSchema>; // ../contract/src/organization-management.rest.ts:70
```

#### `DELETE /members/:userId` · `removeOrganizationMember`

Remove a member from the organization and every team in it. The member the credential acts as cannot remove themselves.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:289`.

Answers at `/api/organization/members/:userId`, `/api/v1/organization/members/:userId`; also, undocumented, `/api/organization/2026-08-07/members/:userId`, `/api/v1/organization/2026-08-07/members/:userId`, `/api/organization/latest/members/:userId`, `/api/v1/organization/latest/members/:userId`.

```typescript
type Params = z.infer<typeof organizationManagementRestUserIdParamsSchema>; // ../contract/src/organization-management.rest.ts:185
// Response: organizationManagementRestSuccessSchema, ../contract/src/organization-management.rest.ts:190
interface Response {
  success: true;
}
```

#### `GET /invites` · `listOrganizationInvites`

List pending invites. Each carries its invite code and acceptance link, because a provisioning run with no email provider still has to hand the person something to open.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:305`.

Answers at `/api/organization/invites`, `/api/v1/organization/invites`; also, undocumented, `/api/organization/2026-08-07/invites`, `/api/v1/organization/2026-08-07/invites`, `/api/organization/latest/invites`, `/api/v1/organization/latest/invites`.

```typescript
type Response = z.infer<typeof organizationManagementRestInviteListSchema>; // ../contract/src/organization-management.rest.ts:172
```

#### `POST /invites` · `createOrganizationInvites`

Create up to 50 invites in one batch, each with team assignments that may carry a custom role. Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than silently granting less than was asked. emailNotSent reports, per invite, whether the invite email could be delivered.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:320`.

Answers at `/api/organization/invites`, `/api/v1/organization/invites`; also, undocumented, `/api/organization/2026-08-07/invites`, `/api/v1/organization/2026-08-07/invites`, `/api/organization/latest/invites`, `/api/v1/organization/latest/invites`.

```typescript
// Body: organizationManagementRestCreateInvitesSchema, ../contract/src/organization-management.rest.ts:130
interface Body {
  invites: {
    email: string;
    role: "ADMIN" | "MEMBER" | "EXTERNAL" | "DEVELOPER";
    teams?: {
      teamId: string;
      role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
      customRoleId?: string;
    }[];
  }[];
}
type Response = z.infer<typeof organizationManagementRestCreatedInvitesSchema>; // ../contract/src/organization-management.rest.ts:165
```

#### `DELETE /invites/:inviteId` · `revokeOrganizationInvite`

Revoke a pending invite. An invite id from another organization, or one already revoked, answers 404.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:364`.

Answers at `/api/organization/invites/:inviteId`, `/api/v1/organization/invites/:inviteId`; also, undocumented, `/api/organization/2026-08-07/invites/:inviteId`, `/api/v1/organization/2026-08-07/invites/:inviteId`, `/api/organization/latest/invites/:inviteId`, `/api/v1/organization/latest/invites/:inviteId`.

```typescript
// Params: organizationManagementRestInviteIdParamsSchema, ../contract/src/organization-management.rest.ts:186
interface Params {
  inviteId: string;
}
type Response = z.infer<typeof organizationManagementRestSuccessSchema>; // ../contract/src/organization-management.rest.ts:190
```

### `organizationsProvisioningRest`

|             |                                                    |
| ----------- | -------------------------------------------------- |
| Declared at | `src/transport/organizations.rest.ts:19`           |
| Base URL    | `/api/organizations`, twin `/api/v1/organizations` |
| Addressing  | dated                                              |
| Credential  | instance_admin                                     |
| Versions    | `2026-08-07`                                       |

#### `GET /` · `listOrganizations`

List every organization this instance hosts, self-hosted instance administrators only.

Authenticated: Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of. Declared at `src/transport/organizations.rest.ts:24`.

Answers at `/api/organizations`, `/api/v1/organizations`; also, undocumented, `/api/organizations/2026-08-07`, `/api/v1/organizations/2026-08-07`, `/api/organizations/latest`, `/api/v1/organizations/latest`.

```typescript
// Response: organizationsProvisioningRestListSchema, ../contract/src/organizations-provisioning.rest.ts:19
interface Response {
  organizations: {
    id: string;
    name: string;
    slug: string;
    createdAt: unknown;
  }[];
}
```

#### `GET /:organizationId` · `getOrganizationById`

Read one organization's provisioning summary, self-hosted instance administrators only.

Authenticated: Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of. Declared at `src/transport/organizations.rest.ts:43`.

Answers at `/api/organizations/:organizationId`, `/api/v1/organizations/:organizationId`; also, undocumented, `/api/organizations/2026-08-07/:organizationId`, `/api/v1/organizations/2026-08-07/:organizationId`, `/api/organizations/latest/:organizationId`, `/api/v1/organizations/latest/:organizationId`.

```typescript
// Params: organizationsProvisioningRestParamsSchema, ../contract/src/organizations-provisioning.rest.ts:7
interface Params {
  organizationId: string;
}
// Response: organizationsProvisioningRestGotOneSchema, ../contract/src/organizations-provisioning.rest.ts:23
interface Response {
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: unknown;
  };
}
```

### `teamsRest`

|             |                                    |
| ----------- | ---------------------------------- |
| Declared at | `src/transport/team.rest.ts:102`   |
| Base URL    | `/api/teams`, twin `/api/v1/teams` |
| Addressing  | dated                              |
| Credential  | organization                       |
| Versions    | `2026-08-07`                       |

#### `GET /` · `listTeams`

List all non-archived teams for the organization (paginated)

Permission `team:view`. Declared at `src/transport/team.rest.ts:107`.

Answers at `/api/teams`, `/api/v1/teams`; also, undocumented, `/api/teams/2026-08-07`, `/api/v1/teams/2026-08-07`, `/api/teams/latest`, `/api/v1/teams/latest`.

```typescript
// Query: organizationTeamRestPaginationQuerySchema, ../contract/src/features/team/team.rest.ts:50
interface Query {
  page?: number;
  limit?: number;
}
type Response = z.infer<typeof organizationTeamRestPageSchema>; // ../contract/src/features/team/team.rest.ts:21
```

#### `POST /` · `createTeam`

Create a new team that can group projects and members

Permission `team:manage`. Declared at `src/transport/team.rest.ts:129`.

Answers at `/api/teams`, `/api/v1/teams`; also, undocumented, `/api/teams/2026-08-07`, `/api/v1/teams/2026-08-07`, `/api/teams/latest`, `/api/v1/teams/latest`.

```typescript
// Body: organizationTeamRestCreateSchema, ../contract/src/features/team/team.rest.ts:59
interface Body {
  name: string;
}
// Response: organizationTeamRestSchema, ../contract/src/features/team/team.rest.ts:14
interface Response {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: unknown;
  updatedAt: unknown;
}
```

#### `GET /:teamId` · `getTeam`

Get a team by its id

Permission `team:view`. Declared at `src/transport/team.rest.ts:148`.

Answers at `/api/teams/:teamId`, `/api/v1/teams/:teamId`; also, undocumented, `/api/teams/2026-08-07/:teamId`, `/api/v1/teams/2026-08-07/:teamId`, `/api/teams/latest/:teamId`, `/api/v1/teams/latest/:teamId`.

```typescript
// Params: organizationTeamRestParamsSchema, ../contract/src/features/team/team.rest.ts:84
interface Params {
  teamId: string;
}
type Response = z.infer<typeof organizationTeamRestSchema>; // ../contract/src/features/team/team.rest.ts:14
```

#### `PATCH /:teamId` · `updateTeam`

Update a team by its id

Permission `team:manage`. Declared at `src/transport/team.rest.ts:166`.

Answers at `/api/teams/:teamId`, `/api/v1/teams/:teamId`; also, undocumented, `/api/teams/2026-08-07/:teamId`, `/api/v1/teams/2026-08-07/:teamId`, `/api/teams/latest/:teamId`, `/api/v1/teams/latest/:teamId`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/features/team/team.rest.ts:84
// Body: organizationTeamRestUpdateSchema, ../contract/src/features/team/team.rest.ts:68
interface Body {
  name?: string;
}
type Response = z.infer<typeof organizationTeamRestSchema>; // ../contract/src/features/team/team.rest.ts:14
```

#### `DELETE /:teamId` · `archiveTeam`

Archive a team (soft-delete)

Permission `team:manage`. Declared at `src/transport/team.rest.ts:186`.

Answers at `/api/teams/:teamId`, `/api/v1/teams/:teamId`; also, undocumented, `/api/teams/2026-08-07/:teamId`, `/api/v1/teams/2026-08-07/:teamId`, `/api/teams/latest/:teamId`, `/api/v1/teams/latest/:teamId`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/features/team/team.rest.ts:84
// Response: organizationTeamRestArchivedSchema, ../contract/src/features/team/team.rest.ts:31
interface Response {
  id: string;
  name: string;
  archivedAt: unknown | null;
}
```

#### `GET /:teamId/members` · `listTeamMembers`

List members of a team

Permission `team:view`. Declared at `src/transport/team.rest.ts:208`.

Answers at `/api/teams/:teamId/members`, `/api/v1/teams/:teamId/members`; also, undocumented, `/api/teams/2026-08-07/:teamId/members`, `/api/v1/teams/2026-08-07/:teamId/members`, `/api/teams/latest/:teamId/members`, `/api/v1/teams/latest/:teamId/members`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/features/team/team.rest.ts:84
// Response: organizationTeamRestMemberListSchema, ../contract/src/features/team/team.rest.ts:45
interface Response {
  data: {
    userId: string;
    name: string | null;
    email: string | null;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  }[];
}
```

#### `POST /:teamId/members` · `addTeamMember`

Add a member to a team

Permission `team:manage`. Declared at `src/transport/team.rest.ts:235`.

Answers at `/api/teams/:teamId/members`, `/api/v1/teams/:teamId/members`; also, undocumented, `/api/teams/2026-08-07/:teamId/members`, `/api/v1/teams/2026-08-07/:teamId/members`, `/api/teams/latest/:teamId/members`, `/api/v1/teams/latest/:teamId/members`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/features/team/team.rest.ts:84
// Body: organizationTeamRestAddMemberSchema, ../contract/src/features/team/team.rest.ts:78
interface Body {
  userId: string;
  role?: "ADMIN" | "MEMBER" | "VIEWER";
}
// Response: organizationTeamRestSuccessSchema, ../contract/src/features/team/team.rest.ts:93
interface Response {
  success: boolean;
}
```

#### `DELETE /:teamId/members/:userId` · `removeTeamMember`

Remove a member from a team

Permission `team:manage`. Declared at `src/transport/team.rest.ts:266`.

Answers at `/api/teams/:teamId/members/:userId`, `/api/v1/teams/:teamId/members/:userId`; also, undocumented, `/api/teams/2026-08-07/:teamId/members/:userId`, `/api/v1/teams/2026-08-07/:teamId/members/:userId`, `/api/teams/latest/:teamId/members/:userId`, `/api/v1/teams/latest/:teamId/members/:userId`.

```typescript
// Params: organizationTeamRestMemberParamsSchema, ../contract/src/features/team/team.rest.ts:87
interface Params {
  teamId: string;
  userId: string;
}
type Response = z.infer<typeof organizationTeamRestSuccessSchema>; // ../contract/src/features/team/team.rest.ts:93
```

#### `GET /:teamId/projects` · `listTeamProjects`

List projects in a team

Permission `team:view`. Declared at `src/transport/team.rest.ts:289`.

Answers at `/api/teams/:teamId/projects`, `/api/v1/teams/:teamId/projects`; also, undocumented, `/api/teams/2026-08-07/:teamId/projects`, `/api/v1/teams/2026-08-07/:teamId/projects`, `/api/teams/latest/:teamId/projects`, `/api/v1/teams/latest/:teamId/projects`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/features/team/team.rest.ts:84
// Response: organizationTeamRestProjectListSchema, ../contract/src/features/team/team.rest.ts:105
interface Response {
  data: {
    id: string;
    name: string;
    slug: string;
    createdAt: unknown;
    updatedAt: unknown;
  }[];
}
```

## tRPC transport

### `group`

Contract `../contract/src/features/group/group.trpc.ts:29`, router `src/transport/group.trpc.ts:16`.

| Procedure             | Kind     | Gate                                                                        | Input                            | Output                    |
| --------------------- | -------- | --------------------------------------------------------------------------- | -------------------------------- | ------------------------- |
| `group.listAll`       | query    | Permission `organization:manage`; Entitlement `enterprise` (feature `SCIM`) | `organizationApiScopeSchema`     | inline                    |
| `group.getById`       | query    | Permission `organization:manage`                                            | `groupApiGroupScopeSchema`       | `groupDetailSchema`       |
| `group.create`        | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `SCIM`) | `groupApiCreateInputSchema`      | `organizationGroupSchema` |
| `group.addGrant`      | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`) | `groupApiAddGrantInputSchema`    | `groupGrantCreatedSchema` |
| `group.removeGrant`   | mutation | Permission `organization:manage`                                            | `groupApiRemoveGrantInputSchema` | `groupWriteAckSchema`     |
| `group.addMember`     | mutation | Permission `organization:manage`                                            | `groupApiMemberInputSchema`      | `groupWriteAckSchema`     |
| `group.delete`        | mutation | Permission `organization:manage`                                            | `groupApiGroupScopeSchema`       | `groupWriteAckSchema`     |
| `group.rename`        | mutation | Permission `organization:manage`                                            | `groupApiRenameInputSchema`      | `organizationGroupSchema` |
| `group.listForMember` | query    | Permission `organization:manage`                                            | `groupApiMemberScopeSchema`      | inline                    |
| `group.removeMember`  | mutation | Permission `organization:manage`                                            | `groupApiMemberInputSchema`      | `groupWriteAckSchema`     |
| `group.applyEdits`    | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`) | `groupApiApplyEditsInputSchema`  | `groupWriteAckSchema`     |

```typescript
// group.listAll
// Input: organizationApiScopeSchema, ../contract/src/organization.trpc-schemas.ts:8
interface Input {
  organizationId: string;
}
// Output: groupListItemSchema.array() (inline, ../contract/src/features/group/group.trpc.ts:32)

// group.getById
// Input: groupApiGroupScopeSchema, ../contract/src/features/group/group.trpc-schemas.ts:12
interface Input {
  organizationId: string;
  groupId: string;
}
type Output = z.infer<typeof groupDetailSchema>; // ../contract/src/features/group/group.responses.ts:28

// group.create
// Input: groupApiCreateInputSchema, ../contract/src/features/group/group.trpc-schemas.ts:18
interface Input {
  organizationId: string;
  name: string;
  grants?: {
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId?: string;
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
  memberIds?: string[];
}
// Output: organizationGroupSchema, ../contract/src/features/group/group.ts:35
interface Output {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  externalId: string | null;
  scimSource: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

// group.addGrant
// Input: groupApiAddGrantInputSchema, ../contract/src/features/group/group.trpc-schemas.ts:26
interface Input {
  organizationId: string;
  groupId: string;
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId?: string;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}
// Output: groupGrantCreatedSchema, ../contract/src/features/group/group.responses.ts:65
interface Output {
  id: string;
}

// group.removeGrant
// Input: groupApiRemoveGrantInputSchema, ../contract/src/features/group/group.trpc-schemas.ts:33
interface Input {
  organizationId: string;
  grantId: string;
}
// Output: groupWriteAckSchema, ../contract/src/features/group/group.responses.ts:69
interface Output {
  success: true;
}

// group.addMember
// Input: groupApiMemberInputSchema, ../contract/src/features/group/group.trpc-schemas.ts:39
interface Input {
  organizationId: string;
  groupId: string;
  userId: string;
}
type Output = z.infer<typeof groupWriteAckSchema>; // ../contract/src/features/group/group.responses.ts:69

// group.delete
type Input = z.infer<typeof groupApiGroupScopeSchema>; // ../contract/src/features/group/group.trpc-schemas.ts:12
type Output = z.infer<typeof groupWriteAckSchema>; // ../contract/src/features/group/group.responses.ts:69

// group.rename
// Input: groupApiRenameInputSchema, ../contract/src/features/group/group.trpc-schemas.ts:46
interface Input {
  organizationId: string;
  groupId: string;
  name: string;
}
type Output = z.infer<typeof organizationGroupSchema>; // ../contract/src/features/group/group.ts:35

// group.listForMember
// Input: groupApiMemberScopeSchema, ../contract/src/features/group/group.trpc-schemas.ts:54
interface Input {
  organizationId: string;
  userId: string;
}
// Output: inline, ../contract/src/features/group/group.trpc.ts:65
type Output = {
  id: string;
  name: string;
  scimSource: string | null;
  grants: {
    id: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleName: string | null;
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeName: string;
  }[];
}[];

// group.removeMember
type Input = z.infer<typeof groupApiMemberInputSchema>; // ../contract/src/features/group/group.trpc-schemas.ts:39
type Output = z.infer<typeof groupWriteAckSchema>; // ../contract/src/features/group/group.responses.ts:69

// group.applyEdits
type Input = z.infer<typeof groupApiApplyEditsInputSchema>; // ../contract/src/features/group/group.trpc-schemas.ts:60
type Output = z.infer<typeof groupWriteAckSchema>; // ../contract/src/features/group/group.responses.ts:69
```

### `invite`

Contract `../contract/src/invite.trpc.ts:23`, router `src/transport/invite.trpc.ts:14`.

| Procedure                              | Kind     | Gate                                                                                                                                  | Input                                     | Output                                          |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `invite.createInvites`                 | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                           | `organizationApiCreateInvitesInputSchema` | `organizationInvitesCreatedSchema`              |
| `invite.deleteInvite`                  | mutation | Permission `organization:manage`                                                                                                      | `organizationApiInviteScopeSchema`        | –                                               |
| `invite.resendInvite`                  | mutation | Permission `organization:manage`                                                                                                      | `organizationApiInviteScopeSchema`        | `organizationInviteResentSchema`                |
| `invite.getOrganizationPendingInvites` | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`              | `organizationListedInvitesSchema`               |
| `invite.acceptInvite`                  | mutation | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | `organizationApiAcceptInviteInputSchema`  | `organizationInviteAcceptedSchema`              |
| `invite.upgradeWithInvites`            | mutation | Permission `organization:manage`                                                                                                      | `organizationApiSeatCheckoutInputSchema`  | `organizationSeatCheckoutRedirectSchema`        |
| `invite.myPendingInvitation`           | query    | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | inline                                    | `organizationPendingInvitationForCallerSchema`  |
| `invite.pendingForMe`                  | query    | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | inline                                    | `organizationPendingInvitationsForCallerSchema` |

```typescript
// invite.createInvites
type Input = z.infer<typeof organizationApiCreateInvitesInputSchema>; // ../contract/src/organization.trpc-schemas.ts:127
type Output = z.infer<typeof organizationInvitesCreatedSchema>; // ../contract/src/organization.responses.ts:44

// invite.deleteInvite
// Input: organizationApiInviteScopeSchema, ../contract/src/organization.trpc-schemas.ts:150
interface Input {
  inviteId: string;
  organizationId: string;
}

// invite.resendInvite
type Input = z.infer<typeof organizationApiInviteScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:150
type Output = z.infer<typeof organizationInviteResentSchema>; // ../contract/src/organization.responses.ts:47

// invite.getOrganizationPendingInvites
type Input = z.infer<typeof organizationApiScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:8
type Output = z.infer<typeof organizationListedInvitesSchema>; // ../contract/src/organization.responses.ts:75

// invite.acceptInvite
// Input: organizationApiAcceptInviteInputSchema, ../contract/src/organization.trpc-schemas.ts:185
interface Input {
  inviteCode: string;
}
// Output: organizationInviteAcceptedSchema, ../contract/src/organization.responses.ts:78
interface Output {
  success: true;
  invite: {
    organization: {
      id: string;
      name: string;
    };
  };
  project: {
    slug: string;
  } | null;
}

// invite.upgradeWithInvites
// Input: organizationApiSeatCheckoutInputSchema, ../contract/src/organization.trpc-schemas.ts:160
interface Input {
  organizationId: string;
  baseUrl: string;
  currency?: "USD" | "EUR";
  billingInterval?: "monthly" | "annual";
  totalSeats: number;
  invites: {
    email: string;
    role: "ADMIN" | "MEMBER" | "EXTERNAL" | "DEVELOPER";
  }[];
}
// Output: organizationSeatCheckoutRedirectSchema, ../contract/src/organization.trpc-schemas.ts:178
interface Output {
  url: string | null;
}

// invite.myPendingInvitation
// Input: inline, ../contract/src/invite.trpc.ts:48
type Input = Record<string, unknown>;
// Output: organizationPendingInvitationForCallerSchema, ../contract/src/organization.responses.ts:91
interface Output {
  inviteCode: string | null;
}

// invite.pendingForMe
// Input: inline, ../contract/src/invite.trpc.ts:53
type Input = Record<string, unknown>;
// Output: organizationPendingInvitationsForCallerSchema, ../contract/src/organization.responses.ts:99
type Output = {
  inviteCode: string;
  organizationName: string;
  role: "ADMIN" | "MEMBER" | "EXTERNAL" | "DEVELOPER";
}[];
```

### `licenseEnforcement`

Contract `../contract/src/license-enforcement.trpc.ts:24`, router `src/transport/license-enforcement.trpc.ts:14`.

| Procedure                               | Kind     | Gate                           | Input                     | Output                   |
| --------------------------------------- | -------- | ------------------------------ | ------------------------- | ------------------------ |
| `licenseEnforcement.checkLimit`         | query    | Permission `organization:view` | `limitScopeSchema`        | `limitCheckResultSchema` |
| `licenseEnforcement.checkAllLimits`     | query    | Permission `organization:view` | `organizationScopeSchema` | `allLimitChecksSchema`   |
| `licenseEnforcement.reportLimitBlocked` | mutation | Permission `organization:view` | `limitScopeSchema`        | –                        |

```typescript
// licenseEnforcement.checkLimit
// Input: limitScopeSchema, ../contract/src/license-enforcement.trpc.ts:19
interface Input {
  organizationId: string;
  limitType: "members" | "membersLite";
}
// Output: limitCheckResultSchema, ../contract/src/license-limit-type.ts:16
interface Output {
  allowed: boolean;
  current: number;
  max: number;
  limitType: "members" | "membersLite";
}

// licenseEnforcement.checkAllLimits
// Input: organizationScopeSchema, ../contract/src/license-enforcement.trpc.ts:16
interface Input {
  organizationId: string;
}
// Output: allLimitChecksSchema, ../contract/src/license-limit-type.ts:31
type Output = Record<
  string,
  {
    allowed: boolean;
    current: number;
    max: number;
    limitType: "members" | "membersLite";
  }
>;

// licenseEnforcement.reportLimitBlocked
type Input = z.infer<typeof limitScopeSchema>; // ../contract/src/license-enforcement.trpc.ts:19
```

### `organization`

Contract `../contract/src/organization.trpc.ts:60`, router `src/transport/organization.trpc.ts:80`.

| Procedure                                              | Kind     | Gate                                                                                                                                  | Input                                            | Output                                |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| `organization.createAndAssign`                         | mutation | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | `organizationApiCreateAndAssignInputSchema`      | `organizationCreatedSchema`           |
| `organization.deleteMember`                            | mutation | Permission `organization:manage`                                                                                                      | `organizationApiMemberScopeSchema`               | `organizationWriteAckSchema`          |
| `organization.setMemberDisabled`                       | mutation | Permission `organization:manage`                                                                                                      | `organizationApiSetMemberDisabledInputSchema`    | `organizationWriteAckSchema`          |
| `organization.getAll`                                  | query    | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | `organizationApiGetAllInputSchema`               | `organizationFullyLoadedListSchema`   |
| `organization.getScopeGraph`                           | query    | No permission: answers the scope skeleton of the caller's own memberships; no single scope holds it                                   | `organizationApiScopeGraphInputSchema`           | `scopeGraphSchema`                    |
| `organization.update`                                  | mutation | Permission `organization:manage`                                                                                                      | `organizationApiUpdateInputSchema`               | `organizationWriteAckSchema`          |
| `organization.getOrganizationWithMembersAndTheirTeams` | query    | Permission `organization:view`                                                                                                        | `organizationApiWithMembersInputSchema`          | `organizationMemberDirectorySchema`   |
| `organization.getDirectoryCounts`                      | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`                     | `organizationDirectoryCountsSchema`   |
| `organization.getMemberById`                           | query    | Permission `organization:manage`                                                                                                      | `organizationApiMemberScopeSchema`               | `organizationMemberRecordSchema`      |
| `organization.getInvitedMemberIds`                     | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`                     | `organizationInvitedMemberIdsSchema`  |
| `organization.updateTeamMemberRole`                    | mutation | Permission `organization:manage, via teamId`; Entitlement `enterprise` (feature `RBAC`)                                               | `organizationApiUpdateTeamMemberRoleInputSchema` | `organizationWriteAckSchema`          |
| `organization.getAllOrganizationMembers`               | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`                     | `organizationUserRowsSchema`          |
| `organization.updateMemberRole`                        | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                           | `organizationApiUpdateMemberRoleInputSchema`     | `organizationMemberRoleChangedSchema` |
| `organization.getAuditLogs`                            | query    | Permission `auditLog:view, via organizationId`; Entitlement `enterprise` (feature `AUDIT_LOGS`)                                       | `organizationApiAuditLogsInputSchema`            | `organizationAuditLogPageSchema`      |

```typescript
// organization.createAndAssign
type Input = z.infer<typeof organizationApiCreateAndAssignInputSchema>; // ../contract/src/organization.trpc.ts:43
// Output: organizationCreatedSchema, ../contract/src/organization.responses.ts:9
interface Output {
  success: true;
  organization: {
    id: string;
    name: string;
  };
  team: {
    id: string;
    slug: string;
    name: string;
  };
}

// organization.deleteMember
// Input: organizationApiMemberScopeSchema, ../contract/src/organization.trpc-schemas.ts:12
interface Input {
  userId: string;
  organizationId: string;
}
// Output: organizationWriteAckSchema, ../contract/src/organization.responses.ts:5
interface Output {
  success: true;
}

// organization.setMemberDisabled
// Input: organizationApiSetMemberDisabledInputSchema, ../contract/src/organization.trpc-schemas.ts:81
interface Input {
  userId: string;
  organizationId: string;
  disabled: boolean;
}
type Output = z.infer<typeof organizationWriteAckSchema>; // ../contract/src/organization.responses.ts:5

// organization.getAll
// Input: organizationApiGetAllInputSchema, ../contract/src/organization.trpc-schemas.ts:90
interface Input {
  isDemo?: boolean;
}
// Output: organizationFullyLoadedListSchema, ../contract/src/organization.trpc.ts:58
type Output = unknown[];

// organization.getScopeGraph
// Input: organizationApiScopeGraphInputSchema, ../contract/src/scope-graph.ts:50
type Input = Record<string, unknown>;
type Output = z.infer<typeof scopeGraphSchema>; // ../contract/src/scope-graph.ts:53

// organization.update
// Input: organizationApiUpdateInputSchema, ../contract/src/organization.trpc-schemas.ts:93
interface Input {
  organizationId: string;
  name: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Bucket?: string;
  presenceEnabled?: boolean;
  traceSharingEnabled?: boolean;
  supportContact?: string | null;
  primaryIntent?: "AGENT_GOVERNANCE" | "LLM_OPS" | null;
}
type Output = z.infer<typeof organizationWriteAckSchema>; // ../contract/src/organization.responses.ts:5

// organization.getOrganizationWithMembersAndTheirTeams
// Input: organizationApiWithMembersInputSchema, ../contract/src/organization.trpc-schemas.ts:121
interface Input {
  organizationId: string;
  includeDeactivated?: boolean;
}
type Output = z.infer<typeof organizationMemberDirectorySchema>; // ../contract/src/organization.responses.ts:165

// organization.getDirectoryCounts
type Input = z.infer<typeof organizationApiScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:8
// Output: organizationDirectoryCountsSchema, ../contract/src/organization.responses.ts:190
interface Output {
  members: number;
  openInvites: number;
  joinRequests: number;
  groups: number;
  teams: number;
}

// organization.getMemberById
type Input = z.infer<typeof organizationApiMemberScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:12
type Output = z.infer<typeof organizationMemberRecordSchema>; // ../contract/src/organization.responses.ts:142

// organization.getInvitedMemberIds
type Input = z.infer<typeof organizationApiScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:8
// Output: organizationInvitedMemberIdsSchema, ../contract/src/organization.responses.ts:269
interface Output {
  memberUserIds: string[];
  invitedUserIds: string[];
}

// organization.updateTeamMemberRole
// Input: organizationApiUpdateTeamMemberRoleInputSchema, ../contract/src/organization.trpc-schemas.ts:214
interface Input {
  teamId: string;
  userId: string;
  role: "ADMIN" | "MEMBER" | "VIEWER" | string;
  customRoleId?: string;
}
type Output = z.infer<typeof organizationWriteAckSchema>; // ../contract/src/organization.responses.ts:5

// organization.getAllOrganizationMembers
type Input = z.infer<typeof organizationApiScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:8
// Output: organizationUserRowsSchema, ../contract/src/organization.responses.ts:139
type Output = {
  id: string;
  name: string | null;
  email: string | null;
  deactivatedAt: unknown | null;
}[];

// organization.updateMemberRole
// Input: organizationApiUpdateMemberRoleInputSchema, ../contract/src/organization.trpc-schemas.ts:190
interface Input {
  userId: string;
  organizationId: string;
  role: "ADMIN" | "MEMBER" | "EXTERNAL" | "DEVELOPER";
  teamRoleUpdates?: {
    teamId: string;
    userId: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | string;
    customRoleId?: string;
  }[];
}
// Output: organizationMemberRoleChangedSchema, ../contract/src/organization.responses.ts:202
interface Output {
  success: true;
  teamsLeftWithoutAdmin: {
    id: string;
    name: string;
  }[];
}

// organization.getAuditLogs
// Input: organizationApiAuditLogsInputSchema, ../contract/src/organization.trpc-schemas.ts:245
interface Input {
  organizationId: string;
  projectId?: string;
  userId?: string;
  pageOffset?: number;
  pageSize?: number;
  action?: string;
  startDate?: number;
  endDate?: number;
  targetKind?: string;
  targetId?: string;
}
type Output = z.infer<typeof organizationAuditLogPageSchema>; // ../contract/src/organization.responses.ts:241
```

### `personalWorkspaceFeatures`

Contract `../contract/src/personal-workspace-features.trpc.ts:15`, router `src/transport/personal-workspace-features.trpc.ts:21`.

| Procedure                              | Kind     | Gate                                                                 | Input                                  | Output                   |
| -------------------------------------- | -------- | -------------------------------------------------------------------- | -------------------------------------- | ------------------------ |
| `personalWorkspaceFeatures.get`        | query    | No permission: a personal workspace belongs to its owner, not a team | `personalWorkspaceFeaturesScopeSchema` | `personalFeaturesSchema` |
| `personalWorkspaceFeatures.enableAll`  | mutation | No permission: a personal workspace belongs to its owner, not a team | `personalWorkspaceFeaturesScopeSchema` | `personalFeaturesSchema` |
| `personalWorkspaceFeatures.disableAll` | mutation | No permission: a personal workspace belongs to its owner, not a team | `personalWorkspaceFeaturesScopeSchema` | `personalFeaturesSchema` |

```typescript
// personalWorkspaceFeatures.get
// Input: personalWorkspaceFeaturesScopeSchema, ../contract/src/personal-workspace-features.trpc.ts:12
interface Input {
  projectId: string;
}
// Output: personalFeaturesSchema, ../contract/src/personal-workspace.ts:74
interface Output {
  evaluations: boolean;
  datasets: boolean;
  annotations: boolean;
  automations: boolean;
}

// personalWorkspaceFeatures.enableAll
type Input = z.infer<typeof personalWorkspaceFeaturesScopeSchema>; // ../contract/src/personal-workspace-features.trpc.ts:12
type Output = z.infer<typeof personalFeaturesSchema>; // ../contract/src/personal-workspace.ts:74

// personalWorkspaceFeatures.disableAll
type Input = z.infer<typeof personalWorkspaceFeaturesScopeSchema>; // ../contract/src/personal-workspace-features.trpc.ts:12
type Output = z.infer<typeof personalFeaturesSchema>; // ../contract/src/personal-workspace.ts:74
```

### `team`

Contract `../contract/src/features/team/team.trpc.ts:25`, router `src/transport/team.trpc.ts:9`.

| Procedure                    | Kind     | Gate                                                                        | Input                                 | Output                    |
| ---------------------------- | -------- | --------------------------------------------------------------------------- | ------------------------------------- | ------------------------- |
| `team.getBySlug`             | query    | Permission `organization:view`                                              | `teamApiSlugSchema`                   | `organizationTeamSchema`  |
| `team.getTeamsWithMembers`   | query    | Permission `organization:view`                                              | `organizationApiScopeSchema`          | inline                    |
| `team.getTeamsWithGrants`    | query    | Permission `organization:manage`                                            | `organizationApiScopeSchema`          | inline                    |
| `team.getTeamWithMembers`    | query    | Permission `organization:view`                                              | `teamApiSlugWithOrganizationSchema`   | `teamWithProjectsSchema`  |
| `team.update`                | mutation | Permission `team:manage`; Entitlement `enterprise` (feature `RBAC`)         | `teamApiUpdateInputSchema`            | `teamWriteAckSchema`      |
| `team.createTeamWithMembers` | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`) | `teamApiCreateWithMembersInputSchema` | `organizationTeamSchema`  |
| `team.archiveById`           | mutation | Permission `team:manage`                                                    | `teamApiTeamScopeSchema`              | `teamWriteAckSchema`      |
| `team.removeMember`          | mutation | Permission `team:manage`                                                    | `teamApiRemoveMemberInputSchema`      | `teamMemberRemovedSchema` |

```typescript
// team.getBySlug
// Input: teamApiSlugSchema, ../contract/src/features/team/team.trpc-schemas.ts:11
interface Input {
  organizationId: string;
  slug: string;
}
// Output: organizationTeamSchema, ../contract/src/features/team/team.ts:10
interface Output {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  archivedAt: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
}

// team.getTeamsWithMembers
type Input = z.infer<typeof organizationApiScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:8
// Output: teamWithProjectsSchema.array() (inline, ../contract/src/features/team/team.trpc.ts:33)

// team.getTeamsWithGrants
type Input = z.infer<typeof organizationApiScopeSchema>; // ../contract/src/organization.trpc-schemas.ts:8
// Output: organizationTeamAccessSchema.array() (inline, ../contract/src/features/team/team.trpc.ts:38)

// team.getTeamWithMembers
// Input: teamApiSlugWithOrganizationSchema, ../contract/src/features/team/team.trpc-schemas.ts:22
interface Input {
  slug: string;
  organizationId: string;
}
type Output = z.infer<typeof teamWithProjectsSchema>; // ../contract/src/features/team/team.responses.ts:14

// team.update
// Input: teamApiUpdateInputSchema, ../contract/src/features/team/team.trpc-schemas.ts:28
interface Input {
  teamId: string;
  name: string;
  members: {
    userId: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | string;
    customRoleId?: string;
  }[];
}
// Output: teamWriteAckSchema, ../contract/src/features/team/team.responses.ts:20
interface Output {
  success: true;
}

// team.createTeamWithMembers
// Input: teamApiCreateWithMembersInputSchema, ../contract/src/features/team/team.trpc-schemas.ts:35
interface Input {
  organizationId: string;
  name: string;
  members: {
    userId: string;
    role: "ADMIN" | "MEMBER" | "VIEWER" | string;
    customRoleId?: string;
  }[];
}
type Output = z.infer<typeof organizationTeamSchema>; // ../contract/src/features/team/team.ts:10

// team.archiveById
// Input: teamApiTeamScopeSchema, ../contract/src/features/team/team.trpc-schemas.ts:42
interface Input {
  teamId: string;
}
type Output = z.infer<typeof teamWriteAckSchema>; // ../contract/src/features/team/team.responses.ts:20

// team.removeMember
// Input: teamApiRemoveMemberInputSchema, ../contract/src/features/team/team.trpc-schemas.ts:45
interface Input {
  teamId: string;
  userId: string;
}
// Output: teamMemberRemovedSchema, ../contract/src/features/team/team.responses.ts:24
interface Output {
  success: true;
  removedUserId: string;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `organization_audit` (aggregate `organization_audit`)

Declared at `src/eventing/organization-audit.pipeline.ts:46`. Events: `organizationAuditRecordedEventSchema`.

| Kind            | Name                | Handles                                                                                                                | Declared at                                      |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| command         | `recordAudit`       | –                                                                                                                      | `src/eventing/organization-audit.pipeline.ts:51` |
| process manager | `organizationAudit` | every 1 d (`ORGANIZATION_AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `pruneAudit`, `recordAudit` (outbox) | `src/eventing/organization-audit.pipeline.ts:52` |

### Pipeline `organization_lifecycle` (aggregate `organization`)

Declared at `src/eventing/organization-lifecycle.pipeline.ts:99`. Events: `organizationSignedUpEventSchema`, `membersInvitedEventSchema`, `inviteAcceptedEventSchema`, `integrationMethodChosenEventSchema`, `personalWorkspaceProvisionedEventSchema`, `personalTeamCreatedEventSchema`, `personalWorkspaceArchivedEventSchema`, `personalWorkspaceRevivedEventSchema`, `personalWorkspaceFeaturesChangedEventSchema`, `organizationPresenceSettingChangedEventSchema`, `organizationTraceSharingDisabledEventSchema`, `organizationMemberDisabledEventSchema`, `organizationCreatedEventSchema`.

| Kind    | Name                                     | Handles | Declared at                                           |
| ------- | ---------------------------------------- | ------- | ----------------------------------------------------- |
| command | `recordSignedUp`                         | –       | `src/eventing/organization-lifecycle.pipeline.ts:118` |
| command | `recordMembersInvited`                   | –       | `src/eventing/organization-lifecycle.pipeline.ts:119` |
| command | `recordInviteAccepted`                   | –       | `src/eventing/organization-lifecycle.pipeline.ts:120` |
| command | `recordIntegrationMethodChosen`          | –       | `src/eventing/organization-lifecycle.pipeline.ts:121` |
| command | `recordPersonalWorkspaceProvisioned`     | –       | `src/eventing/organization-lifecycle.pipeline.ts:122` |
| command | `recordPersonalTeamCreated`              | –       | `src/eventing/organization-lifecycle.pipeline.ts:123` |
| command | `recordPersonalWorkspaceArchived`        | –       | `src/eventing/organization-lifecycle.pipeline.ts:124` |
| command | `recordPersonalWorkspaceRevived`         | –       | `src/eventing/organization-lifecycle.pipeline.ts:125` |
| command | `recordPersonalWorkspaceFeaturesChanged` | –       | `src/eventing/organization-lifecycle.pipeline.ts:126` |
| command | `recordPresenceSettingChanged`           | –       | `src/eventing/organization-lifecycle.pipeline.ts:130` |
| command | `recordTraceSharingDisabled`             | –       | `src/eventing/organization-lifecycle.pipeline.ts:131` |
| command | `recordMemberDisabled`                   | –       | `src/eventing/organization-lifecycle.pipeline.ts:132` |
| command | `recordCreated`                          | –       | `src/eventing/organization-lifecycle.pipeline.ts:133` |

### Pipeline `organization_seat_limit` (aggregate `organization_seat_limit`)

Declared at `src/eventing/seat-limit.pipeline.ts:18`. Events: `seatLimitReachedEventSchema`.

| Kind    | Name                     | Handles | Declared at                              |
| ------- | ------------------------ | ------- | ---------------------------------------- |
| command | `recordSeatLimitReached` | –       | `src/eventing/seat-limit.pipeline.ts:23` |

### Tasks

Run by the tasks process, before serve.

| Task                                     | Class                                     | Declared at                                                   |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `backfill-organization-presence-setting` | `OrganizationPresenceSettingBackfillTask` | `src/tasks/organization-presence-setting-backfill.task.ts:15` |

## Configuration

| Kind   | Leaf                          | Environment variable      | Declared at                                 |
| ------ | ----------------------------- | ------------------------- | ------------------------------------------- |
| secret | `internalSlackSignupsWebhook` | `SLACK_CHANNEL_SIGNUPS`   | `src/app/organization.app.ts:297`           |
| config | `signUp.mode`                 | `SIGN_UP_MODE`            | `../contract/src/organization.config.ts:17` |
| config | `signUp.allowedDomains`       | `SIGN_UP_ALLOWED_DOMAINS` | `../contract/src/organization.config.ts:18` |
| config | `signUp.adminEmails`          | `ADMIN_EMAILS`            | `../contract/src/organization.config.ts:19` |
| config | `publicBaseUrl`               | `BASE_HOST`               | `../contract/src/organization.config.ts:21` |

<!-- readme:generated:end -->
