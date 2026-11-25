# Peer-cycle cuts: the 52-edge plan to zero

Date: 2026-10-06. Rules: ARCHITECTURE.md §5 (peer cycles; cut from the reactor's side), §3.3, §9, §11. Supersedes the edge map in `peer-cycles-2026-10-05.md`; the cuts ruled there have landed: no secret, webhook or presence edge appears, and workflow no longer holds ProjectApi or OrganizationApi. **No cut lands without Alex's ruling (§5, 2026-10-05).**

## 1. What the policy counts

- **Source.** `packages/architecture-enforcer/src/policies/boundaries/peer-cycles.ts`.
- **Edges.** One edge per module pair, read from every process package's `static dependencies`, following constants, spreads and relative imports. **Contract imports are not counted.**
- **Findings.** A finding is a declared edge whose target reaches back, so the finding count equals the number of edges inside strongly connected components.
- **Today.** 248 findings. 405 edges. One component of 40 modules: agent, analytics, annotation, api-key, audit-log, auth, billing, coding-agent, data-privacy, data-retention, dataset, enterprise-gateway, entitlement, evaluation, evaluator, experiment, feature-flag, gateway, github, governance, identity, instant-eval, licensing, log, metric, model-provider, monitor, organization, project, prompt, role, scenario, scim, share, sso, suite, topic, trace, user, workflow.
- **Outside the component.** authz, notification, secret, stored-object, presence, managed-provider, slack, webhook and the top-level consumers (ops, langy, onboarding, dashboard, automation, platform-health, hosted-mcp, usage, saas, enterprise-ops, nurturing, demo-data).

## 2. Choosing the cut set

| Method                                                                        | Cuts to zero | Comment                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Greedy: remove the edge clearing the most findings, repeat                    | 94           | Cuts foundation edges (`agent -> project`, `data-retention -> user`); rejected.                                                          |
| Minimum feedback arc set: unweighted search over layer orderings, 60 restarts | 44           | Puts organization lowest and coding-agent highest; has trace below evaluation and entitlement mid-stack. A floor, not a design.          |
| Design layering (this plan)                                                   | 52           | Foundations at the bottom; every reaction flows down. Two cuts the layering implies are not needed for zero and are dropped (see below). |

**Target order, lowest first.** The non-component leaves sit below everything: audit-log, entitlement, feature-flag, role, organization, data-privacy, project, user, api-key, data-retention, share, model-provider, licensing, scim, identity, sso, auth, github, dataset, workflow, prompt, evaluator, monitor, trace, annotation, log, metric, analytics, evaluation, topic, agent, experiment, gateway, instant-eval, enterprise-gateway, billing, scenario, suite, governance, coding-agent.

**Rules this order respects:**

- `gateway -> evaluation` stays: synchronous guardrails (Alex, 2026-10-01).
- `project -> data-privacy` stays (Alex, 2026-09-30).
- `auth -> sso` stays (Alex, 2026-09-25).
- `instant-eval -> licensing` stays, with hosted judging moving to instant-eval (Alex, 2026-09-30).
- Synchronous better-auth hooks stay: `auth -> user` and `auth -> identity`.
- `identity -> scim` stays: an SSO login must see a directory deactivation immediately.

**Dropped as redundant.** `feature-flag -> organization` and `licensing -> gateway`: with the other 52 cuts in place, neither closes a cycle. Cut them later only for hygiene.

## 3. Cut patterns

- **(i)** A reacts to B's fact with `.withPeerSubscriber`; B records the fact.
- **(ii)** The operation moves to the module that owns the data. It may be an existing operation elsewhere, as `AuthzApi.getScope` was for the secret cut.
- **(iii)** B pushes the data A needs as a fact into A's own read model.
- **(iv)** A deployment fact or config value replaces the call.

**Sizes.** S: under a day. M: 1 to 3 days. L: over 3 days, or a migration.

Paths are under `<from-module>/process/src/` unless they are written in full. Line numbers are as of 2026-10-06.

## 4. The cuts

### Batch B1: 8 cuts, clears 46 (248 -> 202)

**S1. agent -> scenario** (`agent.app.ts:120`). Alone clears 22.

- Calls: `testAgentTurn` at `app/agent.app.ts:435` and `testAgentRun` at `:451`, behind the tRPC procedures `agent.testTurn` and `agent.testRun` (`modules/agent/contract/src/agent.trpc.ts:80,84`).
- Browser callers: `agent-test-panel.tsx`, `agent-management-screen.tsx`, `experiments.screen.tsx`.
- Pattern (ii): the test procedures move to scenario, which owns the runner and already holds AgentApi. Browser callers move to scenario-client.
- Needs: a tRPC contract move. AgentApi drops `testTurn` and `testRun`; ScenarioApi already has them. No fact, no table.
- Size M. Behaviour: none, apart from an internal tRPC path rename.

**T1. trace -> coding-agent** (`trace.app.ts:852`). Alone clears 12.

- Calls:
  - `contributeReceivedSpan`: `eventing/trace-processing-runtime.pipeline.ts:53,217`, via `coding-agent-span-facts-dispatch.subscriber.ts`.
  - `shouldFilterSpan`: `services/trace-ingestion.service.ts:287`.
  - `contentAttrKeys`: `rules/claude-code-log-enrichment.rules.ts:90`.
  - `logContentKeys` and `buildTranscript`: `app/trace.app.ts:2262,2269`.
- Pattern (i): coding-agent peer-subscribes to trace's span fact. It already does this for log and metric facts at `modules/coding-agent/process/src/eventing/coding-agent-processing.pipeline.ts:165,177`.
- The other four calls are pure functions already exported from `@langwatch/coding-agent-contract`; import those exports instead. Alternatively, `shouldFilterSpan` moves into trace (ii).
- Drop `TraceApi.buildCodingAgentTranscript`: coding-agent builds its own transcript.
- Needs: a span-received fact in trace-contract, if `trace-ingress.events.ts` lacks one. CodingAgentApi drops 5 pure operations.
- Size M. Behaviour: none, because dispatch was already asynchronous.

**E1. entitlement -> billing** (`entitlement.app.ts:129`). Alone clears 7; 62 findings remain if this one is skipped.

- Calls:
  - `getActiveSubscriptionPlan`: `services/subscription-plan.service.ts:15`, wired at `app:178`.
  - `getPricingModel` and `countBillableEventsByProjects`: `services/usage-enforcement.service.ts:199,203`.
  - `sendUsageWarning`: `services/usage-warning.service.ts:32`.
- Pattern (iii) for the plan: entitlement folds billing's existing `lw.billing.subscription_changed` and `lw.billing.subscription_started` facts (`enterprise/modules/billing/contract/src/billing-lifecycle-events.ts:7-8`), adding the pricing model to those facts if it is missing.
- Pattern (i) for warnings: entitlement records a new `lw.entitlement.usage_threshold_crossed` fact, and billing peer-subscribes and sends the warning.
- Billable-event counting stays with billing's caller.
- Needs: a new entitlement fact; a new entitlement subscription-plan table and projection with a backfill.
- Size L. Behaviour: a plan change after checkout applies after projection lag (seconds). Warning emails become at-least-once, so they need an idempotency key per organization, threshold and month.
- Ruling R4.

**R. role -> organization** (`role.app.ts:60`).

- Calls: `getOrganizationIdByTeamId` at `app/role.app.ts:274`; `getTeamById` at `:305`, used by the personal-team fence.
- Pattern (ii): `AuthzApi.getScope({ teamId })` gives the organization id, as the secret cut did.
- The fence needs `isPersonal`, which `AuthzScopeRef` lacks. Either add it to the team scope ref (an authz contract change), or fold a team-created fact (iii).
- Size S-M. Behaviour: none.

**FF. feature-flag -> project** (`feature-flag.app.ts:74`).

- Calls: `getOrganizationId` at `app/feature-flag.app.ts:252`.
- Pattern (ii): `AuthzApi.getScope({ projectId })`; feature-flag already holds AuthzApi.
- Size S. Behaviour: none.
- Optional hygiene, not needed for zero: `feature-flag -> organization`.
  - `memberOrganizationIds` (`app:173`) becomes `AuthzApi.listUserBindings`.
  - The created-at cache (`services/organization-created-at-cache.service.ts:40`) folds `lw.organization.signed_up`, with a backfill.

**DP1. data-privacy -> project** (`data-privacy.app.ts:97`).

- Calls: `getWithTeam` at `services/data-privacy-resolution.service.ts:34`, `services/data-privacy.service.ts:119` and `app/data-privacy.app.ts:329`. Data-privacy needs the organization id, team id, `departmentId` and `isPersonal`.
- Pattern (iii): a data-privacy project-scope table, folded from `lw.project.created` and `lw.project.moved` (`modules/project/contract/src/project.events.ts:6,59`) plus a new `lw.project.department_assigned` fact.
- Needs: a new project fact; a new table with a backfill.
- Size M. Behaviour: after a department move, PII rules apply after lag.
- Ruling R5. This keeps Alex's `project -> data-privacy` and reverses the other side.

**DP2. data-privacy -> evaluation** (`data-privacy.app.ts:100`).

- Calls: `detectPii` (Presidio through langevals) at `services/presidio-redaction.service.ts:13`.
- Pattern (iv): data-privacy calls the langevals Presidio endpoint itself, reading the endpoint as evaluation-contract's exported config value (§16).
- Needs: a config value export. No fact.
- Size M. Behaviour: none.
- Ruling R5: this amends "evaluation owns the langevals boundary" (2026-09-25).

**LI. licensing -> instant-eval** (`licensing.app.ts:169`).

- Calls: `classify`, `priceOf` and `recordSpendForHostedCalls` at `enterprise/modules/licensing/process/src/app/licensing.app.ts:935`; this is the Connect hosted judge.
- Pattern (ii): hosted judging moves to instant-eval, per the 2026-09-30 ruling. The REST path is kept.
- Needs: a contract change. No fact.
- Size M. Behaviour: none.
- Ruling R8.

### Batch B2: 24 cuts, clears 34 (202 -> 168)

**G. github -> coding-agent** (`github.app.ts:214`).

- Calls: `backfillPullRequestMappings` at `app/github.app.ts:454`.
- Pattern (i): github records a new `lw.github.installation_connected` fact; coding-agent peer-subscribes and backfills.
- Needs: a new github fact; github-contract has no events today.
- Size S-M. Behaviour: the backfill starts seconds later.

**S2. scenario -> suite** (`scenario.app.ts:240`). Alone clears 9.

- Calls:
  - `recordSuiteRunItemStarted`, `completeSuiteRunItem`, `regradeSuiteRunItem`: `app/scenario.app.ts:443-446`.
  - `getRunAttachments` and `getAttachedEvaluators`: `app:459,461`.
  - `listByIds`: `services/scenario-execution-lookup.service.ts:127`.
- Pattern (i): suite peer-subscribes to scenario's run started, completed and regraded facts (`scenario-lifecycle.events.ts`, `simulation.events.ts`).
- Pattern (iii): suite puts attachments and attached evaluators into the run it queues (`queueSimulationRun`).
- Needs: suite run-item ids and attachments on scenario's events and commands (contract change). No new table.
- Size M. Behaviour: suite progress runs seconds behind.

**AL. audit-log -> {agent, annotation, dataset, monitor, project, prompt, workflow}** (`audit-log.app.ts:41-47`). One lane, 7 edges.

- Calls:
  - Recent-items owners at `services/recent-items.service.ts:20-27`: `findSummaryById`, `findOrganizationId`, `getExistingIds`, `getNamesByIds`, `getById`, `getByIds`, `getAllByIds`, `getQueue`.
  - `AgentApi.findIdsCreatedInWindow` at `services/agent-audit-log-ids.service.ts:33`, from the one-shot repair task `tasks/agent-audit-log-ids.task.ts`.
- Pattern (ii): audit-log answers only with touches (type, id, time). Naming and linking move to the browser, through each owner's client, or to a module above the owners.
- The repair task retires, or becomes agent's own task, which needs a new AuditLogApi patch operation.
- Needs: a `RecentItem` output contract change and a browser change.
- Size M. Behaviour: more round trips from the recent-items panel.
- Ruling R6.

**E2. entitlement -> {licensing, organization, project, user}.** Same lane as E1, run sequentially after it.

- **licensing** (`:128`): LicensingApi is a plan source (`app:182`, `services/entitlement.service.ts:38`).
  - Pattern (iii): a new `lw.license.plan_changed` fact, folded by entitlement.
  - Size M. Behaviour: a plan applies after lag once a licence is uploaded.
- **organization** (`:131`):
  - `getDatasetLimits` (`app:245`) and `getPricing` (`app:275`).
  - `getOrganizationIdByTeamId` and `findAllIds` (`services/usage-enforcement.service.ts:137`).
  - `getProjectIds` (`:332`) and `getPricingModel` (`:433`).
  - `countMemberSeats` (`services/usage-stats.service.ts:56`).
  - Pattern (ii): pricing and dataset limits are plan data; their columns move to entitlement with an expand/contract Postgres migration.
  - Team to organization becomes `AuthzApi.getScope`. Seats become an authz binding count. The organization registry folds `lw.organization.signed_up`.
  - Size L. Ruling R4.
- **project** (`:132`): `listIdsByOrganization` at `services/usage-enforcement.service.ts:138`.
  - Pattern (iii): fold `lw.project.created`, `lw.project.moved` and `lw.project.archived`.
  - Size S-M.
- **user** (`:127`): `findById` for operator and impersonator at `app/entitlement.app.ts:346`.
  - Pattern (ii): the caller passes the user (`input.user` already exists), so it becomes required.
  - Size S. Contract change.

**ID. identity -> auth, scim -> identity, scim -> governance.**

- **identity -> auth** (`identity.app.ts:435`), 15 operations.
  - Capability answers: `offersPasskeys`, `issuesOwnPasswords`, `findMountedSocialMethodIds`, `resolveAuthProvider` at `app:528-533`; `offersTwoStepVerification` at `services/organization-mfa.service.ts:59`.
  - Reads and writes on auth's session and account tables:
    - `listBrowserSessions`: `services/account-identifiers.service.ts:35`.
    - `findSessionAmr` and `findAssertedAmrForIdentifiers`: `organization-mfa.service.ts:67,193`.
    - `linkProviderAccount`: `services/link-proposal.service.ts:26`.
    - `disableTwoStepVerification`: `services/two-step-account.service.ts:16`.
    - `findFederatedAccountProviders`, `countLegacySsoAccess`, `retireLegacySsoAccess`, `findDialableIdentityProviderOrigins`: `app:293,337,338,587`.
    - `route`: `services/identity-lookup.service.ts:40`.
  - Pattern (iv): capability booleans become auth-contract config values.
  - Pattern (ii): session and account doors move to auth.
  - Size L. Ruling R1.
- **scim -> identity** (`scim.app.ts:244`): `ssoConnectionReads` at `services/scim-connections.service.ts:10`.
  - Pattern (iii): fold identity's `sso-connection-events.ts` facts.
  - Size S-M. Behaviour: the connection list lags.
- **scim -> governance** (`scim.app.ts:241`): `departmentResolveByNameOrCreate` and `departmentAssignUser` at `services/scim-cost-center.service.ts:42,48`.
  - Pattern (i): scim records a new `lw.scim.cost_center_changed` fact; governance peer-subscribes.
  - Size S-M. Behaviour: department assignment lags.

**P. project -> {api-key, share, topic, trace}.**

- **api-key** (`project.app.ts:108`): `resolveVisibleProjects` (`app:350`) and `create` in `provisionServiceKey` (`app:377`), behind `transport/project.rest.ts:168,209`. The service-key token comes back synchronously.
  - Pattern (ii): both REST doors move to api-key's REST family, paths unchanged.
  - Size M. Rulings R3, R10.
- **share** (`:109`): `revokeAllTraceShares` at `services/project-operations.service.ts:126`.
  - Pattern (i): a new `lw.project.trace_sharing_disabled` fact; share peer-subscribes.
  - Share already refuses at read time (`modules/share/process/src/services/share.service.ts:106-108`), so there is no security window.
  - Size S-M.
- **topic** (`:110`): `getClusteringStatus` and `requestClustering` at `services/project-operations.service.ts:46`.
  - Pattern (ii): the procedures move to topic.
  - Size S.
- **trace** (`:112`): `resolveViewerProtections` via `getFieldProtections` at `app/project.app.ts:258-266`.
  - Pattern (ii): the procedure moves to trace, which already has the operation. A browser change.
  - Size S.

**EV. evaluation -> experiment, monitor -> evaluation, evaluator -> monitor, dataset -> experiment.**

- **evaluation -> experiment** (`evaluation.app.ts:285`):
  - `findBySlug` at `app:640`.
  - `findOrCreate` at `services/evaluation-batch-log.service.ts:134`.
  - `findOrCreateForRun`, `startExperimentRun`, `recordTargetResult`, `recordEvaluatorResult`, `completeExperimentRun` at `services/evaluation-experiment-run.service.ts:32-56`.
  - Pattern (ii): the batch-log and experiment-run doors move to experiment, paths unchanged.
  - Size M-L.
- **monitor -> evaluation** (`monitor.app.ts:73`): `getMonitorPerformance` at `app/monitor.app.ts:243` and `getEvaluatorEffectiveSettings` at `services/monitor.service.ts:39`.
  - Pattern (ii): performance moves to evaluation. Effective settings become a pure rule in a contract.
  - Size M.
- **evaluator -> monitor** (`evaluator.app.ts:121`): `findByEvaluator` and `delete` at `services/evaluator-linked-rows.service.ts:12`; this is the delete cascade.
  - Pattern (i): a new `lw.evaluator.deleted` fact; monitor peer-subscribes.
  - Size S-M. Behaviour: linked monitors disappear after lag.
- **dataset -> experiment** (`dataset.app.ts:110`): `getById` at `app/dataset.app.ts:212` (borrowed name) and `findBySlug` at `:489` (`listBatchEvaluations`).
  - Pattern (ii): `listBatchEvaluations` moves to experiment, and the caller passes the name.
  - Size S-M.

### Batch B3: 12 cuts, clears 102 (168 -> 66)

**T. trace -> {annotation, log, topic, instant-eval, experiment, evaluation}, plus entitlement -> trace.** One lane; all of it edits `trace.app.ts`.

- **annotation** (`:844`): `listForProjection` and `listScoreNames` at `repositories/clickhouse/trace-legacy-read.repository.ts:2598-2599`.
  - Pattern (iii): annotation already pushes `TraceApi.recordAnnotation` (`trace.api.ts:384`, called at `annotation.app.ts:521`); the legacy read uses trace's own projection.
  - Size M.
- **log** (`:861`): LogApi is the canonical log service for `LogRecordStorageService` (`app/trace.app.ts:989-992`).
  - Pattern (ii): the canonicalisation becomes a pure function in log-contract, or log-record storage moves to log.
  - Size S-M.
- **topic** (`:868`): `bootstrapClustering` at `eventing/trace-processing-runtime.pipeline.ts:68`; `getAll` at `app:2426`.
  - Pattern (i): topic peer-subscribes to `trace-project-milestones.events.ts`.
  - `getAll` is composed in the browser.
  - Size M.
- **instant-eval** (`:860`): the `traces.instantEval.*` namespace (`modules/trace/contract/src/traces-instant-eval.trpc.ts:20`, `services/trace-instant-eval-run.service.ts:44-104`) and the search router's classifier and `isReleased` (`app:1290-1298`).
  - Pattern (ii): the namespace and the router branch move to instant-eval.
  - Size M-L. A tRPC rename.
- **experiment** (`:858`): `computeRunMetrics` and `lookupExperimentId` at `eventing/trace-processing-runtime.pipeline.ts:63`.
  - Pattern (i): experiment peer-subscribes to trace's processed fact.
  - Size M. Behaviour: none, because it was already asynchronous.
- **evaluation** (`:856`):
  - `queueTraceEvaluation` (pipeline `:186`) and the on-message trigger subscriber (`eventing/evaluation-trigger.subscriber.ts:160,296`, which also uses MonitorApi and FeatureFlagApi) move to evaluation as peer subscribers (i).
  - `reportEvaluation` and `deriveEvaluatorId` from the collector (`app:3273-3280`, `eventing/custom-evaluation-sync.subscriber.ts`) also become pattern (i).
  - Reads `findRunsByTraceId` (`app:2998`) and `findSummariesByTraceIds` (`services/trace-list-read.service.ts:213`): either the browser composes evaluation-client, or trace folds evaluation facts (iii).
  - Size L. Ruling R9.
- **entitlement -> trace** (`entitlement.app.ts:130`): `countTracesByProjects` at `services/usage-enforcement.service.ts:132`.
  - Pattern (ii): trace's ingest allowance (`trace-ingest-allowance.service.ts:14`) passes its own count. The usage panel composes the counts.
  - Size M.

**O. organization -> {api-key, identity, project, share, user}.**

- **api-key** (`:327`): `create` in the members-as-code provisioning door, which returns `adminApiKey` (`app/organization.app.ts:858`).
  - Pattern (ii): the door moves to api-key, path unchanged.
  - Size M. Ruling R3.
- **identity** (`:329`):
  - `ssoTestArrival` (`app:385`), `joinAdmissions` (`app:410`), `joinRequests` (`services/organization-join-requests.service.ts:98`).
  - `verifiedEmailsOf` (`app:461`, `services/organization-invitations.service.ts:160`, `organization-directory.service.ts:24`).
  - Pattern (ii): the join and SSO-test doors move to identity.
  - Pattern (iii): verified addresses are folded from `identity-events.ts`.
  - Size L.
- **project** (`:323`):
  - The ceremony creates the first project (`services/organization-ceremony.service.ts:35`).
  - Team and project listings (`app:1476,1487,2051`; `organization-visibility.service.ts:208`).
  - `listIdsByOrganization` (`app:755`), which goes away with the share cut.
  - Pattern (ii): the ceremony moves up to the sign-up flow, and the listings move to project or the browser.
  - Size L. Ruling R2.
- **share** (`:326`): `revokeAllTraceShares` per project (`app:755-760`).
  - Pattern (i): a new `lw.organization.trace_sharing_disabled` fact, alongside `organization-settings.events.ts`; share peer-subscribes.
  - Size S-M.
- **user** (`:325`):
  - `revokeAllBrowserSessions` (`app:2063`).
  - `hasAnyAccount` and `isOperator` (`services/sign-up-policy.service.ts:29`).
  - Pattern (i): new `lw.organization.member_removed` and session-policy facts; auth or user revokes sessions.
  - Pattern (ii): the sign-up policy decision moves to user (`user.checkSignUp` already exists).
  - Size M. Ruling R7.

### Batch B4: 8 cuts, clears 66 (66 -> 0)

**U. user -> {governance, gateway, enterprise-gateway, auth}.**

- **governance** (`:209`): `personalUsageDashboard`, `personalBudgetOverview`, `cliBootstrap` and `personalUsage` (`app/user.app.ts:1013-1067`), which are `/me` pass-throughs.
  - Pattern (ii): the doors move to governance, paths unchanged.
  - Size M.
- **gateway** (`:208`): `checkBudget` for the `/me` banner.
  - Pattern (ii).
  - Size S.
- **enterprise-gateway** (`:207`): `findDefaultRoutingPolicies` and `personalVirtualKeyList` (`app:881,908`).
  - Pattern (ii).
  - Size S.
- **auth** (`:205`), 16 operations:
  - Sessions at `services/user-account.service.ts:87-116`.
  - Sign-up proofs at `app:447,516-517`.
  - Capability flags at `app:231,464,466,659`.
  - `changeFederatedPassword` at `app:1154`.
  - `getSsoSetupStatus` at `services/user.service.ts:290`.
  - `revokeCliTokens` at `:363`.
  - Pattern (ii): the doors move to auth. Pattern (iv): the capability flags.
  - Size L. Ruling R1.

**W. workflow -> {experiment, agent, monitor, evaluator}.**

- **experiment** (`:597`): `triggerWorkflowEvaluation` at `app/workflow.app.ts:671`.
  - Pattern (ii): the trigger moves to experiment.
  - Size S-M.
- **agent** (`:589`):
  - `getById` at `services/studio-event-preparer.service.ts:26`.
  - `listWorkflowConfigs` and `updateWorkflowConfig` at `services/workflow-agent-mapping.service.ts:35,70`.
  - `getNamesByIds` and `archive` at `services/workflow-linked-rows.service.ts:13`.
  - Pattern (i): new workflow `version_saved` and `archived` facts; agent peer-subscribes.
  - Names are composed in the browser.
  - Size M. Behaviour: the archive cascade lags.
- **monitor** (`:599`): `findByEvaluator` and `delete` at `services/workflow-linked-rows.service.ts:15`.
  - Pattern (i): monitor peer-subscribes to the archived fact.
  - Size S.
- **evaluator** (`:585`): `getAll`, `listByWorkflow`, `update`, `create` and `archive` at `app/workflow.app.ts:1139-1189`.
  - Pattern (ii): the doors move to evaluator, which already holds WorkflowApi.
  - Size M.

## 5. Lanes and collisions

**Lanes per batch.** Within a batch, lanes touch disjoint modules.

| Batch | Lane | Modules                                                                                   |
| ----- | ---- | ----------------------------------------------------------------------------------------- |
| B1    | S1   | agent, scenario                                                                           |
| B1    | T1   | trace, coding-agent                                                                       |
| B1    | E1   | entitlement, billing                                                                      |
| B1    | R    | role (+ authz contract)                                                                   |
| B1    | FF   | feature-flag                                                                              |
| B1    | DP   | data-privacy, project contract, evaluation contract                                       |
| B1    | LI   | licensing, instant-eval                                                                   |
| B2    | G    | github, coding-agent                                                                      |
| B2    | S2   | scenario, suite                                                                           |
| B2    | AL   | audit-log, agent                                                                          |
| B2    | E2   | entitlement, licensing contract, organization (column move)                               |
| B2    | ID   | identity, auth, scim, governance                                                          |
| B2    | P    | project, api-key, share, topic, trace transport                                           |
| B2    | EV   | evaluation, experiment, monitor, evaluator, dataset                                       |
| B3    | T    | trace, annotation, log, topic, instant-eval, experiment, evaluation, monitor, entitlement |
| B3    | O    | organization, api-key, identity, project, share, user, auth                               |
| B4    | U    | user, auth, gateway, governance, enterprise-gateway                                       |
| B4    | W    | workflow, experiment, agent, monitor, evaluator                                           |

**Lanes that alone clear findings** from today's tree: S1 22, FF 14, AL 19, T1 12, S2 9, E1 7.

**Shared files that serialize lanes:**

- Contract `index.ts` exports.
- `apps/worker/src/__tests__/worker-installation.integration.test.ts`, which lists peer subscribers.
- `apps/*/src/__tests__`.

## 6. What the cuts need

**New fact types:**

- Trace span received, if not already present.
- `lw.entitlement.usage_threshold_crossed`
- `lw.license.plan_changed`
- `lw.github.installation_connected`
- `lw.scim.cost_center_changed`
- `lw.evaluator.deleted`
- Workflow `version_saved` and `archived`
- `lw.project.trace_sharing_disabled`
- `lw.project.department_assigned`
- `lw.organization.trace_sharing_disabled`
- `lw.organization.member_removed` and session policy

**New tables, projections or migrations, each with a backfill:**

- Entitlement plan read model.
- Entitlement organization-to-projects map.
- Data-privacy project scope.
- Scim connection list.
- Organization pricing and dataset-limit columns moving to entitlement, by expand/contract.

**Contract or wire changes, internal tRPC renames:**

- `agent.testTurn` and `agent.testRun` -> scenario.
- `traces.instantEval.*` -> instant-eval.
- `projects.getFieldProtections` -> trace.
- Clustering status and request -> topic.
- Monitor performance -> evaluation.
- Recent-items output.

**REST doors that change owner with paths unchanged (R10):**

- Project creation and visible-projects -> api-key.
- Organization provisioning -> api-key.
- Batch log -> experiment.
- `/me` usage -> governance, gateway and enterprise-gateway.
- Hosted judge -> instant-eval.

## 7. Customer-visible behaviour

- **Eventual with a lag of seconds:**
  - A plan change after checkout or licence upload.
  - Usage warning emails, now at-least-once.
  - Suite progress.
  - The archive cascades: workflow to agent, evaluator and monitor; evaluator to monitor.
  - SCIM department assignment.
  - The scim connection list.
  - PII rules after a department move.
  - Organization and project share-row cleanup. Read-time refusal stays immediate.
  - Browser-session revocation on member removal. Authz offboarding stays immediate.
- **No synchronous precondition becomes eventual:**
  - Guardrails, sign-in hooks and the SSO directory check stay synchronous.
  - Provisioning responses keep their tokens, because the doors move rather than react.
- **Optional extra round trips:** recent items and evaluation summaries on trace screens, if the browser composes them.

## 8. Rulings needed (Alex)

- **R1 – auth, identity, user and sso.** Cut `identity -> auth` and `user -> auth` (L each), or merge auth with identity.
- **R2 – organization and project.** Cut `organization -> project` (L), or merge them into a tenancy module.
- **R3 – api-key above project and organization.** The provisioning doors move, or reverse it and cut api-key's 13 operations on project and organization.
- **R4 – entitlement as a foundation read model.** This includes the §11 question of open-source code folding enterprise billing and licensing facts, and the organization column move.
- **R5 – data-privacy.** Reverse the project edge with a read model, and give data-privacy its own Presidio endpoint, amending "evaluation owns langevals" (2026-09-25).
- **R6 – recent items.** Browser composition or a new module; and whether the agent audit-id repair retires.
- **R7 – eventual revocation.** Is eventual share and session cleanup acceptable, given immediate read-time and authz refusal?
- **R8 – licensing and instant-eval.** Confirm `licensing -> instant-eval` is the edge cut, per "hosted judging moves to instant-eval" (2026-09-30).
- **R9 – evaluation results in trace reads.** Browser composition or fold.
- **R10 – REST doors moving owner.** May a REST path be served by a module other than its namespace's owner (§8)?

Every cut, ruled or not, waits for Alex (§5, 2026-10-05).

## 9. Kept on purpose (not cut)

- `gateway -> evaluation` (guardrail).
- `project -> data-privacy`.
- `auth -> sso`, `auth -> identity`, `auth -> user`.
- `identity -> scim`.
- `instant-eval -> licensing`.
- `feature-flag -> organization` and `licensing -> gateway`: redundant once the other cuts land.
