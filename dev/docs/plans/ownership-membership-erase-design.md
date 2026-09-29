# Membership and Organization writes through organization; owner-side erase and purge

Status: design, frozen 2026-09-29. Deferred until parity (see ownership-after-parity.md, items 6 and 7).
Approval gates before any packet starts: every new operation in section 2, the eventing primitive in 4.1, and
migrations X1-X4. Paths abbreviate `modules/<m>/process/src/` as `<m>:`.

## 0. Findings checked against main

1. **Main's GDPR erase is not in this repository.** `deleteUserData.ts` moved to the saas repository
   (`src/tasks/gdpr/deleteUserData.ts`) in b8d2aa8138. That script is the reference: Postgres only, one transaction,
   dry-run by default. The branch port, `user:repositories/prisma/prisma.user-data-erase.repository.ts`, matches it
   with two changes:
   - `publicShare` is now `shareLink`;
   - `modelProvider` by project is now `modelProviderScope` with PROJECT scope (ADR-021).
2. **Parity defect: the provisioned-organization purge dropped two deletes.** Main deletes `TeamUser` (by
   team.organizationId) and `OrganizationUser` (by organizationId) (main `organization.prisma.repository.ts:780-783`).
   The branch purge (`organization:repositories/prisma/prisma.organization-membership.repository.ts:1070-1093`) does
   neither, so orphan memberships remain.
3. **Parity defect: two tasks are not registered.** `UserDataEraseTask` is missing because `user.server.ts` has no
   `.withTasks`. `TieredFreeToSeatEventMigrateTask` is missing from `billing.server.ts`'s `.withTasks`.
4. **Parity defect: SCIM lost the directory-asserted role.** Main created the membership with
   `organizationRoleFor(directoryAssertedRole)`. The branch always writes MEMBER (`scim:prisma.scim.repository.ts:379`).
5. **Dead code:** `identity:prisma.join-membership.repository.ts` and `prisma.join-setting.repository.ts`.
   identity.app.ts:326-352 already calls `OrganizationApi`.
6. **Prisma's emulated referential actions are part of main's behaviour.** With `relationMode = "prisma"`, main's
   `user.delete` and the organization/team/project `deleteMany` calls also:
   - cascade into, or set to null, rows owned by about 12 other modules;
   - hit Restrict refusals that roll the whole erase back: `ApiKey.user`, `ProjectSecret.createdBy`,
     `GatewayBudget.createdBy`, `IssuedLicense`, `Subscription`, `CustomRole` and `OrganizationInvite`, among others.
7. **Writers the audit did not list:**
   - authz `prisma.authz-admission.repository.ts:103,142` writes `OrganizationUser.pendingSsoGrantId`;
   - the ops backoffice makes generic writes to Organization;
   - SCIM writes `Group` and `GroupMembership`.
8. **Seats.** On main, SSO and SCIM inserts never checked seat limits. The routed operations must not add seat
   refusals.

## 1. Decisions per writer

The rule for choosing:
- **(a) Call an OrganizationApi command** when the column is an organization setting that several modules read.
- **(b) Move the column to the writer's own table** when only the writer reads it.

Every change goes over an existing peer edge, or towards authz (a leaf), so none adds an edge or a cycle.

