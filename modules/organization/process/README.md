# @langwatch/organization-process

The server half of [organization](../README.md). Organisations and who is in them: membership, invites, teams, groups and personal workspaces, and the sign-up checks that create them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("organization").withRepositories(organizationRepositories).withApi(OrganizationModule).withTransports(organizationTrpcTransport, inviteTrpcTransport, teamTrpcTransport, groupTrpcTransport, joinRequestTrpcTransport, licenseEnforcementTrpcTransport, personalWorkspaceFeaturesTrpcTransport, organizationManagementRest, organizationsProvisioningRest, groupsRest, teamsRest).withTransportFacts(…).withEventing(seatLimitEventing).withEventing(organizationLifecycleEventing).withTasks(…)`, `src/organization.module.ts:24`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`OrganizationApi`)

Peers call these through the token, declared at `../contract/src/organization.api.ts:227`; nothing else in this package is public.

#### `createAndAssign`

```typescript
createAndAssign(input: Readonly<{ orgName?: string; phoneNumber?: string; signUpData?: Record<string, unknown>; primaryIntent?: OrganizationIntent | null; userDisplayName?: string | null; }>, by: OrganizationCaller): Promise<{ organization: { id: string; name: string }; team: { id: string; slug: string; name: string }; }>;
```

#### `checkSignUp`

Whether this address may create a new account on the installation (`SIGN_UP_MODE`, `SIGN_UP_ALLOWED_DOMAINS`). The default settings answer without a read.

```typescript
checkSignUp(input: Readonly<{ email: string }>): Promise<SignUpVerdict>;
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
getJoinSetting(input: { organizationId: string }): Promise<JoinRequestJoining>;
```

#### `saveJoinSetting`

```typescript
saveJoinSetting(input: { organizationId: string; setting: JoinRequestJoining }): Promise<void>;
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

#### `createSelfHostedCustomer`

A self-hosted licence customer: the organization and its first team, marked.

```typescript
createSelfHostedCustomer(input: { name: string }): Promise<{ id: string; name: string }>;
```

#### `markSelfHostedCustomer`

```typescript
markSelfHostedCustomer(input: { organizationId: string }): Promise<void>;
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

#### `createForProvisioningWithAdminKey`

Provisions an organization end to end: it, its first team, a bootstrap admin key, the summary. A failure past creation deletes the organization and reports a failed compensation rather than raising it over the cause.

```typescript
createForProvisioningWithAdminKey(input: { name: string; slug?: string; adminApiKeyName?: string; }): Promise<{ organization: { id: string; name: string; slug: string }; team: { id: string; slug: string; name: string }; adminApiKey: { id: string; token: string }; }>;
```

#### `getMemberAccessBreakdown`

The authorization feature's per-member access breakdown, organization's own door onto it.

```typescript
getMemberAccessBreakdown(input: Readonly<{ organizationId: string; userId: string; userName: string | null; userEmail: string | null; }>): Promise<AuthzAccessBreakdownOutput>;
```

#### `createMembership`

Admits somebody on the joiner seat (ADR-129, ADR-171): a MEMBER's grant lands now with `admittedBy` or an SSO arrival resumes it; a DEVELOPER's row is the whole admission. `seat` is the row's role; `"already-present"` is a concurrent callback or a retry.

```typescript
createMembership(input: Readonly<{ organizationId: string; userId: string; admittedBy?: Readonly<{ actor: LedgerActor; commandId: string }>; /** The seat the admitting caller decided (ADR-171 v6); absent is the joiner seat. */ seat?: "MEMBER" | "DEVELOPER"; /** Where a join request was made, written on the Developer admission audit row. */ origin?: JoinRequestApiOrigin; }>): Promise<{ outcome: "created" | "already-present"; seat: "MEMBER" | "DEVELOPER" }>;
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

#### `getMemberProvenance`

Why each member is here, keyed by user id; explains, never grants.

```typescript
getMemberProvenance(input: Readonly<{ organizationId: string }>): Promise<Record<string, OrganizationMemberProvenance>>;
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

#### `updateSentPlanLimitAlert`

Main's `updateSentPlanLimitAlert`.

```typescript
updateSentPlanLimitAlert(input: Readonly<{ organizationId: string; sentAt: Instant }>): Promise<void>;
```

#### `claimBillingCustomerId`

```typescript
claimBillingCustomerId(input: Readonly<{ organizationId: string; billingCustomerId: string }>): Promise<boolean>;
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

#### `findProject`

```typescript
findProject(id: string): Promise<Project | null>;
```

#### `listProjectsByOrganization`

```typescript
listProjectsByOrganization(input: Readonly<{ organizationId: string; page: number; limit: number; projectIds?: string[]; includeGovernance?: boolean; }>): Promise<PaginatedProjects>;
```

#### `listProjectsByTeam`

