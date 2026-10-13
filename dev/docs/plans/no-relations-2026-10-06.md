# No relations: removing every Prisma relation and foreign key

Status: plan for review, no code. Branch `feat/strict-feature-layout-v0` at 420ab92a9c, against
`origin/main` 418a183677.

Ruling (Alex, 2026-10-06 afternoon, item 3, `.claude/coordinator/rulings-2026-10-05.md:238`): "an
eventually consistent system has no foreign keys or relations in Prisma: remove every @relation and
any remaining FK constraint". The `postgres-migration` skill already teaches the target (rule 6 and
"No foreign keys, no `@relation`"). This plan surveys what the removal touches, proposes how each
emulated cascade becomes explicit, the migration that drops the database constraints, the check that
keeps the tree clean, the slices, the risks, and the decisions only Alex can take (section 7).

Record: CLAUDE.md rule 2 ("A repository belongs to one module ... owning a table means owning every
query against it"); ARCHITECTURE.md §3 (another module's share crosses only as its `*Api` ops) and
§3.3 item 1 (what is derivable from the opened stores is a repository inside the module); §9.1
(cross-module purge, erase and retention are commanded by the owners through one fact each); §7
("Migrations are not the api's job"); §15 is untouched (no spelling here is deleted or added).
Nothing in this plan writes an `*Api` operation, a peer edge, an event or a contract shape: every one
it needs is a question in section 7. `main` keeps its 196 `@relation` lines
(`platform/app/prisma/schema.prisma`, `relationMode = "prisma"` at :17), so the whole plan is a ruled
departure from main; it aims at no wire difference (section 6 names the candidates).

## 1. Survey

### 1.1 Method

- Schema: `packages/prisma-client/prisma/schema.prisma` parsed field by field (a field whose type is a
  model is a relation field; `fields:` marks the owning, column-holding side).
- Owner of a model: the module whose Prisma repository claims it (`prismaTables(...)` or
  `PrismaRepository.for/transactionalFor(...)`, the claims `prisma-table-ownership.ts:26-66` reads):
  51 models. The other 118 are unclaimed today, so the owner is the module making most delegate calls
  over it (1,915 delegate calls in product code), with 24 set by hand where calls are absent or
  misleading (the `ProcessManager*` tables to `packages/eventing` per §7 "The event tables are
  eventing's"; `Group`/`GroupMembership` to organization per the catalogue's `group` subject;
  `ScheduledJob` to eventing; `LangwatchUpgrade*` to `packages/upgrade`; `TwoFactor` to auth).
- Query usage: a TypeScript AST walk over every non-test `.ts` under `modules/`, `enterprise/modules/`,
  `packages/` and `apps/`, following each `prisma.<delegate>.<op>({...})` argument with its model
  known (include, select, where, orderBy, data, upsert create/update), plus a name-based pass for
  object literals built outside the call. Tests, fixtures and generated code are excluded and counted
  separately.
- Database constraints: every `FOREIGN KEY`, `REFERENCES`, `RENAME CONSTRAINT` and `DROP` in the 365
  migrations, checked against `pg_constraint` on the local test database migrated to
  `20261006170517_user_notification_preferences` (362 applied; the two later migrations add no key).

### 1.2 The schema

| Measure                                                           | Count | Evidence                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relationMode = "prisma"`                                         | 1     | `schema.prisma:17`                                                                                                                                                                            |
| Models                                                            | 169   | `^model ` in `schema.prisma`                                                                                                                                                                  |
| `@relation` lines                                                 | 197   | 161 owning sides (with `fields:`) + 36 named back sides                                                                                                                                       |
| Relation fields (both sides)                                      | 322   | 161 owning + 161 back-relation fields, over 96 models; every back side pairs with exactly one owning side                                                                                     |
| Implicit many-to-many join tables                                 | 0     | no `CREATE TABLE "_...` in any migration                                                                                                                                                      |
| One-to-one relations                                              | 5     | back sides `SsoConnection.reproofCursor`, `Organization.connectedBilling`, `CustomGraph.trigger`, `Trigger.latestEvaluation`, `Experiment.monitor`; the `@unique` on each owning column stays |
| Self relations                                                    | 6     | `Topic.parent` :2073, `Workflow.copiedFrom` :3548, `WorkflowVersion.parent` :3571, `LlmPromptConfig.copiedFrom` :3661, `Agent.copiedFrom` :3816, `Evaluator.copiedFrom` :3848                 |
| Owning columns with no leading index or unique                    | 22    | section 1.6, finding F8                                                                                                                                                                       |
| Owning sides, same module                                         | 48    | Appendix A                                                                                                                                                                                    |
| Owning sides, cross-module (child and parent in different owners) | 113   | Appendix A                                                                                                                                                                                    |

Referential actions on the 161 owning sides. Explicit: Cascade 56, Restrict 16, SetNull 11; none
written on 78, where Prisma's default applies (53 required, so Restrict; 25 optional, so SetNull).
Effective, by scope:

| Effective `onDelete` | Same module | Cross-module | Total |
| -------------------- | ----------- | ------------ | ----- |
| Cascade              | 25          | 31           | 56    |
| Restrict             | 21          | 48           | 69    |
| SetNull              | 2           | 34           | 36    |
| Total                | 48          | 113          | 161   |

Cross-module relations by parent: `User` 40, `Project` 33, `Organization` 21, `Team` 4, `Workflow` 3,
then `Experiment`, `Evaluator`, `CustomGraph` 2 each and `Trigger`, `SimulationSuite`, `Group`,
`ApiKey`, `RoutingPolicy`, `CustomRole` 1 each (Appendix A). They form 69 distinct module-to-module edges, most of them `* -> project`, `* -> user` and
`* -> organization`.

### 1.3 Queries that use a relation

386 sites in 74 product files (Appendix B, with file:line):

| Kind                                                           | Sites | Cross-module                                  |
| -------------------------------------------------------------- | ----- | --------------------------------------------- |
| `include` of a relation                                        | 144   | most                                          |
| relation filter in `where` (`some`/`every`/`none`/`is`/direct) | 143   | most                                          |
| `select` of a relation                                         | 84    | most                                          |
| nested write (`create`, `deleteMany`, `connect`)               | 11    | 1                                             |
| `orderBy` a relation                                           | 3     | 2                                             |
| `_count` of a relation                                         | 1     | 1                                             |
| Total                                                          | 386   | 236 typed cross, 130 typed same, 20 name-only |

The concentrations:

- **Project lineage**: `Project.team` (then `team.organizationId`) at 53 cross-module sites in eight
  modules: project 24 (`prisma.project.repository.ts`, e.g. :577), organization 8, authz 5,
  entitlement 4, prompt 4, data-privacy 3, data-retention 3, langy 2. `Project` has no
  `organizationId` column (`schema.prisma:1771-1772`); every "projects of an organization" read
  walks the relation into organization's `Team`.
- **Gateway virtual keys**: `VirtualKey.principalUser` 14 and `VirtualKey.routingPolicy` 14
  (`modules/gateway/process/src/repositories/prisma/prisma.virtual-key.repository.ts` and peers),
  reaching user's `User` and enterprise-gateway's `RoutingPolicy`.
- **Membership with people**: `OrganizationUser.user` 12 in organization, 3 in scim, 2 in identity;
  `GroupMembership.group` 8 in authz; `GroupMembership.user` 6 and `TeamUser.team` 6 in organization;
  two of them sort by the user (`orderBy` at `prisma.organization-membership.repository.ts:1370`, :1615).
- **Erase and purge**: user's `prisma.user-data-erase.repository.ts` (10 cross sites) and
  organization's provisioned purge.
- **Nested writes** are rare: annotation queue members and scores (`prisma.annotation-queue.repository.ts:66-67`,
  :93-94), scope rows (`prisma.virtual-key.repository.ts:273`, `prisma.model-default.repository.ts:122`,
  :128, `prisma.routing-policy.repository.ts:99`, `prisma.gateway-virtual-key-config-backfill.repository.ts:72`),
  one `connect` (`prisma.routing-policy.repository.ts:109`, `updatedBy`), and one cross-module
  nested create: project writes gateway's `GatewayChangeEvent` through `gatewayChangeEvents: { create }`
  (`modules/project/process/src/repositories/prisma/prisma.project.repository.ts:388`).

Outside the query sites:

- `Prisma.<Model>GetPayload<...>` types: 13 uses in product code, which change shape when the relation goes.
- Tests: 25 `include: {` lines in 19 test files and 5 `connect: {` lines in 5; the slack integration
  test asserts the database refusal (questions file Q199(3)).
- The multi-tenancy guard requires a nested `scopes` relation on every `ModelProvider` and
  `ModelDefaultConfig` create (`packages/prisma-client/src/multi-tenancy-guard.ts:399-400`, :548-549)
  and accepts `{ scopes: { some: ... } }` as a tenancy predicate (:196-201).
- The repository capability guard walks relations: `prismaRelationCatalogue`
  (`packages/prisma-client/src/table-catalogue.ts:2777`, generated by
  `packages/prisma-client/scripts/generate-table-catalogue.mjs`) feeds `relationIndex()` and
  `assertRelationAccess` with `PrismaRelationException` (`packages/prisma-client/src/ownership.ts:64-184`).
  No product code declares an exception; once relations are gone this is dead code.
- LangWatchQL parses `@relation` (`modules/analytics/process/src/rules/lwql-prisma-schema.rules.ts:142-164`)
  but derives tenancy from columns (`lwql-postgres-catalog-model.rules.ts:240-275`) and drops relation
  fields from its columns (:379). The generated `lwql-prisma-manifest.generated.json` regenerates; no
  column should change.
- `prisma-table-ownership` reads only model names (`prisma-table-ownership.ts:26-50`) and is unaffected.

### 1.4 Emulated actions that actually run

`relationMode = "prisma"` emulates `onDelete` in the client when a parent is deleted through Prisma.
An action only matters where the parent is hard-deleted; section 1.7 lists every such parent with its
delete site and the children whose action fires. Totals of live actions:

| Effective action | Same module (live of total) | Cross-module (live of total) |
| ---------------- | --------------------------- | ---------------------------- |
| Cascade          | 16 of 25                    | 31 of 31                     |
| SetNull          | 2 of 2                      | 32 of 34                     |
| Restrict         | 16 of 21                    | 47 of 48                     |

Two deleters drive almost every cross-module action: user erase
(`modules/user/process/src/repositories/prisma/prisma.user-data-erase.repository.ts:195-292`, which
deletes `Project`, `Team`, `Organization` and `User`) and the provisioned-organization purge
(`modules/organization/process/src/repositories/prisma/prisma.organization-membership.repository.ts:1210-1241`).
Both already delete other modules' rows directly, which §9.1 names as breaks
(`dev/docs/plans/ownership-after-parity.md` item 7). The emulated cascades are the hidden half of
those breaks: they run inside the query engine, so the ownership capability never sees them.

### 1.5 Foreign keys in the database

The migrations write 46 `FOREIGN KEY` clauses in 30 files. Two left with their table
(`WebhookDelivery`, dropped at `20260804120004_unify_webhook_delivery_log/migration.sql:77`); four were
renamed with theirs (`PromptVersionLabel` to `PromptTagAssignment`,
`20260401110713_add_prompt_tags/migration.sql:56-59`). No migration drops a foreign key. The test
database holds **42 live constraints** (Appendix C): 23 `ON DELETE CASCADE`, 10 `RESTRICT`, 9 `SET NULL`.

- 41 back a schema `@relation`: 17 same-module, 24 cross-module.
- 1 sits on a table with no model: `ReactorOutbox_projectId_fkey`
  (`20260703120000_add_reactor_outbox/migration.sql:64`); the table was never dropped (its
  `DROP TABLE` is commented at :67).
- One is load-bearing for raw SQL: `ProcessManagerOutboxAttempt_outboxId_fkey ON DELETE CASCADE`
  (`20260817120000_outbox_discard_and_attempt_log/migration.sql:36`) removes attempts when
  `packages/eventing/src/server/adapters/postgres/prisma-process-store.ts:748`, :764, :781 and
  `modules/ops/process/src/repositories/prisma/prisma.process-manager-purge.repository.ts:84` delete
  outbox rows with `DELETE FROM "ProcessManagerOutbox"`. No other raw `DELETE` of a parent table
  exists in product code.
- The migration-safety scanner refuses `DROP COLUMN|TABLE` without a retirement note
  (`packages/prisma-client/src/__tests__/migration-safety.rules.ts:64`) and nothing about keys:
  neither adding nor dropping one is checked.

### 1.6 Findings

- **F1 Project has no organization column.** 53 cross-module sites reach an organization's projects
  through `Project.team`. Removing the relation needs a decision (Q-NR1).
- **F2 The erase and the purge rely on emulation.** They delete some children by hand and leave the
  rest to emulated Cascade and SetNull (section 1.7). Removing a relation without its replacement
  orphans rows silently.
- **F3 The erase may already refuse.** `user-data-erase.repository.ts:269` deletes sole-owned projects
  without first deleting `Scenario`, `SimulationSuite`, `Agent`, `Evaluator`, `SavedView`,
  `EmailSuppression`, `ProjectSecret`, `PinnedTrace`, `TraceEditOverlay`, `AnnotationScore`,
  `TriggerSent` or `Analytics` rows, all Restrict children of `Project`; three of them
  (`Scenario`, `SavedView`, `EmailSuppression`) also carry a database `RESTRICT` key. To verify with a
  characterization test in slice 0; if true it is an existing defect, not one this work introduces.
- **F4 An orphan table.** `ReactorOutbox` has no model and still holds a live key to `Project`.
- **F5 A disputed claim.** `Grant` is claimed by share
  (`modules/share/process/src/repositories/prisma/prisma.share-grant.repository.ts:81`) while authz
  makes 19 of its 23 delegate calls; this plan counts it as authz's (Q-NR12).
- **F6 A test pinned to the key.** The slack connection integration test expects the foreign-key
  refusal (Q199(3)); after the drop the service's claim check (409 `slack_connection_in_use`) is the
  only refusal, and the test asserts on that code.
- **F7 Prompt authors were never checked.** `relationMode` emits no key, so a version for an unknown
  author is accepted today (Q90); Alex ruled a check is added, which this plan leaves to its own lane.
- **F8 Unindexed reference columns.** `Team.ownerUserId` :1097, `WebhookEndpointDelivery.triggerId`
  :2514, `ProjectSecret.createdById` :3135 and `.updatedById` :3137, `AnnotationQueueItem.createdByUserId`
  :3323, `PinnedTrace.userId` :3384, `TraceEditOverlay.createdById` :3408 and `.updatedById` :3410,
  `PromptTagAssignment.createdById` :3722 and `.updatedById` :3724, `PromptTag.createdById` :3742 and
  `.updatedById` :3744, `Scenario.testSuiteId` :3906 and `.lastUpdatedById` :3914,
  `RoleBinding.customRoleId` :4144, `RoutingPolicy.createdById` :4857 and `.updatedById` :4859,
  `GatewayGuardrail.createdById` :4935 and `.updatedById` :4937, `IngestionSource.createdById` :5080,
  `AnomalyRule.createdById` :5162, `GatewayBudget.createdById` :5507. An explicit cleanup that
  filters on one of these needs the index first.

### 1.7 Live emulated actions, by parent

Each line: parent [owner], where it is hard-deleted, then the children whose action fires (child
owner in brackets when it differs). Line numbers are `schema.prisma`.

#### Cascade, same-module: 16 live (of 25)

- AiToolEntry [ee:governance] deleted at prisma.ai-tool-catalog:146: AiToolEntryTeam.entryId (:5326), AiToolEntryDepartment.entryId (:5343)
- Dashboard [dashboard] deleted at prisma.dashboard:206, prisma.user-data-erase:259: CustomGraph.dashboardId (:2213)
- Group [organization] deleted at prisma.group:239, prisma.scim:444: GroupMembership.groupId (:4112)
- LlmPromptConfig [prompt] deleted at prisma.user-data-erase:227: LlmPromptConfigVersion.configId (:3688), PromptTagAssignment.configId (:3713)
- LlmPromptConfigVersion [prompt] deleted at prisma.user-data-erase:226: PromptTagAssignment.versionId (:3715)
- ModelDefaultConfig [model-provider] deleted at prisma.model-default:111, prisma.model-default:174, prisma.model-default:195: ModelDefaultConfigScope.configId (:2851)
- ModelProvider [model-provider] deleted at prisma.model-provider:236: ModelProviderScope.modelProviderId (:2783)
- Organization [organization] deleted at prisma.organization-membership:1241, prisma.user-data-erase:281: Group.organizationId (:4085)
- PromptTag [prompt] deleted at prisma.organization-membership:1235, prisma.prompt-tag:149, prisma.prompt-tag:87: PromptTagAssignment.tagId (:3717)
- RoutingPolicy [ee:enterprise-gateway] deleted at prisma.routing-policy:193: RoutingPolicyScope.routingPolicyId (:4880)
- SsoVerifiedDomain [identity] deleted at prisma.sso-connection-projection:259: SsoVerifiedDomainHolder.domain (:829)
- Trigger [automation] deleted at prisma.user-data-erase:260: TriggerLatestEvaluation.triggerId (:3190)
- User [user] deleted at prisma.user-data-erase:288: Account.userId (:44), Passkey.userId (:512)

#### Cascade, cross-module: 31 live (of 31)

- CustomGraph [dashboard] deleted at prisma.dashboard-widget:210, prisma.dashboard:308, prisma.dashboard:402: Trigger.customGraphId [automation] (:2333), TriggerSent.customGraphId [automation] (:3150)
- Group [organization] deleted at prisma.group:239, prisma.scim:444: RoleBinding.groupId [authz] (:4137)
- Organization [organization] deleted at prisma.organization-membership:1241, prisma.user-data-erase:281: ScimRequestLog.organizationId [ee:scim] (:1557), ScimToken.organizationId [ee:scim] (:1583), WebhookEndpoint.organizationId [webhook] (:2415), GithubInstallation.organizationId [github] (:2877), GithubPullRequest.organizationId [github] (:2911), GithubBranchPullRequestCheck.organizationId [github] (:2955), PromptTag.organizationId [prompt] (:3736), Notification.organizationId [notification] (:3787), RoleBinding.organizationId [authz] (:4131), RoutingPolicy.organizationId [ee:enterprise-gateway] (:4813), IngestionSource.organizationId [ee:governance] (:4958), AnomalyRule.organizationId [ee:governance] (:5117), AnomalyAlert.organizationId [ee:governance] (:5187), AiToolEntry.organizationId [ee:governance] (:5249), IngestionTemplate.organizationId [ee:governance] (:5364), GatewayChangeEvent.organizationId [gateway] (:5588)
- Project [project] deleted at prisma.user-data-erase:269: WebhookEndpointDelivery.projectId [webhook] (:2512), Notification.projectId [notification] (:3789), GatewayGuardrail.projectId [gateway] (:4923)
- Team [organization] deleted at prisma.organization-membership:1240, prisma.user-data-erase:274: AiToolEntryTeam.teamId [ee:governance] (:5327)
- Trigger [automation] deleted at prisma.user-data-erase:260: WebhookEndpointDelivery.triggerId [webhook] (:2514)
- User [user] deleted at prisma.user-data-erase:288: AccountCredential.userId [identity] (:84), Session.userId [auth] (:104), TwoFactor.userId [auth] (:432), ScimExternalId.userId [ee:scim] (:1639), ScimUserResource.userId [ee:scim] (:1653), GroupMembership.userId [organization] (:4111), RoleBinding.userId [authz] (:4135)

#### SetNull, same-module: 2 live (of 2)

- AnnotationQueue [annotation] deleted at prisma.user-data-erase:253: AnnotationQueueItem.annotationQueueId (:3317)
- CustomRole [role] deleted at prisma.authz-projection:292: TeamUser.assignedRoleId (:1030)

#### SetNull, cross-module: 32 live (of 34)

- CustomRole [role] deleted at prisma.authz-projection:292: RoleBinding.customRoleId [authz] (:4144)
- Project [project] deleted at prisma.user-data-erase:269: GatewayChangeEvent.projectId [gateway] (:5596)
- RoutingPolicy [ee:enterprise-gateway] deleted at prisma.routing-policy:193: VirtualKey.routingPolicyId [gateway] (:4710)
- Team [organization] deleted at prisma.organization-membership:1240, prisma.user-data-erase:274: IngestionSource.teamId [ee:governance] (:4962)
- User [user] deleted at prisma.user-data-erase:288: Team.ownerUserId [organization] (:1097), Project.ownerUserId [project] (:1841), OrganizationInvite.requestedBy [organization] (:1981), SavedView.userId [dashboard] (:2172), Annotation.userId [annotation] (:2653), AnnotationQueueItem.userId [annotation] (:3319), AnnotationQueueItem.createdByUserId [annotation] (:3323), ShareLink.userId [share] (:3357), PinnedTrace.userId [data-retention] (:3384), TraceEditOverlay.createdById [trace] (:3408), TraceEditOverlay.updatedById [trace] (:3410), Workflow.publishedById [workflow] (:3542), LlmPromptConfigVersion.authorId [prompt] (:3686), PromptTagAssignment.createdById [prompt] (:3722), PromptTagAssignment.updatedById [prompt] (:3724), PromptTag.createdById [prompt] (:3742), PromptTag.updatedById [prompt] (:3744), Scenario.lastUpdatedById [scenario] (:3914), VirtualKey.principalUserId [gateway] (:4654), RoutingPolicy.createdById [ee:enterprise-gateway] (:4857), RoutingPolicy.updatedById [ee:enterprise-gateway] (:4859), GatewayGuardrail.createdById [gateway] (:4935), GatewayGuardrail.updatedById [gateway] (:4937), IngestionSource.createdById [ee:governance] (:5080), AnomalyRule.createdById [ee:governance] (:5162)
- Workflow [workflow] deleted at prisma.user-data-erase:234, prisma.workflow:130: Experiment.workflowId [experiment] (:2552), Agent.workflowId [agent] (:3814), Evaluator.workflowId [evaluator] (:3846)

#### Restrict, same-module: 16 live (of 21)

- AnnotationQueue [annotation] deleted at prisma.user-data-erase:253: AnnotationQueueMembers.annotationQueueId (:3296), AnnotationQueueScores.annotationQueueId (:3307)
- Dataset [dataset] deleted at prisma.dataset-content:204, prisma.user-data-erase:256: DatasetRecord.datasetId (:2135), BatchEvaluation.datasetId (:2243)
- LlmPromptConfig [prompt] deleted at prisma.user-data-erase:227: LlmPromptConfig.copiedFromPromptId (:3661)
- Organization [organization] deleted at prisma.organization-membership:1241, prisma.user-data-erase:281: OrganizationUser.organizationId (:1047), Team.organizationId (:1086), OrganizationInvite.organizationId (:1976)
- SlackIntegration [slack] deleted at prisma.slack-connection:203: SlackConnectionClaim.connectionId (:2386)
- Topic [topic] deleted at prisma.topic-model-projection:120, prisma.topic-model-projection:127, prisma.user-data-erase:263: Topic.parentId (:2073)
- Trigger [automation] deleted at prisma.user-data-erase:260: TriggerSent.triggerId (:3153)
- Workflow [workflow] deleted at prisma.user-data-erase:234, prisma.workflow:130: Workflow.copiedFromWorkflowId (:3548), WorkflowVersion.workflowId (:3569)
- WorkflowVersion [workflow] deleted at prisma.user-data-erase:203, prisma.user-data-erase:233, prisma.workflow:129: Workflow.latestVersionId (:3536), Workflow.currentVersionId (:3538), WorkflowVersion.parentId (:3571)

#### Restrict, cross-module: 47 live (of 48)

- ApiKey [api-key] deleted at prisma.organization-membership:1234: RoleBinding.apiKeyId [authz] (:4139)
- Experiment [experiment] deleted at prisma.user-data-erase:238: Monitor.experimentId [monitor] (:2005), BatchEvaluation.experimentId [dataset] (:2231)
- Organization [organization] deleted at prisma.organization-membership:1241, prisma.user-data-erase:281: IssuedLicense.organizationId [ee:licensing] (:1305), ConnectedBillingAccount.organizationId [ee:billing] (:1437), CustomRole.organizationId [role] (:3768), Subscription.organizationId [ee:billing] (:4043), ApiKey.organizationId [api-key] (:4311)
- Project [project] deleted at prisma.user-data-erase:269: Monitor.projectId [monitor] (:2003), Cost.projectId [evaluation] (:2044), Topic.projectId [topic] (:2070), Dataset.projectId [dataset] (:2097), DatasetRecord.projectId [dataset] (:2137), Dashboard.projectId [dashboard] (:2155), SavedView.projectId [dashboard] (:2170), CustomGraph.projectId [dashboard] (:2195), BatchEvaluation.projectId [dataset] (:2233), Trigger.projectId [automation] (:2282), Experiment.projectId [experiment] (:2550), Annotation.projectId [annotation] (:2648), ProjectSecret.projectId [secret] (:3131), TriggerSent.projectId [automation] (:3152), EmailSuppression.projectId [automation] (:3223), AnnotationScore.projectId [annotation] (:3249), AnnotationQueue.projectId [annotation] (:3281), AnnotationQueueItem.projectId [annotation] (:3331), ShareLink.projectId [share] (:3355), PinnedTrace.projectId [data-retention] (:3381), TraceEditOverlay.projectId [trace] (:3404), Workflow.projectId [workflow] (:3529), WorkflowVersion.projectId [workflow] (:3567), LlmPromptConfig.projectId [prompt] (:3652), Analytics.projectId [analytics] (:3753), Agent.projectId [agent] (:3809), Evaluator.projectId [evaluator] (:3840), Scenario.projectId [scenario] (:3865), SimulationSuite.projectId [suite] (:3965)
- Team [organization] deleted at prisma.organization-membership:1240, prisma.user-data-erase:274: TeamUser.teamId [role] (:1032), Project.teamId [project] (:1772)
- User [user] deleted at prisma.user-data-erase:288: TeamUser.userId [role] (:1031), OrganizationUser.userId [organization] (:1046), ProjectSecret.createdById [secret] (:3135), ProjectSecret.updatedById [secret] (:3137), AnnotationQueueMembers.userId [annotation] (:3295), WorkflowVersion.authorId [workflow] (:3565), ApiKey.userId [api-key] (:4308), GatewayBudget.createdById [gateway] (:5507)

## 2. The target

**Shape.** A reference to another row is a plain scalar column with an index and nothing else, as
the `postgres-migration` skill shows (`.claude/skills/postgres-migration/SKILL.md:52-77`): no
relation field on either side, the `@@index` (or `@unique` for the five one-to-one columns) kept, the
22 unindexed columns of F8 indexed where a cleanup or a read filters on them. No implicit join tables
exist, so no model is added.

**Reads.**

| Today                                            | Same module                                                                                    | Cross-module                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include` / `select` of a relation               | a second query in the owning repository over its own table, batched with `in`, assembled there | the parent owner's `*Api`, one batched call per page (`UserApi.getProfiles`, `user.api.ts:91`; `ProjectApi.listNamesByIds`, `project` contract :81; `OrganizationApi.listTeams` :310) |
| relation filter (`some`, `is`, direct)           | ids from a first query, then `in`; or raw SQL over the module's own tables in its repository   | ids from the peer's `*Api` first, or a column the module owns and keeps current from the peer's facts                                                                                 |
| `orderBy` a relation                             | the repository sorts by its own column                                                         | sort after the batched lookup inside the page, or own a denormalised sort column (Q-NR10)                                                                                             |
| `Project.team.organizationId` lineage (53 sites) | n/a                                                                                            | Q-NR1                                                                                                                                                                                 |

**Writes.** Nested creates of a module's own children become explicit creates in one transaction
(`PrismaRepository.transactionalFor`, as `prisma.annotation-queue-item.repository.ts:141` already
claims two tables). `connect` becomes the scalar column. Project's nested create of gateway's
`GatewayChangeEvent` (`prisma.project.repository.ts:388`) leaves project: gateway records it from a
project fact, or project calls `GatewayApi` (decision for the project slice, Q-NR4).

**Deletes.** Every emulated action becomes behaviour in a service (rule 3: behaviour lives in
`services/`):

| Effective action | Same module                                                                                         | Cross-module (§9.1)                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cascade          | the owning service deletes the children, then the parent, in one repository transaction             | the parent's owner records one deletion fact; each child owner's peer subscriber deletes its own rows, idempotently, with progress per owner                                                      |
| SetNull          | the owning service nulls the column in the same transaction                                         | the child owner's subscriber nulls its column on the fact, or the id is left dangling and readers render the absent parent (Q-NR3)                                                                |
| Restrict         | the owning service checks and refuses by name with a `HandledError` before deleting (status: Q-NR9) | none by default: the reference may dangle and readers tolerate it; where a refusal is product behaviour, the claim pattern slack uses (§3, "A connection in use is claimed, not counted") (Q-NR2) |

A reader never assumes a referenced row exists: an absent parent is filtered out or shown as
absent. This is already true for the 120 relations with no database key, since `relationMode`
never stopped a raw write or a crash between two statements from orphaning a row.

**Guards.** The multi-tenancy guard's `scopes` rules (`multi-tenancy-guard.ts:196-201`, :399-400,
:548-549) need a relation-free form: the scope rows are created in the same transaction by the owning
repository, and the guard accepts a `scopeType`/`scopeId` pair or an id list on the scope table
(Q-NR8). `ownership.ts`'s relation walk, `PrismaRelationException` and `prismaRelationCatalogue` are
deleted in the last slice, with the generator's relation output.

## 3. Migrations

**Schema side.** Removing a relation field writes no SQL under `relationMode = "prisma"`; slice 0
confirms with `prisma migrate diff` that the generated migration is empty and that the 41 live
constraints do not show as drift in either direction. Relation fields go per model, both sides
together, once that model's deletes are explicit.

**Database side.** One blocking schema step, written as a Prisma migration in the last slice:
`ALTER TABLE ... DROP CONSTRAINT IF EXISTS "<name>"` for each of the 42 constraints of Appendix C.
`IF EXISTS` lets an installation whose history differs pass. Each `DROP CONSTRAINT` takes a short
`ACCESS EXCLUSIVE` lock on the child table and a `SHARE ROW EXCLUSIVE` lock on the parent, so the
migration sets a `lock_timeout` and the busy tables (`WebhookEndpointDelivery`,
`ProcessManagerOutboxAttempt`, `Project` as a parent) are retried rather than queued behind traffic.

**Inside the window** (`postgres-migration` skill rule 4; migrations plan 6.12). Dropping a key
removes no column, table or data, so the scanner's retirement note does not apply. It is still a
contract step for any release at or above the floor that relies on the database action:

- every release keeping the `@relation` emulates Cascade, SetNull and Restrict in its own client, so
  the 40 constraints mirrored by a relation can go as soon as no supported release deletes their
  parent with raw SQL; none does today (section 1.5);
- `ProcessManagerOutboxAttempt_outboxId_fkey` waits until `packages/eventing` and ops delete attempts
  explicitly and the first release that does so is at or below the floor;
- `ReactorOutbox_projectId_fkey` goes with the retirement of its table (Q-NR11).

No floor is declared yet (S9), so whether the drop ships before one exists is Alex's (Q-NR6).
Existing orphans are not touched by any migration; slice 0 reports them per model (Q-NR11).

## 4. Enforcement

- **A whole-tree policy, `prisma-relations`**, beside `prisma-table-ownership` in
  `packages/architecture-enforcer/src/policies/persistence/`, reading the schema the way
  `prismaModelNames` does (`prisma-table-ownership.ts:26-50`): it refuses a field whose type is a
  model and any `@relation`. It lands in slice 0 with a shrink-only baseline of the 322 relation fields
  (`tests/baselines/prisma-relations.json`, ratcheted in `tests/boundary-ratchets.unit.test.ts` as
  `eventing-table-access.json` is, ARCHITECTURE.md §7) and reaches zero, without a baseline, in the
  last slice.
- **The migration-safety scanner** gains a rule refusing `FOREIGN KEY` and `REFERENCES` in a new
  migration (`packages/prisma-client/src/__tests__/migration-safety.rules.ts`; the existing 30 files
  go in its baseline as the retirement baseline does), with a spec scenario in
  `specs/ops/migration-safety.feature`.
- **Types do the rest.** Once a relation field is gone, an `include`, a relation filter or a nested
  write over it does not compile, so no oxlint rule is needed.
- **The record** gains one line in §7 beside "A read across organizations is declared, never
  exempted" (proposed, for Alex): "No relations: a reference is a plain indexed column; joins happen in
  the owning repository; cascades are service behaviour or §9.1 facts (Alex, 2026-10-06)."

## 5. Slices

`schema.prisma`, `table-catalogue.ts` and the LangWatchQL manifests are one shared file each: every
slice below edits them, so the coordinator runs schema edits one lane at a time (or applies each
slice's schema lines as a shared-file request) and regenerates both catalogues after each.

Every slice follows the same five steps per model: (1) a characterization test of today's delete
outcome bound to a scenario in the owner's feature file (cascades, nulls, refusals); (2) the explicit
delete in the owning service; (3) the reads rewritten (Appendix B); (4) both relation fields removed
and the baseline lowered; (5) the slice's checks.

| Slice | Scope                                                                                                                                                                                                                                                                                                                                | Depends on         | Size                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------- |
| N0    | Groundwork: the `prisma-relations` policy and baseline; the scanner rule; characterization of Prisma's emulation on `delete` and `deleteMany` and of F3; `prisma migrate diff` check; the orphan report; production key inventory (Q-NR5)                                                                                            | none               | framework, 1 lane           |
| N1    | Same-module relations, 48, per module: prompt 5, workflow 5, organization 5, annotation 4, gateway 4, governance 3, model-provider 2 (with the guard, Q-NR8), identity 2, billing 2, automation 2, dataset 2, user 2, and 1 each in enterprise-gateway, dashboard, role, scenario, webhook, agent, evaluator, topic, slack, eventing | N0                 | about 15 lanes, independent |
| N2    | Deletion facts at the parents' owners: user erased, organization purged, team deleted, project deleted (D8-b already rules one), and the small parents (`CustomGraph`, `Workflow`, `Trigger`, `Group`, `CustomRole`, `RoutingPolicy`, `Experiment`, `Evaluator`, `SimulationSuite`, `ApiKey`)                                        | Q-NR4              | one lane per parent owner   |
| N3    | Cross-module relations, 113, by child owner: a peer subscriber per fact, reads through the parent's `*Api`, relation removed. Order: `Organization` (21) and `Team` (4) children, then `User` (40), then `Project` (33), then the rest (15)                                                                                          | N2 for that parent | one lane per child module   |
| N4    | Project lineage, 53 sites in eight modules                                                                                                                                                                                                                                                                                           | Q-NR1              | 2 to 3 lanes                |
| N5    | The erase and purge rewritten to §9.1 (user and organization stop deleting other modules' rows); joins `ownership-after-parity.md` item 7                                                                                                                                                                                            | N2, N3             | 2 lanes                     |
| N6    | Drop the 42 constraints (section 3), delete the relation guard and catalogue, policy at zero, `relationMode` per Q-NR7                                                                                                                                                                                                               | N1 to N5, Q-NR6    | 1 lane                      |

Order inside N3 puts `Organization` and `Team` first because their purge is one deleter
(`prisma.organization-membership.repository.ts:1210-1241`) and their children are mostly enterprise
modules with one table each; `User` next because 25 of its 40 children are SetNull columns whose
answer is Q-NR3; `Project` last because its children are the busiest tables.

## 6. Risks

- **N+1 and page cost.** An `include` becomes a second query; across modules it becomes an `*Api`
  call. Every replacement batches per page, never per row. The hot ones: member listings
  (`OrganizationUser.user`, 17 sites, two sorting by the user), virtual-key listings (28 sites),
  group membership in authz (8), project lists by organization (53). A slice that turns one SQL join
  into a page of lookups measures it with the integration suite's timings before and after.
- **Sorting and filtering by another module's field** (`orderBy` user name, `where: { user: { email } }`)
  cannot be paged correctly from a lookup alone; it needs a denormalised column fed by facts or a
  read model (Q-NR10).
- **Eventual purge.** Between a parent's deletion and a child owner's subscriber, the children exist.
  Tenant scoping is unchanged, so nothing leaks across tenants, but a list can briefly show rows of a
  deleted project or team. Readers filter on the parent's existence where it matters.
- **Lost refusals.** 63 live Restrict actions refuse deletes today (16 same-module, 47 cross). Each
  same-module one becomes an explicit refusal; each cross-module one is dropped or claimed per Q-NR2.
  If main surfaced an emulated refusal as an error status, a named refusal changes that status: each
  such row is a wire difference to record with its reason, or to avoid (Q-NR9).
- **Raw SQL that relied on a key** (`ProcessManagerOutboxAttempt`, section 1.5) orphans attempts if
  the key goes first.
- **Shared schema file.** Parallel slices conflict on `schema.prisma` and the generated catalogues.
- **Characterization gaps.** Whether Prisma emulates actions on `deleteMany` (the erase uses it at
  every step) is asserted by N0's test, not assumed; F3 depends on it.
- **Tests.** 19 test files read relations and the slack test pins the key's error (F6); each moves
  in its model's slice.
- **Production may differ from the history.** Databases created before `0_init`, or by `db push`, can
  hold keys the migrations never wrote; `IF EXISTS` covers fewer, not more (Q-NR5).

Wire differences: none intended. Candidates, decided per row in their slice: a delete that refused
by emulated Restrict and now succeeds or refuses with a named code; a list that showed a parent's
name through `include` and now shows an absent parent after a purge.

## 7. Questions for Alex

1. **Q-NR1 Project lineage.** `Project` reaches its organization only through `Team` (53 sites).
   (a) Project owns an `organizationId` column, written at create, filled for existing rows by an
   inline blocking DML step from `Team`, never changed (a team never moves organization); (b) callers
   ask `OrganizationApi` for the team ids, then filter by `teamId in`; (c) the door's resolved scope
   (Lineage D1) where a request has one, plus (a) or (b) for worker paths. Recommended: (a) with (c).
2. **Q-NR2 Cross-module Restrict** (47 live). Let the reference dangle (default), or claim per parent
   as slack does? Candidates for a claim: `ApiKey` referenced by `RoleBinding`, `Experiment` by
   `Monitor` and `BatchEvaluation`.
3. **Q-NR3 User erase and the 25 SetNull columns** (`createdById`, `updatedById`, `authorId`,
   `userId`): owners null them on a user-erased fact, or the id stays and readers show a deleted user?
4. **Q-NR4 Deletion facts.** Confirm new fact events in user, organization, team (organization),
   project (already D8-b) and the small parents of N2, each a contract change with peer subscribers;
   and how project's `GatewayChangeEvent` write leaves project.
5. **Q-NR5 Production inventory.** May an operator run a read-only `pg_constraint` query on cloud and
   ask self-hosted support for one, before N6?
6. **Q-NR6 Drop before a floor?** The constraint drop removes no column; ship it in the release that
   finishes N5, or wait for S9?
7. **Q-NR7 `relationMode`.** Once no relation remains it is inert. Keep the line as a second guard
   against generated keys, or delete it?
8. **Q-NR8 Tenancy guard.** Replace the nested `scopes` create requirement with scope rows written
   explicitly in the same transaction and checked by `scopeType`/`scopeId`, as proposed?
9. **Q-NR9 Status of a lost Restrict.** When a same-module delete must still refuse, is a named 409
   right even where main returned whatever the unhandled Prisma error mapped to?
10. **Q-NR10 Sorting by another module's field.** Member lists sort by user name today
    (`prisma.organization-membership.repository.ts:1370`, :1615). Sort inside the page after lookup
    (a visible change on multi-page lists), or keep a denormalised name fed by user facts?
11. **Q-NR11 Orphans and `ReactorOutbox`.** Report existing orphans only, or delete them with a
    background step per owner? Retire the model-less `ReactorOutbox` table in this work?
12. **Q-NR12 `Grant`'s owner.** Share claims it, authz uses it (F5). Which module owns it?
13. **Q-NR13 Timing.** §9.1 says ownership moves that change no behaviour wait until the branch
    matches main (ARCHITECTURE.md §9.1, second paragraph). Does this ruling run before release, or
    after parity?

## Appendix A. Relations by owning module of the child

`:line` is `schema.prisma`. `[owner]` marks a cross-module parent. An action with `*` is Prisma's
default (none written). `FK` marks a live database constraint. `back` names the parent's
back-relation field and its line.

**agent** (3: 1 same, 2 cross)

- :3809 `Agent.project` -> Project [project] Restrict*; back `Project.agents@1824`
- :3814 `Agent.workflow` -> Workflow [workflow] SetNull*; back `Workflow.agents@3550`
- :3816 `Agent.copiedFrom` -> Agent Restrict FK; back `Agent.copiedAgents@3817`

**analytics** (1: 0 same, 1 cross)

- :3753 `Analytics.project` -> Project [project] Restrict*; back `Project.analytics@1821`

**annotation** (12: 4 same, 8 cross)

- :2648 `Annotation.project` -> Project [project] Restrict*; back `Project.annotations@1806`
- :2653 `Annotation.user` -> User [user] SetNull*; back `User.Annotation@238`
- :3249 `AnnotationScore.project` -> Project [project] Restrict*; back `Project.annotationScores@1810`
- :3281 `AnnotationQueue.project` -> Project [project] Restrict*; back `Project.AnnotationQueue@1814`
- :3295 `AnnotationQueueMembers.user` -> User [user] Restrict*; back `User.annotationQueues@242`
- :3296 `AnnotationQueueMembers.annotationQueue` -> AnnotationQueue Restrict*; back `AnnotationQueue.members@3282`
- :3306 `AnnotationQueueScores.annotationScore` -> AnnotationScore Restrict*; back `AnnotationScore.AnnotationQueueScores@3259`
- :3307 `AnnotationQueueScores.annotationQueue` -> AnnotationQueue Restrict*; back `AnnotationQueue.AnnotationQueueScores@3285`
- :3317 `AnnotationQueueItem.annotationQueue` -> AnnotationQueue SetNull*; back `AnnotationQueue.AnnotationQueueItems@3286`
- :3319 `AnnotationQueueItem.user` -> User [user] SetNull*; back `User.assignedQueueItems@243`
- :3323 `AnnotationQueueItem.createdByUser` -> User [user] SetNull*; back `User.createdQueueItems@244`
- :3331 `AnnotationQueueItem.project` -> Project [project] Restrict*; back `Project.AnnotationQueueItem@1815`

**api-key** (2: 0 same, 2 cross)

- :4308 `ApiKey.user` -> User [user] Restrict; back `User.apiKeys@258`
- :4311 `ApiKey.organization` -> Organization [organization] Restrict; back `Organization.apiKeys@1231`

**auth** (2: 0 same, 2 cross)

- :104 `Session.user` -> User [user] Cascade; back `User.sessions@197`
- :432 `TwoFactor.user` -> User [user] Cascade; back `User.twoFactors@198`

**authz** (5: 0 same, 5 cross)

- :4131 `RoleBinding.organization` -> Organization [organization] Cascade; back `Organization.roleBindings@1230`
- :4135 `RoleBinding.user` -> User [user] Cascade; back `User.roleBindings@256`
- :4137 `RoleBinding.group` -> Group [organization] Cascade; back `Group.roleBindings@4095`
- :4139 `RoleBinding.apiKey` -> ApiKey [api-key] Restrict; back `ApiKey.roleBindings@4312`
- :4144 `RoleBinding.customRole` -> CustomRole [role] SetNull*; back `CustomRole.roleBindings@3776`

**automation** (7: 2 same, 5 cross)

- :2282 `Trigger.project` -> Project [project] Restrict*; back `Project.triggers@1804`
- :2333 `Trigger.customGraph` -> CustomGraph [dashboard] Cascade; back `CustomGraph.trigger@2220`
- :3150 `TriggerSent.customGraph` -> CustomGraph [dashboard] Cascade FK; back `CustomGraph.TriggerSent@2221`
- :3152 `TriggerSent.project` -> Project [project] Restrict*; back `Project.TriggerSent@1808`
- :3153 `TriggerSent.trigger` -> Trigger Restrict*; back `Trigger.TriggerSent@2329`
- :3190 `TriggerLatestEvaluation.trigger` -> Trigger Cascade FK; back `Trigger.latestEvaluation@2331`
- :3223 `EmailSuppression.project` -> Project [project] Restrict* FK; back `Project.emailSuppressions@1833`

**dashboard** (5: 1 same, 4 cross)

- :2155 `Dashboard.project` -> Project [project] Restrict*; back `Project.dashboards@1800`
- :2170 `SavedView.project` -> Project [project] Restrict* FK; back `Project.savedViews@1828`
- :2172 `SavedView.user` -> User [user] SetNull* FK; back `User.savedViews@250`
- :2195 `CustomGraph.project` -> Project [project] Restrict*; back `Project.customGraphs@1799`
- :2213 `CustomGraph.dashboard` -> Dashboard Cascade; back `Dashboard.graphs@2160`

**data-retention** (2: 0 same, 2 cross)

- :3381 `PinnedTrace.project` -> Project [project] Restrict*; back `Project.pinnedTraces@1831`
- :3384 `PinnedTrace.user` -> User [user] SetNull*; back `User.pinnedTraces@269`

**dataset** (6: 2 same, 4 cross)

- :2097 `Dataset.project` -> Project [project] Restrict*; back `Project.datasets@1797`
- :2135 `DatasetRecord.dataset` -> Dataset Restrict*; back `Dataset.datasetRecords@2104`
- :2137 `DatasetRecord.project` -> Project [project] Restrict*; back `Project.datasetRecords@1798`
- :2231 `BatchEvaluation.experiment` -> Experiment [experiment] Restrict*; back `Experiment.batchEvaluations@2556`
- :2233 `BatchEvaluation.project` -> Project [project] Restrict*; back `Project.batchEvaluations@1801`
- :2243 `BatchEvaluation.dataset` -> Dataset Restrict*; back `Dataset.batchEvaluations@2105`

**ee:billing** (4: 2 same, 2 cross)

- :1437 `ConnectedBillingAccount.organization` -> Organization [organization] Restrict; back `Organization.connectedBilling@1262`
- :4043 `Subscription.organization` -> Organization [organization] Restrict* FK; back `Organization.subscriptions@1225`
- :4059 `Invoice.subscription` -> Subscription Restrict* FK; back `Subscription.invoices@4044`
- :4073 `InvoiceItem.invoice` -> Invoice Restrict* FK; back `Invoice.lineItems@4060`

**ee:enterprise-gateway** (4: 1 same, 3 cross)

- :4813 `RoutingPolicy.organization` -> Organization [organization] Cascade; back `Organization.routingPolicies@1264`
- :4857 `RoutingPolicy.createdBy` -> User [user] SetNull; back `User.routingPoliciesCreated@263`
- :4859 `RoutingPolicy.updatedBy` -> User [user] SetNull; back `User.routingPoliciesUpdated@264`
- :4880 `RoutingPolicyScope.routingPolicy` -> RoutingPolicy Cascade; back `RoutingPolicy.scopes@4869`

**ee:governance** (12: 3 same, 9 cross)

- :4958 `IngestionSource.organization` -> Organization [organization] Cascade FK; back `Organization.ingestionSources@1265`
- :4962 `IngestionSource.team` -> Team [organization] SetNull FK; back `Team.ingestionSources@1099`
- :5080 `IngestionSource.createdBy` -> User [user] SetNull FK; back `User.ingestionSourcesCreated@267`
- :5117 `AnomalyRule.organization` -> Organization [organization] Cascade FK; back `Organization.anomalyRules@1266`
- :5162 `AnomalyRule.createdBy` -> User [user] SetNull FK; back `User.anomalyRulesCreated@268`
- :5187 `AnomalyAlert.organization` -> Organization [organization] Cascade FK; back `Organization.anomalyAlerts@1267`
- :5189 `AnomalyAlert.rule` -> AnomalyRule Cascade FK; back `AnomalyRule.alerts@5164`
- :5249 `AiToolEntry.organization` -> Organization [organization] Cascade FK; back `Organization.aiToolEntries@1268`
- :5326 `AiToolEntryTeam.entry` -> AiToolEntry Cascade FK; back `AiToolEntry.teams@5305`
- :5327 `AiToolEntryTeam.team` -> Team [organization] Cascade FK; back `Team.aiToolEntryTeams@1100`
- :5343 `AiToolEntryDepartment.entry` -> AiToolEntry Cascade FK; back `AiToolEntry.departments@5312`
- :5364 `IngestionTemplate.organization` -> Organization [organization] Cascade; back `Organization.ingestionTemplates@1269`

**ee:licensing** (1: 0 same, 1 cross)

- :1305 `IssuedLicense.organization` -> Organization [organization] Restrict; back `Organization.issuedLicenses@1261`

**ee:scim** (4: 0 same, 4 cross)

- :1557 `ScimRequestLog.organization` -> Organization [organization] Cascade; back `Organization.scimRequestLog@1227`
- :1583 `ScimToken.organization` -> Organization [organization] Cascade; back `Organization.scimTokens@1226`
- :1639 `ScimExternalId.user` -> User [user] Cascade FK; back `User.scimExternalIds@257`
- :1653 `ScimUserResource.user` -> User [user] Cascade; back `User.scimUserResources@202`

**evaluation** (1: 0 same, 1 cross)

- :2044 `Cost.project` -> Project [project] Restrict*; back `Project.costs@1795`

**evaluator** (3: 1 same, 2 cross)

- :3840 `Evaluator.project` -> Project [project] Restrict*; back `Project.evaluators@1825`
- :3846 `Evaluator.workflow` -> Workflow [workflow] SetNull*; back `Workflow.evaluators@3551`
- :3848 `Evaluator.copiedFrom` -> Evaluator Restrict FK; back `Evaluator.copiedEvaluators@3849`

**experiment** (2: 0 same, 2 cross)

- :2550 `Experiment.project` -> Project [project] Restrict*; back `Project.experiments@1805`
- :2552 `Experiment.workflow` -> Workflow [workflow] SetNull*; back `Workflow.experiments@3544`

**gateway** (13: 4 same, 9 cross)

- :4654 `VirtualKey.principalUser` -> User [user] SetNull; back `User.principalVirtualKeys@260`
- :4710 `VirtualKey.routingPolicy` -> RoutingPolicy [ee:enterprise-gateway] SetNull; back `RoutingPolicy.virtualKeys@4864`
- :4774 `VirtualKeyScope.virtualKey` -> VirtualKey Cascade; back `VirtualKey.scopes@4700`
- :4923 `GatewayGuardrail.project` -> Project [project] Cascade; back `Project.gatewayGuardrails@1829`
- :4927 `GatewayGuardrail.evaluator` -> Evaluator [evaluator] Restrict; back `Evaluator.gatewayGuardrails@3851`
- :4935 `GatewayGuardrail.createdBy` -> User [user] SetNull; back `User.gatewayGuardrailsCreated@265`
- :4937 `GatewayGuardrail.updatedBy` -> User [user] SetNull; back `User.gatewayGuardrailsUpdated@266`
- :5507 `GatewayBudget.createdBy` -> User [user] Restrict*; back `User.gatewayBudgetsCreated@259`
- :5536 `GatewayBudgetBucketBoundary.budget` -> GatewayBudget Cascade FK; back `GatewayBudget.bucketBoundaries@5510`
- :5551 `GatewayBudgetLedger.budget` -> GatewayBudget Cascade; back `GatewayBudget.ledgerEntries@5509`
- :5554 `GatewayBudgetLedger.virtualKey` -> VirtualKey Cascade; back `VirtualKey.ledgerEntries@4701`
- :5588 `GatewayChangeEvent.organization` -> Organization [organization] Cascade; back `Organization.gatewayChangeEvents@1263`
- :5596 `GatewayChangeEvent.project` -> Project [project] SetNull; back `Project.gatewayChangeEvents@1830`

**github** (3: 0 same, 3 cross)

- :2877 `GithubInstallation.organization` -> Organization [organization] Cascade; back `Organization.githubInstallations@1270`
- :2911 `GithubPullRequest.organization` -> Organization [organization] Cascade; back `Organization.githubPullRequests@1271`
- :2955 `GithubBranchPullRequestCheck.organization` -> Organization [organization] Cascade; back `Organization.githubBranchPrChecks@1272`

**identity** (3: 2 same, 1 cross)

- :84 `AccountCredential.user` -> User [user] Cascade; back `User.accountCredentials@196`
- :718 `SsoConnectionReproofCursor.connection` -> SsoConnection Cascade; back `SsoConnection.reproofCursor@675`
- :829 `SsoVerifiedDomainHolder.ownership` -> SsoVerifiedDomain Cascade FK; back `SsoVerifiedDomain.holders@809`

**model-provider** (2: 2 same, 0 cross)

- :2783 `ModelProviderScope.modelProvider` -> ModelProvider Cascade FK; back `ModelProvider.scopes@2747`
- :2851 `ModelDefaultConfigScope.config` -> ModelDefaultConfig Cascade FK; back `ModelDefaultConfig.scopes@2832`

**monitor** (3: 0 same, 3 cross)

- :2003 `Monitor.project` -> Project [project] Restrict*; back `Project.checks@1794`
- :2005 `Monitor.experiment` -> Experiment [experiment] Restrict; back `Experiment.monitor@2558`
- :2007 `Monitor.evaluator` -> Evaluator [evaluator] SetNull*; back `Evaluator.monitors@3850`

**notification** (2: 0 same, 2 cross)

- :3787 `Notification.organization` -> Organization [organization] Cascade; back `Organization.notifications@1224`
- :3789 `Notification.project` -> Project [project] Cascade; back `Project.notifications@1823`

**organization** (9: 5 same, 4 cross)

- :1046 `OrganizationUser.user` -> User [user] Restrict*; back `User.orgMemberships@201`
- :1047 `OrganizationUser.organization` -> Organization Restrict*; back `Organization.members@1116`
- :1086 `Team.organization` -> Organization Restrict*; back `Organization.teams@1117`
- :1097 `Team.ownerUser` -> User [user] SetNull*; back `User.personalTeams@261`
- :1976 `OrganizationInvite.organization` -> Organization Restrict*; back `Organization.OrganizationInvite@1121`
- :1981 `OrganizationInvite.requestedByUser` -> User [user] SetNull*; back `User.inviteRequests@247`
- :4085 `Group.organization` -> Organization Cascade; back `Organization.groups@1229`
- :4111 `GroupMembership.user` -> User [user] Cascade; back `User.groupMemberships@255`
- :4112 `GroupMembership.group` -> Group Cascade; back `Group.members@4094`

**package:eventing** (1: 1 same, 0 cross)

- :5829 `ProcessManagerOutboxAttempt.outbox` -> ProcessManagerOutbox Cascade FK; back `ProcessManagerOutbox.attemptLog@5804`

**project** (2: 0 same, 2 cross)

- :1772 `Project.team` -> Team [organization] Restrict*; back `Team.projects@1087`
- :1841 `Project.ownerUser` -> User [user] SetNull*; back `User.personalProjects@262`

**prompt** (12: 5 same, 7 cross)

- :3652 `LlmPromptConfig.project` -> Project [project] Restrict*; back `Project.llmPromptConfigs@1820`
- :3661 `LlmPromptConfig.copiedFrom` -> LlmPromptConfig Restrict; back `LlmPromptConfig.copiedPrompts@3662`
- :3686 `LlmPromptConfigVersion.author` -> User [user] SetNull*; back `User.llmPromptConfigVersions@245`
- :3688 `LlmPromptConfigVersion.config` -> LlmPromptConfig Cascade; back `LlmPromptConfig.versions@3665`
- :3713 `PromptTagAssignment.config` -> LlmPromptConfig Cascade FK; back `LlmPromptConfig.versionTags@3668`
- :3715 `PromptTagAssignment.version` -> LlmPromptConfigVersion Cascade FK; back `LlmPromptConfigVersion.versionTags@3702`
- :3717 `PromptTagAssignment.promptTag` -> PromptTag Cascade; back `PromptTag.assignments@3738`
- :3722 `PromptTagAssignment.createdBy` -> User [user] SetNull* FK; back `User.versionTagsCreated@251`
- :3724 `PromptTagAssignment.updatedBy` -> User [user] SetNull* FK; back `User.versionTagsUpdated@252`
- :3736 `PromptTag.organization` -> Organization [organization] Cascade FK; back `Organization.promptTags@1228`
- :3742 `PromptTag.createdBy` -> User [user] SetNull* FK; back `User.promptTagsCreated@253`
- :3744 `PromptTag.updatedBy` -> User [user] SetNull* FK; back `User.promptTagsUpdated@254`

**role** (4: 1 same, 3 cross)

- :1030 `TeamUser.assignedRole` -> CustomRole SetNull*; back `CustomRole.assignedUsers@3775`
- :1031 `TeamUser.user` -> User [user] Restrict*; back `User.teamMemberships@200`
- :1032 `TeamUser.team` -> Team [organization] Restrict*; back `Team.members@1084`
- :3768 `CustomRole.organization` -> Organization [organization] Restrict*; back `Organization.CustomRoles@1223`

**scenario** (4: 1 same, 3 cross)

- :3865 `Scenario.project` -> Project [project] Restrict* FK; back `Project.scenarios@1826`
- :3906 `Scenario.testSuite` -> SimulationSuite [suite] SetNull; back `SimulationSuite.testSuiteScenarios@4004`
- :3914 `Scenario.lastUpdatedBy` -> User [user] SetNull* FK; back `User.scenarios@246`
- :3933 `ScenarioVersion.scenario` -> Scenario Cascade; back `Scenario.versions@3912`

**secret** (3: 0 same, 3 cross)

- :3131 `ProjectSecret.project` -> Project [project] Restrict*; back `Project.projectSecrets@1807`
- :3135 `ProjectSecret.createdBy` -> User [user] Restrict*; back `User.secretsCreated@248`
- :3137 `ProjectSecret.updatedBy` -> User [user] Restrict*; back `User.secretsUpdated@249`

**share** (2: 0 same, 2 cross)

- :3355 `ShareLink.project` -> Project [project] Restrict*; back `Project.shareLinks@1811`
- :3357 `ShareLink.user` -> User [user] SetNull*; back `User.shareLinks@239`

**slack** (1: 1 same, 0 cross)

- :2386 `SlackConnectionClaim.connection` -> SlackIntegration Restrict FK; back `SlackIntegration.claims@2375`

**suite** (1: 0 same, 1 cross)

- :3965 `SimulationSuite.project` -> Project [project] Restrict*; back `Project.suiteConfigurations@1827`

**topic** (2: 1 same, 1 cross)

- :2070 `Topic.project` -> Project [project] Restrict*; back `Project.topics@1796`
- :2073 `Topic.parent` -> Topic Restrict; back `Topic.subtopics@2074`

**trace** (3: 0 same, 3 cross)

- :3404 `TraceEditOverlay.project` -> Project [project] Restrict*; back `Project.traceEditOverlays@1832`
- :3408 `TraceEditOverlay.createdBy` -> User [user] SetNull*; back `User.traceEditOverlaysCreated@270`
- :3410 `TraceEditOverlay.updatedBy` -> User [user] SetNull*; back `User.traceEditOverlaysUpdated@271`

**user** (2: 2 same, 0 cross)

- :44 `Account.user` -> User Cascade; back `User.accounts@195`
- :512 `Passkey.user` -> User Cascade; back `User.passkeys@199`

**webhook** (4: 1 same, 3 cross)

- :2415 `WebhookEndpoint.organization` -> Organization [organization] Cascade FK; back `Organization.webhookEndpoints@1118`
- :2509 `WebhookEndpointDelivery.endpoint` -> WebhookEndpoint Cascade FK; back `WebhookEndpoint.deliveries@2466`
- :2512 `WebhookEndpointDelivery.project` -> Project [project] Cascade FK; back `Project.webhookDeliveries@1809`
- :2514 `WebhookEndpointDelivery.trigger` -> Trigger [automation] Cascade FK; back `Trigger.webhookDeliveries@2330`

**workflow** (9: 5 same, 4 cross)

- :3529 `Workflow.project` -> Project [project] Restrict*; back `Project.workflows@1812`
- :3536 `Workflow.latestVersion` -> WorkflowVersion Restrict; back `WorkflowVersion.WorkflowAsLatestVersion@3577`
- :3538 `Workflow.currentVersion` -> WorkflowVersion Restrict; back `WorkflowVersion.WorkflowAsCurrentVersion@3578`
- :3542 `Workflow.publishedBy` -> User [user] SetNull*; back `User.Workflow@240`
- :3548 `Workflow.copiedFrom` -> Workflow Restrict; back `Workflow.copiedWorkflows@3549`
- :3565 `WorkflowVersion.author` -> User [user] Restrict*; back `User.WorkflowVersion@241`
- :3567 `WorkflowVersion.project` -> Project [project] Restrict*; back `Project.WorkflowVersion@1813`
- :3569 `WorkflowVersion.workflow` -> Workflow Restrict*; back `Workflow.versions@3539`
- :3571 `WorkflowVersion.parent` -> WorkflowVersion Restrict; back `WorkflowVersion.children@3572`

## Appendix B. Query sites using a relation, by module of the file

`kind field(operator)`, with `*` where the site crosses a module boundary (the file's module differs from the owner of the model or of the related model). Sites found by name only carry no mark.

**annotation** (33 hits, 7 cross-module)

- `modules/annotation/process/src/repositories/prisma/prisma.annotation-queue-item.repository.ts` :32 filter orgMemberships(some), :51 filter orgMemberships(some), :70 filter members(some), :95 include members, :96 include AnnotationQueueScores, :206 include user*, :207 include createdByUser*, :208 include annotationQueue, :210 include members, :210 filter user*, :210 filter orgMemberships(some)_, :225 filter annotationQueue, :225 filter members(some), :239 filter members(some), :304 filter members(some), :357 include members, :358 include AnnotationQueueScores, :359 include AnnotationQueueItems, :362 filter user_, :362 filter orgMemberships(some)_, :364 include user_, :364 include annotationQueue
- `modules/annotation/process/src/repositories/prisma/prisma.annotation-queue.repository.ts` :23 filter orgMemberships(some), :66 write members(create), :67 write AnnotationQueueScores(create), :93 write members(deleteMany|create), :94 write AnnotationQueueScores(deleteMany|create), :116 filter members(some), :117 filter AnnotationQueueItems(some), :134 include members, :135 include AnnotationQueueScores, :148 include members, :149 include AnnotationQueueScores

**api-key** (1 hits, 1 cross-module)

- `modules/api-key/process/src/repositories/prisma/prisma.api-key.repository.ts` :51 filter user*

**auth** (4 hits, 4 cross-module)

- `modules/auth/process/src/repositories/prisma/prisma.auth-directory.repository.ts` :93 filter team*
- `modules/auth/process/src/repositories/prisma/prisma.better-auth-hooks.repository.ts` :169 count orgMemberships*
- `modules/auth/process/src/repositories/prisma/prisma.pending-sso-setup.repository.ts` :31 select accounts*
- `modules/auth/process/src/repositories/prisma/prisma.sign-in-security-settings.repository.ts` :46 filter members(some)*

**authz** (22 hits, 22 cross-module)

- `modules/authz/process/src/repositories/eventing/eventing.authz-listing.repository.ts` :224 filter orgMemberships(some)_, :301 filter group_, :302 select group*
- `modules/authz/process/src/repositories/eventing/eventing.authz-read.repository.ts` :98 filter group*, :290 select team*
- `modules/authz/process/src/repositories/prisma/prisma.authz-ledger-read.repository.ts` :307 filter group*, :310 filter team*
- `modules/authz/process/src/repositories/prisma/prisma.authz-managed-grant.repository.ts` :143 filter team*, :182 filter team*, :187 select team*, :233 filter group*, :234 filter user*, :234 filter orgMemberships(some)_, :250 filter group_, :253 select group*, :273 filter team*, :274 filter user*, :274 filter orgMemberships(some)*
- `modules/authz/process/src/repositories/prisma/prisma.authz-migration.repository.ts` :220 filter team*, :247 filter group*, :262 filter team*, :415 filter team*

**dashboard** (1 hits, 0 cross-module)

- `modules/dashboard/process/src/repositories/prisma/prisma.dashboard.repository.ts` :144 include graphs

**data-privacy** (4 hits, 4 cross-module)

- `modules/data-privacy/process/src/repositories/prisma/prisma.data-privacy-directory.repository.ts` :38 select team*, :41 select organization*, :73 filter team*, :119 select team*

**data-retention** (4 hits, 4 cross-module)

- `modules/data-retention/process/src/repositories/prisma/prisma.data-retention-directory.repository.ts` :55 select team*, :58 select organization*, :85 filter team*, :121 select team*

**dataset** (1 hits, 0 cross-module)

- `modules/dataset/process/src/repositories/prisma/prisma.batch-evaluation.repository.ts` :48 include dataset

**ee:billing** (4 hits, 4 cross-module)

- `enterprise/modules/billing/process/src/repositories/prisma/prisma.billing-report-organization.repository.ts` :67 select subscriptions*
- `enterprise/modules/billing/process/src/repositories/prisma/prisma.subscription.repository.ts` :163 include organization*, :258 include organization*
- `enterprise/modules/billing/process/src/tasks/tiered-free-to-seat-event.task.ts` :43 filter subscriptions(none)*

**ee:enterprise-gateway** (14 hits, 0 cross-module)

- `enterprise/modules/enterprise-gateway/process/src/repositories/prisma/prisma.routing-policy.repository.ts` :54 include scopes, :63 include scopes, :75 filter scopes(some), :99 write scopes(create), :101 include scopes, :109 write updatedBy(connect), :128 include scopes, :152 include scopes, :159 filter scopes(some), :174 include scopes, :210 filter scopes(some), :215 include scopes, :223 filter scopes(some), :231 include scopes

**ee:governance** (16 hits, 10 cross-module)

- `enterprise/modules/governance/process/src/repositories/prisma/prisma.ai-tool-catalog.repository.ts` :48 include departments, :57 include departments, :65 include departments, :99 include departments, :139 include departments, :148 include departments
- `enterprise/modules/governance/process/src/repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts` :153 filter organization*, :154 filter teams(some)_, :154 filter projects(some)_
- `enterprise/modules/governance/process/src/repositories/prisma/prisma.ingestion-source-activity.repository.ts` :470 filter team*, :631 select user*, :634 select teamMemberships*, :636 filter team*, :642 select team*, :764 select team*, :976 select team*

**ee:scim** (11 hits, 10 cross-module)

- `enterprise/modules/scim/process/src/repositories/prisma/prisma.scim.repository.ts` :123 include user*, :155 filter scimUserResources(none), :170 include user*, :180 include user*, :253 include user*, :266 filter user*, :267 filter scimUserResources(none)_, :349 filter members(some)_, :390 include members*, :391 include user*, :449 include user*

**entitlement** (7 hits, 7 cross-module)

- `modules/entitlement/process/src/repositories/prisma/prisma.organization-spend.repository.ts` :27 filter team*, :29 filter members(some)_, :33 filter team_, :35 filter organization*, :35 filter members(some)*
- `modules/entitlement/process/src/repositories/prisma/prisma.usage-membership.repository.ts` :31 filter team*, :44 filter team*

**experiment** (1 hits, 1 cross-module)

- `modules/experiment/process/src/repositories/prisma/prisma.experiment-workflow-version.repository.ts` :32 select author*

**gateway** (51 hits, 32 cross-module)

- `modules/gateway/process/src/repositories/prisma/prisma.gateway-budget-scope-reach.repository.ts` :21 include scopes
- `modules/gateway/process/src/repositories/prisma/prisma.gateway-budget-scope-target.repository.ts` :148 filter orgMemberships(some)*, :330 select scopes
- `modules/gateway/process/src/repositories/prisma/prisma.gateway-guardrail.repository.ts` :58 include evaluator*
- `modules/gateway/process/src/repositories/prisma/prisma.gateway-internal-store.repository.ts` :34 include scopes, :37 include principalUser*, :42 include routingPolicy*
- `modules/gateway/process/src/repositories/prisma/prisma.gateway-scope-resolution.repository.ts` :65 filter scopes(some)*
- `modules/gateway/process/src/repositories/prisma/prisma.gateway-virtual-key-config-backfill.repository.ts` :72 write scopes(create)*
- `modules/gateway/process/src/repositories/prisma/prisma.virtual-key-authorization.repository.ts` :61 select scopes
- `modules/gateway/process/src/repositories/prisma/prisma.virtual-key.repository.ts` :57 include scopes, :58 include principalUser*, :59 include routingPolicy*, :91 include scopes, :92 include principalUser*, :93 include routingPolicy*, :118 include scopes, :119 include principalUser*, :120 include routingPolicy*, :160 include scopes, :161 include principalUser*, :162 include routingPolicy*, :181 include scopes, :182 include principalUser*, :183 include routingPolicy*, :209 include scopes, :210 include principalUser*, :211 include routingPolicy*, :232 filter scopes(some), :237 include scopes, :238 include principalUser*, :239 include routingPolicy*, :273 write scopes(create), :281 include scopes, :282 include principalUser*, :283 include routingPolicy*, :320 include scopes, :321 include principalUser*, :322 include routingPolicy*, :391 include scopes, :392 include principalUser*, :393 include routingPolicy*, :422 include scopes, :423 include principalUser*, :424 include routingPolicy*, :457 include scopes, :458 include principalUser*, :459 include routingPolicy*, :506 include scopes, :507 include principalUser*, :508 include routingPolicy*

**identity** (21 hits, 14 cross-module)

- `modules/identity/process/src/repositories/prisma/prisma.identity-lookup.repository.ts` :108 select organization*, :128 select organization*, :129 select requestedByUser*
- `modules/identity/process/src/repositories/prisma/prisma.identity-signin-accounts.repository.ts` :53 select accounts*, :54 select accountCredentials*, :55 select passkeys*
- `modules/identity/process/src/repositories/prisma/prisma.join-request-audience.repository.ts` :52 select user*
- `modules/identity/process/src/repositories/prisma/prisma.mfa-enrollment.repository.ts` :39 select orgMemberships*, :40 filter organization*, :41 select organization*
- `modules/identity/process/src/repositories/prisma/prisma.sso-connection-projection.repository.ts` :260 filter holders(none), :285 select holders
- `modules/identity/process/src/repositories/prisma/prisma.sso-connection-reads.repository.ts` :63 select holders
- `modules/identity/process/src/repositories/prisma/prisma.sso-connection-routing.repository.ts` :58 select holders
- `modules/identity/process/src/repositories/prisma/prisma.sso-domain-reproof.repository.ts` :75 filter reproofCursor(is), :85 filter reproofCursor(isNot), :87 orderBy reproofCursor
- `modules/identity/process/src/repositories/prisma/prisma.two-step-verification.repository.ts` :48 select orgMemberships*, :49 filter organization*, :50 select organization*, :70 select user*

**langy** (4 hits, 4 cross-module)

- `modules/langy/process/src/repositories/prisma/prisma.langy-credential.repository.ts` :19 select team*, :36 filter scopes(some)*
- `modules/langy/process/src/repositories/prisma/prisma.langy-session-key.repository.ts` :33 select team*, :51 select roleBindings*

**model-provider** (25 hits, 0 cross-module)

- `modules/model-provider/process/src/repositories/prisma/prisma.model-default.repository.ts` :43 filter scopes(some), :44 include scopes, :54 include scopes, :64 include scopes, :73 filter scopes(some), :74 include scopes, :112 filter scopes(none), :122 write scopes(create), :128 write scopes(deleteMany|create), :130 include scopes, :159 filter scopes(some), :160 include scopes
- `modules/model-provider/process/src/repositories/prisma/prisma.model-provider-evidence.repository.ts` :30 filter scopes(some)
- `modules/model-provider/process/src/repositories/prisma/prisma.model-provider.repository.ts` :69 filter scopes(some), :85 filter scopes(some), :101 filter scopes(some), :153 include scopes, :166 filter scopes(some), :172 include scopes, :182 filter scopes(some), :188 include scopes, :197 include scopes, :207 include scopes, :223 include scopes, :258 filter scopes(some)

**monitor** (3 hits, 3 cross-module)

- `modules/monitor/process/src/repositories/prisma/prisma.monitor.repository.ts` :99 include evaluator*, :138 include evaluator*, :147 include evaluator*

**ops** (13 hits, 5 cross-module)

- `modules/ops/process/src/repositories/prisma/prisma.admin.repository.ts` :32 select orgMemberships*, :33 filter organization*, :34 select organization*
- `modules/ops/process/src/repositories/prisma/prisma.instance-admin.repository.ts` :23 include organization, :25 include teams, :27 include projects, :107 include organization, :226 filter orgMemberships(some), :235 filter orgMemberships(some), :238 filter teams(some), :240 filter projects(some)
- `modules/ops/process/src/repositories/prisma/prisma.migration-membership.repository.ts` :39 select orgMemberships*
- `modules/ops/process/src/repositories/prisma/prisma.project-tenant-source.repository.ts` :36 select team*

**organization** (69 hits, 49 cross-module)

- `modules/organization/process/src/repositories/prisma/prisma.effective-team-admins.repository.ts` :17 filter orgMemberships(some), :85 filter user*, :168 filter user*
- `modules/organization/process/src/repositories/prisma/prisma.group.repository.ts` :79 filter members(some), :106 filter group, :123 filter group, :124 filter user*, :125 filter orgMemberships(some)_, :130 select user_, :146 filter group, :148 filter user*, :149 filter orgMemberships(some)_, :160 select user_
- `modules/organization/process/src/repositories/prisma/prisma.organization-invite.repository.ts` :95 filter user*, :96 select user*, :144 include members, :211 include requestedByUser*, :252 include organization, :309 include organization, :319 select user*, :342 filter team*, :477 include organization
- `modules/organization/process/src/repositories/prisma/prisma.organization-membership.repository.ts` :546 filter team*, :588 filter team*, :1164 filter members(some), :1165 select members, :1237 filter team*, :1285 filter members(some), :1295 include members, :1300 include teams, :1305 include members*, :1307 include assignedRole*, :1310 include projects*, :1360 filter members(some), :1368 include members, :1370 orderBy user*, :1372 include user*, :1374 include teamMemberships*, :1375 filter team*, :1377 include team*, :1378 include assignedRole*, :1420 include user*, :1422 include teamMemberships*, :1423 filter team*, :1425 include team*, :1426 include assignedRole*, :1464 filter orgMemberships(some)_, :1481 filter orgMemberships(some)_, :1495 select user*, :1551 filter team*, :1571 select user*, :1613 select user*, :1615 orderBy user*, :1640 select customRole*, :2109 filter team*
- `modules/organization/process/src/repositories/prisma/prisma.organization-seat.repository.ts` :91 filter user*
- `modules/organization/process/src/repositories/prisma/prisma.organization.repository.ts` :326 select members, :328 select user*, :457 select team*, :551 select projects*, :586 select projects*
- `modules/organization/process/src/repositories/prisma/prisma.personal-team-scope.repository.ts` :108 filter team*, :109 filter team*, :111 select team*
- `modules/organization/process/src/repositories/prisma/prisma.scope-graph.repository.ts` :20 filter members(some), :30 select members, :31 select teams, :40 select members*, :41 select projects*

**package:process-stores** (1 hits, 1 cross-module)

- `packages/process-stores/src/tenant-directory.ts` :43 select team*

**project** (30 hits, 30 cross-module)

- `modules/project/process/src/repositories/prisma/prisma.project.repository.ts` :45 filter team*, :57 filter team*, :69 select team*, :69 select organization*, :113 filter team*, :132 filter team*, :151 filter team*, :207 select team*, :207 select organization*, :220 select team*, :228 include team*, :275 select team*, :277 select organization*, :282 select members*, :311 select team*, :311 select organization*, :388 write gatewayChangeEvents(create)_, :424 filter team_, :473 filter team*, :504 filter team*, :515 filter team*, :529 filter team*, :540 filter team*, :550 filter team*, :577 filter team*, :590 filter team*, :601 filter team*, :651 filter team*, :652 filter team*, :654 select team*

**prompt** (20 hits, 11 cross-module)

- `modules/prompt/process/src/repositories/prisma/prisma.prompt-tag-assignment.repository.ts` :120 include promptTag, :140 include promptTag, :159 include promptTag
- `modules/prompt/process/src/repositories/prisma/prisma.prompt-tag.repository.ts` :133 filter team*
- `modules/prompt/process/src/repositories/prisma/prisma.prompt-version.repository.ts` :80 include author*, :99 filter config, :102 include author*, :103 include config, :159 include author*
- `modules/prompt/process/src/repositories/prisma/prisma.prompt.repository.ts` :94 filter versions(some), :100 filter versions(some), :107 select team*, :163 select project*, :166 select team*, :166 select organization*, :218 include versions, :221 include author*, :394 include versions, :512 include team*, :513 include organization*

**stored-object** (1 hits, 1 cross-module)

- `modules/stored-object/process/src/repositories/prisma/prisma.stored-object-project-organization.repository.ts` :18 select team*

**topic** (1 hits, 1 cross-module)

- `modules/topic/process/src/repositories/prisma/prisma.topic-clustering.repository.ts` :136 filter topics(some)*

**user** (10 hits, 10 cross-module)

- `modules/user/process/src/repositories/prisma/prisma.user-data-erase.repository.ts` :84 filter members(some|every)_, :91 filter members(some)_, :112 filter members(some|every)_, :119 filter members(some)_, :146 filter members(some)_, :147 filter members(every)_, :174 filter members(some)*
- `modules/user/process/src/repositories/prisma/prisma.user-organization-directory.repository.ts` :41 filter team*, :41 filter members(some)_, :55 select user_

**workflow** (14 hits, 1 cross-module)

- `modules/workflow/process/src/repositories/prisma/prisma.workflow-lineage.repository.ts` :101 include copiedFrom, :102 include copiedWorkflows, :121 select copiedWorkflows, :130 include latestVersion, :130 include copiedFrom, :140 include latestVersion, :141 include copiedWorkflows, :141 include latestVersion, :153 select latestVersion, :198 include versions
- `modules/workflow/process/src/repositories/prisma/prisma.workflow.repository.ts` :92 select currentVersion, :192 include versions, :227 select parent, :230 select author*

## Appendix C. Foreign-key constraints live on a migrated database

`pg_constraint` on the test database at `20261002120016`; "Added at" is `packages/prisma-client/prisma/migrations/<name>/migration.sql:<line>`.

| #   | Constraint                                  | Table (owner)                                  | Column                | References             | ON DELETE | Scope    | Added at                                                                                 |
| --- | ------------------------------------------- | ---------------------------------------------- | --------------------- | ---------------------- | --------- | -------- | ---------------------------------------------------------------------------------------- |
| 1   | `Agent_copiedFromAgentId_fkey`              | Agent (agent)                                  | copiedFromAgentId     | Agent                  | RESTRICT  | same     | `20260202150639_add_replicate_agent:15`                                                  |
| 2   | `AiToolEntry_organizationId_fkey`           | AiToolEntry (ee:governance)                    | organizationId        | Organization           | CASCADE   | cross    | `20260503000000_add_ai_tool_entry:41`                                                    |
| 3   | `AiToolEntryDepartment_entryId_fkey`        | AiToolEntryDepartment (ee:governance)          | entryId               | AiToolEntry            | CASCADE   | same     | `20260606130000_ai_tool_entry_departments:31`                                            |
| 4   | `AiToolEntryTeam_entryId_fkey`              | AiToolEntryTeam (ee:governance)                | entryId               | AiToolEntry            | CASCADE   | same     | `20260507120000_ai_tool_entry_multi_team_scope_and_icon_asset:32`                        |
| 5   | `AiToolEntryTeam_teamId_fkey`               | AiToolEntryTeam (ee:governance)                | teamId                | Team                   | CASCADE   | cross    | `20260507120000_ai_tool_entry_multi_team_scope_and_icon_asset:37`                        |
| 6   | `AnomalyAlert_organizationId_fkey`          | AnomalyAlert (ee:governance)                   | organizationId        | Organization           | CASCADE   | cross    | `20260427020000_add_anomaly_alert:46`                                                    |
| 7   | `AnomalyAlert_ruleId_fkey`                  | AnomalyAlert (ee:governance)                   | ruleId                | AnomalyRule            | CASCADE   | same     | `20260427020000_add_anomaly_alert:51`                                                    |
| 8   | `AnomalyRule_createdById_fkey`              | AnomalyRule (ee:governance)                    | createdById           | User                   | SET NULL  | cross    | `20260427010000_add_anomaly_rule:54`                                                     |
| 9   | `AnomalyRule_organizationId_fkey`           | AnomalyRule (ee:governance)                    | organizationId        | Organization           | CASCADE   | cross    | `20260427010000_add_anomaly_rule:49`                                                     |
| 10  | `EmailSuppression_projectId_fkey`           | EmailSuppression (automation)                  | projectId             | Project                | RESTRICT  | cross    | `20260703120400_create_email_suppression:33`                                             |
| 11  | `Evaluator_copiedFromEvaluatorId_fkey`      | Evaluator (evaluator)                          | copiedFromEvaluatorId | Evaluator              | RESTRICT  | same     | `20260202141857_add_replicate_evaluators:16`                                             |
| 12  | `GatewayBudgetBucketBoundary_budgetId_fkey` | GatewayBudgetBucketBoundary (gateway)          | budgetId              | GatewayBudget          | CASCADE   | same     | `20260802120004_budget_manual_attributed_and_vk_disable:26`                              |
| 13  | `IngestionSource_createdById_fkey`          | IngestionSource (ee:governance)                | createdById           | User                   | SET NULL  | cross    | `20260427000000_add_ingestion_source:57`                                                 |
| 14  | `IngestionSource_organizationId_fkey`       | IngestionSource (ee:governance)                | organizationId        | Organization           | CASCADE   | cross    | `20260427000000_add_ingestion_source:47`                                                 |
| 15  | `IngestionSource_teamId_fkey`               | IngestionSource (ee:governance)                | teamId                | Team                   | SET NULL  | cross    | `20260427000000_add_ingestion_source:52`                                                 |
| 16  | `Invoice_subscriptionId_fkey`               | Invoice (ee:billing)                           | subscriptionId        | Subscription           | RESTRICT  | same     | `20260215183000_add_billing_schema_to_oss:131`                                           |
| 17  | `InvoiceItem_invoiceId_fkey`                | InvoiceItem (ee:billing)                       | invoiceId             | Invoice                | RESTRICT  | same     | `20260215183000_add_billing_schema_to_oss:165`                                           |
| 18  | `ModelDefaultConfigScope_configId_fkey`     | ModelDefaultConfigScope (model-provider)       | configId              | ModelDefaultConfig     | CASCADE   | same     | `20260518010000_cascading_default_models:59`                                             |
| 19  | `ModelProviderScope_modelProviderId_fkey`   | ModelProviderScope (model-provider)            | modelProviderId       | ModelProvider          | CASCADE   | same     | `20260419230000_add_model_provider_scope:32`                                             |
| 20  | `ProcessManagerOutboxAttempt_outboxId_fkey` | ProcessManagerOutboxAttempt (package:eventing) | outboxId              | ProcessManagerOutbox   | CASCADE   | same     | `20260817120000_outbox_discard_and_attempt_log:36`                                       |
| 21  | `PromptTag_createdById_fkey`                | PromptTag (prompt)                             | createdById           | User                   | SET NULL  | cross    | `20260401110713_add_prompt_tags:24`                                                      |
| 22  | `PromptTag_organizationId_fkey`             | PromptTag (prompt)                             | organizationId        | Organization           | CASCADE   | cross    | `20260401110713_add_prompt_tags:21`                                                      |
| 23  | `PromptTag_updatedById_fkey`                | PromptTag (prompt)                             | updatedById           | User                   | SET NULL  | cross    | `20260401110713_add_prompt_tags:27`                                                      |
| 24  | `PromptTagAssignment_configId_fkey`         | PromptTagAssignment (prompt)                   | configId              | LlmPromptConfig        | CASCADE   | same     | `20260327120000_add_prompt_config_labels:29 (renamed 20260401110713_add_prompt_tags:56)` |
| 25  | `PromptTagAssignment_createdById_fkey`      | PromptTagAssignment (prompt)                   | createdById           | User                   | SET NULL  | cross    | `20260327120000_add_prompt_config_labels:35 (renamed :58)`                               |
| 26  | `PromptTagAssignment_updatedById_fkey`      | PromptTagAssignment (prompt)                   | updatedById           | User                   | SET NULL  | cross    | `20260327120000_add_prompt_config_labels:38 (renamed :59)`                               |
| 27  | `PromptTagAssignment_versionId_fkey`        | PromptTagAssignment (prompt)                   | versionId             | LlmPromptConfigVersion | CASCADE   | same     | `20260327120000_add_prompt_config_labels:32 (renamed :57)`                               |
| 28  | `ReactorOutbox_projectId_fkey`              | ReactorOutbox (none)                           | projectId             | Project                | RESTRICT  | no model | `20260703120000_add_reactor_outbox:64`                                                   |
| 29  | `SavedView_projectId_fkey`                  | SavedView (dashboard)                          | projectId             | Project                | RESTRICT  | cross    | `20260308120000_add_saved_views_table:23`                                                |
| 30  | `SavedView_userId_fkey`                     | SavedView (dashboard)                          | userId                | User                   | SET NULL  | cross    | `20260308130000_add_user_id_to_saved_views:5`                                            |
| 31  | `Scenario_lastUpdatedById_fkey`             | Scenario (scenario)                            | lastUpdatedById       | User                   | SET NULL  | cross    | `20260105112031_add_scenario_model:24`                                                   |
| 32  | `Scenario_projectId_fkey`                   | Scenario (scenario)                            | projectId             | Project                | RESTRICT  | cross    | `20260105112031_add_scenario_model:21`                                                   |
| 33  | `ScimExternalId_userId_fkey`                | ScimExternalId (ee:scim)                       | userId                | User                   | CASCADE   | cross    | `20260825020006_scim_per_connection:91`                                                  |
| 34  | `SsoVerifiedDomainHolder_owner_fkey`        | SsoVerifiedDomainHolder (identity)             | domain,organizationId | SsoVerifiedDomain      | CASCADE   | same     | `20260918171001_identity_sso:79`                                                         |
| 35  | `Subscription_organizationId_fkey`          | Subscription (ee:billing)                      | organizationId        | Organization           | RESTRICT  | cross    | `20260215183000_add_billing_schema_to_oss:93`                                            |
| 36  | `TriggerLatestEvaluation_triggerId_fkey`    | TriggerLatestEvaluation (automation)           | triggerId             | Trigger                | CASCADE   | same     | `20260928120001_trigger_latest_evaluation:37`                                            |
| 37  | `TriggerSent_customGraphId_fkey`            | TriggerSent (automation)                       | customGraphId         | CustomGraph            | CASCADE   | cross    | `20251210103322_add_custom_graph_id_for_trigger:25`                                      |
| 38  | `WebhookEndpoint_organizationId_fkey`       | WebhookEndpoint (webhook)                      | organizationId        | Organization           | CASCADE   | cross    | `20260802120001_webhook_endpoints_platform:53`                                           |
| 39  | `WebhookEndpointDelivery_endpointId_fkey`   | WebhookEndpointDelivery (webhook)              | endpointId            | WebhookEndpoint        | CASCADE   | same     | `20260802120001_webhook_endpoints_platform:56`                                           |
| 40  | `WebhookEndpointDelivery_projectId_fkey`    | WebhookEndpointDelivery (webhook)              | projectId             | Project                | CASCADE   | cross    | `20260804120004_unify_webhook_delivery_log:59`                                           |
| 41  | `WebhookEndpointDelivery_triggerId_fkey`    | WebhookEndpointDelivery (webhook)              | triggerId             | Trigger                | CASCADE   | cross    | `20260804120004_unify_webhook_delivery_log:62`                                           |
| 42  | `slack_connection_claim_connectionId_fkey`  | slack_connection_claim (slack)                 | connectionId          | SlackIntegration       | RESTRICT  | same     | `20261006170513_slack_connection_claim:24`                                               |