| # | Writer | Rows / columns | Decision |
|---|---|---|---|
| W1 | organization, membership repository | OrganizationUser, TeamUser | Owner. `deleteMember` deletes membership first, then re-drives durably (M1). |
| W2 | auth, better-auth-hooks :120 | OrganizationUser insert | (a) `createMembership` in main's sso-arrival mode. Delete the repository method. |
| W3 | identity, join-membership | OrganizationUser | Dead code: delete. |
| W4 | scim, repository :379-390 plus the provisioning and deprovision services | OrganizationUser insert/delete | (a) `createMembership` with the asserted role (restores finding 4). Remove through `offboardMember`. |
| W5 | authz, eventing.authz-grant :400-470 | deletes OrganizationUser, GroupMembership, TeamUser, OrganizationInvite | Split. Organization deletes its own rows in `offboardMember`. authz keeps Grant and RoleBinding (`revokeMemberAccess`). |
| W6 | authz, admission :103,142 | OrganizationUser.pendingSsoGrantId | (b) New `AuthzPendingAdmission` table. |
| W7 | billing, subscription :212 | Organization.pricingModel | (a) `setPricingModel` |
| W8 | billing, webhook-organization :38,49 | currency; trial licence | currency: (a) `setBillingCurrency`. Licence: `LicensingApi.removeLicense`. |
| W9 | billing, tiered-free-to-seat task :42 | pricingModel updateMany | (a) `setPricingModel({ onlyIfCurrently: "TIERED" })`, and register the task. |
| W10 | licensing, organization-license :57,68 | license, expiry, last validated | (a) `storeLicense` / `clearLicense` |
| W11 | licensing, connect-organization :57,72 | connect* columns | (b) New `LicensingConnectState` table. |
| W12 | auth, sign-in-security-settings :94 | four lockout and session columns | (b) New `SignInSecurityPolicy` table. A missing row means the defaults 0/30/1440/0. |
| W13 | identity, two-step-verification :113 | mfaRequired | (a) `setMfaRequired` |
| W14 | identity, join-setting :45 | domainJoin, joinDomains | Dead code: delete. |

## 2. New and amended operations (each needs approval)

**OrganizationApi**
- **O1** `createMembership({ organizationId, userId, role? = MEMBER, admission })`
  - `admission` is one of `pending-sso`, `admitted { actor, commandId, source }` or `directory`.
  - Returns `"created" | "already-present"`. It adds no seat refusal.
- **O2** `offboardMember({ organizationId, userId, actor })`
  - One transaction: apply the last-admin guard, delete the rows, and insert a `MemberRemoval` row.
  - Then call `AuthzApi.revokeMemberAccess` and stamp the removal as revoked.
- **O3** `setPricingModel({ organizationId, pricingModel, onlyIfCurrently? }) -> boolean`
- **O4** `setBillingCurrency`
- **O5** `storeLicense`
- **O6** `clearLicense`: throws `OrganizationNotFoundError` when the organization doesn't exist.
- **O7** `setMfaRequired`
- **O8** `planMemberErasure({ userId })`: answers with main's saas queries and blocker texts exactly.

**Other modules**
- **A1** `AuthzApi.revokeMemberAccess`, which replaces `offboard`.
- **A2** `AuthzApi.recordPendingAdmission`
- **P1** `ProjectApi.findIdsByTeams`

## 3. Migrations (expand in release N, contract in N+1)

Each migration backfills with `INSERT ... SELECT`. During the transition the code dual-writes, and a re-runnable copy
task converges the tables.

| Id | Expand | Contract |
|---|---|---|
| X1 | `AuthzPendingAdmission(organizationId, userId, grantId, createdAt)`, backfilled from `pendingSsoGrantId` | drop `OrganizationUser.pendingSsoGrantId` |
| X2 | `SignInSecurityPolicy(organizationId PK, four columns, updatedAt)`, backfilled for every organization | drop the four Organization columns and remove them from the wire |
| X3 | `LicensingConnectState(organizationId PK, servicesDisabled, lastSyncAt, lastSyncError)`, backfilled | drop the three `connect*` columns and remove them from the wire |
| X4 | `MemberRemoval(id, organizationId, userId, removedAt, accessRevokedAt, attempts, lastError)` | none |

## 4. Owner-side erase and purge (§9.1)

### 4.1 Primitive (needs approval)

- **Why a framework primitive.** A per-module fan-out would add cycle edges for about 20 owners, so `packages/eventing`
  gains an erasure facility, fanned out by the eventing member the same way it builds `maintenancePipelines()`.
- **Participants.** Each owner declares
  `defineErasureParticipant({ participant, after, models: { Model: { Root: action } }, check(plan), erase(plan) })`
  - It lives in `process/src/eventing/<m>.erasure.ts`, a new filename kind in feature-layout-policy.
  - It is installed through `.withEventing` and calls no peer.