```typescript
listProjectsByTeam(input: Readonly<{ organizationId: string; teamId: string }>): Promise<Project[]>;
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

#### `createPaymentPendingInvites`

Holds a seat checkout's invitations until it is paid, as main's billing did; an address that already holds an open invitation here is skipped. `by` is who invited: nobody is invited to more than they hold (checked before storing; acceptance after payment is `system`).

```typescript
createPaymentPendingInvites(input: Readonly<{ organizationId: string; subscriptionId: string; invites: readonly Readonly<{ email: string; role: OrganizationUserRole; teamIds: string }>[]; }>, by: OrganizationCaller): Promise<void>;
```

#### `cancelPaymentPendingInvites`

Drops the held invitations of seat checkouts that were abandoned.

```typescript
cancelPaymentPendingInvites(input: Readonly<{ organizationId: string; subscriptionIds: readonly string[] }>): Promise<void>;
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

#### `approvePaymentPendingInvites`

Opens the invitations a completed seat checkout paid for, as main's billing webhook did.

```typescript
approvePaymentPendingInvites(input: Readonly<{ subscriptionId: string; organizationId: string }>): Promise<void>;
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

#### `lookupJoinableOrganizations`

```typescript
lookupJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown>;
```

#### `listOwnJoinRequests`

```typescript
listOwnJoinRequests(input: Readonly<{ userId: string }>): Promise<JoinRequestMine>;
```

#### `fileJoinRequest`

```typescript
fileJoinRequest(input: Readonly<{ userId: string; organizationId: string; origin?: JoinRequestApiOrigin }>): Promise<JoinRequestFiled>;
```

#### `withdrawJoinRequest`

```typescript
withdrawJoinRequest(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void>;
```

#### `listPendingJoinRequests`

```typescript
listPendingJoinRequests(input: Readonly<{ organizationId: string }>): Promise<JoinRequestPending>;
```

#### `approveJoinRequest`

```typescript
approveJoinRequest(input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>): Promise<void>;
```

#### `rejectJoinRequest`

```typescript
rejectJoinRequest(input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>): Promise<void>;
```

#### `readJoiningPolicy`

```typescript
readJoiningPolicy(input: Readonly<{ organizationId: string }>): Promise<JoinRequestJoining>;
```

#### `setJoiningPolicy`

Audited against `actorUserId`, the administrator who saved it.

```typescript
setJoiningPolicy(input: Readonly<{ organizationId: string; domainJoin: JoinRequestJoining["domainJoin"]; domains: readonly string[]; joinerRole?: JoinRequestJoining["joinerRole"]; actorUserId: string; }>): Promise<JoinRequestJoiningChanged>;
```

#### `offerJoinableOrganizations`

The post-login offer: the lookup minus the domains this person dismissed.

```typescript
offerJoinableOrganizations(input: Readonly<{ userId: string }>): Promise<unknown>;
```

#### `dismissJoinOffer`

```typescript
dismissJoinOffer(input: Readonly<{ userId: string }>): Promise<void>;
```

#### `admitAutomatically`

```typescript
admitAutomatically(input: Readonly<{ userId: string; origin?: JoinRequestApiOrigin }>): Promise<JoinRequestAdmitted>;
```

#### `listAutomaticJoins`

```typescript
listAutomaticJoins(input: Readonly<{ organizationId: string }>): Promise<JoinRequestAutomaticJoins>;
```

#### `initializeOrganization`

```typescript
initializeOrganization(input: OnboardingInitializeOrganizationInput, by: OrganizationCaller): Promise<OrganizationInitialized>;
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

#### `findAllIds`

Every organization on this install, for the install-wide usage report.

```typescript
findAllIds(): Promise<string[]>;
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
type Query = z.infer<typeof organizationGroupRestListQuerySchema>; // ../contract/src/group.rest.ts:77
type Response = z.infer<typeof organizationGroupRestPageSchema>; // ../contract/src/group.rest.ts:28
```

#### `POST /` · `postApiGroups`

Create a new group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:89`.

Answers at `/api/groups`, `/api/v1/groups`; also, undocumented, `/api/groups/2026-08-07`, `/api/v1/groups/2026-08-07`, `/api/groups/latest`, `/api/v1/groups/latest`.

```typescript
type Body = z.infer<typeof organizationGroupRestCreateSchema>; // ../contract/src/group.rest.ts:83
type Response = z.infer<typeof organizationGroupRestCreatedSchema>; // ../contract/src/group.rest.ts:38
```

#### `GET /:groupId` · `getApiGroupsById`

Get a group with members and bindings

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:117`.

Answers at `/api/groups/:groupId`, `/api/v1/groups/:groupId`; also, undocumented, `/api/groups/2026-08-07/:groupId`, `/api/v1/groups/2026-08-07/:groupId`, `/api/groups/latest/:groupId`, `/api/v1/groups/latest/:groupId`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/group.rest.ts:99
type Response = z.infer<typeof organizationGroupRestDetailsSchema>; // ../contract/src/group.rest.ts:52
```

#### `PATCH /:groupId` · `patchApiGroupsById`

Rename a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:137`.

Answers at `/api/groups/:groupId`, `/api/v1/groups/:groupId`; also, undocumented, `/api/groups/2026-08-07/:groupId`, `/api/v1/groups/2026-08-07/:groupId`, `/api/groups/latest/:groupId`, `/api/v1/groups/latest/:groupId`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/group.rest.ts:99
type Body = z.infer<typeof organizationGroupRestRenameSchema>; // ../contract/src/group.rest.ts:90
type Response = z.infer<typeof organizationGroupRestRenamedSchema>; // ../contract/src/group.rest.ts:45
```

#### `DELETE /:groupId` · `deleteApiGroupsById`

Delete a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:154`.

Answers at `/api/groups/:groupId`, `/api/v1/groups/:groupId`; also, undocumented, `/api/groups/2026-08-07/:groupId`, `/api/v1/groups/2026-08-07/:groupId`, `/api/groups/latest/:groupId`, `/api/v1/groups/latest/:groupId`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/group.rest.ts:99
type Response = z.infer<typeof organizationRestSuccessSchema>; // ../contract/src/group.rest.ts:74
```

#### `GET /:groupId/members` · `getApiGroupsByIdMembers`

List members of a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:170`.

Answers at `/api/groups/:groupId/members`, `/api/v1/groups/:groupId/members`; also, undocumented, `/api/groups/2026-08-07/:groupId/members`, `/api/v1/groups/2026-08-07/:groupId/members`, `/api/groups/latest/:groupId/members`, `/api/v1/groups/latest/:groupId/members`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/group.rest.ts:99
type Response = z.infer<typeof organizationGroupRestMemberListSchema>; // ../contract/src/group.rest.ts:60
```

#### `POST /:groupId/members` · `postApiGroupsByIdMembers`

Add a member to a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:182`.

Answers at `/api/groups/:groupId/members`, `/api/v1/groups/:groupId/members`; also, undocumented, `/api/groups/2026-08-07/:groupId/members`, `/api/v1/groups/2026-08-07/:groupId/members`, `/api/groups/latest/:groupId/members`, `/api/v1/groups/latest/:groupId/members`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/group.rest.ts:99
type Body = z.infer<typeof organizationGroupRestAddMemberSchema>; // ../contract/src/group.rest.ts:95
type Response = z.infer<typeof organizationRestSuccessSchema>; // ../contract/src/group.rest.ts:74
```

#### `DELETE /:groupId/members/:userId` · `deleteApiGroupsByIdMembersByUserId`

Remove a member from a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:200`.

Answers at `/api/groups/:groupId/members/:userId`, `/api/v1/groups/:groupId/members/:userId`; also, undocumented, `/api/groups/2026-08-07/:groupId/members/:userId`, `/api/v1/groups/2026-08-07/:groupId/members/:userId`, `/api/groups/latest/:groupId/members/:userId`, `/api/v1/groups/latest/:groupId/members/:userId`.

```typescript
type Params = z.infer<typeof organizationGroupRestMemberParamsSchema>; // ../contract/src/group.rest.ts:101
type Response = z.infer<typeof organizationRestSuccessSchema>; // ../contract/src/group.rest.ts:74
```

#### `GET /:groupId/bindings` · `getApiGroupsByIdBindings`

List role bindings for a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:216`.

Answers at `/api/groups/:groupId/bindings`, `/api/v1/groups/:groupId/bindings`; also, undocumented, `/api/groups/2026-08-07/:groupId/bindings`, `/api/v1/groups/2026-08-07/:groupId/bindings`, `/api/groups/latest/:groupId/bindings`, `/api/v1/groups/latest/:groupId/bindings`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/group.rest.ts:99
type Response = z.infer<typeof organizationGroupRestBindingListSchema>; // ../contract/src/group.rest.ts:64
```

#### `POST /:groupId/bindings` · `postApiGroupsByIdBindings`

Add a role binding to a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:231`.

Answers at `/api/groups/:groupId/bindings`, `/api/v1/groups/:groupId/bindings`; also, undocumented, `/api/groups/2026-08-07/:groupId/bindings`, `/api/v1/groups/2026-08-07/:groupId/bindings`, `/api/groups/latest/:groupId/bindings`, `/api/v1/groups/latest/:groupId/bindings`.

```typescript
type Params = z.infer<typeof organizationGroupRestParamsSchema>; // ../contract/src/group.rest.ts:99
type Body = z.infer<typeof organizationGroupGrantInputSchema>; // ../contract/src/group.ts:75
type Response = z.infer<typeof organizationGroupRestBindingSchema>; // ../contract/src/group.rest.ts:68
```

#### `DELETE /:groupId/bindings/:bindingId` · `deleteApiGroupsByIdBindingsByBindingId`

Remove a role binding from a group

Permission `organization:manage`. Entitlement `enterprise` (feature `GROUPS`). Declared at `src/transport/group.rest.ts:255`.

Answers at `/api/groups/:groupId/bindings/:bindingId`, `/api/v1/groups/:groupId/bindings/:bindingId`; also, undocumented, `/api/groups/2026-08-07/:groupId/bindings/:bindingId`, `/api/v1/groups/2026-08-07/:groupId/bindings/:bindingId`, `/api/groups/latest/:groupId/bindings/:bindingId`, `/api/v1/groups/latest/:groupId/bindings/:bindingId`.

```typescript
type Params = z.infer<typeof organizationGroupRestBindingParamsSchema>; // ../contract/src/group.rest.ts:106
type Response = z.infer<typeof organizationRestSuccessSchema>; // ../contract/src/group.rest.ts:74
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
type Body = z.infer<typeof organizationManagementRestUpdateSchema>; // ../contract/src/organization-management.rest.ts:15
type Response = z.infer<typeof organizationManagementRestSettingsSchema>; // ../contract/src/organization-management.rest.ts:13
```

#### `GET /members` · `listOrganizationMembers`

List the organization's members with their organization role and disabled status. Disabled members are included only when includeDisabled=true.

Permission `organization:view`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:196`.

Answers at `/api/organization/members`, `/api/v1/organization/members`; also, undocumented, `/api/organization/2026-08-07/members`, `/api/v1/organization/2026-08-07/members`, `/api/organization/latest/members`, `/api/v1/organization/latest/members`.

```typescript
type Query = z.infer<typeof organizationManagementRestListMembersQuerySchema>; // ../contract/src/organization-management.rest.ts:175
type Response = z.infer<typeof organizationManagementRestMemberListSchema>; // ../contract/src/organization-management.rest.ts:76
```

#### `GET /members/:userId` · `getOrganizationMember`

Read one member, including the teams they reach through team-scoped role bindings. Personal workspaces are not listed: they are not access an administrator manages.

Permission `organization:view`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:217`.

Answers at `/api/organization/members/:userId`, `/api/v1/organization/members/:userId`; also, undocumented, `/api/organization/2026-08-07/members/:userId`, `/api/v1/organization/2026-08-07/members/:userId`, `/api/organization/latest/members/:userId`, `/api/v1/organization/latest/members/:userId`.

```typescript
type Params = z.infer<typeof organizationManagementRestUserIdParamsSchema>; // ../contract/src/organization-management.rest.ts:184
type Response = z.infer<typeof organizationManagementRestMemberWithTeamsSchema>; // ../contract/src/organization-management.rest.ts:65
```

#### `GET /members/:userId/access` · `getOrganizationMemberAccess`

The member's full access breakdown: organization role, group memberships with their bindings, and direct bindings, each with the permissions it grants and the scope it grants them on.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:239`.

Answers at `/api/organization/members/:userId/access`, `/api/v1/organization/members/:userId/access`; also, undocumented, `/api/organization/2026-08-07/members/:userId/access`, `/api/v1/organization/2026-08-07/members/:userId/access`, `/api/organization/latest/members/:userId/access`, `/api/v1/organization/latest/members/:userId/access`.

```typescript
type Params = z.infer<typeof organizationManagementRestUserIdParamsSchema>; // ../contract/src/organization-management.rest.ts:184
type Response = z.infer<typeof organizationManagementRestAccessBreakdownSchema>; // ../contract/src/organization-management.rest.ts:91
```

#### `PATCH /members/:userId` · `updateOrganizationMember`

Change a member's organization role, or disable / re-enable their membership. Send exactly one of role or disabled. Re-enabling consumes a seat, so it is checked against the plan.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:263`.

Answers at `/api/organization/members/:userId`, `/api/v1/organization/members/:userId`; also, undocumented, `/api/organization/2026-08-07/members/:userId`, `/api/v1/organization/2026-08-07/members/:userId`, `/api/organization/latest/members/:userId`, `/api/v1/organization/latest/members/:userId`.

```typescript
type Params = z.infer<typeof organizationManagementRestUserIdParamsSchema>; // ../contract/src/organization-management.rest.ts:184
type Body = z.infer<typeof organizationManagementRestUpdateMemberSchema>; // ../contract/src/organization-management.rest.ts:50
type Response = z.infer<typeof organizationManagementRestUpdatedMemberSchema>; // ../contract/src/organization-management.rest.ts:70
```

#### `DELETE /members/:userId` · `removeOrganizationMember`

Remove a member from the organization and every team in it. The member the credential acts as cannot remove themselves.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:289`.

Answers at `/api/organization/members/:userId`, `/api/v1/organization/members/:userId`; also, undocumented, `/api/organization/2026-08-07/members/:userId`, `/api/v1/organization/2026-08-07/members/:userId`, `/api/organization/latest/members/:userId`, `/api/v1/organization/latest/members/:userId`.

```typescript
type Params = z.infer<typeof organizationManagementRestUserIdParamsSchema>; // ../contract/src/organization-management.rest.ts:184
type Response = z.infer<typeof organizationManagementRestSuccessSchema>; // ../contract/src/organization-management.rest.ts:189
```

#### `GET /invites` · `listOrganizationInvites`

List pending invites. Each carries its invite code and acceptance link, because a provisioning run with no email provider still has to hand the person something to open.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:305`.

Answers at `/api/organization/invites`, `/api/v1/organization/invites`; also, undocumented, `/api/organization/2026-08-07/invites`, `/api/v1/organization/2026-08-07/invites`, `/api/organization/latest/invites`, `/api/v1/organization/latest/invites`.

```typescript
type Response = z.infer<typeof organizationManagementRestInviteListSchema>; // ../contract/src/organization-management.rest.ts:171
```

#### `POST /invites` · `createOrganizationInvites`

Create up to 50 invites in one batch, each with team assignments that may carry a custom role. Validation is strict: a team or custom role that cannot be assigned refuses the batch rather than silently granting less than was asked. emailNotSent reports, per invite, whether the invite email could be delivered.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:320`.

Answers at `/api/organization/invites`, `/api/v1/organization/invites`; also, undocumented, `/api/organization/2026-08-07/invites`, `/api/v1/organization/2026-08-07/invites`, `/api/organization/latest/invites`, `/api/v1/organization/latest/invites`.

```typescript
type Body = z.infer<typeof organizationManagementRestCreateInvitesSchema>; // ../contract/src/organization-management.rest.ts:129
type Response = z.infer<typeof organizationManagementRestCreatedInvitesSchema>; // ../contract/src/organization-management.rest.ts:164
```

#### `DELETE /invites/:inviteId` · `revokeOrganizationInvite`

Revoke a pending invite. An invite id from another organization, or one already revoked, answers 404.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/organization-management.rest.ts:364`.

Answers at `/api/organization/invites/:inviteId`, `/api/v1/organization/invites/:inviteId`; also, undocumented, `/api/organization/2026-08-07/invites/:inviteId`, `/api/v1/organization/2026-08-07/invites/:inviteId`, `/api/organization/latest/invites/:inviteId`, `/api/v1/organization/latest/invites/:inviteId`.

```typescript
type Params = z.infer<typeof organizationManagementRestInviteIdParamsSchema>; // ../contract/src/organization-management.rest.ts:185
type Response = z.infer<typeof organizationManagementRestSuccessSchema>; // ../contract/src/organization-management.rest.ts:189
```

### `organizationsProvisioningRest`

|             |                                                    |
| ----------- | -------------------------------------------------- |
| Declared at | `src/transport/organizations.rest.ts:21`           |
| Base URL    | `/api/organizations`, twin `/api/v1/organizations` |
| Addressing  | dated                                              |
| Credential  | instance_admin                                     |
| Versions    | `2026-08-07`                                       |

#### `POST /` · `provisionOrganization`

Provision a new organization with its first team and a bootstrap admin service key, self-hosted instance administrators only.

Authenticated: Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of. Declared at `src/transport/organizations.rest.ts:26`.

Answers at `/api/organizations`, `/api/v1/organizations`; also, undocumented, `/api/organizations/2026-08-07`, `/api/v1/organizations/2026-08-07`, `/api/organizations/latest`, `/api/v1/organizations/latest`.

```typescript
type Body = z.infer<typeof organizationsProvisioningRestCreateSchema>; // ../contract/src/organizations-provisioning.rest.ts:7
type Response = z.infer<typeof organizationsProvisioningRestCreatedSchema>; // ../contract/src/organizations-provisioning.rest.ts:31
```

#### `GET /` · `listOrganizations`

List every organization this instance hosts, self-hosted instance administrators only.

Authenticated: Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of. Declared at `src/transport/organizations.rest.ts:50`.

Answers at `/api/organizations`, `/api/v1/organizations`; also, undocumented, `/api/organizations/2026-08-07`, `/api/v1/organizations/2026-08-07`, `/api/organizations/latest`, `/api/v1/organizations/latest`.

```typescript
type Response = z.infer<typeof organizationsProvisioningRestListSchema>; // ../contract/src/organizations-provisioning.rest.ts:45
```

#### `GET /:organizationId` · `getOrganizationById`

Read one organization's provisioning summary, self-hosted instance administrators only.

Authenticated: Holding the instance administrator bearer key is the only authority this door checks; there is no tenant to ask a permission of. Declared at `src/transport/organizations.rest.ts:69`.

Answers at `/api/organizations/:organizationId`, `/api/v1/organizations/:organizationId`; also, undocumented, `/api/organizations/2026-08-07/:organizationId`, `/api/v1/organizations/2026-08-07/:organizationId`, `/api/organizations/latest/:organizationId`, `/api/v1/organizations/latest/:organizationId`.

```typescript
type Params = z.infer<typeof organizationsProvisioningRestParamsSchema>; // ../contract/src/organizations-provisioning.rest.ts:19
type Response = z.infer<typeof organizationsProvisioningRestGotOneSchema>; // ../contract/src/organizations-provisioning.rest.ts:49
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
type Query = z.infer<typeof organizationTeamRestPaginationQuerySchema>; // ../contract/src/team.rest.ts:50
type Response = z.infer<typeof organizationTeamRestPageSchema>; // ../contract/src/team.rest.ts:21
```

#### `POST /` · `createTeam`

Create a new team that can group projects and members

Permission `team:manage`. Declared at `src/transport/team.rest.ts:129`.

Answers at `/api/teams`, `/api/v1/teams`; also, undocumented, `/api/teams/2026-08-07`, `/api/v1/teams/2026-08-07`, `/api/teams/latest`, `/api/v1/teams/latest`.

```typescript
type Body = z.infer<typeof organizationTeamRestCreateSchema>; // ../contract/src/team.rest.ts:59
type Response = z.infer<typeof organizationTeamRestSchema>; // ../contract/src/team.rest.ts:14
```

#### `GET /:teamId` · `getTeam`

Get a team by its id

Permission `team:view`. Declared at `src/transport/team.rest.ts:148`.

Answers at `/api/teams/:teamId`, `/api/v1/teams/:teamId`; also, undocumented, `/api/teams/2026-08-07/:teamId`, `/api/v1/teams/2026-08-07/:teamId`, `/api/teams/latest/:teamId`, `/api/v1/teams/latest/:teamId`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/team.rest.ts:84
type Response = z.infer<typeof organizationTeamRestSchema>; // ../contract/src/team.rest.ts:14
```

#### `PATCH /:teamId` · `updateTeam`

Update a team by its id

Permission `team:manage`. Declared at `src/transport/team.rest.ts:166`.

Answers at `/api/teams/:teamId`, `/api/v1/teams/:teamId`; also, undocumented, `/api/teams/2026-08-07/:teamId`, `/api/v1/teams/2026-08-07/:teamId`, `/api/teams/latest/:teamId`, `/api/v1/teams/latest/:teamId`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/team.rest.ts:84
type Body = z.infer<typeof organizationTeamRestUpdateSchema>; // ../contract/src/team.rest.ts:68
type Response = z.infer<typeof organizationTeamRestSchema>; // ../contract/src/team.rest.ts:14
```

#### `DELETE /:teamId` · `archiveTeam`

Archive a team (soft-delete)

Permission `team:manage`. Declared at `src/transport/team.rest.ts:186`.

Answers at `/api/teams/:teamId`, `/api/v1/teams/:teamId`; also, undocumented, `/api/teams/2026-08-07/:teamId`, `/api/v1/teams/2026-08-07/:teamId`, `/api/teams/latest/:teamId`, `/api/v1/teams/latest/:teamId`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/team.rest.ts:84
type Response = z.infer<typeof organizationTeamRestArchivedSchema>; // ../contract/src/team.rest.ts:31
```

#### `GET /:teamId/members` · `listTeamMembers`

List members of a team

Permission `team:view`. Declared at `src/transport/team.rest.ts:208`.

Answers at `/api/teams/:teamId/members`, `/api/v1/teams/:teamId/members`; also, undocumented, `/api/teams/2026-08-07/:teamId/members`, `/api/v1/teams/2026-08-07/:teamId/members`, `/api/teams/latest/:teamId/members`, `/api/v1/teams/latest/:teamId/members`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/team.rest.ts:84
type Response = z.infer<typeof organizationTeamRestMemberListSchema>; // ../contract/src/team.rest.ts:45
```

#### `POST /:teamId/members` · `addTeamMember`

Add a member to a team

Permission `team:manage`. Declared at `src/transport/team.rest.ts:235`.

Answers at `/api/teams/:teamId/members`, `/api/v1/teams/:teamId/members`; also, undocumented, `/api/teams/2026-08-07/:teamId/members`, `/api/v1/teams/2026-08-07/:teamId/members`, `/api/teams/latest/:teamId/members`, `/api/v1/teams/latest/:teamId/members`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/team.rest.ts:84
type Body = z.infer<typeof organizationTeamRestAddMemberSchema>; // ../contract/src/team.rest.ts:78
type Response = z.infer<typeof organizationTeamRestSuccessSchema>; // ../contract/src/team.rest.ts:93
```

#### `DELETE /:teamId/members/:userId` · `removeTeamMember`

Remove a member from a team

Permission `team:manage`. Declared at `src/transport/team.rest.ts:266`.

Answers at `/api/teams/:teamId/members/:userId`, `/api/v1/teams/:teamId/members/:userId`; also, undocumented, `/api/teams/2026-08-07/:teamId/members/:userId`, `/api/v1/teams/2026-08-07/:teamId/members/:userId`, `/api/teams/latest/:teamId/members/:userId`, `/api/v1/teams/latest/:teamId/members/:userId`.

```typescript
type Params = z.infer<typeof organizationTeamRestMemberParamsSchema>; // ../contract/src/team.rest.ts:87
type Response = z.infer<typeof organizationTeamRestSuccessSchema>; // ../contract/src/team.rest.ts:93
```

#### `GET /:teamId/projects` · `listTeamProjects`

List projects in a team

Permission `team:view`. Declared at `src/transport/team.rest.ts:289`.

Answers at `/api/teams/:teamId/projects`, `/api/v1/teams/:teamId/projects`; also, undocumented, `/api/teams/2026-08-07/:teamId/projects`, `/api/v1/teams/2026-08-07/:teamId/projects`, `/api/teams/latest/:teamId/projects`, `/api/v1/teams/latest/:teamId/projects`.

```typescript
type Params = z.infer<typeof organizationTeamRestParamsSchema>; // ../contract/src/team.rest.ts:84
type Response = z.infer<typeof organizationTeamRestProjectListSchema>; // ../contract/src/team.rest.ts:105
```

## tRPC transport

### `group`

Contract `../contract/src/group.trpc.ts:29`, router `src/transport/group.trpc.ts:16`.

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

### `invite`

Contract `../contract/src/invite.trpc.ts:21`, router `src/transport/invite.trpc.ts:14`.

| Procedure                              | Kind     | Gate                                                                                                                                  | Input                                     | Output                                          |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `invite.createInvites`                 | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                           | `organizationApiCreateInvitesInputSchema` | `organizationInvitesCreatedSchema`              |
| `invite.deleteInvite`                  | mutation | Permission `organization:manage`                                                                                                      | `organizationApiInviteScopeSchema`        | –                                               |
| `invite.resendInvite`                  | mutation | Permission `organization:manage`                                                                                                      | `organizationApiInviteScopeSchema`        | `organizationInviteResentSchema`                |
| `invite.getOrganizationPendingInvites` | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`              | `organizationListedInvitesSchema`               |
| `invite.acceptInvite`                  | mutation | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | `organizationApiAcceptInviteInputSchema`  | `organizationInviteAcceptedSchema`              |
| `invite.myPendingInvitation`           | query    | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | inline                                    | `organizationPendingInvitationForCallerSchema`  |
| `invite.pendingForMe`                  | query    | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | inline                                    | `organizationPendingInvitationsForCallerSchema` |

### `joinRequests`

Contract `../contract/src/join-request.trpc.ts:48`, router `src/transport/join-request.trpc.ts:49`.

| Procedure                         | Kind     | Gate                                                                                                                                                                                                                     | Input                                   | Output                            |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------- |
| `joinRequests.lookup`             | query    | No permission: the caller is asking about organizations they are not in yet, so there is no scope to hold a permission on; the handler answers only for the session's OWN verified addresses and reveals nothing else    | inline                                  | `joinRequestLookupSchema`         |
| `joinRequests.offer`              | query    | No permission: the same own-verified-address answer `lookup` gives, minus the domains this caller has dismissed; no other person's organizations are reachable                                                           | inline                                  | `joinRequestLookupSchema`         |
| `joinRequests.dismissOffer`       | mutation | No permission: the caller silencing their own offer, on the domain their own session's verified address holds                                                                                                            | inline                                  | `joinRequestWriteAckSchema`       |
| `joinRequests.admitAutomatically` | mutation | No permission: admits the caller to an organization that opted into admitting their own verified domain; the handler re-derives the match server-side and admits nothing else                                            | `joinRequestApiAdmitInputSchema`        | `joinRequestAdmittedSchema`       |
| `joinRequests.mine`               | query    | No permission: the caller's own pending requests, keyed by their session id                                                                                                                                              | inline                                  | `joinRequestMineSchema`           |
| `joinRequests.request`            | mutation | No permission: asking to join is the one action a non-member takes on an organization; the handler proves the organization was OFFERED to this caller's verified domain and refuses anything else as if it did not exist | `joinRequestApiRequestInputSchema`      | `joinRequestFiledSchema`          |
| `joinRequests.withdraw`           | mutation | No permission: the requester withdrawing their own request, matched on the session's user id                                                                                                                             | `joinRequestApiWithdrawInputSchema`     | `joinRequestWriteAckSchema`       |
| `joinRequests.pending`            | query    | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiOrganizationScopeSchema` | `joinRequestPendingSchema`        |
| `joinRequests.approve`            | mutation | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiDecisionInputSchema`     | `joinRequestWriteAckSchema`       |
| `joinRequests.reject`             | mutation | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiDecisionInputSchema`     | `joinRequestWriteAckSchema`       |
| `joinRequests.joining`            | query    | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiOrganizationScopeSchema` | `joinRequestJoiningSchema`        |
| `joinRequests.setJoining`         | mutation | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiSetJoiningInputSchema`   | `joinRequestJoiningChangedSchema` |
| `joinRequests.automaticJoins`     | query    | Permission `organization:manage`                                                                                                                                                                                         | `joinRequestApiOrganizationScopeSchema` | `joinRequestAutomaticJoinsSchema` |

### `licenseEnforcement`

Contract `../contract/src/license-enforcement.trpc.ts:24`, router `src/transport/license-enforcement.trpc.ts:14`.

| Procedure                               | Kind     | Gate                           | Input                     | Output                   |
| --------------------------------------- | -------- | ------------------------------ | ------------------------- | ------------------------ |
| `licenseEnforcement.checkLimit`         | query    | Permission `organization:view` | `limitScopeSchema`        | `limitCheckResultSchema` |
| `licenseEnforcement.checkAllLimits`     | query    | Permission `organization:view` | `organizationScopeSchema` | `allLimitChecksSchema`   |
| `licenseEnforcement.reportLimitBlocked` | mutation | Permission `organization:view` | `limitScopeSchema`        | –                        |

### `organization`

Contract `../contract/src/organization.trpc.ts:60`, router `src/transport/organization.trpc.ts:81`.

| Procedure                                              | Kind     | Gate                                                                                                                                  | Input                                            | Output                                     |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| `organization.createAndAssign`                         | mutation | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | `organizationApiCreateAndAssignInputSchema`      | `organizationCreatedSchema`                |
| `organization.deleteMember`                            | mutation | Permission `organization:manage`                                                                                                      | `organizationApiMemberScopeSchema`               | `organizationWriteAckSchema`               |
| `organization.setMemberDisabled`                       | mutation | Permission `organization:manage`                                                                                                      | `organizationApiSetMemberDisabledInputSchema`    | `organizationWriteAckSchema`               |
| `organization.getAll`                                  | query    | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | `organizationApiGetAllInputSchema`               | `organizationFullyLoadedListSchema`        |
| `organization.getScopeGraph`                           | query    | No permission: runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite | `organizationApiScopeGraphInputSchema`           | `scopeGraphSchema`                         |
| `organization.update`                                  | mutation | Permission `organization:manage`                                                                                                      | `organizationApiUpdateInputSchema`               | `organizationWriteAckSchema`               |
| `organization.getOrganizationWithMembersAndTheirTeams` | query    | Permission `organization:view`                                                                                                        | `organizationApiWithMembersInputSchema`          | `organizationMemberDirectorySchema`        |
| `organization.getDirectoryCounts`                      | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`                     | `organizationDirectoryCountsSchema`        |
| `organization.getMemberById`                           | query    | Permission `organization:manage`                                                                                                      | `organizationApiMemberScopeSchema`               | `organizationMemberRecordSchema`           |
| `organization.getMemberProvenance`                     | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`                     | `organizationMemberProvenanceByUserSchema` |
| `organization.updateTeamMemberRole`                    | mutation | Permission `organization:manage, via teamId`; Entitlement `enterprise` (feature `RBAC`)                                               | `organizationApiUpdateTeamMemberRoleInputSchema` | `organizationWriteAckSchema`               |
| `organization.getAllOrganizationMembers`               | query    | Permission `organization:manage`                                                                                                      | `organizationApiScopeSchema`                     | `organizationUserRowsSchema`               |
| `organization.updateMemberRole`                        | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                           | `organizationApiUpdateMemberRoleInputSchema`     | `organizationMemberRoleChangedSchema`      |
| `organization.getAuditLogs`                            | query    | Permission `auditLog:view, via organizationId`; Entitlement `enterprise` (feature `AUDIT_LOGS`)                                       | `organizationApiAuditLogsInputSchema`            | `organizationAuditLogPageSchema`           |

### `personalWorkspaceFeatures`

Contract `../contract/src/personal-workspace-features.trpc.ts:15`, router `src/transport/personal-workspace-features.trpc.ts:21`.

| Procedure                              | Kind     | Gate                                                                 | Input                                  | Output                   |
| -------------------------------------- | -------- | -------------------------------------------------------------------- | -------------------------------------- | ------------------------ |
| `personalWorkspaceFeatures.get`        | query    | No permission: a personal workspace belongs to its owner, not a team | `personalWorkspaceFeaturesScopeSchema` | `personalFeaturesSchema` |
| `personalWorkspaceFeatures.enableAll`  | mutation | No permission: a personal workspace belongs to its owner, not a team | `personalWorkspaceFeaturesScopeSchema` | `personalFeaturesSchema` |
| `personalWorkspaceFeatures.disableAll` | mutation | No permission: a personal workspace belongs to its owner, not a team | `personalWorkspaceFeaturesScopeSchema` | `personalFeaturesSchema` |

### `team`

Contract `../contract/src/team.trpc.ts:25`, router `src/transport/team.trpc.ts:9`.

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

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `organization_lifecycle` (aggregate `organization`)

Declared at `src/eventing/organization-lifecycle.pipeline.ts:30`. Events: `organizationSignedUpEventSchema`, `membersInvitedEventSchema`, `inviteAcceptedEventSchema`, `integrationMethodChosenEventSchema`, `personalWorkspaceProvisionedEventSchema`, `organizationPresenceSettingChangedEventSchema`.

| Kind    | Name                                 | Handles | Declared at                                          |
| ------- | ------------------------------------ | ------- | ---------------------------------------------------- |
| command | `recordSignedUp`                     | –       | `src/eventing/organization-lifecycle.pipeline.ts:42` |
| command | `recordMembersInvited`               | –       | `src/eventing/organization-lifecycle.pipeline.ts:43` |
| command | `recordInviteAccepted`               | –       | `src/eventing/organization-lifecycle.pipeline.ts:44` |
| command | `recordIntegrationMethodChosen`      | –       | `src/eventing/organization-lifecycle.pipeline.ts:45` |
| command | `recordPersonalWorkspaceProvisioned` | –       | `src/eventing/organization-lifecycle.pipeline.ts:46` |
| command | `recordPresenceSettingChanged`       | –       | `src/eventing/organization-lifecycle.pipeline.ts:47` |

### Pipeline `organization_seat_limit` (aggregate `organization_seat_limit`)

Declared at `src/eventing/seat-limit.pipeline.ts:18`. Events: `seatLimitReachedEventSchema`.

| Kind    | Name                     | Handles | Declared at                              |
| ------- | ------------------------ | ------- | ---------------------------------------- |
| command | `recordSeatLimitReached` | –       | `src/eventing/seat-limit.pipeline.ts:23` |

### Tasks

Run by the tasks process, before serve.

| Task                                     | Class                                     | Declared at                                                   |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `backfill-organization-presence-setting` | `OrganizationPresenceSettingBackfillTask` | `src/tasks/organization-presence-setting-backfill.task.ts:14` |

## Configuration

| Kind   | Leaf                          | Environment variable      | Declared at                                 |
| ------ | ----------------------------- | ------------------------- | ------------------------------------------- |
| secret | `internalSlackSignupsWebhook` | `SLACK_CHANNEL_SIGNUPS`   | `src/app/organization.app.ts:344`           |
| config | `signUp.mode`                 | `SIGN_UP_MODE`            | `../contract/src/organization.config.ts:17` |
| config | `signUp.allowedDomains`       | `SIGN_UP_ALLOWED_DOMAINS` | `../contract/src/organization.config.ts:18` |
| config | `signUp.adminEmails`          | `ADMIN_EMAILS`            | `../contract/src/organization.config.ts:19` |
| config | `publicBaseUrl`               | `BASE_HOST`               | `../contract/src/organization.config.ts:21` |

<!-- readme:generated:end -->