- **Plan.** A frozen set of root ids: `{ kind: user-erase | organization-purge, userId?, organizationIds, teamIds,
  projectIds }`.
- **Run.**
  - A keyed process manager, `erasureRun`, on the member-built `data_erasure` pipeline.
  - Its surface is `eventing.erasures.request`, `status` and `redrive`.
- **Phases.**
  1. CHECK: every participant checks, read-only. Any blocker refuses the whole run, as main's rollback did.
  2. ERASE: participants run in topological `after` order, each in one transaction over its own tables.
- **Boot refusal.** Two participants claiming the same model and root, or a cycle in `after`, refuses boot and names
  the participants.

### 4.2-4.5 Completeness, idempotency, ordering, partial failure

- **Completeness.** The run freezes the expected participant set. Each participant moves
  `pending -> checked -> erased | failed`, and `status` answers the whole map.
- **Idempotency.**
  - Every write is a set-based `deleteMany`/`updateMany` keyed by plan ids.
  - Anonymisation writes terminal values, so a rerun matches nothing.
  - The message key is `requestId:participant:phase`.
- **Ordering.** Each owner orders its own rows. `after` must cover every cross-owner Restrict edge, and the enforcer
  checks this. The root participants (project, organization, user) run the Restrict check again inside their erase.
- **Partial failure.** The process-manager outbox retries with backoff. At the limit the participant is marked failed
  and the run stalls. An hourly wake and the operator's `redrive` re-emit only the unfinished participants.

### 4.6 Model-to-owner actions

Actions:
- **D**: delete.
- **N**: set to null or anonymise.
- **B**: block (refused in CHECK).
- **R**: retain (baselined).
- **[E]**: the action exists only through Prisma's emulation; P0 must confirm it.

Root keys: **U** the user; **p** deleted projects; **t** deleted teams; **o** organizations deleted by a user erase;
**O** the purged organization.

| Owner | Models: actions |
|---|---|
| user | User U:D (last) |
| organization | OrganizationUser U:D o:D O:D; TeamUser U:D t:D O:D; Team t:D O:D; Organization o:D O:D; GroupMembership U:D[E]; Group O:D[E]; OrganizationInvite O:B[E] U:N[E] |
| auth | Account U:D; Session U:D; TwoFactor U:D[E]; Passkey U:D[E] |
| identity | AccountCredential U:D[E] |
| authz | RoleBinding U:D[E] O:D; Grant O:D; GrantUsage O:D; Role O:D; Grant U:R |
| api-key | ApiKey U:B O:D o:B |
| ops | SystemMigrationTenantState O:D; SystemMigrationEnrollment O:D |
| prompt | LlmPromptConfigVersion U:N p:D; LlmPromptConfig p:D; PromptTag O:D U:N[E]; PromptTagAssignment U:N[E] |
| workflow | Workflow U:N p:D; WorkflowVersion U:D p:D |
| annotation | Annotation U:N p:D; AnnotationQueueItem U:N p:D; AnnotationQueueMembers U:D p:D; AnnotationQueueScores p:D; AnnotationQueue p:D; AnnotationScore p:B[E] |
| share | ShareLink U:N p:D |
| audit-log | AuditLog U:N ("[deleted]", ip/userAgent null) |
| dataset | BatchEvaluation p:D; Dataset p:D; DatasetRecord p:D |
| monitor / experiment | Monitor p:D; Experiment p:D |
| dashboard | CustomGraph p:D; Dashboard p:D; SavedView p:B[E] U:N[E] |
| automation | Trigger p:D; TriggerSent p:B[E]; EmailSuppression p:B[E] |
| topic / evaluation / model-provider | Topic p:D; Cost p:D; ModelProviderScope p:D |
| project | Project p:D U:N[E] |
| secret / data-retention / trace / analytics | ProjectSecret U:B p:B; PinnedTrace U:N[E] p:B[E]; TraceEditOverlay U:N[E] p:B[E]; Analytics p:B[E] |
| agent / evaluator / scenario / suite | Agent, Evaluator, SimulationSuite p:B[E]; Scenario p:B[E] U:N[E] |
| notification / webhook | Notification p:D[E] O:D[E]; WebhookEndpoint O:D[E]; WebhookEndpointDelivery p:D[E] |
| gateway | GatewayGuardrail p:D[E] U:N[E]; GatewayChangeEvent O:D[E] p:N[E]; VirtualKey U:N[E]; GatewayBudget U:B |
| enterprise-gateway / governance | RoutingPolicy O:D[E] U:N[E]; IngestionSource O:D[E] t:N[E] U:N[E]; AnomalyRule O:D[E] U:N[E]; AnomalyAlert, AiToolEntry, IngestionTemplate O:D[E]; AiToolEntryTeam t:D[E] |
| scim / github | ScimExternalId, ScimUserResource U:D[E]; ScimToken, ScimRequestLog O:D[E]; GithubInstallation, GithubPullRequest, GithubBranchPullRequestCheck O:D[E] |
| licensing / billing / role | IssuedLicense O:B; ConnectedBillingAccount, Subscription O:B; CustomRole O:B[E] |

### 4.7 Enforcer

- **Policy:** `erasure-coverage` in `packages/architecture-enforcer/src/policies/persistence/`.
- **Checks:**
  - every (model, root) pair has exactly one owning participant, or a shrink-only baseline entry;
  - the participant owns the model it declares;
  - `after` covers every cross-owner Restrict edge;
  - no module deletes or updates a model it doesn't claim.
- **Baseline:** `tests/baselines/erasure-retained.json`.

### 4.8 Initiators

- **User-data-erase task** (registered again):
  - plans with `planMemberErasure` and `findIdsByTeams`;
  - dry-run by default; `--execute` requests the run, waits for it and verifies the user is gone.
- **`deleteProvisionedOrganization`:** requests an organization purge and waits for it in the request, bounded.
  A refusal answers what main answered.
- **Deleted:** the user-data-erase repository and the organization purge body.

## 5. Packets

**Order:**
- Membership track: M1 then M2. M3 and M4 are independent. M5 comes a release later.
- Erase track: P0, then P1, then P3a, P3b and P4, then P5.
- P2 lands after P1 and before P5.
- P5 lands after M1.

| Packet | Scope |
|---|---|
| M1 | Membership commands in organization and authz (O1, O2, A1, A2); migrations X1 and X4; a MemberRemoval re-drive process manager |
| M2 | Callers go through organization: auth hooks and SCIM (restoring the asserted role); delete the dead identity repositories |
| M3 | Organization-row writes from billing and licensing (O3-O6); register the tiered task; migration X3 |
| M4 | Organization-row writes from auth and identity (O7); migration X2 |
| M5 | Contract migrations; remove the dual-writes and the wire fields |
| P0 | Characterisation against real Postgres of today's erase and purge, recording which rows are deleted, nulled or refused; restore main's two purge deletes; resolve every [E] |
| P1 | The eventing erasure primitive and its specs |
| P2 | The erasure-coverage enforcer and baseline |
| P3a | Participants scoped to projects |
| P3b | Block and null participants |
| P4 | Participants for identity and enterprise modules |
| P5 | Root participants and the initiators; delete the old repositories |

## 6. Risks

1. **Removal window.** O2 is no longer one transaction. Grants stay live until the re-drive, at most a minute.
   M1 must prove that authorisation denies a user who has bindings but no membership.
2. **The erase is no longer atomic.** A blocking child that appears after CHECK stalls the run by name.
3. **[E] rows are unverified** until P0 runs.
4. **The provisioning door now depends on the worker** to finish the purge.
5. **Sign-in security reads take two queries** instead of one.
6. **Rollout.** Old pods write only the old columns. The dual-write and copy task converge them, so M5 must not ship
   in the same release.
7. **Out of scope:**
   - the ops backoffice's Organization writes;
   - SCIM's Group and GroupMembership writes;
   - the remaining cross-module reads.
8. **Approval load:** eight organization operations, two authz operations, one project operation, the primitive and
   four migrations.
