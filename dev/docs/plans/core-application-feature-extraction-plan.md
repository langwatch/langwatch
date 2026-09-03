# Platform application exit plan

**Updated:** 2026-09-02

**Branch:** `feat/strict-feature-layout-v0`

**Working checkpoint:** `0fc9e4120d`

**Ruling in force (2026-09-01, Alex):** the migration is not gradual.
`platform/app` does not need to compile, boot or serve during it. The only
edit allowed there is a deletion (`git diff --numstat -- platform/app` shows
zero insertions on every row). Since 2026-09-02 the recipe is lift-and-shift:
move a module into the package that owns it keeping its shape, fix the moved
code's imports, leave every other platform importer broken, delete what the
move made unreachable. There are no "narrowed copies", no "priced" files, no
per-slice whole-repo gate runs; the architecture-lint findings count is the
cleanup backlog, not a gate.

**State at `0fc9e4120d`.**

| Lane | Fact | Next |
| --- | --- | --- |
| API | `createAppTrpcFeatures` (22 namespaces) composes on `apps/api`'s own root behind its own policy chain, with ~40 ports lifted off platform; `/api/sse/*` serves subscriptions on that root. The ANALYTICS half of `trpcCollaborators` is satisfied: `apps/api/src/app/api-trpc-collaborators.analytics.composition.ts` builds `AnalyticsApp` and `DashboardApp` and the `analytics.{reads,workbench,savedCharts}` and `graphs` port groups over this process's own graph, and `withApiAnalyticsCollaborators` folds them into whatever the other halves supply. `apps/api` now owns ClickHouse: `platform/config/api.config.ts` reads `CLICKHOUSE_URL`, the `CLICKHOUSE_URL__<label>__<org>` private routes, the pool-sizing inputs and the five `LWQL_*` variables all-or-nothing, and `platform/infrastructure/api-clickhouse.infrastructure.ts` composes the routed, pooled, statement-limited connection over `@langwatch/clickhouse-client`. The application's connection and the RESTRICTED LangWatchQL identity are separate config values and separate options; neither can stand in for the other. Moved out of platform into `@langwatch/analytics-server`: the LangWatchQL vertical whole (26 modules under `src/langwatch-ql/**` plus `services/langwatch-ql.service.ts`), the filter-option service, its ClickHouse repository and the filter definitions, the shared analytics input schemas, and the four ClickHouse query refusals with the read-path translation that raises them. Into `@langwatch/dashboard-server`: the saved-workbench-chart policy, its transport errors and the workbench-aware graph-visibility policy. Three collaborators degrade FAIL-CLOSED because their verticals have not moved: the member's content protections resolve costs from AuthZ and captured content from the data-privacy policy, refusing a `restrict` rule whose audience names groups (group membership is unresolvable here); an absent graph-alert lookup shows no alert; an absent `redactActionParams` drops every parameter. Judgment calls recorded rather than deferred: the platform metric/group registry was NOT moved — its `colorSet` and number formatters are presentation and live in the browser package — so the wire's metric enum is now `z.string()` and the metric translator's own refusal is the narrowing; `PLATFORM_DEFAULT_RETENTION_DAYS` (49) is stated in the composition rather than imported; the feature-flag rows are read uncached because this process's Redis is the queue's; `lwqlKeyMap.repository.ts` and `lwql-key-map.service.ts` stayed in platform (ClickHouse ingestion side, and the second reaches the goose migration reader). Platform `root.ts` still holds the ports object as the reference for the halves that have not moved. The EXECUTION half is satisfied: `apps/api/src/app/api-trpc-collaborators.execution.composition.ts` builds `WorkflowApp`, `ExperimentApp` and the evaluation command surface plus the `workflows.{lifecycle,optimization}`, `experiments` and `evaluations` port groups over this process's own graph, and `withApiExecutionCollaborators` folds them into whatever the other halves supply. ONE workflow service serves the workflow application, the evaluator service built over it and the experiment service's reference set, so this process cannot hold two answers to "what is the current version of this workflow". `evaluations.reportEvaluation` dispatches on a PRODUCER-only registration of the SAME packaged `evaluation_processing` definition the worker drains: `createEvaluationProcessingProducerPipeline` (new, in `@langwatch/evaluation-server`) builds the whole definition with refuse-by-name stand-ins for the five consumer-side dependencies, so a fork that declared only a producer's commands — and therefore routed to names the worker's frozen job registry does not claim — is structurally impossible. `apps/api` gains `infrastructure.execution`: `LANGWATCH_NLP_SERVICE` and `BASE_HOST`, each blank-is-unconfigured. Moved out of platform into `@langwatch/workflow-server`: the NLP dispatch whole (`nlpgoFetch` becomes `HttpWorkflowNlpRuntimeAdapter` with the `/go` prefix, origin tag, causality-depth header and W3C `traceparent` byte-identical, plus `nlpProxyBaseUrl`), the project-environment and workflow-row Prisma adapters, the DSL-migration adapter, the Studio DSL preparation with `materializeNodeLlmConfigs` folded into it, and `autoComputeAgentMappings` with its 601-line suite. Into `@langwatch/evaluator-server`: the code-execution and audit-log adapters. Into `@langwatch/evaluation-server`: `evaluatorUnavailability` and the producer pipeline. Two cross-feature bridges stayed in `apps/api` because a feature server package may not depend on another feature's server package: the LiteLLM parameter resolution and the Azure Content Safety credential read, both of which reach `@langwatch/model-provider-server`. Named absences, each with its consequence: `modelProviders` arrives as a host OPTION and its absence makes the whole half absent (the six ports `PostgresModelProviderAdapter` needs are still platform classes, and a Studio node's model is resolved per run); the per-project NLP **Lambda ARN routing and S3 payload staging did NOT move** — the adapter takes a service URL, which is what every self-hosted install and local stack already runs; `runEvaluationForTrace` and `generateCommitMessage` refuse by name (the trace read pipeline and the model gateway have not moved); `mappingsSchema` and `coerceMonitorMappings` default to a PERMISSIVE parse because the trace-mapping registry now lives in `@langwatch/trace-web` and no server module may value-import a browser package; `workflowCreated` and `trackEvaluationRan` are no-ops without a product-analytics sink; `captureException` falls to the composition's own logger; the experiment adapter is composed with no `execution` and no `updates`, so this process starts no run and broadcasts no cell; DSPy retention is the deployment default (49) for every project because the retention vertical has not moved. `sendKeepAliveProbe` warms the engine over the SYNC route rather than the streaming Lambda one. Platform loses 14 files / 2,532 lines at zero insertions. apps/api 35 files/279 tests -> 37/290; workflow-server 7 files/35 tests -> 10/57; evaluator-server 6/78 unchanged; evaluation-server 24/191 -> 25/193. **The PRODUCT half is now composed by the process itself** (`api-trpc-collaborators.product.composition.ts`, folded by `withApiProductCollaborators` beside the other three): `annotation`, `bugReports`, `dataPrivacy`, `integrationsChecks`, and the `annotations` slice of `ctx.app`. It SEEDS the set rather than overlaying onto it — every one of its ports is a row read with an id already in hand, so there is no deployment shape in which the record is missing because of it — and a new `sealApiTrpcCollaborators` is what refuses a set any of the four halves left unfilled, naming each missing entry (`evaluations`, `application.workflows`, ...) instead of mounting twenty-two namespaces over the gaps. Moved out of `platform/app` at zero insertions: the bug-report repository and its two reads into `@langwatch/ops-server` (`BugReportRepository` port, `PrismaBugReportRepository`, `BugReportInboxService`); the data-privacy SNAPSHOT read model and the scope-write authorization into `@langwatch/data-privacy-server` (`DataPrivacySnapshotService`, `DataPrivacyScopeAuthorizationService`, a `DataPrivacyDirectoryPort` with its Prisma repository, a `DataPrivacyPermissionsPort` over `canBatchByIds`) — exactly the move `data-privacy.snapshot.ts` in the contract was declared against and waiting on; and the trace edit overlay (service + repository) plus `findExistingTraceIds` into `@langwatch/trace-server` (`TraceEditOverlayService`, `ClickHouseTraceExistenceRepository` behind a `TraceExistencePort`). `createTraceProcessingProducerPipeline` registers the SAME `trace_processing` definition the worker drains as a PRODUCER — ten refuse-by-name stand-ins, no consumer loop, no fold — so a reviewer's comment marks its trace through the routing triple the worker already routes on rather than through a forked definition. The privacy WRITE path now runs on the packaged `DataPrivacyService`, which already raised the contract's two errors, so the application's second implementation over the same table is no longer reached. **Named absences:** the reviewer's trace CONTENT (`annotation.loadTraces`) refuses `service_unavailable` because `TraceApp` takes twelve collaborators this process does not compose — `[]` would show a reviewer an empty queue and tell them their work was done; the two trace-side annotation markers refuse when no queue was composed; trace EXISTENCE answers the empty set with no ClickHouse, which is correct rather than degraded (no trace storage holds no trace to review); the simulations step of the setup checklist reports not started without a scenario read. **Judgement calls recorded:** the integrations-check rollup was composed IN the API rather than moved into `@langwatch/project-server` — the port's own docblock calls it the process's fan-out across nine verticals — and `platform/app/src/server/onboarding-checks/` was deleted rather than copied; the two scope-write refusals stayed `TRPCError` (`FORBIDDEN`/`NOT_FOUND`/`BAD_REQUEST`, the codes the application answered) rather than becoming new `HandledError` codes, because a new code needs an entry in a presentation registry that lives in a tree this migration only deletes from; `resolveScopeChain`'s three tiers were inlined in the checklist rather than dragging `@langwatch/data-retention-contract` into it; `data-privacy/contract`'s `data-privacy.snapshot.ts` docblock still says the read model lives in `platform/app` and is now stale, left alone because `*/contract` belongs to the UI lane. **`platform/app/src/server/api/root.ts` went 2,236 to 1,203 lines** — the `createAppTrpcFeatures` call and its 953-line ports object, the `...appTrpcFeatures` spread, the merged `user` namespace, the three annotation helpers and six now-dead imports, every one a deletion. Proof: `api-trpc-collaborators.product.integration.test.ts` (7 tests) drives `dataPrivacy.getSnapshot` (the whole moved read model, with the RBAC filter observable rather than assumed — a project in the organization's directory the caller cannot write is never offered), `annotation.createQueueItem` (queueing, with the id no trace answers to skipped) and `bugReports.getAll` (the moved repository plus its awaited audit row) through the real `/api/trpc` handler, `export.onExportProgress` through the real `/api/sse` lane on the same root, and both directions of the seal. What is left before `ApiProductionComposition` itself mounts the record: the model gateway, still host-supplied — with one handed in, all four halves compose and the seal passes. The `traces`, `tracesV2`, `scenarios` and `langy` namespaces remain OUTSIDE the record with the five remaining subscription procedures; that is a fifth half rather than the last line of this one, and this slice does not change it. **The MODEL GATEWAY is composed by the process itself** (`apps/api/src/app/api-model-provider.composition.ts`, resolved by `ApiProductionComposition.resolveModelProviders` and passed into `composeExecution`), so the execution half MOUNTS IN PRODUCTION with no host supplying anything: all six ports `PostgresModelProviderAdapter` takes are satisfied. Four come from services this process already held — the guarded Prisma client, the project/organization/AuthZ graph, the deployment's `SecretEncryptionPort` (the same cipher and the same `iv:ciphertext:authTag` format the platform app writes, so a credential row crosses processes unchanged) and the process's own fixed-window counter. Moved out of platform into `@langwatch/model-provider-server` at zero insertions: `providerValidation.ts` (1,230 lines) as `adapters/http.model-provider-credential-probe.adapter.ts` behind a new `ModelProviderEgressPort` (the `@langwatch/egress` fence, IP-pinned, redirects refused); `customKeys.ts`'s lenient read folded into `adapters/encrypted.model-provider-credential.adapter.ts` with its 19-test suite; `codexAccount.service.ts` as `adapters/codex-oauth.model-provider-token-refresher.adapter.ts` with its suite; `runtime/app/features/model-provider.ts`'s catalogue as `adapters/registry.model-provider-catalog.adapter.ts`, its limiter as `adapters/windowed.…-rate-limiter.adapter.ts` (both windows, 20/min per organization and 500/min globally, travel with the feature) and its id service as `adapters/prefixed.model-provider-id.adapter.ts`; and **`getVercelAIModel`'s whole resolution cascade** as `services/model-provider-execution-handle.service.ts` with explicit params — which is the harvest the langy-conversation blocker names. Judgment calls recorded rather than deferred: the onboarding grid's `providerApiRoots`/`providerDefaultBaseUrls` were NOT moved (that registry is a browser module with icons and labels), so the seven default endpoints and one API root are stated in the probe adapter; the CODEX handle is a named absence (`ModelProviderCodexHandlePort` unset) because a codex model executes on the AI gateway's Responses endpoint under a per-project virtual key and this process composes no provisioner, so a codex model refuses BY NAME rather than resolving to something else; managed providers are real, not defaulted — `@langwatch/enterprise-managed-provider-server` is composed here over the same project service, because a managed-Bedrock organization silently reading as unmanaged would send a run without the proxy credentials; `validateKeyWithCustomUrl` takes an explicit `environment` instead of reading `process.env`; `api.config.ts` gains `infrastructure.modelProvider` (`IS_SAAS`, `BLOCK_LOCAL_HTTP_CALLS`, `ALLOWED_PROXY_HOSTS` and the environment map a system provider's credential is read from) so the config module stays the process's only environment reader. One edit outside the vertical: `packages/egress/src/ssrf/fenced-fetch.ts` passes header ENTRIES rather than a `Headers` instance, because two copies of the undici types are reachable and a consumer with `@types/node` in scope (apps/api) could not assign one library's `Headers` to the other's parameter — a type-only fix that made apps/api's first use of the fence compile. apps/api 38 files/298 tests -> 40/305 (`api-model-provider.composition.integration.test.ts`, 5 tests, drives the composed gateway's cipher, counter and system-provider rules over fakes at the process seams; the execution integration test gains 2 that create a workflow through the real `/api/trpc` handler and prove the node's model came from a `ModelDefaultConfig` row the packaged repository read, with the no-default fallback as the discriminator); model-provider-server 15 files/146 tests -> 17/176 (the 30 in the two moved suites are the platform originals, adapted to the injected cipher and to a package with no DOM lib); egress 7/111 unchanged. Platform loses 8 more files at zero insertions. What is left on this row: `platform/app`'s own callers of the moved modules are LEFT BROKEN by ruling (presets.ts, root.ts, the internal-api model-provider router, ai-query, the three generate routes and langy-title-generation), and the model-provider tRPC/REST namespaces still do not appear in this process's record, so the moved credential probe is composed but unreachable here until they mount. **The OBSERVABILITY half is satisfied.** All sixteen of the trace/observability namespaces mount in the record — `traces`, `tracesV2`, `spans`, `traceEditOverlay`, `sharedTrace`, `share`, `pinnedTrace`, `savedViews`, `topics`, `costs`, `llmModelCost`, `modelProvider`, `translate`, `httpProxy`, `limits`, `plan` — through `apps/api/src/app-trpc/app-trpc.trace-group.ts` (one entry, one type parameter and one spread on the shared record file, so the group's twelve parameters live with the group) and `apps/api/src/app/api-trpc-collaborators.trace-group.composition.ts`. Both trace SUBSCRIPTIONS (`traces.onTraceUpdate`, `tracesV2.onDiscoverUpdate`) are inside the record and served over `/api/sse`, streaming off the process's own tenant emitter — the one read by `withApiTraceGroupCollaborators` off the identity half rather than composed a second time. Three new mounts: `features/topic/topic-trpc.mount.ts`, `features/model-provider/model-provider-trpc.mount.ts` (the provider surface's two data-dependent tenant gates ride the process's `custom` chain, the cost-rule write its `serviceAuthorized` one) and `createCostTrpcRouter` beside `plan`/`limits`. Moved into packages: `platform/app/src/server/api/routers/costs.ts` -> `@langwatch/entitlement-server`'s `transport/api-trpc/cost.api.ts` (transport plus a `readOrganizationSpend` port, because the rollup is narrowed by membership); `internal-api/topic.router.ts` and `internal-api/model-provider.router.ts` deleted outright, their policy chains rebuilt from `createTrpcApiService`. Composed here from this process's own graph: the share ledger and its Redis viewer cache, the retention policy a pin is bounded by, the topic tree, the stored filter sets, the organization spend rollup, the provider application and the two tenant gates. FOUR named absences, each degrading at the call rather than making sixteen namespaces unmountable — `ApiTraceReadStackPort` (the ClickHouse trace read stack: `TraceApp`'s ten readers plus the redaction, display, content-privacy and coding-agent passes, ~50 modules still under `platform/app/src/server/{app-layer/traces,traces}/**`, which no core package owns yet), `ApiModelProviderHostPort` (vendor credential probes, Codex device flow, cost-rule span preview; its regex safety gate falls back to a conservative answer because the cost-rule schemas are BUILT from it), `ApiStudioHostPort` and `ApiUsageStatsPort`, plus `plans` for the plan provider. Tests: `api-trpc-collaborators.trace-group.integration.test.ts`, 21 tests — the sixteen-namespace membership assertion, thirteen procedures driven one per namespace through the real `/api/trpc` handler, the anonymous `sharedTrace.get` resolved on the public procedure, both subscriptions driven end to end over `/api/sse`, and four on the composition's absences. apps/api suite 337 -> 334 passing across 41 files with two REST-agent files failing on an unrelated `@langwatch/react-rum/constants` resolution; trace-server 1605, model-provider-server 176, entitlement-server 4. `root.ts` 1203 -> 1010 lines at zero insertions in `platform/app`. Judgment calls recorded: the trace read stack is a named absence rather than a move this pass (the move is ~50 platform modules and two more verticals' redaction rules); `costs` was given to Entitlement rather than a new package because spend is the reading taken against a plan's allowance; and the group's fold REFUSES rather than passing an absent half through, because unlike analytics/identity/execution it cannot be missing on a process holding a database. **The AGENT half is satisfied.** All six of the agent surfaces mount in the record — `scenarios`, `suites`, `langy`, `langyEgress`, `ops`, `setupSkills` — through `apps/api/src/app-trpc/app-trpc.agent-group.ts` (one entry, one type parameter and one spread on the shared record file) and `apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts`, folded by `withApiAgentGroupCollaborators` beside the other folds and sealed with them. **All three remaining subscriptions are inside the record and served over `/api/sse`** — `scenarios.onSimulationUpdate`, `langy.onConversationUpdate` and `langy.onTurnStream` — which closes `ui-subscription-transport.md`: every one of the browser's ten live procedures now resolves on this process's own root. Two of the three stream off the SAME tenant emitter the trace group reads off the identity half, so a browser watching a simulation and a browser watching a conversation listen to the object the worker's own fan-out writes to. Composed here from this process's own graph: `ScenarioApp` (the packaged `PrismaScenarioAdapter`, the ClickHouse simulation reader on the same routed connection the charted reads use, Redis tab presence, the deployment's own cipher behind a `ScenarioSecretCipherPort`), `SuiteApp` (the packaged `PostgresSuiteAdapter` over the same connection), `LangyApp` (the Postgres conversation and message projections the worker writes, the Redis token buffer it appends to, the turn-access and handoff stores) and `OpsApp` (the Postgres half of `PostgresOpsAdapter`: the admin allow-list, the impersonation ledger and the back-office reads). Moved out of `platform/app` at zero insertions into `@langwatch/langy-server`: the setup-skill catalogue (`server/skills/setupSkills.service.ts` + `setupSkillBodies.generated.json` -> `services/setup-skills.service.ts` + `services/setup-skill-bodies.generated.ts`, with `scripts/generate-setup-skill-bodies.ts` moved beside it and proved byte-identical), a new `transport/api-trpc/setup-skills.api.ts` because no package transport existed, and the agent-to-page UI-action channel (`server/app-layer/langy/ui-actions/ui-action.service.ts` -> `services/langy-ui-action.service.ts`) with its seven handled errors moved into `@langwatch/langy-contract`'s `langy.errors.ts`. New mounts: `apps/api/src/features/langy/langy-trpc.mount.ts` (which appends the two Langy gates AFTER the process chain, demo refusal then rollout, the order the platform host pinned) and `features/langy/setup-skills-trpc.mount.ts`; the scenario, suite and ops mounts already existed and were reused. `ApiTrpcContext` gains two keys the six surfaces read: `signal` (the browser's own abort signal, threaded onto the context by the subscription lane as well as into the caller's options, so a v10-shaped caller cannot leave a generator suspended after the browser is gone) and `opsScope`. **Named absences, each with its consequence:** every write that has to ENQUEUE work refuses by name — the eight simulation commands, the two suite-run commands and all sixteen Langy conversation commands — for one structural reason rather than six: this process's Eventing is producer-only and holds no `ProcessStore`, and both the simulation and Langy pipelines declare a process manager, which such a runtime refuses to register rather than half-run. Producing them needs a producer-only variant of each definition, the way `createTraceProcessingProducerPipeline` is for its pipeline, and that is its own slice. The scenario RUNNER refuses too (its prefetcher reaches ten other verticals). A Langy turn-start refuses with the feature's OWN `langy_agent_unavailable` rather than this composition's code, because a web process composes no agent manager and Langy already has a typed refusal for that shape. The operator runtime is mostly absence: the event-log explorer, the process-manager fleet, the replay runner and the scheduled-job store have no packaged implementation anywhere, so all four refuse by name; `redis` is deliberately NOT passed to `PostgresOpsAdapter`, because its own invariant demands a queue payload decoder alongside and decoding an offloaded job needs the tiered blob store the stored-object vertical has not moved. The page-action catalogue is absent (it is the experiments workbench's, a browser module), so a UI-action DISPATCH refuses while `claim`/`complete` — the two procedures the record mounts — work whole. **Judgment calls recorded:** the setup-skill bodies became a TypeScript module rather than JSON because this package is consumed from source and a JSON import would need `resolveJsonModule` plus a runtime import attribute on Node; `findPageAction` became a `LangyUiActionCatalogPort` rather than travelling, because a Langy server package may not reach another feature's manifest; the Langy rollout flag key (`release_langy_enabled`), the two Langy budgets (30 messages and 60 warms per minute) and the two scenario ksuid prefixes (`scenario`, `scenariorun`) are STATED in the composition, each because the module that held it is a browser package or a tree this migration only deletes from — and all five are persisted or wire constants rather than decisions; the simulation partition-window read runs UNWINDOWED (`run(null)`), because the shared policy it called was deleted rather than moved and a second copy of a windowing heuristic is a second thing to keep true; a second `PostgresPromptAdapter` read is built for the suite adapter because the product-group half wraps its own in a `PromptApp` that does not expose the service, and both are stateless reads of one row; the operator allow-list is taken from the identity half's already-parsed `config.opsSidebarEmails` so the gate and the menu cannot disagree; and `platform/app/package.json` was left UNTOUCHED — its `generate:setup-skill-bodies` entry now points at a deleted script and `start:prepare:files` fails at that step — because editing the line would have been an insertion, and the artifact it produced is checked in and regenerated with `pnpm --filter @langwatch/langy-server generate:setup-skill-bodies`. Proof: `api-trpc-collaborators.agent-group.integration.test.ts`, 14 tests — the six-namespace membership assertion, six procedures driven one per namespace through the real `/api/trpc` handler (with the scenario read's project scope and archived filter observable rather than assumed, and a real ~100 kB skill body served from the moved catalogue), all three subscriptions driven end to end over `/api/sse` (including the user-scope gate that drops a tenant-wide Langy signal for a conversation the caller does not own), and four on the absences: the refused scenario runner, the refused Langy turn, the operator probe answering `{kind:"none"}` for a caller off the allow-list rather than refusing, and a project outside the rollout answering `langy_not_enabled` rather than an empty list. langy-server 49 files/473 tests, langy-contract 29/486, scenario-server 765 passing (two Redis-dependent files skip without one), suite-server 6/51, ops-server 180 passing. `root.ts` 998 -> 919 lines at zero insertions; twelve platform files deleted. What is left on this row: `platform/app/src/server/routes/langy-ui-actions.ts`, `uiActionBackendExecutor.ts` and `pageManifests.ts` are LEFT BROKEN by ruling (their import of the moved service and its errors), and the write side of all three verticals waits on the two producer-pipeline variants. **The ORG GROUP half is satisfied.** Nine more namespaces mount in the record — `organization`, `project`, `codingAgents`, `automation`, `emailSuppression` and the Enterprise four (`license`, `licenseEnforcement`, `scimToken`, `ssoConnections`) — through `apps/api/src/app-trpc/app-trpc.org-group.ts` (one import, one type parameter and one spread on the shared record file, the same shape the trace group settled on) and `apps/api/src/app/api-trpc-collaborators.org-group.composition.ts`. They are one group because every one of them is a WRITE against the TENANT rather than against what the tenant recorded. Three new mounts: `features/project/project-trpc.mount.ts` gains `createProjectTrpcRouter` (its two data-dependent gates — `create`'s custom tier resolution and the extra `project:manage` a trace-sharing flip demands — are built from this process's own AuthZ service, because `declaredCheckFrom` refuses to build a custom check from a description of one), `features/enterprise/enterprise-trpc.mount.ts` calls `EnterpriseTrpcComposition` (the one seam a core process may see an Enterprise feature package through) and forwards four of its six routers, and `app/api-automation.composition.ts` composes `AutomationApp` over the real `PostgresAutomationAdapter`. Composed here from this process's own graph: the project application (`ProjectApp` over the tenancy graph plus the trace group's OWN share ledger and topic tree — taken rather than built, so the settings form and the explorer cannot disagree about what a project holds), the coding-agent application (`CodingAgentRuntime` over this process's ClickHouse, with `clickHouse: null` a supported shape rather than a degradation because a session is a projection there), the GitHub App (`PostgresGithubAdapter` from five new `infrastructure.github` config leaves — composed unconditionally, blank credentials included, because the feature's own `configured` flag is what turns an install with no App into "not connected" rather than a failure), the automation application, the monitor directory (memoized, so a trigger's label and the monitor page it points at read one service) and both Enterprise plan gates over the SAME plan provider the usage panel reads. Moved out of platform at zero insertions: the automation provider registry — `registry.ts`, `types.ts`'s two hooks and the annotation-queue and email server halves — into `@langwatch/automation-server` as `adapters/registry.automation-provider.adapter.ts`, taking the cipher injected instead of the platform application's own `encrypt`/`decrypt`; and `resolveCallerProjectScope`'s two permission cuts into `@langwatch/coding-agent-server` as `CodingAgentCallerScopeService` behind a directory port and a batched permission port. `@langwatch/organization-server` gained nine exports its own services already held (`LITE_MEMBER_VIEWER_ONLY_ERROR`, `computeEffectiveTeamRoleUpdates`, `OrganizationNotFoundError` and the two invite messages among them), so the platform twins became unreachable. **Named absences, each with its consequence:** `ApiOrganizationInvitePort` — the whole invitation half of `organization.*` refuses by name, because the 1,660-line `InviteService` reaches the licence-enforcement repository, the plan provider, the mailer and the role service, four verticals that have not moved, and an empty invite list would tell an administrator nobody had been invited; `ApiViewerProtectionsPort` — the SAME resolution `ApiTraceReadStackPort.getViewerProtections` answers, so `codingAgents.sessionsList` and `project.getFieldRedactionStatus` refuse rather than guessing (guessing high shows a reader content they may not see, guessing low tells them their project is empty); `ApiEnterpriseApplicationPort` — the licensing, usage-limit and SCIM slices refuse by name while the four namespaces still MOUNT, because a client asking what its licence allows has to be told this deployment cannot answer rather than find the namespace missing; the automation running half (scheduling, graph delivery, runaway containment, test fire, the heartbeat's ClickHouse) refuses by name, because those are the WORKER's and a test fire that reported success having sent nothing is the failure that looks like success; the persist cap is the one exception and is composed for real, over the same Redis counter the worker spends against; `assertTeamRoleChangeWithinSeatLimits` refuses, the same refusal the identity half already answers with for `OrganizationSeatLicensePort`; and `provisionLangyVirtualKey` LOGS instead of refusing, because it is best-effort by the port's own contract and refusing would cost somebody the project they just created. **Judgment calls recorded:** `ctx.app.projects` widened from the flag surface's narrow `getOrganizationId` read to the whole `ProjectApp` — the narrow declaration in the flag package is unchanged and this satisfies it, and two project applications would let the settings form and the flag resolution disagree; `subscription` and `currency` are NOT forwarded from the Enterprise composition even though it builds all six, because with `saasBilling` false it hands back empty routers of the served type and an empty router under a real wire name is worse than no wire name; `req` is present and `undefined` on the API's tRPC context because the Enterprise composition constrains its context to all six of its surfaces, and the hosted edge's geo headers never reach this process; the caller-scope Prisma reads stayed in `apps/api` rather than moving into `@langwatch/coding-agent-server` because that package declares no Prisma dependency and the rule (the two cuts and the personal-workspace labelling) is the half worth moving; `project.triggerTopicClustering` refuses by name and the caller now READS that name: the project transport re-raises a handled refusal untouched and degrades only the causes it cannot name (event-store and projection internals), so a deployment composing no clustering wake path answers `service_unavailable` rather than a trace id; `FULL_MEMBER_LIMIT` and the automation persist ceilings (50/500/5,000) are stated in the composition rather than imported, because the licence-enforcement vertical has not moved and defaulting to an unset variable would give every free project the paid ceiling; `asResourceLimitExceeded` answers `null` always, which is correct rather than degraded because nothing on this process raises that class. Proof: `api-trpc-collaborators.org-group.integration.test.ts` (9 tests) drives `project.getHasFirstMessage`, `codingAgents.usageTotals`, `automation.getTriggers` and `emailSuppression.getAll` through the real `/api/trpc` handler over fakes at the ports, asserts the nine-namespace membership, and pins four absences — the invitation refusal, the protections refusal, the clustering failure and `license.getStatus` refusing while still mounted. `platform/app/src/server/api/root.ts` went 998 to 540 lines at zero insertions, and ten platform files went with it: `internal-api/project.router.ts` and its suite, `invites/invite-send-throttle.ts`, `app-layer/organizations/compute-effective-team-role-updates.ts` and its suite, and the five automation provider modules plus their two webhook suites. What is left on this row: the invitation service, the protections resolver and the Enterprise application are the three ports a deployment must hand in before `organization.*`'s invitation half, the two content-visibility reads and the Enterprise four answer for real. **The PRODUCT-INFRASTRUCTURE half is composed by the process itself** (`apps/api/src/app/api-trpc-collaborators.product-infra.composition.ts`, folded by `withApiProductInfraCollaborators` beside the other halves). `storedObjects`, `dataRetention` and `monitors` mount INSIDE the record through `apps/api/src/app-trpc/app-trpc.product-infra.ts` — one entry, one type parameter and one spread on the shared record file, the same shape the trace, organization and agent groups take, so the group's parameters live with the group rather than on a file five other halves also edit. They are one group because they are one graph at a composition root: each is answered from a store the PROCESS operates — the object store's ClickHouse rows and byte backend, the retention window those rows are swept on, the evaluation monitors running beside them — and none of the three reaches the model gateway, the NLP engine or a mailer. Moved out of `platform/app` at zero insertions. Into `@langwatch/stored-object-server`: the CONTENT-ADDRESSED store whole — `StoredObjectsService` (`services/stored-objects.service.ts`), its ClickHouse repository and row schema (`repositories/clickhouse/stored-objects.{repository,row}.ts`), the S3 and local-filesystem byte drivers as `adapters/{s3,local-filesystem}.stored-object-driver.adapter.ts`, `ObjectNotFoundError`, and the five Prometheus series (unchanged names, so a dashboard reading `stored_object_write_failures_total` keeps reading the same counter) as `adapters/prometheus.stored-objects-telemetry.adapter.ts`. Four seams replaced what the platform module read directly: `getApp().clickhouse` became `StoredObjectsClickHousePort`, `~/server/metrics` became `StoredObjectsTelemetryPort`, `~/server/storage`'s `createS3Client` became `StoredObjectS3TargetPort` plus a structural client policy, and `~/env.mjs` became a REQUIRED `mintStorageUri` — required rather than defaulted, because a service that guessed a destination would spill a tenant's bytes into the wrong place on a misconfiguration instead of failing where the operator can see it. The plural `StoredObjectsService` sits beside the singular canonical `StoredObjectService` on purpose: an object written through one is not readable through the other, which is why both exist and neither wraps the other. Into `@langwatch/data-retention-server`: the retention POLICY whole — `DataRetentionPolicyService` (the write gates, the tiering rule, the enterprise custom floor and the paid presets), `DataRetentionSnapshotService` (the RBAC-filtered read model the settings page renders) and `StorageMeterScopeService` — over four new ports, `DataRetentionDirectoryPort` with `PrismaDataRetentionDirectoryRepository`, `DataRetentionPermissionsPort`, `DataRetentionPlanPort` and `DataRetentionAdministratorPort`. Into `@langwatch/analytics-server`: `currentVsPreviousDates` as `model/current-vs-previous-dates.ts`, the home its own docblock had already named. `apps/api` gains `infrastructure.storedObjects`: `STORED_OBJECTS_BACKEND`, `LANGWATCH_LOCAL_STORAGE_PATH`, the six `S3_*` values and the per-organization `DATAPLANE_S3__<label>__<org>` routes, read there because that module is the process's only environment reader — and the routes are read at all because a process that ignored them would resolve every project to the shared bucket, which still works, which is precisely the danger. **Named absences, each with its consequence:** `monitors.getPerformanceForProject` refuses `service_unavailable` because the evaluation-run read stack has not moved — `[]` reads as "your monitors caught nothing", which is the one answer a person acts on by switching a monitor off; the AZURE byte driver is not registered, so an `azure-blob://` URI refuses by SCHEME rather than being reported as gone; the legacy id-only stored-object OWNER lookup answers `null`, because resolving a project from an object id alone means scanning every ClickHouse instance and this process holds a ROUTED connection — nothing on the record asks, since the probe carries its own `projectId`; the PORTABLE stored-object capability (upload ceremony, delivery capability, metadata read) refuses by name rather than being wired to the content-addressed store, because an upload confirmed against one store and read back through the other is a file the customer uploaded and nobody can find; and every retention plan gate refuses without a plan provider rather than passing a gate it could not evaluate. **Judgment calls recorded rather than deferred:** the retention policy went to `@langwatch/data-retention-server` rather than `@langwatch/data-privacy-server` — the modules are `server/data-retention/**`, the catalogue owner is Data Retention, and `DataRetentionTrpcApi` already lived there; `DataRetentionPlanPort` answers `{free, uncapped}` rather than a `PlanInfo`, so the retention TIERING stays in the feature (which is what that map's own docblock asked for) and `isEnterpriseTier`/`IS_SAAS` stay in the composition; the policy's refusals stayed `TRPCError` (`FORBIDDEN`/`NOT_FOUND`) with the copy the application answered, for the same reason the product half's two scope writes did; `monitors.preconditionsSchema` falls back to the contract's own `monitorPreconditionsSchema` because `PRECONDITION_ALLOWED_RULES` now lives in `@langwatch/analytics-web` and no server module may value-import a browser package — the field/rule cross-check returns with the registry, exactly as `mappingsSchema` did; the monitor service is TAKEN from the execution half rather than built here, so an experiment's own monitor upsert and the monitors page cannot disagree; the trace-media extractors (`content-extractor.ts`, `value-media-extractor.ts`, `coerce-content-to-array.ts`, `binary-part.ts`) stayed in platform because they walk TRACE content parts and media markers and belong to that vertical rather than to Stored Objects; and the Azure driver, its credential resolution and its token provider (1,216 lines with an `@azure/identity` dependency and live platform importers) were not moved, which is what makes the scheme an absence. Backlog rather than blockers: `apps/worker` still carries its own S3 and filesystem drivers, which should collapse onto the package adapters; the `DATAPLANE_S3__*` reader is now stated in `api.config.ts` as well as `worker.config.ts` and wants a shared `@langwatch/config` helper; and `resolveMonitors` in `api-production.composition.ts`, added concurrently for the automation application, should collapse onto the execution half's service. Platform loses 30 files / 4,978 lines at zero insertions, and `platform/app/src/server/api/root.ts` went 540 to 532 on this slice. **All five named absences on the observability half are retired.** (1) The ClickHouse trace READ stack moved into `@langwatch/trace-server`: 46 modules / ~17,300 lines out of `platform/app/src/server/{traces,app-layer/traces}/**` under the layer grammar — `clickhouse-trace.service.ts` (3,655 lines) is `repositories/clickhouse/trace-legacy-read.repository.ts`, the ten readers are `services/trace-*-read.service.ts`, and the mappers, the blob store, the AI composer, the TTL cache, the windowed read and the cold-scan detector came with them, plus 33 test files. `trace-io-extraction.service.ts` and `trace-projection-lean.service.ts` were already byte-identical twins in the package, so the platform copies were DELETED and the imports repointed rather than moved. No data-privacy move was needed: the content-key catalogue, the visibility markers, `resolveDataPrivacy` and `ContentDropPolicyService` were already packaged, so the `contentPrivacy` mapper port is satisfied from `@langwatch/data-privacy-{contract,server}`. Three modules that had been moved into the BROWSER package `trace/web` but are read server-side (`trace-python-repr`, `trace-prompt-reference`, `trace-edit-overlay-apply`, plus the list window and the editable-metadata keys) moved into `@langwatch/trace-contract` and the six web importers were repointed. `apps/api/src/app/api-trace-read-stack.composition.ts` composes the stack over this process's own ClickHouse; the trace group takes a `traceReadsFrom` FACTORY rather than a finished port, because the stack needs the retention cascade and the topic tree the group itself composes and a second of either would be a second answer. (2) `ApiModelProviderHostPort` is filled from `@langwatch/model-provider-server`: the safe-regex gate, the model-limits registry and the cost-rule span preview moved out of `platform/app/src/{utils,server/app-layer/traces,server/modelProviders}` into `services/model-{cost-regex-safety,limits,cost-preview}.service.ts` and `services/ai-call-failure.service.ts`. The unmapped-cost hint is wired in the TRACE GROUP rather than the host, because it is the one reading that needs both the trace store and the gateway's stored rules. (3) `ApiUsageStatsPort` and the plan provider are filled from `@langwatch/entitlement-server`: `member-classification`, the membership repository, the usage-meter policy and `UsageStatsService` moved out of `platform/app/src/server/license-enforcement/**` and `app-layer/usage/**` behind two new abstract ports (`UsageCounterPort`, `UsageMembershipPort`). Judgment calls recorded: the free-tier message ceiling (`999_999_999`) and `MemberType` are STATED in the package rather than imported from the EE billing and licensing contracts, so an OSS build resolves a plan without them; the EE licence and subscription sources stay named absences that `LoggedApiEntitlementAbsence` writes down. (4) `ApiStudioHostPort` is filled by `apps/api/src/app/api-studio-host.composition.ts`: `platform/app/src/app/api/workflows/post_event/**` and `server/workflows/stripUnsupportedLLMParams.ts` were DELETED, and the behaviour they carried is now `WorkflowStudioStreamPort` + `HttpWorkflowStudioStreamAdapter` (the wire) and `WorkflowStudioDispatchService` (the SSE framing, the abort poll and the rule that a stream failure is reported AS a studio event) in `@langwatch/workflow-server`. The per-project Lambda routing and the S3 payload staging were deliberately not carried — they are the deployment's, and the platform Lambda runtime stays where it is. The sampling-parameter strip is `WorkflowNlpExecutionService.stripUnsupportedParams`, made public rather than duplicated, because there are now TWO dispatch chokepoints. The agent test's own trace write goes onto the SAME `trace_processing` producer registration the product half already made — the pipeline may only be registered once, so `composeApiProductCollaborators` now publishes `traceCommands` and the trace group and studio host both send on it. Also moved: `platform/app/src/server/tracer/spanToReadableSpan.ts` into `@langwatch/trace-server` as `services/trace-readable-span.service.ts`, whose lazy `import("@langwatch/scenario")` became a top-level import (the repo bans inline `import()`), which is why trace-server gained `@langwatch/scenario` and the two OTel SDK dependencies. The analytics ClickHouse filter translator is now exported from `@langwatch/analytics-server` and joined to the read stack at the process, because a feature server package may not reach into another feature's server package; without it a FILTERED legacy list refuses rather than answering the unfiltered set. Left named inside the read stack: the trace RENAME command, the query field-value read, the log canonicaliser, the summary projection store and the offloaded-payload resolver, all of which belong to verticals that have not moved. Proof: `api-trpc-collaborators.product-infra.integration.test.ts` drives all three of `storedObjects.headById`'s answers through the real `/api/trpc` handler over the moved repository, the storage registry and the local-filesystem driver against real bytes on disk (available / missing / not_found, which is the whole point of the probe), `dataRetention.getRules` with the RBAC filter observable rather than assumed (a team the caller cannot manage is neither offered as a writable scope nor allowed to name its own rule), `dataRetention.getScopeStorageUsage` narrowing an organization-wide reading to the one project the caller may view, `monitors.getAllForProject` off the execution half's own service, and both the performance-trend and plan-gate refusals. | Satisfy the remaining halves — the organization app service, sign-up/invite/provider-resolution, the trace pipeline, the evaluator/NLP ports and the evaluation_processing pipeline — each folding into the collaborator set the way `withApiAnalyticsCollaborators` does. Then fill the three fail-closed analytics ports from their own verticals (protections from trace/data-privacy, the graph-alert lookup and the action-parameter redaction from automation), and cut haven's app lane to `apps/api`. **`root.ts` is DELETED** (2026-09-02): its last twenty-two namespaces — the six core gateway surfaces, the fifteen Enterprise gateway, governance and billing ones, and `github` — mount on `apps/api`, and `composeGatewayApp` moved out of `app-layer/presets.ts` with them. The observability half's five named absences are RETIRED (see the fact column); what is left inside it is named there rather than here. |
| Worker | Packaged registry is the one consumer since `4542cdc38c`. Trace conversion: g1 (projection collaborators) and g2 (project-metadata, model-cost-catalog, monitor-catalog, data-privacy-resolution seams) landed; worker suite 365. | g3–g7 and the 29-key trace conversion (in flight), then scenario, langy-conversation, gateway-spend, automation-half on the g2 seams. |
| UI | 39 loader keys left of 149. Out: governance, gateway, me, automations, ops, analytics, evaluators, integrations, unsubscribe, workflows list+chat, auth front door (8 keys). | Studio, traces + share, chrome layout route (dashboard layout, project switcher, drawer mount; unblocks the authorize pages and every recorded drawer gap) in flight; then onboarding, org/members/teams, billing, experiments workbench, simulations, langy layout. |
| Platform residue | **38 files, 6,813 lines** (11 non-test files, 2,073 non-test lines) with bucket 4 and the final REST lane both landed. Bucket 4 took the composition root: `src/runtime/**`, `server/app-layer/{app,config,dependencies,index,presets,redis-readiness,worker-eventing-handoff}.ts`, the process entry points (`start.ts`, `env*.mjs`, `instrumentation*.ts`), the task lane, `src/types` and the `server/api` remainder — 233 files, 41,072 lines. `src/app/` is gone, and so is `server/api-router.ts` — the API process serves every REST family off its own enumeration now. What is left: `src/server/**` (27 files, 5,618 lines — `metrics.ts`, `db.ts`, `posthog.ts`, `securityHeaders.ts` and loose test files), `src/__tests__/**` (6 repo-level guards over the Dockerfile, `.env.example` and postinstall), `src/pages/api/collector.stress.test.ts`, `src/docs/`, `server.mts`, `noop-css.cjs`. | The test harness (`vitest*.config.ts`, `test-setup.ts`) and `server/metrics.ts` go at cutover, together with repointing the root `pnpm test:*` scripts. See the bucket-4 cutover checklist at the end of this document — the production image entry point and `pnpm prepare:files` are broken as of that bucket. |

The long rows under "Active and residual slices" and the worker blocker graph
are the historical record of how each seam was found; read them for evidence,
not for current state. The UI ledger is `ui-family-move-manifests.md`; the
subscription lane is `ui-subscription-transport.md`.


**Goal:** delete `platform/app` after its UI, API, worker, configuration,
backend, tests, assets and deployment responsibilities have canonical owners.

This is the executable ledger for the whole exit. It replaces the earlier
historical narrative with ordered work, dependencies, deletion boundaries and
verification gates. The shorter operational restart notes remain in the
[core hand-off](core-application-feature-extraction-handoff.md) and
[API transport hand-off](api-transport-extraction-handoff.md).

## Authorities and invariants

### Nothing new goes in `platform/app`

**Decided 2026-08-28, hardened 2026-09-01.** No slice may add a file under
`platform/app`, and no edit there may add content — deletion is the only
permitted operation. This supersedes the earlier allowance for repointing
imports: repointing a platform file at a new package location is an addition,
so the correct move is to delete the platform file (or the entry) and wire the
replacement in `apps/{api,worker,ui}` or the package instead. The tree only
shrinks. Corollary of the not-gradual ruling: if a deletion breaks
`platform/app`'s boot or typecheck, leave it broken — never spend a change
keeping platform alive.

This corrects the transport pattern Wave 3 had been following. The mount for a
moved tRPC or REST surface was going to
`platform/app/src/runtime/app/internal-api/`, which meant every successful
vertical made `platform/app` slightly larger while making a package larger too.
Thirty-two mounts accumulated that way. They belong in `apps/api`
(`@langwatch/platform-api`); worker installers belong in `apps/worker` and
browser code in `apps/ui`.

The dependency direction is already established — `platform/app` depends on
`@langwatch/api`, `@langwatch/ui` and `@langwatch/worker` — so the old
application importing the new owner is ordinary, and the reverse is what would
be wrong.

The test for a slice is not "did the package get better". It is "did
`platform/app` get smaller". A slice that grows both has moved backwards however
good the code is.

### oxlint and oxfmt are the toolchain

**Done 2026-08-28 (`102e74a6c6`).** Biome is removed. oxlint is the only linter
and oxfmt the only formatter. Twenty-four rules were measured one by one against
oxlint over `platform/app/{src,scripts,e2e,prisma,vite}` rather than assumed
equivalent; twenty carried at `error` full-tree with an enumerated file register
for the existing backlog. There is no warn tier, which is what makes the
reviewdog delta gate unnecessary rather than merely absent.

`apps/**` joined the lint scope in the same change. It had been linted by
nothing — the three directories this extraction moves code *into* were the only
unchecked ones in the repository. Its five `package-boundaries` errors were all
tests of a composition root importing what that root imports, so the rule was
widened to recognise `apps/{api,worker}/tests/**` rather than baselined.

**Four rules were lost, and two of them are recoverable.** `noFloatingPromises`
(39 findings) and `noMisusedPromises` (19) exist in oxlint but need
`--type-aware` and the `oxlint-tsgolint` binary, which is not a dependency here;
`useOptionalChain` (2) and `useLiteralKeys` are type-aware-only for the same
reason. `noImplicitAnyLet` (35) and `noEvolvingTypes` (46) have no oxlint
equivalent at all and need TypeScript semantics.

`F-LINT-02`: **wire `oxlint-tsgolint`.** It restores all four type-aware rules
in one move and is the highest-value lint follow-up. It needs a machine that can
run a type-aware lint over the tree, so it is deliberately not attempted here.

Two whole-tree checks are red for reasons unrelated to any current change, and
neither should be read as a verdict on a diff: `pnpm format:check` fails on
5,939 of 14,007 files, and `pnpm lint:oxlint` exits 1 on ~2,919 findings, all
pre-existing `langwatch/*` architecture rules plus `eslint/curly`. The reformat
wants one deliberate commit of its own.


- `packages/features/catalogue.json` is the authority for the 49 singular
  feature owners.
- Accepted repository ADRs and each feature ADR/spec define architecture and
  behaviour. This plan records execution order, not a second architecture.
- `apps/api`, `apps/worker` and `apps/ui` are physical process composition
  roots. `apps/server` is local/development orchestration only.
- A feature owns its contract, canonical server implementation and reusable
  web behaviour. API, worker and UI processes install those surfaces; they do
  not reimplement them.
- Move one vertical and delete the displaced production implementation. A
  package-only copy or a compatibility wrapper containing business logic does
  not count as progress.
- Preserve URLs, procedure names, OpenAPI shapes, response fields, auth,
  errors, ordering, pagination, time/money units, effects, retries and
  idempotency unless an explicit decision changes them.
- Do not copy `platform/app/src/server/app-layer`. Replace its global graph with
  explicit process composition and injected complete services.
- Packages do not read environment modules. Each process parses and validates
  configuration once through `packages/config` and injects typed semantic
  values.
- API and worker construct one process-owned logger/tracer graph from
  `@langwatch/observability/node`; UI uses only browser-safe observability.
- Generated Prisma stays private to strict Prisma repository adapters.
- Core never imports Enterprise implementations. Role-specific Enterprise
  composition stays under `packages/enterprise/composition/**`.
- Shared-worktree changes are never staged wholesale. Root stages exact paths
  or hunks after migration review and commits coherent slices.

## Definition of done

The exit is complete only when all of the following are true:

1. `apps/api` is the live HTTP/tRPC/REST process and owns request context,
   auth, authorisation, limits, error mapping, logging, tracing and graceful
   shutdown.
2. `apps/worker` is the live background process and owns queues, Eventing,
   projections, process managers, wakes, retry-safe intents, scheduled tasks,
   logging, tracing, liveness and graceful drain.
3. `apps/ui` boots the browser, owns all routing/page composition and installs
   reusable feature-web screens/surfaces without `platform/app` imports.
4. Every catalogue feature has one canonical contract/service/repository graph;
   its API, worker and UI callers use it.
5. No production code uses global `App`, `getApp`, `tryGetApp`, global Prisma,
   package-level env access or import-time registration.
6. Public REST, internal tRPC, SDK, MCP, webhook, ingestion and generated
   OpenAPI/client contracts have explicit parity proof.
7. Prisma/ClickHouse migrations, tasks, assets, E2E suites, scripts,
   instrumentation, CI and deployment definitions no longer assume
   `platform/app`.
8. `platform/app` and every workspace, build, CI, Docker, deployment, docs and
   test reference to it are deleted.

## Current checkpoint

### Committed foundations

| Commit       | Durable result                                                                    |
| ------------ | --------------------------------------------------------------------------------- |
| `5f7f2046dc` | Schema-first public REST framework with explicit access/version/error policy.     |
| `0b65dc696d` | Architecture lint for fluent REST handlers.                                       |
| `6d86932ce9` | Public REST and internal tRPC are separate transport surfaces.                    |
| `13a0805bf3` | Prompt boundary, initial UI shell, frontend lint and Design System integration.   |
| `410c5dc1eb` | Enforced two-scope feature-web layout and exact screen/surface boundaries.        |
| `3d1166d8cc` | Semantic OpenAPI 3 comparator with recursive reference handling and CI coverage.  |
| `1431f48836` | Previous coordinated extraction checkpoint.                                       |
| `2d5066fcd7` | Moved the Agent management screen and reusable behaviour into its web package.    |
| `555ec3fe07` | Added production Eventing server adapters and runtime composition.                |
| `8e57032744` | Composed Enterprise managed-provider worker capability from explicit ports.       |
| `bcf05be631` | Added process-owned Node logging, tracing and shutdown primitives.                |
| `7cca0848fb` | Added internal Trace full-read and Topic-assignment ports without route cutover.  |
| `0322204dea` | Added reusable path/header/latest REST version selection.                         |
| `faf6db77e1` | Exposed Secret through the four direct REST prefixes and retained main parity.    |
| `02457aaebd` | Moved Agent and Secret tRPC behaviour into package-owned app adapters.            |
| `39f1de6dff` | Routed Topic clustering through Eventing and composed a producer-safe worker.     |
| `0d877db1d7` | Drained Eventing and feature handles before worker infrastructure/observability.  |
| `589a251194` | Hardened semantic OpenAPI comparison for path and reference edge cases.           |
| `eab4d6fd6e` | Moved chunk recovery out of `platform/app` into global UI behaviour.              |
| `f1baea7011` | Added the standalone API listener, request policy, config and graceful drain.     |
| `f9dbf94c8a` | Mounted package-owned Secret REST on all four bases in the API process.           |
| `cd28835a7b` | Moved Trace processing and Dataset auxiliary jobs into an Eventing installer.     |
| `1956fe0c06` | Enforced the global/private UI hierarchy and removed `apps/ui/src/app`.           |
| `1acf62c524` | Unified Eventing with the workspace SDK and added ordered telemetry flushers.     |
| `a33224992f` | Preserved worker drain ordering when Eventing readiness or transport boot fails.  |
| `6071fe0fb8` | Added typed process-owned ClickHouse routing, connections and shutdown.           |
| `e1e7cefb6a` | Moved the strict browser-safe public config schema and codec into UI ownership.   |
| `f49f214927` | Injected Eventing runtime policy and made durable store selection fail closed.    |
| `13f6138060` | Moved logger environment compatibility into typed process configuration.          |
| `de540cf12e` | Enforced injected configuration across production reusable-package source.        |
| `25d7f809ed` | Added the injectable API process runtime and ordered shutdown boundary.           |
| `26d0711478` | Injected Gateway virtual-key cryptography through process composition.            |
| `ad1707fffc` | Composed canonical User avatar storage and removed the displaced User module.     |
| `02eae20840` | Added the injectable Worker process foundation with fail-safe startup cleanup.    |
| `67797154c1` | Fixed legacy App resource ownership and removed a process-scope self-wait.        |
| `2e43807329` | Corrected the Gateway virtual-key process projection boundary.                    |
| `2088ac9e67` | Parsed and injected the complete Group Queue process policy once.                 |
| `12785bd78f` | Composed process-owned AWS transport policy and retired its duplicate app code.   |
| `e3d2551c6f` | Made Eventing process storage fail closed with explicit test/local factories.     |
| `6b9ca49158` | Added target-aware, lease-safe Dataset S3 client lifecycle ownership.             |
| `834e94f5aa` | Sealed the complete Worker registration phase before Eventing readiness.          |
| `6efea93600` | Composed one App-owned Redis connection with ordered shutdown.                    |
| `fa1a759f47` | Isolated SDK client disposal from process-owned AWS handler pools.                |
| `7246b22c13` | Projected legacy telemetry once and made signal headers authoritative.            |
| `89b5f2fb17` | Composed explicit Prisma ownership for serving Apps and standalone tasks.         |
| `d9ab6ce909` | Cut live App ClickHouse, Ops and migration ownership over to typed runtimes.      |
| `b6ee5f2906` | Routed legacy S3 operations through the process-owned AWS transport policy.       |
| `ec1240fb37` | Composed process-owned NLP Lambda and CloudWatch clients with ordered cleanup.    |
| `87fc7f4521` | Projected evaluation and scenario-child process configuration once.               |
| `7df243483a` | Cut App Eventing persistence over and deleted its three displaced adapters.       |
| `aa2afb5191` | Composed webhook endpoint, health, event-read and delivery services once.         |
| `83cdb89996` | Composed the Worker durable Eventing graph with consumers forced off.             |
| `bc0b8df67d` | Projected private executable bootstrap config before App graph evaluation.        |
| `09bc1edae8` | Composed one schema-validated Langevals evaluator client per process.             |
| `1f4a1adc1d` | Composed task-local object-storage and Enterprise Governance client lifecycles.   |
| `a12b99cb83` | Moved Stored Object owner resolution into its canonical feature graph.            |
| `a5b3fda731` | Characterised legacy Trace full-read fields before any production cutover.        |
| `6a62e37cf1` | Hardened API/Worker drain, request log context and Worker signal lifecycle.       |
| `6831973f51` | Corrected the Worker lifecycle test boundary and restored Worker typecheck.       |
| `480e9f73ec` | Preserved AuthZ denial reasons through the live tRPC permission middleware.       |
| `850586835d` | Centralised physical API, Worker, UI-public and local-orchestrator configuration. |
| `30c4356a68` | Composed canonical Entitlement/Licensing sources and deleted app-local wrappers.  |
| `036d93752f` | Composed Worker-owned Redis, AWS and Group Queue infrastructure foundations.      |
| `4bba78994c` | Composed canonical Auth/User lifecycles and one process-owned mailer graph.       |
| `11c84ce592` | Moved Stored Object dispatch/policy ownership and adapted it into Worker queues.  |
| `ab64885d6f` | Required canonical Auth/session composition in the physical API graph.            |
| `5e983429bf` | Injected typed WebSocket configuration and covered listener teardown.             |
| `0765390f33` | Centralised tenant-dynamic Slack webhook SDK construction.                        |
| `4bfb7bd679` | Composed Worker S3/filesystem providers behind the Stored Object runtime.         |
| `52ec8f2a41` | Moved mail/Stripe private config and SDK construction to process runtimes.        |
| `9196a3f2f1` | Routed team-assignment tenant lookup through the canonical Role service.          |
| `f7e89e5200` | Added project-key and current API-key security to the standalone REST process.    |
| `ffd59b1307` | Owned API readiness, health/metrics routes and uncaught request-failure capture.  |
| `3a8f4c4b00` | Made Project the managed-provider tenant owner and deleted its duplicate port.    |
| `bb541a9ac5` | Composed API Redis/queue readiness with key mark-used and mutation audit.         |
| `2923114cc0` | Cut the live worker boot to physical Worker configuration, signals and drain.     |
| `d80a016529` | Moved first-password and passkey-nudge state into the canonical User service.     |
| `402d2f7b4c` | Repaired callers left behind by three committed module deletions.                 |
| `d76b0e0cf4` | Inlined the Evaluation stored-object marker and deleted its re-export shim.       |
| `851ddb31fc` | Moved the browser public-environment projection and mapping into UI.             |
| `7180677357` | Made the configuration package own the telemetry projection and runtime gate.    |
| `f82c58fc9a` | Made the AuthZ grant migration converge instead of restaging every pass.         |
| `a6234a01dc` | Resolved the Ops anomaly kill-switch against the tenant its rule names.          |
| `ab4fce3771` | Declared Stored Object migration posture and accepted the retryable envelope.    |
| `7c4bba0744` | Restored two imports extraction dropped from live Auth and Invite paths.         |
| `f24ba9c97b` | Resolved the invite suite a botched merge left unparseable.                      |
| `1f14f9e8d9` | Reconciled workspace links and the lockfile, closing the frozen-install gate.    |
| `dbf612913b` | Moved the task process root into the local orchestrator and fixed its packaging. |
| `db7070b79c` | Revived the error-code guard and registered the four Gateway codes.              |
| `f1a67d715f` | Deleted fourteen orphaned server modules with no caller anywhere.                |
| `7862a1f545` | Revived the message-safety and raw-toast guards killed by the same stale root.   |
| `285211fa94` | Gave Dashboard and its saved charts a package-owned, ceiling-compliant service.  |
| `a5c3d2013b` | Imported the LangWatchQL granularity guard its own validate path calls.          |
| `229ec52d93` | Recorded the working-tree slices a stray checkout destroyed.                      |
| `6503ab7cae` | Restored invite identity matching and finished the approval retirement.           |
| `9313817386` | Let an expired invitation say so, and a revoked one say nothing.                  |
| `8a32e35208` | Deleted fourteen modules nothing imports.                                        |
| `78bb655f3e` | Gave Presence a package-owned tRPC surface.                                       |
| `2ab66c968f` | Gave Data Retention a package-owned tRPC surface.                                 |
| `6249b5d23f` | Gave Feature Flag a package-owned tRPC surface.                                   |
| `cbcaf76802` | Deleted twenty-seven modules nothing imports.                                     |
| `3c6248f50d` | Imported the line differ from the package that exports it.                        |
| `fe08bce3da` | Gave Role and role bindings a package-owned tRPC surface.                         |
| `cc89c8d455` | Audited package-mounted mutations with their arguments, minus the secret.         |
| `98e0376c20` | Imported the two symbols the target summary renders.                              |
| `83f073afbc` | Deleted twenty-eight components nothing renders.                                  |
| `a13dda55c7` | Made the hidden-admin denial one class again.                                     |
| `1f0d17242e` | Deleted five modules the barrel removals stranded.                                |
| `172b31e456` | Gave GitHub a package-owned tRPC surface, and with it the `policy` seam.           |
| `06e14a1599` | Reconciled the lockfile for the five moved verticals.                             |
| `ef4a2fad7b` | Taught the coding-agent fixture the two new GitHub service members.               |
| `bbf269f9cd` | Made the tRPC router graph constructible again.                                   |
| `8e58a414c4` | Let the public-surface tripwire read a procedure again.                           |
| `69e4d737e6` | Gave Secret, Data Retention and Presence their authz declarations back.           |
| `b6622a9717` | Read a schema the way zod 4 spells it, in the declaration sweep.                  |
| `36ff148a41` | Gave Agent its authz declarations back.                                           |
| `85b8a72f48` | Recorded what zod 4 says about a rejected value, on the 400 path.                 |
| `794d28030b` | Imported five more symbols their modules never imported.                          |
| `2365693d46` | Revived the LangWatchQL run path.                                                 |
| `6ec280aec8` | Shrank the fragment and app-access baselines to what still exists.                |

The seven commits from `9196a3f2f1` to `d80a016529` deleted no production file
from `platform/app`. They moved lines — three direct Prisma reads out of live
tRPC transports and the whole worker boot/signal/drain out of `src/workers.ts` —
and deleted one duplicate Enterprise Project repository and port. `2923114cc0`
adds a named compatibility adapter, `runtime/worker/legacy-worker.executable.adapter.ts`,
so tracked `platform/app` grew by two files across that span. Under the counting
rule below this is real boundary progress and zero file-count exit progress;
both facts are recorded rather than netted against each other.

The twenty-seven commits from `229ec52d93` to `6ec280aec8` did three things at
once, and the order matters because each one was hiding the next.

First, `HEAD` did not build. Five committed defects stopped `appRouter` from
being constructed at all, which meant both authorization guard suites died on
import and reported nothing. `bbf269f9cd` closes that. Then the guards
themselves turned out to be broken: `isPublicProcedure` read a tRPC procedure as
a plain object, but `createResolver` returns the invoker function, so 751 of
roughly 800 procedures read as public and the tripwire was inert
(`8e58a414c4`); and the declaration sweep read `_def.typeName`, which zod 4
renamed to `_def.type`, disabling both its default-scope check and its union
branch (`b6622a9717`). Only with all three repaired did the real finding
surface — five package-mounted verticals had lost their authorization
declarations in the move (`69e4d737e6`, `36ff148a41`). Both guards now pass
14/14, and they are guards again rather than decoration.

Second, five more transports moved to package-owned app-tRPC adapters: Presence,
Data Retention, Feature Flag, Role and role bindings, and GitHub. GitHub
established the seam the rest of Wave 3 should copy. tRPC appends its input
middleware at the point `.input()` is called, so any middleware installed ahead
of it sees `input === undefined` — which is what had silently emptied the audit
rows, the scope-lineage guard and the declared permission check. The `policy`
decorator in `runtime/app/internal-api/github.router.ts` is applied by the
feature *after* its own input parser, which is the only ordering that works.
`cc89c8d455` repairs the audit rows the earlier ordering had emptied; note that
it needed scalar credential redaction landed first, because `secrets.create`
carries the plaintext secret in a top-level `value` field that the existing
object-walking redactor does not reach.

Third, 74 orphaned modules were deleted across four sweeps, each proved three
ways (no path reference, no exported-symbol reference, no string or dynamic
reference). The near-misses are worth recording: `PassRateCoverageChip` is
rendered without an import, `useTypewriterPlaceholder` is referenced only from a
`vi.mock()` string, `scenario-child-process.ts` is an esbuild bundle entry, and
`RequireCan` is specified in five ADRs. All four were kept.

Moving code, rather than looking for bugs, is what found the bugs. Nine live
defects on this branch are one class — a module using a name its own imports
never bring in — including `LangWatchQLService.execute`, which threw
`ReferenceError` on every call because a refactor moved
`resolveRunGranularityOrRefuseUnfilled` out and left the call site behind
(`2365693d46`, 20 failures to 1). A repo-wide scan for that class does not
generalise cheaply: it returns 2,344 files because ordinary words like `route`
and `api` are both exported somewhere and used as local parameters. The tool for
this is a typechecker, and `F-BRANCH-01` is why one has not run.

### Active and residual slices

| Slice                           | Current fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Next gate                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API physical activation         | `apps/api` owns an injectable typed boot/process boundary, a real Node/Hono listener, request policy, graceful drain, Agent/Secret tRPC and all four Secret REST bases. `ab64885d6f` requires the canonical Auth service plus an injected Better Auth transport for browser-session resolution. `f7e89e5200` adds project-key and current API-key authentication with preserved header precedence, credential-derived project selection and AuthZ ceiling refusal. `bb541a9ac5` adds `markUsed`, attributed 2xx mutation audit, an API-owned Redis/Group Queue infrastructure and `startApiExecutable` as the boot-failure boundary. `ffd59b1307` adds a readiness gate before the listener accepts traffic, `/api/health` and an optional metrics port. `79f89773ec` gives the process its own instance-admin credential and Redis-backed rate limiter; `eecbb8b479` composes a guarded database (`ApiDatabaseInfrastructure`, tenancy policy from `@langwatch/prisma-client`); `086c335a86` composes the first package-owned product service for itself — Secret over that database and the package-owned AES-GCM cipher under a validated `CREDENTIALS_SECRET` leaf, with the reserved names promoted to `@langwatch/secret-contract` — shrinking `API_UNAVAILABLE_PRODUCT_ADAPTERS` to five; `9b2250a8a2` closes the Metrics entry; `ae226f53b5` closes Authz and ApiKey+organization identity together, and `6c5f0b30f9` closes Agents: the agent ports' Postgres operations harvested into agent-server repositories/adapter with workflow copy a declared refuse-by-name absence (LinkedWorkflowCopyPort optional; a copy without the Workflow application would leave the agent pointing at the source project's graph). The Identity/Better Auth entry then closes by SPLITTING, leaving one: `IdentityEmailService` was never process-bound — `PostgresIdentityEmailAdapter` (heads projection read + the D01 migration-state latch, cached per process on a 60s TTL with coalescing and a bounded per-user map) harvests it into identity-server, so `ApiAuthComposition` builds the whole Auth service over the guarded client, the organization service the process already serves from and its own Redis, with the packaged `PostgresUserAdapter` under it and avatar storage a declared refuse-by-name absence. What remains is the deployment's Better Auth browser-session transport alone: one configured server instance whose secret, base URL, cookie prefix, session mapping, secondary-storage prefix, mounted provider ids and storage adapter all belong to the deployment, and a second instance composed from a different option set would verify nothing and answer `null` rather than fail. The transport adapter now logs a presented-and-rejected session token instead of treating it as anonymous, which is the signal the 1.7 providerId outage never produced. The authz/tenancy detail: `EventStoreProducerOnly` makes producer-only structural (every store operation refuses by name; a memory store would lose appends and no store degrades to the command-dropping `DisabledPipeline`), `ApiEventingInfrastructure` composes `EventSourcing` over the API's own queue with consumers disabled, `ApiAuthzComposition` registers the same packaged authz definition the worker installs (routing triple asserted against the worker's job-registry claims), and `ApiTenancyComposition` builds organization → project → api-key from packaged adapters with one shared cipher and a dedicated api-key-pepper leaf. The authz dispatcher/metrics/revocation/binding-id adapters moved into `@langwatch/authz-server`, and the checked `sendersFrom` narrowing exposed a worker registration-order test asserting a registration that produced no senders. Declared parity gap: `keyMap`/`storedObjects` absent from the API's tenancy graph, so project deletion leaves that cleanup to the tier owning them. `340695ceda` closes the executable gap: the start script existed but ApiStandaloneComposition gated to a second, smaller graph when no host handed it services — a provisioned deployment would have served health and no product traffic silently; compose now always delegates to ApiProductionComposition (host services are overrides), the standalone composition announces API_UNAVAILABLE_PRODUCT_ADAPTERS unconditionally at boot, and startStandaloneApi owns config refusal, boot failures and signals through one injected host. `c326c6a643` closes its three follow-ups: the four single-consumer composition helpers are module-private, ApiProductAdapters/ApiStandaloneCompositionOptions collapsed into a flat ApiProductionCompositionOptions, and config refusals name the leaf path with the bound variable in parentheses, identically for the API, Worker and UI projections. The platform route graph remains live and still owns the API-key ceiling that serves traffic. | Compose PAT/admin and rate-limit adapters and an executable start command, close the `F-APIKEY-01` and `F-APIKEY-02` policy-parity gaps before any cutover, then migrate the remaining REST/tRPC route graph by vertical before deleting compatibility routers. `createAppTrpcFeatures` (the tRPC twin of `createAppRestFeatures`) now mounts twenty-two package-owned namespaces by one spread. The three the row used to hold open are closed: analytics landed whole in `3180ae5a0d` (three transports merged under one wire name, `routers/analytics.ts` deleted, and the five suites that addressed the sub-router handles re-pointed at the real `appRouter`'s namespace — a stronger seam, since it proves the workbench gate is on the surface the process serves), the user router drained in `7502445e3f`, and workflows in the same sweep. What is left of the tRPC seam is the SUBSCRIPTION lane. `apps/api` now serves it: `GET /api/sse/*` on the same tRPC root the `/api/trpc` endpoint serves (one root, two transports, so a procedure cannot be callable and un-watchable), speaking the hand-rolled superjson wire `packages/platform-api-client`'s link already targets — connected / complete / error frames, a 25s `: ping`, the browser's own abort signal threaded into `createCaller` so an abandoned subscription's suspended `await` is interrupted rather than leaked. `sseErrorFrame` moved with it in its ADR-045 shape (a `HandledError`, directly or as a `TRPCError` cause, rides as `{type:"error", message:<code>, error:<serialized>}`; everything else degrades to the generic unknown), and the route declares `handlerManagedAuth({ credential: "session", permissions: [] })` on the same `ApiRestSecurity` every REST family declares on, so the one streaming route is a registry entry rather than an unaccounted-for endpoint. Walking the path taught the lane one thing its platform twin never had to state: a tRPC caller's namespace is a PROXY, and `typeof` a proxy over a function is `"function"`, so an object-narrowed walk answers 404 for every live view. Of the ten subscription call sites the transport unblocks, the two `export.*` progress relays are now in the record (`export` joined it; platform lost its `exportRouter` line at zero insertions). `presence` joined next, and it was the cheap one for a reason: `PresenceTrpcApi` takes NO ports — who is in the project, where their cursor is and whether the feature is on are all read off the request context's own application slice — so `@langwatch/presence-server` on `apps/api` plus a mount that is one `createTrpcApiService` call was the whole move, and platform deleted `runtime/app/internal-api/presence.router.ts` and its two `root.ts` lines at zero insertions. Four of the nine subscription procedures are therefore inside the record: `export.onExportProgress`, `export.onScenarioRunExportProgress`, `presence.onPresenceUpdate`, `presence.onPresenceCursor`. The remaining five are blocked by ONE thing rather than two, and it is not the legacy `{protected, policy}` mount shape: each remaining transport takes PORTS, the record's ports object is supplied by `root.ts`, and a new port group there is an insertion into a tree that is deletes-only. Naming what each wants is what makes the size of the move plain. `scenarios` wants three fire-and-forget process side effects (`trackServerEvent`, `fireScenarioCreatedNurturing`, `captureException`). `traces` wants eight, among them `getUserProtectionsForProject`, which reaches the data-privacy policy service, the plan visibility window and `resolveOrganizationId`, plus the evaluator precondition engine and `formatSpansDigest`. `tracesV2` wants `createTracesV2TrpcPorts()`, ~130 lines of `runtime/app/features/trace.ts` standing over the AI composer, the ClickHouse query translator and the ancestor-prompt walk. `langy` wants a Redis rate limiter, the product-analytics sink, the audit sink and `LangyUiActionService` — and that last one has a SECOND platform consumer, `server/routes/langy-ui-actions.ts`, so it cannot be moved out either: repointing that file's import is a surviving line gaining a name. The honest shape of the remaining work is therefore not a lift-and-shift of five mounts. It is migrating five verticals' PORT compositions off `platform/app`, and the record entry is the last line of each of those slices rather than the first.  **The identity half of `trpcCollaborators` is now composed by the process itself** (`api-trpc-collaborators.identity.composition.ts`, overlaid by `withApiIdentityCollaborators` beside the analytics half): `auth`, `group`, `identity`, `joinRequests`, `onboarding`, `user`, and the `apiKeys` / `broadcast` / `config` / `ops` / `organizations` / `presence` / `users` slices of `ctx.app`. Getting there moved ~7,400 lines out of `platform/app` at zero insertions: the twelve `OrganizationsAppService` members the canonical contract does not declare (`createAndAssign` through `getAuditLogs`) with their repository and prisma repository into `@langwatch/organization-server` behind four new ports (seat licence, session revocation, grant cache, prompt seeding); the mail gateways, the MIME assembly and the six identity/organization templates into a new `@langwatch/mail`, with the outbound-proxy resolver into `@langwatch/egress` where the SSRF fence already lives; the sign-up verification service and its two Postgres stores into `@langwatch/auth-server`; the two identity ledger writers, the join-request orchestration, its adapters and repositories, the sign-in method policy, the break-glass limiter and both domain-routing repositories into `@langwatch/identity-server`; and the tenant broadcast fabric into `@langwatch/presence-server`, which is the package that DEFINES both broadcast ports and could not compose itself while the fabric sat in the app-layer. Three seams became arguments on the way and only three: the event stack (an `IdentityEventingPort` rather than `tryGetApp()` waited on for five seconds), the shared rate-limit counter, and the deployment's four sign-in facts. `ApiAuthComposition` now publishes the `UserService` it already built so `user.*` reads the SAME directory the browser-session boundary resolves through. **Named absences, each a refusal carrying `service_unavailable` and the capability's name:** the Enterprise seat licence (refuses `setMemberDisabled`'s re-enable and every role change — permitting would spend a seat the plan does not carry), the SCIM plan gate, the standard AI-tool catalogue, CLI-token revocation, the three gateway budget reads, the Auth0 tenant, and the invitation service behind `requestFreshInvite` (its 1,660-line `InviteService` reaches license enforcement, the plan provider and the role service, so it did not move in this slice); prompt-tag seeding and the marketing notifications log once instead, because both are non-fatal by construction and refusing would cost somebody the organization they just created. **Judgement calls recorded:** the billing-only repository methods (`getOrganizationForBilling`, `clearTrialLicense`, the Stripe reads) were dropped rather than dragging `@langwatch/enterprise-billing-contract` into a core package, and `NullOrganizationRepository` — a silent null object answering `[]` for real reads — was deleted rather than moved; five `organizations/__tests__` integration tests were deleted rather than moved because they drive `~/server/db` and `~/test-utils/cleanupTestRows`, neither of which the package holds, and that is a recorded coverage loss on `createAndAssign` primaryIntent, the last-admin concurrency window, provisioning compensation and the governance project filter. Proof: `api-trpc-collaborators.identity.composition.integration.test.ts` drives `onboarding.initializeOrganization` (the whole moved membership service — ksuid, slug, one transaction, the founder's two ADMIN grants after it) and `user.getAccountInfo` through the real `/api/trpc` handler, plus `group.listAll` refusing by name. What is left before the record actually mounts: the trace, annotation, data-privacy, evaluation, experiment, workflow, integrations-check and bug-report entries, which no half composes yet. **The PRODUCT-GROUP half is now composed by the process too** (`api-trpc-collaborators.product-group.composition.ts`, folded on by `withApiProductGroupCollaborators` as the fifth fold before the seal). Thirteen more namespaces left `root.ts` for the record: `authz`, `batchRecord`, `dataset`, `datasetRecord`, `evaluators`, `featureFlag`, `home`, `personalWorkspaceFeatures`, `prompts`, `promptTags`, `role`, `roleBinding` and `team`; `agents` left as well, because `ApiApplication` already mounted it beside the record and the platform line was a second copy of a surface the process served. Six app slices joined `ctx.app` — `authzApp`, `dataset`, `evaluatorApp`, `featureFlags`, `permissions`, `projects`, `prompts`, `roles` — and four collaborator entries (`batchRecord`, `dataset`, `evaluators`, `home`, `prompts`, `role`, `team`). Two services are TAKEN from the execution half rather than rebuilt (`ApiExecutionCollaborators` now publishes `datasets`, `experimentLookup` and its `WorkflowApp` alongside `evaluators`): a project's dataset rows and its evaluators are one set each, and a second service over either would let `dataset.getAll` disagree with an experiment's own row read. One move: `server/home/{recent-items.service,recent-items.repository,types}.ts` became `@langwatch/project-server`'s `services/recent-items.service.ts`, `services/recent-items.types.ts`, `repositories/prisma/prisma.recent-items.repository.ts` and `adapters/postgres.recent-items.adapter.ts`, with the global `prisma` singleton turned into an injected client — the two platform UI files that imported `~/server/home/types` are left broken by design. **Named absences:** the Enterprise plan gate behind custom roles refuses `role.create`/`role.update`/`role.assignToUser` and any `team` member list that assigns a custom role, by name (`service_unavailable`), because permitting would hand an Enterprise capability to a deployment whose plan does not carry it; a member list of built-in roles only is left alone. `prompts.afterPromptCreated` logs once instead of refusing — it is a marketing signal and refusing would cost somebody the prompt they just wrote. The model gateway is optional for `prompts` and `evaluators`: its absence costs a version's provider annotation and the evaluator default-model fallback, nothing else. **Judgement calls recorded:** `role.*`'s permission vocabulary is now `authzPermissionSchema` — the AuthZ registry's enumeration — rather than platform's `permissionFormatSchema` cross product, and `isOrganizationExclusive` is `bindingScopeCanGrantPermission` rather than the hand-kept `ORG_EXCLUSIVE_RESOURCES` set the platform version itself marks `@deprecated`; `role.getAll` keeps the tightened `organization:manage` cut; the flag service is composed a second time here rather than shared with the analytics half's, because both are stateless uncached readers of the same rows under the same config and threading one through would have made `featureFlag.*` depend on a ClickHouse-shaped half. **Proof:** `api-trpc-collaborators.product-group.integration.test.ts` — 14 tests driving `authz.effectivePermissions`, `dataset.getAll`, `batchRecord.getAllByexperimentIdGroup`, `evaluators.getAll`, `featureFlag.isEnabled`, `home.getRecentItems`, `personalWorkspaceFeatures.get`, `promptTags.getAll`, `role.getAll` and `team.getTeamsWithMembers` through the real `/api/trpc` handler over fakes at the ports, plus the three named refusals. **Left in `root.ts` from this group:** `organization`, `project`, `codingAgents`, `monitors`, `automation`, `emailSuppression`, `scenarios`, `suites`, `ops`, `setupSkills`, `dataRetention`, `storedObjects`, `langy`, `langyEgress` and the EE `ssoConnections`. |
| Worker physical activation      | `2923114cc0` makes the deployed worker entry `src/workers.ts` boot through the physical `WorkerExecutable`, which owns typed configuration, logger/tracer, a signal policy with a shutdown deadline, fatal uncaught/unhandled reporting and finalization; `LegacyWorkerExecutableComposition` is the named compatibility adapter that still supplies the legacy registry. Worker configuration now parses Redis, Group Queue policy, stored-object storage and outbound proxy. `4bfb7bd679` adds concrete S3/filesystem drivers, a typed BYOC source and lazy Azure factory port. `WorkerProductionComposition` and `createWorkerPrivateInfrastructureComposition` are exported but have no production caller. `52d8defe3e` proves the packaged registry routes every job the legacy one does — 26 pipelines / 190 keys built for real and compared, held to the checked-in `job-registry.json` by a parity guard in `platform/app/src/runtime/worker/__tests__/` — and closes the one real gap: `configureGlobalProjections` now flows through `WorkerEventingRuntime` so the SaaS billing meter pair is mountable (consumers stay typed unenableable). The cutover then completed through the registry-handoff design (`dev/docs/plans/worker-consumer-cutover-plan.md`): P1-P5 landed (`5e8a84ba4d`, `25885235b8`, `a6844f72fb`, `d816d8bd1b`, `2123545d8a`) and the switch itself is `4542cdc38c` — `workers.ts` boots `PackagedWorkerExecutableComposition`, the App composes as producer-only on every role, the packaged registry is the one consumer, and `LegacyWorkerExecutableComposition` is deleted outright under the 2026-09-01 not-gradual ruling (platform/app need not keep working during the migration; rollback is reverting the commit). Service extraction now proceeds behind the live seam: each extraction replaces one synthesized capability wrapper with the feature package's real one, parity guard green throughout.                                                                                                                                                                                    | Supply concrete project-BYOC and Azure sources and give the private infrastructure composition a production caller, then in Wave 4 install the complete registry and intent ports before enabling the one shared-queue consumer.                                |
| UI physical activation          | Chunk recovery, runtime behaviour, shell sections, browser-safe public config and Agent browser transport now follow the enforced global/private hierarchy. `apps/ui/src/app`, `platform` and `testing` are invalid roots and contain no production files. The private source projection remains in `platform/app` as a compatibility boundary. `98c4e3074e` inverts the shell: `apps/ui` owns the route table as data (model), the page-loader registry and router (behavior) and the provider nestings, root layout and `createUiApplication` (sections); platform's `routes.tsx`, `AppProviders.tsx` and `legacyRedirects.tsx` are deleted and it supplies 149 compile-checked lazy page loaders plus twelve host-supplied provider slots through the retained `LegacyUiShellAdapter`. Parity is held by a transcript generated from the old table before deletion; three platform guards that read `routes.tsx` as text now read the packaged table. `58e8243223` runs the ADR-004 Prompt pilot as the ADR scopes it (export boundary, not page move): `@langwatch/prompt-web` drops 12 of 19 live violations — `./forms` dissolves into `model/prompt-form` plus a real `surfaces/prompt-form` door, the tabs store takes injected browser capabilities. The page move itself is blocked on evidence: the screen's closure is 63 files reaching 48 platform modules and `platform/app/src/prompts` is a shared library with 14 external importers, so a real move needs the prompt model decomposed out of platform first (~2x the Agent migration). The page-family closure survey (2026-09-01) ranks the movable families — effort in Agent-migration units (76 files = 1x): **ops 23 keys/1.15x** (452 LOC of pages, mean 20 lines; `@langwatch/ops-web` at 145 files already behind 41 of the 65 closure files; zero prisma/server imports), **governance 11 keys/0.28x** (8-file exclusive closure; no feature-web package exists yet), **gateway 11 keys/0.5x** (one `withPermissionGuard`+`AiGatewayLayout` template x11; promote `ConfirmDialog` to `components/ui` first — 18 importers, 5 foreign), **me 8 keys/0.6x** (`coding-agent-web` already backs the fat table), **automations 5 keys/0.4x** (1 real page + 4 aliases; `automation-web` at 51 files). Anti-targets: traces (5.8x — 441-file closure), settings (24 keys but 6-8 independent moves and the worst prisma/server debt), experiments/workbench (27-module import list). Quick wins needing no migration: 15 pure-redirect keys retire to the packaged redirect table, 7 alias keys collapse to shared entries, 3 dead files delete (`[project]/not-found.tsx` duplicate, `dev/error-test.tsx`, the sixth automations alias). 20 unrouted co-located modules under `pages/**` (12 of them `settings/api-keys/*`) must move with their families; `_not-found.tsx` moves with the shell. Host-seam census: 8 of the 14 recurring slots already proven by `agent-ui-host.adapter`. **2026-09-01, deletes-only hardening changes the critical path:** `0958e06039` relays `@langwatch/ops-web` onto the ADR-004 layout (six private features, zero cross-feature imports, governed dry-run 19→3 violations), but the screen move itself is BLOCKED and so is every other family's: a moved screen's tRPC client requires its feature Provider mounted at the browser composition root, and the only such root is `platform/app/src/utils/api.tsx` — an addition there is forbidden, and `apps/ui` has no browser composition root at all (no provider mounts, no admin gate, no toaster/error-registry/chrome equivalents; `forbiddenFrontendFeatureImport` rejects `@langwatch/platform-api-client` from `apps/ui` features today). Deleting loader keys without a destination throws at composition (`resolveUiPageLoader`) and takes live URLs off the air. The composition root landed across `b3ae7e8489` (loader merge, transport, capability ports), `80f1d1cc3f` (session/scope harvest) and `1a759888de` — the governance family move itself, the first family fully out: 11 screens into `@langwatch/enterprise-governance-web` screens/, served by apps/ui's self-installed feature declaration (installed-ui-features.ts), guarded by ui-page-guard (flags before permissions, nothing refused in flight), fed through the package's one host port; platform shrank 41 files with every edit a pure deletion, and `@langwatch/authz-web` was born carrying the scope-picker surface. All five surveyed families are out — governance `1a759888de`, gateway `f2a3d10c9d`, me `f45f0098c6` (widened to 7 keys), automations `c7be08462c`, ops `6514d11027` (19 keys; ops-web governed; the lost blast-radius warning rebuilt end to end with the copy defect fixed in feature-flag-web). Loader keys 135→82; platform −41k lines on the day. Attributed platform-only typecheck breakage under the ruling: 18 errors / 13 files (5 original baseline + vitest.browser.config + 7 automations drawer callers + 1 ops foundry command-bar line + 4 from the prompt-web public-entry shrink in the two surviving platform prompt files, d891cbd1d6). Remaining keys: settings (24, worst prisma/server debt, 6–8 independent moves), traces/experiments (anti-targets), prompt (needs the tRPC-input-contract slice), and ~30 unranked others — next survey re-ranks them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Move the actual browser entry, providers, source projection, router, overlays and route families out of `platform/app`, retaining the legacy shell adapter until URL/provider parity is proven.                                                                 |
| Configuration ownership         | `850586835d` makes `packages/config` the parser used by typed API, Worker, UI-public and local-orchestrator projections. The launcher resolves its config before predeps and injects CI/browser/AIGateway/Postgres controls; the browser-safe source projection now physically belongs to UI behind a behaviour-free app bridge. `bb541a9ac5` and `2923114cc0` add API and Worker Redis/Group Queue parsing, and the Worker projection additionally owns storage, outbound proxy including the lowercase `https_proxy`/`no_proxy` aliases, the drain budget and the legacy `PINO_*`/`OTEL_SERVICE_NAME` logger aliases. The broad private `AppConfig`, instrumentation/task config and remaining executable-specific raw environment reads still live in `platform/app`.                                                                                                                                                                                                                                    | Preserve and project the remaining credential-secret, ClickHouse, storage, mail, model, rate-limit and retention compatibility before deleting each old config module behind physical boot tests.                                                               |
| OpenAPI ownership               | The comparator is hardened, but checked-in artefacts are stale and generation still imports the platform route graph. The generator currently fails before route composition because environment config is not initialised.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Move generator/serving ownership with the API route graph, initialise task config explicitly, regenerate, and explain every semantic difference from `main`.                                                                                                    |
| Process observability adoption  | API and Worker own injectable typed logger/tracer boot and ordered telemetry flush. Legacy web scope ownership no longer self-waits. The live platform instrumentation now receives one typed, idempotent projection; trace, log and metric headers cannot merge ambient values, and telemetry still flushes last. `2923114cc0` makes the Worker physical process boundary live in production, booting with LangWatch self-instrumentation disabled and registering platform instrumentation as ordered flushers on the process-owned observability shutdown. The physical API launcher remains absent.                                                                                                                                                                                                                                                                                                                                                                                                     | Bind concrete API request context when its executable graph activates, then move the compatibility instrumentation entrypoint to local orchestration.                                                                                                           |
| Persistence foundations         | Prisma, Redis and ClickHouse have explicit App/task construction and exact shutdown owners. `server/db.ts` is construction-free. The App and Worker compose canonical Eventing persistence. `a12b99cb83` moved Stored Object owner fan-out into its feature and deleted the displaced App repository/service/test. `a5b3fda731` locks the legacy Trace mapper's earliest-summary timing, topic metadata, log-count alias and six reserved token metrics, while recording the remaining full-read parity gates. `9196a3f2f1`, `3a8f4c4b00` and `d80a016529` remove three direct Prisma reads from live tRPC transports (Role team lookup, Gateway spend organization fence, and User first-password and passkey-nudge rows) and delete a duplicate Enterprise Project repository and port; `routers/user.ts` still owns the whole change-password read/verify/write. The `src`-only non-test sweep now finds 49 platform files importing the Prisma compatibility binding.                                   | Finish the active Analytics/Dashboard, Gateway and Prompt persistence verticals. Keep the Trace production read cut and identity-owned queries deferred until their recorded parity/actor gates close.                                                          |
| Infrastructure clients          | Shared AWS policy, Dataset S3, NLP Lambda/CloudWatch, Langevals and Trace privacy have process owners. `52ec8f2a41` moves private mail parsing and the sole Stripe client to App runtimes and deletes their displaced config/client adapters. `0765390f33` centralises tenant-dynamic Slack construction, `5e983429bf` owns WebSocket config/listener teardown, and `4bfb7bd679` adds Worker S3/filesystem drivers behind Stored Object policy. `bb541a9ac5` adds API-owned Redis and Group Queue construction with ordered close, and `2923114cc0` adds the Worker outbound-proxy resolver derived from typed configuration.                                                                                                                                                                                                                                                                                                                                                                               | Bind Worker BYOC/Azure inputs and move only remaining model-provider clients with their owning process/feature callers.                                                                                                                                         |
| Analytics/Dashboard persistence | The working tree moves Dashboard, saved-workbench chart placement and restricted LangWatchQL contracts into their feature packages and deletes the displaced App persistence/services/tests. Concrete restricted LWQL executor/config/key-map/provisioning/client lifecycle remains an explicit `platform/app` compatibility residual.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Clear final generated-Prisma declaration review, then commit. Run the three package Prisma parity cases when `DATABASE_URL` is available; current collection skips them, and full REST integration remains blocked without a container runtime.                 |
| Gateway persistence             | The working tree has collapsed budget, cache-rule, guardrail and materialisation behaviour onto one canonical Gateway service and deleted the displaced cache/guardrail App services. REALTIME remains untouched. The composition installer is being converted from a generated-Prisma package surface to a portable structural persistence capability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Finish the full Gateway database capability without a source import, generated declaration, cast or locator; rerun cache/guardrail/budget parity and independent migration review before commit.                                                                |
| Prompt persistence              | Prompt handled-error and stale-caller parity are in progress, including a collected real-database rollback characterization. The active adapter still contains a temporary structural narrowing into legacy Prisma repositories and several generated/repository test fakes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Convert repositories to typed semantic persistence operations, replace the remaining fake type walls, then rerun Prompt package/transport parity and independent migration review before commit.                                                                |
| Mail delivery graph             | `4bba78994c` composes one lazy mailer with Auth and explicit callers. `52ec8f2a41` parses its private provider settings through `@langwatch/config`, rewires App/test/QA composition and deletes the displaced mail config module/test. Provider/runtime tests, private invalid-config tests and all three process-role projections are green; the historical invite SendGrid gate is deliberately unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Move the remaining link/unsubscribe secret helpers off raw app-env access while preserving the NEXTAUTH secret chain and empty-string behaviour; keep the invite provider gate as a recorded compatibility decision.                                            |
| Workspace reconciliation        | API/Worker lifecycle, UI foundations, physical config, AuthZ, Entitlement/Licensing, Auth/User/Mailer, API session composition, WebSocket, Slack, Stripe and Worker storage-provider slices are committed. Role assignment, standalone API-key security, API health and queue lifecycle, Project managed-provider ownership, Worker executable lifecycle and User password/passkey state are committed through `d80a016529`. Unrelated Analytics/Dashboard, Gateway, Prompt, Evaluation, Organization, SCIM, Ops, generated artefact, SDK, baseline and formatting changes remain in the shared tree and are not part of this checkpoint.                                                                                                                                                                                                                                                                                                                                                                   | Keep attributing every later lockfile/baseline hunk to its owning slice, stage exact paths or hunks and leave unrelated work untouched.                                                                                                                         |

Only reviewed and committed deletions count as application-exit progress. The
active table names the remaining shared-tree batches and their next safe
deletion boundaries.

### Working-tree slice partition at `d80a016529`

Every changed path in the shared tree belongs to exactly one slice below. Commit
in the stated order; a slice marked blocked must not be staged until its named
gate closes. Struck rows landed on 2026-08-28; rows marked LOST were destroyed uncommitted, see `F-LOST-01`. `F-BRANCH-01` applies across the
whole table and outranks it: none of these gates has been checked by CI.

| Order | Slice                                        | Plan row                        | Readiness and gate                                                                                                                       |
| ----- | -------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | ~~Repair references to deleted modules~~         | `F-HEAD-01`                     | Ready and unconditional. `HEAD` does not build until it lands.                                                                           |
| 2     | ~~Stale baseline refresh~~                       | Hygiene                         | An audit on 2026-08-31 found zero stale entries across all seven architecture-lint baselines — every listed file still exists — so the remaining three re-derived themselves as their owning slices landed. |
| 3     | ~~Evaluation stored-object marker inlined~~      | Wave 6 Evaluation               | Ready. Schema module deleted with zero remaining importers.                                                                              |
| 4     | ~~UI public environment~~                        | UI physical activation, `F-UI-02` | Ready. Carry the deleted test's gateway assertions and drop the banned `PublicEnvironment` re-export.                                    |
| 5     | ~~Telemetry projection into `packages/config`~~  | Configuration ownership         | Ready after repointing the one consumer and deleting both re-export shims.                                                               |
| 6     | ~~Inject mail runtime configuration~~ **redone**                | `F-MAIL-01`                     | Landed in the redo: the mailer helpers take `secret`/`baseHost` as parameters bound once from the validated config, the empty-secret case exercises the real path, and the four orphaned call sites the lost slice left as TS2353 baselines are satisfied (whole-tree typecheck 386 to 382). |
| 7     | Model-client and Langevals payload config    | Infrastructure clients          | Remaining env-reading paths recorded 2026-08-31. Langevals: `server/langevals/stagedFetch.ts:107` rebuilds staging thresholds and payload caps from env on every call, and `server/evaluations/runEvaluation.ts:541` reads `LANGEVALS_ENDPOINT` inline; the injected half is `runtime/langevals.config.ts`. Model client: `server/modelProviders/geminiDoor.ts:32` (`GEMINI_PROJECT`/`GEMINI_LOCATION` fallback), `codexAccount.service.ts:92` (`CODEX_OAUTH_ISSUER`) and `providerValidation.ts:1043` (dynamic `process.env[apiKeyField]` when no stored credential); the injected half is `runtime/app/model-client.config.ts`. The cut is claimed only for the two injected callers. |
| 8     | ~~Organization owns settings, then team lookup and auth revocation~~ **landed** | Wave 2 Organization | The gate's method half was stale — getSettings/updateSettings landed on the contract 2026-08-28 23:49, nine hours after the row was written, and slice 10's note misread its own row. The real half was the displaced code: the app-layer's duplicate settings implementation (its own decrypt, its own encryption helpers) now delegates to the canonical service with the ADR-057 trace-share cascade staying app-side, driven off the result rather than a second read; team lookup becomes OrganizationService.tryGetOrganizationIdByTeamId across all eight implementers, deleting the me-transport's hand-written port; and setMemberDisabled revokes sessions through the canonical AuthService as a fail-closed thunk, leaving the 193-line legacy revocation module fully dead and deleted, with a new 3/3-bound spec. Still open, named: the membership transaction stays app-side (F-AUTH-ORG-01's second half), provisioning stays off-contract, and the hot-path settings decryption stays with Wave 3. |
| 9     | SCIM and Ops email-change revocation         | `F-USER-AUTH-01`                | **Landed** in `56fd1271c3`: `F-LOCK-01` is closed, both halves carry `@scenario` bindings, and `F-USER-AUTH-01` is closed with them.                                                          |
| 10    | apps/api API-key organization REST security  | `F-API-06`, `F-APIKEY-01/02`    | **Landed** in `efa933315d` plus the infrastructure-catch logging repair on top of it, closing `F-APIKEY-01` and the cause-loss half of `F-APIKEY-02`. The Organization-settings dependency was satisfied by the existing `organizations.getSettings` contract method rather than the two abstract methods slice 8 proposes. |
| 11    | ~~Local-orchestrator task executable~~ **landed**           | Wave 1 boot entry points        | The gate was stale on the day it was written — its own commit packed the task source. Proving it surfaced two real artefact defects: the published manifest advertised repository-layout paths (both entry points ERR_MODULE_NOT_FOUND against the staged package) and the ksuid patch file was never in the distribution list, so every self-hosted install died at pnpm install before any task could run. Both fixed with sabotage-checked guards; the workspace spec goes 11 to 13 scenarios, all bound. |
| 12    | Azure identity and AWS process config        | Infrastructure clients          | Gate closed: the throwing construction was worse than recorded — `initializeDefaultApp` itself threw, taking every boot entrypoint down — and the omission is now a compile error (`aws` required through the dataset runtime, the duplicate builder seam deleted). Azure identity is validated config reaching the one seam that accepts it; the three sibling env readers, #6088's credential shape, and the two module-global AWS readers (`storage.ts`, `sqsWebhookDestination.ts`) are each their own slice, recorded in the code.                                                           |
| 13    | ~~Analytics/Dashboard persistence (app half LOST)~~ **redone**              | Analytics/Dashboard persistence | Landed. The ceiling half of the gate was already closed by `285211fa94`'s real split (384 + 268 lines, disjoint dependencies); the redo rehomed all nineteen orphaned scenario bindings, tagged and bound the dashboard-service spec (0/6 to 6/6), cut the app over to the packaged policy adapter (closing an accidental protections widening) and deleted the superseded 3,472-line app tree. `graphs.create` was found rejecting every call — a strict schema offered the layout key both transports always pass, invisible behind a self-skipping database suite — and is fixed with real-Postgres proof. appRouter snapshot identical. |
| 14    | ~~Gateway persistence (app half LOST)~~ **redone**                          | Gateway persistence             | Landed. The codes half of the gate was stale (registered by `db7070b79c`; the tripwire's actual reds were two governance codes, now registered); the Prisma half was real — five gateway files named the generated client, now narrowed to per-repository Picks behind `PrismaGatewayAdapter`. The app's cache-rule and guardrail services (569 lines) are deleted; both catalogues reach the doors through the canonical budget-decisions service, the four gateway codes replace bare TRPCErrors on those surfaces, and the materialiser's silently-defaulted second service is a required parameter. appRouter snapshot identical; whole-tree typecheck 6 to 5. Residue: `gateway-usage.service.ts` still imports Prisma.Decimal for money math — a reviewed change of its own. |
| 15    | ~~Prompt persistence~~ **landed**            | `F-PROMPT-01`                   | All three gates were real and are closed: the four prompt repositories declare their own client slices composed into `PromptPersistence` (zero generated-Prisma names outside `repositories/prisma/**`, the re-export block and the dead port deleted), the fifteen type fakes became typed doubles, and the rollback family was fourteen errors across twelve files — all now read the raw `promptService` seam, and the rollback test is rewritten to the contract's vocabulary and bound. The pass-through `AppPromptRuntime` is deleted, exposing and rewiring a stale caller that built a second Prompt service per saved-workbench read. `prompt.feature` goes from enforcing nothing to 6/6 bound. Deferred with its decision named: the abstract service-side port awaits contract-owned row shapes (the plan's own next step). |
| 16    | Regenerate OpenAPI artefacts                 | `F-API-01`, `F-API-07`          | Blocked. Current bytes are a partial and wrong regeneration; regenerate last, on the merged branch.                                      |

### Recorded follow-ups

These findings stay visible but do not block the active extraction batches. Pick
them up as dependency-closed work when their owning wave reaches the affected
surface. A failing check remains reported as failing even when its repair is
deferred.

| ID                    | Finding and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Owning wave                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `F-HEAD-01`           | **Closed by `bbf269f9cd`, `1f0d17242e`, `3c6248f50d`, `98e0376c20` and `a13dda55c7`.** The cause was wider than first recorded: five committed defects, not two, kept `appRouter` from being constructed, and while it could not be constructed both authorization guard suites died on import and reported nothing at all. The repair covers the two named deleted modules plus a differ imported from a package that does not export it, two symbols a rendered component never imported, and a denial class that existed in triplicate. `HEAD` builds and both guards read 14/14. | Wave 0 repair                       |
| `F-LOCK-01`           | **Closed.** All five importer blocks are present and their specifiers match. Verified the way CI does, with `pnpm install --frozen-lockfile`: it resolves all 166 workspace projects in 364ms and writes nothing. Confirmed the check is real rather than vacuous by adding one dependency to `features/ops/server` and re-running — it fails with `specifiers in the lockfile don't match specifiers in package.json`. This unblocks slice 9 of the working-tree partition (SCIM and Ops email-change revocation), whose only stated gate was this row.                                                                                                                                                                                                                                                                                                                                                                                                                                               | Wave 0 reconciliation               |
| `F-LOST-01` | **Uncommitted work under `platform/app/src/server` was destroyed on 2026-08-28** by a `git checkout HEAD~1 -- platform/app/src/server` run to test whether a failure predated a change. The pathspec covered the whole server tree, not the two files intended, and reset every modified tracked file to committed content. Dirty files there went from about 90 to 4. Never staged, so unrecoverable: the application halves of the Analytics/Dashboard and Gateway persistence slices (including all 16 pending `platform/app` deletions), the mail runtime slice that closed `F-MAIL-01`, and the Organization, Stored Object, model-provider and Langevals caller edits. The package halves survived and Dashboard's is committed in `285211fa94`. These slices must be redone from their surviving package code and the rows below. Untracked files were unaffected. | Redo before the affected verticals |
| `F-BRANCH-01` | The branch carries **119 unpushed commits** and `langwatch-app-ci` has **never run on it** — zero runs, while the same workflow runs normally on every other branch. PR #7536 is additionally a draft, so even once pushed it runs affected-tests-only on one shard with the `heavy` jobs gated off. No test, typecheck, lint or build has been executed against this work by CI. This single fact explains the broken imports, the unparseable merge resolution, the nine red AuthZ tests, the stale baselines, the missing lockfile importers and the unshipped distribution manifests found on 2026-08-28. **Still true on 2026-08-30, with a fresh example**: `platform/app`'s webhook runtime called `WebhookEventsClickHouseRepository.decodeCursor` and `.parseEventId`, and the class has only `tryDecodeCursor` and `tryParseEventId` — a `try*` rename that landed on the class and not on the caller. It would have thrown "is not a function". Nothing found it because the local sweeps run each PACKAGE's typecheck, and `platform/app` is `@langwatch/web`, whose typecheck is a separate CI job — the one that has never run. Deleted in `b5e36bc5b0` because the three helpers had no callers, but the class of defect is only visible to the gate that is switched off. Push and take the PR out of draft, or accept that every gate below is self-reported. | Wave 0, before anything else |
| `F-CI-01` | **Closed.** All fourteen named packages — `config`, `dashboard-contract`, `dashboard-server`, `gateway-server`, `organization-server`, `prompt-server`, `ops-server`, `enterprise-scim-server`, `evaluation-server`, `trace-server`, `workflow-server`, `stored-object-server`, `ui` and `platform-api` — are covered, and not by the per-slice `--filter <pkg> run test:unit` steps this row prescribed. `.github/scripts/run-package-suites.sh` DISCOVERS them: `pnpm list --recursive --depth -1 --json` is the workspace membership itself, so a package is covered the moment it declares a `test` or `test:unit` script, and `typecheck-packages` does the same with `pnpm -r`. Verified by running the discovery locally — 163 packages found, all fourteen among them. What gates instead is two enumerated registers, each line carrying a mandatory reason: `.github/package-suites.excluded` (five entries, every one "another workflow runs this suite") and `.github/package-suites.allowed-failures` (**empty**). | Every wave that moves tests |
| `F-API-01`            | The checked-in branch OpenAPI artefacts are stale. Against `main`, `openapidiff` reports 129 changed operations, 30 added and five removed. The public-doc and platform artefacts also differ from each other by 235 semantic operation changes. Both omit the deployed direct `/api/secret`, `/api/secrets` and `/api/v1/secrets` aliases even though runtime tests cover all four bases. Source/runtime parity is green; artefact parity is not.                                                                                                                                                                                                                                                                                                                                                                                                | Wave 3 and Wave 9                   |
| `F-API-03`            | **Closed by `b6622a9717`, `8e58a414c4`, `69e4d737e6` and `36ff148a41`.** The undefined `lwqlTimeWindowSchema` was only the first stop; behind it the sweep read `_def.typeName`, which zod 4 renamed to `_def.type`, so its default-scope check and its union branch had both been silently disabled, and the public-surface tripwire read a tRPC procedure as a plain object when `createResolver` returns the invoker function, reporting 751 of roughly 800 procedures as public. With all three repaired the real finding surfaced: five package-mounted verticals had lost their declarations in the move. Both guards now prove every package mount. | Wave 2 and Wave 3                   |
| `F-API-04`            | OpenAPI generation constructs `signInDomainRoutingPort` before the generation task initialises environment/configuration, so the task fails before Secret route composition. Fix this in the OpenAPI ownership move rather than coupling Secret back to app boot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Wave 3 and Wave 9                   |
| `F-API-06`            | `apps/api` owns a callable listener and injected runtime bootstrap that parses typed config/logger/telemetry once, retains one scope and drains listener → graph → telemetry. `ab64885d6f` requires the canonical Auth service and Better Auth transport for browser sessions. `f7e89e5200` and `bb541a9ac5` put project-key and current API-key authentication, ceiling refusal, `markUsed` and attributed mutation audit inside the graph, closing the earlier claim that those adapters remain outside it. It still deliberately has no `process.env` launcher or package start command, and PAT/admin (`resolveOrganizationToken` is unused by the adapter) and rate-limit adapters remain absent, so a launcher would still create an incomplete second API process. Port aliases remain `LANGWATCH_API_PORT`, then `API_PORT`, then `PORT`. | Wave 1, Wave 2 and Wave 3           |
| `F-LINT-01`           | Full architecture lint remains red, but the reported total is now mostly real work rather than drift. `6ec280aec8` shrank the legacy-fragment baseline from 915 entries to 816 and the global-app-access baseline from 255 to 208, regenerating both through the lint's own formatters from the intersection of the checked-in baseline and what the collectors find today — an entry can leave and none can arrive, so the file cannot bless new code no matter what the working tree holds. That removed 146 violations that were work already done. What remains is genuine. Re-measured 2026-08-30 — **989 violations**, and the shape has moved enough that the earlier list misleads: 465 legacy feature fragments (the extraction itself, down from 484), 213 feature-source-layout (UP from 138), 58 fallible-result-naming, 52 global-app-access (up from 34), 35 prisma-containment (up from 18), 28 test-quality, 22 eventing-subscriber-idempotency, 18 service-quality, 17 private-runtime-export, 14 global-app-access-baseline, 13 api-transport-import-boundary, and small clusters in UI closure, cross-feature and Enterprise composition. Since re-measured to **964**. Five rules cleared outright: contract-build-config 36 to 0 (`d75a42f45f`), feature-source-filename 61 to 0 (`24a53f94fb`), feature-catalogue 1 to 0 (same), and eventing-subscriber-idempotency 22 to 0 (`4c974327d8`, `5581c1efcc`). That last one is the caution worth carrying: **twenty of its twenty-two were false**. The rule looked for redelivery tests in `<pkg>/tests/subscribers/` and kept looking there after `5f9acf2b79` moved tests beside their subjects, so it was reading the file it reported missing. Check a rule against one of its own reports before treating a cluster as work. **The same held for test-quality: 28 to 8**, and only three of the twenty were real. It missed assertion helpers declared inside a `describe` (the idiomatic place, since they close over the suite's fixtures), `expect.fail(...)`, TypeScript `asserts x is T` helpers that narrow by throwing, and imported `expectX`/`assertX` helpers whose bodies live in another module; and it called two `it.each` blocks duplicates whenever their callbacks matched, ignoring that the case TABLES are what make parameterised tests different. Fixed in `c801b91c2c` and `ecd8552777`, each with a test pinning the opposite direction so the rule cannot become permissive instead. **Total now 930.** Two more defects in the reporting itself, both found by asking whether a reported path can be opened: `api-transport-import-boundary` relativised its own file paths and then `lintAll` relativised them again, so all thirteen findings named `packages/architecture-lint/apps/api/...`, which is nothing (`3cffdff2d9`, with a test asserting `existsSync(violation.file)`); and `global-app-access-baseline` held 14 entries for `getApp` calls that had been deleted or had moved to a new fingerprint (`d797ca41a4`, 181 entries to 167, deletions only, with the rule's own 52 real violations unchanged across the prune). **`[ -e ]` on every reported path is a cheap audit** — it caught both, and cleared a third that looked wrong and was not: `feature-source-layout` naming `identity/server/src/services` is reporting a directory that SHOULD exist, not one it failed to find. Re-measure before quoting any of these; every wave moves them. Test-quality review separately reports existing assertion gaps in Gateway Spend, Webhook and Analytics memory-safety integration tests. | Owning Wave 2–10 verticals          |
| `F-SECRET-01`         | TypeScript Secret CLI commands do not forward the resolved project ID when building auth headers for the modern REST calls. Add multi-project/user-key header characterisation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Wave 3 clients                      |
| `F-SECRET-02`         | The standalone API proves all 20 CRUD operations across the four bases, but its `/api/secrets` alias uses the modern validated `projectId` and canonical error response. The live legacy route derives project from the credential and retains legacy payload/error/deprecation semantics; characterise and choose compatibility before retiring it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Wave 3 compatibility                |
| `F-SECRET-03`         | The standalone API listener proves the four bases, omitted/latest/header selection, conflicts and response headers. The still-live platform `createApiRouter` lacks an equivalent all-mount regression, so its mount/order protection remains a recorded compatibility test gap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Wave 3 compatibility                |
| `F-TRACE-01`          | `a5b3fda731` characterises the legacy mapper's earliest-summary timing baseline, topic/subtopic metadata, log-count alias and all six reserved token metrics. The extracted full-read path still trusts a stale storage-anchor hint, can return an empty span set, and lacks parity proof for viewer/export protections, annotations/evaluations/coding-agent overlays, ordering and remaining field/nullability cases. It has no production caller yet.                                                                                                                                                                                                                                                                                                                                                                                          | Trace vertical in Wave 6            |
| `F-EVENT-01`          | Eventing process registration now preflights an explicitly injected ProcessStore before mutating catalogues, definitions or pipelines (`e3d2551c6f`), and memory stores are available only through named test/local factories. The full suite still has four pre-existing `StateProjectionStore.load`/`tryLoad` failures, one memory-store expectation that omits the returned `idempotencyKey`, and the corresponding existing test type errors. These remain recorded diagnostics, not a persistence-cutover blocker.                                                                                                                                                                                                                                                                                                                           | Wave 4 test reconciliation          |
| `F-EVENT-02`          | `7df243483a` cuts the App to the canonical Prisma/ClickHouse Eventing adapters and deletes all three displaced platform implementations. `83cdb89996` composes the Worker durable graph and forces consumers off. Platform integration harnesses remain while callers move; the complete registry and the one tested consumer switch are explicitly Wave 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Wave 1 residuals; Wave 4 activation |
| `F-CONFIG-01`         | At working checkpoint `d80a016529`, a `src`-only non-test sweep finds 47 platform files mentioning `env.mjs` and 89 mentioning `process.env`, down from the 64 and 95 recorded at `a12b99cb83`. `bc0b8df67d` removes the executable bootstrap reread but the broad App config still parses ambient values. Preserve database empty fallback, credential/auth-secret chains, privileged internal-route secrets, mail unsubscribe differences and storage unsafe/test gates before deleting the compatibility proxy.                                                                                                                                                                                                                                                                                                                                | Wave 1                              |
| `F-PRISMA-01`         | `89b5f2fb17` makes `server/db.ts` a construction-free compatibility proxy. Serving Apps and standalone tasks compose one guarded connection, enforce exact identity on App reuse and close App before Prisma while preserving the primary task failure. The `src`-only non-test sweep now finds 49 files importing `server/db`, down from 60; move those callers into singular private repositories before deleting the binding.                                                                                                                                                                                                                                                                                                                                                                                                                  | Wave 1                              |
| `F-CLICKHOUSE-01`     | `d9ab6ce909` makes the live façade a behaviour-free compatibility binding over one App runtime, and task-local migration receives a typed endpoint projection. The façade remains until legacy resolver/cache callers receive injected runtimes. Exact shutdown, disabled/build-time recompose and stale successful close are covered; release after a rejected close is implemented but not directly characterised.                                                                                                                                                                                                                                                                                                                                                                                                                              | Wave 1 and Wave 4                   |
| `F-OBS-02`            | `7246b22c13` preserves disabled/no-key behaviour, strict-true switches, metrics, profiling, sampling and drain-before-flush ordering through a typed idempotent projection. The platform App keeps its compatibility entrypoint until physical API/worker launchers bind concrete request and queue trace context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Wave 1                              |
| `F-WORKER-01`         | The shared `event-sourcing/jobs` queue contains every pipeline. Trace `assignTopic`, deferred origin, Dataset normalize and Topic are package-owned, and `83cdb89996` gives the Worker its concrete PostgreSQL/ClickHouse/Group Queue Eventing graph. `2923114cc0` makes the physical Worker launcher live in production; what stays deferred is the complete registry, which `LegacyWorkerExecutableComposition` still supplies. A partial worker would still reject/redeliver every other legacy job, so both consumer switches remain false.                                                                                                                                                                                                                                                                                                   | Wave 4                              |
| `F-WORKER-STORAGE-01` | `4bfb7bd679` gives Worker concrete S3/filesystem drivers, BYOC-first selection, process AWS proxy wiring and a lazy Azure factory port behind the canonical Stored Object runtime. `2923114cc0` adds the physical Worker Redis, queue, storage and outbound-proxy projections and closes that half of this finding. No project BYOC source and no Azure implementation exist — both remain abstract ports with zero implementations — and `createWorkerPrivateInfrastructureComposition` has no production caller. The legacy worker registry remains live until Wave 4.                                                                                                                                                                                                                                                                          | Wave 1 physical Worker activation   |
| `F-UI-01`             | `apps/ui` hierarchy and primitives are ready, but `LegacyUiShellAdapter`, `_app.tsx`, `routes.tsx`, `AppProviders` and the provider/overlay/page closure remain live in `platform/app`. Preserve the adapter until boot, provider order, URL and overlay parity are proven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Wave 5 and Wave 7                   |
| `F-UI-02`             | The public-config move preserves existing validation, but projection coverage does not yet assert every PostHog, NLP, Langevals, licence, sample-ratio and email-provider mapping, and URL fields remain intentionally permissive strings. Keep the private source projection until its physical-app move adds full mapping and invalid-codec coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Wave 1 and Wave 5                   |
| `F-AUTH-ORG-01`       | Organization disabled-member handling still calls the legacy `revokeSessions` helper. Move that caller to the canonical Auth service when Organization owns the surrounding membership transaction; do not add a second Auth path meanwhile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Wave 2 Organization vertical        |
| `F-USER-AUTH-01`      | **Closed.** The orchestration is at both transports: `ScimUserProfileService.updateProfile` and `AdminBackofficeService.execute` each read the previous profile, write, then revoke only when the normalised address actually moved. Ordering and error behaviour are characterised by six tests, and `specs/auth/admin-email-change-revokes-sessions.feature` now binds all six, so what was previously implemented-and-unspecified is enforced. Two behaviours were confirmed against the code rather than assumed: neither path wraps the write and the revocation in a transaction, so a failed revocation propagates to the caller and LEAVES the new address written (reverting would leave the directory and LangWatch disagreeing about who the member is); and a case- or whitespace-only edit revokes nothing, because `UserService.updateProfile` normalises with `trim().toLowerCase()` before either service compares.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Wave 2 User/SCIM caller cutover     |
| `F-MAIL-01`           | **Closed by the slice-6 redo.** The link/unsubscribe helpers take the secret and base host as parameters bound once from the validated config; the empty-secret case passes the parameter and exercises the real fail-closed path. Invitation delivery also retains its historical `SENDGRID_API_KEY` gate even when another injected provider is available; changing that is a later compatibility decision, not part of the config cut.                                                                                                                                                                                                                                                                                                                        | Wave 1 configuration/boot           |
| `F-STORED-01`         | Stored Object owns scheme dispatch, destination policy and the project runtime, while app registry/driver exports are behaviour-free compatibility aliases. Concrete S3/filesystem/Azure construction and several callers still live under `platform/app/src/server/stored-objects`; move them into physical process adapters before deleting the compatibility exports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Wave 1 and Wave 6                   |
| `F-STORED-02` | **Closed by `ab4fce3771`.** The migration declares `enrolledAutomatically = false`, matching the feature ADR's paced per-organization cut-over. The same commit adds `retryable` to the strict problem envelope, which had been rejecting every serialized stored-object error. | Closed |
| `F-DATASET-01`        | Dataset S3 operation/stream leases and target reassignment are covered and committed in `6b9ca49158`. The standalone backfill task still has a pre-existing generated-Prisma to `DatasetMigrationDatabasePort` aggregate promise mismatch in the broad platform typecheck; this was not caused by the client-lifecycle cut.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Wave 1 and Wave 6                   |
| `F-AWS-01`            | `@langwatch/aws-client` owns shared credential/proxy/handler policy, and `fa1a759f47` prevents SDK client disposal from destroying a shared raw handler. `b6ee5f2906` routes legacy S3 through it, `ec1240fb37` composes NLP Lambda/CloudWatch pairs, and `1f4a1adc1d` completes task-local object-storage migration plus Enterprise Governance S3/Redis ownership. Remaining AWS work belongs to actual feature/process callers rather than another generic client layer.                                                                                                                                                                                                                                                                                                                                                                        | Wave 1 residual sweep               |
| `F-LANGEVALS-01`      | `09bc1edae8` replaces the App-layer evaluator HTTP client with one typed, schema-validating process runtime. Direct transports remain in legacy evaluation staging, Topic staging and PII/Presidio collection; move them only with their owning Trace/Topic execution ports and preserve staging, timeout and error-metric semantics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Wave 1 Trace clients; Wave 6 owners |
| `F-PROMPT-01`         | Prompt persistence is moving behind one portable Prompt service and named private Prisma adapter. The ordinary App root injects Model Provider; `scripts/seed-langy-prompts.ts` has no composed provider and deliberately retains the repository's existing default-model fallback through an explicit optional composition input. Keep that fallback script-only, and do not delete the compatibility path until transaction, handle, copy/tag and stale experiment-caller parity are covered.                                                                                                                                                                                                                                                                                                                                                   | Wave 1 Prompt persistence           |
| `F-WEBHOOK-01`        | The changed webhook/gateway REST integration files contain eight callbacks that the deterministic test-quality review cannot recognise as asserting observable behaviour (`gateway-spend` lines 346, 357, 410, 900 and 1104; `webhooks` lines 150, 161 and 799). The migration review and focused service/router coverage are green; strengthen these scenarios with explicit assertions when the Webhook/API vertical owns the surrounding integration harness.                                                                                                                                                                                                                                                                                                                                                                                  | Wave 3 and Wave 6 batch 8           |
| `F-AGENT-01`          | `specs/agents/AUDIT_MANIFEST.md` still points at deleted management UI paths and does not bind the moved scenario tests. Refresh it when the next Agent vertical updates feature documentation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Wave 6 and Wave 7                   |
| `F-AGENT-02`          | Agent management replacement coverage does not directly assert every former dialog success/close/toast/invalidation and error outcome. The legacy host remains a named temporary app adapter until UI owns those platform ports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Wave 6 and Wave 7                   |
| `F-APIKEY-01`         | **Closed by `efa933315d`.** The duplicate `ApiKeyManagementRestFeature` is deleted and the packaged `createApiKeysRestApp` family now serves through `ApiRestSecurity`/`createAppRestSecurity`, so the five management routes register their access policies in the route-policy registry at mount. | Closed                              |
| `F-APIKEY-02`         | **Cause-loss closed in this slice.** Both infrastructure catches in `ApiRestSecurity.organizationAuthentication` now log the caught error, with the request path and method, before the deliberate `internal_error` refusal. Still open from the original finding: `getSettings` decrypts S3 credentials on the authentication hot path, neither chain logs its refusals (the old adapter's `AuthDiagnostics`/`notDelegableReason` warns were dropped), and the management error handler sets no explicit `fault` and casts `httpStatus`. | Wave 3 API cutover                  |
| `F-AUTHZ-GRAPH-01`    | `frontend-boundary.unit.test.ts` is red because `52980c4405` replaced the per-call authz composition (`authzChecksFor(ctx.prisma)`) with `getApp()` in `server/api/rbac.ts`, pulling `app-layer/app.ts` and its graph into the rbac module chain — the deleted `app-layer/authz/checks.ts` header names this exact guard as its reason for existing. Every cut is structural: a leaf accessor module repoints 187 files, dropping the `getApp()` fallback breaks `resolveCallerProjectScope`'s synthetic ctx, and a per-call `AuthzService` recomposes the root the branch removed. Decide the shape before the next rbac change. | Wave 3 and Wave 9                   |
| `F-REDIS-093-01`      | `secondaryStorage.unit.test.ts` fails because `4bba78994c` replaced ADR-093's per-call `tryGetApp()?.redis` with a connection injected once by `createAuth`, deleting the `droppedSecondaryWrites` counter and its warning. The new construction is arguably stronger — `redis: null` yields no secondary store and a per-pod memory limiter, so the degraded state the ADR's "never silent" Rule exists to make audible is impossible by construction — but all five scenarios under `specs/server/redis-client-ownership.feature`'s Rule bind to this suite and nowhere else, and the ADR is Accepted. Retiring the Rule needs an ADR amendment, not a test patch. Note `redisEnv.skip` reads `process.env.BUILD_TIME` at module load — a rewritten suite must clear it before importing. | Decision before the auth vertical   |
| `F-GATEWAY-CAT-01`    | `edd5305c3f` changed `toLegacyCompatibleCustomModels` from a pass-through cast to a `.strict()` `safeParse` that silently DROPS any stored `customModels` entry carrying an unrecognised key — the model becomes unroutable with no error. A semantic change rode into a refactor commit, and nothing pins either the old pass-through or the new drop. Decide lenient-parse versus strict-drop deliberately and pin it. | Wave 3 gateway vertical             |
| `F-TYPECHECK-10`      | The whole-tree typecheck's last six errors are decisions (the connection-test verdict collapse, the monitor JSON write and the dataset-migration port were repairs, resolved in their packages), each diagnosed in the drain (`baf5b18fed`): `StoredObjectDeliveryPort`/`UploadTokenPort` have no non-throwing implementation behind four mounted REST operations (unfinished feature); two module identities for one `Project` declaration; and four contract/test-composition calls (`config.materialiser`, `tasks.generated`, `workflowEvaluation.service`, `pipelineRegistry`). Decide each before claiming a green tree. | Wave 3                              |
| `F-HOME-01`           | `user.homePagePickerState`'s first-project port and `governance.resolveHome`'s first-project query disagree: the resolver excludes personal workspaces (ADR-038 v6), the picker does not, so the picker can offer a personal-workspace slug the resolver would never route to. Changing either is a wire-behaviour change; align them deliberately when the home vertical is next touched. | Wave 3 and Wave 9                   |
| `F-SPEC-GOV-01`       | `specs/ai-gateway/governance/admin-trace-access.feature` carries no binding tags, so none of its scenarios enforce anything (`check-feature-parity` reads `0/0 bound` as green); the drained governance package tests cover the behaviour by name only. Tag the scenarios and add `@scenario` annotations when the governance vertical is next touched. | Wave 9                              |
| `F-API-07`            | The working-tree OpenAPI regeneration deletes the deployed `/api/secrets` and `/api/secrets/{id}` that `main` publishes, and adds six paths that exist on no base: `/api/v1/secret/secrets`, `/api/v1/secret/latest/secrets` and `/api/v1/secret/2026-08-24/secrets` with their item paths. None of the four agreed Secret bases appear. This is the branch-invented versioned family that resolved decision 7 orders removed, with the segments transposed. Do not commit these bytes; regenerate on the merged branch.                                                                                                                                                                                                                                                                                                                          | Wave 3 and Wave 9                   |
| `F-API-08`            | `ApiProductionComposition.compose` constructs `ApiQueueInfrastructure` unconditionally and it throws without configured Redis, so any future API launcher inherits a hard Redis dependency at boot. Decide whether the API process requires Redis or composes the queue lazily before adding a start command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Wave 3 API process root             |

Resolved during the Secret REST batch: aliases now have unique operation IDs,
the documented alias set is fixed to the four prefixes above and generator
prune coverage recognises all four. Whole-document operation-ID uniqueness
remains a general generation gate in Wave 9.

Resolved during process activation: `F-API-05` is superseded by the real
listener and bounded HTTP drain in `f1baea7011`. The worker drain ordering and
first-error retention proof is covered by `0d877db1d7`; remaining executable
composition work is represented by `F-API-06`, `F-WORKER-01` and the active
process rows rather than keeping obsolete findings open.

Resolved during Wave 1 configuration: `F-OBS-01` is closed by `13f6138060`.
The Observability package no longer reads environment values; legacy names are
parsed by process composition before graph imports. Remaining physical
API/worker adoption stays under `F-OBS-02`.

Resolved during Wave 1 queue composition: `F-QUEUE-01` is closed by
`2088ac9e67`. All five queue policy values are parsed once and injected into
the sole live platform Group Queue factory. This does not enable the partial
Worker consumer; that gate remains under `F-WORKER-01`.

New findings recorded during the Wave 3 to 5 fan-out:

`F-REST-01` — **Wave 3's Public REST column has a prerequisite the plan never
named, and two agents found it independently.** One inventoried the ingestion
and telemetry surface (13 modules, 27 routes), the other the product CRUD
surface (16 groups, 95 routes). Both delivered the inventory and both declined
to move anything, for the same reasons:

The routes sit on `platform/app`'s security spine — `createProjectApp`,
`createServiceApp`, `SecuredApp`, `requires`, `handlerManagedAuth` under
`server/api/security/**` — and nothing packages it. `apps/api`'s
`createRestService` is a different contract rather than a different spelling: a
versioned base path, `projectId` taken from input instead of from the
credential, a different error envelope, different generated operation ids, and
API-key-only authentication where `createProjectApp` also accepts a browser
session cookie. The divergence is enforced, not incidental —
`createRestService` throws at construction if handed an `onError`, so the legacy
handler cannot be threaded through. Eighteen of nineteen product route files
publish the legacy envelope.

Leaving `SecuredApp` also drops routes from the REST authorization audit, which
enumerates `allRegisteredRoutes()`. That is already recorded as `F-APIKEY-01`
for the single feature that jumped; repeating it would silently un-audit
`/api/collector`, all three OTLP endpoints and all four ingest receivers at
once.

Two facts soften the picture. The service layer is ready: no product route file
touches Prisma except `evaluations-legacy`, and every feature already has a
canonical abstract service. And the live pattern already exists and is not the
`apps/api` one — Secret is package-owned, composed through
`createProjectRestApiService`, and that helper reaches `registerRoutePolicy` via
`onRouteMounted`, so it keeps the audit that `apps/api`'s `buildSecretRestApi`
drops. Under the rule that nothing new goes in `platform/app`, that composition
seam needs a new home, which is a decision rather than a mechanical move.

One more fact gates all of it: `apps/api` has no `start`, no `dev` and no `bin`.
Moving a route there today removes it from the served surface.

Sequencing: package the security spine and give `apps/api` an executable boot
before any REST vertical, or accept `createProjectRestApiService` as the
compatibility seam and give it a home outside `platform/app`. Both inventories
are complete and should be reused rather than redone.

`F-CI-02` — **package suites are invisible to CI, and the real number is far
worse than `F-CI-01` estimated.** Measured across every workflow, not just
`langwatch-app-ci.yml`: **162 workspace packages declare a `test` or
`test:unit` script, 17 are named by any workflow, and 145 are named nowhere —
132 of them under `packages/`.** Only three workflows name a package suite at
all (`langwatch-app-ci.yml`, `agent-plugin-ci.yml`, `npx-server-smoke.yml`), and
`langwatch-app-ci.yml` names them as hand-written steps one at a time, so a new
package is invisible by default rather than by decision.

This is not a gap beside the extraction; it is a gap in the extraction's own
feedback loop. Every wave of this plan moves behaviour out of `platform/app` —
which CI does run — into `packages/features/*`, which it does not. Eighty-six
transport tests written in a single hour of Wave 3 (Dataset 26, Evaluator 44,
Monitor 16) execute only on a laptop. The more successful the extraction is, the
less of the product CI covers.

The fix is not 264 more hand-written steps. It is one discovery-driven job that
runs every workspace package's suite, so a package cannot be forgotten, plus a
baseline for the ones that are red today so the inventory can only shrink. Do
not add that job before measuring the current pass rate across all 132 — a job
that arrives red and stays red teaches everyone to ignore it.

**Closed.** The job exists — `.github/scripts/run-package-suites.sh`, which asks
`pnpm list --recursive --depth -1 --json` for the workspace membership rather
than being told, so a package joins CI the moment it declares a script — and the
measurement it was gated on has now been taken. Every workspace package's suite
was run by hand on 2026-08-30, in the same `test:unit`-then-`test` precedence the
script uses: **22,076 tests passing, zero red**, across 158 packages plus the
four `apps/*`. So the baseline register the plan asked for is correctly EMPTY;
`.github/package-suites.allowed-failures` names nobody, and the job does not
arrive red.

Two things the measurement turned up, both fixed in `29fad2a4e2`: `skills` and
`mcp/typescript` were the only packages whose `test` script was bare `vitest`
— watch mode, which never returns — with no `test:unit` beside it for the script
to prefer. CI was unaffected (`CI=true` makes vitest run once), but a local
sweep hangs on them. Note also that both suites drive real Claude Code agents
through `it.skipIf(isCI)` scenarios with a one-hour `testTimeout`: they are
meant to be run deliberately, not swept.

`F-LAYOUT-01` — **`feature-source-layout`'s 213 violations are three different
problems, and none of the three is mechanical cleanup.** The count is the second
largest in the lint and had been carried as one undifferentiated number, which
makes it look like a rename sweep. Measured 2026-08-30:

- **110 use a role the grammar does not have.** `SERVER_PATTERNS` admits
  `service`, `port`, `repository`, `store`, `projection`, `subscriber`,
  `process`, `intent`, `adapter`, `api`, `mapper`, `migration`, `app` and
  `fixture` — and nothing else. The code uses more: `rules` (50, Trace's
  canonicalisation predicates), `canonicaliser` (16, one per SDK vendor), then a
  long tail of 44 one-offs (`schemas`, `bag`, `openapi`, `trpc-context`,
  `codec`, `registry`, `policy`…). Renaming a per-vendor canonicaliser to
  `.service.ts` would satisfy the rule and lose the distinction that makes the
  directory readable, so this is a question about the grammar, not about the
  files: either it grows the two roles that are clearly vocabularies, or the
  code gives them up deliberately.
- **72 carry no role at all**, sitting in ad-hoc subdirectories —
  `identity/server/src/better-auth/`, `crypto/`, `analytics` (17), `langy` (12),
  `dataset` (8). This is genuine mid-move debt and belongs to whichever wave
  finishes each package; identity's 29 sit under its own ADR-115 restructure.
- **31 have the right role in the wrong place**, which looks mechanical and is
  not. Moving `stored-object/server/src/api/public/stored-object.api.ts` to
  `transport/` collides with an existing `transport/api-rest/stored-object.api.ts`
  — different files, same name, because `api/public/` holds a public API class
  (122 lines) and `transport/api-rest/` holds route definitions (441). The
  grammar has one `api` role for both. `specs/stored-objects.feature:23` also
  pins the current path by name, so the move is a spec change too.

Do not sweep this cluster. The 31 are the only ones worth attempting file by
file, and each needs its collision checked first.

**A worked example of that, because it was tried and reverted** (`5663c4b9fa`,
undone by `208310c6e5`). Four modules in `ports/` are named for what they
abstract — `data-privacy.repository.ts`, `scheduler-ops.repository.ts`,
`scheduler-wake.service.ts`, `stored-object-owner.repository.ts` — and all four
really are ports, so `<subject>.port.ts` is the truthful name. Renaming the
files alone moves `feature-source-layout` 213 to 209 and `strict-port-module` 0
to 4: that rule requires a `.port.ts` module to export an abstract class whose
NAME ends in `Port`. The file rename and the class rename are one change or
neither.

And the class rename is not uniform. Three of the four already export abstract
classes, so they need their names and about nineteen references changed.
`SchedulerOpsRepository` is an `interface`, and making it an abstract class
switches that port from structural to nominal typing — implementors must
`extends` it, so composition has to change too. That is a decision for the
feature that owns the port.

`F-CROSS-01` — **the last `cross-feature` violation is a real UI question, not
a misplaced import.** Five of the six were things in the wrong package and are
closed: billing building Notification's Postgres adapter, webhook and governance
each importing one pure function from another feature's SERVER package, Trace's
draft store taking two domain types from `annotation-web`, and langy taking a
clipboard hook from `trace-web` that has always lived in the design system.

The sixth is `prompt/web` importing `ColorfulBlockIcon` and `ComponentIcon` from
`workflow-web`, and prompt genuinely renders workflow component icons —
`variable-insert-menu.tsx` does `<ComponentIcon type={type as ComponentType} />`.
`ComponentIcon` is keyed by workflow's own `ComponentType`, so moving it to the
Design System would drag a feature's domain vocabulary into a shared package.

Three ways out, none obviously right:

1. Split them. `ColorfulBlockIcon` is a coloured wrapper around any icon and is
   Design System material on its own terms; `ComponentIcon` is the one carrying
   workflow's vocabulary. Prompt would still need the second.
2. Pass it in. Both call sites are inside `prompt/web/src/surfaces/`, and
   `ui-surface-closure` already says a surface should "receive portable values
   and controlled actions from the consuming feature" — so the icon becomes a
   prop and the host supplies it. This is probably right, and it changes the
   surface's published props.
3. Accept the dependency and record why prompt may see workflow's component
   vocabulary.

`F-EXPORT-01` — **`private-runtime-export`'s 17 are one inversion, not
seventeen deletions.** Sixteen are `packages/features/trace/server/src/index.ts`
re-exporting its own repositories, projections and eventing stores; the
seventeenth is webhook's ClickHouse events repository. Checked every exported
NAME rather than the module path — searching the path suggests two are unused,
searching the names shows all sixteen are imported by `platform/app`, several
dozens of times (`applySpanToSummary` alone, 252).

They are exported because the app CONSTRUCTS them. `EventingTracePipelineAdapter`
already exists as the composition seam, but it takes the stores as options
(`summaryStore`, `spanStore`, `derivedStore`, `rollupStore`), so the app has to
build them first, which is why the index publishes them. Making them private
means the adapter constructs its own stores and takes their ClickHouse
dependencies instead — an inversion of who owns construction, not a change to
the export list.

**Webhook's is done** (`ea535fb6c4`), and it is the pattern the trace sixteen
follow. Three moves, in this order:

1. Add an adapter whose `create` returns the PORT, modelled on the package's
   existing `WebhookEndpointAdapter`. Every caller already wanted the port —
   they assigned the result to a field typed as one — and only named the
   implementation because that was the only way to construct it.
2. Move the port out of `repositories/` into `ports/`. The rule treats
   `repositories`, `stores` and `projections` as private with no exceptions, so
   a port living in one cannot be exported at all; ops and data-privacy already
   keep theirs under `ports/`.
3. Check every name leaving the surface by NAME, not by module, and diff the
   index's exported identifiers before and after.

Trace's sixteen are harder in one specific way: its adapter takes the four
stores as options, so step 1 there means the adapter constructing them and
accepting ClickHouse dependencies instead — the inversion described above.
Webhook needed no such change because its repository already took only a
client resolver.

`F-NAMING-01` — **`try*` carries two meanings and the rule only knows one.**
`fallible-result-naming` treats the prefix as "may answer absence", which is the
convention CLAUDE.md documents and is right for `tryFindById`. But
`TraceSpanDedupPort` uses it for a second thing: `tryConfirmProcessed` and
`tryReleaseOnFailure` return `Promise<void>` and mean BEST EFFORT — the
implementing service's docblock says "Dedup never blocks ingestion, all errors
are swallowed and logged", and callers must not care whether Redis answered.

Neither remedy the rule offers fits. Returning null would invent a result nobody
reads; dropping the prefix would leave `confirmProcessed`, which reads as though
it throws when the whole point is that it does not. Their own sibling
`tryAcquireProcessingLock` returns `boolean | null` and does mean absence, so the
port uses both senses in three adjacent lines.

Two violations, and the fix is a decision about the vocabulary — either a second
prefix for best-effort side effects, or the rule learns that `try*` returning
`void` is a distinct, documented case. Not decided here.

`F-PRISMA-02` — **`apps/api`'s two generated-Prisma imports are a Workflow
vertical slice, not a lint fix.** `prisma-containment` reports 35, and two are in
`apps/api` — the extraction's TARGET, so they are new debt rather than legacy.
Both are `import type { PrismaClient }`, and the rule is right to count a type
import: a module typed against `PrismaClient` still forces its caller to hand
over a generated client, which is the coupling, even though the import is erased.

`custom-evaluators.ts` runs one query — `prisma.workflow.findMany` for
`isEvaluator` rows with their versions — and its own docblock already names the
fix: "until the Workflow vertical owns the query". The seam exists.
`WorkflowRepository` has a Prisma implementation, and that implementation has
already solved this exact problem with `WorkflowDatabase`, a narrow structural
type (`findMany(args: unknown): Promise<unknown[]>`) whose rows are validated
back through the contract's Zod schemas. Adding `findEvaluators({ projectId })`
there is the shape of the answer.

What stops it being a small change: **the result is a published wire shape.**
`evaluation.api.ts`'s `availableCustomEvaluators` returns these rows straight to
the browser, and `evaluations-legacy.ts` reads `evaluator.versions[0]?.dsl` off
them. The current implementation spreads the whole Prisma row, so "keep the
shape identical" means pinning fields nothing has enumerated yet. Sequence it
with the Workflow vertical, where the shape can be named once and asserted,
rather than as a by-product of clearing a lint rule.

`F-TRPC-01` — **a moved vertical needs `@trpc/server` in its own manifest.**
`packages/features/model-provider/server` could not resolve it, which produces
around forty `TS7031 implicitly any` errors downstream rather than one honest
module-not-found. Check the manifest first when a moved API file types as `any`.

`F-DATASET-02` — **`DatasetConflictError` exists twice**, once in
`dataset-contract` and once in `server/src/services/errors.ts`, and only the
second carries `reason`. Today's translation is duck-typed on `error.name` so
both work and the two paths happen to line up: the record mappings use contract
classes and the service throws contract classes, while the adapters throw the
`services/errors` family. An `instanceof` against the wrong one fails silently.

`F-EVAL-01` — **one deleted test was already red at baseline.**
`evaluators.tenant-workflow.unit.test.ts` failed 3/3 before the move, building a
context whose `app.evaluators` is undefined because the behaviour it asserted
had moved into `EvaluatorService`. Its intent is restored as two cases in
`evaluator.service.test.ts` pinning `workflows.assertInProject`. Deleting a red
test is only defensible when its intent lands somewhere green; record which.

`F-TRPC-02` — **two client-facing types widened during the Monitor move**, and
the reason is a real TypeScript limit rather than a shortcut. `monitors.create`
and `update` now type `preconditions` as `MonitorCreateInput["preconditions"]`
rather than the literal-union `CheckPrecondition[]`, and
`evaluators.cascadeArchive` types `archivedWorkflow` as `{ id: string }`.
Runtime validation is byte-identical — the same schema is injected — but the
compile-time hint on `field`/`rule` is looser. A generic parameter would have
preserved it exactly, and cannot: property access on a `z.object()` mapped type
containing an unresolved type parameter does not resolve, producing 24
`TS2339`s. Revisit if the compiler stops being the obstacle.

Resolved during Wave 2 access composition: `F-AUTHZ-01` and `F-AUTHZ-02` are
closed by `480e9f73ec`. The canonical decision path preserves denial reasons,
membership-disabled and lite-member errors retain their specialised envelopes,
and blank scope IDs use the contract-owned validation error.

## Measured exit inventory

At working checkpoint `6443405af9`, `platform/app` contains 6,268 tracked files,
including 5,911 under `src`. That is 93 fewer files than the last measured
inventory, and unlike the seven commits before it the fall is real deletion: 74
orphaned modules with no caller anywhere, five modules the barrel removals
stranded, a denial class that existed in triplicate, and two re-export shims the
`agents`/`secrets` mounts no longer need. Counts include tests unless identified
as production-only and are refreshed after each committed wave; only displaced
production code counts as exit progress.

### Source cohorts

| Path cohort               |                                Files | Exit owner                                                                  |
| ------------------------- | -----------------------------------: | --------------------------------------------------------------------------- |
| `src/server`              |    1,886 total; about 908 production | Feature server packages, `apps/api`, `apps/worker`, infrastructure packages     |
| `src/server/app-layer`    |      370 total; about 186 production | Deleted through explicit API/worker composition; never copied                   |
| `src/server/api`          |                                  312 | Feature app-tRPC adapters; 87 of 93 mounted routers still live here             |
| `src/features`            |                                1,271 | Feature web/server packages and `apps/ui` composition                           |
| `src/components`          |                                1,150 | Feature web packages, Design System or `apps/ui` global UI                      |
| `src/runtime`             |                                  283 | `apps/api`, `apps/worker`, `apps/ui`, config/observability packages             |
| `src/pages`               |                                  260 | `apps/ui` screens/routes or API compatibility entries                           |
| `src/app`                 | 224; about 124 production API routes | Feature REST adapters and `apps/api` route composition                          |
| `src/experiments-v3`      |                                  195 | Experiment/Evaluation feature web and server packages                           |
| `src/utils`               |                                  168 | Owning feature or shared package, never a miscellaneous dump                    |
| `src/hooks`               |       134 total; about 83 production | Feature web behaviour or `apps/ui` browser adapters                             |
| `src/prompts`             |                                  131 | Prompt feature web/server packages                                              |
| `src/optimization_studio` |                                   67 | Agent/Workflow/Scenario/Evaluation web packages                                 |
| `src/tasks`               |        29 total; about 19 production | Worker task registry or explicit migration/tool packages                        |

The four heaviest single directories are `src/features/traces-v2` (647),
`src/server/app-layer` (370), `src/server/api` (312) and `src/features/langy`
(224). Between them they are 1,553 files, a quarter of the application, and each
belongs to a different wave: Wave 7, Wave 3/4 composition, Wave 3 transport and
Wave 6 respectively. None of them shrinks as a side effect of the others.

### Non-source cohorts

| Path cohort |                                   Files | Exit requirement                                                                        |
| ----------- | --------------------------------------: | --------------------------------------------------------------------------------------- |
| `scripts`   |                                     136 | Re-home by owning feature/process/tool; remove app working-directory assumptions        |
| `public`    |                                      90 | Move browser assets to `apps/ui` or owning web package                                  |
| `e2e`       |                                      63 | Point at physical API/UI/worker processes without app imports                           |
| `specs`     |                                      30 | Move feature behaviour to owning feature; keep true application specs with physical app |
| `prisma`    | 3 plus generated/migration dependencies | `packages/prisma-client` and strict feature repositories                                |

After `6ec280aec8` the architecture baseline classifies 816 legacy fragments
across 774 unique files: 500 page shells, 196 implementations, 93 transports, 25
composition files and two infrastructure adapters. By feature the concentration
is langy (137), prompt (109), ops (104), project (65) and organization (42) —
between them half the inventory. The global-app-access baseline holds 208
occurrences across 63 files, with a further 34 occurrences unbaselined and
therefore currently failing. Refresh both from the collectors rather than using
older forecast counts.

### Largest backend residuals

- global boot/config: `server.mts`, `start.ts`, `task.ts`, `runtime/config.ts`,
  `runtime/app/**`, instrumentation, shutdown and metrics;
- global application graph: `server/app-layer/app.ts`, presets and global
  accessors;
- internal API: `server/api/**`, including the root router and roughly 259
  router/test modules;
- public/internal HTTP: `server/api-router.ts` and `src/app/api/**`;
- Eventing: `server/event-sourcing/**`, worker runtime, registry, replay,
  ProcessStore and EventStore adapters;
- data/infrastructure: `server/clickhouse/**`, global Prisma/Redis, storage,
  mail, Stripe, Slack, AWS, WebSocket, NLP and model clients;
- feature residue: analytics, traces, gateway, stored objects, model providers,
  evaluations, workflows, Langy, governance and billing.

### Largest UI residuals

- 151 declared routes and 558 page-shell baseline entries;
- `components/settings` (101), `components/agent-testing` (126),
  `components/ops` (87), shared UI/icons (108), suites (60), gateway (47),
  scenarios (35), datasets (25), analytics (24), traces (21), evaluators (23),
  evaluations (19), agents (remaining drawers) and other domain folders;
- `features/traces-v2` (662), `features/langy` (224), onboarding (106),
  auth-front-door (56), navigation (54), command-bar (47), automations (45),
  analytics-query (40) and errors (24);
- the old main entry, providers, layouts, route table, redirect table, about 50
  drawer keys, global browser state and 198 browser files crossing into
  server/backend boundaries.

Only 24 catalogue features currently have a web package, and only Agent and
Prompt expose strict screen/surface boundaries. Create web surfaces only for
features that own reusable browser behaviour. The catalogue also lists `auth`
while `packages/features/auth` is absent; inventory and establish that owner
before migrating the Better Auth/session cohort rather than scattering it into
User or app composition.

## Resolved decisions

1. **Eventing adapters:** use a server-only `@langwatch/eventing/server` export.
   The existing package already owns queues, Redis, telemetry, stores and
   process-manager runtime; do not create another package or put adapters in
   Topic/worker.
2. **ClickHouse:** the managed tenant-aware resolver stays in
   `@langwatch/clickhouse-client`. Eventing and features consume it through
   injected typed dependencies.
3. **Queue payloads:** Group Queue owns shared payload offload, staging headers,
   cleanup, limits and retry/redelivery semantics.
4. **Enterprise model providers:** extend existing
   `@langwatch/enterprise-worker`; core worker consumes the portable service and
   never imports Enterprise implementations.
5. **Agent tRPC:** mount the complete thin compatibility router, preserving
   names/shapes over one Agent service graph.
6. **API activation:** perform a direct cutover after heavy parity/integration
   testing. Do not add a parallel deployment phase.
7. **Secret REST:** accept singular and plural resources with and without the
   explicit version prefix: `/api/v1/secret`, `/api/v1/secrets`, `/api/secret`
   and `/api/secrets`, plus their item paths. Unversioned paths select the latest
   version; `X-API-Version` may select `v1`, and path/header disagreement is
   rejected. `main` OpenAPI proves deployed compatibility is five REST
   operations on `/api/secrets` and `/api/secrets/{id}`. There is no deployed
   public Secret RPC; remove the branch-invented
   `/api/secrets/{version}/secrets.*` family. Internal app tRPC is separate.
8. **Trace full-read:** keep canonical full-read internal and all-visible.
   Public actor/viewer protection is a separate service/trust boundary that
   composes canonical read, protection and edit overlays later.
9. **Worker activation:** keep the new worker producer-only while the legacy
   registry remains the sole consumer of the shared Eventing queue. Mount the
   complete package-composed registry, including Trace `assignTopic`, then make
   one tested consumer switch; never run a Topic-only consumer on that queue.

## Decisions approaching

These decisions are not blockers for the active migration lanes, but their
answers will be needed before the named later boundary can close:

1. **Secret compatibility retirement:** whether legacy project-key write actor
   handling and duplicate-error text must remain byte-for-byte compatible, or
   may converge on the canonical Secret service when `/api/secrets` is retired.
2. **Observability SDK ownership:** which single LangWatch SDK/OTel entry owns
   API, worker and Eventing instrumentation before process activation.
3. **UI platform ports:** the stable small ports for routing, overlays, session,
   notifications and transport hooks that let `apps/ui` delete temporary
   feature host adapters without creating another global context bag.

### Worker blocker graph (2026-09-02, all 8 remaining wrappers blocked)

Shared prerequisites, by leverage: (1) **ProjectService worker-composable** — gates langy-conversation (via ApiKeyService), scenario (prefetcher), gateway-spend (debit graph) and part of automation; it needs organizations, the LWQL ClickHouse key-map and S3 stored-objects. **CORRECTED AND LANDED FOR THE TRACE PATH 2026-09-02 by (g2): none of those three is reached by ingestion. The key map is called only in `ProjectService.create` and the stored-object deleter only in `archive`, both already optional constructor arguments, and `OrganizationService` is reached only by `create`/`ensureInternal`. `apps/worker` composes the read halves of Project, Data Privacy, Model Provider and Monitor from one Prisma client and builds `command:recordSpan` whole. The other four gated conversions must be re-surveyed by counting CALLS rather than constructors; see the (g2) record.** (2) **Packaged mail capability** — LANDED in baca75a26b; join-request converted on it, automation and evaluation can consume the same EmailDeliveryPort once their template placement is decided. (3) **Trace conversion** — surveyed 2026-09-02 (in the a3147dbb slice report): all-or-nothing, 28 byte-frozen keys, 21-field bundle census recorded; the binding wall is field 9, subscriber:graphTriggerActivity needing AutomationService.evaluateGraphTrigger. TWO CORRECTIONS: scenario's traceSummaryStore blocker clears WITHOUT trace converting (createAppTraceSummaryStore is 60 lines of purely packaged imports over substrates the worker holds), and the evaluator-engine path does not gate trace (its reactors close over command dispatchers the evaluation installer already defers). The trace↔automation cycle breaks at automation's GRAPH half: an AutomationGraphActivityPort backed by the packaged AutomationGraphService/GraphAlertDispatchService over the now-packaged EmailDeliveryPort + harvested encrypt/decrypt, Slack/webhook delivery, PrismaScheduledJobStore, unsubscribe-token verifier. Landing order: (a) the graph vertical, (b) a shared RedisTenantBroadcastAdapter frozen twin (trace/scenario/langy all need it), (c) the 1,970-line span-storage write repository, (d) the trace-privacy vertical (~2,700 lines + tiktoken), (e) blob store onto StoredObjectStorageRuntime, (f) four narrow ports + three OTel twins + the 13-line evaluationNameAutoslug move, (g) the conversion itself. (4) Model-provider resolution (getVercelAIModel) harvested with explicit params. (5) The all-instance ClickHouse directory (gateway-spend settlement) — endgame. Wave order: mail+join-request → Trace → scenario/evaluation → ProjectService wave → automation/langy-conversation/gateway-spend. **CORRECTED 2026-09-02 by the step-(g) attempt: the wave order inverts to mail+join-request → ProjectService wave → Trace.** Trace needs `ProjectService` three ways directly (`projectMetadata`, `graphTriggerActivity`, the narrow-ports bundle) and two more transitively — `PrismaDataPrivacyAdapter` and `PostgresModelProviderAdapter` both require it, and both are on `recordSpan`'s path — so ProjectService gates five conversions rather than four, and Trace is one of them. Step (g)'s halt record at the end of this section carries the evidence.

**Steps (a) and (b) landed (uncommitted at time of writing).** (a) `AutomationGraphActivityPort` is the two methods
`subscriber:graphTriggerActivity` actually calls, and `createGraphTriggerActivityHandler` now names it instead of the whole
`AutomationService` — the published service satisfies it structurally, so the application compiles with zero platform edits.
`PostgresAutomationGraphActivityAdapter` composes the vertical end to end from a narrowed database type, a clock, ProjectService,
AnalyticsService, the outbound transports and the credentials cipher; the 60-second active-automation window moved into a shared
`ActiveTriggerCacheService` so the full service and the graph-only adapter cannot disagree about which automations are live.
Harvested into the feature: the unsubscribe-token format (both halves) and the no-reply address, each with the application's copy
frozen and its recorded bytes pinned. Harvested into apps/worker: the trigger-mail envelope (no-reply To, BCC fan-out, unsubscribe
footer, RFC 8058 headers), the Slack incoming-webhook client and a direct Slack Web API transport. FOUR SURVEY ITEMS PROVED OFF
THIS PATH and were deliberately not dragged in: `PrismaScheduledJobStore` and the scheduler wake serve report schedules, the
ClickHouse heartbeat resolver serves `decideGraphTriggerHeartbeat`, the runaway notifier and its three prom counters serve
`handlePersistCapBreach`, and `sendLegacyEmail`/`sendLegacySlackWebhook` (the only two react-email renderers on the port) serve the
settlement digest — none is reached by `evaluateGraphTrigger`, and all four refuse by name. The one real gap is the customer-supplied
webhook URL: its SSRF fence, URL admission policy and dispatch budget are ~1,200 platform-only lines (`sendWebhook`,
`httpDestination`, `urlPolicy`, `ssrfProtection`) that are shared egress policy rather than an automation asset, so the transport is
an injected option and webhook alerts refuse by name without one. That harvest is its own slice. (b) `RedisTenantBroadcastAdapter`
ships in notification-server with the channel and body pinned by literal; every candidate placement inside trace/scenario/langy trips
cross-feature, so it lives beside the mail capability and the three features declare their own narrow port when they convert.
Worker config gained `NEXTAUTH_SECRET` (one leaf, two named uses: unsubscribe signing and the credentials-key fallback),
`TRIGGER_EMAIL_HOURLY_CAP`, `TRIGGER_EMAIL_TENANT_DAILY_CAP` and `CREDENTIALS_SECRET`, all at the application's spelling and defaults.
NEITHER IS MOUNTED: Trace still registers `graphTriggerActivity`, and the three broadcast producers are still the application's, so
both are proven by composition-capability tests in `apps/worker` and are staged for the trace conversion at step (g).

**Step (c) landed (uncommitted at time of writing): the span-storage WRITE repository.** The application's 1,970-line
`SpanStorageClickHouseRepository` is one file with two halves, and only the write half is a trace-conversion prerequisite. What was
harvested is exactly that half — `insertSpan`, `insertSpans`, the `stored_spans` write record and `toClickHouseRecord` — into
`TraceSpanStorageClickHouseRepository` (`repositories/clickhouse/`), plus `ClickHouseTraceSpanStorageAdapter` satisfying the
`TraceSpanStoragePort` the package already declared. The read half stayed: its windowed readers, memory caps and column projections
serve `SpanStorageService`, which is where the trace-privacy vertical (step d) and the blob store (step e) attach. The application's
copy is untouched and both now write the same rows.

FOUR SURVEY ITEMS SHRANK ON CONTACT. (1) `SpanStorageService` was NOT carried, because it is not the seam this repository serves:
its write surface is one delegating method, and the other twelve are reads that pull in `resolveOffloadedTraces`, the blob store and
the visibility-window redactor — steps (d) and (e), dragged in early for nothing. The seam the write path actually serves is
`TraceSpanStoragePort` → `SpanStorageStore`, both already in the package. (2) The coding-agent consumer needs NO new port:
`CodingAgentTraceProcessingPort.tryGetNormalizedSpan` is already the narrow two-method port in coding-agent-server, and
`AppCodingAgentTraceProcessingAdapter` is the platform adapter that renames onto it. Its dependency is a normalized-span READ, which
belongs to the read half and to whoever composes `CodingAgentTraceProcessingPort` at conversion time — not to this slice. (3) There
are NO prom-client metrics anywhere in the span-storage repository, so there is no OTel twin to pin. (4) The retention default is
the one deliberate difference from the frozen twin: a package cannot read `PLATFORM_DEFAULT_RETENTION_DAYS`, so it is injected, and
the worker passes `eventing.retention.defaultRetentionDays` — the number the event store already stamps its own rows with — rather
than configuring it a second time.

ONE PACKAGE-WIDE CHANGE WAS REQUIRED AND IS LOAD-BEARING: `TraceClickHouseWriteClient.insert` now takes `readonly unknown[]`. The
Eventing substrate's client declares `readonly Record<string, unknown>[]`, which the old mutable spelling refused; narrowing it back
fails `apps/worker`'s typecheck, so the write path would be uncomposable outside the application without it. This is the same
correction `SuiteClickHouseClient` already carries, for the same reason.

TWIN-DRIFT PINS, chosen because ClickHouse hides exactly these: the table name, the 34 write columns in the table's own order, the
three insert settings as one literal object, the `(TenantId, TraceId, SpanId)` dedup triple, `StartTime` as both the
`ReplacingMergeTree` version and the `toYearWeek` partition key, the hard-zero dropped counts, the span-then-resource-then-unknown
service-name order and the retention stamp. An insert that omits a column succeeds by filling in that column's default, and no
reader can tell a defaulted value from a written one. The pins are literals in the package's own test rather than a read of the
application's source, which would die the moment either file moves.

NOT MOUNTED: `apps/worker/src/features/job-registry.json` and every `catalogue.json` are byte-identical, Trace still registers the
span-storage projection, and `createWorkerSpanStorage` has no production caller. It is proven by a composition-capability test that
drives `SpanStorageStore` → port → repository → a fake Eventing ClickHouse client end to end, asserting one insert per batch, tenant
routing and the retention stamp. Deployment impact: none until step (g).

**Step (d) landed (uncommitted at time of writing): the trace-privacy vertical.** The PII-redaction half of `recordSpanCommand`
is composable outside the application. Homes were surveyed rather than assumed. `@langwatch/redaction` takes the ENGINES —
`essentialPii.ts` (the nineteen pattern-and-checksum recognizers, `libphonenumber-js`, the exception veto) and
`contentRedaction.ts` (the native passes composed for one resolved policy) — plus a new dependency-free `piiEntities.ts` holding
both split lists. The engines sit behind a `@langwatch/redaction/pii` subpath so the package root stays browser-safe, which is the
property `markers.ts` already documented and which the settings screen and the trace-view banner both rest on.
`@langwatch/data-privacy-server` takes the SERVICE (`OtlpSpanPiiRedactionService` plus the shape-independent
`PiiRedactionPolicyService` it now leans on), the `PiiAnalysisPort` and the OTel metrics twin; trace, log and metric each already
declare their own narrow redaction port, and the published service satisfies all three structurally — the same reasoning that put
the tenant-broadcast twin in notification-server rather than inside any one feature. `apps/worker` takes the TRANSPORT
(`WorkerPiiAnalysisAdapter`: the Presidio batch client and the lazy Google DLP client, config injected, no environment read inside)
and the composition.

THE SLICE SHRANK ON CONTACT, TWICE, AND BOTH REFUSALS ARE BY NAME. (1) The service's record-shaped half — `redactLog`,
`lambdaRedactLog`, `applyNativeLogPass`, `redactMetricAttributes`, `lambdaRedactMetricAttributes`, `redactRecordNative`,
`createRedactionBatch`, `collectRecordEntries`, `applyRedactionBatch` and the `RedactionBatch` type — answers `LogRedactionPort`
and `MetricRedactionPort`, which belong to the log and metric conversions. `TraceSpanPiiRedactionPort.redact` calls `redactSpan`
and nothing else, so carrying them now would drag two other features' seams in for nothing and leave two more copies to keep
aligned. (2) The tokenizer is NOT on this path: `TiktokenClient` serves `OtlpSpanTokenEstimationService` behind
`TraceSpanTokenEstimationPort`, and `redactSpan` never reaches it. That is also why the survey's count of four new config leaves is
exactly right — `GOOGLE_APPLICATION_CREDENTIALS`, `LANGWATCH_DISABLE_GOOGLE_DLP`, `LANGEVALS_ENDPOINT` and
`LANGWATCH_DATA_PRIVACY_ENFORCEMENT`, at the application's spellings and defaults, with `isProduction` coming off the existing
`NODE_ENV` leaf and the Presidio timeout staying a literal in both graphs. `TIKTOKENS_PATH` and `TIKTOKEN_FETCH_TIMEOUT_MS` belong
to the token-estimation slice. Likewise `dropKeyCatalog`'s drop machinery serves `TraceSpanContentDropPort`; only the one marker
the redaction service stamps was carried, into `data-privacy-contract`.

A RECORDED GAP CLOSED. `packages/features/data-privacy/web/src/model/__tests__/pii-entity-labels.unit.test.ts` had dropped three
assertions "until those lists move into `@langwatch/redaction`" — that the essential map is exactly the native engine's list, that
the strict-added map is exactly what only the analyzer detects, and that the Brazilian CPF is the one native-only identifier. The
lists moved; the three are back, and the browser still pulls in no recognizer table.

TWIN-DRIFT PINS, chosen because every one of them fails silently in the direction of storing personal data: both entity lists as
literals in their own order, the derived strict-only set, the Presidio request (evaluate path, per-level entity map, `min_threshold`,
the 250,000-character truncation and remainder reassembly), both Google DLP info-type tables, the `[REDACTED]` masking, the
`langwatch.privacy.pii_incomplete` marker, the `partial`/`none` redaction-status values, the 250,000-character batch ceiling, and
the three metric series names with their `presidio/pii_detection` label. Nothing in a stored span records which identifiers were
searched for, so a span scanned for eighteen and a span scanned for nineteen are the same row.

THREE DELIBERATE DIFFERENCES FROM THE TWINS, all mechanical and all proven: the interface `PiiRedactionTransport` becomes an
abstract `PiiAnalysisPort`; four public methods that can answer `null` take the `try` prefix `fallible-result-naming` requires; and
the 884-line service splits into the shape-independent decisions and the OTLP-span walker, because `service-quality`'s baseline may
only shrink and a 626-line module cannot be baselined. The split is the seam the log and metric conversions will want anyway. A
member-by-member proof shows all thirteen carried bodies identical to the frozen twin modulo visibility, the `curly` brace fix and
those renames; `essentialPii.ts` and `contentRedaction.ts` diff byte-identical against the oxfmt-normalised twin.

NOT MOUNTED: `apps/worker/src/features/job-registry.json` and every `catalogue.json` are byte-identical, the application still owns
`RecordSpanCommand`'s adapters, and `createWorkerTracePrivacy` has no production caller. It is proven by a composition-capability
test that drives `TraceSpanPiiRedactionPort` -> service -> engines -> a stubbed analysis transport end to end, including the
no-analysis-service path behaving exactly as the application's does: native floor at the essential level, floor plus the
incomplete marker at strict, refusal in production, and pass-through outside production when no policy resolves. Deployment impact:
none until step (g); at that point the four variables become load-bearing for a standalone worker and must match the
application's while both graphs ingest.


**Steps (e) and (f) landed (uncommitted at time of writing), together with the tokenizer and the
13-line autoslug move.** (e) The 748-line `BlobStore` is TWO independent halves and was harvested as two:
the SPOOL half (`TraceSpoolService` in `@langwatch/trace-server`, `services/trace-spool.service.ts`) and the
`event_log` CLAIM-CHECK READ (`ClickHouseTraceEventPayloadRepository`, `repositories/clickhouse/`). Neither
half calls the other — `getFromEventLog` never touches object storage and `getSpool` never touches ClickHouse
— so composing them separately is what lets a process that can read one and not the other keep ingesting.
HOME CHOSEN OVER `@langwatch/stored-object-server`, deliberately: the prefix is `trace-blobs/spool`, the key
is `(projectId, traceId, spanId)`, the consumer is `TraceSpanSpoolPort`, and the destination guard is a rule
about THIS consumer's eager-delete-plus-lifecycle discipline. Putting it in stored-object-server would have
taught that package about trace ids. Everything trace-server needs from stored objects
(`mintStoredObjectUri`, `StoredObjectStorageDestination`) is in `@langwatch/stored-object-contract`, which is
the direction ten other contract dependencies already point. Both halves attach to ports the package ALREADY
declared (`TraceSpanSpoolPort`, `TracePayloadReaderPort`), so no new seam was invented. THREE DELIBERATE
DIFFERENCES, all mechanical: the `SpoolStorage` interface becomes an abstract `TraceSpoolStoragePort`; the raw
`S3Client` v1 read becomes an injected `TraceSpoolLegacyObjectPort` (a feature package cannot name a vendor
SDK, and the branch is a one-release window — absent, it refuses by name); and the `event_log` SELECT goes
through the package's existing `TraceClickHousePort`, which is `JSONEachRow`, where the application uses the
default JSON envelope. One `String` column renders identically in both. `streamToBuffer` was copied beside
its one caller rather than becoming a shared surface. apps/worker takes the transports
(`WorkerTraceSpoolStorageAdapter` over the stored-objects runtime it already holds, and
`WorkerTraceSpoolLegacyObjectAdapter`, which REFUSES a non-S3 destination by name: the v1 format predates the
stored-objects move that added Azure at all, so a v1 key can only ever be an S3 key) and one config leaf,
`AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`, read through `environmentOneOrTrueSchema` — which is already exactly
the App's `"1"`-or-case-insensitive-`"true"` rule. `environmentBooleanSchema` would have disagreed twice, and
both ways are silent: it refuses `TRUE`, which the App accepts, and it refuses `yes`, which the App reads as
"not confirmed" while carrying on.

(f) FOUR NARROW PORTS, all in trace-server because Trace is the consumer that declares what it needs:
`TraceProjectMetadataPort` (the three capabilities `projectMetadata` uses out of a fourteen-method
`ProjectService` — and this one was applied, not merely declared: `ProjectMetadataSubscriberDeps.projects` now
names the port, which the published service satisfies structurally, so the application compiles unchanged),
`TraceEvaluationMonitorPort` (`getEnabledOnMessageMonitors`; the App narrows the TYPE inline with `Pick<>` but
a process still had to build the whole service), `TraceModelCostCatalogPort` (`listCosts`) and
`TraceProductAnalyticsPort`. THE CODING-AGENT COST PRECEDENT DOES NOT TRANSFER, and the reason is worth
recording: `CodingAgentCostEstimatorPort.estimateCost` is pure, synchronous and over a STATIC catalog, and
Trace already has that shape in `TraceModelCostPort` for fold-time cost. Record-time enrichment reads the
operator's per-project, per-team and per-organization overrides out of a table and matches them by regex; a
span enriched from the static catalog when an override exists is billed at the wrong rate with nothing to show
it. THE PRODUCT-ANALYTICS SINK IS A NAMED ABSENCE, reported as asked. The trace path emits exactly one event,
`first_trace_integrated`, at most once per project — the onboarding funnel's terminal step, keyed by the org
admin's user id because that is the distinct_id posthog-js identifies the same person with in the browser.
This process has no PostHog and acquiring one for a single event is a vendor dependency this slice has no
mandate for, so `WorkerLoggedProductAnalyticsAdapter` writes the whole event to the log and says in its name
and its message that this is not delivery. A silent no-op was rejected: the App's no-op happens on deployments
that chose not to run product analytics, whereas this one would happen on the deployment that does,
undercounting the funnel forever. THE CONVERSION MUST REPLACE IT BEFORE MOUNTING `projectMetadata`.

THE THREE-METRIC CENSUS WAS CORRECTED. The third prom-client counter on the trace path is `pii_checks`, and
step (d) ALREADY twinned it as `PII_CHECKS_METRIC_NAME` in `OtelPiiAnalysisMetricsAdapter` — so this slice
adds the two that remained: `OtelTraceEvaluationLoopMetricsAdapter` in trace-server
(`langwatch_evaluator_loop_blocked_total`, label `reason`) and `OtelTraceAlertMetricsAdapter` in
governance-server, which satisfies the `TraceAlertMetricsPort` that package already declared
(`automation_match_records_total`, no labels, and the `count > 0` guard is carried because the subscriber
calls it on every trace). TWO MORE PROM COUNTERS WERE PROVED OFF THIS PATH and deliberately not dragged in:
`langwatch_edge_spool_fail_open_total` and `langwatch_edge_media_extract_fail_open_total` are incremented in
`AppTraceRuntime.createIngressPayloadPort` — the collector edge, which is apps/api's future, not the worker's.

THE TOKENIZER split the way step (d) split redaction: the ENGINE (`OtlpSpanTokenEstimationService`, 281 lines,
plus the ten-line `extractModelName` it shared with the un-harvested cost enrichment) into trace-server behind
`TraceTokenCounterPort`, and the vendor TRANSPORT (`TiktokenClient`, 170 lines byte-identical) into apps/worker
as `WorkerTiktokenCounterAdapter`. Its lazy `import()` calls are load-bearing and were kept: `tiktoken` and
`node-fetch-cache` are optional at runtime and the two JSON imports need the `with` attribute under the
production bundle. Two config leaves at the App's spellings, `TIKTOKENS_PATH` and `TIKTOKEN_FETCH_TIMEOUT_MS`,
with the App's `Number.parseInt` fallback carried verbatim — `z.coerce.number()` would refuse `10s`, which the
App reads as 10, and accept `-1`, which the App replaces with the default. `evaluationNameAutoslug` moved to
`@langwatch/evaluation-server` as its consumer's comment already asked, with the `~/utils/slugify` wrapper's
pre-replacement inlined and pinned: without it `answer_relevancy` slugs to `answerrelevancy`, which is a
DIFFERENT evaluator id for the same evaluation name, and the id is the key.

NOT MOUNTED: `apps/worker/src/features/job-registry.json` and every `catalogue.json` are byte-identical, the
application still owns every one of these subscribers and adapters, and none of `createWorkerTraceSpool`,
`createWorkerTracePayloadReader`, `createWorkerTraceTokenEstimation` or `createWorkerTraceNarrowPorts` has a
production caller. Each is proven by a composition-capability test driven THROUGH the port the conversion will
call. Zero platform edits. Deployment impact: none until step (g); at that point
`AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`, `TIKTOKENS_PATH` and `TIKTOKEN_FETCH_TIMEOUT_MS` become load-bearing
for a standalone worker and must match the application's while both graphs ingest.

**Step (g) census, items 1-3 cleared (uncommitted at time of writing): the last three record-span bodies.**
The step-(g) census listed ten items; the three record-time bodies are now harvested, all staged, all over
ports that were already declared.

(1) RECORD-TIME COST ENRICHMENT (`OtlpSpanCostEnrichmentService`, `@langwatch/trace-server`,
`services/span-cost-enrichment.service.ts`, behind `TraceSpanCostEnrichmentAdapter`) — and the survey found the
matcher ALREADY HARVESTED. `matchModelCost` in `@langwatch/model-provider-contract` is a behaviour-identical
private twin of the application's `matchModelCostWithFallbacks`: the same four candidate names in the same
order, the same normalize-then-retry inside each, the same `/`-prefix recursion, the same 5,000-entry
safe-regex cache, and `compileSafeRegex` is `new RegExp` + `safe-regex2` on both sides. It was exported rather
than copied a third time. Two implementations of that cascade would be two answers to "which of a customer's
rules prices this span", and the disagreement is visible only as a bill. THE ONE MECHANICAL DIFFERENCE: the
port answers `ModelCost` (nullable rates, from the table) and the matcher takes `ModelCostRate` (optional
rates), so the service maps rate-for-rate — the same mapping the application's adapter already does between
the same two shapes, and `?? 0` / `!= null` read `null` and `undefined` identically either way. Twin pins by
literal: the four generic model keys IN ORDER (`gen_ai.request.model` FIRST, where token estimation reads
`gen_ai.response.model` first — the two orders are deliberate and a "make them consistent" edit reprices every
span whose provider answers with a dated id), the bare `model` key scoped to
`claude_code.llm_request`/`session_task.turn` only, the five stamped attribute keys, the hard zero for an
unset token rate against the ABSENCE of an unset cache rate, and the raw-name-before-transformed-name pass
order. `extractModelName` had been duplicated by the tokenizer slice with a comment saying cost enrichment was
not harvested yet; it is now `SpanModelNameService`, one walk, two callers, two key orders.

(2) SPAN CONTENT DROP (`OtlpSpanContentDropService` + `ContentDropPolicyService` in
`@langwatch/data-privacy-server`; `CONTENT_KEY_CATALOG`, `CHAT_ARRAY_KEYS` and the two drop markers in
`@langwatch/data-privacy-contract`). THE CENSUS UNDERCOUNTED IT: `dropKeyCatalog.ts` is 244 lines and inert on
its own — `TraceSpanContentDropPort.drop` cannot be answered without `applyOtlpSpanContentDrop.ts`'s 150, so
both moved. HOME FOLLOWS STEP (d) EXACTLY: the redaction slice put the OTLP-span service in
`data-privacy-server` and satisfied Trace's port from the composition root, because log and metric ingestion
owe the same answer when they convert; the drop is the same shape and got the same home. The CATALOG went to
the contract rather than the server, because it is already read by three consumers that are not the drop — the
LWQL content gate, the trace read path's dropped-category derivation, and the collector edge — and a key
list those disagree about is a key that survives a `drop`. The service split into the shape-independent policy
decisions and the OTLP-span walker, the same split step (d) made and for the same `service-quality` reason.
Twin pins: all 27 catalog keys in their own order, the chat-array set as exactly input+output, both marker
attribute names, the 20-key cap, and the comma-joined category order. Behaviour pins: the fail-OPEN path
(a policy that cannot be resolved keeps the content), the enforcement kill switch resolving NO policy at all,
and the role strip that has to run because canonicalisation re-derives `gen_ai.system_instructions` from a
system turn left in the conversation.

(3) THE evaluationTrigger SUBSCRIBER (`subscribers/evaluation-trigger.subscriber.ts`, `@langwatch/trace-server`).
OWNERSHIP WAS SURVEYED, NOT ASSUMED, AND TRACE WINS: the body names six trace things
(`defineOriginGuardedTraceSubscriber`, `TraceSummarySubscriber`, `TraceSummaryData`, `TraceProcessingEvent`,
`SYNTHETIC_TRACE_SPAN_NAMES`, `MAX_PROCESSED_SPANS`) against two evaluation things, it is registered on the
trace summary fold, and its two outside reads were already trace-server ports. A THIRD PORT WAS REQUIRED AND
IS NOT A PREFERENCE: `architecture-lint`'s `cross-feature` policy forbids a feature server from depending on
another feature's server package, and no feature server in the repo does. So `TraceEvaluationDispatchPort`
carries the two things Trace needs out of Evaluation — the payload type and `ExecuteEvaluationCommand.makeJobId`
— and `apps/worker` wires the real static in. That is the load-bearing half: the queue squashes a redelivery
against that key, a key spelled twice does not collide, and the same evaluation runs twice for one trace.
Pins: the loop guard's exact predicate (`depth >= 1`), the `langwatch.reserved.causality_depth` key nlpgo
stamps, every OTLP `AnyValue` encoding the depth can arrive in, the `ops_es_causality_loop_guard_disabled`
system flag, the 512-span processing cap, the 360,000 ms trace-level dedup TTL with `shouldSurviveDispatch`,
the `eval` KSUID prefix, and the reserved metadata prefixes. The redelivery contract test states the real
idempotency property: this subscriber remembers nothing, so redelivery is safe only while the command identity
IGNORES the freshly minted `evaluationId` — an identity unique per delivery would never deduplicate and the
customer would be billed twice.

TWENTY-THREE SABOTAGES, all red then restored, at least one per piece through the staged port. NOT MOUNTED:
`apps/worker/src/features/job-registry.json` and every `catalogue.json` are byte-identical, the application
still owns `RecordSpanCommand`'s adapters and still registers `evaluationTrigger`, and none of
`createWorkerTraceCostEnrichment`, `createWorkerTraceContentDrop` or `createWorkerTraceEvaluationTrigger` has
a production caller. Zero platform edits. `apps/worker` gained `@langwatch/evaluation-contract` and
`@langwatch/evaluation-server` (filtered install). Deployment impact: none until the conversion.

**What remains in the step-(g) census:** the conversion itself — the 21-field trace bundle, the 29 byte-frozen
keys, and mounting the staged compositions. ALL THREE named absences are now CLOSED: the customer-supplied
webhook transport for automation's graph half (below), the product-analytics sink and trace's half of the
tenant-broadcast producers (both below). **CORRECTED 2026-09-02 BY THE ATTEMPT ITSELF (below): this paragraph
undercounted twice.** `trace_processing` names 29 routing keys, not 28; and the census enumerated what the
subscribers DO without enumerating the pipeline definition they are registered into or the capability services
`recordSpan` asks, so "the conversion itself" turned out to be fourteen unrouted keys rather than a mounting
exercise. The halt record at the end of this section carries the per-key disposition, the clearing design and a
wave-order inversion. The collector edge
(`langwatch_edge_spool_fail_open_total`, `langwatch_edge_media_extract_fail_open_total`,
`edge-media-extraction`'s use of the drop catalog) stays excluded by name: it is apps/api's conversion, not
the worker's.

**Named absence closed (uncommitted at time of writing): the customer-supplied webhook transport.**
`WebhookDeliveryTransport` — declared by `@langwatch/automation-server`, consumed by
`WorkerAutomationNotificationDeliveryAdapter`, injected as the optional `webhookTransport` in
`apps/worker/src/app/worker-automation-graph.composition.ts` — is now satisfied by a real composition, and the
graph vertical DEFAULTS to it instead of refusing webhook alerts by name.

HOME: a new shared non-feature package, `@langwatch/egress` (`packages/egress`), NOT a feature server.
The decision is forced rather than preferred. This fence has three eventual consumers — the graph-alert
transport composed in `apps/worker` (OSS), the Enterprise webhook endpoints conversion in
`packages/enterprise/features/webhook/server`, and the Slack Web API transport, which already stands on
`sendHttpDestination` + `webhookUrlValidator` in the application. `architecture-lint`'s `cross-feature` policy
forbids a feature server package from depending on another feature's server package, so ANY feature home
(notification-server beside the mail capability, automation-server itself) is unreachable by the Enterprise
webhook server. A non-feature package under `packages/` is classified by nothing in `discoverClassifiedPackages`,
so it is reachable by all three and subject to no layout grammar; it follows the grammar anyway where a concept
really is one (`ports/*.port.ts` with an abstract class, `adapters/in-memory.*.adapter.ts`,
`services/*.service.ts`). The name is the ledger's own words for it — "shared egress policy rather than an
automation asset" — and covers the whole stack rather than one consumer: the address policy, the IP-pinned
fetch, and the webhook sender that stands on both. `@langwatch/ssrf` was NOT extended: it is a dependency-free
classification table shared byte-for-byte with `pkg/ssrf` in Go and held to one conformance corpus, and putting
undici, DNS and an HMAC signer in it would end that.

HARVESTED (1,526 application lines into 1,653 package lines across twelve modules, plus 1,226 lines of test):
`ssrfProtection.ts` (710) split into `ssrf/url-validator.ts` (the admission decision + DNS resolution) and
`ssrf/fenced-fetch.ts` (the IP-pinned fetch, redirect ladder and connection-error formatters);
`ssrfConstants.ts` (72) → `ssrf/blocked-hosts.ts`; `urlPolicy.ts` (128) → `webhook/url-policy.ts`;
`signature.ts` (123) → `webhook/signature.ts`; `dispatchBudget.ts` (48) → `webhook/dispatch-budget.ts` +
`ports/webhook-dispatch-rate-limiter.port.ts` + `adapters/in-memory.webhook-dispatch-rate-limiter.adapter.ts`
(the in-memory branch of the application's `rateLimit.ts`, fixed-window approximation and sweep included);
`httpDestination.ts` (203) → `webhook/http-destination.ts`; `sendWebhook.ts` (242) split into
`webhook/delivery-classification.ts` (the pure status verdict and the header names) and
`services/webhook-egress.service.ts` (the composed sender).

LEFT BEHIND FOR THE ENTERPRISE WEBHOOK CONVERSION, proved by reading consumers rather than assumed: the whole
of `destinations/` (`sqsWebhookDestination.ts` 491, `sqsQueueUrl.ts` 95, `types.ts` 80,
`httpWebhookDestination.ts` 65, `index.ts` 41 = 772 lines), `deliveryLog.ts` (58) and
`enterpriseWebhookEndpointService.ts` (56). Every one of them is reached only from
`~/runtime/app/features/webhooks` and names `PrismaClient`, `WebhookEndpointDelivery` or the AWS SDK;
`WebhookDeliveryTransport` reaches none of them. `httpWebhookDestination` is the only file in that set that
touches this slice, and only as a CALLER of `sendWebhook` — so the Enterprise conversion imports the packaged
sender rather than carrying a second one. THE SLACK TRANSPORT WAS NOT REWIRED: `WorkerSlackWebApiTransportAdapter`
is a plain fetch to two compiled-in `slack.com` constants with nothing customer-supplied in it, and the
application's `slackWebApi.ts` standing on the same fence is worth converging on WHEN Slack converts, not now.

FOUR DELIBERATE DIFFERENCES FROM THE FROZEN TWIN, all of them a package refusing to guess where the application
reads an environment variable at module scope. (1) `validateUrl` is REQUIRED on `sendHttpDestination`; the
application's is optional and falls back to a module-level validator built from `BLOCK_LOCAL_HTTP_CALLS`, which
a package has no way to build and no business defaulting. (2) The TLS answer is a required argument; the
application derives `rejectUnauthorized` from `IS_SAAS` at module load, and `apps/worker` passes
`config.deployment.saas`, the App's own reading of the same variable, so an on-prem receiver with a self-signed
certificate stays reachable from both graphs. (3) The dispatch counter is a port; the application reaches for
its app's Redis. (4) A redirect that the caller asked to FOLLOW without supplying a policy to re-judge the hop
is refused rather than taken — fail-closed, where the application re-judges through the weaker env-default
validator. The webhook path never reaches (4): it passes `followRedirects: false`, which is exactly why the
application refuses redirects on this channel in the first place.

PINS, all literals in the package's own tests rather than reads of the application's source. Admission: https
only, the default port only, a real host, never credentials — under BOTH escape-hatch states, because which
rules the hatch relaxes is the part that drifts. Addresses: ten IPv4 literals across loopback, RFC 1918, CGNAT,
TEST-NET, benchmarking, multicast and reserved; four IPv6; three metadata hosts by name plus five cloud-internal
suffixes; a hostname resolving into a private range; an allowlist that never reaches metadata. Redirects:
refused with the address the `Location` named never contacted, observed against a real local server through the
real fence. Budget: `webhook-dispatch:<scope>`, 3600 seconds, 1000 per hour, counted once per attempt, skipped
for a test fire, and `langwatch:ratelimit:` as the Redis key prefix both graphs share. Wire: `Content-Type:
application/json`, `X-LangWatch-Event-Id` by default with `X-LangWatch-Delivery-Id` for the batch channel,
`X-LangWatch-Delivery-Attempt`, `X-LangWatch-Test-Fire`, the reserved-header strip and the unresolved
`__kept__` marker never leaving the process. Budgets: 10,000 ms request deadline carried as both an
`AbortSignal` and socket-level bounds, 64 KiB response cap with the transfer torn down rather than drained, 200
characters per captured response header and 32 of them, 300 characters of the receiver's answer in an error.
Classification: 2xx success, 5xx/429/408 retryable carrying the receiver's `Retry-After`, everything else
terminal carrying none. SIGNATURE: pinned against `specs/webhooks/signature-vectors.json` directly — all five
signing vectors reproduced byte for byte and all twenty-one verification vectors answered — which is the
strongest pin in the slice, because that file is generated from the application's signer and is already what
the TypeScript and Python SDKs verify against.

TWO FAITHFUL-TWIN FINDINGS, recorded rather than silently hardened. (a) `new URL(...).hostname` keeps IPv6 in
brackets and `isIP` rejects the bracketed form, so a v6 literal never reaches the address classifier: the strict
policy refuses it as an unresolvable NAME (retryable) instead of a private address (terminal), and
`[fd00:ec2::254]` matches nothing on the metadata host list. The webhook layer closes it — `privateIpLiteral`
strips the brackets and refuses terminally before a send — so every customer-supplied destination is safe; a
caller that relaxes the address policy AND skips the webhook layer would not be, and nothing does that. Both
halves are pinned. (b) A graph-alert webhook automation cannot dispatch AT ALL today, in either graph:
`WebhookProviderAdapter.parseStored` uses a `.strict()` schema listing only the webhook keys, while the upsert
stores `{...webhookActionParams, ...graphAlert}` — so `threshold`, `operator`, `timePeriod` and `seriesName` ride
along and `GraphAlertDispatchService.sendWebhook` throws a `ZodError` before the transport is reached. Observed,
not inferred. It is `@langwatch/automation-server`'s bug, it predates this slice, the channel ships dark behind
a feature flag, and fixing it is not this slice's; it is why the capability test drives the delivery PORT rather
than a firing automation.

TWENTY-FOUR SABOTAGES, each red then restored, at least one per rule and every one driven through the port or
the staged composition: loopback admitted, private range admitted, metadata host admitted, cloud-internal domain
admitted, redirect followed, an unjudgeable redirect followed (the fail-closed rule), the dispatch cap removed,
the cap ceiling raised, the cap key drifted, the signature omitted, the signature over the wrong bytes, the
rotation window collapsed to one secret, the replay window widened, the verifier accepting anything, the
response cap removed, the request deadline dropped, a fence refusal reported as retryable, reserved customer
headers sent, the `__kept__` marker sent on the wire, a 3xx classified as delivered, the worker composing the
wrong TLS answer, the worker composing no shared counter, the graph composing no webhook transport, and the
delivery adapter ignoring the transport it was given. Two of them (the TLS answer, the graph's default wiring)
were GREEN on the first pass and are the reason two composition assertions exist at all.

NOT MOUNTED: `apps/worker/src/features/job-registry.json` and every `catalogue.json` are byte-identical, the
application still owns webhook dispatch, `tryCreateWorkerAutomationGraphComposition` still has no production
caller, and `createWorkerWebhookTransport` is reached only from it and from tests. Zero platform edits.
`apps/worker` gained `@langwatch/egress` (filtered install; 34 lines of lockfile are this slice's, the rest of
the hunk is another agent's uncommitted `apps/ui` and `analytics/web` manifests that the workspace install
recorded). DEPLOYMENT IMPACT: NONE, and no new configuration leaves — the transport composes from
`deployment.saas` (`IS_SAAS`) and the Redis the process already opens. `WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS`
deliberately did NOT come across: the automations channel never passes the escape hatch, only the Enterprise
endpoints platform does, so it belongs to that conversion.

**The last two named absences closed (uncommitted at time of writing): the product-analytics sink and trace's
tenant-broadcast producer.** Both were the ledger's own conditions on mounting step (g), and both are now real
compositions in `apps/worker`, staged the same way everything else in this wave is.

(1) THE PRODUCT-ANALYTICS SINK. `WorkerLoggedProductAnalyticsAdapter` is DELETED, not kept as a fallback, and
`WorkerPostHogProductAnalyticsAdapter` stands in its place — a vendor transport adapter in
`platform/infrastructure/`, the `WorkerTiktokenCounterAdapter` precedent, satisfying `TraceProductAnalyticsPort`
over `posthog-node` at the version the application already pins. THE SEMANTIC DECISION, and it retires this
ledger's own objection: key-absent → silent no-op IS parity. The objection was that a background no-op would
happen on the deployment that runs analytics while the application's happens only on deployments that chose not
to, and it held only while this process could not read the key at all. It now reads the same two leaves the
application reads, so both halves decide from the same input — a deployment that named no `POSTHOG_KEY` chose no
product analytics and neither half records; one that named a key gets a real capture from whichever graph owns
ingest. On THAT deployment a logged "delivery" is the undercount the objection was about, which is why the
logged adapter had to go rather than stay as a default. `createWorkerTraceNarrowPorts` now REQUIRES the sink
instead of defaulting one: the only thing it could default to is a sink that does not deliver, and a caller who
forgot to pass one would get silence indistinguishable from an unconfigured deployment. Flush is owned by the
composition's `ResourceScope` (`"worker product analytics"`), mirroring `shutdownPostHog` being called from the
App's graceful sequence in `start.ts` rather than from a signal handler of its own — the client batches, and the
one event this path emits is emitted at most once per project, so a dropped one is re-sent by nothing.
NEW CONFIG LEAVES: `POSTHOG_KEY` and `POSTHOG_HOST`, at the application's spelling and its parse
(`z.string().optional()` for both in `env-create.mjs`). `Config.value`, NOT `Config.secret`, on two counts: a
PostHog project key is write-only and already public (`apps/ui` serves it to the browser), and `Config.secret`
is `z.string().min(1)`, which would REFUSE `POSTHOG_KEY=` on an environment the application boots on. `host` has
no default here because it has none there — the App passes `env.POSTHOG_HOST` straight into the client, so an
unset variable means the vendor's own default on both sides and inventing one here would be a second answer to
which region the funnel lands in. Top-level `import`, not the tiktoken lazy one: `posthog-node` is a hard
dependency here and the application imports it top-level in the module this twins, whereas tiktoken's laziness
is load-bearing because tiktoken is optional at runtime and stays external to the production bundle.
PINS: the `first_trace_integrated` literal, `distinctId` = the org admin's user id (the contract that matters —
it is the distinct id `posthog-js` identifies the same person with in the browser, so a different key files the
milestone against somebody who is not in the funnel), the properties spread with `projectId` joining them rather
than replacing them and ABSENT entirely when the event names no project, key-absent and empty-key building no
client at all, one client across repeated records, the host passed through unmodified, a capture failure never
reaching the ingest path, and shutdown flushing. The failure log deliberately carries neither the user id nor
the customer's properties — the application logs nothing at all here, and this line says a milestone was lost,
not what it contained.

(2) TRACE'S TENANT-BROADCAST PRODUCER. SURVEY FINDING, and it shrank the work: trace's producer is not in the
application at all — both halves of it are already packaged as
`subscribers/trace-update-broadcast.subscriber.ts` and `subscribers/span-storage-broadcast.subscriber.ts`, and
what was missing was only the port. They named an ad-hoc structural `TraceBroadcastSink` interface, which a
converting process had nothing to compose against. `TraceTenantBroadcastPort`
(`ports/trace-tenant-broadcast.port.ts`) replaces it; `TraceBroadcastSink` is deleted rather than aliased. THE
ARGUMENTS STAY POSITIONAL on purpose, against house style: they are the application's own `broadcastToTenant`
signature argument for argument, which is what lets `BroadcastService` keep satisfying it structurally with zero
platform edits. `eventType` is narrowed to the one member Trace publishes, so Trace deliberately cannot reach
`simulation_updated` or the others. `apps/worker` answers it with `tryCreateWorkerTraceBroadcast`, a rename over
the packaged `RedisTenantBroadcastAdapter` composed by the existing `tryCreateWorkerTenantBroadcast` — one
publisher, so the wire format stays single.
PINS, read as BYTES through the port because both directions of drift are silent (an unknown channel is accepted
by Redis and delivered to nobody; a body missing a key the far side reads is dropped inside its own
`JSON.parse`): the channel literal `broadcast:trace_updated`, the envelope's exact key set
`{tenantId, event, timestamp}`, and each producer's own serialised payload —
`{"event":"trace_summary_updated","traceId":...}` for the fold and `{"event":"span_stored","traceId":...}` for
span storage. The far side is
`platform/app/src/server/app-layer/broadcast/broadcast.service.ts`, which type-checks against none of this.
WHAT STAYS: scenario's `simulation_updated` and langy's `langy_conversation_updated` producers are NOT this
slice. They are still the application's and stay there until those features convert, at which point each
declares its own narrow port over the same `tryCreateWorkerTenantBroadcast`. Said here so the next slice does not
read the closed absence as covering all three.
ONE PROPERTY IS DOUBLY GUARDED AND THE TEST SAYS SO: a failed publish is swallowed by the packaged adapter AND
again by each subscriber's own catch, so neither sabotage alone goes red. The test therefore asserts it at the
PORT as well as through the subscriber, which is the only assertion that can see the adapter stop absorbing.

EIGHTEEN SABOTAGES, each red then restored, every one driven through the port or the staged composition: the
channel prefix drifted, the envelope's `tenantId` dropped, the worker adapter hardcoding a different event type,
the span-stored payload drifting to the summary's, the adapter rethrowing a failed publish, `distinctId` drifting
off the org admin, `projectId` replacing the properties instead of joining them, `projectId` spread when absent,
`close()` no longer flushing, a key-absent deployment building a client anyway, an empty key treated as
configured, a default host invented, the event name rewritten, a capture failure escaping into the ingest path,
the failure log carrying the customer's properties, the config leaf reading the wrong variable, the narrow-ports
bundle dropping the sink it was handed, and the composition no longer owning the sink for flush. One
(the subscriber's own catch removed) was GREEN and is what produced the port-level assertion above.

NOT MOUNTED: `apps/worker/src/features/job-registry.json` and every `catalogue.json` are byte-identical, the
application still registers `projectMetadata`, `traceUpdateBroadcast` and `spanStorageBroadcast`, and neither
`createWorkerTraceProductAnalytics` nor `tryCreateWorkerTraceBroadcast` has a production caller. Zero platform
edits. `apps/worker` gained `posthog-node` (filtered install; the lockfile hunk is exactly three lines).
DEPLOYMENT IMPACT: none until the conversion. At that point `POSTHOG_KEY` and `POSTHOG_HOST` become
load-bearing for a standalone worker and must match the application's while both graphs ingest — two graphs
pointed at different PostHog projects split one funnel in two, and a worker holding no key on a deployment that
configured one undercounts it.

**Step (g) ATTEMPTED 2026-09-02 AND HALTED: the trace conversion is unmountable at zero platform insertions.**
Every staged composition is real and each one still does what its capability test proves. The conversion itself
cannot be made, and the reason is that the step-(g) census counted the RECORD-SPAN bodies and the SUBSCRIBER
effects and never counted two things the subscribers hang on: the PIPELINE DEFINITION they are registered into,
and the capability SERVICES the record command asks. Recorded here with the same standing as the reverted SaaS
`globalProjections` rider, because the failure shape is identical — the mapper would have to gain port-passing
lines, and a port-passing line is an insertion.

WHAT THE CONVERSION IS, stated exactly. `packagedWorkerCapabilities` maps one line —
`trace: { installer: TraceProcessingServerInstaller.create(capabilities.trace) }`
(`platform/app/src/runtime/worker/packaged-worker.capabilities.ts:170`) — and `capabilities.trace` is the
21-field bundle `PipelineRegistry` assembles at
`platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts:1345`. `trace` is a REQUIRED option on
`WorkerProductionCompositionBaseOptions` and `PackagedWorkerExecutableComposition` is its one production caller,
so deleting that line is a pure deletion only if `apps/worker` builds the whole installer itself. It is
all-or-nothing: `trace_processing` names 29 routing keys in the byte-frozen `job-registry.json`, and the queue
rejects an unroutable job for redelivery rather than dropping it.

FIFTEEN OF THE 29 KEYS ROUTE FROM THIS PROCESS TODAY. Eight commands (`addAnnotation`, `assignTopic`,
`bulkSyncAnnotations`, `changeTraceName`, `recordLogContribution`, `recordMetricCorrelation`, `removeAnnotation`,
`resolveOrigin`) come off `EventingTraceProcessingAdapter` and the packaged builder; `job:deferredOriginResolution`
and `reactor:originGate` are the installer's own; `reactor:traceUpdateBroadcast` and `reactor:spanStorageBroadcast`
are `tryCreateWorkerTraceBroadcast`; `reactor:experimentMetricsSync` is the `computeExperimentRunMetrics` proxy
`ExperimentWorkerFeatureInstaller` already publishes plus the packaged `ExperimentRunEventingIdLookup`;
`reactor:simulationMetricsSync` and `reactor:customEvaluationSync` are the `computeRunMetrics` and
`reportEvaluation` proxies Scenario's and Evaluation's installers publish. The three stores are reachable too —
`createAppTraceSummaryStore` is 60 lines of packaged imports over `TraceSummaryClickHouseRepository`, and
`TraceAnalyticsClickHouseRepository` and `TraceAnalyticsRollupClickHouseRepository` both take the
`TraceClickHouseWriteResolver` this graph already holds — as is `projectMetadata`'s `bootstrapTopicClustering`,
which is `claimAndBootstrap` on the packaged `TopicServerInstaller`'s own install result.

FOURTEEN DO NOT, IN FOUR GROUPS, AND THE FIRST TWO ARE THE HALT.

(1) THE PIPELINE DEFINITION ITSELF — four keys, and by construction all 29. `EventingTracePipelineAdapter.create`
takes `ioExtraction`, `mediaReferences`, `modelCosts` and `prepareEventForProjection`, and every implementation is
platform-only and was never in the census: `TraceIOExtractionService` (619 lines,
`~/server/app-layer/traces/trace-io-extraction.service`), `~/shared/traces/media-refs` (201),
`computeSpanCost` over `~/server/app-layer/traces/model-cost-matching` (36) and
`~/server/app-layer/traces/lean-for-projection` (343). On top of them sit the two composition modules that
actually register the 29 keys — `AppTraceProjectionsAdapter` (168) and `createTraceProcessingPipeline` (278),
both in `platform/app/src/runtime/app/`. Without those four collaborators `projection:traceSummary`,
`projection:traceAnalytics`, `handler:spanStorage` and `handler:traceAnalyticsRollup` cannot be built, and
without the two modules there is no definition to install at all. Steps (c)–(f) harvested what the projections
STORE; nothing harvested what they COMPUTE.

(2) `command:recordSpan`'s SERVICE CASCADE. The four staged record-time compositions each take a capability
service as a parameter, and not one of the six is constructed anywhere in `apps/worker` — `ProjectService`,
`MonitorService`, `ModelProviderService`, `FeatureFlagService`, `DataPrivacyService` and `AnalyticsService` are
`import type` in every file that names them. Composing them is not a wiring detail: `PrismaDataPrivacyAdapter`
requires `ProjectService` AND `OrganizationService`; `PostgresModelProviderAdapter` requires both of those plus
`AuthzService`, a catalog, a translation port, an id service, a credential codec, a token refresher and a
connection rate limiter; `PostgresMonitorAdapter` requires `EvaluatorService`; `PostgresProjectAdapter` requires
`OrganizationService` and a `ProjectCredentialsPort`. Only `FeatureFlagService` (a database, a cache, a config,
a clock) and `AnalyticsService` (`AnalyticsAdapter` over a ClickHouse resolver) compose from substrates this
process holds. THE NARROW PORTS DID NOT REMOVE THIS WALL, and it is worth saying plainly because step (f) reads
as if they did: `TraceProjectMetadataPort` narrows the TYPE to three methods, but
`createWorkerTraceNarrowPorts` still renames off a whole `ProjectService` instance, and nothing in this process
can produce one. So `command:recordSpan`, `reactor:evaluationTrigger` (`MonitorService`),
`reactor:projectMetadata` (`ProjectService`) and `subscriber:graphTriggerActivity` (`ProjectService` +
`AnalyticsService`) are all blocked on shared prerequisite (1) of the worker blocker graph. Field 9 is cleared as
a PORT and is not cleared as a COMPOSITION; `worker-automation-graph.composition.ts` says so in its own header.

(3) THREE KEYS WITH NAMED, BOUNDED GAPS. `reactor:trackedEventSync` calls `recordTrackedEventSpan`
(`~/server/app-layer/events/track-event.service`, 102 lines), which builds the span and then dispatches it
through `getApp()` (line 69) — the universal App singleton, the one import a package may not have.
`subscriber:codingAgentSpanFactsDispatch` needs
`CodingAgentTraceProcessingPort.tryGetNormalizedSpan`, which is `findNormalizedSpanById` at line 983 of
`span-storage.clickhouse.repository.ts` — the READ half step (c) deliberately left behind and handed forward to
"whoever composes `CodingAgentTraceProcessingPort` at conversion time", which is this slice. `job:datasetNormalize`
needs `DatasetNormalizationService` from `@langwatch/dataset-server` over a `DatasetContentRepository` and a
per-project `DatasetStorageResolver`; that one is reachable and merely unbuilt.

(4) THREE KEYS THAT BELONG TO CONVERSIONS THAT HAVE NOT HAPPENED. `reactor:triggerMatch` is blocked three ways —
`AutomationService.getActiveTraceTriggersForProject` behind `TraceAlertTriggerPort`, the automation pipeline's
`recordTriggerMatch` command (`AutomationWorkerFeatureInstaller` publishes no command proxies at all), and
`AppGovernanceSubscriberAdapter`'s runtime. `reactor:governanceKpisSync` and `reactor:governanceOcsfEventsSync`
are composed from `AppGovernanceSubscriberRuntime`, a private class at `pipelineRegistry.ts:279` fed by two
`PipelineRegistryDeps` repositories.

THE CLEARING DESIGN, in the order the evidence puts it.
(g1) HARVEST THE PROJECTION RUNTIME'S FOUR COLLABORATORS, homes surveyed rather than assumed. **LANDED
2026-09-02 — full record after (g1) below; three homes confirmed, `leanForProjection`'s corrected by a split,
and scenario's cost-matching blocker corrected rather than cleared.**
`TraceIOExtractionService` goes to `@langwatch/trace-server` behind the `TraceIoExtractionPort` it already
answers. `media-refs` goes to `@langwatch/trace-contract`, not the server, on step (g) item 2's own catalog
reasoning: the serialised column is read by the trace read path and by `trace-list.service` as well as by the
projection, and a format two readers disagree about is a media reference that resolves to nothing.
`computeSpanCost`/`model-cost-matching` goes to `@langwatch/trace-server` behind the fold-time
`TraceModelCostPort` — and this is ONE move that clears TWO recorded blockers, because Scenario's
`deriveScenarioRoleMetrics` is the same per-project matching and the ledger already schedules it as "move
span-cost matching into trace-server behind a ScenarioRoleMetricsPort". `leanForProjection` is projection-payload
policy shared by two graphs (`eventing`'s `replayExecutor` re-runs it at materialization and
`resolve-offloaded-traces` reverses it), so it belongs beside the offload contract rather than inside Trace.
Then `AppTraceProjectionsAdapter` and `createTraceProcessingPipeline` become one
`WorkerTraceProcessingPipeline` in `apps/worker` with no platform import left, staged and capability-tested like
everything else in this wave.
**(g1) LANDED 2026-09-02 (uncommitted at time of writing): the projection runtime's four collaborators are
package code and the pipeline definition composes in `apps/worker`.** Staged, not mounted: `job-registry.json`
and every `catalogue.json` are byte-identical, the application still assembles `capabilities.trace` and still
registers all 29 keys, and `WorkerTraceProcessingPipeline` has no caller in this process but its own tests —
which a test asserts by walking `apps/worker/src` rather than by saying so. Zero platform edits.

HOMES SURVEYED, NOT ASSUMED: three confirmed, one corrected by a split, one that shrank to nothing.

(1) `TraceIOExtractionService` → `@langwatch/trace-server` (`services/trace-io-extraction.service.ts`, 619
lines plus a twin header). CONFIRMED and cheaper than it reads: the whole file names four imports —
`@opentelemetry/api`, `getLangWatchTracer` from `langwatch`, and `ATTR_KEYS`/`TraceCanonicalisationService`
from the contract — and trace-server already depends on all of them and already opens tracer spans in three
other modules. No new dependency. `TraceIoExtractionAdapter` answers the port that was already declared, doing
the same `extract*` → `tryExtract*` rename the application's own adapter does.

(2) `media-refs` → `@langwatch/trace-contract`. HOME CONFIRMED, WORK BIGGER THAN THE CENSUS SAID. The 201-line
format module is only half of it: `collectMediaRefs` stands on `collectAnnotatedMediaParts`, the 451-line
media WALK in `~/shared/traces/mediaParts`, which stands on `media-markers` (42) and `pcmToWav` (183). The
format alone would have given a standalone worker a parser and no way to produce anything to parse, so the
walk came too — `trace-media-part.collector.ts`, plus `trace-media-markers.ts`, plus `trace-media-role.ts`
(the role vocabulary, its own module because the walk reads a role and the reference shape carries one, and
left in either file the two import each other in a cycle). The five RENDER-side helpers in that file
(`isSafeMediaUrl`, `parseNotCapturedMedia`, `mediaRefToMediaData`, `audioPartToMediaData`,
`collectAudioParts`) are reached by neither the walk nor reference collection and stay for the trace web
conversion.
THE ONE DELIBERATE DIFFERENCE, and the code decided it rather than a preference: `pcmToWav` did NOT come
across. The application wraps a raw, header-less realtime turn into a playable WAV before surfacing it, which
is byte work over `Buffer` and `atob`/`btoa` — and `@langwatch/trace-contract` is environment-neutral by
construction. Its tsconfig names `lib: ["es2022"]` and no runtime types, and not one of its sixty modules
reaches for either; the typecheck said so the moment the file landed. The packaged branch refuses a raw-PCM
part where the application wraps one, and the difference CANNOT be seen through the port: reference
collection admits only `/api/files/` addresses and a wrapped WAV is an inline `data:` source, so both copies
contribute exactly no reference for such a turn. Pinned as a test, not as a claim.

(3) `computeSpanCost` → `@langwatch/trace-server` behind `TraceModelCostPort`. CONFIRMED, AND THE MOVE SHRANK
TO NOTHING: the 36 lines are `estimateModelCost(input, getStaticModelCosts())`, and `getStaticModelCosts` is
`getStaticModelCostRates()` with a `projectId: ""` stamped on each rate — a field `estimateModelCost` never
reads. Both functions were already in `@langwatch/model-provider-contract`, so
`ModelCatalogTraceModelCostAdapter` is the `ModelCatalogCostEstimatorAdapter` shape coding-agent already uses.
THE SCENARIO BLOCKER IS CORRECTED, NOT CLOSED-BY-PORT. This ledger records scenario's third blocker as
"`deriveScenarioRoleMetrics` is the App's per-project span-cost matching, not the static-catalog trick" and
schedules "move span-cost matching into trace-server behind a `ScenarioRoleMetricsPort`". It IS the
static-catalog trick and no such port is needed. `TraceReadDerivationService`
(`platform/app/src/runtime/app/trace-read-derivation.adapter.ts:78`) builds its `SpanCostService` over
`computeSpanCost`, which reaches `getStaticModelCosts()` and no database at all; its own comment ("the app's
own model-price matching") is what the census read as per-project. Per-project, per-team and
per-organization override rules are read by RECORD-TIME enrichment (`getCustomLLMModelCosts` →
`OtlpSpanCostEnrichmentService`), a different pass, already harvested by step (g) item 1, and correctly still
needing Postgres. `deriveScenarioRoleMetricsFromSpans` is ALREADY this package's
(`services/scenario-role-metrics.rules.ts`) and takes a `SpanCostService`, which now composes from packages
anywhere. WHAT ACTUALLY REMAINS of that blocker is the SPAN READER — `getNormalizedSpansByTraceId` and the
per-fold-version memo around it — which is (g3)'s neighbourhood, not cost matching. No scenario package was
edited; its suite is unchanged (2 pre-existing datastore failures, 765 passing).

(4) `leanForProjection` "beside the offload contract" → CORRECTED BY A SPLIT, and the split is the design's
own reasoning applied to what the code shows. `@langwatch/eventing` cannot host the transform: it would need
the contract's event-type literals and this package's `TraceAttributeCap`, which is a cycle — and eventing
never READS the format, it only calls an injected function (`ReplayEventLean`,
`prepareEventForProjection`, which silently defaults to identity). What DOES have more readers than writers is
the OFFLOAD CONTRACT itself, and four places each carried their own copy of the same string:
`lean-for-projection.ts`, `trace-full-record.mapper.ts:12`, `trace-full-record.repository.ts:270` and
platform's `offloaded-eventref-parsing.ts`. A prefix one reader spells differently is an offloaded value that
resolves to nothing — the customer sees the 64 KB preview and is told nothing was truncated. So the CONTRACT
half (`EVENTREF_ATTR_PREFIX`, the `{field, eventId}` pointer and its codec, `COMMAND_INLINE_THRESHOLD`, which
`trace.constants.ts:249` already names in prose without defining) went to `@langwatch/trace-contract` as
`trace-offload.contract.ts`, and the two packaged readers now import it instead of retyping it. The POLICY
half — which keys earn the wide budget, how big it is, the structure-preserving preview, the transform — went
to `@langwatch/trace-server` as `services/trace-projection-lean.service.ts`, beside the `TraceAttributeCap` it
stands on, with `leanReplayEvent` in `adapters/eventing.trace-projection-lean.adapter.ts` because it alone
needs `@langwatch/eventing/server`.

(5) `AppTraceProjectionsAdapter` (168) + `createTraceProcessingPipeline` (278) → ONE
`WorkerTraceProcessingPipeline` in `apps/worker/src/app/worker-trace-processing-pipeline.composition.ts`, with
no platform import and no new dependency — `@langwatch/trace-server`, `@langwatch/trace-contract`,
`@langwatch/automation-server` and `@langwatch/eventing` were all already there, so the lockfile carries not
one line of this slice. A SIXTH COLLABORATOR WAS MISSING FROM THE CENSUS AND IS HARVESTED TOO:
`AppTraceSpanNormalizationAdapter`, a port rename over the already-packaged
`SpanNormalizationPipelineService`. Without it the pipeline still could not be built from packages, and a
rename is the last thing that should keep a process from composing its own definition.

WHAT THE STAGED PIPELINE PROVES AND WHAT IT AWAITS. It registers 27 of the 29 byte-frozen routing keys, read
from `job-registry.json` rather than restated, and a test asserts the two it does not are exactly
`job:deferredOriginResolution` (the installer's own) and `job:datasetNormalize` ((g7)'s) — a subtraction
cannot hide a key that quietly stopped registering. It registers nothing the registry does not list. The two
EE governance rollups stay unregistered when nobody supplies them, which is asserted rather than assumed. What
it awaits is (g2): `recordSpanCommand` and the fifteen subscriber handlers are still parameters, because
`command:recordSpan`'s service cascade needs `ProjectService` and, through it, `DataPrivacyService` and
`ModelProviderService`, plus `MonitorService` and `AnalyticsService`. **CLOSED 2026-09-02 by (g3)–(g7): the
sixteen parameters are composed, and the "the staged pipeline is not mounted" scenario this paragraph describes
was inverted to the mounted form rather than deleted.**

PINS, all literals in the packages' own tests rather than reads of the application's source. Media: both
reserved attribute names, the exact serialised JSON for a two-reference list including key order and role, the
cap of 4, prepend/append precedence with url-identity dedup, the assistant-only-on-output side rule with
roleless media reachable from both sides, and four refusals on the way back in (external address, `..`
traversal, unlisted kind, unknown role degrading to no role rather than hiding the reference). Offload:
`langwatch.reserved.eventref.`, `{"field":…,"eventId":…}` byte for byte on both the span-attribute and the
log-body path, `IO_PREVIEW_BYTES` = 64 KiB and `COMMAND_INLINE_THRESHOLD` = 256 KiB, the four IO keys, and the
preview being budget PLUS the ellipsis the byte cut appends — which is the twin's real arithmetic and was
wrong in the first draft of the test. Cost: the FOLD-TIME order, `gen_ai.response.model` before
`gen_ai.request.model`, asserted as a price difference rather than an array; record-time reads the request
model first and the two orders are deliberate. Also the customer's own `langwatch.model.inputCostPerToken`
winning over the catalog, and an unpublished model costing nothing rather than a guess. Extraction: the GenAI
convention before the LangWatch attribute on both sides, each with its own reported `source`, and the
stringified fallback answering only where the rich pass found nothing.

TWENTY-SIX SABOTAGES, each red then restored, every one driven through a port or the staged composition. Media
format: the reserved attribute name drifted, the url policy admitting an external address, the cap raised, the
assistant's reply landing on the input strip too, merge precedence ignored. Extraction: the LangWatch
attribute preferred over the GenAI convention, the output side reading the input key, the fallback shadowing a
real semantic match. Cost: matched from the request model first, the adapter dropping the customer's rates.
Offload: the pointer losing its `eventId`, the prefix leaving the reserved namespace, the lean mutating the
event it was handed, an over-budget attribute earning no pointer, the wide budget no longer covering the GenAI
message keys, the log body leaned without its pointer. Composition: the pipeline wired inert, the pipeline
named something the queue does not route, a subscriber registration dropped, the governance rollups mounted as
absent, the origin gate registered under the installer's job name, the staged pipeline mounted by the
production composition, and the four collaborators each replaced by a do-nothing stand-in.
THREE OF THOSE CAME BACK GREEN ON THE FIRST PASS and are the reason three assertions exist — the S6-egress
lesson again. Handing the pipeline a media port that collects nothing, a cost port that prices everything at
zero, or an extraction port that finds no input or output left the DEFINITION structurally identical, so every
registration assertion stayed green while a trace lost its thumbnails, appeared free, and showed `<empty>` in
the list. The composition test now folds a real span through the built `traceSummary` projection and asserts
the computed IO, the serialised media reference and a non-zero cost.

TWO SERVICE-QUALITY CEILINGS RECORDED, deliberately and with a shelf life:
`services/trace-io-extraction.service.ts` (636 lines, longest method 90) and
`services/trace-projection-lean.service.ts` (longest method 98) are frozen twins that cannot be split while
the application holds the other copy — splitting one side is exactly the silent drift the twin discipline
exists to prevent. Both are entries in `service-quality-baseline.json`, which may only shrink, and both should
be split and the entries removed at the conversion, when platform's copies go. FOUR
`fallible-result-naming` findings are left standing rather than baselined: `extractFirstInput`,
`extractLastOutput`, `extractRichIOFromSpan` and `extractFallbackIOFromSpan` expose absence without the `try`
prefix on the harvested twin, and the repo's own answer to that is already in place — the PORT is
`tryExtract*` and the adapter is the rename, exactly as the application's adapter does it. Renaming inside the
twin would make the diff between the two copies noisy precisely where drift review needs it quiet. ONE
inherited oxlint warning likewise stands: `no-useless-fallback-in-spread` on the log-record lean fires
identically on `platform/app/src/server/app-layer/traces/lean-for-projection.ts:324`.

GATES, measured before and after. `pnpm test:unit run src/runtime/worker` 8 files / 42 tests, unchanged.
`@langwatch/worker` 41/337 → 42/348. `@langwatch/trace-server` 94/1576 → 95/1590.
`@langwatch/trace-contract` 18/310 → 19/322. `@langwatch/scenario-server` unchanged at 58 passed / 2
pre-existing datastore failures, 765 tests. architecture-lint 21 files / 332 tests unchanged; CLI findings
817 → 821, and every one of the four is the `fallible-result-naming` class above (the 817 baseline is itself
805 plus twelve the concurrent UI-family move introduced). Whole-tree `pnpm typecheck` 14 errors in 11 files,
all in `platform/app`, identical before and after. `tsc --noEmit` clean for `@langwatch/trace-contract` (both
tsconfigs), `@langwatch/trace-server`, `@langwatch/architecture-lint` and `apps/worker` (both `tsconfig.json`
and `tsconfig.test.json`). `git diff --numstat -- platform/app` identical to the pre-slice baseline — the
fourteen entries there are the concurrent UI agent's evaluator/evaluation deletions, none of them this
slice's. `specs/trace-processing/worker-trace-projection-runtime.feature` reports 14/14 scenarios bound.
The lockfile's 76 changed lines are entirely the UI agent's `evaluator/web` and `monitor/web` manifests; this
slice installed nothing.

DEPLOYMENT IMPACT: NONE, and no new configuration leaves. Nothing is mounted, both graphs still compute
exactly what they computed, and no leaf became load-bearing. At the conversion the media-reference
serialisation, the eventref pointer and the fold-time cost order become shared wire contracts between the two
graphs while both ingest — which is why all three are pinned as literals here rather than as reads of the
application's source.

(g2) THE ProjectService WAVE, WHICH NOW PRECEDES TRACE RATHER THAN FOLLOWING IT. **LANDED 2026-09-02 — full
record after (g2) below. The wave turned out to be eight method calls rather than five services: the reach
census found `OrganizationService`, `AuthzService`, `EvaluatorService`, the LWQL key map and the S3 deleter
all DEAD on the ingestion path, and `command:recordSpan` now composes whole in `apps/worker`.** This is the
correction that
matters most and it inverts a recorded order. The blocker graph's wave order reads
`mail+join-request → Trace → scenario/evaluation → ProjectService wave`; the evidence above says Trace needs
`ProjectService` three ways directly and two more transitively (`DataPrivacyService` and `ModelProviderService`
both require it), so the wave order is `mail+join-request → ProjectService wave → Trace`. Nothing about
`ProjectService` changes — it still needs organizations, the LWQL ClickHouse key-map and S3 stored-objects — but
it stops being a prerequisite of four conversions and becomes a prerequisite of five.
**(g2) LANDED 2026-09-02 (uncommitted at time of writing): the recordSpan service cascade is worker-composable,
and the cascade was mostly not there.** `apps/worker` now composes `command:recordSpan` WHOLE — the four
record-time ports and the command over them — from the one Prisma client, this deployment's own variables and
the stored-object runtime it already held. Staged, not mounted: `job-registry.json` and every `catalogue.json`
are byte-identical, the application still assembles `capabilities.trace`, still builds all six capability
services and still records every span, and a test asserts by walking `apps/worker/src` that the new
compositions have no production caller but each other. Zero platform edits.

THE REACH CENSUS, which is what the halt was missing and what turned a five-service wave into eight method
calls. The halt recorded the CONSTRUCTORS. Nobody had counted the CALLS.

| service | what the record path calls | where | collaborators the constructor demanded that this path never reaches |
| --- | --- | --- | --- |
| `ProjectService` | `tryGetById`, `updateMetadata`, `resolveOrgAdmin` | `worker-trace-narrow-ports.composition.ts:87-103` | `ProjectCredentialsPort`, `OrganizationService`, `ProjectKeyMapPort`, `ProjectStoredObjectsPort` |
| `ProjectService` (via privacy) | `getWithTeam` | `data-privacy.service.ts:52` | the same four |
| `ProjectService` (via costs) | `tryGetWithTeam` | `model-provider-scope.service.ts` `tryGetProjectScopes` | the same four |
| `ProjectService` (via graph) | `tryGetById` | `graph-trigger-alert-delivery.service.ts:46` | the same four |
| `DataPrivacyService` | `getResolvedForProject` | `otlp-span-content-drop.service.ts:82`, `pii-redaction-policy.service.ts:201` | `OrganizationService` |
| `ModelProviderService` | `listCosts` | `worker-trace-narrow-ports.composition.ts` `WorkerTraceModelCostCatalogAdapter` | `OrganizationService`, `AuthzService`, catalog, translation port, id service, credential codec, Codex token refresher, connection rate limiter |
| `MonitorService` | `getEnabledOnMessageMonitors` | `worker-trace-narrow-ports.composition.ts` `WorkerTraceEvaluationMonitorAdapter` | `EvaluatorService`, the id generator |
| `AnalyticsService` | `getTimeseries` | `graph-trigger-series-evaluation.service.ts:61` | — (never a wall) |

EIGHT OPERATIONS OVER FOUR PRISMA MODELS. Every one of them is a repository read or a repository write plus, in
two cases, a cache and a shape. THE FOUR SUPPOSED PREREQUISITES ARE ALL DEAD ON THIS PATH, and each answers a
question the blocker graph asked:

- **`OrganizationService` is not needed anywhere.** `ProjectService` reaches it in `ensureInternal`
  (`getOldestTeamId`) and `create` (`createTeam`, `addTeamMember`); `DataPrivacyService` reaches it in
  `resolveOrganizationId`, a private helper of `setForScope`/`removeForScope`; `ModelProviderScopeService`
  reaches it in `getProjectContext`, `getOrganizationIdForScope` and `listAvailableScopes`. Ingestion creates
  no project, writes no policy and authors no cost.
- **The LWQL ClickHouse key-map is `ProjectKeyMapPort.syncProject({projectId, lwqlKey})`, and it is called in
  exactly one place: `ProjectService.create` (`project.service.ts:298`).** It is already an OPTIONAL
  constructor argument. The trace path never creates a project, so it is not in this wave's scope and is not in
  the conversion's either — it belongs to whichever process serves project creation.
- **S3 stored-objects is `ProjectStoredObjectsPort.deleteOwnedBy`, called only in `ProjectService.archive`
  (`project.service.ts:365`), also already optional.** Same disposition.
- **`AuthzService` inside `PostgresModelProviderAdapter` is dead on this path**, as every prior wave predicted.
  `listCosts` → `ModelProviderCostsService.list` → `scopes.tryGetProjectScopes` + `costs.listForProject`. No
  authorization decision is made, and correctly so: the reader is already inside the tenant whose rules it is
  reading. The same is true of `EvaluatorService` inside `PostgresMonitorAdapter` —
  `getEnabledOnMessageMonitors` is `repository.findEnabledOnMessage` and names no evaluator.

SO THE WAVE IS NOT "COMPOSE ProjectService". It is: each of the four features publishes the READ half its
ingestion callers use, beside the wide adapter its write half needs. REUSED RATHER THAN INVENTED — the pattern
was already in this repo, in this package: `PostgresCodingAgentActivityAdapter`
(`packages/features/project/server/src/adapters/postgres.coding-agent-activity.adapter.ts`) is the same seam
for the coding-agent fold, with the same header reasoning ("Reaching those through `ProjectService` meant
composing the App"). ONE DELIBERATE DIFFERENCE FROM THAT PRECEDENT: it is a frozen TWIN — a second repository
with a `CODING_AGENT_ACTIVITY_TOUCH_MS` comment pinning it to the service's copy. These four are DELEGATIONS,
not twins. The wide service composes the narrow one and calls it, so there is one implementation of
`resolveOrgAdmin`'s swallow, one of the privacy chain's fact mapping and one of the cost scope triple. A twin
is the right price across the platform boundary and the wrong one inside a package.

WHAT LANDED, five verticals, each with the wide adapter's signature untouched so the application compiles
unchanged:

1. `ProjectMetadataService` + `PostgresProjectMetadataAdapter` (`@langwatch/project-server`). Five operations
   over `Pick<PrismaClient, "project" | "team">`. `ProjectService` delegates all five.
   `PrismaProjectRepository`'s constructor was narrowed from `PrismaClient` to that same `Pick`, which is a
   widening for callers — a full client still satisfies it.
2. `DataPrivacyResolutionService` + `PrismaDataPrivacyResolutionAdapter` (`@langwatch/data-privacy-server`),
   with `DataPrivacyProjectPort` (`getWithTeam`) and `DataPrivacyResolutionPort` (`getResolvedForProject`) in
   `ports/data-privacy.port.ts`. `OtlpSpanContentDropService` and `PiiRedactionPolicyService` now name the
   resolution port instead of the whole service; `DataPrivacyService` satisfies it structurally and delegates.
   The two write methods keep the organization service and mean it.
3. `ModelCostCatalogService` + `PostgresModelCostCatalogAdapter` (`@langwatch/model-provider-server`), over
   `ModelCostProjectPort` (`tryGetWithTeam`, `getWithTeam`) and `ModelCostProjectScopePort`
   (`tryGetProjectScopes`). `ModelProviderScopeService` split along the line the code drew rather than a
   convenient one: `ModelProviderProjectScopeService` holds the four derivations that come off a project row,
   and the four that resolve a billing profile, list teams or page an organization's projects stayed. One of
   them — `tryGetOrganizationSystemReference` — was moved into the new service in a first pass and moved back,
   because it pages `listByOrganization` and putting it in the narrow half would have widened
   `ModelCostProjectPort` to carry a pagination read the cost listing never makes. The typecheck is what
   caught it.
4. `MonitorCatalogService` + `PostgresMonitorCatalogAdapter` (`@langwatch/monitor-server`). One operation over
   `Pick<PrismaClient, "monitor">`.
5. `AutomationProjectIdentityPort` (`@langwatch/automation-server`), the same narrowing this file already did
   for `AutomationGraphActivityPort` itself. `GraphTriggerEvaluationDeps.projects` and
   `PostgresAutomationGraphActivityAdapter.create`'s `projects` are now the one-method port.
   `WorkerAutomationGraphDependencies` is down from two capability services to one: `analytics` alone.

AND THE SIXTH THING, which the halt had already cleared as composable and which turns "the four services
compose" into "the command composes": `createWorkerFeatureFlags` builds `FeatureFlagService` from the Prisma
client, the queue's Redis (or none — the adapter's own memory tier is what the application falls back to when
Redis is down) and `resolveFeatureFlagConfig(source)`. NO NEW CONFIGURATION LEAF: the names are the flags'
own, one variable per flag plus `FEATURE_FLAG_FORCE_ENABLE`, all of them already read by the application. Two
of `recordSpan`'s four ports are behind kill switches, so without it a standalone worker would have kept
estimating and kept redacting after an operator threw one. `AnalyticsService` is deliberately NOT composed:
nothing on the record path reads it, only the graph subscriber does, and it arrives with the conversion.

WHAT THE STAGED COMPOSITION NOW PROVES. `createWorkerRecordSpanCommand({config, services, featureFlags,
spool?})` builds `RecordSpanCommand` whole, and a test FOLDS A REAL SPAN THROUGH IT: the recorded event carries
the customer's own input and output rates, keeps the content the customer did not ask to be dropped, loses the
content they did, and every project read on the way names the tenant on the command while the cost rules are
read under exactly that project's own three scopes. `WorkerTraceProcessingPipeline`'s `recordSpanCommand`
parameter is now satisfiable from this process; it stays a parameter because that composition owns the
DEFINITION, not the graph, exactly as the stores do.

PINS. The cost scope triple in `PROJECT`/`TEAM`/`ORGANIZATION` order and read as one `OR`. The privacy chain
read inside the project's OWN organization. `resolveOrgAdmin` answering an empty resolution and reporting to
diagnostics rather than failing the fold that asked. `listCosts` answering `[]` for a project that no longer
resolves, rather than raising and failing a span mid-flight. The flag force-enable honoured with no stored row.
And, for each of the four features, the wide service and the read half answering IDENTICALLY over the same
client — which is a delegation assertion, not a twin-drift one.

THIRTEEN SABOTAGES, each red then restored, every one driven through the port or the composed command. Project:
the read always absent, the metadata stamp silently dropped, the org-admin failure raised instead of reported,
the wide service keeping its own copy of the org-admin read. Monitor: the listing answering nothing. Cost:
every span priced at zero, the scopes narrowed to the project alone. Privacy: the chain resolved under another
organization, the policy cache re-reading on every span. Composition: the record command wired without its drop
port, the project port renaming the wrong read onto `tryGetById`, the flag overrides never reaching the
service, and the staged record path mounted by the production composition.
TWO OF THOSE CAME BACK GREEN ON THE FIRST PASS — the S6-egress lesson and g1's, a third time — and both are now
assertions. The privacy sabotage passed because the test's Prisma double answered every `dataPrivacyPolicy`
query with the same rows, so a policy chain resolved under ANOTHER TENANT'S organization was invisible: the
double now filters on `where.organizationId` the way the table does, and the drop scenario asserts every read
named this project's organization. The flag sabotage passed because the flag the test chose was already ON by
default in the registry, so it answered `true` whether or not the deployment's overrides ever reached the
service: it now uses `token-estimation-killswitch`, which is off by default, and asserts both the unset and the
force-enabled answers.

GATES, measured before and after. `pnpm test:unit run src/runtime/worker` 8 files / 42 tests, unchanged.
`@langwatch/worker` 42/348 → 45/365. `@langwatch/project-server` 8/124 → 9/128. `@langwatch/monitor-server`
5/58 → 6/60. `@langwatch/model-provider-server` 14/144 → 15/146. `@langwatch/data-privacy-server` 5/59 → 6/62.
`@langwatch/automation-server` 27/210 unchanged. `@langwatch/trace-server` 95/1590 unchanged — not one line of
it was touched. architecture-lint 21 files / 332 tests unchanged. Whole-tree `pnpm typecheck` 14 errors in 11
files, all in `platform/app`, identical before and after. `tsc --noEmit` clean for all five touched packages,
for `@langwatch/feature-flag-server`, and for `apps/worker` under both `tsconfig.json` and `tsconfig.test.json`.
`git diff --numstat -- platform/app` carries no entry of this slice's. Five new `.feature` files report
16/16, 4/4, 3/3, 2/2 and 2/2 scenarios bound.

DEPLOYMENT IMPACT: NONE, and no new configuration leaf. Nothing is mounted; the application still builds every
wide service and still records every span through them. The one thing that changed for the running system is
that four services now call a collaborator they compose themselves instead of inlining the same code, which is
a delegation with no behavioural difference and is pinned by the identical-answer tests above.

WHAT REMAINS BEFORE TRACE CAN CONVERT, unchanged by this slice except where noted: (g3) the one normalized-span
read, (g4) `recordTrackedEventSpan`'s `getApp()`, (g5) automation's `recordTriggerMatch` proxy and
`TraceAlertTriggerPort`, (g6) the EE governance subscriber runtime, (g7) `DatasetNormalizationService`. Plus
`AnalyticsService`, which is `AnalyticsAdapter` over the ClickHouse resolver this process holds and needs only
the package dependency the conversion will add. THE FOUR OTHER GATED CONVERSIONS ARE CORRECTED: the blocker
graph's shared prerequisite (1) said `ProjectService` gates langy-conversation (via `ApiKeyService`), scenario
(prefetcher), gateway-spend (debit graph) and part of automation. Each of those must now be re-surveyed the way
this one was, by counting CALLS rather than constructors — automation's graph half needed one method and got
it, and there is no reason to expect the other three to be shaped differently. What none of them needs is an
organization service, an LWQL key map or an S3 deleter on the ingestion path.

(g3) Harvest the ONE normalized-span read (`findNormalizedSpanById`, its windowed read and the stored-span
codec, which is already packaged) so `CodingAgentTraceProcessingPort` composes; it is ONE query out of the
1,970-line repository, not its whole read half.
(g4) Harvest `recordTrackedEventSpan` into `@langwatch/trace-server`. Its one reason for reaching `getApp()` is
`traceIngestion.collection.ingestNormalizedSpan`, and `TraceIngestionService` is already the package's own
(`services/trace-ingestion.service.ts:210`) — so the harvest is the 102-line span builder, not a new seam.
(g5) Give `AutomationWorkerFeatureInstaller` its `recordTriggerMatch` command proxy and declare Trace's
`TraceAlertTriggerPort` catalogue read as a narrow port over `AutomationService` — the same shape step (a) used
for `AutomationGraphActivityPort`, and it converts with automation's remaining half.
(g6) The EE governance subscriber runtime moves with the governance conversion; `reactor:governanceKpisSync` and
`reactor:governanceOcsfEventsSync` are optional in the definition today, so they are the only two of the fourteen
that could be honestly mounted as absent — and they must not be, because both keys are in the byte-frozen
registry and a definition that omits them stalls their work.
(g7) Compose `DatasetNormalizationService` in `apps/worker` over the stored-object runtime it already holds.

WHAT WAS DELIBERATELY NOT DONE. No platform line was added, deleted or moved; no `apps/worker` line was written
against a service this process cannot build; `job-registry.json` and every `catalogue.json` are byte-identical.
Mounting the fifteen reachable keys and leaving fourteen unrouted was rejected outright: it is precisely the
failure every refusal in `worker-production.composition.ts` exists to prevent — the pods stay up, the liveness
probe answers, and fourteen kinds of trace work redeliver forever.

DEPLOYMENT IMPACT: NONE. Nothing mounted, so nothing changed for either graph, and no configuration leaf became
load-bearing. The leaves steps (a)–(f) and the two closed absences introduced —
`AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`, `TIKTOKENS_PATH`, `TIKTOKEN_FETCH_TIMEOUT_MS`, `POSTHOG_KEY`,
`POSTHOG_HOST`, `GOOGLE_APPLICATION_CREDENTIALS`, `LANGWATCH_DISABLE_GOOGLE_DLP`, `LANGEVALS_ENDPOINT`,
`LANGWATCH_DATA_PRIVACY_ENFORCEMENT`, the mail block behind `BASE_HOST`, `NEXTAUTH_SECRET` and
`CREDENTIALS_SECRET` — stay inert and become load-bearing at the conversion, not before. Gates measured
unchanged: `pnpm test:unit run src/runtime/worker` 8 files / 42 tests, `@langwatch/worker` 41 files / 337 tests,
`@langwatch/trace-server` 94 files / 1576 tests, architecture-lint 21 files / 332 tests with 805 CLI findings,
`apps/worker` clean under both `tsconfig.json` and `tsconfig.test.json`.

**(g3)–(g7) AND THE TRACE CONVERSION ITSELF. LANDED 2026-09-02 (uncommitted at time of writing): `apps/worker`
mounts all 29 byte-frozen `trace_processing` keys, with NO named absence. `recordSpanCommand` and the fifteen
subscriber handlers stopped being parameters; `WorkerTraceProcessingPipeline.create(...)` composes them from the
substrates this process already holds, and `worker-production.composition.ts` is the caller.**

```
 apps/worker/src/app/worker-production.composition.ts
   └─ WorkerTraceProcessingPipeline.create({ config, services, stores, commands, … })
        ├─ command:recordSpan          composed whole            (g2)
        ├─ codingAgentSpanFactsDispatch ── CodingAgentTraceProcessingPort   (g3)
        ├─ reactor:trackedEventSync    ── TrackedEventSpanService           (g4)
        ├─ reactor:triggerMatch        ── TraceAlertTriggerPort trio        (g5)
        ├─ reactor:governanceKpisSync  ── EE specs built at the root        (g6)
        ├─ reactor:governanceOcsfEventsSync                                 (g6)
        └─ job:datasetNormalize        ── DatasetNormalizationService       (g7)
```

WHAT EACH GROUP TURNED OUT TO BE.

(g3) One query, as priced. `findNormalizedSpanById` joined `TraceSpanStorageClickHouseRepository` with its own
`DERIVATION_SPAN_SELECT` and a single-span settings block; `ClickHouseTraceStoredSpanReaderAdapter` reads it
through the existing windowed read (`fallback: "none"`, the default partition window), and
`WorkerCodingAgentTraceProcessingAdapter` pairs it with the packaged normalization pipeline to satisfy
`CodingAgentTraceProcessingPort`. Nine read tests were added beside the repository's existing ones — window
bounds, the key triple, no nested columns, the lazy-materialization setting, a miss costing exactly one probe,
and a tenantless read refused.

(g4) The builder harvested, and the harvest FORCED A SPLIT that was better than the priced one.
`TrackedEventSpanService` needs `ingestNormalizedSpan` and nothing else, but `TraceIngestionService.create`
takes five collaborators — so composing it here would have meant handing it two arguments provably unreachable
on this path. `TraceSpanCollectionService` was extracted instead (dedup + the one command handoff, moved
verbatim), `TraceIngestionService` builds it internally and delegates, and the worker composes only the
collection. The Redis span-dedup adapter is a frozen twin of the application's: same `span_dedup:` prefix, same
60s/3600s TTLs, because while both graphs ingest either may claim the same span.

(g5) Three narrow ports rather than one, because the two features disagree on shape.
`AutomationTraceTriggerCataloguePort` (over `PrismaTriggerRepository` + `ActiveTriggerCacheService`) answers the
catalogue read; a match recorder adapter carries the round trip back into Automation's enums; and the origin
guard is the packaged `passesTraceOriginGuards` rather than a second copy. That guard is what stops a
topic-clustering re-emit over historical traces re-firing every alert a customer ever configured, and it is
pinned by a test.

(g6) MOUNTED, NOT DECLARED ABSENT. The halt record said these two were the only keys that could honestly be
absent and must not be, and that holds: `createWorkerGovernanceRollups` builds both subscriber specs — window,
predicate and handler — at the composition root and hands them to the OSS pipeline as data, so the pipeline
still imports no `@ee`. The throttle window is the governance package's own constant, not a number chosen here;
spelled differently on either side it would double a customer's reported spend while both graphs ingest.

(g7) `DatasetNormalizationService` composed over a stored-object runtime this process now builds for itself.
The production graph supplies no `infrastructure`, so `WorkerProductionComposition` opens its own AWS and
stored-object runtime — needed by the ADR-022 spool as well — and that surfaced a real BYOC gap: per-organization
`DATAPLANE_S3__<label>__<orgId>` routing had no worker config leaf. `storage.dataplaneS3` is that leaf.

HOW THE CONVERSION IS PROVEN. `worker-trace-processing-mount.composition.unit.test.ts` builds the real pipeline
over substrate doubles and DRIVES REGISTERED SUBSCRIBERS the way the dispatcher does — `shouldDispatch` first,
then `handle` — asserting the effect at the far end: a durable match through Automation's recorder, an
evaluation through Evaluation's command with Evaluation's own slug rule, a minted tracked-event span back
through `recordSpan`, a project's clustering through Topic's bootstrap with the milestone against the org admin,
scenario and experiment metrics through their owning commands, and the frozen registry read back from
`job-registry.json`. Seven sabotages were run and all seven went red: the tracked-event handler detached, the
topic bootstrap dropped, the slug rule replaced, the governance registration skipped, the trigger-match handler
detached, the tracked-event command never connected, and the origin guard removed. The staged slice's "no
production caller reaches this composition" assertion was INVERTED rather than deleted — a test that kept
asserting the staged shape would have gone red on the change it was written to guard.

Specs: `specs/trace-processing/worker-trace-pipeline-conversion.feature` (new, eight `@unit` scenarios, each
bound by a `@scenario` annotation), and `worker-trace-projection-runtime.feature`'s final scenario rewritten
from "the staged pipeline is not mounted" to the mounted form.

PLATFORM: one file touched, `runtime/worker/packaged-worker.capabilities.ts`, losing the trace installer import
and its registration — `git diff --numstat` reports 0 insertions / 2 deletions, and 0 insertions across the whole
of `platform/app`.

Gates measured: `@langwatch/worker` 46 files / 373 tests, clean under `tsconfig.test.json`;
`@langwatch/trace-server` 1598 tests across 95 files, clean under its tsconfig, with two `.integration.test.ts`
files failing to LOAD on a `~/server/clickhouse/goose` platform alias — both untouched by this slice and failing
the same way before it. `platform/app`'s `src/runtime/worker` parity suite was green at 8 files / 42 tests after
the conversion (188/188 routing keys, which is the strongest oracle available for the mount) and is now blocked
in the shared worktree by a concurrent lane's 1,080 in-flight `platform/app` deletions —
`src/utils/constants.ts` and `src/server/filters/precondition-matchers.ts` among them. That red is that lane's,
not this one's, and restoring 1,080 files to re-measure would have raced its work.

DEPLOYMENT IMPACT: THIS IS THE MOUNT, so every leaf steps (a)–(g2) introduced becomes load-bearing for a
worker process that runs the trace pipeline, plus one new leaf: `TRACE_SPAN_PROCESSING_SHARDS`
(`processing.traceSpanShards`) and the `DATAPLANE_S3__<label>__<orgId>` group behind `storage.dataplaneS3`.
A process with trace consumers enabled now REFUSES TO BOOT unless automation, evaluation and scenario producers
are present — `requireTraceProducers` — because a mounted pipeline whose commands dispatch nowhere is the exact
failure the absence discipline exists to prevent.


**(h) THE FOUR REMAINING SYNTHESIZED WRAPPERS. ALL FOUR CONVERTED 2026-09-02 (uncommitted at time of
writing).** The method is the trace conversion's, applied verbatim: count the CALLS the pipeline's
own handlers make, not the constructors its published services demand; reuse the (g2) read-half
services and the trace ports; and where a collaborator is platform-only, move its service into the
owning server package rather than declare a narrow port per collaborator.

**LANGY-CONVERSATION: 24 of 24 keys mounted.** `EventingLangyConversationAdapter` was already the
worker-facing capability the installer declares, so the conversion was composing its eleven
collaborators. `PostgresLangyAdapter.create({database}).eventing()` answers five of them from one
Prisma client (both operational folds, the per-message projection, the turn-admission ledger and the
trusted transcript reader); `LangyTokenBuffer` and `LangyTurnHandoffStore` take the queue's own
Redis; the broadcast is the shared `RedisTenantBroadcastAdapter` this process already composes for
Trace, renamed onto Langy's own positional port. `langy_conversation_updated` was already a member
of `TENANT_BROADCAST_EVENT_TYPES`, so no third publisher was written.

ONE PLATFORM MOVE: `AppLangyAnalyticsEventClickHouseAdapter` became
`ClickHouseLangyAnalyticsEventAdapter` in `@langwatch/langy-server`, with the vendor `ClickHouseClient`
import replaced by the structural `LangyAnalyticsClickHouseWriteClient` every other feature package
already uses. The platform file and its test are DELETED. Table name, all fifteen columns, the
`_retention_days` stamp and the two `wait_for_async_insert` settings are pinned by literal in the
worker's mount test, because that table compiles against nothing on either side: a column written
under another name is accepted and fills the real one with its default, and no reader can tell a
defaulted value from a written one.

THREE NAMED ABSENCES, all reported at boot through `WorkerLangyAbsenceReportPort`. (1) The agent
manager, absent when `OPENCODE_AGENT_URL` and `LANGY_INTERNAL_SECRET` are unset — carried as one
config leaf that refuses HALF a pair the way `resolveLangyWorkerConfig` does, because a URL without
a secret dispatches every turn unauthenticated. (2) Title generation: the generator resolves a model
through the whole `ModelProviderService` cascade, four methods over a service this process cannot
build yet, and a generator that invented a model would bill a customer's key against a provider they
did not choose. Absent, it LOGS the conversation it could not name and answers `null`, which is the
same no-op the App takes for an empty transcript — the product-analytics precedent, for the same
reason a silent null was rejected there. (3) The session-key mint, which is reached only on the
`428 credentialsRequired` recovery branch and needs an authorization graph (`effectivePermissions`,
`hasPermission`, `can`, `writeBindings`); it REFUSES BY NAME so the outbox retries and the liveness
subscriber terminalises the turn, rather than minting an unscoped key. THE RECORDED BLOCKERS WERE
BOTH OVERSTATED AND ARE CORRECTED: `ManagedProviderService` is a dead parameter on the title path
(`prepareLitellmParams` ignores it), and the mint needs `ProjectService.getWithTeam` alone — a
constructor demand, not a call. Two sabotages went red: a dropped admission-lifecycle subscriber and
a renamed ClickHouse column.

**SCENARIO: 16 of 16 keys mounted.** `SimulationProcessingPipelineAdapter` composes from the
substrates this process holds — the run-state fold over ClickHouse behind the shared
`simulation_runs` cache prefix, the metrics store, `FinishRunCommand` over this process's own event
store, and `ComputeRunMetricsCommand` over the trace summary fold the trace conversion already
composes. Suite's two commands come from `SuiteWorkerFeatureInstaller`'s existing proxies and the
snapshot broadcast from the one tenant publisher. THE `simulations` DEP IS INERT — the adapter never
reads it — and is passed rather than removed only because the field is the package's.

(g1)'S CORRECTION HELD, and it is what made this tractable: `deriveScenarioRoleMetrics` prices from
the STATIC catalog, so `ModelCatalogTraceModelCostAdapter` is the exact twin and no per-project cost
read is needed. What was missing was the all-spans read. `TraceDerivationSpanReaderPort`,
`TraceDerivationSpanClickHouseRepository` and `ScenarioRoleMetricsDerivationService` are new files in
`@langwatch/trace-server`; the platform's `TraceReadDerivationService.deriveScenarioRoleMetrics`, its
memo field and its `computeSpanCost` cost estimator are DELETED (`deriveEvents` is live and stays).
The read dedups in SQL with `argMax(..., UpdatedAt)` grouped by `SpanId` rather than `LIMIT 1 BY`:
`stored_spans` is a `ReplacingMergeTree`, a re-exported span sits as two physical rows until a merge,
and returning both would double that span's cost into its role's total.

ONE NAMED ABSENCE: the execution pool. `submit` refuses by name — which is what the intent's own
contract asks for, since a throw returns the run to the outbox with backoff and the stall wake is the
backstop — while `cancel` is REAL, on the same Redis channel a running child listens on, so a cancel
issued while another process holds the run still stops it. The pool is not a wiring gap: it runs the
scenario child process, and the prefetch that feeds it resolves the customer's agents, workflows and
secrets through platform runtimes. A pool wired to a prefetcher that could not answer would fail
every run at execution time instead of at boot.

A TYPE CORRECTION THAT IS LOAD-BEARING FOR EVERY REMAINING CONVERSION. `WorkerPipelineDefinition` was
`Parameters<register>[0]`, which resolves to the base `Event` and `NoCommands` — and a real
definition is generic in its feature's own discriminated union with a real command union, so
`prepareEventForProjection` (contravariant) and `_registeredCommands` both refused it. The
synthesized wrappers only ever passed `StaticPipelineDefinition<any, any, any>`, which is why nobody
had hit it. The capability interfaces now carry the event union as a parameter, and each installer
captures the registration as a CLOSURE in `create` so the class itself stays free of it — a class
generic in the union would make two instantiations mutually unassignable wherever the composition
root names one.

**GATEWAY-SPEND: 10 of 10 keys mounted** across `gateway_spend_processing` and
`governance_events_processing`, composed as one pair because the governance signals a spend decision
raises are dispatched by the spend graph itself. The spend fold rides the shared `gateway_spend`
cache prefix, the budgets are read through a new
`PostgresGatewayBudgetResolutionAdapter` in `@langwatch/gateway-server` — a `GatewayServiceContract`
subclass whose ONE real member is `resolveApplicableBudgets` over
`PrismaGatewayBudgetRepository`, with the other twenty-nine refusing by name, because the consuming
package (`packages/enterprise/composition/api`) is outside this lane and narrowing its parameter
would have been an edit there.

FOUR NAMED ABSENCES. The all-instance ClickHouse directory behind spend SETTLEMENT is the one the
brief anticipated: settlement sweeps every instance's usage, which needs a directory of endpoints no
single-tenant resolver can produce, and the sweeper is a SCHEDULE-ONLY process manager — it declares
no event types, so `ProcessRuntime.registerPipeline` registers no routing key for it and omitting it
costs zero keys. It is `withoutSpendSettlement()` rather than a silent skip. The other three are SQS
webhook destinations (HTTP is real through this process's own fenced sender; SQS refuses
terminally), webhook plan entitlements, and the endpoint secret key, which falls to
`UnconfiguredWebhookSecrets` when no cipher is configured rather than signing with a null key.

**AUTOMATION: 2 of 2 keys mounted** — `command:recordTriggerMatch` and
`subscriber:pm:triggerSettlement`. The pipeline was ALREADY packaged; `createAutomationsPipeline`
takes three collaborators and nothing else. What was not packaged was the settlement EXECUTOR behind
one of them, which named three whole capability services to reach ten methods, one method and four
methods respectively. Those are now `AutomationSettlementLedgerPort`,
`AutomationProjectIdentityPort` (reused from the graph half) and
`AutomationSettlementTraceReaderPort` / `AutomationSettlementEvaluationReaderPort`; the published
`AutomationService`, `ProjectService`, `TraceService` and `EvaluationService` all satisfy them
structurally, so the application's own composition passes exactly what it passed before.
`PostgresAutomationSettlementLedgerAdapter` answers all ten over one Prisma client, going through
`ActiveTriggerCacheService` rather than the repository directly — two caches over one table would
give one process two ideas of which automations are live.

THE TWO OTHER PROCESS MANAGERS REGISTER NO ROUTING KEY and still had to be composed for real. The
30-second graph-alert sweep and the webhook delivery-log prune are schedule-only, so they are absent
from the frozen registry — but they WAKE in this process, and refusing their collaborators would stop
a no-data alert firing and let the delivery log grow without bound. `GraphTriggerHeartbeatService`
and `PrismaWebhookDeliveryRepository.pruneExpired` are composed; the sweep's candidates evaluate
through the graph vertical this process already builds.

THE DEFAULT DIGEST WAS THE TRAP. `sendLegacyEmail` and `sendLegacySlackWebhook` read as legacy and
are the COMMON PATH: an automation only takes the rendered path once its author has written a custom
subject or body. Both were named refusals in the worker's delivery adapter, so a settlement half
mounted over them would have claimed the send, stamped the automation, and delivered nothing. The
Slack half is six lines onto `SlackWebhookDeliveryAdapter.deliver`, which was already packaged; the
mail half is a new `createElement` template beside `join-request-mail.adapter.ts`, reusing the
adapter's own per-recipient fan-out, no-reply envelope and unsubscribe footer.

TWO NEW TRACE READS, both new files in `@langwatch/trace-server`:
`findDerivedEventsByTraceId` on the derivation repository (an `ARRAY JOIN` outside the dedup, three
nested `Events.*` columns and never `SpanAttributes`) and `TraceEventDerivationService`, which
carries the per-fold-version memo so a coalesced batch reads a trace's events once rather than once
per settled match. `ClickHouseEvaluationRepository` gained an index export in
`@langwatch/evaluation-server` so the one evaluation read reuses that package's query — reaching it
through `EvaluationAdapter` would have meant synthesising an executor and a twenty-member workflow
capability this path never touches.

A PACKAGE BEHAVIOUR CHANGE, deliberate and named: `AutomationTraceRecordUnavailableError`. The
digest enriches a candidate the fold state already produced by reading the full trace record, and
`readTrace` previously rethrew everything but `TraceNotFoundError`. A process with no full-record
read would therefore have failed every digest. The new error is caught alongside `TraceNotFoundError`
and degrades to the synthetic fallback; a genuine ClickHouse failure still propagates, which is the
distinction the two error types exist to keep.

EIGHT NAMED ABSENCES through `WorkerAutomationSettlementAbsenceReportPort`. Legacy `filters` matching
and the `ADD_TO_DATASET` row mapping both live in WEB packages (`analytics/web`, `trace/web`) that a
background process must not import, and a second implementation of either would decide differently
from what the customer previewed — both refuse TERMINALLY, because returning `false` would look
exactly like an automation whose condition was not met. The full-record read, the annotation-queue
writer, runaway containment (the breach is still counted and logged; what is lost is the mail and the
auto-pause), the plan-resolved persist ceiling (the paid tier is used; the alternative was a warn per
dispatch on the way to the same number), graph-alert evaluation, and outbound delivery itself when
`BASE_HOST` is unset.

THREE NEW CONFIG LEAVES, under the application's own names because the ceiling is a FLEET fact:
`TRIGGER_PERSIST_DAILY_CAP_FREE`, `_PAID` and `_ENTERPRISE`.

Four sabotages went red: a renamed settlement process manager (key parity), settlement handed the
refusing transports (the digest test), the unavailable-record error degraded to a plain `Error`
(the reads test), and the events memo removed (the single-flight test).

PLATFORM: `runtime/worker/packaged-worker.capabilities.ts` lost the `langyConversation`, `scenario`,
`gatewaySpend` and `automation` entries — it now maps only `eventingMaintenance`, `evaluation`,
`topic`, `governanceIngestion` and `identity.ssoConnection`;
`runtime/app/features/langy-analytics-event.clickhouse.adapter.ts` and its test are deleted;
`runtime/app/trace-read-derivation.adapter.ts` lost its scenario derivation.
`git diff --numstat -- platform/app` reports 0 insertions on every row.

Gates measured at the end of the slice: `@langwatch/worker` 51 files / 403 tests, clean under both
tsconfigs; `@langwatch/automation-server` 27 files / 210 tests, tsc clean;
`@langwatch/trace-server` 1,605 tests across 96 files, tsc clean, with the same two
`.integration.test.ts` files failing to LOAD on the `~/server/clickhouse/goose` platform alias they
failed on before this slice; `@langwatch/evaluation-server` 25 files / 193 tests, tsc clean. Two
foreign failures were left alone: `packages/mail`'s JSX errors and an undeclared `ai` dependency in
`packages/features/model-provider/server`, both from concurrent lanes with uncommitted work in those
trees.


**(i) THE LAST FIVE SYNTHESIZED WRAPPERS, AND THE WORKER BECOMES THE DEPLOYABLE PROCESS. ALL FIVE
CONVERTED 2026-09-02 (uncommitted at time of writing).** `packagedWorkerCapabilities` is gone, and
with it the whole of `platform/app/src/runtime/worker/**` — 28 files. `apps/worker` composes every
capability the frozen registry names from packages, and `WorkerStandaloneComposition` is the only
graph in the repository that claims `event-sourcing/jobs`.

THE ORACLE IS THE REGISTRY, DRIVEN FROM AN EMPTY GRAPH.
`worker-capability-mount.composition.unit.test.ts` builds `WorkerProductionComposition` with NO
capability options at all, installs every feature, and compares the routed keys against byte-frozen
`job-registry.json`. Before this slice five capabilities arrived pre-built, so nothing in the package
could tell a graph that composed one from a graph that received one and passed it through; now a
capability that stops composing contributes no keys and the comparison fails by name. The five
assertions after it drive the seams parity cannot see, because they are seams where a collaborator is
REACHED rather than counted.

EVENTING MAINTENANCE: no absences, and one real trap. The blob sweep walks the keyspace the Group
Queue offloads payloads into and reclaim DESTROYS bytes, so a sweeper pointed at a connection of its
own reports a clean empty sweep forever while the real keyspace grows. The composition now takes
`processRedis` and hands the sweep the queue's own connection; the test spies on the installer's
`create`, calls `options.blobSweep.sweep()`, and asserts `smembers` landed on the queue's Redis.
`computeNextRunAt` / `computeCatchUp` MOVED from `platform/app/src/server/app-layer/scheduler/nextRunAt.ts`
into `@langwatch/eventing` (`server/schedule/next-run-at.ts`, `croner` added to that package), and the
retention counters became `OtelProcessRetentionMetricsAdapter` with the App's two series names pinned
as exported constants — two processes write `process_manager_retention_swept_rows_total` and
`process_manager_retention_failures_total`, so a renamed series is a silently split metric, and
`recordSweptRows` no-ops on `rows <= 0` exactly as the App's counter did.

EVALUATION: all keys mounted, ONE NAMED ABSENCE. Running an online evaluation resolves the customer's
model provider and renders the trace through the application's own mapping layer, both of which are
another lane's, so `WorkerEvaluationAbsenceReportPort.withoutEvaluatorExecution()` is logged once at
boot and `AbsentEvaluatorExecution` refuses `command:executeEvaluation` BY NAME. The key is still
routed, which is the whole point: an unrouted key redelivers forever, and a fabricated "skipped"
result would tell a customer their evaluation ran and found nothing. The projection half is real —
`EvaluationRunProjectionPort` + `EvaluationRunProjectionService` are new in
`@langwatch/evaluation-server`, carrying the same zod parses `EvaluationService` applied, and the
eventing adapter and run store were narrowed onto the port so the App's composition is unchanged. The
analytics cache keeps the `evaluation_analytics` prefix, which is a WIRE FORMAT the App reads.
`TraceAnalyticsAttributePolicy` moved out of `runtime/app/features/` into
`apps/worker/src/features/evaluation/`.

TOPIC: all nine keys mounted, and the one named absence is now CONDITIONAL rather than permanent.
Clustering runs on the PROJECT's own model provider; a page that fell back to a built-in model would
name a customer's topics with a provider they never chose and bill it to a key they never gave us.
**CORRECTED 2026-09-02 by the model-gateway lane: `createWorkerTopicClusteringExecution` now takes an
optional `modelProviders` and wires the packaged `ModelProviderExecutionAdapter` when it has one, so
`withoutClusteringModels()` is reported and `AbsentTopicClusteringModels` answers ONLY on a process
that composed no gateway.** The schedule keeps its place either way. The langevals exchange is REAL and
posts DIRECTLY — a deliberate difference from the App's staged client, which spools the page through
S3 first. The three Prisma repositories were narrowed from `PrismaClient` to `Pick<>` shapes
(`TopicDatabase`, `TopicClusteringDatabase`, `TopicModelProjectionDatabase`) so the worker's one
guarded client satisfies them structurally, and the page counters became
`OtelTopicClusteringMetricsAdapter` (`topic_clustering_page_total`,
`topic_clustering_page_duration_milliseconds`).

GOVERNANCE INGESTION: no absences, and the EE composition package earned its keep. The pull host
MOVED from `platform/app/src/server/app-layer/governance-ingestion-pull.host.ts` into
`@langwatch/enterprise-worker` as `WorkerGovernanceIngestionPullHost`, with its five process globals
turned into ports: `GovernanceIngestionEgressPort`, `GovernanceIngestionAwsPort`, the cipher, the
feature-flag service and the error sink. THE LEDGER IS SUPPLIED, NOT OPTIONAL —
`subscriber:pm:pulledUsageLedger` is in the frozen registry and the Enterprise adapter attaches that
process manager only when a ledger is present, so a graph composed without one would claim the
consumer while leaving that key unrouted. Rating goes through `estimateModelCost` +
`getStaticModelCostRates`, the one cascade both graphs' span pricing already uses, because a second
rate table would bill one customer two different amounts for the same tokens depending on which
process pulled them. Two deliberate differences: the App's PostHog `capture` became a structured log
(this process has no error tracker, and inventing a second destination splits one failure mode across
two places an operator must know to look in), and the egress fence is
`createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] })` — STRICTER than the deployment's
webhook policy, because a webhook destination is a place a customer chose to receive their own data
and an ingestion source is a place we go and read from. A PACKAGE MOVE fell out of it:
`GovernanceInternalProjectPort` / `GovernanceInternalProjectService` /
`PostgresGovernanceInternalProjectAdapter` are new in `@langwatch/project-server`, replacing a whole
`ProjectService` in `ingestion-pull-worker.service.ts` and both EE API adapters; the
`governance-<organizationId>` slug and the `ensureInternal` sequence are byte-identical.

IDENTITY / SSO CONNECTIONS: all keys mounted, ONE NAMED ABSENCE. Four platform files MOVED —
`platform-operators.ts` into `@langwatch/identity-server` as
`prisma.sso-platform-operators.repository.ts` (with `adminEmails` INJECTED rather than read off the
process), and the projection repository, the reads repository and the ledger writer into
`@langwatch/identity-eventing`. The ledger writer's two `tryGetApp()` resolvers became REQUIRED
constructor parameters, which is what stopped it reaching for an application singleton that no longer
exists in this process. `PostgresSsoConnectionPipelineAdapter` mirrors the join-request adapter.
The absence is directory token revocation: `withoutDirectoryTokenRevocation()` and
`UnrevokedSsoConnectionDirectory`, which logs and returns `{ revoked: 0 }` rather than reporting a
revocation it did not perform — tokens stop verifying anyway, because the connection reaches
TORN_DOWN, so what is lost is the early invalidation and not the security property.

CONTRAVARIANCE, AGAIN, TWICE. `prepareEventForProjection` is contravariant in
`WorkerPipelineDefinition<TEvent>`, so the evaluation and SSO capability interfaces took the event
union as `<TEvent extends Event>` and their installers capture registration as a CLOSURE in `create`,
leaving the class itself free of the union — the (h) record's fix applied verbatim.

TWO TESTS INVERTED RATHER THAN DELETED. `not.toContain("sso-connection")` was written to guard the
staged shape, and this is the change it was written to notice; following the (g) precedent, both now
assert the mounted shape.

THE WORKER IS NOW THE DEPLOYED PROCESS. `apps/worker/src/worker.entrypoint.ts` boots
`startStandaloneWorker()`, which builds `WorkerStandaloneComposition` — its own guarded Prisma client
(`PrismaTenancyGuardService`), its own routed ClickHouse with the project→organization directory read
through that same client, its own Redis, AWS and stored-object runtimes, all owned by the boot
`ResourceScope` — then `WorkerProductionComposition` with `consumers: { enabled: true }`. The
transport is the Prometheus metrics port, the only thing this process listens on; it answers the
kubelet's `/healthz` and reports an EMPTY exposition rather than pretending, because every metric this
process records goes out over OTLP. A configuration failure throws out of `boot` before observability
or the resource scope exist, writes `[langwatch:worker] fatal boot failure: <message>` to stderr and
exits non-zero. It imports no application graph, so it cannot start a partial second copy of the
platform process.

SIX NEW CONFIG LEAVES, the ones the App used to read off `process.env` on the worker's behalf:
`DATABASE_URL` and `CLICKHOUSE_URL` (plus the `CLICKHOUSE_URL__<label>__<orgId>` private routes and
the pool sizing, read off the raw environment through the shared parser because the names carry the
organization id), `WORKER_METRICS_PORT` (default 2999), `METRICS_API_KEY`,
`LANGWATCH_DEFAULT_RETENTION_DAYS`, `ADMIN_EMAILS` and `LANGEVALS_ENDPOINT`. The first two have NO
absence arm: a worker with no database or no event store is not a smaller worker, it is a worker that
would claim the consumer and fail every job individually.

DEPLOYMENT CUTOVER, six files, each edited minimally: `infra/docker/Dockerfile` (copies
`apps/worker`, filters both installs on `@langwatch/worker...`, ships the app into the runtime
image), `charts/langwatch/templates/workers/deployment.yaml` (`workingDir: /app/apps/worker`,
`args: ['run', 'start']`), `infra/compose.yml`, `dev/compose.dev.yml`, the root `package.json`
(`dev:worker`) and `.github/workflows/sdk-javascript-ci.yml`. Packaging follows `apps/api`: `tsx` on
the entrypoint, not a bundle.

A JUDGMENT CALL, RECORDED RATHER THAN HALF-DONE: the npx self-host distribution
(`apps/server/src/services/langwatch-workers.ts`, `dev/scripts/pack-npm.sh`,
`.github/workflows/npx-server-publish.yml`) still asserts `dist/server/workers.cjs`, which
`build-server.mjs` no longer emits — the `workers` and `scenario-child-process` entries are deleted.
It is left to FAIL LOUDLY at publish rather than be half-repointed at a `tsx` entrypoint the tarball
does not yet carry; that repointing is Wave 11's packaging cutover, and a silently repaired assertion
would hide which distribution still needs it.

PLATFORM DELETED, 37 files and 0 insertions on every one of the 212 numstat rows:
`src/runtime/worker/**` (28), `src/workers.ts`, `src/server/workers/startWorkers.ts`,
`runtime/app/features/evaluation-analytics-attribute-policy.adapter.ts`, the four identity files, the
scheduler's `nextRunAt.ts` and the governance pull host; plus the two `ENTRIES` rows in
`scripts/build-server.mjs` and the three worker script lines in `package.json`.

SIX SABOTAGES WENT RED against the mount test: the evaluation installer detached, the SSO installer
detached, governance ingestion detached, topic models resolving instead of refusing, the langevals
body not serialised, and the blob sweep pointed at a second connection.

Gates measured at the end of the slice: `@langwatch/worker` 52 files / 409 tests, clean under both
tsconfigs; `@langwatch/eventing` 967 passed + 2 todo; `@langwatch/evaluation-server` 193;
`@langwatch/automation-server` 210; `@langwatch/topic-server` 158; `@langwatch/identity-server` 295;
`@langwatch/identity-eventing` 56; `@langwatch/project-server` 128;
`@langwatch/enterprise-worker` 3; `@langwatch/enterprise-api` 15;
`@langwatch/enterprise-governance-server` 591 — tsc clean on all ten packages. THE BOOT SMOKE WAS
SKIPPED HONESTLY: this worktree has no `.env`, and while Postgres:5432 and Redis:6379 answer,
ClickHouse 8123 and 9000 are closed, so a real boot could not have reached readiness. What WAS run
end-to-end is both config refusals — no `DATABASE_URL`, then no `CLICKHOUSE_URL` — each exiting 1
with a legible `[langwatch:worker] fatal boot failure:` line.


## How to execute the plan

Use this loop continuously until the final gate passes:

1. Select the highest ready item whose dependencies are complete. Parallel
   lanes must own non-overlapping paths or coordinate a named interface.
2. Run `feature-inventory` for a broad/unclear slice and record old callers,
   response/effect parity, target owner and exact deletion boundary.
3. Run `feature-migration` for one vertical. Rewire all in-scope production
   callers and move equivalent tests before deleting displaced code.
4. Run `feature-migration-review`. Fix architectural honesty, behaviour,
   coverage, composition and residue findings before staging.
5. Run the slice checks, inspect exact staged paths/hunks and commit one coherent
   batch. Shared lockfile/baseline hunks must be attributed to that batch.
6. Update this plan with the commit hash, new measured counts, deliberate
   residuals and newly ready work.

Do not wait for the entire programme before committing. “One go” means this
ordered runbook can be driven continuously, not that all files belong in one
commit.

## Continuous execution order

Items in the current wave may run concurrently when their path ownership is
independent. Do not start a later wave until the current wave gate is complete.

### Wave 0: reconcile and commit current work

| ID     | Work                                                                                     | Exit gate                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C-01` | Reconcile workspace links and `pnpm-lock.yaml` after all active manifest writers finish. | **Committed for API and Worker/Topic.** Continue exact-hunk attribution for later shared-tree slices.                                                                                                       |
| `C-02` | Review and commit Agent UI.                                                              | **Committed `2d5066fcd7`.** Retained drawers and coverage/documentation follow-ups are recorded above.                                                                                                      |
| `C-03` | Review and commit Trace full-read.                                                       | **Committed `7cca0848fb` as preparation, not cutover.** The internal/all-visible boundary has no production caller; `F-TRACE-01` remains.                                                                   |
| `C-04` | Review and commit process observability.                                                 | **Committed `bcf05be631`.** Process adoption and the two observability follow-ups remain in Wave 1 and the active API/worker slices.                                                                        |
| `C-05` | Finish Secret REST correction.                                                           | **Committed `faf6db77e1`.** All four direct prefixes are present; deferred generated-artefact, client and compatibility findings are recorded above.                                                        |
| `C-06` | Finish tRPC/AuthZ/API Secret+Agent direct cutover.                                       | **Wave 0 complete.** Package adapters are committed in `02457aaebd`; listener/policy foundations are committed in `f1baea7011`. Physical API activation and compatibility-router deletion remain in Wave 3. |
| `C-07` | Finish Eventing server and Enterprise worker composition.                                | **Committed `555ec3fe07` and `8e57032744`.** Production factories are ready for the active Worker Topic composition batch.                                                                                  |
| `C-08` | Finish Worker Topic cutover.                                                             | **Wave 0 complete.** Eventing-only Topic dispatch is committed in `39f1de6dff`; Trace registration follows in `cd28835a7b`. Full shared-registry activation remains in Wave 4.                              |

### Wave 1: process foundations

**Active only for the user-named foundation scope:** configuration authority and
typed process projections; physical API/Worker/local boot and lifecycle;
request/queue observability context, health and ordered drain; and explicit
process construction for Group Queue, storage, mail, Stripe, Slack, AWS,
WebSocket, NLP/Langevals and model clients. Do not pull persistence or feature
verticals into this exception.

The following uncommitted lanes remain shared-worktree residuals rather than
completed gates and are outside the active Wave 1 scope:

- Analytics/Dashboard persistence and its app adapters/tests;
- Gateway cache-rule, guardrail and budget persistence and tests;
- Prompt persistence/service parity and its app adapters/tests.

Their exact modified and untracked paths remain visible in `git status`; they
must not be staged with foundation or Wave 2 commits. Reassess them only when
the user expands the Wave 1 scope or a Wave 2 dependency requires a narrowly
owned hunk.

#### Active Wave 1 foundation lanes at `d80a016529`

1. **Projection slice committed in `850586835d`:** `packages/config` now
   resolves typed API, Worker, UI-public and local-orchestrator projections;
   the remaining gate is deleting the broad App/instrumentation/task parsers
   only as their physical boot paths take ownership.
2. **Lifecycle slice committed in `6a62e37cf1`:** API/Worker now preserve
   ordered first-error-safe drain, tRPC user log context and tested signal
   disposal without activating consumers. Physical launchers, full health/
   profiling parity and production graph binding remain active residuals.
3. **Infrastructure foundations committed through `4bfb7bd679`:** Worker owns
   one Redis/AWS/Group Queue graph, consumes the Stored Object-owned policy and
   supplies concrete S3/filesystem drivers. Physical config, project BYOC and
   Azure ports remain before executable activation.
4. **External clients committed through `52ec8f2a41`:** mail, Stripe,
   tenant-dynamic Slack and WebSocket construction now have named process
   adapters. Remaining link-secret and model-client cuts stay active.
5. **Physical process lifecycle committed through `d80a016529`:** the deployed
   worker entry boots through `WorkerExecutable` behind a named legacy
   composition adapter, and the API graph owns readiness, health/metrics,
   request-failure capture, Redis/Group Queue infrastructure and API-key
   security. Neither can delete its legacy counterpart yet: the worker registry
   is still legacy and nothing composes `ApiProductionComposition`.

Current Wave 1 progress at `d80a016529`:

- [x] Enforce injected configuration in reusable production packages.
- [x] Add injectable API and Worker process/lifecycle foundations.
- [x] Parse and inject Eventing, logging, Gateway cryptography and Group Queue
      policy.
- [x] Compose shared AWS transport policy and lease-safe Dataset S3 clients.
- [x] Make Eventing ProcessStore selection fail closed without activating the
      partial Worker consumer.
- [x] Commit the corrected ClickHouse live-runtime/migration/Ops EXPLAIN cut.
- [x] Commit an authoritative, process-idempotent telemetry boot projection.
- [x] Compose process-owned Prisma and Redis compatibility seams.
- [x] Replace the live platform Eventing persistence graphs and delete the
      displaced adapters.
- [x] Compose the Worker durable Eventing graph with consumers forced off.
- [x] Project private executable bootstrap configuration before HTTP-specific
      validation without rereading the resolved App boot value.
- [x] Define and boot-test typed API, Worker, UI-public and local-orchestrator
      projections through `packages/config`.
- [x] Compose the process-owned Langevals evaluator client with schema-first
      response validation and mapped error metrics.
- [x] Give the object-storage migration task and Enterprise Governance S3/Redis
      explicit lifetime ownership and first-error-safe cleanup.
- [x] Move Stored Object owner-resolution persistence into its feature and
      delete the displaced App implementation and duplicate unit suite.
- [x] Characterise the first legacy Trace full-read field cohort without
      cutting over the production reader or deleting its compatibility path.
- [x] Compose one typed Trace privacy runtime for Data Privacy, lazy Google DLP,
      Presidio and tokenization, share it with logs/metrics and close it once.
- [x] Compose Worker-owned Redis, AWS and Group Queue dependencies with
      first-error-safe cleanup.
- [x] Move Stored Object dispatch and destination policy into the feature and
      adapt it into Worker queue storage without activating consumers.
- [x] Compose one lazy SES/SMTP/SendGrid/Resend mailer with Better Auth and
      explicit mail delivery callers.
- [x] Parse private mail and Stripe settings once, centralise tenant-dynamic
      Slack construction and own WebSocket listener teardown.
- [x] Compose Worker S3/filesystem drivers behind the canonical Stored Object
      destination and dispatch policy without activating consumers.
- [x] Parse the complete private Worker projection covering Redis, Group Queue,
      storage, outbound proxy and drain deadline, and own the physical
      executable, signal and fatal-error lifecycle without importing the legacy
      application graph.
- [x] Compose API-owned Redis and Group Queue infrastructure behind a boot
      readiness gate, with health/metrics routes and process-owned
      request-failure capture.
- [x] Add project-key and current API-key REST authentication, ceiling refusal,
      mark-used and attributed mutation audit to the standalone API graph.
- [x] Record full shared-registry installation, concrete intent activation and
      the single consumer switch under Wave 4; do not activate them in Wave 1.

#### Configuration and boot

- [ ] Make `packages/config` the only parser for private runtime configuration.
- [x] Define separate typed API, worker, UI-public and local-orchestrator
      configuration projections.
- [ ] Move `runtime/config.ts`, public config, instrumentation configuration and
      process-role switches to their physical apps.
- [x] Replace reusable-package `process.env` access with injected semantic
      values; executable composition roots remain the only permitted readers.
- [ ] Preserve credential-secret compatibility, queue settings, ClickHouse
      routing, Redis, storage, mail, external model, rate-limit and retention
      configuration.
- [ ] Delete old config modules only after API/worker/UI boot tests cover
      invalid, missing and role-specific configuration.

#### Process lifecycle and observability

- [x] Construct Prisma, Redis and ClickHouse once per owning App/task process.
- [ ] Finish Group Queue, storage and external client construction in the
      physical API/Worker roots. Worker private configuration and API
      Redis/Group Queue are committed; project BYOC and Azure sources and model
      clients remain.
- [ ] Bind request/queue trace context and structured logger fields.
- [ ] Preserve readiness/liveness, metrics, profiling and handled-error capture.
      Readiness, `/api/health` and an optional metrics port exist; profiling and
      handled-error parity do not.
- [ ] Drain HTTP/queues/features first, then flush tracing/logging and close
      database/network resources; retain the first shutdown failure while running
      every cleanup.
- [ ] Move `server.mts`, `start.ts`, `task.ts`, instrumentation and shutdown
      entry points to physical apps or local orchestration. The `workers.ts`
      boot, signal and drain lifecycle is moved; the rest are not.

#### Persistence and infrastructure

- [ ] Keep Prisma generation/readiness/migrations in `packages/prisma-client`.
- [ ] Move each direct Prisma query into its singular feature’s private strict
      repository; no feature consumes another feature’s repository.
- [x] Keep ClickHouse connection/resolution and managed-client policy in
      `@langwatch/clickhouse-client`, with task-local migration composition.
- [ ] Move remaining feature queries into feature adapters.
- [x] Finish `@langwatch/eventing/server` ProcessStore/EventStore/retention
      composition.
- [ ] Move storage, mail, Stripe, Slack, AWS, WebSocket, NLP/Langevals and model
      client construction into explicit process adapters. AWS, Langevals, NLP,
      Trace privacy, mail, Stripe, Slack, WebSocket and Worker S3/filesystem have
      named runtimes; Worker BYOC/Azure binding and model clients remain.
- [x] Preserve task-local object-storage migration and feature-local Enterprise
      S3/Redis lifecycles behind named adapters. NLP Lambda/CloudWatch is
      complete in `ec1240fb37`; object-storage/Governance is complete in
      `1f4a1adc1d`.

Measured Wave 1 persistence baseline on 2026-08-28:

| Residual surface                                  |                                                                                Measured burden | Required owner/deletion gate                                                                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform Prisma                                   | 686 direct model/raw/transaction operations in 150 files, approximately 670 in production code | Move each operation behind its singular feature's private repository. Delete the old repository or handler query only after every production caller and equivalent behavioural test use the canonical service.    |
| Platform ClickHouse                               |                                          92 direct query/insert/command operations in 26 files | Move Trace, Analytics, Stored Object, Log, Metric, Eventing and Ops queries into their existing feature or infrastructure adapters without changing query fields, nullability, windows, ordering or retry policy. |
| Package Prisma outside canonical repositories     |                                                                       62 operations in 9 files | Finish Eventing infrastructure persistence, then remove AuthZ, Share, Prompt, Gateway, Dataset and Enterprise composition-level database access through their owning services/repositories.                       |
| Package ClickHouse outside canonical repositories |                                                                      32 operations in 13 files | Retain only explicit Eventing/process infrastructure adapters; move feature and Enterprise composition queries into private server repositories.                                                                  |

Run the persistence work in dependency order:

1. **Complete:** Prisma/ClickHouse process lifecycle and App/task composition;
2. **Complete:** Eventing ProcessStore, EventStore, retention, replay and outbox
   persistence cutover; keep registry activation in Wave 4;
3. move Analytics/Dashboard and Gateway persistence by singular feature while
   leaving their API adapters live;
4. **Characterised prerequisite:** keep the Trace production read cut deferred
   until the remaining `F-TRACE-01` field, protection and overlay gates close;
5. **Complete in `de578b0f66`:** compose the Trace processing tokenizer, DLP
   and Presidio client graph after its typed configuration projection;
6. move remaining product Prisma/ClickHouse batches whose tenant and
   authorisation boundaries are already explicit; and
7. run a final direct-query sweep, allowing only strict private repositories,
   Eventing infrastructure repositories and named process infrastructure
   adapters.

Do not pull Project, Organization, User, Role, AuthZ, API-key or Data
Privacy/Retention scope queries forward to satisfy that sweep. Their repository
boundaries depend on the Wave 2 actor/tenant graph and remain deferred.

#### Previous Wave 1 lanes and current disposition

Persistence items 1–4 below are frozen outside the current user-authorized
foundation scope. Item 5 is complete. Mail composition in item 6 is active
across the Wave 1 external-client and Wave 2 Auth lanes.

1. **Analytics and Dashboard persistence:** move legacy LWQL execution,
   saved-workbench chart and dashboard placement repositories into the existing
   singular feature packages. Preserve restricted-client policy, tenant/private
   routing, ceilings, truncation, nullable result fields and grid ordering.
   Keep API routers as later Wave 3 adapters. Delete each displaced production
   repository only with package integration parity.
2. **Gateway persistence core:** move cache-rule, guardrail and configuration
   materialisation queries into the existing Gateway server graph. Inject the
   complete Evaluator, Monitor and Project services plus named change/audit
   ports; keep transports thin. Preserve atomic mutation/event/audit writes,
   archive semantics, priority ordering, defaults and materialised payloads.
   REALTIME booking/reconciliation stays deferred with its advisory-lock,
   Eventing settlement and idempotency boundary.
3. **Prompt persistence:** make the public adapter depend only on a portable
   private persistence port, keep generated Prisma and transactions inside the
   strict repository, map concrete domain errors at transports, rewire stale
   experiment callers to the composed Prompt service, and prove handle,
   version/tag transaction and copy/list parity before deleting residue.
4. **Trace full-read:** the first characterization cohort is committed in
   `a5b3fda731`. Do not cut production reads in Wave 1; carry the remaining
   storage-anchor, protection, overlay, ordering and nullability gates in
   `F-TRACE-01` to the Trace vertical.
5. **Trace processing clients, complete in `de578b0f66`:** one typed process
   graph now owns Data Privacy, lazy Google DLP, Presidio and tokenization for
   Trace, logs and metrics; focused lifecycle/parity coverage is green.
6. **Mailer/Auth composition, complete in `4bba78994c`:** Better Auth and
   passkey registration are factories, one Auth/Mailer graph is composed on
   `AppDependencies`, and the broad session/mail caller graph injects it. The
   physical API config/launcher move and recorded cross-feature revocation
   seams remain separate residuals.

Still deferred from Wave 1: transport route cutover (Wave 3), Worker registry/
consumer activation (Wave 4), feature persistence outside the named foundation
scope, and identity-owned persistence except through active Wave 2 verticals.

Gate: API and worker independently construct one explicit graph without global
App, package env reads or request/job-time service construction.

### Wave 2: identity, tenancy and access

**Active.** Start with the actor/tenant dependency graph, then migrate
independent owners in parallel without sharing composition-root files. Root
owns the integration hunks and commits each reviewed vertical separately.

AuthZ denial parity is committed in `480e9f73ec` and Entitlement/Enterprise
Licensing composition in `30c4356a68`. `4bba78994c` adds the canonical Auth
service, Better Auth factory, private session repository/cache ports, User
credential/passkey creation, `tryGetLastHomePath`, and live request-App caller
cutover; the displaced credential-user module is deleted. The
standalone API now has a real API-key transport; the live platform transport
still does not, and the two ceilings coexist under `F-APIKEY-01`. The
recorded Organization revocation and User email-change orchestration seams must
close with their owning callers. `9196a3f2f1` routes team-assignment tenant
lookup through the Role service, `3a8f4c4b00` makes Project the managed-provider
tenant owner and deletes the duplicate Enterprise project repository and port,
and `d80a016529` moves first-password and passkey-nudge state into User, which
leaves `routers/user.ts` owning the whole change-password read/verify/write. Organization/Project/Role preparations do not
count as complete until live callers are rewired and displaced code is deleted.

Move these owners before broad product transport cutover:

- `auth`, Better Auth/session lifecycle and revocation;
- `user`, `organization`, `project`, `role`/role binding;
- `authz` scope lineage, grant decisions and cache;
- `api-key`, PAT/admin/project-key actor semantics;
- `entitlement` and Enterprise `licensing`, `sso`, `scim`, `saas` composition.

Required proof:

- actor extraction for browser session, project API key, PAT and admin;
- exact tenant/project target and `X-Project-Id` matching;
- permission denial/error status and error-shape parity;
- session revocation, invite/membership and personal-workspace invariants;
- core/Enterprise import direction;
- no product handler reads Prisma or `getApp` for access decisions.

Gate: every later API handler can rely only on `context.app`/`ctx.app`,
`actor()` and `authorize()`.

### Wave 3: API application and every transport

#### API process root

- [ ] Finish one Hono/tRPC server and listener in `apps/api`.
- [ ] Own request IDs, body limits, CORS, auth, authorisation, audit, rate limits,
      handled errors, response logging, trace context and shutdown.
- [ ] Compose each feature service/installer once at boot.
- [ ] Remove the live dependency on the universal app graph as routers move.

#### Public REST

- [x] Inventory every `src/app/api/**` route, method, auth mode, response schema,
      ordering constraint and OpenAPI operation. **Done 2026-09-02** — the table
      below is it, taken from source rather than from the generated document.
- [ ] Move feature routes to feature-server REST adapters and mount in
      `apps/api`; keep compatibility aliases thin and explicit.
- [ ] Preserve special ordering: concrete routes before catch-alls, auth CLI
      before Better Auth, gateway OpenAPI before parameter routes and experiments
      v3 before siblings.
- [ ] Cover ingestion/collector, OTEL/RUM, SSE, MCP, admin/ops/health/cron,
      uploads/exports, webhooks and internal control-plane routes, not only product
      CRUD.

##### Route inventory (source of truth, 2026-09-02)

**156 routes across 39 platform route files plus 11 non-`routes/**` mounts.** The
count includes each alias spelling separately, because an alias is a URL a
customer holds: the Secret family is one implementation at three bases (15
rows), root discovery serves both the bare and trailing-slash spellings, and the
`github-langy` pair is a second name for two GitHub handlers.

Legend for AUTH: `pub` = `publicEndpoint(reason)`; `hma(perm, cred)` =
`handlerManagedAuth` — the family resolves the credential itself and publishes
its own refusal bodies; `int` = `internalSecret(reason)`; `req(perm)` =
`requires(...)`, the framework's authenticate-then-authorize chain. **`hma` is
the migration hazard**: 62 of the 156 rows resolve their own credential and
answer refusals the framework chain would render differently, so moving one onto
the chain is a wire change. The port that preserves them is
`ApiHandlerManagedCredentials` (`apps/api/src/app/api-handler-managed-credential.ts`).

**Status column.** `moved` = serving from `apps/api`, platform file deleted.
`blocked:<what>` = named absence — the handler is faithful but the capability it
dispatches through is not in `apps/api`'s composed graph.

###### Process-level and discovery

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/gateway/v1/openapi.json` | pub | 200 document bytes, strong ETag, `max-age=60, must-revalidate`; 304 | **before every credentialed `/api/gateway/v1` route** | serves the document | **moved** |
| GET | `/api/openapi.json` | pub | same bytes, same ETag | — | serves the document | **moved** |
| GET | `/.well-known/openapi` (+ `/`) | pub | same bytes | reaches Hono only via `isRootDiscoveryPath` | serves the document | **moved** |
| GET | `/llms.txt` (+ `/`) | pub | 200 `text/plain` index | same | no | **moved** |
| GET | `/api/health` | pub | 204, empty | — | no | **moved** (already served by `ApiProcessLifecycleRoutes`) |
| HEAD | `/api/health` | pub | 204, empty | — | no | **moved** (same) |
| GET | `/api/health/collector` | pub + in-handler project key | 200 `{status, body}`; 401 `{message}`; 500 `{message}` | — | no | **moved** → `apps/api/src/features/health/`; the key resolves through the process's ONE API-key service, narrowed to the deprecated project key |
| GET | `/api/health/evaluations` | pub + in-handler key | 200 `{status, body}`; 500 after 3 retries | — | no | **moved**; same |
| GET | `/api/health/processor` | pub + in-handler key | 200 `{status, body}` after ≤60s poll | — | no | **moved**; same |
| GET | `/api/health/triggers` | pub + in-handler key | 200 `{status, body:{message}}`; 404 ×3 shapes | — | no | **moved**; over the org group's own automation application |
| GET | `/api/health/workflows` | pub + in-handler key | 200 `{status, body}`; 404; 500 | — | no | **moved**; over the execution half's workflow read |
| GET,POST | `/api/cron/old_lambdas_cleanup` | int (builder `verifySecret` + in-handler recheck) | 200 `{message}`; 401 empty; 500 `{message, error}` | — | no | **DELETED, not moved** — `src/tasks/cleanupOldLambdas.ts` was already deleted as unreached, so the route had nothing left to call |
| GET,POST | `/api/cron/seed_demo` | int (same) | 200/500 `{report}`; 401 empty | — | no | **DELETED, not moved** — its runner is `scripts/dogfood/**`, a tree with no exit owner, and the CLI entry is the same code path; the SaaS CronJob repoints at it |
| POST | `/api/ops/clickhouse/explain` | hma([], internal) — Bearer `LANGWATCH_OPS_API_KEY`, constant-time | 200 `{type, rows}`; 400 ×3; 401; 502; 503 ×2 | — | no | **moved** → `@langwatch/ops-server` `ops-clickhouse-explain.api.ts`; mounted behind its own ClickHouse identity. The two 503s are gone: with no `CLICKHOUSE_OPS_URL` or no `LANGWATCH_OPS_API_KEY` the family is not mounted at all, so an unprovisioned deployment 404s rather than leaving the regex filter alone on an open door |
| POST,DELETE | `/api/admin/impersonate` | hma([], session) — `ops.isAdmin` | 200 `{message}`; raises `AdminSurfaceHiddenError` / `AdminSessionExpiredError` / `ValidationError` | — | no | moved to `@langwatch/ops-server`; **not mounted** — the API process's session port answers no `impersonator` |
| POST | `/api/admin/:resource` | hma([], session) | 200 operation result; 400 malformed body; `ValidationError` unknown resource | body `resource` wins over path param | no | moved to `@langwatch/ops-server`; not mounted, same reason |
| POST | `/api/unsubscribe` | pub (HMAC token in `?token=`) | 200 `{ok}`; 400 `{error}` ×2; 429; 500 | **before** the method guard below | no | **moved** → `@langwatch/automation-server`, over the org-group's automation application |
| ALL | `/api/unsubscribe` | pub | 405 `{error}` + `Allow: POST` | **after** the POST | no | **moved**, same family |
| POST | `/api/rum/v1/traces` | pub | 202 empty; 400/404/413/429/500 `{error, code}` | — | no | **moved** |
| POST | `/api/bug-reports` | pub (API key optional, only links a project) | 201 `{id}`; 400 ×2; handled 400/429/500 `{error, code}` | 12 MB body cap | no | **moved** → `@langwatch/ops-server`, over this process's Prisma and its one counter |

###### Ingestion, OTEL and the collector

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/collector` | hma(traces:create, apiKey) | 200 `{message, partialSuccess}`; 400 ×9 distinct sentences; 401; 429 ×2; 500; 402 raised | **before** the OTLP path aliases | no | **moved** → `@langwatch/trace-server`, over the SAME ingestion service the OTLP receiver uses; no plan allowance enforced |
| POST | `/api/otel/v1/traces` | hma(traces:create, apiKey) | 200 `{message, partialSuccess}`; 400; 401; 402 | auth **before** decompression | no | **moved** → `@langwatch/trace-server`, serving over this process's own producer |
| POST | `/api/otel/v1/logs` | hma(traces:create, apiKey) | 200 `{}` or `{partialSuccess}`; 400; 401; 503 | — | no | moved with the family; **route not registered** — `apps/api` composes no log fold, so it 404s rather than 500s |
| POST | `/api/otel/v1/metrics` | hma(traces:create, apiKey) | 200 `{}` or `{partialSuccess}`; 400; 401; 503 | — | no | moved with the family; route not registered, same reason |
| ALL | `/api/otel/*`, `/api/collector/*`, `/api/v1/*`, `/v1/*` | **none declared** — terminates nothing, re-dispatches | forwards to the canonical OTLP handler, stamping `OTLP_CORRECTED_PATH_HEADER`; declines anything unrecognised | **after** `otel` and `collector`; a path it declines must fall through untouched | no | **moved** — takes the receiver as an argument, so it cannot be mounted without it |
| POST | `/api/ingest/otel/:sourceId` | hma([], internal) — `Bearer lw_is_…` | 202 `{accepted, bytes, events, rejectedSpans?, hint?}`; 400 `wrong_endpoint`; 401; 429 | rate-limit → auth → sourceId → sourceType | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where the Enterprise governance application is composed, over the SAME `trace_processing` producer registration the OTLP receiver uses |
| POST | `/api/ingest/webhook/:sourceId` | hma([], internal) | 202 `{accepted, bytes, eventId}`; 400; 401; 429 | same | no | moved with the family; **route not registered** — `apps/api` composes no log fold, so it 404s rather than 500s |
| POST | `/api/ingest/otel/:sourceId/v1/logs` | hma([], internal) | 202 `{accepted, bytes, logRecords, costEvents, ledgerRows, hint?}`; 401; 429 | same, then best-effort cost extraction | no | moved with the family; route not registered, same reason (and nothing is priced: no gateway spend ledger here) |
| POST | `/api/ingest/otel/:sourceId/v1/metrics` | hma([], internal) | 202 `{accepted, …, partialSuccess}`; 401; 429; **503 after parse** so a retry does not double-count | post-parse failure must not record the event | no | moved with the family; route not registered — no metric fold |

###### Auth, CLI and sessions

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/validate` | pub | 200 `{projectSlug}`; 401 `{message}` | — | no | moved → `@langwatch/auth-server`; **not mounted** — the family's Better Auth port has no value on this process |
| GET | `/api/auth/session` | pub | 200 `null` or `{session, user}`, `Cache-Control: no-store` | — | no | moved with the family; not mounted, same reason |
| GET,POST | `/api/auth/logout` | pub | GET 302; POST 200 `{success}`; 405 otherwise; clears both bare and `__Secure-` cookies | **before** the catch-all | no | moved with the family; not mounted, same reason |
| ALL | `/api/auth/*` | pub | Better Auth's own response; 403 `{message, code:"INVALID_ORIGIN"}` on the origin gate | **registered last**; swallows every `/auth/*` sibling registered after it | no | moved with the family; not mounted — `API_UNAVAILABLE_PRODUCT_ADAPTERS` still names the Better Auth transport |
| POST | `/api/auth/cli/device-code` | hma([], session) | 200 RFC 8628 device grant | **whole family before `/api/auth/*`** | no | **moved** → `@langwatch/auth-server`; mounted where a host supplied the browser-session transport AND this process holds Redis |
| POST | `/api/auth/cli/exchange` | hma([], session) | 200 `device_session` or `api_key` kind; 400/408/410/428/429/500 | same | no | **moved** → `@langwatch/auth-server`; mounted where a host supplied the browser-session transport AND this process holds Redis |
| POST | `/api/auth/cli/refresh` | hma([], session) | 200 token pair; 400; 401 `invalid_grant` | same | no | **moved** → `@langwatch/auth-server`; mounted where a host supplied the browser-session transport AND this process holds Redis |
| GET | `/api/auth/cli/budget/status` | hma([], session) | 200 `{ok}`; 401; 402 `{error:{type:"budget_exceeded", …}}` | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/bootstrap` | hma([], session) | 200 bootstrap; 401 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/budget-overview` | hma([], session) | 200 overview; 401 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/personal-project` | hma([], session) | 200 `{project}`; 401; 403; 500 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| POST | `/api/auth/cli/virtual-key` | hma([], session) | 201 `{id, secret, prefix}`; 400/401/403/409/500 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| POST | `/api/auth/cli/project-key` | hma([], session) | 200 `{api_key, project}`; 400/401/403/404 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/governance/ingest/sources` | hma(ingestionSources:view, session) | 200 `{sources}`; 401/402/403 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/governance/ingest/sources/:id/events` | hma(activityMonitor:view, session) | 200 `{events}`; 400/401/402/403 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/governance/ingest/sources/:id/health` | hma(activityMonitor:view, session) | 200 `{source, health}`; 400/401/402/403 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/governance/status` | hma([], session) | 200 `{setup}`; 401/402 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/governance/ingestion-templates` | hma([], session) | 200 `{ingestion_templates}`; 401 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| POST | `/api/auth/cli/governance/ingestion-key` | hma([], session) | 201 `{token, prefix, endpoint, project?}`; 400/401/403/404/412/500 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/governance/ingestion-keys` | hma([], session) | 200 `{keys}`; 401 | same | no | **moved** → `@langwatch/enterprise-governance-server`; mounted where a host supplied the Enterprise governance application — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| GET | `/api/auth/cli/lookup` | hma([], session) | 200 `{user_code, status, …}`; 400/401/404/410 | same | no | **moved** → `@langwatch/auth-server`; mounted where a host supplied the browser-session transport AND this process holds Redis |
| POST | `/api/auth/cli/approve` | hma(project:update, session) | 200 `{ok, kind?, project?, organization_id}`; 400/401/403/404/409/410 | same | no | **moved** → `@langwatch/auth-server`; mounted where a host supplied the browser-session transport AND this process holds Redis |
| POST | `/api/auth/cli/deny` | hma([], session) | 200 `{ok}`; 400/401 | same | no | **moved** → `@langwatch/auth-server`; mounted where a host supplied the browser-session transport AND this process holds Redis |
| POST | `/api/auth/cli/logout` | hma([], session) | 200 `{ok}`, idempotent | same | no | **moved** → `@langwatch/auth-server`; mounted where a host supplied the browser-session transport AND this process holds Redis |

###### Experiments, evaluations and workflows

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/experiments/execute` | hma(evaluations:manage, session) | SSE orchestrator stream; 401/403 `{error}` | **whole v3 family before the packaged experiments family** | `describeRoute({hide:true})` | **moved** → `@langwatch/experiment-server` `experiment-v3.api.ts`; mounted where this process holds a session and the execution half |
| POST | `/api/experiments/abort` | hma(evaluations:manage, session) | 200 `{success, runId, message}`; 400/401/403; 404 raised | same | no | **moved**; same |
| POST | `/api/experiments/:slug/run` | hma(evaluations:create, apiKey) | 200 `{runId, status, total, runUrl}` or SSE; 400; 401/404 handled envelope | literal `/runs` siblings must not be swallowed by `:slug` | yes — "Run an experiment" | **moved**; refuses `service_unavailable` by name where no run loop is composed |
| GET | `/api/experiments/runs` | hma(evaluations:view, apiKey) | 200 `{experimentId, experimentSlug, runs, pagination}`; 400; 401/404 | same | yes — "List runs of an experiment" | **moved**; same run-loop condition |
| GET | `/api/experiments/runs/:runId` | hma(evaluations:view, apiKey) | 200 run status; 401/404 | same | yes — "Poll a run" | **moved**; same |
| GET | `/api/experiments/runs/:runId/results` | hma(evaluations:view, apiKey) | 200 results; 401/404 | same | yes — "Read run results" | **moved**; same |
| GET | `/api/experiments/:slug/workbench-state` | hma(experiments:view, apiKey) | 200 state or version probe; 400/401/404 | same | yes — "Read an experiment's setup" | **moved**; answers regardless of the run loop |
| PUT | `/api/experiments/:slug/workbench-state` | hma(experiments:update, apiKey) | 200 `{version}`; 400/401/404/409 | same | yes — "Save an experiment's setup" | **moved**; same |
| GET | `/api/experiments/:slug/versions` | hma(experiments:view, apiKey) | 200 `{versions, nextCursor}`; 400/401/404 | same | yes — "List an experiment's versions" | **moved**; same |
| POST | `/api/experiments/:slug/versions/:version/restore` | hma(experiments:update, apiKey) | 200 `{version}`; 400/401/404/409 | same | yes — "Restore an experiment version" | **moved**; same |
| ALL | `/api/evaluations/v3/*` | none of its own — rewrites and re-dispatches into the family above | whatever the target answers | must mount after the family it forwards to | no | **moved**; the mount returns both apps in registration order, so the alias cannot be served without its target |
| GET | `/api/evaluations/list` | pub | 200 `{evaluators}` (module-cached catalogue) | — | yes — "List the built-in evaluators", `security: []` | **moved** → `@langwatch/evaluation-server`; the catalogue is compiled in, so it needs nothing |
| POST | `/api/evaluations/batch/log_results` | hma(evaluations:manage, apiKey) | 200 `{message:"ok"}`; 400 ×4; 401; 403; 500 | 20 MB cap | yes — "Report batch evaluation results" | **moved and now MOUNTED** — the find-or-create rule is `ExperimentFindOrCreateService`, and this door is handed the SAME instance `/api/experiment/init` resolves through |
| POST | `/api/evaluations/:evaluator/evaluate` | hma(evaluations:manage, apiKey) | 200 evaluate result; 400/401/403/404 | 30 MB cap | yes — "Run an evaluator" | **moved and now MOUNTED** — over the evaluator runtime `api-evaluator-execution.composition.ts` composes; still off where the deployment names no `LANGEVALS_ENDPOINT` |
| POST | `/api/evaluations/:evaluator/:subpath/evaluate` | hma(evaluations:manage, apiKey) | same | 30 MB cap | yes — "Run a namespaced evaluator" | **moved and now MOUNTED**, same runtime and same condition |
| POST | `/api/guardrails/:evaluator/evaluate` | hma(evaluations:manage, apiKey) | same, guardrail mode (`passed` always set) | 30 MB cap | yes — "Run an evaluator as a guardrail" | **moved and now MOUNTED**, same runtime and same condition |
| POST | `/api/dataset/evaluate` | hma(evaluations:manage, apiKey) | 200 result; 400 ×3; 401; 403; 404; 413 plain text | 30 MB cap | yes — "Evaluate a dataset" | **moved and now MOUNTED**, same runtime and same condition |
| POST | `/api/dataset/generate` | hma(datasets:manage, session) | 200 UI-message stream; 400/401/403 `{error}` | **before the dataset family's `/:slugOrId`** | no | **moved** → `@langwatch/dataset-server`; mounted where this process holds a session and a model gateway |
| POST | `/api/scenario/generate` | hma(scenarios:manage, session) | 200 `{scenario}`; 400/401/403; 400 `{error, domainError}`; 504; 500 | — | no | **moved** → `@langwatch/scenario-server`; same condition |
| POST | `/api/workflows/code-completion` | hma(workflows:manage, session) | 200 completion; 400/401/403/500 `{error}` | — | no | **moved** → `@langwatch/workflow-server` `workflow-studio.api.ts` |
| POST | `/api/workflows/post_event` | hma(workflows:manage, session) | SSE studio events; 400/401/403; 410 `optimize_disabled`; 422; 425; 500 | — | no | **moved**; one app with the completion door, so the family needs both the workflow application and the studio dispatch |
| POST | `/api/playground` | hma(playground:manage, session) | 200 streamed text; 400/401/403 `{error}` | — | no | **moved** → `@langwatch/model-provider-server`; mounted where this deployment named an execution proxy |

###### `misc.ts` — the thirteen, all resolved; the file is deleted

Four left in REST wave 3d: `POST /api/experiment/init` and the three
synchronous workflow-run URLs. The nine below were five unrelated verticals
sharing one `secured` handle, and each left with its own owner rather than as a
route file. Seven are packaged and mounted, one is packaged and refused by name,
and two were deleted outright — neither appears in the published document
(`platform/app/scripts/openapi-route-exclusions.ts` already excluded both) and
neither has a caller in this repository.

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/analytics` | hma(analytics:view, apiKey) | 200 timeseries; 400 `{message}` / `{error}` / `{code, message}` | — | yes — "Query analytics timeseries (legacy path)" | **moved** → `@langwatch/analytics-server` `analytics-legacy.api.ts`; mounted. Its own family, not a second route on `createAnalyticsRestApp`, precisely because the three 400 bodies differ — they are transcribed rather than folded into the canonical door's envelope |
| POST | `/api/demo/hotel_bot` | hma([], apiKey) | 200 `{message, ragResponse?}`; 401; 500 | forwards its own token to `/api/collector` | no | **deleted**. A seeded RAG demo that posted to our own collector with a token it minted for itself; no caller in the repository, excluded from the document, and the dogfood path is the CLI. Reviving it means writing it against `apps/api`'s collector, not restoring this handler |
| POST | `/api/dspy/log_steps` | hma(experiments:manage, apiKey) | 200 `{message:"ok"}`; 400 ×3; 401; 403; 500 | 20 MB cap | yes — "Report DSPy optimizer steps" | **moved** → `@langwatch/experiment-server` `experiment-dspy-steps.api.ts`; mounted. The catalogue is a REQUIRED port fed from the model-provider host this process already composes, and pricing is `matchModelCost`/`estimateCost` from `@langwatch/model-provider-contract` — the same arithmetic the trace fold uses. A process with no catalogue does not mount the family, rather than recording every run as free |
| POST | `/api/experiment/init` | hma(experiments:manage, apiKey) | 200 `{path, slug}`; 400; 401; 403 `{error, limitType, current, max}` | — | yes — "Create an experiment" | **moved** → `@langwatch/experiment-server` `experiment-init.api.ts`; the 403 limit branch is transcribed on the CODE but unreachable — no licence enforcement is composed here |
| POST | `/api/mcp/authorize` | hma([], session) | 200 `{redirect}`; 400 ×3; 401; 403; 500 | **demo-project check before the RoleBinding probe** — a demo project grants global `project:view` and must never reach it | no | **moved** → `@langwatch/hosted-mcp-server` `mcp-authorize.api.ts`; mounted. The demo-project refusal is its own port and still runs BEFORE the permission probe, which would pass for the demo project |
| POST | `/api/optimization/:workflowId/:versionId` | hma(workflows:manage, apiKey) | shared with the workflow run below | delegates to the same handler so the two cannot drift | yes — "Run a workflow version (legacy path)" | **moved** → `@langwatch/workflow-server` `workflow-run.api.ts` |
| POST | `/api/track_event` | hma(traces:create, apiKey) | 200 `{message:"Event tracked"}`; 400 ×2; 401; 403 | shares `track-event.service` with `/api/events/track` | yes — "Track an event (legacy path)" | **named absence** (`tracked-events`), logged at boot with both URLs. `@langwatch/trace-server` owns `tracked-event.api.ts`, but the span builder it records through was the retired application's and no package owns it; mounting would accept a customer's feedback event and record nothing |
| POST | `/api/track_usage` | pub | 200 `{message}`; 400; 429 + `Retry-After` | global → per-IP before the body parse, per-instance after | no | **deleted**. An unauthenticated PostHog relay for the marketing site, excluded from the document and with no caller in the repository; the rate limiting (#6071) existed only because it was open. A product-usage signal belongs on the telemetry path, not on a public REST door |
| POST | `/api/trigger/slack` | hma(triggers:manage, apiKey) | 200 `{message}`; 400 `{message, errors?}`; 401; 403; 500 | superseded by `/api/triggers` | yes — "Create a Slack alert trigger" | **moved** → `@langwatch/automation-server` `slack-trigger.api.ts`; mounted alongside `createTriggerRestApp`, which is why the `triggers` family builds two apps |
| POST | `/api/workflows/:workflowId/run` | hma(workflows:manage, apiKey) | 200 run result; 400/401/403/404 | — | yes — "Run a workflow" | **moved**; three URLs, one handler |
| POST | `/api/workflows/:workflowId/:versionId/run` | hma(workflows:manage, apiKey) | same | canonical target of the legacy alias above | yes — "Run a specific workflow version" | **moved**; same |
| POST | `/api/webhooks/stripe` | int (signature verified in-handler) | 200 `{received}`; 404 `{error}` off SaaS; 400 text ×2 | — | no | **moved** → `@langwatch/enterprise-billing-server` `stripe-webhook.api.ts`; **not mounted** — this process composes no Stripe client, and the signature check is the whole security of the door. The two refusals stay `text/plain`, which is what Stripe's delivery log renders |
| GET | `/api/image-proxy` | pub | 200 image bytes; 400 ×2; 500; upstream status passthrough | SSRF guard | no | **moved** → `apps/api/src/features/image-proxy/image-proxy-rest.ts`; mounted over `@langwatch/egress` (`createSsrfUrlValidator` + `fetchValidatedDestination`, redirects not followed, TLS verified). Every failure answers the one opaque `{error:"Failed to fetch image"}`, so the door never reports the deployment's own network |

###### Traces, annotations and shares

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/annotations` | hma(annotations:view, apiKey) | 200 `{data}`; 401 `{message}`; 500 `{status, message}` | — | no | **moved** → `@langwatch/annotation-server` |
| GET | `/api/annotations/:id` | hma(annotations:view, apiKey) | 200 `{data}`; 404 `{status, message}`; 401; 500 | — | no | **moved** |
| DELETE | `/api/annotations/:id` | hma(annotations:manage, apiKey) | 200 `{status, message}`; 401; 500 | — | no | **moved** |
| PATCH | `/api/annotations/:id` | hma(annotations:manage, apiKey) | 200 `{data}`; 400 ×3 named sentences; 401; 500 | — | no | **moved** |
| GET | `/api/annotations/trace/:id` | hma(annotations:view, apiKey) | 200 `{data}`; 401; 500 | — | no | **moved** |
| POST | `/api/annotations/trace/:id` | hma(annotations:**create**, apiKey) | 200 `{data}`; 400 ×4; 401; 500 | `:create` not `:manage` — deliberate, see the handler | no | **moved** |
| GET | `/api/trace/:id` | hma(traces:view, apiKey) | 200 digest or full trace; 404 `{message}`; 401; 500; `Deprecation: true` + successor `Link` | — | no | **moved** → `@langwatch/trace-server`, over this process's `TraceApp` |
| POST | `/api/trace/:id/share` | hma(traces:**share**, apiKey) | 200 `{status, path}`; 401 | — | no | **moved**, over the SAME share ledger the product writes |
| POST | `/api/trace/:id/unshare` | hma(traces:share, apiKey) | 200 `{status}`; 401 | — | no | **moved**, same family |
| POST | `/api/trace/search` | hma(traces:view, apiKey) | 200 `{traces, pagination}`; 400 `{error}`; 401; `Deprecation` + `Link` | — | no | **moved**; the strict body is the deployment's own filter vocabulary, supplied at the mount |
| GET | `/api/thread/:id` | hma(traces:view, apiKey) | 200 `{traces}`; 401 | — | no | **moved**, same family |
| POST | `/api/traces/search` | req(traces:view) | 200 search result | — | yes | **moved** → `@langwatch/trace-server`, over the composed read stack |
| GET | `/api/traces/:traceId/transcript` | req(traces:view) | 200 transcript | — | yes | moved with the family; **route not registered** — no coding-agent session store and no log canonicaliser, so it 404s rather than answering an empty transcript |
| GET | `/api/traces/:traceId` | req(traces:view) | 200 trace | — | yes | **moved**, same family |
| PATCH | `/api/traces/:traceId/metadata` | req(traces:update) | 200 | — | yes | **moved**; registered only where the process holds the `trace_processing` producer the amendment span rides |
| POST | `/api/export/traces/download` | hma(traces:view, session) | streamed CSV/JSONL, `X-Export-Id`, `X-Total-Traces` | mounted directly, **outside** the audited list | no | service moved → `@langwatch/trace-server` (`TraceExportService`); mount blocked on the read stack, session and broadcast reaching `composeDoors` |
| POST | `/api/export/scenario-runs/download` | hma(scenarios:view, session) | streamed gzipped CSV, `X-Export-Id`, `X-Total-Runs` | inside `createApiProcessRestFeatures` | no | **moved** — mounted where the process holds BOTH a browser-session transport and the simulation store; absent otherwise |

###### Langy, gateway, GitHub and vendor webhooks

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/langy/conversations` | hma(langy:create, apiKey), canonical envelope | 202 turn, or 200 settled under `Prefer: wait=N`; **`c.notFound()`** when dark | credential (401) → dark 404 → ceiling (403) → service; the dark check must NEVER throw | no | **moved** → `@langwatch/langy-server`, over the agent group's own `LangyApp` |
| POST | `/api/langy/conversations/:conversationId/messages` | hma(langy:create, apiKey) | same; `adoptConversationId` valid only here | same | no | **moved**, same family |
| POST | `/api/langy/ui/actions` | hma(experiments:view, experiments:update, evaluations:create; apiKey) + per-action ceiling | 200 dispatch outcome; `notFound()` when dark | **unknown `kind` before the per-action ceiling**, so the error names the real problem | no | **moved**; mounted where this process has Redis, over an EMPTY catalogue — every kind refuses by name |
| GET | `/api/langy/ui/actions` | same policy | 200 `{actions:[{kind, permission, backend, payloadSchema}]}` | same dark check | no | **moved**; answers `{actions: []}` here, honestly — the only catalogue is the workbench's browser module |
| POST | `/api/internal/langy/turn/:turnId/result` | int (builder `verifySecret`) | 202 `{status:"accepted"}`; 404 `{error}`; raises `ValidationError` | turn-existence cross-check **before** the ingest write, to reject forged cross-tenant triples | no | **moved**; `LANGY_INTERNAL_SECRET` is now an `api.config` value |
| POST | `/api/internal/langy/credentials/revoke` | int | 200 `{outcome}`; 404 `{outcome:"not_found"}`; 403 `{error}` | — | no | **moved**, same family |
| POST | `/api/internal/langy/relay/frames` | int | 200 `RelayTally` once the ndjson stream ends; 400 `{error}`; 503 `{error}` | shares the secret gate with `langy-internal` under the same basePath | no | **moved**; mounted only with Redis — a relay with no live buffer refuses rather than drops |
| GET | `/api/internal/gateway/health` | int (HMAC `verifyGatewaySignature`) | 200 `{status:"ok"}` | signature compared **before** the timestamp check (timing side-channel) | no | **moved** |
| POST | `/api/internal/gateway/resolve-key` | int | 200 `{jwt, revision, key_id, display_prefix}`; 400/401/403 `{error:{type, code, message}}` | — | no | **moved** |
| POST | `/api/internal/gateway/codex/refresh` | int | 200 `{access_token, account_id}`; 400/401/404; 503 `codex_refresh_unavailable` where no provider service | — | no | **moved** |
| GET | `/api/internal/gateway/config/:vk_id` | int | 200 config + ETag; 304; 404 | — | no | **moved** |
| GET | `/api/internal/gateway/changes` | int | 200 `{current_revision, changes}`; 204 + `X-LangWatch-Revision`; 400 | short long-poll, 2s sleeps, ~10-25s cap | no | **moved** |
| POST | `/api/internal/gateway/guardrail/check` | int | 200 verdict; 400; 503 `guardrail_evaluation_unavailable` | — | no | **moved and serving** — `runEvaluator` is bound to the process's one evaluator runtime; the 503 is now only a deployment that named no `LANGEVALS_ENDPOINT` |
| GET | `/api/internal/gateway/budget-bucket-spend` | int | 200 `{spent_micro_usd, bucket}`; 400/404 | — | no | **moved** |
| POST | `/api/internal/gateway/spend-commands` | int | 200 `{accepted, rejected}`; 400; 503 `spend_pipeline_disabled` | at-least-once, per-record acceptance | no | **moved and serving** — `apps/api` registers the gateway-spend pipeline producer-only; the 503 is now only a process with no queue |
| POST | `/api/internal/gateway/realtime-sessions` | int | 200 `{session_id, status:"OPEN"}`; 400; 429; 503 `realtime_sessions_unavailable` | the gateway must call this **before** minting | no | **moved and serving**, over that same registration's `confirmSpend`; the settlement span is the one remaining absence (money lands, the trace carries no cost line) |
| PATCH | `/api/internal/gateway/realtime-sessions/:session_id` | int | 200 `{session_id, updated}`; 400/404; 503 | — | no | **moved and serving**, same |
| POST | `/api/internal/gateway/realtime-sessions/:session_id/usage` | int | 200 `{session_id, status:"CLOSED"}`; 400/404; 503 | — | no | **moved and serving**, same |
| GET | `/api/internal/gateway/bootstrap` | int | 501 `{error:{code:"not_implemented"}}` | — | no | **moved** (still the 501 stub it always was) |
| GET | `/api/github/install` | hma(organization:manage, session) | 302 to GitHub; 400/401/403 ×2/503 | membership check **first**, then the permission probe | no | **moved** → `@langwatch/github-server`; mounted only where a host supplied the Better Auth transport |
| GET | `/api/github/setup` | pub (protocol-mandated; HMAC state verified in-handler) | 200 popup HTML or 302; 400/401/403/502 | state → session rebind → nonce → membership → permission, in that order | no | **moved**, same family |
| POST | `/api/github/webhook` | pub (`X-Hub-Signature-256` verified in-handler) | 200 `{received}` for everything acknowledged; 400/401/404 | HMAC over the **raw** body before any parse | no | **moved**, same family |
| GET | `/api/github-langy/setup` | pub | alias of `/api/github/setup` | kept until a deprecation path exists | no | **moved**, same family |
| POST | `/api/github-langy/webhook` | pub | alias of `/api/github/webhook` | same | no | **moved**, same family |
| POST | `/api/elevenlabs/webhook/:modelProviderId` | pub (`ElevenLabs-Signature` HMAC, per-tenant secret) | 200 `{received}`; 400/401/404 | 404 for an unknown provider id doubles as anti-enumeration | no | **moved and now MOUNTED** — `composeApiGatewayRealtimeSessions` publishes the `GatewayRealtimeSessionCollaborators` bag the booking uses, so the settlement prices through the same adapter class; absent without the cipher or the spend confirmation |
| POST | `/api/webhooks/auth0-scim` | int | 200 `{received}`; 400/401/404 | — | no | moved → `@langwatch/enterprise-scim-server`; not mounted, same reason |

###### Transports and the packaged families still mounted from platform

| Method | Path | Auth | Response | Ordering | OpenAPI | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET,POST | `/api/trpc/*` | hma([], both) | tRPC fetch-adapter response; escaped throws become a tRPC-shaped 500 envelope | GET before POST | no | superseded — `apps/api` serves its own `/api/trpc`; `routes/trpc.ts` **deleted** |
| GET | `/api/sse/*` | hma([], session) | `text/event-stream`; 400/404 `{message}` | — | no | superseded — `createSseSubscriptionApp` serves the same wire; `routes/sse.ts` **deleted** |
| — | `/api/scim/v2/*` (15 routes) | 3× pub discovery, 12× int | SCIM protocol errors as `application/scim+json` | — | yes | moved → `@langwatch/enterprise-scim-server`; **not mounted** — this process refuses the Enterprise SCIM application by name |
| POST | `/api/analytics/timeseries` | req(analytics:view) | 200 `{currentPeriod, previousPeriod}` | — | yes | **moved** — over the analytics half's own `AnalyticsApp`; the body is the package's `timeseriesInputSchema` (metric/group-by no longer enum-narrowed at the wire) |
| — | `/api/v1/projects/:projectId/analytics/*` (9 routes) | req(analytics:view/create/update/delete) | canonical envelope | LangWatchQL routes then saved-chart routes | yes | **moved** — the whole family into `@langwatch/analytics-server`; the saved-chart half arrives through a port over `DashboardApp` |
| — | `/api/organization/*` (10 routes) | org policy + Enterprise gate on every route | versioned management envelope | plan gate after RBAC | yes | **moved** — 7 of 10 answer; the 3 invitation routes refuse `service_unavailable` (no `InviteService`) |
| — | `/api/prompts/*` (13 routes) | req(prompts:view/create/update/manage) | — | `:id{.+?}` sub-resources before the bare `:id{.+}` | yes | **moved** — over the product-group half's `PromptApp`; the nurturing trail logs instead of firing |
| — | `/api/v1/secret`, `/api/v1/secrets`, `/api/secret` (5 ops × 3 bases) | per-op RBAC | — | — | yes | **already served by `apps/api`** (`ApiSecretRestFeature`, plus `/api/secrets`) |
| — | the 30 families of the packaged enumeration | mixed | — | mounted per family, conditionally | mixed | **moved** → `apps/api/src/app-rest/app-rest.packaged-families.ts`, bound by `composeApiPackagedRest`. `createAppRestFeatures` is **deleted**: 27 families mount from services this process already composes, and 3 (`user-avatar`, `tracked-events`, `copilotkit`) are named absences logged at boot |

##### What moved, and the shape the rest follows

`apps/api` mounts every family through **one** enumeration,
`createApiProcessRestFeatures`
(`apps/api/src/app-rest/app-rest.process-features.ts`), iterated once in
`ApiProductionComposition.composeDoors`. It began as a second list beside
`createAppRestFeatures` for a structural reason: that one was all-or-nothing
over thirty-two product services, `apps/api` composed none of them, and calling
it would have mounted thirty-two families over throwing stubs. **The final REST
lane closed that gap and deleted it.** The thirty product families are now
`apps/api/src/app-rest/app-rest.packaged-families.ts`, a per-family conditional
enumeration bound by `composeApiPackagedRest`, which TAKES the services the
process already composed (the ten tRPC collaborator halves publish nearly all of
them) rather than building a second copy at the mount. The invariant is
unchanged and now holds everywhere: a family whose service this process did not
compose is left OUT and named at boot, not mounted answering 500.

Landed:

- **Discovery** — `apps/api/src/features/discovery/`. The generated document
  moved with it (`openapi-document.json`), so `platform/app/src/app/api/openapiLangWatch.json`
  is gone and `generateOpenAPISpec`, `check-openapi-route-coverage`,
  `check-openapi-completeness` and `vite.config.ts` are broken by design.
- **Annotations** — `packages/features/annotation/server/src/transport/api-rest/annotation.api.ts`,
  the first `handlerManagedAuth` family to move. It proves the port the other 61
  such rows need: the family declares its policy (so the registry sees it) and
  takes credential resolution as `AnnotationRestCredentialPort`, which
  `ApiHandlerManagedCredentials` implements against the SAME `ApiKeyService` and
  `AuthzService` the framework chain uses — same decision, different sentence.
- **Browser telemetry ingest** — `apps/api/src/features/rum/`. The one thing the
  ingest service reached that the process owns is the fixed-window counter, so
  it became `RumRateLimiter` and is bound to the process's ONE
  `ApiRateLimitInfrastructure` — the same counter the packaged families and the
  identity throttles meter through, rather than a second budget for one rule.
  Its twelve attacker-side scenarios moved with it, driving a real in-memory
  counter rather than a stub, because two of them are about WHICH key is asked
  for and in what order.
- **OTLP ingest** — `packages/features/trace/server/src/transport/api-rest/otlp-ingest.api.ts`
  and `otlp-path-alias.api.ts`, composed by
  `apps/api/src/app/api-trace-ingest.composition.ts`. This is the deployment's
  critical path and it now serves for real: a span posted to
  `POST /api/otel/v1/traces` reaches this process's own `recordSpan` producer on
  the `trace_processing` pipeline the worker drains, through the packaged
  `TraceIngestionService`, the frozen Redis dedup keyspace and the receiver's own
  provenance rewrite. The OTLP WIRE vocabulary moved out from under it into
  `@langwatch/otlp` (`body.ts`, `errors.ts`, `path-canonicalisation.ts`), where
  the governance ingest receiver can reach it without importing a feature
  package; `bodyLimit` moved into `@langwatch/api/rest`, which retires the
  throwing stub `app-rest.features.ts` held for it; and `collectAuthDiagnostics`
  moved there too, so a 401 on this path still carries the fingerprint on-call
  filters by.
  `apps/api/src/app/__tests__/api-trace-ingest.otlp.integration.test.ts` posts a
  REAL protobuf export and a REAL JSON one through the mounted Hono app and
  asserts the producer received the command, with the two encodings agreeing on
  the trace id.

**Measured over the tables above at the FINAL REST lane, 2026-09-03: 131 route
rows plus 9 mount rows. Of the 131: 97 serve from `apps/api`, 30 are moved but
deliberately unmounted or named absences, 4 are deleted rather than moved, and
NONE are blocked on a capability this process cannot reach.** Of the 9 mount
rows, 5 serve, 2 are superseded and deleted (`routes/trpc.ts`, `routes/sse.ts`),
1 is moved-but-refused-by-name (SCIM), and the last is the packaged enumeration
itself — 30 families, 27 mounted and 3 named absences. The header's 156 is the
count before this programme's concurrent lanes started deleting rows, and rows
retire from the tables as they land; re-derive by counting rows in the sections
above `###### Transports and the packaged families` rather than trusting either
number in prose.

The 61 recorded at the wave-3c checkpoint were the 17 the OTLP/export/webhook
slice left, the 34 product REST wave 3b moved (1 analytics timeseries,
9 governed SQL, 13 prompts, 10 organization management — 7 answering, 3
refusing by name — and the bulk run export), and the 10 the trace and
evaluation verticals moved: 3 of the 4 v1 trace reads, all 5 deprecated
`/api/trace/*` endpoints, the SDK collector and the evaluator catalogue.
REST wave 3d adds 26: the 5 subsystem health probes, the workbench's 10 doors
plus its `/api/evaluations/v3` alias, the 4 authoring doors and the playground,
the 3 synchronous workflow-run URLs, `POST /api/experiment/init`, and the batch
result log that door unblocks. The concurrent auth/Langy/GitHub, governance,
gateway and leftovers lanes account for the rest in the same working tree.

##### Decisions recorded while moving

- **`POST /api/ops/clickhouse/explain` stayed put until the ClickHouse
  composition could answer it. Resolved in the final REST lane, and the answer
  was NOT to widen the seam.** The endpoint is cross-tenant BY DESIGN — the
  optimizer agent runs EXPLAINs across the fleet — and
  `ApiClickHouseInfrastructure` deliberately hands out only a tenant-keyed
  `resolveClient`, with no `shared()`, precisely so a caller cannot read one
  organization's data on another's endpoint. Adding a `shared()` to satisfy one
  operator endpoint would have removed that property for all thirty-odd read
  paths that depend on it. So the family got its own third identity instead:
  `api.config.ts` reads `CLICKHOUSE_OPS_URL` as its own leaf,
  `apps/api/src/features/ops/ops-clickhouse-explain-rest.mount.ts` composes a
  SEPARATE readonly runtime from it, and the transport moved to
  `@langwatch/ops-server`. The dev-time default-user fallback is dropped on
  purpose: with no `CLICKHOUSE_OPS_URL` or no `LANGWATCH_OPS_API_KEY` the family
  is not mounted, so an unprovisioned deployment answers 404 rather than
  standing an open door up behind a 503.
- **`_lib/body-limit.ts` was NOT pre-moved.** Nine of the blocked families want
  it, but nothing in `apps/api` calls it yet, so moving it now would land dead
  code ahead of its consumers. It moves with the first ingestion family. **Done
  2026-09-02** — it moved to `packages/api/src/rest/body-limit.ts` with the OTLP
  receiver, which is the first family in `apps/api` to apply it, and the
  throwing stub in `app-rest.features.ts` now has a real implementation to bind.

- **The OTLP LOG and METRIC signals are not mounted, deliberately.** Their
  collections (`LogRequestCollectionService`, `MetricRequestCollectionService`)
  are still in `platform/app/src/server/app-layer/traces/**` and this process
  composes neither the log nor the metric fold, so their routes are not
  registered at all. Each signal's collection is a separate port on
  `createOtlpIngestRestApp`, so an exporter posting logs gets a 404 from a
  receiver that honestly does not serve them rather than a 500 from one that
  pretends to. The trace signal is unaffected.

- **An ingestion key is refused rather than mis-priced.** `resolveSourceNonBillable`
  is Enterprise governance's and `apps/api` composes no governance, so the
  provenance resolver is an optional port. Traffic on an ORDINARY project key is
  unaffected — it carries no source identity to stamp — and traffic on an
  INGESTION key raises `service_unavailable` (503, fault `platform`). Stamping a
  guessed `nonBillable` instead would silently price a bundled coding session as
  real spend, which is worse than refusing.

- **The OTLP receiver enforces no plan allowance.** `apps/api` composes no usage
  meter, so `usageLimit` returns rather than refuses. That is the SAME degradation
  the receiver has always had when the allowance LOOKUP failed — the batch is
  accepted and the failure logged — because telemetry a customer already paid to
  produce must not be dropped by a meter this process cannot read. Reported once
  at boot by `LoggedApiTraceIngestAbsence`, not per request.

- **The coding-agent span filter runs over a stand-in.** `TraceIngestionService`
  takes a whole `CodingAgentService` to reach one dependency-free rule on its base
  class. `ApiSpanFilterOnlyCodingAgents` inherits that rule and refuses all eleven
  session reads by name — the same shape `createTraceProcessingProducerPipeline`
  already uses for the consumer-side collaborators a producer does not hold.
  Collapsing the pair into a `spanFilter` port is the tidier shape and is left
  alone here because the signature is the trace package's, not this lane's.

- **`POST /api/collector` did NOT move.** Its two remaining ingest rules,
  `maybeAddIdsToContextList` and `extractChunkTextualContent`, live in
  `packages/features/trace/web/src/behavior/tracer/collector/rag.ts` — a server
  ingest rule parked on the WEB side by the UI drain, which a server transport
  may not import. Nothing in `trace/web` imports them either, so the module is
  dead where it sits; moving it is one file of a live lane's tree and belongs to
  whoever owns that parking. **Done 2026-09-02** — REST wave 3c found the
  parking already cleared: both rules are `@langwatch/trace-contract`'s
  `trace-rag-chunks.ts`, so the route moved to
  `packages/features/trace/server/src/transport/api-rest/collector.api.ts` and
  serves from `apps/api` over the same ingestion service the OTLP receiver uses.

- **The back-office family moved but is not mounted.** `/api/admin/*` is now
  `packages/features/ops/server/src/transport/api-rest/admin.api.ts`, taking its
  two session reads as ports. `apps/api` does not mount it because its browser
  session port answers the VERIFIED session, which carries no `impersonator`
  field — and without it `DELETE /api/admin/impersonate`, the only way OUT of an
  impersonation, refuses. Mounting it over that gap would ship a back-office an
  admin cannot leave.

- **`_lib/internal-secret.ts` was NOT moved.** Its one consumer is
  `routes/cron.ts`, whose family is blocked on `nlpLambda` and the dogfood seed
  script, and it reads `process.env.CRON_API_KEY` directly, which is a config
  seam `apps/api` resolves through `api.config.ts`. Moving it now is the
  `body-limit` precedent inverted: dead code ahead of its consumers.

- **`server/api-key/auth-middleware.ts` stays in platform.** It is the platform
  application's REST authenticate-then-authorize chain, bound to `appFromContext`,
  `getApp`, `~/server/api/rbac` and the platform Prisma client; `apps/api` has its
  own (`ApiRestSecurity`, `ApiHandlerManagedCredentials`,
  `extractApiKeyRequestCredentials`), and every one of the module's consumers is a
  platform route that is itself blocked. The one genuinely portable piece,
  `collectAuthDiagnostics`, moved to `@langwatch/api/rest` and the OTLP receiver
  uses it.

- **Five of the seven `server/webhooks/**` modules were DELETED, not moved.**
  `@langwatch/egress` already carries a frozen twin of `signature`, `urlPolicy`,
  `httpDestination`, `dispatchBudget` and `sendWebhook`, `apps/worker` already
  serves from it, and the signature-vector conformance test that reads
  `specs/webhooks/signature-vectors.json` lives there too and stays green. The
  transports that had no twin — the HTTP and SQS destinations, the destination
  factory, the queue-URL rules and the delivery-log retention sweep — moved into
  `@langwatch/enterprise-webhook-server`, where the SQS transport the worker
  refuses by name now has a home. `buildAwsClientConfig` and the dispatch counter
  became ports there rather than module singletons.

- **`traced()` moved to `@langwatch/observability`.** It was
  `platform/app/src/server/app-layer/tracing.ts` with three consumers, and TWO of
  them were already inside packages importing `~/server/app-layer/tracing` — so
  the move fixes committed breakage rather than creating any.

- **`scenario-run-export/types.ts` moved to `@langwatch/scenario-contract`.**
  Commit `f3cff9161f` had parked it in `scenario/web`'s model while three server
  modules still imported it from the platform path it no longer occupied. The
  contract is where both halves can name it, and the one web consumer now does.

##### Parity exceptions recorded

- `GET|HEAD /api/health` answers from `ApiProcessLifecycleRoutes`, which
  registers it as a plain Hono route with **no** access policy, so it is absent
  from the route-policy registry the authorization audit reads. Wire-identical
  (204, empty); registry-invisible. Deliberate: it must answer before REST
  security exists.
- The moved discovery family is byte-identical, but the document it serves is
  now regenerated by nothing — the generator still writes to the platform path
  that no longer exists. Wave 9 owns re-pointing it.
- `packages/features/annotation/server` is not a `layoutVersion: 0` package, so
  the adapter follows the `transport/api-rest/<subject>.api.ts` convention the
  other feature packages use rather than the `api/rest/` path the slice brief
  named.
- The OTLP receiver's UNAUTHENTICATED sentence changed. Platform answered
  "Authentication token is required. Use X-Auth-Token header or Authorization:
  Bearer token."; it now answers the three-shape sentence
  `ApiHandlerManagedCredentials` publishes, which also names
  `Authorization: Basic base64(projectId:token)`. That credential shape was
  always accepted by `extractCredentials` on this path, so the new sentence is
  the more accurate of the two — but it IS a wire change and a deployed SDK
  quoting the old copy will show different words.
- The OTLP receiver carries no `LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER`
  kill switch. Platform read it at boot and defaulted the filter ON; `apps/api`
  hard-codes ON and does not read the variable, so a deployment that had turned
  the filter off keeps its coding-agent spans on platform and drops them here.
- `packages/features/trace/server`'s two ClickHouse repository integration tests
  fail to load on this branch, and did before this lane: they import
  `platform/app/src/server/event-sourcing/__tests__/integration/testContainers`,
  which no longer exists. 2 files fail; the other 133 and all 2,243 assertions
  pass.
- `@langwatch/enterprise-webhook-server` now declares `WebhookDispatchResult`
  twice — the transport port's fuller shape and the delivery service's narrower
  restatement of it. The duplication is pre-existing on the delivery side; the
  index exports only the delivery one, so no caller sees both. Collapsing them
  belongs with whoever wires the worker's SQS transport.

#### Internal tRPC

**State 2026-09-02:** the 22-namespace record composes on `apps/api`'s own root
(`0fc9e4120d`); what is left is the collaborator services it refuses to compose
without, and the `root.ts` ports block that goes when they land. The paragraph
below is the seam history.

- [x] Establish the transport seam every vertical copies. GitHub
      (`172b31e456`) is the reference: `<Feature>TrpcApi.create(root, {
      protected, policy }, ports)` in the package, and a thin process mount that
      supplies `appTrpcRoot`, the authenticated procedure, the policy chain and
      the concrete ports.
- [ ] Replace each module under `server/api/routers/**` with an owning feature
      app-tRPC adapter over the canonical service.
- [ ] Keep exact procedure names, input/output shapes, transformer, errors,
      permissions, audit and trace behaviour.
- [ ] Move router integration/characterisation tests with each vertical.
- [ ] Delete each old router immediately after the live root mounts its package
      adapter; delete `server/api/root.ts` when the final router moves.

**The ordering rule this wave keeps rediscovering.** tRPC appends its input
middleware at the point `.input()` is called, so any middleware installed ahead
of it receives `input === undefined`. A `policy` composed onto the bare
procedure therefore produces an authorization check that reads no scope id, a
scope-lineage guard that compares nothing, and an audit row with no arguments,
no project and no organization — and every one of those failures is silent. The
policy must be applied by the feature *after* its own input parser:
`policy(permission)(procedure.input(schema)).mutation(...)`. Two of the guards
that should have caught this were themselves broken (`F-API-03`); assume a new
vertical is wrong here until its authorization declaration appears in the sweep.

**Every moved procedure keeps a declaration.** `permissionProcedureBuilder`
makes that structural: after `.input()` it exposes only
`input`/`use`/`permission`/`permissionAny`/`noPermission`/`authorizeInService`
and no `.mutation`/`.query`, so an undeclared procedure cannot be built. Where
the scope genuinely is not in the input — the caller names the scope and the
service decides, or the project is read from stored data — use
`authorizeInService` with an honest reason rather than inventing a permission
the transport cannot check.

#### Other transports and clients

- [ ] Re-home MCP handlers, CLI bootstrap, webhooks, ingestion, cron and internal
      service endpoints by owner/trust boundary.
- [ ] Regenerate OpenAPI and TypeScript/Python/Go/MCP clients only from accepted
      transport changes.
- [ ] Use `openapidiff` against `main` for every public API batch.

Gate: `apps/api` serves the complete live route inventory and
`platform/app/src/server/api*`, `src/app/api`, `pages/api` and old API middleware
have no production responsibility.

### Wave 4: worker and Eventing application

- [ ] Compose `WorkerEventingRuntime` from production EventStore, ProcessStore,
      Group Queue, retention and execution targets.
- [ ] Register every feature pipeline before queue readiness.
- [ ] Install both producer-required command surfaces and worker consumers.
- [ ] Preserve deterministic projections/process managers and retry-safe,
      idempotent effect intents.
- [ ] Migrate pipeline groups in this order when dependencies permit:
  1. Topic plus Trace assignment;
  2. AuthZ grants, Metric and Log;
  3. Automation and GitHub maintenance;
  4. Trace processing and blob/process-manager maintenance;
  5. Evaluation, Scenario, Suite and Experiment;
  6. Coding Agent and Langy conversation/maintenance;
  7. Gateway spend;
  8. Enterprise Governance and Billing reporting;
  9. SSO/SCIM and remaining operational pipelines.
- [ ] Move manual tasks, schedules and child processes to worker-owned command
      dispatch; no task boots the universal App.
- [ ] Preserve replay/backfill, process-manager retention, wake scheduling,
      large-payload offload, delivery keys, metrics and shutdown ordering.

Gate: a fresh worker process consumes all queues and scheduled work without
`platform/app`, while API producers dispatch through the same Eventing
commands. Then delete old worker/runtime/event-sourcing/task registrations.

#### Capability extraction ledger (census 2026-09-01)

Of the 24 capabilities `packaged-worker.capabilities.ts` mapped, how each one
reaches the packaged worker — the migration is turning every "synthesized"
row into the eventing-maintenance shape (platform hands ports, the worker
builds the pipeline):

| Shape | Count | Capabilities |
| ----- | ----- | ------------ |
| Real (worker builds from raw deps) | 2 | eventing-maintenance, topic |
| Extracted (this programme) | 14 | api-key (`e3ebed7963` — sandbox key sweep as repository/service/typed adapter in `@langwatch/api-key-server`; platform keeps a passive copy only while `pipelineRegistry.ts:790` names it); scenario deferred-metrics rider (`396a3d742e` — the job description lives beside its delay constant in `@langwatch/scenario-server`, the worker installer binds it through its own consumer-side interface, and a package test pins name/dedup-id/span literals against platform's frozen twin, which may only change together); github (`ec485ec46d` — the blocker was false coupling: sweep split from demand behind GithubBranchInstallationsPort, Prisma seams typed, worker builds the pipeline with no org/project service, credential absence declared by name; standalone deployments need the three GITHUB_LANGY_* env vars); langy-maintenance (`2cc56987f6` — session-key reap split from the wide service that demanded ApiKeyService/AuthzService it never called, narrow Pick<PrismaClient,"apiKey"> repository, package OTel metrics adapter pinning the identical series name); metric+log (`caee89b857` — append repositories split from reads whose demands only dead or narrow paths used; worker mounts both from the tenant-keyed substrate it already carries); suite (`3d6eba224f` — the coupling was a three-way assembly split across runtime/contract/registry; the package adapter owns it, redis required so a double-counting cacheless graph is inexpressible); identity+scim-sync (`54ba504b0d` — clean harvests: seven platform-only Prisma repositories landed at their honest homes, projection stores in identity-eventing beside the fold states that type them); authz+billing-reporting (`f397ac37ac` — the grants ledger split producer-from-consumer with connect deleted rather than stubbed; billing harvested its organization read, cache, Stripe twin and error reporter, mounting unconditionally with the SaaS shape in the sender); coding-agent+experiment (`e6a5d0fcda` — experiment was the suite assembly pattern; coding-agent dissolved ModelProviderService-for-one-pure-function and ProjectService-for-one-column-touch into three narrow ports, and composed the PR demand path its byte-frozen subscriber key requires); join-request (`baca75a26b` — the packaged mail capability in notification-server is the substrate, four provider gateways with the App's config spellings, templates in the application tier proven byte-identical to react-email's output; mounts unconditionally with absent mail declared by name, and a queue-claiming scoped graph refuses to compose without BASE_HOST) |
| Hybrid (package installer, platform-built option bundle) | 2 | trace (**CONVERTED 2026-09-02 after (g3)–(g7); `apps/worker` mounts all 29 byte-frozen `trace_processing` keys with no named absence, and `platform/app` lost the trace installer registration at 0 insertions. The record below is the HALT it replaces, kept because the wave-order correction it forced still governs the four gated conversions.** Steps (a)-(f) and the three named absences all landed and every staged composition is capability-tested, but `trace_processing`'s 29 byte-frozen routing keys are all-or-nothing and fourteen do not route from this process. Two groups are the halt: the PIPELINE DEFINITION was never in the census — `EventingTracePipelineAdapter` needs `ioExtraction`, `mediaReferences`, `modelCosts` and `prepareEventForProjection`, whose four implementations are 1,199 un-harvested platform lines, and the two modules that register the keys are platform's `AppTraceProjectionsAdapter` + `createTraceProcessingPipeline`; and `recordSpan`'s four staged ports each take a capability service by parameter, none of the six constructible here — `DataPrivacyService` and `ModelProviderService` both require `ProjectService`, which is shared prerequisite (1). THE WAVE ORDER INVERTS: ProjectService wave now precedes Trace. Three more keys have bounded gaps — `trackedEventSync`'s `getApp()`, the coding-agent normalized-span read step (c) handed forward, `datasetNormalize`'s unbuilt composition — and three belong to the automation and governance conversions. Full record, per-key disposition and clearing design at the end of the Worker blocker graph section), governance-ingestion |
| Synthesized wrapper (platform builds, worker receives) | 7 | automation (blocked: subscriber:pm:triggerSettlement is in the byte-frozen registry and its notifyDigest intent IS outbound mail — the join-request wall, reached three ways: settlement digests, AutomationRunawayPort.sendLimitEmail, AutomationTestFirePort. Clearing: the packaged mail capability, then unsubscribe/no-reply + the four delivery transports + PrismaScheduledJobStore + triggerFilter.matcher behind the ports that already exist, OTel twins for four prom-client counters, eight WorkerConfig leaves — and persistMatch puts Annotation/Dataset/Trace services on the critical path, so it converts with the trace vertical, not before), evaluation (blocked twice: command:executeEvaluation reaches EvaluationExecutionService — 676 lines over ~2.4k more platform-only lines including tracesMapping (1,414) — a platform service graph, not the composable langevals HTTP client; and subscriber:graphTriggerActivity inherits automation's mail wall via evaluateGraphTrigger. The other three deps ARE reachable — EvaluationRunStore demands exactly three packaged methods, both analytics stores compose on AnalyticsAdapter. Clearing: automation's clearing, a worker-reachable TraceService, then the evaluator engine behind EvaluationExecutionPort), governance-events (blocked with gateway-spend), gateway-spend (blocked), scenario (blocked three ways, surveyed 2026-09-02: the execute intent reaches the in-process child-process pool whose runner only the App connects — clearing needs scenario-child-process.ts out of platform and the prefetcher's nine services worker-composable; traceSummaryStore comes from the unconverted Trace pipeline — dissolves when Trace converts, so TRACE PRECEDES SCENARIO in wave order; deriveScenarioRoleMetrics was recorded as the App's per-project span-cost matching; **(g1) surveyed it and that is wrong — it IS the static-catalog trick**, `computeSpanCost` reaches `getStaticModelCosts()` and no database, per-project overrides belong to record-time enrichment, and `deriveScenarioRoleMetricsFromSpans` was already trace-server's. No `ScenarioRoleMetricsPort` is needed and none was added; what remains of this blocker is the SPAN READER `getNormalizedSpansByTraceId`, which travels with (g3). Six of nine deps compose today; the unused simulations field should delete with the conversion), langy-conversation (blocked twice, nine of eleven deps compose: the title generator needs getVercelAIModel's model-resolution cascade worker-reachable — harvest it into model-provider-server with explicit params, platform copy stays frozen; the session-key mint needs ApiKeyService which needs ProjectService. Preparation pieces named: ClickHouse analytics sink twin, OTel dispatch metrics twin, and a shared RedisTenantBroadcastAdapter both scenario and langy need as one frozen twin), sso-connection (blocked: teardown drags ScimService whose composition needs the better-auth instance — clearing split: ScimTokenRevocationPort over the existing repository method + the lifecycle call, then harvest SsoConnectionLedgerWriter with injected store/sender), |
| Riders (platform production code inside the mapper) | 0 | SaaS `globalProjections` EXTRACTED (`18c28be00e` — the wall was thinner than mapped: routing already packaged, the tenant directory answers an organization id as a tenant of itself, so the worker needed only the IS_SAAS deployment leaf; meter pair harvested to enterprise billing, gated on the worker's own leaf, refusing to compose SaaS without a reporting sender). Historical record follows: SaaS `globalProjections` (billing meter projection + dispatch subscriber). **Extraction attempted 2026-09-02 and reverted: unreachable at zero platform insertions.** The worker cannot build the pair — it has no `isSaas` leaf in `WorkerConfig`, and the meter's store writes through the organization-keyed ClickHouse client (`getClickHouseClientForOrganization`, billing routes private instances to their own cluster) plus the Redis-cached `resolveOrganizationId` directory, all platform-owned — so the mapper would have to gain port-passing lines. Sequencing instead: (1) package an organization-keyed ClickHouse/store seam and the org directory the worker can compose (the Redis cache is shared state, so both graphs read the same keys); (2) give `WorkerConfig` a deployment leaf; then the mapper's whole conditional spread deletes as a pure deletion. Until then the rider stays platform-built — it converts with the endgame either way. **gateway-spend + governance-events clearing order after 18c28be00e shrinks to three steps: (1) an all-instance ClickHouse directory (no organization id names the shared instance — needs a packaged managed-client factory or it stays with the endgame), (2) packaged plan source over the new deployment leaf, (3) webhook deliveryLog/destinations harvest + debit-path split. Original mapping: they hit the wall three ways (2026-09-02, survey in `3d6eba224f`): settlement needs an org-keyed ClickHouse instance directory, webhook delivery needs the isSaas leaf, the debit graph needs Project/Evaluator/Monitor or a false-coupling split of AppGatewayGovernancePort; both process managers are in the byte-frozen job registry so no half-mount exists. Clearing order: (1) package the org-keyed instance directory (also clears the billing rider), (2) WorkerConfig deployment leaf + packaged plan source, (3) harvest webhooks deliveryLog/destinations into enterprise-webhook-server, (4) split the debit path behind a narrow port.** |

Transitional seam flagged in `e3ebed7963`: the worker composition's top-level
`database` option defaults to the topic feature's PrismaClient — the one typed
client the root holds. It dies when the worker root composes from
configuration the way `apps/api` does (`ApiDatabaseInfrastructure` pattern).
Postgres-backed extractions (github, langy-maintenance) ride that seam with no
platform change.

### Wave 5: UI application shell

#### Browser boot and providers

- [ ] Make `apps/ui` the actual browser entry instead of the legacy adapter.
- [ ] Move Design System system/theme creation, auth/session, public config,
      feature flags, PostHog/analytics, command bar, Langy, error boundaries,
      NProgress, chunk-reload and global feedback providers.
- [ ] Preserve the exact current provider order and
      `Suspense(fallback={null})`/`RouterProvider` behaviour.
- [ ] Keep Node/server packages outside recursive browser closure.

#### Routing and composition

- [ ] Move `routes.tsx`, redirects, layout routes, drawer/modal registry and
      route tests to `apps/ui`.
- [ ] Preserve every public/auth/settings/project/admin/ops/governance/gateway/
      share/MCP/onboarding URL, redirect and parameter.
- [ ] Represent page composition as owner-only feature screens plus narrow
      surfaces; transport hooks remain `apps/ui` adapters.
- [ ] Delete `LegacyUiShellAdapter` only after the final provider and route
      moves.

#### Global UI hierarchy

- [ ] Place portable global browser state under `apps/ui/src/model` or
      `behavior` and portable UI under `ui/{elements,blocks,sections}`.
- [ ] Place private feature composition under
      `apps/ui/src/features/<feature>/{model,behavior,ui}`.
- [ ] Move genuine reusable primitives/patterns to Design System; do not dump
      product components there.
- [ ] Eliminate browser imports of server/runtime implementation boundaries
      through narrow app-owned ports.

Gate: `apps/ui` owns boot/providers/routes and renders every legacy route with
no production import from the old UI shell.

#### Browser entry moved out of `platform/app` — 2026-09-02 (bucket 6)

**Landed (uncommitted at time of writing).** `apps/ui` had the whole routed SPA
and no way to load it in a browser: no HTML shell, no Vite config, no public
assets. The second census classified all of that as "move to `apps/ui`" and it
is now there, lift-and-shift, at zero insertions in `platform/app`.

| From | To |
| --- | --- |
| `platform/app/index.html` | `apps/ui/index.html` |
| `platform/app/vite.config.ts` | `apps/ui/vite.config.ts` |
| `platform/app/vite/havenHmrGate.ts` | `apps/ui/vite/havenHmrGate.ts` |
| `platform/app/vite/havenHmrGate.unit.test.ts` | `apps/ui/tests/haven-hmr-gate.unit.test.ts` |
| `platform/app/public/**` (90 files, 3.7 MB) | `apps/ui/public/**` |

Deleted rather than moved, all five with no reference anywhere in the
repository: `platform/app/test-setup.browser.ts` and
`platform/app/vitest.browser.config.ts` (the browser-mode lane's `include` is
`src/**/*.browser.test.{ts,tsx}` and neither `platform/app/src` nor `apps/ui`
holds one any more — the census deleted the last ten; the setup file also
imported `platform/app/src/env.mjs`, which a browser package may not), plus the
three the census flagged: `vitest.mcp.config.ts`,
`vitest.prisma-integration.config.ts`, `tsconfig.slice-check.json`.

**The entry the shell loads is new, and deliberately thin.**
`platform/app/src/main.tsx` and its `LegacyUiShellAdapter` were deleted by the
census, and the adapter's contents — command bar, toaster, footer, TRPC and
session providers, the page-loader registry — were platform components that no
longer exist. `apps/ui/src/ui.entrypoint.tsx` composes what this package already
owns (`createUiApplication` over `installedUiFeatures`, whose registry answers
every page key the route table names; `useBrowserUiSession`; the feature shell's
own transport and QueryClient) and passes a pass-through provider at each of the
four slots whose implementation has not moved — attribution, graphics quality,
command bar, footer — plus a null footer and a plain page-error fallback. The
application composes and routes; what is missing is those four features, not the
page. Filling them is this wave's "Browser boot and providers" row. The file is
named `*.entrypoint.tsx` rather than `main.tsx` because that is the suffix
`environment-boundaries` recognises as a process composition root, which is what
lets it read `import.meta.env.DEV` for the `isDevelopment` install.

**Config lines dropped, and why each one.**

- `resolve.alias` — all four entries. `~` and `@app` pointed into
  `platform/app/src` and `@ee` into `platform/app/ee`; carrying any of them would
  be the forbidden import direction. `~/generated/prisma/client` → the Prisma
  browser entry went too: no web package imports that specifier at runtime (the
  five hits are comments and one server test). `tests/vite-browser-entry.unit.test.ts`
  asserts the alias map stays empty, so a `~` cannot come back quietly.
- `selfsigned` and the dev TLS **generation** branch. Not a simplification, and
  worth reading twice: `selfsigned` cannot be loaded in this workspace at all.
  Two `@peculiar/asn1-schema` copies are installed (2.8.0 and 2.9.4), so
  `@peculiar/asn1-rsa` registers against one schema store and reads from the
  other, and a bare `import("selfsigned")` throws `Cannot get schema for
  'AlgorithmIdentifier'` from `platform/app` exactly as it does from `apps/ui`.
  A Vite config that imports it therefore fails to load **whether or not**
  `LANGWATCH_DEV_HTTP2` is set — so `pnpm dev:vite` and `pnpm build:client` were
  already broken before this move, and the ADR-086 client build with them.
  `DEV_HTTPS_CERT` + `DEV_HTTPS_KEY` still work; generation comes back with one
  root `pnpm-workspace.yaml` override collapsing the duplicate (`F-VITE-01`
  below).
- `ROOT_DISCOVERY_PROXY_PATTERN` imported from
  `platform/app/src/server/openapi/discovery-locations`. That module moved to
  `apps/api/src/features/discovery/discovery-locations.ts`, and a browser
  application does not depend on the API process, so the two discovery paths are
  restated in `apps/ui/vite/root-discovery-proxy.ts` with the same derivation.
  This is a second copy of a list whose whole point was having one; the unit test
  holds the derivation to shape, and `F-VITE-02` names the fix.
- `ASSET_URL_GLOBAL` imported from `platform/app/src/server/asset-base`. The name
  of the global is a contract between the built bundle and whatever serves the
  HTML shell, and the bundle side is `apps/ui`'s. It is now
  `apps/ui/src/model/ui-asset-base.ts`; `asset-base.ts` should import it when
  that module reaches `apps/api` rather than declare a second one.
- `./src/noop-css.cjs` → `apps/ui/vite/noop-module.cjs`, three lines, so the
  object-inspect browser-stub plugin (a real observed white screen, not a
  hypothetical) keeps working.
- `__dirname` → `import.meta.dirname`. `@langwatch/ui` declares
  `"type": "module"`, so Vite bundles the config as ESM and `__dirname` is not
  defined; `platform/app` had no `type` field and got the CJS shim.
- `dotenv`'s `platform/app/.env` fallback. Only the repository root `.env` and
  `.env.portless` are read now, at the same `../../` depth `platform/app` used.
- `shikiManualChunk` now comes from `@langwatch/design-system/shiki-chunking`
  (its authority) rather than through `@langwatch/trace-web`'s re-export.

Kept unchanged and on purpose: the dev port scheme (`LANGWATCH_APP_PORT ?? PORT
?? 5560`, API at `+1000`), the portless/haven loopback API target, every
`server.proxy` entry, the watcher ignore list, the `process.env.*` defines, the
Shiki `optimizeDeps` pre-bundle, `build.outDir: "dist/client"`, and ADR-086's
`experimental.renderBuiltUrl`.

**One change outside `apps/ui`.** `packages/config/src/index.ts` had the one
constructor parameter property in the graph; Vite externalises every bare
specifier when it bundles a config, so Node loaded that file itself and failed
the whole browser build with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. It is now a
field declaration plus two assignments — same behaviour, and the file survives
Node's type-stripping.

**Proof.** `pnpm --filter @langwatch/ui exec vite build` is green: 2,625 files,
155 MB with sourcemaps, `index.html` carrying the hashed entry chunk and the
stylesheet, 1,274 JS chunks, 3 CSS, and all 90 `public/` files (favicon, five
Sentient faces, the images tree) copied to the output root.

**Cutover checklist — `apps/ui`.** Every line below is in a file this lane may
not edit. None of them is broken by the move — `platform/app` is deletes-only and
already does not boot — but each one still names the old location.

| File | Line to change |
| --- | --- |
| `package.json` (root) | `lint:oxlint` and `lint:fix` both end their path list with `platform/app/vite`, which no longer exists; drop it (the `apps` entry already covers `apps/ui/vite`). |
| `package.json` (root) | `build:app` is `pnpm --filter @langwatch/web... build`; the client half is now `pnpm --filter @langwatch/ui build`. |
| `platform/app/package.json` | `"build"` chains `vite build` and `"build:client"` is `NODE_ENV=production vite build`; both now belong to `@langwatch/ui`. `"dev:vite": "vite"` likewise. |
| `tools/thuishaven/app/plan.go:61` | the `app` lane runs `pnpm -s run dev:vite` in `lwDir`, and `cmd/root.go:134` sets `lwDir` to `platform/app`. Repointing the lane is one path change: `Dir` becomes `apps/ui` and the shell `pnpm -s run dev`. |
| `platform/app/scripts/start.sh:132` | `START_VITE_COMMAND="pnpm -s run dev:vite"`. |
| `platform/app/src/start.ts:143` | serves `dist/client` from the process root; the artefact now builds under `apps/ui/dist/client`. |
| `platform/app/scripts/smoke-boot.mjs:28` and `scripts/upload-assets-to-cdn.sh:42` | both default to `dist/client` relative to `platform/app`. |
| `.github/workflows/langwatch-app-ci.yml:1595` | the Vite cache key hashes `platform/app/vite.config.ts` and caches `platform/app/node_modules/.vite`. |
| `.github/workflows/langwatch-app-ci.yml:1640` | the boot smoke runs `vite preview --outDir dist/client` with `working-directory: platform/app`. |
| `.github/workflows/npx-server-publish.yml:224` | asserts the tarball contains `package/app/platform/app/dist/client/index.html`. |
| `.github/scripts/check-added-images.sh:28` | the added-image allowlist names `platform/app/public/` and needs `apps/ui/public/`. Rename detection should classify this move as `R` rather than `A`, so the guard ought to stay quiet — but it is one line either way and the allowlist is wrong without it. |
| `apps/server/src/services/node-deps.ts:192` | the npx installer skips the build when `dist/client/` is already present, resolved under the platform directory. |
| `charts/langwatch/values.yaml:264` | the asset-base comment describes syncing `dist/client/assets` to the commit-prefixed CDN prefix. |
| `dev/scripts/pack-npm.sh:116` | the tarball note assumes `dist/client` lives in the app tree. |
| `pnpm-workspace.yaml` | needs a `@peculiar/asn1-schema` override before dev TLS generation can come back (`F-VITE-01`). |

Two follow-ups this lane records rather than fixes:

- `F-VITE-01`: **one `@peculiar/asn1-schema` copy.** A root
  `pnpm-workspace.yaml` override collapsing 2.8.0 and 2.9.4 restores
  `import("selfsigned")`, and with it the zero-setup `LANGWATCH_DEV_HTTP2=1`
  path that generated `<repo>/.dev-certs/`.
- `F-VITE-02`: **one list of root discovery paths.** `apps/api` and
  `apps/ui/vite/root-discovery-proxy.ts` now carry the same two strings. They
  belong in a package both can read; until then a path added to one and missed in
  the other reaches Hono in production and the SPA in development.

Still on `platform/app` and needed before the browser entry is whole:
`src/styles/globals.scss` (the entry imports no global stylesheet — the Crisp
bubble CSS backstop `index.html`'s `data-crisp-suppressed` attribute depends on
lives there) and `vitest.component.config.ts`, which the census also assigns
here but which the repository's root `test:component` script still resolves
through `@langwatch/web`.

### Wave 6: feature vertical programme

Each feature row means the complete remaining vertical: contract/service/
repositories, API transports, worker/Eventing, web screens/surfaces, app
composition, tests/spec/docs and displaced file deletion.

| Order | Feature owners                                                                                                     | Dependencies and emphasis                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `secret`, `stored-object`, `data-privacy`, `data-retention`, `feature-flag`, `notification`, `entitlement`         | Identity/config/storage; finish shared support capabilities used by later features.                                                                |
| 2     | `trace`, `log`, `metric`, `annotation`, `analytics`, `dashboard`, `share`, `topic`                                 | ClickHouse/Eventing/storage; preserve all trace fields and keep analytics/summaries/timeseries stores distinct.                                    |
| 3     | `model-provider`, `gateway`                                                                                        | Identity, secrets, credentials, ClickHouse/Redis, Enterprise managed provider; preserve virtual keys, budgets, guardrails, cache/routing/realtime. |
| 4     | `dataset`, `evaluator`, `evaluation`, `experiment`, `monitor`, `scenario`, `suite`                                 | Trace, model/gateway, storage and worker; preserve execution, retry, cancellation, cost and simulation semantics.                                  |
| 5     | `prompt`, `workflow`, `agent`                                                                                      | Model/gateway, datasets, traces and evaluation; move all authoring UI and complete Agent drawer/editor surfaces.                                   |
| 6     | `automation`, `coding-agent`, `github`, `langy`                                                                    | Eventing, model, trace, evaluation and external effects; preserve commands, process managers, MCP/CLI and browser flows.                           |
| 7     | `presence`, `ops` and remaining core composition                                                                   | Browser/worker/operational infrastructure; no miscellaneous service owner.                                                                         |
| 8     | Enterprise `audit-log`, `billing`, `governance`, `licensing`, `managed-provider`, `saas`, `scim`, `sso`, `webhook` | Role-specific Enterprise API/worker/web composition and licensing/tenant gates.                                                                    |

Identity owners from Wave 2 (`auth`, `user`, `organization`, `project`, `role`,
`authz`, `api-key`) are also complete verticals; Wave 2 merely schedules them
early because nearly every other feature depends on them.

For every row:

- inventory every app path by domain noun, route, Prisma model, event and DTO;
- consolidate duplicate readers/writers into the canonical service graph;
- characterize old behavior before replacing mappers/queries;
- preserve effects, retries, caches, rate limits, audit and metrics;
- move meaningful tests and delete equivalent app suites only after they pass;
- record any remaining compatibility transport/composition adapter by exact
  file and caller.

Gate: the feature has no behavior scattered across app-layer, server, runtime,
features, components, hooks and package surfaces.

### Wave 7: old UI feature and page drain

Migrate UI by coherent product route, not by source folder alone:

1. complete Agent and Prompt authoring pilots;
2. Trace Explorer/`traces-v2`, analytics/workbench and dashboards;
3. Dataset, evaluator, evaluation, experiment, scenario and suite workflows;
4. Workflow/optimization studio, model-provider and gateway UI;
5. Langy, automation, coding-agent and GitHub UI;
6. project/settings screens for secrets, API keys, roles, members, teams,
   retention, privacy, model costs/providers, topic and integrations;
7. auth, onboarding, home, navigation, command bar, errors and shared layouts;
8. ops/admin and Enterprise governance, billing, audit, SSO/SCIM/licensing and
   webhook UI;
9. public share, invite, unsubscribe, MCP authorization and remaining routes.

Each route slice must preserve loading/empty/error states, permissions,
drawers/modals, URL state, keyboard/browser behavior, telemetry and visual
structure. Use browser/host integration tests for composition and feature-web
tests for reusable behaviour.

Gate: delete `src/pages`, `src/components`, `src/hooks`, `src/features`,
`src/prompts`, `src/experiments-v3`, `src/optimization_studio`, old styles and
runtime UI after residue and route-parity proof reaches zero.

### Wave 8: backend residue drain

After feature verticals move, drain remaining cross-cutting server cohorts:

- mail/notification delivery and templates;
- storage, export, upload and staged payload infrastructure;
- rate limiting, invites, onboarding checks and home aggregation;
- saved views/filters/LWQL shared query adapters by actual feature owner;
- broadcast/websocket/presence infrastructure;
- auth callbacks, internal service routes and operational endpoints;
- migrations, replay/backfill and maintenance orchestration;
- any remaining analytics/traces/gateway/model-provider compatibility modules.

No miscellaneous `server` or `utils` package is allowed. Assign each file to a
feature, physical process or named infrastructure package and delete the old
path in the same slice.

Gate: `src/server` and `src/runtime` contain no production implementation or
composition needed by a live process.

### Wave 9: tasks, migrations and generated artefacts

- [ ] Move worker tasks and scheduled commands to `apps/worker`; move one-off
      developer/ops migrations to an explicit tool package or `apps/server`.
- [ ] Re-home Prisma seeds and ClickHouse migrations with their owning
      persistence package while preserving execution order and deployment tooling.
- [ ] Move OpenAPI generation/serving into `apps/api` and keep semantic diff in
      CI.
- [ ] Move SDK/MCP/skill generation to repository tools that consume canonical
      artefacts, not app modules.
- [ ] Regenerate TypeScript, Python, Go and MCP clients and compile/test them.
- [ ] Move API-reference generation, `llms` output and feature-map ownership to
      canonical routes.

Gate: fresh generation produces no unexplained diff and no task/tool imports or
boots `platform/app`.

### Wave 10: assets, tests and developer tooling

- [ ] Move public assets, fonts, images and browser manifests to `apps/ui` or
      owning web packages.
- [ ] Re-home E2E, browser, component, integration, Prisma, ClickHouse, stress,
      Stripe and MCP test configuration by physical app/package.
- [ ] Move test fixtures/helpers with their owner and delete duplicate bodies.
- [ ] Update local start/dev orchestration, Vite, TS configs and package scripts.
- [x] Remove legacy Biome/Prettier assumptions; retain Oxfmt/Oxc.

Gate: all canonical tests run without setting `platform/app` as a package or
working directory.

### Wave 11: CI, packaging and deployment cutover

- [ ] Build separate UI, API and worker artefacts/images.
- [ ] Update root scripts, pnpm filters, Dockerfiles/Compose, Helm/Kubernetes,
      release workflows, cache keys, Semgrep paths and deployment health checks.
- [ ] Preserve database migration ordering, API readiness and worker graceful
      drain during rollout.
- [ ] Point production routing directly at the new API/UI and deploy the worker
      process. The API decision is direct cutover, not a parallel shadow service.
- [ ] Run full smoke/E2E against the built artefacts.

Gate: production-equivalent build and startup use only `apps/api`,
`apps/worker`, `apps/ui` and required packages.

### Wave 12: delete `platform/app`

- [ ] Prove zero production imports of `platform/app` and `@langwatch/web`.
- [ ] Prove zero workspace, lockfile, CI, Docker, deployment, script, docs,
      generated-client, test and asset references that require it.
- [ ] Prove zero global App access and package env reads.
- [ ] Prove generated Prisma is private to strict adapters.
- [ ] Remove architecture baseline entries for deleted paths; do not replace
      them with new baselines.
- [ ] Delete `platform/app` and its workspace/package aliases.
- [ ] Regenerate lockfile and generated artefacts from a clean checkout.
- [ ] Merge/rebase current `origin/main`, resolve semantically, and run the full
      verification matrix.

Gate: `git ls-files platform/app` returns nothing and every physical process
builds, starts, serves/consumes and shuts down independently.

## Verification matrix

Every coherent slice runs the relevant subset; every wave runs all applicable
rows. A red unrelated workspace check is reported exactly and never called
green.

| Area                | Required proof                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Contract/server/web | Package typechecks, unit/integration tests and declared scenarios                                  |
| API                 | Real caller/request tests, auth/permission/error parity, route inventory and OpenAPI semantic diff |
| Worker              | Queue/Eventing/process-manager/intent/replay/idempotency, liveness and shutdown tests              |
| UI                  | Feature-web tests, app adapter/host tests, browser route/interaction/visual parity                 |
| Persistence         | Prisma/ClickHouse integration where available, migrations and query/response characterization      |
| Clients/docs        | TypeScript/Python/Go/MCP generation and compile/tests; API-reference generation                    |
| Architecture        | Architecture lint with no new baseline, residue search and dependency-direction proof              |
| Hygiene             | Oxfmt, Oxc, `review:test-quality`, `review:comment-blocks`, `git diff --check`                     |
| Deployment          | Built-artifact smoke, readiness, graceful shutdown and clean-start test                            |

### Strict-layout lint ledger

**Refreshed 2026-09-02 at d1a64c529e:** 3,419 findings, 3,210 of them outside
`platform/app`, up from ~823 this morning. This is the lift-and-shift working
as intended: the moved bodies arrive in their legacy shape and the lint now
counts what platform hid. Three kinds. Mechanical (relayout wave, one per
package, lint count as the only-shrinks gate): `feature-source-filename` 1,052,
`ui-web-private-layout` 849, `feature-source-layout` 257, `ui-web-root-components`
115, `ui-web-root-flat` 68; trace-web alone carries 1,558 because traces-v2
arrived whole as `src/explorer`. Structural (decisions): `cross-feature` 57,
`package-cycle` 12 (the eight web packages the studio move made mutually
dependent; resolve by pulling shared studio/trace vocabulary into contract or a
shared ui package), `private-runtime-export` 38, `prisma-containment` 25,
`ui-web-layer-direction` 18. Stale: `legacy-feature-fragment-baseline` 233
entries naming deleted platform files. The relayout wave starts when the loader
keys and the tRPC collaborators are done; the table below is the older per-policy
inventory.

**Relayout of `@langwatch/trace-web`, 2026-09-02 (standards lane):** the
package's own rows, before and after two committed-size steps. Baseline 1,542
findings.

| Policy                     | Before | After step 1 | After step 2 |
| -------------------------- | -----: | -----------: | -----------: |
| `feature-source-filename`  |    509 |            0 |            0 |
| `ui-web-private-layout`    |    722 |          722 |            0 |
| `ui-web-root-flat`         |     68 |           68 |            0 |
| `ui-web-root-components`   |     57 |           57 |            0 |
| `ui-web-feature-declaration` |    4 |            4 |            0 |
| `ui-screen-closure`        |    132 |          132 |          132 |
| `ui-web-public-entry`      |     32 |           32 |           32 |
| `cross-feature`            |     13 |           13 |           13 |
| `package-cycle`            |      4 |            4 |            4 |
| `enterprise-direction`     |      1 |            1 |            1 |
| **total**                  |  1,542 |        1,033 |          182 |

Step 1 was the filename grammar: 692 renames planned mechanically by the
`rename-feature-sources` planner's algorithm, scoped to the package, applied
with `mv` plus reference rewrites. **The planner rewrites module specifiers
through the TypeScript grammar, which does not include `vi.mock("…")`** — those
are plain call arguments, so 86 test files were left mocking paths that no
longer existed and 464 tests went red without a single import error. A stale
mock does not fail loudly; it silently registers a mock for a module nobody
loads. Any scoped run of this planner needs a second pass over relative string
literals that no longer resolve.

Step 2 was the layout: 949 files moved into `model/`, `behavior/`,
`ui/{elements,blocks,sections}` and `screens/`, with the sub-directory grouping
preserved underneath (`ui/sections/explorer/trace-drawer/…`), so the module
graph is unchanged and only paths moved. Layers were assigned from the import
graph rather than by name, which is what keeps `ui-web-layer-direction` at zero:
a file is `sections` if it transitively reaches `behavior`, `blocks` if it is a
view reaching another view, `elements` if it is a view reaching none, `behavior`
if it is not a view but touches React/Chakra/browser/state, and `model`
otherwise. `ui-web-public-entry` needs the dependent packages repointed and is
left for a later slice; `ui-web-root-flat` and `ui-web-root-components` closed
as a side effect of the same move.

Two decisions the move could not make, recorded rather than guessed:

- **No private feature is extractable from the explorer yet.** `ui-web-*`
  forbids package-global `model`/`behavior`/`ui` from importing
  `features/<f>/**` at all, so a private feature may only be consumed by a
  screen or by another feature's `ui/sections`. Every candidate subtree
  (`explorer/onboarding` 38 files, `TraceDrawer` 136, `TraceTable` 95,
  `SearchBar`, `Toolbar`, `FilterSidebar`, `transcript`, `flame`) is consumed by
  sibling explorer code, not by a screen. The four legacy `features/*`
  directories that arrived with the lift (`errors`, `langy`, `presence`,
  `skills`) are cross-cutting utilities imported from 24 call sites across the
  explorer and `components/`, which is the definition of package-global, so they
  were dissolved into `model`/`behavior`/`ui` and their four missing
  `feature.json` findings closed with them. Extracting `features/explorer` as a
  single feature is viable (its only global-layer importers are two `behavior`
  files) but is a design change, not a move.
- **`ui-screen-closure` 132 is unchanged by any relayout.** The policy walks the
  transitive import closure of the `./screens/traces` export and rejects direct
  browser capability use (`fetch`, `localStorage`, `EventSource`, `process.env`,
  `AppRouter`) and direct `@trpc`/`@tanstack/react-query`/`react-router`
  imports. The closure is import-driven, so moving files neither adds nor
  removes a finding; closing it means giving the screen a host port and passing
  browser data and actions in.

**Relayout step 0-1, 2026-09-02 (standards lane, sixteen finished web
packages + `packages/ui-drawer`):** two mechanical slices landed.

Step 0 removed the stale half of the fragment inventory. `git ls-files` is the
oracle: 263 baseline entries named `platform/app` files that no longer exist in
git, and every one of them is gone. `legacy-feature-fragment-baseline` 275 to
12. The twelve that stay name files git still tracks; the lint calls them stale
because the fragment classifier no longer gives them the same feature or kind,
which is a classification question and not a deletion.

Step 1 closed `feature-source-filename` in every package this lane owns, with
`rename-feature-sources` supplying the mapping and the moves applied outside
git so no rename is recorded as a delete plus an add. 628 files renamed, 403
reference files rewritten. Per package, `feature-source-filename` before to
after: scenario 167 to 0, experiment 109 to 0, workflow 83 to 0, langy 83 to 0,
evaluator 28 to 0, prompt 26 to 0, model-provider 24 to 0, analytics 11 to 0,
dataset 10 to 0. auth, api-key, onboarding, github, automation, annotation and
`packages/ui-drawer` were already kebab. No other policy moved in any of them;
the owned total fell 2,805 to 2,264.

Three things the planner does not see, and which any later relayout wave must
sweep the same way. `vi.mock` and its siblings take a module path as a plain
call argument, so the planner's import walk leaves them behind and the package
still typechecks: 35 such specifiers across 22 test files. A source-reading
guard names its subject through `path.resolve`, and that one dies with ENOENT
rather than a red assertion. And a `key.split(".")` resolves to a real renamed
module on a case-insensitive filesystem, so a specifier sweep must require a
`./` or `../` prefix before it rewrites anything. macOS also reports every
case-only rename as a target collision; the 41 in this slice are real renames
and go through a temporary name.

Left open as decisions, not swept: `cross-feature` 47 (scenario 8, workflow 8,
experiment 7, evaluator 6, langy 5, prompt 4, model-provider 3, analytics 2,
annotation, api-key, dataset, onboarding 1 each), `package-cycle` 21 (workflow
7, analytics 3, evaluator 3, langy 3, dataset 2, experiment 2, model-provider
1), `ui-web-layer-direction` 14 (auth 13, workflow 1),
`ui-web-public-boundary-leakage` 2, `ui-web-feature-declaration` 3,
`ui-web-screen-leakage` 1 and `public-exports` 1. The cycles and the
cross-feature edges are the shared studio and trace vocabulary the studio move
created; they close by promoting that vocabulary to a contract or a shared ui
package, not by moving files.

**Relayout of `@langwatch/onboarding-web` and `@langwatch/project-web`,
2026-09-02 (standards lane):** the last two web packages still holding
PascalCase filenames. Both packages' own rows, before and after the two steps.

| Policy                       | onboarding before | after | project before | after |
| ---------------------------- | ----------------: | ----: | -------------: | ----: |
| `feature-source-filename`    |            0 (\*) |     0 |             34 |     0 |
| `ui-web-private-layout`      |                78 |     0 |              2 |     0 |
| `ui-web-root-components`     |                10 |     0 |              0 |     0 |
| `ui-web-root-flat`           |                 0 |     0 |              2 |     0 |
| `ui-web-feature-declaration` |                 1 |     0 |              0 |     0 |
| `ui-web-layer-direction`     |                 0 |     0 |              0 |     0 |
| `ui-web-public-entry`        |                15 |    15 |              1 |     1 |
| `ui-screen-closure`          |                 4 |     4 |             32 |    32 |
| `cross-feature`              |                 1 |     1 |              5 |     5 |
| **total**                    |               109 |    20 |             76 |    38 |

82 files renamed in step 1 (onboarding 47, project 35) and 104 moved in step 2
(onboarding 102, project 2). No dependent needed an edit: `apps/ui` typechecks
clean and runs 87 files / 743 tests, unchanged, and the seventeen
`ui-screen-closure` findings `trace-web` raises against `@langwatch/onboarding-web`
are identical before and after, because the fifteen deep subpath **keys** in the
manifest were kept and only their targets repointed.

(\*) is the first thing worth recording. `packages/features/onboarding` has no
`feature.json`, so its `layoutVersion` is undefined and `lintFeatureLayouts`
skips the package entirely: 47 PascalCase filenames reported as zero. Its
sibling `packages/features/project` has one and reported all 34. **A web package
with no feature ownership root is silently exempt from the filename grammar**,
which is the same shape as the feature-parity tag trap — a policy that reads
green because nothing was ever bound to it. Adding the missing `feature.json`
is left as a decision rather than taken here: it would switch on
`feature-source-layout` for the package in the same move, and this slice's
contract was that a row may only fall.

Step 2 dissolved `features/onboarding` rather than keeping it as a private web
feature, following the trace-web precedent. The deciding edge is
`components/welcome/api-card.tsx`, which reaches
`features/onboarding/.../copyable-input-with-prefix.tsx`: package-global `ui`
may not import `features/<f>/**` at all, so keeping the feature would have
traded 78 `ui-web-private-layout` findings for a new
`ui-web-global-feature-leakage` one. The package is also *entirely* onboarding —
a private feature covering the whole package states nothing — and eleven of the
fifteen public subpath exports point into that subtree, which a private feature
by definition may not expose. Dissolving closed the missing `feature.json`
finding with it.

Layers came from the import graph by the algorithm this ledger already records,
with two additions the earlier waves did not need:

- **Files already inside a governed layer are pinned.** `model/onboarding-host.ts`,
  the seven `behavior/*` hooks and `ui/elements/link.tsx` were placed by the
  original lift and are fixed points the solve has to satisfy, not inputs it may
  re-derive. All three pins import nothing local, so the constraint was
  satisfiable; a pin that reached a view would not have been.
- **A directory carrying raw assets stays whole, at the highest layer among its
  members.** `regions/observability/codegen` holds 28 snippet files reached as
  `./snippets/python/openai.snippet.py?raw`. A query-suffixed literal resolves
  in no rewriter, so the assets have to keep their offset from `registry.tsx`;
  splitting the directory by layer (`snippets.ts` solved to `model`, `registry.tsx`
  to `sections`) would have moved them apart and broken 28 imports that
  **typecheck clean either way**. Promotion is the safe direction — `sections`
  may depend on every layer — but only after checking the importers: both of
  `snippets.ts`'s were already `sections`.

The solve is validated before a file moves. Every intra-package edge is checked
against the layer matrix and any violation printed; the plan applied here
printed none, which is why `ui-web-layer-direction` stayed at 0 in both packages
rather than rising the way a name-based assignment would have.

Traps, all of them already recorded and all of them live here. `vi.mock` is the
loud one: `project-web` alone carried 14 of them, and a specifier sweep that
walks only the TypeScript import grammar would have left every one pointing at a
deleted path, registering a mock for a module nobody loads. The sweep used here
matches quoted relative literals instead, so `vi.mock`, `vi.doMock`, dynamic
`import()` and `require` all move together with real imports. macOS reported the
eight icon renames (`Azure.tsx` to `azure.tsx` and friends) as target
collisions; they go through a temporary name. And `.tsbuildinfo` was cleared
before every `tsc`, because a stale one reports zero against a tree that no
longer exists.

One finding that is not a layout question. `ui/sections/via-claude-code-screen.tsx`
displays the config-file path for each editor, and two of them read
`../../../../.codeium/windsurf/mcp_config.json` and
`../../../../Library/Application Support/Claude/claude_desktop_config.json`.
They were `~/.codeium/…` and `~/Library/…` until `72ed591a13`, where the `~/`
alias rewrite that moved the studio and traces family out of `platform` treated
two **display strings** as module specifiers and resolved them to `src`. Nothing
typechecks differently and no test covers the copy, so it has been sitting in
front of customers since. Restored here, since the file was open anyway. The
class is worth a sweep in every package that move touched: a `~/` rewrite has no
way to tell a module specifier from a path a human is meant to read, and the
tell is a display string with four `../` in it.

Left as decisions, not swept, in these two packages: `ui-web-public-entry` 16
(onboarding 15, project 1) needs the dependents repointed off deep subpaths, and
`ui-screen-closure` 36 (project 32, onboarding 4) is import-driven and unmoved by
any relayout, exactly as trace-web found. `cross-feature` 6 is the shared web
vocabulary the studio move created. Two cosmetic residues of a move-only slice:
`behavior/types.ts` is a vague name at package-global scope, inherited from
`features/onboarding/types/types.ts`, and `screens/home/components/homeHeroScroll.css`
stayed camelCase because the filename grammar walks only `.[cm]?[jt]sx?`. Both
are renames, not moves, and neither is linted.

**Relayout step 2, 2026-09-02 (standards lane, nine web packages):** the layout
itself. `scenario`, `experiment`, `workflow`, `langy`, `evaluator`, `prompt`,
`model-provider`, `analytics` and `dataset` moved from their lifted shape into
the web grammar. 1,030 files moved with plain `mv`, 591 reference files rewritten
by the sweep and 11 more by hand, 7 `package.json` export maps retargeted, and no
export KEY changed, so `apps/ui` needed no edit and its 743 tests never moved.

```
src/
  index.ts  testing.tsx  *.config.*        <- the only files allowed flat at src/
  model/          depends on: model
  behavior/                   model, behavior
  ui/elements/                model, elements
  ui/blocks/                  model, elements, blocks
  ui/sections/                model, behavior, elements, blocks, sections
  screens/<owner>/            (public; may name anything private)
  surfaces/<id>/              (public; surfaces + global model only)
  features/<f>/index.ts       (public entry of a private feature)
  features/<f>/{model,behavior,ui/{elements,blocks,sections}}/
```

Per package, `ui-web-private-layout` / `ui-web-root-components` /
`ui-web-root-flat` / `ui-web-layer-direction`, before to after:

| package          | files moved | private-layout | root-components | root-flat | layer-direction |
| ---------------- | ----------: | -------------: | --------------: | --------: | --------------: |
| `scenario`       |         264 |     237 → **0** |     165 → **0** |  41 → **0** |         0 → 0 |
| `workflow`       |         220 |     205 → **0** |      34 → **0** |  42 → **0** |     1 → **0** |
| `experiment`     |         205 |     203 → **0** |      22 → **0** |  28 → **0** |         0 → 0 |
| `langy`          |         232 |       170 → **3** |      24 → **0** |   5 → **0** |         0 → 0 |
| `evaluator`      |          32 |      34 → **0** |      25 → **0** |     0 → 0 |         0 → 0 |
| `prompt`         |          28 |      28 → **0** |       8 → **0** |     0 → 0 |         0 → 0 |
| `model-provider` |          24 |      24 → **0** |      21 → **0** |     0 → 0 |         0 → 0 |
| `analytics`      |          15 |      15 → **0** |       7 → **0** |     0 → 0 |         0 → 0 |
| `dataset`        |          10 |      10 → **0** |      10 → **0** |     0 → 0 |         0 → 0 |

Repo-wide the three owned rows fell `ui-web-private-layout` 1,039 to 36,
`ui-web-root-components` 336 to 10 and `ui-web-root-flat` 128 to 10; everything
still counted is `packages/enterprise/features/{billing,licensing}/web`, plus
`navigation` and `auth`, which this lane does not own. `ui-web-feature-declaration`
3 to 0. No policy in any package grew. Total findings 3,516 to 2,086.

Every suite matched its baseline exactly: scenario 421, experiment 629, workflow
318, langy 739, evaluator 41, prompt 643 + 6 todo, model-provider 72, analytics
384, dataset 117, `apps/ui` 743. `tsc -p` is clean per package except two
pre-existing failures the move did not touch and could not fix: workflow 6
(`api.workflow.getVersions` is absent from `WorkflowApiMap`, so `versions.data`
is `any`) and prompt 8 (`@langwatch/prompt-web/screens/prompt-studio` does not
export `usePromptTabsStore`/`TabDataSchema`, and `RouterOutputs["spans"]` does not
exist). Both are byte-identical to their indexed content apart from specifiers.

**How the layer of a file was decided, since the lint only checks the edges.**
Seed: a file already inside a valid layer keeps it; otherwise `.tsx` starts at
`ui/elements`, `use-*` / `*.store` / `*.api` / `*.context` at `behavior`, and every
other `.ts` at `model`. Then a fixpoint that only ever promotes: for each local
import the source rises to the lowest layer permitted to name its target, and a
`model` or `behavior` module that names any UI layer goes straight to
`ui/sections` rather than becoming an "element". `ui-web-layer-direction` is then
zero by construction rather than by inspection. Destinations keep the original
directory tail with only the catch-all segments dropped (`components`, `hooks`,
`utils`, `server`, `ui`, `behaviour`), so `components/datasets/editor/x.tsx`
becomes `ui/sections/datasets/editor/x.tsx`; a collision re-adds the dropped
segment rather than renaming the file, because filenames were step 1's business.
`__tests__` moved with the subject named in their own imports.

Six things a later relayout wave must handle, on top of step 1's list.

- **A specifier rewrite must preserve the specifier's SHAPE, not just its
  target.** `./vega-lite-schema-validator.generated.js` carries its extension on
  purpose; recomputing it as an extensionless path turned analytics'
  module-purity guard red without moving a single file, because the guard reads
  the module's own source and asserts the import text. Explicit-extension,
  extensionless and directory forms are three cases, not one.
- **Relative literals that escape `src` are invisible to a package-scoped
  rewriter and their depth changes silently.** `../../../../scripts/generate-langy-skills`,
  `../../../../../../../feature-map.json` and
  `new URL("../../../../../../../../sdks/typescript/src/cli/program.ts")` all
  resolved to real files outside the package; a sweep that only resolves inside
  `src` leaves them at the old depth. Two typecheck errors and three ENOENT test
  files in langy. Resolve every relative literal against the filesystem.
- **An asset follows an importer, and the wrong importer is a lint regression.**
  `langy-context-target.css` placed beside its first `ui/sections` importer left
  `behavior/use-langy-context-target.ts` naming a path upward, which is
  `ui-web-layer-direction`. A `.css` is not walked as source but IS classified
  when something imports it, so it must land at the LOWEST layer among its
  importers.
- **A feature's declared dependencies are source-module edges only.** Counting an
  asaplangy → `features/langy/langyTheme.css` import as a feature dependency
  invented an `asaplangy` → `langy` edge which, against the real `langy` →
  `asaplangy` one, reported a `ui-web-feature-cycle` that does not exist.
- **A test whose only relative import is the package entry has no subject**, and
  is left behind in a directory that survives precisely because `__tests__` is
  excluded from the walk — `scenario/web/src/hooks/scenarios/__tests__` outlived
  the `hooks/` tree it belonged to and no policy said so. Place those by the
  definition site.
- **`vi.mock` is swept correctly by rewriting every relative string literal**, not
  only import statements — but a `vi.mock` whose path never resolved stays dead
  and quietly changes meaning with the move (workflow's
  `../../../components/ui/toaster`, dead before and after).

Four decisions the move made rather than deferred.

- **experiment's statistics modules are in `ui/sections` and that is the truth,
  not a compromise.** `batch-evaluation-results.types.ts` imports
  `disambiguateNames` from `batch-results/presentation.tsx`, so ten pure modules
  (`aggregates`, `csv`, `headline`, `judge-bias`, `pairwise`, `pareto`,
  `tradeoff`, `types`, `variant-metrics`, `verdict`) rose with it. The only other
  move-shaped option was pinning a 50-element component file into `model`, which
  is the larger lie. The real fix is extracting `disambiguateNames` into a model
  module, which is a code change.
- **`features/langy/langyTheme.css` stays where it is.**
  `apps/ui/tests/langy-theme.unit.test.ts:106` reads it through a hardcoded
  `packages/features/langy/web/src/features/langy/langyTheme.css`, and this slice
  is required to leave `apps/ui` untouched. Three `ui-web-private-layout` rows
  stay open for it: the two asaplangy importers and `features/langy/ui/sections/langy-panel.tsx`.
  Closing them is one `mv` plus that one line, in a slice allowed to touch apps/ui.
- **workflow's `studio-host` is now four directories.** Its members sit at
  different layers, so the seam splits across `behavior/`, `model/`,
  `ui/elements/` and `ui/sections/`. Every `./studio-host/*` export KEY is
  unchanged; only the targets moved.
- **No new private feature was created.** langy's two existing ones were relaid
  out in place and given the `feature.json` the lint asks for, closing both
  `ui-web-feature-declaration` rows. `features/langy` still has no `index.ts`, so
  the single screen that reaches into it does so as a screen, which the policy
  allows; promoting it to a real entry is a design change.

Left open in these nine, and none of it closes by moving a file:
`ui-web-public-entry` 133 (workflow 65, analytics 13, evaluator 11, experiment
10, model-provider 10, prompt 10, dataset 9, langy 3, scenario 2) needs every
dependent repointed off its deep subpath; `ui-screen-closure` 531 is import-driven
and unmoved by relayout, exactly as trace-web found (workflow's 117 to 109 is the
closure walk reaching fewer duplicate paths, not a fix); `cross-feature` 44 and
`package-cycle` 21 are the shared studio and trace vocabulary; and
`ui-web-public-boundary-leakage` 1 (prompt) and `ui-web-screen-leakage` 1
(scenario) each want an extracted surface.



The strict layout only means something if its lint is enforceable, and until
`6ec280aec8` a large share of the reported total was drift rather than work.
This is the standing inventory, refreshed from
`cd packages/architecture-lint && pnpm lint`. A row reaching zero must stay at
zero; a row that grows in a slice is that slice's regression.

| Policy                            | Open | Where it concentrates and what closes it                                                                                                             |
| --------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legacy-feature-fragment`         |  484 | This is the extraction itself. Closes feature by feature as Waves 3–8 land; the baseline may only shrink.                                              |
| `feature-source-layout`           |  138 | trace/server (63), langy/streaming (13), metric/adapters (10), dataset/services (8), analytics (13). Directory roles inside a strict server package.  |
| `feature-source-filename`         |   61 | Mostly Enterprise governance adapters using `postgres-x-y.adapter.ts` instead of the dotted role form. `rename-feature-sources.cli.ts` plans this.     |
| `fallible-result-naming`          |   51 | A capability that can return absence must be named `try*` and declare it. Spread across dataset, ops, langy, experiment, trace and billing.           |
| `global-app-access`               |   34 | Unbaselined `getApp`/`tryGetApp`. Closes with each process-composition cut; never add a baseline entry to silence one.                                |
| `private-runtime-export`          |   25 | A feature server root exposing a repository/store/projection. 15 are `features/trace/server/src/index.ts`.                                            |
| `prisma-containment`              |   18 | Generated Prisma imported outside a strict Prisma repository adapter — dataset, gateway, suite, notification, experiment, annotation, billing.        |
| `service-quality`                 |   17 | Services over their line/method/complexity ceiling. Split private collaborators; an existing ceiling may only shrink.                                 |
| `test-quality`                    |   13 | Callbacks with no recognised assertion: gateway-spend REST, webhooks, errors logic, analytics ClickHouse. Tracked as `F-WEBHOOK-01`.                  |
| `architecture-record`             |   73 | Boundary ADRs missing required sections. Documentation, but the sections are how a boundary is reviewable at all.                                     |
| `eventing-process-purity`         |    7 | Process definitions declaring async work. All seven are `platform/app` pipelines and close with Wave 4.                                                |
| `eventing-subscriber-idempotency` |    4 | langy and scenario subscribers with no named redelivery contract test. Queue deduplication is explicitly not sufficient.                              |
| `strict-port-module`              |    6 | Port modules exporting a concrete null object named `…Port`, or no `…Port` abstract class at all.                                                     |
| `feature-source-subject`          |    6 | A module claiming a subject another feature owns — billing/organization, billing/notification, trace/topic, trace/analytics.                          |
| `enterprise-composition`          |    2 | `composition/api` importing `@langwatch/gateway-server` instead of a contract or installer.                                                            |
| `cross-feature`                   |    1 | billing depending on `@langwatch/notification-server`; it may depend only on the contract.                                                             |
| `contract-build-config`           |    0 | Closed in `6443405af9`.                                                                                                                                 |
| `feature-catalogue`               |    1 | Catalogue entries out of classification/id order.                                                                                                     |
| `legacy-feature-fragment-baseline`|    0 | Closed in `6ec280aec8`.                                                                                                                                 |
| `global-app-access-baseline`      |    0 | Closed in `6ec280aec8`.                                                                                                                                 |

Two of these are not hygiene and should not be scheduled as such.
`eventing-subscriber-idempotency` asks for proof that handling the same source
event twice leaves one externally visible result, which is a correctness
property of the worker the plan is building. `prisma-containment` is the
enforceable half of the persistence boundary every Wave 6 vertical claims.

## Gateway and experiments-v3 lift-and-shift, 2026-09-02

**`platform/app/src/server/gateway/**` moved WHOLE into `@langwatch/gateway-server`** —
28 files, 7,180 lines, zero insertions in `platform/app`. Ten services under
`services/` (`virtual-key`, `virtual-key-authorization`,
`virtual-key-direct-budget`, `gateway-applicable-budgets`,
`gateway-budget-overview`, `gateway-budget-change-dedupe`,
`gateway-guardrail-evaluation`, `gateway-realtime-session`,
`gateway-elevenlabs-credential`, `gateway-config-materialisation`), seven
adapters (`gateway-scope-resolver`, `gateway-config-etag`,
`gateway-spend-scope`, `gateway-model-tier-fallthrough`,
`gateway-model-tier-presets`, `gateway-provider-model-catalog`,
`gateway-realtime-session-span`, `jwt.gateway-token`) and ten suites beside
them. `platform/app/src/utils/modelTierPresets.ts` travelled with the
fallthrough that was its only remaining reader, and
`platform/app/src/server/rbac/` fell empty behind it.

**Six new ports, each a seam the move exposed rather than an abstraction it
invented.** `GatewayScopePermissionsPort` replaces the app-layer imperative
probes and the role-binding resolver with two questions — a session's cascade
and a scoped API key's ceiling — kept apart so a key cannot inherit the user's
full cascade. `GatewayModelProviderCredentialsPort` fronts `readCustomKeys`,
because the cipher belongs to Model Provider and a core package may not depend
on another feature's server package. `GatewaySpendRatingPort` and
`GatewaySpendConfirmationPort` carry the voice settlement's two reaches into
the spend pipeline, which stayed in platform (`server/event-sourcing/pipelines/
gateway-spend-processing/**` is still read by `server/routes/gateway-internal.ts`,
another lane's file). `GatewaySpanIngestionPort` replaces
`getApp().traceIngestion?.collection`. `GatewayGovernanceSignalsPort` replaces
the Enterprise governance service.

**Finding recorded rather than preserved:** `VirtualKeyService` constructed
`AppGovernanceSignalsService.disabled()` in its own constructor, so all five
virtual-key lifecycle emissions reached a null object in every process. The
port is optional and unset by default, which keeps the behaviour and says so;
a deployment that composes a ledger now gets the signals for the first time.

**Judgment calls.** The `prisma`/`getApp()` singletons became injected
collaborators, so four modules changed shape: `spendScope.ts` is now
`GatewaySpendScopeAdapter.create({ database })` holding its own 30s project
cache (two processes over two databases must not share one map);
`gatewayJwt.ts` is `GatewayJwtAdapter.create({ secret })` and reads no
environment; `realtimeSession.service.ts`'s exported functions each take a
named `collaborators` bag; `getElevenLabs*` and `GatewayConfigMaterialiser`
take the credential port. `PersonalUsageQueryInput`/`PersonalUsageBreakdown`
were restated structurally rather than imported from
`@langwatch/enterprise-governance-contract`. The three `explainHandledError`
assertions in the two moved error suites were dropped: the presentation
registry is `platform/app/src/features/errors/logic/presentation.ts`, a client
surface this migration only deletes from — a recorded coverage loss on the
customer copy for `gateway_scope_org_mismatch`,
`gateway_group_budget_unsupported`, `gateway_spend_unavailable` and
`gateway_budget_cycle_anchor_invalid`, replaced by an assertion that the wire
message names no engine. `__tests__/support/virtualKeyDirectBudgetFixture.ts`
was deleted rather than moved: nothing imports it, its suite having already
gone.

**Named absence: the gateway REST families are still not mounted on
`apps/api`.** `createGatewayPlatformRestApp` and `createGatewaySpendRestApp`
take a `GatewayApp`, and building one needs the ~200-line
`composeGatewayApp` that lives in `platform/app/src/server/app-layer/presets.ts`
over `gatewayStores` — Enterprise governance virtual keys, the ClickHouse
budget and virtual-key spend repositories, the webhook services and the
idempotent runner. That is `app-layer`, which the ruling says to replace with
explicit process composition rather than copy, and it is a slice of its own.
Until it lands, `apps/api` has no reader for `LW_GATEWAY_INTERNAL_SECRET` or
`LW_GATEWAY_JWT_SECRET`, so **neither was added to `api.config.ts`**: a config
leaf nothing reads is a wiring bug that reads as done. Both belong there in the
same change that mounts the families, as secret leaves that are never logged —
`GatewayJwtAdapter` already takes its secret as a constructor argument and
returns it to nobody, and the HMAC verifier for the Go data plane's
control-plane calls arrives with `server/routes/gateway-internal.ts`, which is
another lane's file.

**`platform/app/src/server/experiments-v3/**` moved PARTIALLY** — 7 files, 628
lines, zero insertions. Into `@langwatch/experiment-server`:
`EvaluatorNoInputsResolvedError` (`experiment-execution.errors.ts`),
`createSemaphore` and the evaluator score filter with both suites (`processes/`),
`getRunUrl` (now taking an explicit `baseUrl` rather than reading
`NEXT_PUBLIC_BASE_URL`), and `abortManager` as an
`ExperimentRunAbortPort` + `RedisExperimentRunAbortAdapter` over an injected
connection. `legacy-workbench.schema.ts` was DELETED rather than moved: the
package's own `workbenchStateSchema` in
`transport/api-rest/experiment.schemas.ts` is the same schema, already exported
and already what `apps/api`'s execution composition passes as
`experimentPorts.workbenchStateSchema`, and both of the platform copy's imports
had already gone.

**Named blocker, and it is a fence rather than a difficulty.** The remaining
eleven modules — `orchestrator.ts` (3,610), `workflowBuilder.ts` (1,188) with
its two suites, `resultMapper.ts` (593), `dataLoader.ts` (571),
`experimentRunner.ts` (349), `runStateManager.ts` (269), `savedStateExecution.ts`
(221), `workbenchTargetNames.ts` (150), `runStateMirror.ts` (119) — all
VALUE-import the workbench's shared execution model, and that model now lives
in `@langwatch/experiment-web` under `src/model/experiments-v3/`:
`execution/types.ts` (510), `execution/run-results.ts` (506),
`execution/build-execution-request.ts` (419), `execution-scope.ts` (212),
`normalize-comparison.ts` (195), `empty-row-detection.ts` (67),
`target-display-name.ts` (44) and `variant-disambiguation.ts` (31) — 1,984
lines. Every one is framework-free, and a server package value-importing a
framework-free subpath of a web package is already precedent
(`@langwatch/dashboard-server` imports `@langwatch/analytics-web/validation`).
The block is the EXPORTS MAP: `experiment-web` publishes only
`./experiments-v3/types`, `./experiments-v3/types/persistence` and three
`utils/*` subpaths, none of them the eight above, and `moduleResolution:
"Bundler"` enforces it. `dataLoader.ts` additionally needs
`transposeColumnsFirstToRowsFirstWithId`, which `@langwatch/workflow-web`
publishes only through its React-laden root. Two remedies, both edits to a web
package this lane may not make: add framework-free subpath exports for the
eight modules, or move them to `@langwatch/experiment-contract`, which both
tiers may import. The second is the better one — the model is a contract
between the browser that composes a run and the server that executes it — and
it is the one line the experiments-v3 half is waiting on. Copying the 1,984
lines into `experiment-server` was refused: it would give the workbench two
answers to what a cell is.

**Sweep not taken, with the reason.** `server/{workflows,modelProviders,
evaluations,filters}/**` were checked for being reached only by these two
subtrees, and none is: every one still has consumers in `server/app-layer/**`,
`server/api/**`, `server/routes/**` or another package.
`server/workflows/workflowEvaluation.service.ts` in particular is blocked
behind the same experiments-v3 fence — it imports `loadExecutionData` and
`startPollingRun`.

**Gates.** gateway-server 26 files/215 tests to 36/274, `tsc --noEmit` clean;
experiment-server 16/5,173 to 18/5,188, clean; `apps/worker` 52 files/409 tests
green (the 409 baseline); `git diff --numstat -- platform/app` zero text
insertions on every row. `apps/api` is red at 10 files/9 tests for reasons this
lane did not touch and did not fix — the record-membership assertion in
`api-trpc-collaborators.product.integration.test.ts` now sees 67 namespaces
against an expected 55 (`automation`, `codingAgents`, `dataRetention` and nine
more arrived from concurrent lanes), plus agent-group SSE, roles, protections
and the standalone executable. No file under `apps/api` was edited here.

## The `app-layer` server bucket, subtree by subtree (2026-09-02)

`platform/app/src/server/app-layer/**` was the biggest remaining server bucket.
Ten subtrees moved into the packages that own them under the lift-and-shift
recipe — plain moves, shape kept, the moved code's imports fixed, every other
platform importer left broken, and everything the move made unreachable
deleted. **120 files / 24,418 lines left `platform/app` at zero insertions**
(`git diff --numstat -- platform/app` shows `0` in the first column on every
row). What is left under `app-layer` is 12,901 non-test lines, and all of it
belongs to another lane: `traces/`, `organizations/`, `langy/`, `authz/`,
`clients/`, `broadcast/`, `permissions/`, `events/`, `enterprise/`, the three
NLP-lambda modules and the composition root itself (`app.ts`, `presets.ts`,
`dependencies.ts`, `config.ts`, `index.ts`). **All of it except the
composition root left in the residue slice recorded below.**

| Subtree | Lines out | Owner it moved to | Shape it landed in |
| --- | ---: | --- | --- |
| `ops/` | 5,783 | `@langwatch/ops-server` | 4 services, 2 ClickHouse + 2 Prisma + 1 Redis repository, 3 ports, 1 adapter, 7 suites |
| `identity/` + `_shared/` | 5,941 | `@langwatch/identity-server` (one file to `@langwatch/enterprise-scim-server`) | 4 services, 3 migrations, 2 adapters, 8 Prisma repositories, 6 suites |
| `system-migrations/` | 5,231 | `@langwatch/ops-server` + `@langwatch/system-migrations` | the ops model, its cohort policy and 5 repositories to ops; the convergence loop to the engine |
| `billing/` | 2,412 | `@langwatch/enterprise-billing-server` | the Stripe webhook service and the eight Customer.io lifecycle signals |
| `scheduler/` | 1,793 | `@langwatch/eventing` | `src/server/schedule/**` beside `next-run-at.ts`, store under `adapters/postgres/` |
| `reports/` | 1,061 | `@langwatch/automation-server` | 3 services under `services/`, 2 suites |
| `subscription/` | 558 | `@langwatch/enterprise-licensing-server` | the plan provider and its 2 suites; the Stripe interfaces deleted as displaced |
| `usage/` | 348 | `@langwatch/entitlement-server` | enforcement service, limit-message service, 4 new ports |
| `evaluations/` | 261 | `@langwatch/evaluation-contract` + `-server` | the seven refusals and the Postgres cost recorder |
| `bug-reports/` | 232 | `@langwatch/ops-server` | the public intake service and its Slack notifier adapter |

### What each move had to redesign, and why

Only the seams a package cannot cross were redesigned; everything else is the
platform file with its imports repointed.

- **`ops/` — two process globals became ports.** `EventExplorerService` and
  `ManagerExplorerService` read the live pipeline surface off
  `getProjectionMetadata()` / `getProcessManagerMetadata()`, module functions
  over `getApp().eventSourcing.definitions`. They now take an
  `OpsEventingIntrospectionPort`, satisfied by a new
  `EventingOpsIntrospectionAdapter` that walks the `StaticPipelineDefinition[]`
  the composition already holds — the same walk, byte for byte, including the
  three pause-key segments (`projection` / `handler` / `stateProjection`) the
  dispatcher's Lua check matches on. `ReplayService` took `createReplayRuntime`
  and `env.REDIS_URL` directly; it now takes an `OpsReplayRuntimePort` whose
  `create()` throws, and the existing catch finalises the run with the thrown
  message — which is exactly what the old `REDIS_URL is not configured` branch
  did, one branch fewer. The replay runtime itself did NOT move: it reaches six
  feature packages' projection stores plus the deployment's ClickHouse
  resolver, so it is a composition, not a service.
- **`bug-reports/` — the intake's three globals became ports.** The global
  `prisma`, `rateLimit()` and the default Slack notifier are now
  `BugReportRepository` (the port ops-server already had),
  `BugReportRateLimiterPort` and `BugReportNotifierPort`. The Slack alert kept
  every Block Kit block and became `SlackBugReportNotifierAdapter` over an
  `OpsSlackAlertTransport` plus a stated config, so the bot token and channel
  are the deployment's rather than `env`'s.
- **`identity/` — the composition root was NOT moved.** `identity/runtime.ts`
  (537 lines, 26 module-singleton factories over the global `prisma`, `env`,
  the mailer and PostHog) is `platform/app`'s composition of the identity
  graph, and its owner is `apps/api`'s `ApiAuthComposition`. Recreating those
  factories inside a package would compose the identity graph a second time —
  the second better-auth instance the ruling forbids — so it was deleted rather
  than moved. The two files that read it now take what they need: the teardown
  dispatcher takes `() => SsoConnectionService`, and the SCIM sync ledger takes
  the `IdentityEventingPort` the sibling identity ledger already used instead of
  `tryGetApp()`.
- **`identity/` — five repositories were duplicates and were deleted, not
  moved.** `identifier-row.ts`, `identity-heads`, `identity-reservations`,
  `identity-users` and `mfa-enrollment` already exist in `identity-server` in
  their adapted form (static `create`, narrowed client slices, the package
  mapper). The platform copies were the stale originals the worker lane left;
  keeping either would have given the package two answers to one question. The
  moved `mfa-enrollment` projection repository lost its own `rowToEnrollment`
  for the package's `mfaEnrollmentRowToState` for the same reason, and
  `IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME` now has ONE definition
  (`identity-migration-names.ts`) that `prisma.identity-latch.repository.ts`
  imports — it had been declared twice with the same string, which is a latch
  and a migration silently agreeing by luck.
- **`identity/scim-sync-lifecycle.ts` went to `@langwatch/enterprise-scim-server`,
  not identity.** It implements `ScimSyncLifecyclePort`, which that package
  declares, and it carries the Enterprise SPDX header; a core package is the
  wrong home for both. It takes `newCommandId` as a required parameter instead
  of importing identity's generator, so the enterprise package takes no VALUE
  off a core feature's server package — only two `import type`s.
- **`system-migrations/` went to `@langwatch/ops-server`, not a new feature.**
  `system-migrations.service.ts` answers in `@langwatch/ops-contract`'s own
  vocabulary (`OpsMigrationOverview`, `OpsMigrationEnrollmentRecord`), the
  contract already carries `ops-system-migration.ts`, and the tRPC namespace
  that reads it is an ops namespace. A `packages/features/system-migration/`
  would have claimed a subject `ops` already owns and needed a catalogue entry
  for it. The nine `HandledError` subclasses went to the contract as
  `ops-system-migration.errors.ts` beside `ops-scheduler.errors.ts`. The
  convergence loop (`boot.ts`) went to the ENGINE package instead: it is
  generic — interval, pass cap, the two stop conditions — and it now takes a
  `SystemMigrationPass` rather than importing the composition it drove.
  `system-migrations/runtime.ts` was deleted for the same reason identity's was.
- **`scheduler/` lost its process-role import.** `SchedulerService` took
  `processRole: ProcessRole | undefined` and called `roleRunsWorkers` on it; it
  now takes `runsWorkers: boolean`, because the role enum is a deployment fact
  and `roleRunsWorkers(processRole)` is what the composition already computes
  for every other packaged worker. Its four `captureException` calls were
  dropped: `~/utils/posthogErrorCapture` no longer exists, and every one of them
  sat directly beside a `logger.error` carrying the same fields.
  `~/server/utils/pgTimestamp.ts` moved with the store (it had no other
  importer) as `adapters/postgres/pg-timestamp.ts`.
- **`reports/` went to `@langwatch/automation-server`, not analytics or
  dashboard.** Every type it touches is automation's — `Trigger`,
  `ReportChart`, `ReportTraceRow`, `buildReportTemplateContext`,
  `REPORT_TRIGGER_DEFAULTS`, `renderTriggerEmail` / `renderTriggerSlack` — the
  catalogue gives automation the `report-schedule` subject, and the package
  already held `ReportScheduleService`, `ScheduledJobStorePort` and the three
  Slack adapters. `ReportDispatchDeps` now names
  `AutomationNotificationDeliveryPort` and `AutomationSlackProviderPort` rather
  than four platform functions, so a report email carries the same ADR-031
  unsubscribe footer every other automation notification does. The e-mail send
  passes `isRecipientSent: async () => false` and a no-op recorder, which is
  exactly the always-send fallback the application took by omitting both
  callbacks — the scheduler's slot lease is what stops a double send.
  `report-chart.service.ts` declared a `ReportGraphInput` for the four fields a
  report reads off the stored graph JSON, because the full `CustomGraphInput` is
  a browser type in `@langwatch/analytics-web`.
- **`billing/` — five of the nine enterprise files were displaced
  composition and were deleted.** `subscription.service.ts` says so in its own
  docblock ("Thin app composition adapter; the enterprise implementation is
  packaged"), and `usage-limit.service.ts`, `license-purchase.service.ts` and
  `billing-runtime.adapter.ts` are the same shape over
  `@langwatch/enterprise-billing-server`'s packaged services. What moved is
  `webhook.service.ts` (1,013 lines, no packaged twin) with three new ports —
  `BillingWebhookOrganizationPort` (the four organization reads a webhook
  makes; the aggregate is core's), `BillingWebhookHostPort` (the Slack channel
  and the retention rules a paid subscription provisions, both read off
  `getApp()` before), and `billing-webhook-subscription.port.ts`, which is the
  platform `SubscriptionRepository` interface moved verbatim so the service's
  own shape did not change. The `traced()` OTEL method proxy is a platform
  helper with no packaged home, so `EEWebhookService.create` no longer wraps
  itself — a recorded loss of per-method spans, not of behaviour.
- **`billing/nurturing/` kept its domain logic and gained a registration
  seam.** The eight files hold the decisions (which Customer.io event, which
  traits, the hourly identify debounce, the first-login sync cache); the
  packaged `NurturingService` is only the HTTP client. They read
  `getApp().nurturing`, the global `prisma` and `projectService.resolveOrgAdmin`
  from deep inside transports and hooks that hold no billing graph, so the
  process registers them once (`setNurturingSink`, `setNurturingDatabase`,
  `setNurturingOrganizationAdminResolver`) exactly as `setTraceCacheRedis`
  already does for the trace cache. A process that registers nothing fires
  nothing, which is the documented behaviour rather than a failure — every one
  of these signals is fire-and-forget by construction. `captureException`
  became `reportNurturingFailure`, a warn line, for the same reason.
- **`usage/` took four ports.** `UsageService` reached the organizations and
  traces trees (`OrganizationService`, `TraceUsageService`,
  `EventUsageService`, `OrganizationRepository`) and the trace package's
  `TtlCache`. It now takes `UsageOrganizationPort`, two
  `UsageVolumeCounterPort`s and two `UsageCachePort`s (absent means uncached,
  never wrong), plus a stated `UsageDeployment` — `IS_SAAS` and `BASE_HOST`
  were the only `env` reads left in the subtree and they decide one sentence of
  copy. `UNLIMITED_MESSAGES` is stated rather than imported from the Enterprise
  billing contract, which is the call `usage-stats.service.ts` in the same
  package already made for the same sentinel. `usage-meter-policy.ts` was
  already moved by the sibling trace lane and was not duplicated.

### Named absences and recorded coverage losses

- **The evaluation EXECUTION path did not move.** `evaluation-execution.service.ts`
  (676 lines) and its factories reach six modules this lane does not own — the
  trace-mapping registry (`server/tracer/tracesMapping`, `spanToReadableSpan`),
  the installed-evaluator catalogue and thread-mapping resolver
  (`server/evaluations/**`), the native-evaluator observability adapter and the
  Langevals runtime (`runtime/app/**`) — and its only live callers are
  `server/evaluations/runEvaluation.ts` and `routes/evaluations-legacy.ts`,
  both of which this migration only deletes from. Moving it behind a fifteen-
  method host port would have produced a refusal surface nothing composes.
  What moved is the part that stands alone: the seven refusals (as
  `evaluation-execution.errors.ts` on the contract) and the Postgres cost
  recorder (which implements a port `@langwatch/evaluation-server` already
  declared). `app-layer/evaluations/types.ts` was a compatibility re-export of
  `@langwatch/evaluation-contract` and was deleted rather than moved — the ban
  on re-export modules is the whole reason it existed.
- **The contract's weaker `EvaluationNotFoundError` won.**
  `evaluation-execution.errors.ts` dropped the platform's `NotFoundError`
  subclass of that name: `@langwatch/evaluation-contract` already exports an
  `EvaluationNotFoundError` that `evaluation.service.ts` throws and its suite
  asserts on, and two classes with one name in one package index is worse than
  a weaker base class. Promoting the contract's to a `HandledError` is a change
  of its own.
- **Five identity repository integration suites were deleted, not moved**
  (`identity-backfill`, `identity-heads`, `identity-newborn`,
  `identity-reservations`, `identity-secret-carry`). Every one drives
  `prisma` from `~/server/db`; `identity-server` holds no database harness and
  its `vitest run` is the package gate, so moving them would have made the gate
  require Postgres. This is the same call the organizations slice recorded, and
  it is a real coverage loss on those five repositories' SQL.
- **One file stays under `app-layer/identity`:**
  `__tests__/sso-onboarding-refusals.unit.test.ts`. It binds a spec scenario
  ("Every refusal on these surfaces carries a code and words written for a
  customer") to the CLIENT presentation registry at
  `platform/app/src/features/errors/logic/presentation.ts`, which this lane does
  not own. Moving it would need the registry; deleting it would unbind the
  scenario. It is left where it is, for the errors/UI lane.
- **`billing/enterprise/__tests__/licensePurchaseHandler.unit.test.ts` was
  deleted.** It drives the deleted platform factory `createLicensePurchaseService`
  through four `vi.mock`s of platform modules; the behaviour underneath is
  `LicensePurchaseService.handle`, which `@langwatch/enterprise-billing-server`
  already covers in `__tests__/licensePurchaseService.unit.test.ts`.
- **`subscription/subscription.{service,repository}.ts` were deleted as
  displaced.** Their only consumer was the composition adapter deleted in the
  same pass, and the package holds `BillingSubscriptionService`,
  `BillingSubscriptionRepository` and `PrismaSubscriptionRepository`. The
  webhook's copy of the repository interface survives as a port because the
  webhook's own shape depends on it.
- **`apps/api`'s nurturing absences stay absences.**
  `api-trpc-collaborators.org-group.composition.ts` and the agent-group one
  still answer `fireTeamMemberInvitedNurturing` and `fireScenarioCreatedNurturing`
  with a no-op and a log line. Closing them needs Customer.io configuration
  leaves on `api.config.ts` — a shared file under anchored-edit rules with
  eight lanes in flight — and the signal is a marketing one whose absence is
  already logged rather than refused. No `apps/api` or `apps/worker`
  composition imported any moved module, so nothing else needed rewiring.

### Gates

Every touched package typechecks clean (`tsc -p tsconfig.json --noEmit`, 0
errors) and its whole suite is green: eventing 112 files / 984, ops-server
38 / 306+32 skipped, ops-contract 2 / 8, identity-server 36 / 324 (from 29 /
288), enterprise-scim-server 9 / 80, system-migrations 2 / 29,
automation-server 29 / 225, enterprise-billing-server 26 / 268+25 skipped,
enterprise-licensing-server 10 / 180, entitlement-server 1 / 4,
entitlement-contract 1 / 2, evaluation-server 25 / 193, evaluation-contract
1 / 2. `apps/api` is 486 passing across 55 files with two failures neither of
which this lane can reach — `api.config.unit.test.ts` expects a config shape
without the concurrent lane's in-flight `metricsApiKey` / `otlpMetrics` leaves,
and `api-trace-ingest.otlp.integration.test.ts` passes on its own and fails
only inside the full run. `apps/worker` is 411 passing across 55 files with 8
failures in the same three files the same concurrent lane owns (every one is
`No "otlpMetricsExportOptionsFrom" export is defined on the
"@langwatch/observability/node" mock`, or the config shape that goes with it).
`git diff --numstat -- platform/app` shows zero insertions on all 355 rows.


## The app-layer residue and the ONLINE evaluation path (2026-09-02)

**130 files / 32,236 lines leave `platform/app` at zero insertions**, and what
is left under `app-layer` is the composition root and nothing else:
`app.ts`, `config.ts`, `dependencies.ts`, `index.ts`, `presets.ts`,
`redis-readiness.ts`, `worker-eventing-handoff.ts` — 5,361 non-test lines, down
from 12,901 — plus three test files another lane owns
(`__tests__/error-remediation.unit.test.ts`,
`__tests__/governance-ingestion-template.integration.test.ts` and the
`identity/__tests__/sso-onboarding-refusals.unit.test.ts` the identity lane
deliberately left). `server/{traces,filters,license-enforcement,enterprise,
modelProviders,clickhouse}` are GONE as directories, and `server/event-sourcing`
is down to one pipeline.

| Subtree | Files / lines out | Owner it moved to | Shape it landed in |
| --- | ---: | --- | --- |
| `app-layer/traces/` | 25 / 8,695 | `@langwatch/trace-server`, `-log-server`, `-metric-server`, `-data-privacy-server` | 5 services + 2 ports to trace, the OTLP log and metric collections to their own features, the span PII redactor to data privacy; 8 modules deleted as displaced twins |
| `server/clickhouse/` | 25 / 5,499 | `@langwatch/clickhouse-client` | the query defaults and the private-route-key grammar; the rest deleted as composition over the package |
| `server/event-sourcing/` | 14 / 5,765 | `@langwatch/eventing` consumers | 2 replay suites to trace-server; the registry, the global billing meter and the postgres/integration harness deleted as displaced |
| `server/modelProviders/` | 16 / 2,597 | `@langwatch/model-provider-contract` | 7 catalogue suites and their helper; two re-export shims and a duplicate suite deleted |
| `app-layer/organizations/` | 3 / 1,967 | `@langwatch/organization-server` | nothing moved — all three are displaced by the package's own successors |
| `server/traces/` | 9 / 1,314 | `@langwatch/trace-server` | the agent-readable digest and the REST projection compiler; the two usage counters deleted as `getApp()` glue |
| `app-layer/evaluations/` | 3 / 904 | `@langwatch/evaluation-server` + `apps/worker` | the 676-line execution engine and its 7 new ports; the model-env factory to the worker |
| `server/filters/` | 1 / 637 | — | deleted: two of its own relative imports were already gone and both consumers are platform |
| `server/license-enforcement/` | 8 / 581 | `@langwatch/enterprise-licensing-contract` | the limit labels and the two refusals; the rest deleted as displaced by `@langwatch/entitlement-server` |
| `app-layer/authz/` + `permissions/` | 6 / 821 | `@langwatch/authz-contract` | `MembershipDisabledError` and its suite; the other five modules deleted as displaced |
| `server/enterprise/scim/` | 2 / 489 | `@langwatch/enterprise-scim-server` | nothing moved — both are Hono mounts over route descriptors the package already exports |
| `app-layer/clients/` | 6 / 810 | `apps/worker` | nothing moved — `WorkerTiktokenCounterAdapter` is already the verbatim twin |
| `app-layer/langy/`, `events/`, `enterprise/`, `nlp-lambda.*` | 6 / 651 | — | deleted; see the absences below |
| `server/stored-objects/` (4 extractors) | 4 / 1,494 | `@langwatch/trace-server` | the content-part, media, array-coercion and binary-part walkers |

### The ONLINE evaluation path, end to end

`withoutEvaluatorExecution()` in
`apps/worker/src/app/worker-evaluation-processing.composition.ts` **is closed**.
`createWorkerEvaluationProcessing` takes an optional `execution` bundle; with it
supplied the composition builds the package's own chain —
`EvaluationExecutionIntentService` prepares (monitor lookup, sampling,
preconditions, settings recovery), a receipt runs `EvaluationExecutionService`
and bills it, and the outcome service turns the result into the reported event —
and without it the same `AbsentEvaluatorExecution` refuses by name as before.
Nothing in the composition re-implements a step; it only says which substrate
each one runs on.

Moved into `@langwatch/evaluation-server`:
`services/evaluation-execution.service.ts` (the 676-line engine that renders a
stored trace through its evaluator mappings and runs the evaluator),
`services/evaluation-thread-mapping.service.ts`, and
`adapters/http.langevals-evaluator.adapter.ts` (was
`platform/app/src/runtime/app/langevals.runtime.ts`, retries, timeout, 413 and
all). Seven new ports in `ports/evaluation-execution.port.ts` replace what the
engine used to reach for directly: `EvaluationTraceReadPort` (the three legacy
trace reads), `EvaluationSpanDigestPort`, `EvaluationLangevalsPort`,
`EvaluationModelEnvPort`, `EvaluationWorkflowExecutorPort`,
`EvaluationExecutionTelemetryPort` and, narrowed off the preparation service so
a worker need not compose a whole `MonitorService` or contract `TraceService`
to answer two reads, `EvaluationMonitorLookupPort` and
`EvaluationTraceEvidencePort`. `apps/worker/src/app/worker-evaluation-model-env.composition.ts`
is the model-provider bridge — the same call `apps/api` already made for the
LiteLLM parameter resolution, kept in a composition root because a feature
server package may not depend on another feature's.

**The trace-mapping registry moved to `@langwatch/trace-contract`.** It had been
parked in the BROWSER package `@langwatch/trace-web`, where no server module may
value-import it, which is why `mappingsSchema` and `coerceMonitorMappings`
degrade to a permissive parse today. `traces-mapping.ts` (1,418 lines) is now
`trace-contract/src/trace-mapping.ts`, with the three framework-free helpers it
needs (`trace-rag-extraction`, `trace-rag-chunks`, `trace-collector-common`) and
the PCM-to-WAV converter beside it, and the fourteen web importers repointed.
`AnnotationWithUser` moved from `annotation-web/model/annotation-row.ts` into
`@langwatch/annotation-contract` in the same pass, because
`trace-contract -> annotation-web -> trace-web -> trace-contract` would have
been a package cycle; `AnnotationUser` stayed in the web package, since the
contract already declares a stricter one under that name and two would be worse
than one narrowing. `DEFAULT_MAPPINGS`, `mappingsReadEvaluationsSource` and
`migrateLegacyMappings` moved from `evaluator-web` into
`@langwatch/evaluator-contract` for the same reason.

Proof: `apps/worker/src/app/__tests__/worker-evaluation-processing.composition.unit.test.ts`
(4 tests) drives `command:executeEvaluation` through the composed pipeline over
fakes at every process seam and asserts the Langevals transport received the
evaluator type, the resolved settings, the model provider's environment AND the
`input`/`output` the trace mappings produced — then that a
`lw.evaluation.reported` event came back. Two more pin the absences: the
refusal when the bundle is absent, and the receipt ledger named at boot.

### Named absences and recorded losses

- **The execution RECEIPT ledger did not move.** The platform wrapped the
  evaluator call in `withIdempotency` over `~/server/api/idempotency.ts`, a
  752-line generic receipt table with a claim heartbeat and takeover that no
  package owns (`@langwatch/api/rest`'s `idempotency.ts` is the WIRE half, and
  its own docblock says the ledger stays in the process that owns a database).
  `DirectEvaluationExecutionReceipt` runs the engine and records the cost
  instead, and `withoutExecutionReceiptLedger()` says so at boot. The MONEY is
  unaffected — `PrismaEvaluationCostRecorder` derives the cost id from the
  operation key, so a redelivery finds the row it already wrote — and the
  evaluator call was already at-least-once by the platform receipt's own
  docblock, which finalises after the provider has answered. What is lost is the
  narrower crash window, not the guarantee.
- **`withoutClusteringModels()` is NOT closed, and it is one composition away.**
  **CLOSED 2026-09-02 by the model-gateway lane; see "The worker's own model
  gateway" at the end of this document.**
  `ModelProviderExecutionAdapter` in `@langwatch/model-provider-server` already
  implements `TopicClusteringModelsPort` whole; what it needs is a
  `ModelProviderService`, which means composing `PostgresModelProviderAdapter`'s
  six ports in the worker the way `apps/api/src/app/api-model-provider.composition.ts`
  does. That is the SAME service `EvaluationModelEnvPort` takes, so one
  composition closes both — and it needs new `infrastructure.modelProvider`
  leaves on `apps/worker/src/platform/config/worker.config.ts`, a file a
  concurrent lane holds. Left for that lane rather than edited under it.
- **`spend-rating.service.ts` and its three unit tests stay in platform.**
  `GatewaySpendRatingPort` already states the seam in
  `@langwatch/gateway-server`, but the rule reaches the model-cost catalogue
  through `getStaticModelCosts` and `matchModelCostWithFallbacks`, whose
  packaged successors are `@langwatch/model-provider-contract`'s
  `getStaticModelCostRates` (a different return shape) and
  `@langwatch/trace-server`'s `trace-span-cost-matching.service.ts` — which a
  gateway server package may not reach. Filling the port belongs with whoever
  collapses the two cost catalogues; leaving the module keeps its three
  money-pricing suites running.
- **`llmModelCost.tsx` was deleted, not moved.** Its successor is
  `ModelCostCatalogService` + `postgres.model-cost-catalog.adapter.ts` in
  `@langwatch/model-provider-server`, a different implementation, so its two
  suites (`llmModelCost`, `llmModelCostCascade`) are a rewrite rather than a
  move and are gone. `modelDefaults.collapseDuplicatesMigration.integration.test.ts`
  went with them: it reads a migration SQL file and belongs with
  `packages/prisma-client`.
- **`model-provider-services.test-support.ts` was deleted.** It is stale against
  the packaged `ModelProviderService` (missing `refreshCodexForGateway`) and
  both its importers were platform tests.
- **The langy UI-action modules were deleted.** `pageManifests.ts` and
  `uiActionBackendExecutor.ts` reach six `~/experiments-v3/**` modules that no
  longer exist on this branch, their one consumer is
  `server/routes/langy-ui-actions.ts` (REST wave 2's, already broken), and
  `LangyUiActionCatalogPort`'s own docblock says the workbench catalogue must
  NOT move into the langy package. Rebuilding the catalogue over the experiments
  workbench is the experiments lane's.
- **The two NLP-Lambda modules were deleted.** They compose
  `@aws-sdk/client-lambda`, `~/runtime/app/aws-client.composition` and
  `~/server/s3/stagePayload` — the deployment's AWS graph, not a workflow
  service — and `@langwatch/workflow-server` already carries the HTTP dispatch
  the self-hosted and local stacks run. This is the same call the studio-host
  slice recorded when it declined to carry the per-project Lambda routing.
- **`app-layer/enterprise/managed-providers.adapter.ts` was deleted.** Every
  class it assembles is already exported from
  `@langwatch/enterprise-managed-provider-server`; the file is a `createLogger`
  binding plus an assembly, which is a composition, not a service.
- **`app-layer/events/track-event.service.ts` was deleted.**
  `TrackedEventSpanService` in `@langwatch/trace-server` is the same sha256
  span-id derivation and OTEL span build, already mounted with its REST family
  and its sync subscriber.
- **`app-layer/clients/tokenizer/**` was deleted, its test with it.**
  `apps/worker/src/platform/infrastructure/worker-token-counter.adapter.ts` is
  the verbatim `TiktokenClient` behind `TraceTokenCounterPort` — the port's own
  docblock says the tiktoken implementation stays in the application — and it
  carries its own suite.
- **`server/traces/{event,trace}-usage.service.ts` were deleted.** Both are
  `tryGetApp()` glue over `billingQueries`, and `@langwatch/entitlement-server`
  already declares `UsageVolumeCounterPort` for exactly the two readings they
  take. `usage-count.ts` went with them: `USAGE_UNKNOWN` and `UsageCount` are
  byte-identical in `usage-counter.port.ts`, and nothing outside those two files
  ever read `ProjectUsageCounts`.
- **`server/filters/triggerFilter.matcher.ts` was deleted.** It cannot compile —
  `./precondition-matchers` and `./types` are gone, and their successors are
  BROWSER modules in `@langwatch/analytics-web` — and `matchesEvaluationFilters`
  is already an abstract method on `AutomationSettlementPort` with a packaged
  implementation. Both its consumers are platform.
- **`server/clickhouse/**`'s suites were deleted, and that is a real loss.**
  `schemaLock`, `replicatedEngineGuard`, `rmtTtlCompatibility`,
  `privateClickhouseDataIsolation` and `clickhouseClient.integration` all need a
  live ClickHouse, and `@langwatch/clickhouse-client`'s `vitest run` is the
  package gate — moving them would have made that gate require a datastore, the
  same call the identity lane recorded for its five Postgres suites. The unit
  suites that went with them (`connectionPool`, `safeClickhouseClient`,
  `managedClient`, `metrics`) covered the platform's composition rather than the
  package's own pool, client and statement reporting, which have their own 239
  tests.
- **The record-shaped half of the PII redactor came across after all.**
  `otlp-span-pii-redaction.service.ts` in `@langwatch/data-privacy-server` had
  deliberately carried only the span half; `redactLog`, `redactMetricAttributes`
  and their seven helpers are now beside it, delegating the policy resolution to
  `PiiRedactionPolicyService` rather than re-declaring it. Without them the four
  path-keyed-log tests — two of which carry `@scenario` annotations — would have
  had no subject and two spec scenarios would have silently unbound.
- **`formatTimeAgo` is now stated in `trace-formatting.service.ts`.** The shared
  helper was `platform/app/src/utils/formatTimeAgo.ts`, which 23 platform
  modules read and deletes-only forbids repointing, and
  `@langwatch/evaluator-web` already carries the browser narrowing. A server
  module may not import a browser package, so the two sides state it separately;
  the wording and the 24-hour threshold must stay identical, because the digest
  a customer reads and the list they read it beside are the same sentence.
  `clampMaxTokens` is the same shape and now lives in
  `@langwatch/model-provider-contract`; the two `web` copies were left alone.
- **`DeepPartial` is stated in each of the two collection services.** An OTLP
  export request is JSON a client assembled, so the transformer's interface
  describes what a conforming exporter sends rather than what lands.
- **`EdgeMediaExtractionDeps.hasContentDropRules` became REQUIRED.** It had a
  default that read `getDataPrivacyPolicyService()` off the platform graph. A
  default answering `false` would store media at the edge for exactly the
  projects whose policy is about to discard that content, which is the interlock
  the hook exists to honour, so the process must state it. The
  `edge_media_extract_fail_open` counter became
  `TraceEdgeMediaTelemetryPort`, absent meaning unreported.

### Gates

Every touched package typechecks clean (`tsc -p tsconfig.json --noEmit`) and its
whole suite is green: evaluation-server 25 files / 193, trace-server 136 / 2,320
(the same two ClickHouse repository integration files fail to LOAD as they did
before this lane, on an import of a deleted platform test container), trace-contract
19 / 322, trace-web 231 / 1,817, annotation-contract 4 / 51, annotation-web 16 /
200, evaluator-contract 2 / 8, evaluator-web 6 / 41, data-privacy-server 8 / 128,
log-server 6 / 36, metric-server 18 / 101, authz-contract 8 / 96,
enterprise-licensing-contract 6 / 67, model-provider-contract 26 / 343,
model-provider-server 17 / 176, clickhouse-client 15 / 239. **`apps/worker` is
56 files / 423 tests, all passing** — the 8 observability-lane config failures
the previous record named are green in this tree. `git diff --numstat --
platform/app` shows zero insertions on all 280 rows.


### Operational scripts, hosted MCP and instrumentation, 2026-09-02 (bucket 5)

**`platform/app/src/tasks`, `src/mcp`, `src/runtime/task` and the OTLP metrics
push.** Nine platform modules moved, four were deleted outright, and five are
recorded below as blocked with named causes. `git diff --numstat -- platform/app`
shows zero insertions on every row.

| Platform file | New home |
| --- | --- |
| `src/tasks/clickhouseMigrate.ts` | `apps/api/src/tasks/clickhouse-migrate/clickhouse-migrate.task.ts` (+ `.entrypoint.ts`) |
| `src/server/clickhouse/goose.ts` | `apps/api/src/tasks/clickhouse-migrate/goose.migration-runner.ts` |
| `src/server/clickhouse/ttlReconciler.ts` | `apps/api/src/tasks/clickhouse-migrate/ttl.reconciler.ts` |
| `src/server/clickhouse/migrations/**` (78 files) | `apps/api/src/tasks/clickhouse-migrate/migrations/**` |
| `src/tasks/generateWebhookSignatureVectors.ts` | `packages/egress/src/webhook/signature-vectors.ts` (data) + `apps/worker/src/tasks/webhook-signature-vectors.entrypoint.ts` (writer) |
| `src/tasks/backfillStalledSimulationRuns.ts` | `apps/worker/src/tasks/backfill-stalled-simulation-runs.task.ts` |
| `src/tasks/backfillAnnotationsToClickhouse.ts` | `apps/worker/src/tasks/backfill-annotations-to-clickhouse.task.ts` (+ `prisma.annotation-backfill.adapter.ts`) |
| `src/tasks/backfillDatasetContentToS3.ts` | `apps/worker/src/tasks/backfill-dataset-content-to-object-storage.task.ts` |
| `src/mcp/handler.ts` | `packages/features/hosted-mcp/server/src/transport/api-mcp/hosted-mcp.api.ts` |
| `src/mcp/oauthClientRegistry.ts` | `.../src/repositories/redis/redis.oauth-client.repository.ts` |
| `src/mcp/governance-tools.ts` | `packages/enterprise/features/governance/server/src/transport/api-mcp/governance-tools.api.ts` |
| `src/instrumentation.node.ts` metrics block (lines 271-364, 405-465) | `packages/observability/src/node/otlp-metrics.ts` + `otlp-configuration.ts` |

Deleted, not moved: `src/tasks/cleanupOldLambdas.ts`, `src/tasks/sendSlackAlert.ts`,
`src/tasks/runTopicClustering.ts`, `src/runtime/task-nlp-lambda.lifecycle.ts`
(and its test), `scripts/dogfood/mcp-sse-multipod-probe.ts`, `vitest.mcp.config.ts`.

**The ClickHouse migration is deploy-critical and the evidence names `apps/api`,
not `apps/worker`.** The chart has no migration Job: `charts/langwatch/templates/app/deployment.yaml`
overrides no command, so the app pod runs the image `CMD`, which ran
`platform/app/scripts/start.sh` → `start:prepare:db` → `prisma:migrate`,
`clickhouse:migrate`, `lwql:provision`. The workers Deployment already overrides
`workingDir: /app/apps/worker` with `pnpm run start` and runs no migration, and
`charts/langwatch/values.yaml` ships `cronjobs.jobs: {}`. So the API image is the
migration's owner. Four invocations were repointed rather than left dangling:
`infra/docker/Dockerfile`'s `CMD` (same three steps, same order, ClickHouse now
from `/app/apps/api`), `.github/workflows/{langwatch-app-ci,e2e-ci,sdk-javascript-ci}.yml`
(`working-directory: apps/api`, `pnpm task:clickhouse-migrate`), the root
`package.json`'s new `clickhouse:migrate` proxy, and `apps/server`'s npx CLI
(`services/migrate.ts` runs it from a new `locateApiDir()`; `apps/api/` already
ships in `distribution-files.json`). The Dockerfile also gained
`--filter "@langwatch/platform-api..."` on both installs and the `apps/api` copies,
and `tsx` moved from `apps/api`'s devDependencies to its dependencies, because the
production image prunes devDependencies and the task runs from source.
`SKIP_CLICKHOUSE_MIGRATE=true` survives the move as a parsed `skipped` leaf on
the task's config, still matching exactly `"true"`.

**Judgment call: the goose runner and the SQL live in `apps/api`, not in
`@langwatch/clickhouse-client`.** The client package is the connection layer and
declares no runtime dependencies; the TTL reconciler needs
`@langwatch/data-retention-server`'s managed-table catalogue, so putting it there
would make an infrastructure package depend on a feature package. `apps/api`
already depends on both. Six migration-guard suites moved with the SQL
(`canonical-logs-migration`, `canonical-metrics-migration`, `clickhouse-migrations`,
`retention-ttl`, `ttl-reconciler`, `ttl-reconciler.regression`), repointed from
`process.cwd()` to `import.meta.dirname`. `replicatedEngineGuard.unit.test.ts` did
not move: it reads source through `~/test-utils/tsAst`, which has no owner yet.
`__dirname` became `import.meta.dirname` because `apps/api` is `"type": "module"`.
The task now reads private routes through `@langwatch/clickhouse-client`'s
`parseRoutingTable` instead of platform's `parseRouteKey`, which is a strict
superset — it also refuses two URLs for one organisation, which the moved suite
now asserts.

**The webhook signature vectors gained the drift test their own docstring had
always promised.** `packages/egress/src/webhook/signature.ts` was already a
byte-identical twin of the platform module the generator imported, so the move was
an import swap. Three suites (egress, the TypeScript SDK, the Python SDK) assert
against the committed `specs/webhooks/signature-vectors.json` and none of them tied
it back to the signer, so the generator and the fixture could diverge silently.
`packages/egress/src/webhook/__tests__/signature-vectors.unit.test.ts` compares
`serializeVectors()` to the committed bytes. Regenerating changed exactly three
provenance strings and no vector, which is the proof the move preserved the
algorithm.

**`cleanupOldLambdas` is deleted because nothing operational reached it.** No
chart, workflow, Makefile target or dev script names it; `charts/langwatch/values.yaml`
ships `cronjobs.jobs: {}` with the note that first-party sweeps run on the workers'
event-sourced path, and the one HTTP route that called it
(`/api/cron/old_lambdas_cleanup`) has no scheduler pointed at it. Deleting it also
retired `runStandaloneNlpLambdaTask` and the executor's bespoke 25-line NLP-lambda
composition — which was already broken, since it imported the deleted
`~/server/outboundProxy`. `sendSlackAlert` was a hand-run smoke harness of
hardcoded fixture data, and `runTopicClustering` an eight-line transport over a
durable Eventing command the worker already registers.

**The three backfills moved as port-driven tasks; their runners are blocked on
composed collaborators, and each blocker is named in the file.**
`backfill-stalled-simulation-runs` needs `ScenarioExecutionService.finishUnsuccessfulRun`,
which `apps/worker/src/app/worker-scenario-processing.composition.ts` rejects by
name ("Scenario failure handling is not composed in this process"), so a runner
wired today would fail every row it found. `backfill-annotations-to-clickhouse`
needs a `bulkSyncAnnotations` dispatcher off the worker's Eventing graph, and
`backfill-dataset-content-to-object-storage` needs the `DatasetStorageResolver`
that composition builds privately. All three take their collaborators as
parameters and are unit-tested with fakes, so each runner is a handful of lines
once its collaborator is reachable.

**The OTLP metrics push is a package service both processes call at boot.**
`platform/app/src/instrumentation.node.ts` was the only place OTel metrics were
exported anywhere in the repository; `apps/api` served a Prometheus registry and
`apps/worker` served a deliberately EMPTY exposition
(`worker-standalone.composition.ts`: "every metric it records goes out over OTLP")
over a MeterProvider nothing constructed — so the worker's instruments were
writing into a no-op meter. `startOtlpMetricsExport` now lives in
`packages/observability/src/node/otlp-metrics.ts` with the header-authoritative
`createAuthoritativeOtlpConfiguration` beside it, and both processes call it from
their own config leaf (`config.otlpMetrics`, folded by
`otlpMetricsExportOptionsFrom` from `@langwatch/config`'s `resolveTelemetryConfiguration`)
and hand the result to `createProcessObservability` as a shutdown flusher rather
than a signal handler. The platform block and the duplicated OTLP configuration
helper were deleted (127 lines), which leaves platform's traces half referencing a
function that is gone — the no-copies rule taken literally. `packages/observability`
gained six `@opentelemetry/*` dependencies at the versions `platform/app` pinned,
and the gated `require()` idiom became static imports because the package is ESM.

**The hosted MCP endpoint is `@langwatch/hosted-mcp-server`, not
`@langwatch/mcp-server`.** That name is taken by the published standalone server in
`mcp/typescript`, and `packages/architecture-lint` derives a feature package's name
from its directory, so `packages/features/mcp/server` would have collided in the
workspace. The two share no code: `mcp/typescript` is the tool registry (~78 tools,
all `platform_*` and friends), the moved handler is the multi-tenant HTTP/session/OAuth
transport around it, and it consumes the published package through the narrowed
`config` and `create-mcp-server` declarations. Catalogue id `hosted-mcp`, subjects
`hosted-mcp` and `mcp-oauth`.

Six platform reaches became injected ports (`ports/hosted-mcp.port.ts`):
`tryGetApp()?.redis` → `HostedMcpRedis | null`, `prisma.project.findUnique` →
`McpProjectLookupPort`, `encrypt`/`decrypt` → `McpApiKeyCipherPort` (satisfied by
`@langwatch/secret-server`'s `AesGcmSecretEncryptionAdapter`, whose at-rest format
is byte-identical to `platform/app/src/utils/encryption.ts` — verified line by
line, so no stored token changes meaning), `getClientIp` →
`HeaderMcpClientAddressAdapter` inside the package (the header priority is the rate
limit's own correctness, and the suite asserts two callers behind one proxy are
counted apart), and `getApp().governance` → `McpSessionToolRegistrarPort`. That
last one is what keeps the package core: a core feature package may not depend on
an Enterprise one, so `registerGovernanceMcpTools` moved to
`@langwatch/enterprise-governance-server` and takes an injected
`GovernanceMcpPermissionProbePort` in place of `probeOrganizationPermission`'s
faked session object.

`apps/api` mounts it as a raw Node surface, because the Streamable HTTP and
Server-Sent Events transports hold the response object for a session's life:
`ApiRawRequestSurfacePort` on `api-http.listener.ts` gets first refusal by
pathname (parsed against a fixed base, so a caller-supplied `Host` cannot route),
and `api-production.composition.ts` passes `tryCreateHostedMcpSurface(...)` through
the existing `listener` options. A process with no cipher or no database composes
no MCP rather than an endpoint whose every session fails.

**Still in `platform/app/src/tasks`, with causes.** `generateOpenAPISpec.ts` reads
eleven platform-only modules (`~/server/enterprise/scim/routes`,
`../server/api/{security,management/rbac-vocabulary,management/organization-rest,openapi-response-required,prompts-rest}`,
`../server/analytics/analytics-rest`, `../app/api/analytics-sql/**`,
`../app/api/middleware/enterprise-gate`, `../server/tracer/tracesMapping`,
`../server/routes/{evaluations-legacy,experiments-v3,misc}`); moving it before those
have owners would put a file that cannot compile into `apps/api` and turn the
typecheck red for every other lane. `provisionLwql.ts` needs
`@langwatch/analytics-server` to export nine `productionProvisioning` symbols and
two from `provisioning` — the code is in the package, the barrel exports none of
it — plus a home for `LWQL_KEY_MAP_INSERT_SETTINGS`. The object-storage migration
set (`migrateObjectStorage.ts`, `objectStorageMigration.ts`, both
`migrate-object-storage.*.adapter.ts`, `groupQueueMigrationAudit.ts`) is blocked on
`AzureBlobDriver` (601 lines) and `azure-credentials.ts` (396 lines), which exist
only under `platform/app/src/server/stored-objects/` and have no equivalent in
`@langwatch/stored-object-server` — that package models Azure as a port neither
process supplies. Splitting the set would have left a live operator tool broken
across two trees, so it stays whole. `migrateCustomModels.ts` and
`migrateModelProviderKeys.ts` need only a Prisma client and platform's `encrypt`.
`src/runtime/task/`, `scripts/run-task.sh` and `scripts/generate-task-registry.mjs`
therefore survive: they are the only way those five still run. The executor lost
its `appComposingTasks` set and the `initializeDefaultApp` branch, because none of
the five needs a composed App.

**Gates.** `apps/api` 495/495 and `apps/worker` 419/419 (both after repairing the
config-shape and `@langwatch/observability/node` mock assertions this lane's new
`otlpMetrics` leaf broke); `@langwatch/hosted-mcp-server` 47/47 — the whole moved
MCP suite, now composing the handler with real fakes instead of three `vi.mock`
calls on platform paths; `@langwatch/enterprise-governance-server` 591/591;
`packages/observability` 167/167; `packages/egress` 112/112. Every one of those six
typechecks clean with `tsc --noEmit`, except `apps/api`, whose only ten errors are
`src/app/api-gateway.composition.ts` importing four symbols
`@langwatch/gateway-server` does not currently export — a concurrent lane's
in-flight edit, in a file this lane does not touch. Stale entries pruned: nine
`platform/app/src/mcp/**` rows from `global-app-access-baseline.json` and eight
deleted task specifiers from `legacy-application-boundary-baseline.json`.

**Two dev-loop regressions worth knowing about.** `platform/app`'s
`start:prepare:db` script and its call in `scripts/start.sh` are deleted, so
`pnpm dev` from `platform/app` no longer migrates anything — run
`pnpm clickhouse:migrate` and `pnpm prisma:migrate` from the repository root
instead. And `pnpm install` has not been run for the whole workspace since the six
`@opentelemetry/*` declarations, `tsx`, `@langwatch/hosted-mcp-server` and the new
package were added; filtered installs linked what this lane needed, and `C-01` owns
the lockfile reconciliation.


## Experiments-v3 finished: the workbench model and the run loop, 2026-09-02

**The eight framework-free workbench model files MOVED into
`@langwatch/experiment-contract`**, which is what the previous lane was waiting
on. `packages/features/experiment/web/src/model/experiments-v3/` gave up
`execution/types.ts` (510), `execution/run-results.ts` (506),
`execution/build-execution-request.ts` (419), `execution-scope.ts` (212),
`normalize-comparison.ts` (195), `empty-row-detection.ts` (67),
`target-display-name.ts` (44) and `variant-disambiguation.ts` (31) — 1,984
lines — to `contract/src/workbench/`, keeping the `execution/` shape, plus the
two suites that covered them (`empty-row-detection`, `execution-scope`: 51
tests). Their `../types` and `../types/persistence` imports resolved to the
contract already (both web modules are one-line re-exports of it), so they now
name `../../experiment-workbench` and `../../experiment-workbench-persistence`
directly. `src/index.ts` re-exports all eight; no export name collided with the
219 the contract already had. Eighteen experiment-web modules repointed to
`@langwatch/experiment-contract`. **No subpath export was added to
`experiment-web`** — its exports map is what `ui-web-public-entry` counts, so
publishing the model would have raised the very count the lane is gated on.
`create-experiment-button.tsx`'s `human-readable-id.ts` travelled with them: a
run's id generator is a contract between the browser that names a run and the
server that starts one. (`prompt-web` keeps its own copy of that file, a
duplicate this lane did not touch.)

**`transposeColumnsFirstToRowsFirstWithId` moved to
`@langwatch/workflow-contract`** (`src/dataset-transposition.ts`, `nanoid`
added), and six importers across prompt-web, workflow-web and experiment-web
repointed. Only the function moved, not the whole
`workflow-web/src/model/studio-dataset.utils.ts`: the other eleven exports of
that file are equally framework-free and belong in the contract too, but
`inMemoryDatasetToNodeDataset`, `trainTestSplit`, `datasetColumnTypeToFieldType`
and friends have ~40 call sites in five packages, none of them under this lane's
gates. Recorded as the next slice rather than done badly here.

**`generateOtelTraceId` / `generateOtelSpanId` moved to
`@langwatch/trace-contract`** (`src/trace-otel-ids.ts`) out of
`trace-web/src/model/trace.ts`, which keeps `getSpanNameOrModel` and its
`./utils/trace` export. The run loop needs OTel ids on the server and a core
feature server may not import another feature's web package; restating twenty
lines of the OTel id format would have been the third copy.

**`platform/app/src/server/experiments-v3/**` moved WHOLE into
`@langwatch/experiment-server`** — the eleven remaining modules and both
suites, 8,605 lines, zero insertions in `platform/app`. The subtree is gone, and
`platform/app/src/server/workflows/` fell empty behind
`workflowEvaluation.service.ts`.

| Was | Is |
| --- | --- |
| `experiments-v3/execution/orchestrator.ts` (3,610) | `services/experiment-run-orchestrator.service.ts` |
| `experiments-v3/execution/experimentRunner.ts` (349) | `services/experiment-polling-run.service.ts` |
| `experiments-v3/execution/savedStateExecution.ts` (221) | `services/experiment-saved-state-execution.service.ts` |
| `experiments-v3/execution/dataLoader.ts` (571) | `services/experiment-execution-data.service.ts` |
| `experiments-v3/execution/runStateMirror.ts` (119) | `services/experiment-run-state-mirror.service.ts` |
| `experiments-v3/workbenchTargetNames.ts` (150) | `services/experiment-workbench-target-names.service.ts` |
| `server/workflows/workflowEvaluation.service.ts` (329) | `services/experiment-workflow-evaluation.service.ts` |
| `experiments-v3/execution/resultMapper.ts` (593) | `processes/experiment-result-mapping.process.ts` |
| `experiments-v3/execution/workflowBuilder.ts` (1,188) | `processes/experiment-cell-workflow.process.ts` |
| its two suites (1,535) | `processes/__tests__/experiment-cell-workflow.{unit,integration}.test.ts` |
| `experiments-v3/execution/runStateManager.ts` (269) | `ports/experiment-run-progress.port.ts` + `adapters/redis.experiment-run-progress.adapter.ts` |

**Nine ports, each a seam the move exposed.** `ExperimentStudioDispatchPort`
replaces `studioBackendPostEvent` **and** the `nlpLambda: NlpLambdaRuntime` and
`modelProviders: ModelProviderService` that were threaded through nine
signatures to reach it and used for nothing else — the engine's dialer, its
runtime and its parameter strip are facts of the process, not of the run.
`ExperimentModelCostPort` fronts `estimateCost` / `getMatchingLLMModelCost`,
because a deployment prices a model in its own rate table.
`ExperimentSandboxCredentialPort` folds the project's organization lookup and
`tryMintAgentSandboxApiKey` into one question, since a run mints for itself and
has no member to authorize. `ExperimentEvaluationReportingPort` replaces
`getApp().evaluations.reportEvaluation`. `ExperimentWorkflowDslPort` carries the
four Postgres reads the run makes against Workflow's own rows — the workflow, a
version's DSL, and the archived-excluding pair the evaluate trigger uses — kept
as four narrow reads so the run still distinguishes "no such workflow" from
"nothing committed to evaluate". `ExperimentTargetEntityNamesPort` replaces the
agent and evaluator `findMany` in the column-name resolver.
`ExperimentRunProgressPort` + `RedisExperimentRunProgressAdapter` replace the
`runStateManager` singleton and its `tryGetApp()?.redis`.
`ExperimentRunErrorReportingPort` replaces the PostHog capture and is optional,
because nothing downstream reads the report. `ExperimentRunAbortPort` and
`ExperimentService` already existed; `abortManager` and `getApp().experiments`
are now those.

The six of them a run needs at once are one injected bag,
`ExperimentRunPorts`, on `OrchestratorInput` — so the process that composes a
run states in one place what a run may touch, instead of nine signatures each
carrying two of them.

**Judgment calls.** `loadExecutionData`'s `services` argument became required
and moved ahead of the optional `inputs`, because a required parameter cannot
follow an optional one; it now carries `datasets`, `prompts`, `agents` and
`workflows` alongside the `evaluators` it already had, all of them contract
services, so the read path that names a workbench's columns and the run that
executes it go through the same graph rather than two. `AgentsFeature.create({
prisma })` inside the load loop is gone the same way. `WorkflowEvaluationService`
takes one named dependencies object instead of six positional arguments.
`requestAbort(runId)` is `requestAbort({ abort, runId })`.
`runStateManager.getRunState` is `tryGetRunState` (fallible-result-naming).
`@xyflow/react`'s `Node`/`Edge` in the cell-workflow builder became the
contract's own `StudioNode`/`StudioEdge`, which exist for exactly this reason —
a server package should not carry a browser graph runtime even as a type.
`WorkflowEvaluationOutcome` was restated structurally rather than imported from
`@langwatch/platform-api` (which is `apps/api`) or from
`@langwatch/workflow-server` (another feature's server).
`EvaluatorExecutionError` now comes from `@langwatch/evaluation-contract`, where
it had already moved; the platform path it named had been dangling.
`KSUID_RESOURCES.EVALUATION` is stated as `"eval"` beside its one use, the same
way `trace-server` states its own — importing a whole deployment-wide prefix
table to mint one id would make this package depend on every other feature's
prefixes.

**Behaviour recorded rather than preserved: a process with no Redis.**
`runStateManager` read `tryGetApp()?.redis` before every write and skipped
silently when there was none, so a deployment without Redis served
`GET /runs/:runId` a 404 for every run it had started. The port is required now,
so that skip is a composition choice: a process that composes no progress store
cannot mount the polling run loop at all. That is the same fact, said out loud.

**What the execution fold must compose.** `apps/api` was not touched. To mount
the run loop it needs, per process: `ExperimentRunPorts` — a
`WorkflowStudioDispatchService` (`@langwatch/workflow-server` already owns the
protocol half of `studioBackendPostEvent`) behind
`ExperimentStudioDispatchPort`; the tracer's cost catalogue behind
`ExperimentModelCostPort`; `RedisExperimentRunAbortAdapter`; the process's
`ExperimentService`; the Evaluation application's `reportEvaluation` behind
`ExperimentEvaluationReportingPort`; and the API-key service plus the project's
organization behind `ExperimentSandboxCredentialPort`. Beside them:
`RedisExperimentRunProgressAdapter`, an `ExperimentWorkflowDslPort` and an
`ExperimentTargetEntityNamesPort` over Postgres, an `ExecutionDataServices` bag
(`DatasetService`, `PromptService`, `AgentService`, `EvaluatorService`), the
public `baseUrl` for `getRunUrl`, and optionally an
`ExperimentRunErrorReportingPort`. None of that is a new environment leaf:
`LANGWATCH_NLP_SERVICE` and the base URL reach it through the services the fold
already builds.

**Gates.** experiment-contract 4 files/14 tests to 6/65, `tsc --noEmit` clean;
experiment-server 18/5,188 to 20/5,246 (5,243 passed, 3 pre-existing skips),
clean; experiment-web 629 to 578 — the 51 that left are the two suites now in
the contract, and 578 + 51 = 629 exactly; workflow-web 318, workflow-contract 80,
scenario-web 421, trace-web 1,817, trace-contract 322, prompt-web 643, all at
baseline. architecture-lint: experiment-web 208 findings to **204** (the gate is
that it must not rise; `ui-screen-closure` fell 189 to 185), experiment-contract
0, workflow-contract 0, scenario-web and `apps/ui` unchanged at 137 and 86.
experiment-server 10 to 13: three `service-quality` ceilings on the orchestrator
(3,610 lines), the data loader (571) and the workflow-evaluation trigger — the
cleanup backlog, named rather than dodged by filing a 3,610-line run loop under
`processes/`. `git diff --numstat -- platform/app` zero insertions on every row.

`apps/ui` is red at 2 files / 2 tests (`chrome-drawer.integration.test.tsx`,
`gateway-routes.unit.test.ts`) and no file under `apps/ui` was edited here; a
concurrent lane renamed `apps/ui/src/main.tsx` to `ui.entrypoint.tsx` mid-run.
The annotation and trace-contract type errors that show up in every web
package's typecheck are another lane's in-flight edit
(`annotation.record.ts` declares `AnnotationUser` twice; `trace-mapping.ts` and
`trace-list.repository.ts` are untracked). The four `TS7006` in
`workflow-web/src/ui/sections/optimization_studio/history.tsx` and
`use-component-version.tsx` predate this lane and are untouched by it.

**Nothing remains under `platform/app/src/server/experiments-v3`.** The
sixteen `global-app-access-baseline` entries the run now reports against
`runStateManager.ts`, `dataLoader.ts` and `orchestrator.ts` are stale baseline
rows for deleted files, the same residue every previous lane left; the baseline
only shrinks, and trimming it is a shared-file edit better done in one pass at
the end.

## Producer-only process managers: the API's agent-side write path, 2026-09-02

**The refusal was in the framework, not the deployment.** `apps/api` composes
Eventing producer-only and holds no `ProcessStore`, and `EventSourcing.register`
refused outright any pipeline declaring a process manager on that basis. Both
`simulation_processing` and `langy_conversation_processing` declare one, so ONE
declaration inside each definition made EVERY command on it unsendable from the
tier a customer's action actually arrives at: eight simulation commands, two
suite-run commands and sixteen Langy conversation commands all answered
`service_unavailable`, and the agent-group half's own header attributed that to
a producer variant nobody had written. The variant was never the blocker.

**The mechanism.** `EventSourcingOptions.processManagerMode` (`"run"` |
`"producer-only"`, default `"run"`) separates PRODUCING a command from RUNNING a
process manager. In producer-only mode `register` skips `requireProcessStore`,
generates none of the live subscribers that feed a process inbox, and records
each declined manager BY NAME on `EventSourcing.unrunProcessManagers` while
logging it once per pipeline at boot; `processRuntime` refuses with the same
fact rather than lazily building a runtime over a store this process was never
meant to drive. The consumer path is untouched: a `"run"`-mode registration with
no durable store still fails at boot, and that is pinned beside the new
scenarios. `ApiEventingInfrastructure` declares the mode next to
`EventStoreProducerOnly` and `consumersEnabled: false`, so the property is
structural rather than something a composition root must remember.

**Three producer variants, in the packages that own the definitions.**
`createSimulationProcessingProducerPipeline`,
`createSuiteRunProcessingProducerPipeline` and
`createLangyConversationProducerPipeline` follow
`createTraceProcessingProducerPipeline` exactly: the SAME packaged definition,
with stand-ins for every consumer-side dependency that exist so the definition
can be CONSTRUCTED and refuse by name if one is ever CALLED. No definition is
forked, so the routing triple each job carries stays identical to the one the
worker routes on. `apps/worker/src/features/job-registry.json` is unchanged and
`apps/worker` is 419/419.

**`apps/api/src/app/api-agent-pipelines.composition.ts`** registers all three on
this process's own Eventing and publishes their senders: the eight simulation
writes as `SimulationExecutionPort`, `startSuiteRun` plus the simulation
pipeline's own `queueRun` as `SuiteRunCommandsPort` (a suite run fans out into
one simulation run per case, and both tiers have always written those onto the
simulation stream), and the sixteen conversation writes as
`LangyConversationCommands`. A command the registration did not produce fails at
BOOT, named, rather than at the customer's first press. With no Eventing at all
every surface still refuses by name, and the agent-group half reports it through
its existing `run-commands` / `turn-commands` absence entries.

**Absences closed.** `UnavailableApiSimulationExecution` (all eight simulation
commands), `UnavailableApiSuiteRunCommands` (both), and
`unavailableLangyConversationCommands` (all sixteen) are deleted from
`api-trpc-collaborators.agent-group.composition.ts` and replaced by the real
dispatchers. Cancelling a run, deleting a run, starting a suite run, and
renaming, forking, archiving, importing into and titling a conversation are now
real writes on the API.

**Absences remaining, and why.** `UnavailableApiScenarioExecution` stays: it is
the run EXECUTOR and PREFETCHER, not a command — `scenarios.run` resolves its
target through workflows, prompts, agents, model providers, secrets and the
trace tree before anything is queued, and none of that is a queue registration.
Starting a Langy turn stays on the feature's own `langy_agent_unavailable`: the
turn-start service dispatches to an agent manager over HTTP and additionally
requires the turn access and handoff stores, so a process with no Langy
configuration and no Redis has neither. Both are DEPLOYMENT absences; this lane
closed the framework one. The same mode also unblocks the identity ledgers'
staged senders — `join_requests` and `sso_connections` both declare a process
manager, neither is registered on `apps/api`, and `ApiEventingIdentityAdapter`
answers `null` for an unregistered pipeline, which the join-request ledger reads
as a refusal — but those files belong to the app-layer lane and are recorded
rather than taken. Nothing else in `apps/api/src/app` shares the mechanism: the
automation scheduled-job store, the graph-alert notifier, the topic-clustering
wake read, the operator explorers and the scheduler ops repository are stores
and transports, not command dispatchers.

**One incident worth recording.** A concurrent lane's commit `1830b8d663` swept
three of this lane's in-flight files into its own commit
(`api-eventing.infrastructure.ts`, `scenario/server/src/index.ts` and the new
`simulation-processing-producer.adapter.ts`), which is the `git add -A`-while-
agents-edit hazard landing for real. Nothing was lost and nothing needed undoing,
but it is why those three files show no working-tree diff.

**Judgment calls.**
`SimulationProcessingPipelineDeps.simulationRunMetricsStore` is narrowed from
the concrete `SimulationRunMetricsStoreAdapter` to the
`AppendStore<SimulationRunMetricsProjectionRecord>` the map projection already
takes; the worker's ClickHouse adapter satisfies it unchanged, and naming the
class was what stopped a producer supplying a refusing store.
`api-agent-pipelines.composition.ts` declares its own
`ApiAgentPipelineUnavailableError` rather than importing the agent-group half's,
which would have made the two modules circular; the `code` is the same
`service_unavailable` the presentation registry is keyed by, which is the part
that reaches a customer. The simulation producer's `simulations` seat is
`SimulationClickHouseAdapter.createNull` over a refusing
`SimulationExecutionPort` rather than a hand-written 25-method refusal: the only
member the process manager's `finish` intent reaches is `finishRun`, and that
one refuses by name.

**Gates.** `packages/eventing` typechecks clean (`tsc --noEmit` and
`tsconfig.tests.json`) and is 113 files / 990 + 2 todo, from 112 / 984 + 2.
`apps/worker` is 56 files / 423, all passing, with `job-registry.json` byte
unchanged. The three feature packages whose definitions gained a producer
variant are green: `scenario-server` 60 passed / 2 skipped / 808 tests (the two
failures are `cancellation-channel` and `scenario-tab-registry`, both refusing
by name because no Redis is running), `langy-server` 52 / 483, `suite-server`
6 / 51. On `apps/api`, `tsc -p tsconfig.json` is 0 errors and
`tsc -p tsconfig.test.json` has 4, none in a file this lane touched
(`app-trpc.features.unit.test.ts` missing the concurrent gateway lane's new
`gatewayGroup` and `github` port groups, and `api-client-address.unit.test.ts`
importing a module that has not landed). The two `apps/api` suites this lane
owns are 21/21 — the agent-group integration suite gains three cases that drive
`scenarios.cancelJob` and `langy.deleteConversation` through the REAL
`/api/trpc` handler onto a fake event store's append and assert the declined
process manager by name, and `api-eventing.infrastructure.unit.test.ts` now pins
the registration rather than the refusal (its spec scenario in
`specs/server/api-process-eventing.feature` is rewritten to match). The whole
`apps/api` run settled at 62 of 68 files and 558 of 566 tests once the
concurrent lanes' installs landed; the six that fail are the two standalone
boot suites timing out on absent local infrastructure, `api-client-address`
importing a module that has not landed, the experiments and product-infra
suites missing the gateway lane's new collaborator entries, and the execution
suite's own stale count of its lane's second producer registration. None is a
file this lane touched, and both files this lane owns pass inside that run.
Read the intermediate numbers with care: across four runs an hour apart the
same suite swung between 6 and 46 failing FILES purely on other lanes'
half-installed dependencies. `git diff
--numstat -- platform/app` shows zero rows for this lane; the single
nonzero-insertion row in the shared tree is another lane's import consolidation
in `runtime/app/features/secret.ts` (1 insertion, 61 deletions).


## The router root's last twenty-two namespaces, 2026-09-02

**`platform/app/src/server/api/root.ts` is DELETED.** 532 lines, and with it the
last tRPC surface the retired application mounted. Every namespace it carried is
served by `apps/api` on that process's own root, behind that process's own
policy chain.

### Namespace to mount

| Namespaces | Mounted by |
| --- | --- |
| `secrets` | Already there: `apps/api/src/api.application.ts` mounts `SecretTrpcApi` on its own root beside `agents`. The root.ts line and `runtime/app/internal-api/secrets.router.ts` were deletions, not moves. |
| `virtualKeys`, `gatewayBudgets`, `gatewayCacheRules`, `gatewayGuardrails`, `gatewayUsage`, `gatewaySpendEvents` | `features/gateway/gateway-trpc.mount.ts`, over the `GatewayApp` this lane composes |
| `personalVirtualKeys`, `routingPolicy`, `webhookEndpoints` | `features/enterprise/enterprise-governance-trpc.mount.ts` (`EnterpriseGatewayTrpcComposition`) |
| `ingestionSources`, `ingestionTemplates`, `ingestionKey`, `departments`, `aiTools`, `activityMonitor`, `anomalyRules`, `personalSessions`, `sessionPolicy` | the same mount (`EnterpriseGovernanceTrpcComposition`) |
| `governance` | that composition's `governance` router, merged with `features/enterprise/governance-home.mount.ts` — one wire name, two owners, merged inside the group so nothing outside it can add a third |
| `subscription`, `currency` | `features/enterprise/enterprise-billing-trpc.mount.ts` |
| `github` | `features/github/github-trpc.mount.ts` |

All twenty-one gateway and governance namespaces arrive as ONE group entry —
`apps/api/src/app-trpc/app-trpc.gateway-group.ts` — for the reason the trace,
org, agent and product-infrastructure groups did: they are one graph (a virtual
key is minted by the governance console, priced by the budget ledger, delivered
on by a webhook endpoint and billed through a subscription), and one entry keeps
their ports off a file five other halves of the record also edit. `github` is
its own record entry: one namespace, two ports, and no graph shared with
anything beside it.

### What moved

| From | To |
| --- | --- |
| `server/app-layer/presets.ts` `composeGatewayApp` (~195 lines) with `gatewayVirtualKeyActor`, `membershipForProjectCredential` and `isBrowserSession` | `apps/api/src/app/api-gateway.composition.ts` |
| `server/api/routers/governance/governance.ts` (`governance.resolveHome`, 141 lines) | `apps/api/src/features/enterprise/governance-home.mount.ts` |
| `runtime/app/internal-api/github.router.ts` (54) | `apps/api/src/features/github/github-trpc.mount.ts` plus the two ports in the gateway-group composition |
| `runtime/app/internal-api/__tests__/github.access-order.unit.test.ts` (281) | the permission assertion it existed for travelled into `packages/features/github/server/src/transport/api-trpc/__tests__/github-trpc-api.unit.test.ts`, where the permissions are DECLARED; the rest of that suite was already covered there |
| `runtime/app/internal-api/secrets.router.ts` (51), `server/api/root.ts` (532) | deleted, not moved |

`composeGatewayApp` was the one composition the previous lane named as the
blocker for the gateway REST families, and it moved WHOLE rather than as ports:
every store the old `gatewayStores` bag held is opened in the new composition
off `apps/api`'s own Prisma connection and its own ClickHouse —
`VirtualKeyService`, `PrismaGatewayAdapter`, `GatewayBudgetLedgerAdapter`,
`GatewayVirtualKeySpendAdapter`, `GatewaySpendEventsService` and
`GatewayUsageService`. The `GatewayScopePermissionsPort` the move exposed is
answered by this process's own AuthZ service, with the session cascade and the
API-key ceiling kept apart exactly as the port demands.

**`createGatewayPlatformRestApp` is now mounted on `apps/api`**, over the SAME
`GatewayApp` the six tRPC namespaces read, so the SDK's door and the browser's
door cannot enforce different rules. It is routed AFTER the process-owned REST
families, because one of those owns a literal path inside `/api/gateway/v1` and
these routes claim parameterised segments at the root of that namespace.

Ten symbols the composition needs were added to `@langwatch/gateway-server`'s
index — they already existed in the package and were simply unexported
(`assertScopesBelongToOrg`, `assertTraceProjectBelongsToOrg`,
`assertGuardrailAttachmentsAllowed`, `resolveVkProjectId`, `requireExistingVk`,
`requireVisibleVk`, `isVisibleToMembership`, `loadDirectBudgetsForKeys`,
`resolveApplicableBudgetsForDraftKey`, `virtualKeyBudgetInputSchema`).
`@langwatch/enterprise-api` gained four re-exports for the same reason it
already re-exports the governance REST family: an api-role application may name
that composition and nothing enterprise below it (`GovernanceService`,
`OrganizationSessionPolicyService`, `PersonaHomeResolverService`,
`PersonaResolution`).

### Named absences

**`ApiEnterpriseApplicationPort.governance`** — the four `ctx.app` slices the
fifteen Enterprise governance and gateway-governance namespaces read
(`governance`, `governanceApp`, `sessionPolicy`, `webhooks`). It EXTENDS the
port the org-group lane added rather than adding a second, because the
deployment decision is one. It is a port rather than a composition and the
reason is a fence: `AppGovernanceRuntime.create` requires a
`GovernanceEventingPort` built from the ingestion-pull and pulled-usage COMMAND
registrations, and the event-sourcing runtime that owns them has not left the
retired application. The only in-tree alternative is that package's no-op
eventing port, which would accept every ingestion-pull command and queue none of
them — a silent drop, which is the one thing a named absence exists to prevent.
Absent, all fifteen namespaces MOUNT and every call refuses `service_unavailable`
naming the capability.

**`ApiGatewayIdempotencyPort`** — the receipt ledger the three keyed gateway REST
creates dispatch through. `withIdempotency` is
`platform/app/src/server/api/idempotency.ts`, 752 lines of claim, heartbeat and
takeover logic that four other REST families still read and another lane owns.
Copying it would give the deployment two receipt stores with two takeover
clocks. Absent, those three creates refuse by name rather than executing
unguarded — a create sent twice with one `Idempotency-Key` would otherwise mint
two virtual keys, which is the failure the key exists to prevent.

**`createGatewaySpendRestApp` is still not mounted.** `GatewaySpendRestPorts`
wants the three raw Enterprise webhook services (`webhookEndpoints`,
`webhookEvents`, `webhookDelivery`) rather than the `WebhookApp` the port above
carries, plus `assertWebhookEndpointsEntitled` for its billing gate and the REST
lane's `canonicalError` envelope. Three of those cross into another lane's
files, so the family stays off rather than being mounted over a half-filled
port bag.

**`server/routes/gateway-internal.ts` is still not moved** — 1,508 lines, and
the blockers are named: `rateSpendNanoUsd` from
`server/event-sourcing/pipelines/gateway-spend-processing/**`, `runEvaluation`
from `server/evaluations/**`, and `getApp()`. Two of those verticals have not
moved and the third is the service locator this migration exists to delete. Its
HMAC verifier for the Go data plane travels with it.

**Therefore `LW_GATEWAY_INTERNAL_SECRET` and `LW_GATEWAY_JWT_SECRET` were still
NOT added to `api.config.ts`.** Nothing on `apps/api` reads either yet, and a
config leaf nothing reads is a wiring bug that reads as done. `LW_VIRTUAL_KEY_PEPPER`
WAS added, because its reader — `VirtualKeyCryptoAdapter`, inside the gateway
composition — is composed in this same change. It follows the file's stated
convention for credentials (`Config.value(optionalEnvironmentString, …)` rather
than `Config.secret`, which refuses a whole boot over a blank export); what a
blank pepper means is the cipher's own rule and it raises `pepper_missing` at the
first hash rather than at boot.

**`personalDashboard` is not forwarded.** The governance composition builds
fourteen routers and the mount forwards thirteen: `personalDashboard` answers on
`user.personalUsage`, `user.budgetOverview` and `user.cliBootstrap`, and `user.*`
is the identity half's. Merging a second owner into that namespace from here
would put two mounts on one wire name.

### Judgment calls

- **`subscription` and `currency` mount directly from
  `@langwatch/enterprise-billing-server`** rather than through
  `EnterpriseTrpcComposition`, which the org-group's Enterprise mount already
  builds and deliberately drops them from. A second call to that composition
  would build four unused routers; `apps/api` already depends on the billing
  server package (`api-usage.composition.ts`), so the SaaS gate is restated once
  in `enterprise-billing-trpc.mount.ts` — the same construction, in the one
  place that serves the two names. The org-group mount's docblock was corrected
  to say where they went; nothing else in that lane's files changed except the
  port extension above.
- **`saasBilling` is read from `config.infrastructure.modelProvider.isSaas`.**
  That leaf already carries `IS_SAAS`, which is the variable the platform
  application's `env.IS_SAAS` read. One variable, one meaning, rather than a
  second leaf that could be exported differently.
- **`resolveHome`'s Enterprise test comes from the plan provider**, not from
  `UsageStatsService.getUsageStats(...).activePlan.type`. It is the same
  question — is this organization's active plan the Enterprise one — asked of
  the one provider every allowance banner on this process already reads, rather
  than a second licence-enforcement service that would be a second answer.
- **All six of `resolveHome`'s other signals became ports.** The platform
  version read four of them straight off a service locator (`ctx.prisma`, an
  imperative permission probe, the flag store, the organization service), and a
  mount that reaches for a connection cannot be composed twice. Only the setup
  rollup stays on `ctx.app.governance`, because that is the slice the five
  packaged `governance.*` procedures beside it read.
- **`isBrowserSession` narrowed.** It asserted a whole NextAuth `Session`
  including its `expires` string; `VirtualKeySessionActor` is
  `{ user: { id: string } } | null` and the extra member was never read. The new
  `sessionActor` reads the one member the authorization vocabulary uses. A value
  that fails is a null session, and every gateway check refuses one — so this
  cannot widen an authorization.
- **`secrets` keeps `apps/api`'s existing mount**, which passes no declared
  policy and falls back to the feature's own `ctx.authorize`. The platform
  router passed the full chain, so `secrets.create` and `secrets.update` no
  longer run `auditLogMutations` and its `REDACTED_SCALAR_FIELDS_BY_ACTION`
  redaction. That is `api.application.ts`'s standing decision — it mounts the
  secret router before the policy chain exists, so a process with no features
  port still serves secrets — and this lane did not change it. **Recorded as a
  coverage loss on the secret audit trail**, to be closed by whichever lane moves
  the secret family onto the feature record.
- **`ApiTrpcCollaborators` grew two entries and `ApiTrpcFeatureApplication` six
  slices**, all six added to the seal's required lists, so a deployment that
  composes the gateway group and forgets one reads a named gap rather than
  mounting twenty-two namespaces over it.

### Gates

`apps/api`: `tsc -p tsconfig.json` and `tsc -p tsconfig.test.json` both ZERO
errors. The new suite —
`api-trpc-collaborators.gateway-group.integration.test.ts`, 13 tests over the
real `/api/trpc` handler: a guardrail read all the way down to a `findMany`, the
membership-based virtual-key visibility, the budget list, the landing decision
with and without the governance capability, the GitHub connection status, the
governance refusals and both billing shapes — green. The record-membership
assertion in `api-trpc-collaborators.product.integration.test.ts` and the
namespace list in `app-trpc.features.unit.test.ts` both moved 69 to 91; the
seven sibling collaborator suites gained the two new stub entries, and
`app-trpc.features.unit.test.ts` composes with `saasBilling: true` so its
"no namespace without procedures" assertion still means something. Those five
plus `api-trpc-features.composition.integration.test.ts` run 42/42 green
together. `packages/features/github/server` 15 files/126 tests green,
`@langwatch/gateway-server` 36/274 green, the governance server 65/591 green.

The wider `apps/api` run is red on concurrent lanes' in-flight work and moves
between runs — `@langwatch/identity-server/better-auth` and
`zod-validation-error` unresolvable mid-install, `src/app/getClientIp` imported
before it exists, and the execution half's producer-registration count — none of
it in a file this lane touched, and every file this lane owns passes when the
workspace is momentarily consistent. `git diff --numstat -- platform/app` shows
zero insertions on all 194 rows.


## Product REST wave 3b: the analytics, prompt, organization and export doors, 2026-09-02

Five route families left `platform/app/src/server/api-router.ts` for
`apps/api`'s own `createApiProcessRestFeatures`, and every one of them is served
over a service the process had ALREADY composed for its tRPC half rather than
over a second copy built at the mount. That is the whole shape of this slice:
the packaged families existed, the platform "compositions" were forty-line
files binding them to a global application container, and what moved is the
binding.

### Family → mount

| Family | Routes | Mount | Service it binds to |
| --- | --- | --- | --- |
| `POST /api/analytics/timeseries` | 1 | `features/analytics/analytics-rest.mount.ts` | the analytics half's `AnalyticsApp` |
| `/api/v1/projects/:projectId/analytics/*` (governed SQL + saved charts) | 9 | `features/analytics/langwatch-ql-rest.mount.ts` | the analytics half's `LangWatchQLService` and `DashboardApp` |
| `/api/prompts/*` | 13 | `features/prompt/prompt-rest.mount.ts` | the product-group half's `PromptApp` |
| `/api/organization/*` | 10 | `features/organization/organization-rest.mount.ts` | the identity half's merged organization object |
| `POST /api/export/scenario-runs/download` | 1 | `features/export/scenario-run-export-rest.mount.ts` | the agent half's `SimulationService` + the identity half's broadcast fabric |
| `GET|HEAD /api/health` | 2 | — | already `ApiProcessLifecycleRoutes`; the platform twin was deleted |
| `/api/v1/secret`, `/api/v1/secrets`, `/api/secret` | 15 | — | already `ApiSecretRestFeature`; the platform twin was deleted |

### What moved

- `platform/app/src/app/api/analytics-sql/[[...route]]/**` (4 modules, 916
  lines) → `@langwatch/analytics-server`'s
  `transport/api-rest/{langwatch-ql.api,langwatch-ql-query.api,saved-workbench-chart.api,langwatch-ql-route-guards}.ts`.
  The family is one Hono app because both halves sit behind one experimental
  switch and one project guard; the DASHBOARD half arrives as
  `SavedWorkbenchChartRestService`, a port typed against
  `@langwatch/dashboard-contract`, because a feature server package may not
  reach into another feature's server package.
- `platform/app/src/server/api/ports/organization-settings.effects.ts` and its
  suite → `apps/api/src/features/organization/`. It crosses two features
  (every project in the organization, and every share link on it) and the
  organization feature owns neither, so it is the process's.
- `platform/app/src/server/{analytics/analytics-rest,api/management/organization-rest,api/prompts-rest,routes/health,export/scenario-runs/scenario-run-export-rest}.ts`
  DELETED — each was a binding, and the binding is now in `apps/api`.
  `runtime/app/features/secret.ts` lost its REST half (`buildSecretRestApp` and
  the three-base app) for the same reason; `AppSecretRuntime` stays because
  `presets.ts` still constructs it.
- `platform/app/src/server/api/ports/{lwqlCaller,workbenchAccessMiddleware}.ts`
  deleted: the move took their last consumer.
- `apps/api` gained three shared modules the families dispatch through:
  `app/api-rest-ports.ts` (the organization middleware, the platform-URL
  builder, the unique-constraint decoder and the REST absence error) and
  `app/api-handler-managed-session.ts` — the SESSION sibling of
  `ApiHandlerManagedCredentials`, resolving through the same Better Auth
  transport and the same `AuthService` the tRPC boundary authenticates on, and
  checking permissions through the same `AuthzService`.

Three collaborator sets grew, each to publish something a REST door needs and
the tRPC ports did not expose: the analytics half publishes `langWatchQL`,
`featureFlags` and an `apiKeyProtections` resolver; the identity half publishes
`organizationRest` (the merged canonical + membership object `OrganizationApp`
already reads, with `listMembers`/`getMember` added to the routed set) and the
`BroadcastService` it composed; the agent half publishes `simulations`.

### Named absences

- **The organization INVITATION half** — `listInvites`, `createInvites` and
  `revokeInvite` refuse `service_unavailable` naming the capability. The
  1,660-line `InviteService` reaches the licence-enforcement repository, the
  plan provider, the mailer and the role service, four verticals that have not
  moved. An empty invitation list would tell an administrator nobody had been
  invited, which is the one answer they act on by inviting the same person
  twice. The other seven routes answer for real.
- **The bulk run export is mounted only where a browser-session transport is
  composed.** A bulk export lifts a project's whole run history and is
  attributable to a person by design; a process that cannot name one leaves the
  family off rather than mounting a door that refuses every caller.
- **The prompt nurturing trail LOGS instead of firing.** It is a marketing
  signal and this process composes no product-analytics sink; refusing would
  cost somebody the prompt they just wrote — the same call the tRPC half made.
- **The analytics timeseries wire no longer enum-narrows `metric` and
  `groupBy`.** The registry that enumerated them carries colour sets and number
  formatters and stayed in `@langwatch/analytics-web`; the narrowing is now the
  metric translator's own refusal, which is where the meaning is. Same
  judgment the charted tRPC reads already record.

### Judgment calls recorded

- `rethrowSeatLimit` matches the handled CODE `resource_limit_exceeded` rather
  than the licence layer's `LimitExceededError` class: that class lives in a
  tree this migration only deletes from, and a code comparison is what the repo
  asks for anywhere an error may have crossed a serialisation boundary.
- The saved-chart route's definition ceiling STATES `262_144` (the Vega-Lite
  policy's own `maxSpecBytes`) and measures UTF-8 bytes locally, rather than
  importing `LWQL_VEGA_LIMITS`/`measureSpecBytes` from `@langwatch/analytics-web`.
  What the route enforces is an envelope size, not a meaning — the policy still
  runs behind the composed Dashboard service — and no server module may
  value-import a browser package.
- The export id's ksuid prefix (`"export"`) is STATED in the mount, for the same
  reason the two scenario prefixes are: the resource catalogue that names it is
  a browser module, and the prefix is a persisted wire constant rather than a
  decision.
- An API KEY's content protections are resolved as `canSeeCosts: true` plus the
  project's data-privacy policy read for a caller with no session
  (`isContentVisibleToPublic`), which is what `getProtectionsForProject` did.
  Fail-closed on a resolution failure.
- The analytics REST body is built from the analytics package's own
  `timeseriesInputSchema`, not restated: a constraint added to the filter half
  reaches the charted reads, this body and the traces filter input together.
- `platformUrl` degrades to a path-only link when `BASE_HOST` is unset rather
  than refusing, which is what the builder it replaces did: a response whose
  payload is already correct must not fail for want of an absolute convenience
  link.

### Not moved this slice, and why

`routes/{traces,traces-legacy,collector,workflows,experiments-v3,scenario-generate,dataset-generate,playground,elevenlabs,health-checks,cron,misc,ops,sse,evaluations-legacy}.ts`
and `app/api/{traces,dataset,copilotkit,agent-cache,agents,simulation-runs,scenario-events,files,gateway-spend,middleware,shared,prompts,secrets,experiments,workflows}`
stay mounted from platform. Each is a vertical rather than a binding: the
traces family alone reaches `createTraceViewReadPorts`, the projection
compiler, the evaluation enricher and the trace formatters; `misc.ts` is 1,847
lines across five unrelated verticals; `ops.ts` stays put by the ruling already
recorded above. The session port this slice added is what unblocks
`playground`, `dataset-generate` and `scenario-generate` next, and the
`ApiHandlerManagedSession` shape is the seam to build them on.

### Gates

`apps/api`: `tsc -p tsconfig.json` and `tsc -p tsconfig.test.json` ZERO errors
in this lane's files. Six remain in the tree and every one belongs to the
concurrent REST wave-3a lane's in-flight work:
`packages/features/auth/server/src/transport/api-rest/auth.api.ts` (2, its
`@langwatch/identity-server/better-auth` subpath is not published yet) and, in
the test project, `src/app-trpc/__tests__/app-trpc.features.unit.test.ts` (3,
its namespace list) and `src/app/__tests__/api-client-address.unit.test.ts` (1,
a moved module). The same unresolved auth subpath is why 17 of `apps/api`'s 67
suite files fail to LOAD in a whole-suite run while 354 tests pass and none
fail on an assertion.

`packages/features/analytics/server` 28 files / 654 tests green;
`scenario/server` 808 passing (the two Redis-dependent files fail without a
Redis, as recorded); `organization/server` 180; `prompt/server` 197. New suites,
all green (4 files / 16 tests):
`app-rest/__tests__/api-rest.product-families.integration.test.ts` (8 tests —
the timeseries golden path with the project taken from the credential and the
ISO date coerced, the schema refusal, the family absent without an application,
the prompt listing with the resolved organization, the organization-resolution
failure, the settings read, the invitation refusal and the plan gate refusing
before anything is read), `features/analytics/__tests__/langwatch-ql-rest.integration.test.ts`
(4 tests — the statement running as the credential's project with the tenant
key read server-side, the path-vs-credential refusal proving the flag is never
consulted, the rollout refusal by the feature's own code, and the saved-chart
listing) and `features/export/__tests__/scenario-run-export-rest.integration.test.ts`
(3 tests — the audit row written before a byte is streamed, and the signed-out
and unpermitted refusals told apart with the store never reached).
`git diff --numstat -- platform/app` shows zero insertions on every row.

`api-router.ts` stands at 297 lines. Eighteen of the fall are this lane's:
six import lines and six `api.route` lines for the analytics, governed-SQL,
organization, prompts, secret and health families, the four-line comment on
the organization mount that is gone, and the export pair. The rest are the
concurrent REST wave-3a lane's, removed from the same file in the same
working tree.


## The experiment run loop composed on `apps/api`, 2026-09-02

**`apps/api/src/app/api-experiment-run.composition.ts` fills the bag the
previous lane left open.** `ExperimentRunPorts` is what
`@langwatch/experiment-server` states a run may touch; this is where the six
members come from, and none of them is built twice:

| Port | Composed from |
| --- | --- |
| `studio` | `WorkflowStudioDispatchService` over `LANGWATCH_NLP_SERVICE` and this process's model gateway |
| `cost` | `ModelProviderService.estimateCost`, with the project's own `listCosts` rules matched by `matchModelCost` and passed as the per-token override attributes — the trace-ingest cascade, not the static table alone |
| `abort` | `RedisExperimentRunAbortAdapter` on the queue's Redis |
| `experiments` | the execution half's own `ExperimentService` |
| `evaluationReporting` | the execution half's own `reportEvaluation` sender |
| `sandboxCredentials` | `tryMintAgentSandboxApiKey` over the process's `ApiKeyService` plus the project's organization |

Beside them: `RedisExperimentRunProgressAdapter` on the same connection, a
`PostgresExperimentWorkflowDslAdapter` (the four narrow workflow/version reads,
including the archived-excluding and latest-commit-else-latest-autosave
selections the evaluate trigger makes), a
`PostgresExperimentTargetEntityNamesAdapter` (two batched `findMany`s), the
`ExecutionDataServices` bag taken from the execution fold rather than rebuilt,
and `BASE_HOST` for `getRunUrl`.

The composition lives INSIDE `composeApiExecutionCollaborators` and is
published as `ApiExecutionCollaborators.experimentRun`, because every
collaborator except a Redis connection and the API-key service was already in
that scope. `api-production.composition.ts` now passes `composeExecution` the
resolved tenancy and the queue infrastructure for exactly those two. The
surfaces that START a run are REST routes rather than tRPC procedures — the
`experiments.*` namespace has no run procedure and never had one — so wave 3b
takes `experimentRun` and mounts `POST /api/experiments/execute`,
`POST /api/experiments/{slug}/run`, `GET /api/experiments/runs/{runId}`,
`POST /api/experiments/abort` and `POST /api/workflows/{id}/evaluate` on it.

**The absence that had to close first: `experiment_run_processing`.** The
`PostgresExperimentAdapter` was composed without `execution`, and the comment
called that "a process with no run loop". It is not a soft absence: the
orchestrator RETHROWS a failed `startExperimentRun` — a run whose first event
never reached the log would leave a history with a hole at the front — so with
the packaged `UnavailableExperimentExecutionAdapter` in place every polling run
dies on its first cell. `composeApiExperimentRunCommands` registers the SAME
packaged definition the worker drains as a PRODUCER, with two stand-in stores
that refuse by name if a fold or an append is ever asked of this process, and
hands back the four dispatchers. This is
`createEvaluationProcessingProducerPipeline`'s shape built at the composition
root rather than in the package, because `@langwatch/experiment-server`
publishes no producer variant of its own and adding one would have put untested
source into a package this lane is gated to leave alone. **The package is the
right home for it; moving it there is the next slice.**

**Absences closed.** The run's dispatch (was `studioBackendPostEvent` on a
process singleton), its price table, its abort flag, its progress store, its
sandbox credential, its workflow-DSL reads, its column-name reads, and its run
history. **Absences left, each by name.**
`ExperimentRunErrorReportingPort` is not composed: the retired application sent
these to product analytics, nothing downstream reads them, and a null object
would read as wired. `updates` on the experiment adapter stays absent, so a
workbench cell lands on the next read rather than as it happens.
`EVAL_V3_CONCURRENCY` is still unread on this process — the default is stated
as `API_EXPERIMENT_RUN_DEFAULT_CONCURRENCY = 10`, the same number every
deployment that never set the variable already runs at, and binding the leaf
would have changed the `api.config.ts` shape a concurrent lane is editing.

**Two composition decisions worth the words.** A process with **no Redis** has
no run loop: `ports` and `progress` are `null` and `startRun` /
`evaluateWorkflow` reject with `ApiExperimentRunUnavailableError`
(`service_unavailable`, 503, `fault: "platform"`, `meta.capability` naming the
progress store). That is the ledger's own note said out loud — the retired
application skipped every progress write when there was no connection and then
served `GET /runs/:runId` a 404 for every run it had started. **No public base
URL** refuses the same way for its own reason, because a run answers with a
shareable results link and a link built on no origin is not one.
`LoggedApiExperimentRunAbsence` names both at boot rather than leaving a
deployment to discover it on the first press of Run. The dispatch service is
built here rather than taken from `api-studio-host.composition.ts`: it holds no
connection, it strips parameters through the SAME gateway, and the trace group
that builds the other one composes after the execution half that builds this.

**One behaviour recorded rather than changed.** The engine sees
`X-LangWatch-Origin: workflow` for a workbench cell, because the run sets
`origin: "evaluation"` in the EVENT and leaves the dispatch option unset —
which is what the retired application sent too. The
`ExperimentStudioDispatchPort` carries the option so the loop can change its
mind; this lane did not change it on the way past.

**Gates.** `apps/api` 566/566 tests passing across 67 of 68 files; the one
failing FILE is `src/app/__tests__/api-client-address.unit.test.ts`, which
imports `../getClientIp` — a module the app-layer-residue lane renamed to
`api-client-address.ts` mid-run — and no file this lane touched is in it.
`tsc --noEmit` on `tsconfig.json` is at ZERO errors; `tsconfig.test.json` has
four, three in `app-trpc.features.unit.test.ts` and the fourth the same
`getClientIp` import, all another lane's in-flight work.
`@langwatch/experiment-server` 20 files / 5,246 tests (5,243 passed, 3
pre-existing skips), unchanged: nothing in that package was edited.
`git diff --numstat -- platform/app` shows zero insertions on every row.

`api-experiment-run.composition.integration.test.ts` drives a real run: the
orchestrator, the polling runner, the cell-workflow builder, the studio
dispatch and its server-sent-event framing, the Redis progress adapter, the
Experiment service and the producer registration are all the real ones, and the
doubles are the database, the model gateway, the queue and the engine — the
engine at `fetch`, one layer OUTSIDE the port, so the dispatch adapter, the
parameter strip and the frame decoder run for real. It asserts the cell reached
`http://127.0.0.1:5561/go/studio/execute` carrying the prepared workflow (the
project's own API key on it, which is what `prepareStudioEvent` is in the path
for), that the progress store went from `createRun` to `completed`, that
`startExperimentRun` and `completeExperimentRun` landed on the producer
registration, and that with no Redis every namespace still mounts while
`startRun` refuses by name.

The `toHaveLength(1)` on
`api-trpc-collaborators.execution.integration.test.ts`'s eventing recorder is
now a lookup by name: this half registers two producer pipelines, not one.

## Progress accounting

Only committed deletions count. After each migration commit, record the hash in
the active table, remove the completed item, name any residual and refresh:

```sh
git ls-tree -r --name-only HEAD platform/app | wc -l
git ls-tree -r --name-only HEAD platform/app/src | wc -l
rg -n "\b(getApp|tryGetApp|initializeApp|resetApp)\b" platform/app packages apps
rg -n "process\.env" packages apps
rg -n "platform/app|@langwatch/web" apps packages infra .github package.json pnpm-workspace.yaml
```

The end state is zero old application files, not a lower forecast.

## REST wave 3a: auth, Langy, GitHub, SCIM, bug reports and the tRPC transport, 2026-09-02

**Eleven mounts left `platform/app/src/server/api-router.ts` (342 → 297 lines)
and fifteen platform modules were deleted.** Every one of them moved into the
package that owns it, keeping its shape; the API process mounts seven of the
families for real and names why it does not mount the other three.

### Route family → mount

| Family | Moved to | Mounted in `apps/api` |
| --- | --- | --- |
| `POST /api/bug-reports` | `@langwatch/ops-server` `transport/api-rest/bug-report.api.ts` | **yes** — over this process's Prisma, its one rate limiter and a silent notifier |
| `POST\|ALL /api/unsubscribe` | `@langwatch/automation-server` `transport/api-rest/unsubscribe.api.ts` | **yes** — over the org group's `AutomationApp` |
| `POST /api/langy/conversations{,/:id/messages}` | `@langwatch/langy-server` `transport/api-rest/langy-turns.api.ts` | **yes** — over the agent group's own `LangyApp` |
| `POST\|GET /api/langy/ui/actions` | `.../langy-ui-actions.api.ts` | **yes, with Redis** — over an EMPTY page-action catalogue |
| `POST /api/internal/langy/{turn/:id/result,credentials/revoke}` | `.../langy-internal.api.ts` | **yes** — `LANGY_INTERNAL_SECRET` is now an `api.config` value |
| `POST /api/internal/langy/relay/frames` | `.../langy-relay.api.ts` | **yes, with Redis** |
| `GET /api/github/{install,setup}`, `POST /api/github/webhook`, + the two `github-langy` aliases | `@langwatch/github-server` `transport/api-rest/github.api.ts` | **yes, where a host supplied the Better Auth transport** |
| `/api/auth/{validate,session,logout}` + the `/auth/*` catch-all | `@langwatch/auth-server` `transport/api-rest/auth.api.ts` | no — named absence |
| `/api/scim/v2/*` (15 routes) | `@langwatch/enterprise-scim-server` `transport/api-rest/scim-protocol.api.ts` | no — named absence |
| `POST /api/webhooks/auth0-scim` | `.../scim-webhook-intake.api.ts` | no — same absence |
| `GET\|POST /api/trpc/*` | **deleted** | n/a — `apps/api` has served its own `/api/trpc` since `0fc9e4120d` |

### What moved, beyond the transports

- **`submitBugReport` did NOT move — `@langwatch/ops-server` already held the
  frozen twin.** The platform route was importing
  `~/server/app-layer/bug-reports/bug-report.service`, a path that no longer
  exists, against a signature that had already changed (the repository, the
  limiter and the notifier are parameters now). So this is the webhooks
  precedent: delete the platform copy, mount the twin. The route's only new
  seam is `BugReportRestCredentialReader` — reading a project credential off a
  request is the deployment's published precedence (Basic, then Bearer, then
  `X-Auth-Token`), and a second reading inside the family is how the two drift.
- **Three Langy runtime adapters moved into `langy-server` as services**:
  `langy-access.adapter` → `services/langy-access.service.ts`,
  `langy-api-key-identity.adapter` → `services/langy-key-identity.service.ts`,
  `langy-api-key-actor-session.adapter` → `services/langy-actor-session.service.ts`,
  with their three unit suites. `langy-turn-settlement.adapter` was DELETED
  rather than moved: it was a one-line pass-through to `awaitTurnSettlement`,
  which the transport now calls directly.
- **`LANGY_RELEASE_FLAG` is declared in `langy-server`, not imported.** Its only
  other holder is `useShowLangy`, a browser module a server package may not
  reach. The flag registry is what pins the two to one key.
- **The credential chain both public Langy doors share is ONE module**
  (`langy-rest.credentials.ts`), because the ORDER of its refusals is the
  contract: credential (401) → dark 404 → ceiling (403) → identity. Two copies
  would drift into two different leaks, and the leak this order prevents is a
  dark surface answering 403 to a key that lacks a permission — a refusal no
  unmounted route can produce.
- **`ApiHandlerManagedCredentials` grew `enforceCeiling`.** The Langy doors
  cannot use `authenticate`: they must read the resolved key's PROJECT before
  they know whether the surface is open for it, and the UI-action door only
  learns which permission to check once the dispatched action names one. The
  new method is the same AuthZ read and the same two refusals as the combined
  form — it throws instead of answering, because its callers sit inside a
  canonical-envelope family whose error boundary renders a handled error.
- **`api.config.ts` reads `LANGY_INTERNAL_SECRET`**, unvalidated and optional
  for the reason every credential beside it is: blank means unconfigured, and
  the internal family answers 503 `Not configured` rather than falling open.
- **`apiClientAddress` is new, not a copy.** The unsubscribe door counts a
  caller by a HEADER-PRIORITY list (`cf-connecting-ip` first, then the
  forwarded chain) with the raw socket address as the fallback — a different
  rule from the nearest-hop reading the bug-report and RUM doors use, and one
  that needs the Node server's own connection info. The platform module that
  held it (`utils/getClientIp.ts`) is shaped for `NextApiRequest` and belongs to
  another lane; `apps/api/src/app/api-client-address.ts` is the process's own
  adapter over `Headers` + `getConnInfo`.
- **The SCIM protocol family takes `ScimService`, not `ScimApp`.** `ScimApp` is
  the token-management surface; the fifteen protocol routes read the service
  under it, which is what `c.app.scim` always was.

### Named absences

- **`/api/auth/*` is moved but NOT mounted.** `API_UNAVAILABLE_PRODUCT_ADAPTERS`
  still names the deployment's Better Auth transport, and this family IS that
  transport's door: the catch-all forwards to `betterAuth.handler`, and logout
  reads `betterAuth.api.getSession`. Composing an instance here to fill the gap
  is exactly the thing `ApiAuthComposition`'s docblock refuses — a second
  instance built from a different option set verifies nothing and answers
  `null`, which every caller reads as "signed out". The family's ports are
  declared and its behaviour is package-owned; supplying a value for
  `betterAuth` is the whole of what is left.
- **`/api/scim/v2/*` and `/api/webhooks/auth0-scim` are moved but NOT mounted.**
  `apps/api` refuses the Enterprise SCIM application by name
  (`api-trpc-collaborators.org-group.composition.ts`: "Enterprise SCIM
  application, so it can neither list nor mint a token"). Fifteen protocol
  routes over a refusing service would answer 500 to an identity provider's
  provisioning run, which is worse than the 404 it gets now.
- **The Langy page-action catalogue is EMPTY on this process.** The only
  catalogue that exists is the experiments workbench's, and it is a browser
  module. `GET /api/langy/ui/actions` therefore answers `{actions: []}` and a
  dispatch refuses with `langy_ui_action_unknown`. Both are true of this
  process: no page on it can run one. The port the door takes
  (`LangyUiActionRestCatalogPort`) is one method wider than the service's —
  the door enumerates, the service only ever resolves a named kind.
- **The Langy UI-action and relay doors are absent without Redis.** The channel
  IS a claim key, a result list and a blocking pop; the relay IS a stream plus
  a dedup set. Mounting either without Redis would accept a dispatch nothing
  can deliver and a frame nothing can read back — neither detectable by the
  caller. The TURN door has no such dependency (`Prefer: wait` degrades to fold
  reads) and mounts either way.
- **The GitHub pull-request backfill is not supplied.** It lives on the
  coding-agent SERVICE and this process composes only the application above it.
  Its effect is a cache of what GitHub already knows and the periodic branch
  recheck rebuilds the same mapping, so the port is optional rather than a
  stand-in that throws: the linkage arrives later, not never.
- **`/api/github/*` is absent without a browser session.** `/install` and
  `/setup` are both bound to the session that started the flow, and `/webhook`
  alone is not a family — GitHub only delivers to it for an installation
  `/setup` recorded.

### Judgment calls

- **`/api/unsubscribe` went to `@langwatch/automation-server`, not to the
  Enterprise governance server the brief named.** It calls
  `automation.confirmUnsubscribe`, automation-server already owns the tRPC twin
  of that operation (`email-suppression.api.ts`), and nothing on the route is
  governance's. Putting it behind a governance package would have made a
  self-hosted install's unsubscribe link an Enterprise surface.
- **`routes/auth-cli.ts` (2,875 lines, 21 routes) was NOT moved.** It is an
  Enterprise GOVERNANCE family wearing an auth path: eighteen of its routes are
  `/api/auth/cli/governance/*`, the personal virtual key, the budget overview
  and the ingestion-key mint, and it reads `GovernanceService`,
  `OrganizationApp`, `assertEnterprisePlan`, `probeOrganizationPermission`,
  `resolveSupportContact` and `env` directly. Moving it into `auth-server`
  would put Enterprise governance behind an auth package's door, and moving it
  into `enterprise-governance-server` is that package's lane, not this one. It
  is unmountable either way — `apps/api` composes no governance — so the cost
  of leaving it is one platform module, not a served route.
- **`routes/ingest/**` (968 lines) was NOT moved, for the same reason plus
  one.** It is the Activity Monitor's governance receiver, and two of its
  imports are ALREADY broken on this branch:
  `./ingest-key-provenance.utils` no longer exists, and
  `~/server/otel/parseOtlpBody` was superseded by `@langwatch/otlp`. Moving it
  would mean repairing another lane's half-finished demolition inside a package
  whose tsc gate someone else owns.
- **`createAppRestFeatures` is NOT being broken up.** Read in full: it is one
  enumeration over thirty-two product services and ~25 ports, all-or-nothing.
  `apps/api` already has the answer the plan recorded — a SECOND list
  (`createApiProcessRestFeatures`) that families join one at a time as their
  service lands on this process. Six have joined so far. Splitting the packaged
  list would mount thirty-two families over services this process does not hold.

### Coverage

Four integration suites drive the real Hono apps over fakes at every port, and
each pins the refusal ORDER rather than only the golden path:

- `apps/api/src/features/bug-report/__tests__/bug-report-rest.integration.test.ts`
  (5) — 201 with the stored id, the unlinked write a credential-less report
  makes, both 400s, the handled 429, and the nearest-hop rate-limit bucket.
- `apps/api/src/features/automation/__tests__/unsubscribe-rest.integration.test.ts`
  (5) — 200 on a spent token, 400 on a missing one, the 400/500 split that
  keeps a database blip from reading as a dead link, the 429, and the 405 with
  `Allow: POST` that the second registration produces.
- `apps/api/src/features/langy/__tests__/langy-rest.integration.test.ts` (13) —
  202 with `markUsed`, the dark surface answering Hono's own plain-text
  `404 Not Found` with no ceiling check, the 401 before any project is read,
  the ceiling refusal, the unknown-kind refusal BEFORE the ceiling, the empty
  catalogue, 503 on an unconfigured internal secret, 401 on a wrong bearer,
  404 on an unknown turn triple, 202 on a known one, the relay's 503 with no
  live buffer, and both composition gaps.
- `apps/api/src/features/github/__tests__/github-rest.integration.test.ts` (12)
  — non-member refused before the permission probe, member without
  `organization:manage` refused after it, 401 with no session, 503 with no App,
  the signed state carrying user and org, the mid-flow session change in both
  popup and redirect modes, 404 on an unconfigured webhook secret, 401 on a bad
  signature, the applied installation event, and the `github-langy` alias.

### Gates

- `apps/api` `tsc --noEmit`: **0 errors**. `tsc --noEmit -p tsconfig.test.json`:
  5 errors in three files, none of them this lane's —
  `app-trpc/__tests__/app-trpc.features.unit.test.ts` (its `TestContext` names
  no `github` on `ctx.app`, which the gateway-group lane's tRPC mount added),
  `app/__tests__/api-client-address.unit.test.ts` (a test committed against
  `src/app/getClientIp.ts`, a module the utils lane has not landed yet) and
  `features/export/__tests__/scenario-run-export-rest.integration.test.ts`
  (REST wave 3b's).
- `apps/api` vitest: **35 new tests across four files, all green**, and the
  whole suite went from 20 failed files / 120 failed tests before this lane to
  **6 failed files / 7 failed tests** (68 files, 566 tests) after it. Sixteen of
  the twenty baseline failures now pass (other lanes' fixes landing
  underneath), and exactly two files fail that did not before — both UNTRACKED
  files belonging to other lanes: `app/__tests__/api-client-address.unit.test.ts`
  (a test for a module the utils lane has not landed) and
  `app/__tests__/api-experiment-run.composition.integration.test.ts` (a 10s
  timeout under two concurrent whole-suite runs, not an assertion). The other
  four — the analytics, execution, gateway-group and product collaborator
  suites — were red at baseline and are red for the same reasons.
- Package suites, all green: `@langwatch/ops-server` 306, `@langwatch/automation-server`
  225, `@langwatch/github-server` 126, `@langwatch/auth-server` 57,
  `@langwatch/enterprise-scim-server` 80. `@langwatch/langy-server` is 482/483 —
  the one failure, `langy-outbox-lease-fencing`, is a pre-existing `vi.waitFor`
  race this lane does not touch.
- `tsc --noEmit` clean in all six: `langy-server`, `github-server`,
  `ops-server`, `automation-server`, `auth-server`, `enterprise-scim-server`.
- `git diff --numstat -- platform/app`: **0 insertions** on every row.

### Follow-up this lane created

`apps/api/src/app/api-client-address.ts` and the utils lane's in-flight
`apps/api/src/app/getClientIp.ts` are two readings of one header list. The
unsubscribe door needed an answer before that move landed; whoever lands
`getClientIp.ts` should delete `api-client-address.ts` and bind
`UnsubscribeRestPorts.clientAddress` to `getClientIpFromHonoContext`. The file
says so in its own docblock.

## The remaining platform server verticals, 2026-09-02

The five subtrees nobody else owned: the Better Auth instance, the mailer
remainder, the tracer collector, the loose `utils`/`server` leaves, and the
test harness. Every one is a MOVE with its imports fixed, or a DELETE of a
module that already has a live successor elsewhere; nothing was copied.

| Subtree | Lines | Went to | Shape |
| --- | --- | --- | --- |
| `server/better-auth/**` | 2,557 | `@langwatch/auth-server` (`transport/better-auth/**`, `ports/better-auth.port.ts`) | moved whole, collaborators became named parameters |
| `server/mailer/**` | 1,340 | `@langwatch/mail` (3 templates) | 3 moved, 3 + 2 suites deleted as superseded |
| `server/tracer/collector/**` | 2,391 | `@langwatch/model-provider-contract` (2 suites) | 3 modules + 5 suites deleted as superseded |
| `server/{auth0,role-bindings,utils}` | 601 | `@langwatch/auth-server`, `@langwatch/prisma-client` | 2 moved, 1 deleted as superseded |
| `utils/**` | 2,320 | 6 packages + `apps/{ui,api}` | 7 moved, 6 deleted as superseded |
| `features/errors/logic/**` | 7,800 | `apps/ui` (`src/model/errors/**`) | moved whole |
| `components/__tests__` | 9 files | `packages/design-system`, `experiment-web`, `apps/ui` | 7 moved, 2 deleted |
| `test-utils/**` | 3,077 | **new** `@langwatch/test-harness` + 3 feature packages | 12 modules + 10 suites moved, 5 deleted |

### The identity seam

The deployment's ONE Better Auth instance is now
`createBetterAuthTransport` in `@langwatch/auth-server`, and it is the same
instance — the model mapping, the 30-day session with `storeSessionInDatabase`,
the credentials gate, the ADR-027 request hook, the rate-limit rules, the
account-linking policy and every database hook travelled unchanged. What
changed is where its collaborators come from: twelve `~/env.mjs` reads at
module load became one `BetterAuthDeploymentConfiguration`, and the six things
it reached into the application for became abstract ports
(`BetterAuthStoragePort`, `BetterAuthFederationPort`,
`BetterAuthIdentityCeremoniesPort`, `BetterAuthPendingInvitePort`,
`BetterAuthAnnouncementsPort`, `SignInRouterShadowPort`). No second instance
was created anywhere.

`apps/api` composes it (`api-better-auth.composition.ts`) and no longer has to
be handed one: `ApiAuthComposition` builds the transport itself when the
deployment named a browser-session identity, and an injected transport still
wins. `api.config.ts` gained one anchored block — `browserSession`, read
all-or-nothing from `NEXTAUTH_SECRET` + `NEXTAUTH_URL`, with `BASE_HOST` taken
from the existing `infrastructure.execution.publicBaseUrl` leaf rather than
bound a second time (the configuration framework refuses two bindings on one
variable, which is how that was caught).

### What each move had to decide

- **The trigger digest, the no-reply address and the unsubscribe token did not
  move — they were deleted.** `apps/worker` already renders the digest
  (`trigger-digest-mail.template.ts`) and `@langwatch/automation-server` already
  holds `TriggerNoReplyService` and `UnsubscribeTokenService`, whose suite pins
  the recorded bytes of a token the platform module signed. Three modules and
  two suites with live twins are three modules and two suites too many.
- **`cost.ts`, `piiCheck.ts` and `evaluationNameAutoslug.ts` were deleted for
  the same reason.** `@langwatch/model-provider-contract`'s `model-cost.ts`
  says of itself that a second implementation of the cascade "would bill a span
  at a different rate than the fold projection prices it"; `apps/worker`'s
  `worker-pii-analysis.adapter.ts` names itself the harvest of `piiCheck.ts`;
  `@langwatch/evaluation-server` holds the autoslug service.
- **The two cost suites came with the arithmetic.** `cost.unit.test.ts` is the
  only body of coverage over `estimateCost`'s cache, audio, character and
  second rates, and the catalogue price-coverage guard is the one that caught a
  transcription model priced per second while it reports tokens. Both were
  repointed at the package's signature (`rate:` rather than `llmModelCost:`,
  `matchModelCost` rather than `matchModelCostWithFallbacks`,
  `getStaticModelCostRates`), which meant exporting `normalizeModelName` and
  `normalizeBedrockModelId` — the two rules a customer-visible price depends on,
  now pinned by the suite that travelled with them.
- **`getClientIp.ts` was deleted and its suite kept.** The REST lane's
  follow-up asked for the opposite (delete `api-client-address.ts` when
  `getClientIp.ts` lands), and the opposite is what happened, because
  `apiClientAddress` is the better reading: same header order, same socket
  fallback, and no `NextApiRequest` branch for a request shape this process
  never sees. `__tests__/api-client-address.unit.test.ts` — already committed
  against a module that did not exist — now drives the function it is named for.
- **`ssrfProtection.ts`, `ssrfConstants.ts`, `encryption.ts` and
  `compat/next-router.ts` were deleted as frozen twins.** `packages/egress`,
  `AesGcmSecretEncryptionAdapter` and the three per-family router shims each say
  in their own docblock that they are the twin; with the application gone they
  are simply the copy.
- **`rbacVocabulary.ts` landed as `permission-vocabulary.ts`, not
  `vocabulary.ts`.** `@langwatch/authz-contract` already has a `vocabulary.ts`
  — the scope tiers and principal kinds — and the first attempt overwrote it.
  It is restored; the permission table is its own module beside it.
- **The errors registry went to `apps/ui`, which is `@langwatch/ui`.** No
  package imports it: every web family that needed error copy already carries
  its own (`packages/features/trace/web/src/behavior/errors/**` is the largest),
  and the matches in `packages/` are docblock references and one `vi.mock` of a
  specifier that resolves nowhere.

### Named absences and recorded coverage losses

- **`apps/api` composes Better Auth over the STOCK Prisma adapter.** The
  event-sourced identity storage branch, the identity ceremonies, the
  pending-invitation lookup and the sign-in router shadow are absences this
  process announces by name at boot (`announceApiBetterAuthAbsences`). The
  first of them is the load-bearing one and it is honest: the identity
  branch's per-user gate ships CLOSED, so every user takes the legacy branch —
  the stock engine, byte for byte — which is what the platform application
  runs today. What is absent is the ROUTING, and with it the ability to enrol
  a user from this process. The ceremonies absence follows from it: nothing on
  the identity branch to pin an account id for, so Better Auth mints its own,
  exactly as before ADR-101.
- **Password-reset mail is a PORT with a refusing default.**
  `ApiPasswordResetMailPort` refuses rather than resolving quietly, because a
  reset that reports success and sends nothing leaves someone waiting on an
  inbox. It is a port rather than a call into `@langwatch/mail` for the reason
  `ApiIdentityMailPort` already gives: rendering a message is react-email, and
  `frontend-boundary.unit.test.ts` exists to stop a value-import chain from a
  backend process to React.
- **`apps/api` answers `platformSsoAllowed()` with `false`.** It composes no
  licensing store, which is the same answer `signInMethodPolicyPortOver`
  already gives from the same reasoning. The consequence is stated rather than
  discovered: `ssoDomain` auto-join and every `ssoDomain` enforcement are off in
  that process, and the grant writer and invite lookup underneath them are
  unreachable while it stands.
- **`cost.module-load.unit.test.ts`, `typecheckProjects.unit.test.ts`,
  `privateRouteOrgId.unit.test.ts`, `shardFailureReporter.unit.test.ts` and
  `cleanupTestRows.integration.test.ts` were deleted, not moved.** Each guards
  a subject that is the platform application's own and is going: a module-load
  side effect in a deleted module, `platform/app`'s three TypeScript projects,
  `server/clickhouse/privateRouteKey`, `platform/app/src/test-unit-global-setup`
  and the `~/server/db` singleton. The last is a real loss on `cleanupTestRows`'
  SQL, the same call the identity and organizations slices recorded.
- **`useDatasetSlugValidation.test.tsx` was deleted: every case was `it.todo`.**
  A file of eleven todos binds nothing and reads as coverage.
  `global-dialog-cleanup.regression.test.tsx` went with it — it proves
  `platform/app`'s `test-setup.ts` registers a global `afterEach(cleanup)`, and
  no surviving app has that setup file to prove it about.
- **`appPermissionsMock.ts` was deleted.** It builds its mock over
  `~/runtime/app/features/authz`, which is the platform runtime's.

### The three guards that stopped being masked

Repointing scanning guards at their new homes revealed pre-existing failures
that a broken root had been hiding. None is this lane's, and all three are
recorded rather than re-masked — a guard that aborts reports no offenders
forever, which is the failure mode this repository keeps paying for.

- `codes.unit.test.ts` (now `apps/ui/src/model/errors/__tests__/`) walks
  `apps/{ui,api,worker}/src`, `packages/` and `platform/app/src` while the last
  exists, `existsSync`-filtered so it narrows rather than throws. Two codes
  raised with no copy were given it — `service_unavailable` (raised by the OTLP
  ingest door and three `apps/api` compositions) and `forbidden` — and two whose
  raiser is already gone had their dead copy removed
  (`evaluation_not_found`, `malformed_custom_role_permissions`).
- `no-raw-error-toasts.unit.test.ts` was scanning ELEVEN files, because its one
  root followed the registry to `apps/ui`. It now walks `apps/ui/src`,
  `packages/` and `platform/app/src`; the packages carry UI now, which the
  docblock's "the workspace packages carry no UI" no longer describes.
- `teardown-scan.unit.test.ts` named an `ee/` root deleted in `4faa77c658`.
  While it failed on that root the `packages/` root's own findings were never
  asserted: **43 test teardowns across `packages/` delete by a reassignable
  id**. `typescript-compiler-api.unit.test.ts` aborted on an ENOENT for a
  tracked-but-deleted file (a rename in flight); with the listing narrowed to
  what is on disk it reports **18 value imports of the `typescript` root
  export**, `packages/architecture-lint` declaring `6.0.3`, and
  `@typescript/native-preview` still in the root manifest. All four counts are
  debt this lane surfaced and did not create; they want a baseline file or a
  sweep, and both are somebody's decision rather than a silent re-masking.

### Gates

`tsc --noEmit` clean, whole suite green: `@langwatch/auth-server` 6 files / 57,
`@langwatch/mail` 4 / 36, `@langwatch/model-provider-contract` 26 / 343,
`@langwatch/authz-contract` 8 / 96, `@langwatch/config` 4 / 28,
`@langwatch/observability` 18 / 179, `@langwatch/prisma-client` 5 / 88,
`@langwatch/design-system` 20 / 109, `@langwatch/experiment-web`
(elements) 3 / 9, `apps/ui` (`src/model`) 9 / 216 with 0 typecheck errors under
`apps/ui/src`, and the annotation, coding-agent and github server packages
typecheck clean over their new fixtures. `@langwatch/test-harness` is 7 / 113
with the four un-masked guards above red on other lanes' debt.

`apps/api` typechecks with no error in this lane's files and reached
**580 passing / 2 failing across 69 files** once `@langwatch/auth-server`
declared the three dependencies another lane's in-flight
`auth-cli-device-flow.api.ts` needs — before that one unresolved import failed
17 suites outright. A later run of the same command reports 32 failures from
`ReferenceError: options is not defined` at
`api-production.composition.ts:974`, which is the gateway lane's `composeDoors`
mid-edit; this lane's edit to that file is the anchored `resolveAuth` block at
line 1295, and `api-production.composition.unit.test.ts` was 37/37 on its own.

`git diff --numstat -- platform/app`: **0 insertions** on all 189 rows.

### What is left under `platform/app/src`

Outside `app-layer`, `routes`, `app/api`, `tasks`, `mcp` and `runtime`, this
lane leaves: `server/{agents,analytics,annotations,api,api-key,auth,context,
data-privacy,data-retention,evaluations,evaluators,event-sourcing,export,
filters,health-probes,invites,langevals,license-enforcement,metrics.ts,
middleware,modelProviders,nlpgo,ops,organizations,posthog.ts,profiling,...}`,
`src/{__tests__,factories,features,hooks,pages,prompts}` and the loose
`src/*.ts` boot files. `src/{utils,test-utils,components}`,
`server/{better-auth,mailer,tracer,auth0,role-bindings,teams,utils,otel}` and
`src/features/errors` are **gone**.

## (g3) The worker's own model gateway (2026-09-02)

`apps/worker` composes `ModelProviderService` for itself. The capability was the
last shared blocker under the worker's two model-using paths — topic clustering
asks it four questions, an online evaluation asks it for the `X_LITELLM_*`
environment — and both had been answering by name because the six ports
`PostgresModelProviderAdapter` takes were platform classes. They are not any
more, and none of them is a copy: every one is the packaged adapter that
`apps/api/src/app/api-model-provider.composition.ts` already composes.

`apps/worker/src/app/worker-model-provider.composition.ts` is the composition.

```
createWorkerModelProviders
  |- PostgresModelProviderAdapter          the packaged adapter, over this
  |    |                                   process's one Prisma client
  |    |- credentials    EncryptedModelProviderCredentialAdapter over the SAME
  |    |                 cipher resolveWorkerStoredSecretCipher already gives
  |    |                 Automation, the gateway's endpoint secrets and
  |    |                 Governance ingestion (CREDENTIALS_SECRET, then
  |    |                 NEXTAUTH_SECRET — the App's own order)
  |    |- catalog        RegistryModelProviderCatalogAdapter + the deployment's
  |    |                 three facts: IS_SAAS (projected from deployment.saas),
  |    |                 the environment bag, and the SSRF fence a credential
  |    |                 probe is judged by
  |    |- connectionRateLimiter  a frozen twin of the App's Redis fixed window,
  |    |                 counted in the queue's own connection under the same
  |    |                 `langwatch:ratelimit:` prefix
  |    |- codexTokenRefresher   CodexOAuthModelProviderTokenRefresherAdapter
  |    |- ids            PrefixedModelProviderIdAdapter over nanoid, the same
  |    |                 minter the API tier writes rows with
  |    `- translation    ABSENT by name — see below
  `- PostgresManagedProviderAdapter        the Enterprise managed-provider
                                           service, composed over the same
                                           ProjectService, so one graph answers
                                           "is this organization managed"
```

`WorkerModelProviders` carries the gateway and the managed-provider service as
ONE value, and both consumers take that value rather than the two services
apart. That is what makes the sharing structural: a caller cannot hand topic
clustering a gateway from one graph and the evaluator environment a managed
service from another, which is how a managed-Bedrock organization would get its
own key on one path and the proxy credentials on the other.

**Config leaves added** (`apps/worker/src/platform/config/worker.config.ts`,
`infrastructure.modelProvider`): `BLOCK_LOCAL_HTTP_CALLS` and
`ALLOWED_PROXY_HOSTS`, plus the raw environment bag resolved from the source the
way `apps/api` resolves it. Three inputs the gateway also needs are PROJECTIONS
rather than new leaves, and each is a deliberate refusal to declare a twin:
`isSaas` is `deployment.saas` (already `IS_SAAS` through the same one-or-true
schema), the cipher key is `automation.credentialsEncryptionKey` (already
`CREDENTIALS_SECRET` then `NEXTAUTH_SECRET`), and WHICH variable carries a
provider's key is the provider registry's business rather than a schema here.
Two leaves over one variable is how two answers to one deployment fact get into
one process, and both of these decide whether a customer's provider is usable.

**`withoutClusteringModels()` is closed.** `createWorkerTopicClusteringExecution`
takes an optional `modelProviders` and wires
`ModelProviderExecutionAdapter` — the model-provider package's own four-method
implementation of `TopicClusteringModelsPort`, the same one the application
composes — when it has one. Nothing in the worker re-derives which model a
project clusters with. `AbsentTopicClusteringModels` still answers on a process
that composed no gateway, and the absence is reported only then.

**`EvaluationModelEnvPort` points at the same service.**
`createWorkerEvaluationModelEnv` in
`apps/worker/src/app/worker-evaluation-model-env.composition.ts` builds
`WorkerEvaluationModelEnv` from the `WorkerModelProviders` bundle, so the
evaluation execution bundle and the clustering runtime resolve through one
gateway.

### Named absences and recorded losses

- **The gateway is composed but GATED, and production still misses one
  precondition.** `tryCreateWorkerModelProviders` refuses on two, told apart by
  name at boot: `no-encryption` (a deployment that never set
  `CREDENTIALS_SECRET` — a gateway without the cipher would report every
  configured provider as unusable rather than failing honestly) and
  `no-tenancy`. Today `worker-production.composition.ts` passes
  `tenancy: undefined`, so `no-tenancy` is what a production worker logs. A
  provider row's scope is the triple project/team/organization and its cost
  reads are authorized, so the adapter takes a whole `ProjectService`,
  `OrganizationService` and `AuthzService`; this process composes the READ half
  of Project only (`createWorkerTraceCapabilityServices`), Billing's narrow
  tenant-organization lookup, and AuthZ's CONSUMER pipeline rather than an
  `AuthzService`. Composing the three is its own slice and its wall is named:
  `PostgresOrganizationAdapter` requires an `AuthzService`, and
  `PostgresAuthzAdapter` requires a prom-client `Registry` this process
  deliberately does not hold (it writes every series over OTLP), so closing it
  means an OTel twin of `ObservabilityAuthzMetricsAdapter`'s two counters plus a
  decision about whether the worker's authz registration may also produce. That
  is the SAME `ProjectService`-wave prerequisite the worker blocker graph
  already names as gating five conversions; this lane adds the model gateway to
  the list of things it unblocks rather than a new blocker.
- **`translation` is absent by name.** A translation is a model call executed
  against the OpenAI-compatible proxy that hangs off the NLP engine's address —
  the Workflow feature's path joined to a deployment's engine address, a join
  this process does not make and has no other reason to. `apps/api` makes it
  with `nlpProxyBaseUrl` from `@langwatch/workflow-server`; carrying that here
  would be a second description of the same URL for a method no command,
  projection or subscriber in this process calls. `AbsentWorkerModelTranslation`
  refuses by name so a future caller finds the decision.
- **The connection-test window refuses without Redis.** The window is a SHARED
  budget spent against the same keyspace the other tier counts in, so an
  in-memory counter would hand out a second ceiling rather than a smaller one.
  A deployment with no Redis loses its connection-test button and nothing else —
  every other gateway path is a read — and the absence is reported at boot.
- **`withoutTitleGeneration()` is NOT closed, and it is one MOVE away rather
  than one composition away.** Langy's conversation title generator resolves a
  model through exactly this cascade, and the gateway now exists; what does not
  is the generator. `createLangyConversationTitleGenerator` is still
  `platform/app/src/runtime/app/features/langy-title-generation.adapter.ts`
  (139 lines: the prompt, the title sanitiser, the resolve-then-fall-back model
  cascade and one `generateText` call), and its message reader is already
  packaged as `LangyMessageService.createTrustedMessageReader`. Moving it into
  `@langwatch/langy-server` (which gains `ai`) and passing the gateway is the
  whole of the remaining work. Left here because it is a package move with a
  platform deletion, which is a slice rather than a wiring change.
- **`withoutSpendSettlement()`, `withoutExecutionPool()`, `withoutAgentManager()`,
  `withoutSessionKeyMint()` and the eight automation-settlement absences are NOT
  this service's.** Grepped and checked one by one: they name an all-instance
  ClickHouse directory, a scenario execution pool, the Langy agent manager, an
  authorization graph and Automation's own persistence — none resolves a model.

### Gates

`cd apps/worker && pnpm exec vitest run`: **57 files / 431 tests, all passing**
(baseline 56 / 423; this lane adds
`src/app/__tests__/worker-model-provider.composition.unit.test.ts` with 6, one
clustering scenario to `worker-capability-mount.composition.unit.test.ts` and
one config scenario). `tsc --noEmit` and `tsc --noEmit -p tsconfig.test.json`
both **0 errors** after two pre-existing test-only breaks from other lanes were
cleared: `@langwatch/workflow-contract` was undeclared in `apps/worker`'s
`package.json` (the evaluation composition test type-imports it) and the dataset
backfill task's test fixture was stale against
`DatasetMigrationRunResult` (`"migrated"` for `"completed"`, and a three-field
summary for the package's five). `apps/worker/src/features/job-registry.json` is
byte-unchanged and the registry-parity assertion in
`worker-capability-mount.composition.unit.test.ts` is green.
`git diff --numstat -- platform/app`: **0 insertions on every row**, and this
lane wrote nothing there at all.

**Worker absence count** (`grep -rn "abstract without" apps/worker/src`):
**23 declared before, 26 after.** One is closed in the sense that matters —
`withoutClusteringModels()` is now CONDITIONAL, reported only by a process that
composed no gateway, where before it was reported by every process — and its
declaration stays because the deployment it names is still reachable. Three are
new, and each names a decision that was previously invisible because no gateway
existed to make it: `withoutModelGateway(reason)`, `withoutModelTranslation()`
and `withoutConnectionWindows()`. The count going UP while a blocker comes down
is the honest shape here: a capability that could not be composed at all had one
absence, and a capability that is composed has as many as it has surfaces it
does not serve.

## The three gateway absences, 2026-09-02

The tRPC-group lane recorded three named absences when it mounted
`createGatewayPlatformRestApp`. All three are closed, and the module each one
named has left `platform/app`.

### What moved

| From | To |
| --- | --- |
| `server/api/idempotency.ts` (752) — the receipt ledger | `packages/api/src/rest/idempotency-ledger.ts` (792), with `apps/api/src/app/api-idempotency-fingerprint.ts` (23, no consumers where it was) beside it as `idempotency-fingerprint.ts` |
| `server/routes/gateway-internal.ts` (1,508) — the Go data plane's control plane | `packages/features/gateway/server/src/transport/api-rest/gateway-internal.api.ts` (1,663) |
| `server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service.ts` (162) + `__tests__/spendQuantityRating.unit.test.ts` (228) | `packages/features/gateway/server/src/adapters/model-catalog.gateway-spend-rating.adapter.ts` (185) + its suite |

**`withIdempotency` moved into `@langwatch/api` rather than into `apps/api`,
against that package's own docblock**, which said the ledger "stays in the
process that owns a database and an encryption key". Four REST families read
the header, and a per-process implementation would have been fine for one of
them; what decided it is that the claim, its heartbeat and its takeover window
are a protocol BETWEEN concurrent requests, so the thing worth having exactly
one of is the PROTOCOL, and the process supplies the two things that are
genuinely its own. Both arrive as ports: `IdempotencyReceiptPersistence`
(already the shape the platform module took) and a new
`IdempotencyResponseCipher`. The docblock was corrected rather than left
standing.

**The store is Postgres, not Redis.** The instruction for this lane named a
Redis port; the module is a claim on the `IdempotencyReceipt` table decided by
its unique index over (scopeId, key), with heartbeat and fenced takeover, and
moving it to Redis would have been a rewrite of the one mechanism that stops a
retry minting a second virtual key — and would have left the four platform
families reading a second, disagreeing store. The seam that WAS already a port
is the one that was kept.

**Three mechanical changes inside the moved ledger, each recorded because none
is a pure move.** `nanoid()` became `randomUUID()` from `node:crypto` — the
claim id is an opaque token and `@langwatch/api` has no such dependency, so
adding one for a random string would have been the larger change.
`Prisma.PrismaClientKnownRequestError` became a duck-typed `code === "P2002"`,
for the reason `uniqueConstraintTargets` already gives in
`api-rest-ports.ts`: a bundler can produce two copies of the driver's error
class and an `instanceof` then answers false for a REAL unique violation —
which here would propagate as a 500 on exactly the retry the key was sent to
make safe. `IdempotencyReceipt` was restated structurally as
`IdempotencyReceiptRecord`, naming only the seven columns the protocol reads.

### Ports the gateway-internal move exposed

`createGatewayInternalRestApp({ security, ports })` replaces a module-level app
over `getApp()`, a module-level `prisma` and `process.env`. Twelve members, and
three of them are OPTIONAL because their absence is a route that refuses by
name rather than a family that fails to mount:

- **`GatewayInternalStorePort`** (+ `PrismaGatewayInternalStoreAdapter`) — the
  six row reads that were inline `prisma.<model>.<verb>` calls inside handlers.
  Every `include`/`select` is transcribed rather than narrowed: the config
  read's `routingPolicy` selection is what carries the model aliases and the
  deny rules, and a bundle materialised without it is one the gateway serves
  happily with no aliases and no policy.
- **`guardrails`** — the monitor directory, the database and the evaluator
  runner, all three together or none. Absent answers 503
  `guardrail_evaluation_unavailable`. It does NOT answer `allow`: a guardrail
  that quietly stops protecting is worse than one that is honestly unavailable,
  which is the same rule the service already applies one level down.
- **`spend`** — the pipeline's command senders plus the rating seam. Absent
  answers 503 `spend_pipeline_disabled`, which is the code the data plane's
  drainer already spools against, so a batch is retried rather than acked and
  lost.
- **`realtimeSessions`** — the voice settlement's collaborators. Absent answers
  503, and the gateway refuses the mint when this refuses, so the refusal is
  the safe direction: a session booked with nowhere to report its usage is a
  call that runs and is never billed.

`rateSpendNanoUsd` became `ModelCatalogGatewaySpendRatingAdapter`, the
implementation of the `GatewaySpendRatingPort` that already existed for the
voice settlement — so the drainer and the settlement now price a call through
ONE seam, which is what that port was declared for. Its three platform
dependencies were all already packaged (`estimateCost`,
`getStaticModelCostRates`, `matchModelCost` in
`@langwatch/model-provider-contract`), so the move needed no new abstraction;
`matchModelCostWithFallbacks` is that package's `matchModelCost` under its
current name.

**It crossed into `server/event-sourcing/**`, which is the app-layer lane's
tree, and that is a deliberate judgment call.** The directory is
`gateway-spend-processing` — a gateway pipeline whose definitions
(`EventingGatewaySpendAdapter`) had already moved into `@langwatch/gateway-server`
— so the rating service was gateway residue in an event-sourcing folder rather
than event-sourcing code. The two suites left behind
(`spendPriceAgreement`, `transientKeyDeterminism`) both import
`~/runtime/app/features/webhooks` and stay for that lane.

### Mounted on `apps/api`

| Family | Base path | Composed by |
| --- | --- | --- |
| `createGatewaySpendRestApp` | `/api/gateway/v1` (`/spend-events`, `/spend-summaries`, end-user standing, replay) | `app/api-gateway-spend-rest.composition.ts` |
| `createGatewayInternalRestApp` | `/api/internal/gateway` (12 routes) | `app/api-gateway-internal-rest.composition.ts` |

Both are routed AFTER the process-owned REST families and after
`createGatewayPlatformRestApp`, in the same relative order the retired router's
enumeration gave them. `ApiGatewayComposition` grew `budgetDecisions` and the
gateway-group collaborators now expose the whole composition (`composition`)
rather than only `gatewayApp`: the spend family reads the spend STORE directly
and the internal family materialises a bundle against the DECISION store, and
both have to be the same stores the gateway application prices a budget
against.

### Configuration

`LW_GATEWAY_INTERNAL_SECRET`, `LW_GATEWAY_JWT_SECRET` and
`LW_SPEND_SETTLEMENT_GRACE_MS` were added to `api.config.ts` **in the same
change that composed their readers**, which is the rule the previous lane
declined to add them under. All three follow the file's stated convention for
credentials — `Config.value(optionalEnvironmentString, …)` rather than
`Config.secret`, which is `z.string().min(1)` and would refuse a whole boot
over a blank export, including a deployment that runs no gateway at all.
Neither secret is logged and neither is returned: `GatewayJwtAdapter` takes its
secret at construction and the HMAC verifier reads it through a closure.

**What each absence means is the adapter's rule and lives with it.** No HMAC
secret answers 500 `gateway_internal_secret_missing` at the door — the wire
behaviour the data plane already parses, and the one that tells an operator
which half of the shared secret they forgot. No JWT signing key, or no
`CREDENTIALS_SECRET`, and the internal family is NOT MOUNTED: `/resolve-key`
answers a presented key with a credential the data plane presents onward, and
every other route exists to keep that credential current, so a process that
cannot sign one has no gateway to serve; and a bundle built without the cipher
would name no providers, which the data plane serves as a key that can reach
nothing.

### Named absences remaining

Three of the five below were closed by the follow-on slice recorded under
"The gateway spend producer and the webhook platform" further down. What
remains is stated here in its final form.

~~**`runEvaluation` has left `platform/app/src/server/evaluations/`**~~
**CLOSED** by "The evaluator runtime, and the three doors that were waiting on
it" below. It WAS the same absence three times over — `/guardrail/check`
refusing `guardrail_evaluation_unavailable`, the legacy evaluation REST family
leaving four of its six routes unregistered, and the execution half's
`runEvaluationForTrace` — and all three are now bound to ONE runtime. Binding
the guardrail was the one line in `composeGatewayInternalRest` the port was
shaped for, and it is still NOT satisfied by the trace scorer: the runtime
publishes a data-first `runEvaluation` beside `runEvaluationForTrace`, because
a guardrail takes an evaluator type and an input/output pair where a re-score
takes a trace and a monitor.

**The realtime settlement writes no span.** `spanIngestion` is optional on
`GatewayRealtimeSessionCollaborators` and unbound: the money lands and the
voice call simply carries no cost line on its trace, which is the degradation
the port itself documents. Binding it needs the normalized-span seam the OTLP
receiver composes, and that seam is the trace lane's to publish.

**Codex refresh is bound** where this process composed a model-provider
service, and refuses 503 `codex_refresh_unavailable` where it did not — a new
code, and the alternative was to answer `codex_session_expired`, which would
send a customer round a re-authentication loop that cannot end.

### Judgment calls

- **`canonicalError` for the spend family comes from
  `api-rest-observability.composition.ts`**, whose `renderCanonical` was split
  into an exported `canonicalErrorFor(error)` that returns `{ status, body }`
  and an `onError` that writes it. The family installs its own `onError` to log
  what the caller actually received under its own name and delegates the
  rendering; the body itself is `@langwatch/api/rest`'s `apiErrorBody`, so
  `type` is still derived from the status rather than invented. Copying the
  platform's `app/api/shared/canonical-error.ts` was the alternative, and it is
  another lane's file with five other consumers.
- **`@langwatch/enterprise-api` gained a `./webhooks` subpath** exporting
  `eventMatches` and `WebhookEnvelopeService`. Importing them off that
  package's index pulls the governance and SCIM compositions into `apps/api`'s
  program — which today does not typecheck at all, because
  `enterprise-governance-server` declares four workspace dependencies that are
  not linked. The subpath is the same sanctioned seam (`apps/api` names that
  composition and nothing enterprise below it) without the graph.
- **The billing plan gate is restated in `apps/api`** rather than imported from
  `WebhookAccessService`, for the same reason: it is one plan read and one
  sentence, transcribed verbatim from the middleware it replaces because a
  caller's own error copy quotes it, against the SAME plan provider every
  allowance banner on this process reads.
- **`spendStoreUnavailable` is `@langwatch/analytics-server`'s
  `ClickHouseUnavailableError`**, the same one every other read on this process
  raises, rather than a second taxonomy for one failure.

### Gates

`packages/api`: `tsc --noEmit` **0 errors**; `vitest run` **27 files / 335
tests, all passing** (the ledger suite adds 7).
`packages/features/gateway/server`: `tsc --noEmit` **0 errors**; `vitest run`
**37 files / 289 tests, all passing** (the moved rating suite adds 15).
`apps/api`: `tsc -p tsconfig.json --noEmit` **0 errors in this lane's files** —
the single error in the tree is another lane's in-flight
`packages/features/experiment/server/.../experiment-v3.api.ts`, edited a minute
before the run. `tsc -p tsconfig.test.json --noEmit` has **0 errors in this
lane's files**; the ones that remain are the two the previous lane already
recorded (`app-trpc.features.unit.test.ts`'s context drift, and
`app-trpc-error-formatter.unit.test.ts` importing OpenTelemetry SDK modules that
are not linked). The two suites this lane adds are **5/5 and 5/5**.
`git diff --numstat -- platform/app`: **0 insertions on every row**, 26,671
deletions across the tree.

`platform/app/src/server/api-router.ts` lost one import and one mount
(`gatewayInternalApp`); nothing else in it changed. The
`gatewaySpendRestPorts`/`gatewaySpendBillingGate` pair beside it still feeds the
retired application's own `createAppRestFeatures` call and is that lane's to
delete.


## The gateway spend producer and the webhook platform, 2026-09-03

The slice above left five gateway routes mounted and refusing by name: the
spend-command ingest, the three realtime-session routes, and the billing
replay. All five now serve. Nothing moved out of `platform/app` this pass —
every module was already in a package — so this is composition alone.

### What was composed

| Seam | Built by | Closes |
| --- | --- | --- |
| `createGatewaySpendProducerPipeline` (gateway-server, 100) | `apps/api/src/app/api-gateway-spend-pipeline.composition.ts` | `/spend-commands`, and the three `/realtime-sessions` routes through it |
| `composeApiGatewayWebhooks` | `apps/api/src/app/api-gateway-webhooks.composition.ts` | the spend family's replay route |

### The producer registration

`EventingGatewaySpendAdapter` already took its three process managers as
OPTIONS, so the producer variant is the definition with none of them passed
and a refusing spend ledger in the fold's seat — the same shape
`createTraceProcessingProducerPipeline` has, for the same reason. What matters
is which half is load-bearing: the runtime's `processManagerMode:
"producer-only"` would decline a declared manager by name, but a definition
that declares NONE cannot be registered wrongly by a process that forgot to set
the mode, and the two managers in question write a customer's budgets and ship
their webhooks. A unit test reads `processManagers.size` off the real
definition rather than trusting the composition to keep passing nothing.

`settleSpend` is registered and deliberately NOT published. It is the
settlement sweeper's own command, sent by the process manager that resolves an
admission whose confirmation never arrived; a producer offering it would be
publishing a write no door on this tier has a reason to make. The three the
door does dispatch come from a named list rather than from handing the
registration's whole `commands` object over, so a command the pipeline gains
later cannot silently become a write the data plane can trigger.

**It sits in its own module rather than in
`api-agent-pipelines.composition.ts`, against what the previous record
predicted.** That file is the three AGENT-side pipelines a customer's action
writes on; spend is money the data plane reports. The precedent followed
instead is `api-trace-ingest.composition.ts`, which holds the OTLP receiver's
own producer registration beside the door that produces on it. Two doors read
this one — `/spend-commands` and the voice settlement — so the registration is
held on the composition (`composedGatewaySpendPipeline`) and handed to both:
two registrations of one pipeline in one process would be two producers writing
one routing key with two dispatchers behind them.

**`realtimeSessions` is built inside
`api-gateway-internal-rest.composition.ts` rather than handed in**, and only
`spendConfirmation` crosses the seam. The collaborator bag also wants the
connection and the rating seam, and both are already that module's own — a bag
assembled outside would give the voice settlement a second
`ModelCatalogGatewaySpendRatingAdapter`, which is two answers to what one
minute of audio cost.

### The webhook platform

`composeApiGatewayWebhooks` builds the endpoint registry, the emitted-envelope
log and the delivery service from the same three classes the worker's own
`worker-gateway-spend.composition.ts` builds them from. The replay path writes
into the delivery process's OUTBOX and commits; the worker is what freezes,
signs and ships the batch. So the delivery service is given the process store
and the registry, and REFUSES BY NAME on the three collaborators only its
executors reach — the last-hop transport, the entitlement read that gates live
delivery, and the receipt-expiry sweep. Binding real ones would describe a
process that could run those executors, and this one registers pipelines
producer-only and holds no process runtime.

Two decisions inside it:

- **`WebhookEndpointAdapter` is created with no `configuration` and no
  `pruneDeliveries`.** Both are the WRITE side's — destination validation on
  create, and the maintenance sweep — and this process only reads an endpoint.
  Passing a `WebhookEndpointConfiguration` assembled from defaults would have
  been a second, quieter answer to "may an endpoint deliver to a local URL"
  than the one the deployment actually configured.
- **The three services are reached through `@langwatch/enterprise-api/webhooks`,
  which grew from two exports to nine.** The subpath's whole reason stands
  unchanged: `apps/api` names the Enterprise COMPOSITION package and the index
  would pull the governance and SCIM graphs into its program. Adding
  `@langwatch/enterprise-webhook-server` to `apps/api`'s manifest was the
  alternative and was rejected for that reason — no manifest changed this pass,
  and no install was needed.

### Configuration and coverage

No new configuration. The three leaves the previous slice added
(`LW_GATEWAY_INTERNAL_SECRET`, `LW_GATEWAY_JWT_SECRET`,
`LW_SPEND_SETTLEMENT_GRACE_MS`) were never added to
`api.config.unit.test.ts`'s exhaustive `toEqual`, which had been red at HEAD
for that reason plus five other lanes' leaves; all eight scalars are now
declared there, and the stored-object lane closed the ninth
(`storedObjects.azure`) in the same window. That test is green again.

`api-production.composition.unit.test.ts`'s Prisma double gained `$executeRaw`,
`$queryRaw` and `$transaction` as FUNCTIONS. The durable process store refuses a
client that does not carry them — a client without `$transaction` cannot commit
a buffer and its outbox rows together, which is the whole guarantee — so the
double's catch-all delegate made the composition throw rather than the read.

Three suites, sixteen cases:

- `api-gateway-internal-rest.integration.test.ts` (+2): a signed batch is
  accepted, mapped and dispatched through the BATCHED sender with a
  `cost_nano_usd` the wire never carried, which is the only place that figure
  could have come from; and a process with no registration answers 503
  `spend_pipeline_disabled` verbatim.
- `api-gateway-spend-pipeline.unit.test.ts` (5): the real definition, its four
  commands, `processManagers.size === 0`, the three published senders, the
  confirmation, and the boot-time failure for an incomplete registration.
- `api-gateway-webhooks.unit.test.ts` (5): the trio composes together, the log
  alone degrades without ClickHouse, no cipher means no platform, and the spend
  family's ports read these rather than the refusing registry.

Three scenarios were added to `specs/ai-gateway/billing-spend-events.feature`,
under the Rule that already says a command the control plane accepted is never
dropped in silence, and all three are bound: the door accepting and pricing a
batch, the door refusing one with no registration, and the producer-only
property. `check-feature-parity.ts` reports that file at **59/82**, up from
56/79; the 23 that remain were unbound before this pass.

**A recorded coverage loss, carried rather than closed.**
`specs/ai-gateway/idempotency.feature` reports **5/14**. Its bindings used to
live in `platform/app/src/app/api/gateway-platform/__tests__/` and
`.../webhooks/__tests__/`, which the reachability sweep `379b452def` deleted
before this lane touched the module; the moved ledger's own suite and the
gateway integration case re-bound five, including the two that matter most —
a retry replays the first response, and two concurrent requests under one key
execute once. The nine still unbound are all `@integration @rest`: they assert
response headers, per-family header acceptance and receipt expiry over the real
Hono apps and a real Postgres, which is a REST-level slice over
`createGatewayPlatformRestApp` and `createWebhookRestApp` rather than anything
the ledger can answer for on its own.

### Gates

`packages/api`: `tsc --noEmit` **0 errors** (it had six, all in this lane's
`idempotency-ledger.unit.test.ts`, where `.catch()` widened the awaited value to
"the outcome OR the error" — replaced by a `refusalFrom` helper that also
asserts the run rejected at all); `vitest run` **29 files / 359 tests, all
passing**.
`packages/features/gateway/server`: `tsc --noEmit` **0 errors**; `vitest run`
**37 passed / 1 skipped, 289 passed / 5 skipped**.
`packages/enterprise/features/webhook/server`: `tsc --noEmit` **0 errors**;
`vitest run` **9 files / 90 tests, all passing**.
`packages/enterprise/composition/api`: `tsc --noEmit` **0 errors**.
`apps/api`: `tsc -p tsconfig.json --noEmit` — **0 errors** (mid-pass it carried
four from two other lanes' in-flight packages, `experiment/server` naming
`slugify` and `@langwatch/config` and `stored-object/server`'s Azure driver
passing a `Uint8Array` to `fetch`; both closed while this ran).
`tsc -p tsconfig.test.json --noEmit` — **0 errors in this lane's files**; the
three that remain are `app-trpc.features.unit.test.ts`'s context drift, already
recorded. `vitest run` — **770 tests, 1 failing, not in this lane's files**:
the org-group half's clustering scheduler.
`api-standalone.executable.integration.test.ts` also failed once under the
parallel run and passes 9/9 on its own — it binds a real listener, so it
collides with whatever else in the shard is binding one.
`git diff --numstat -- platform/app`: **0 insertions on every row**, 175 rows.


## REST wave 3c: the trace and evaluation verticals, 2026-09-02

**Five mounts left `platform/app/src/server/api-router.ts` — ten lines of it —
and thirteen platform modules were deleted.** Four families moved into the
package that owns them, keeping their shape; ten of their nineteen routes serve
for real, and every one of the other nine names what it is missing. The fifth
mount — the SSE subscription lane — moved nowhere, because `apps/api` had
already been serving the same wire since `0fc9e4120d`.

### Route family → mount

| Family | Routes | Moved to | Mounted in `apps/api` |
| --- | --- | --- | --- |
| `POST /api/traces/search`, `GET /api/traces/:traceId`, `PATCH /api/traces/:traceId/metadata` | 3 | `@langwatch/trace-server` `transport/api-rest/traces.api.ts` | **yes** — over the trace group's own composed read stack |
| `GET /api/traces/:traceId/transcript` | 1 | same file | no — route not registered, named absence |
| `GET /api/trace/:id`, `POST /api/trace/:id/{share,unshare}`, `POST /api/trace/search`, `GET /api/thread/:id` | 5 | `.../trace-legacy.api.ts` | **yes** — over the same `TraceApp` and the same `ShareService` the browser reads |
| `POST /api/collector` | 1 | `.../collector.api.ts` | **yes** — over the SAME ingestion service the OTLP receiver uses |
| `GET /api/evaluations/list` | 1 | `@langwatch/evaluation-server` `transport/api-rest/evaluations-legacy.api.ts` | **yes** — the catalogue is compiled in |
| `POST /api/evaluations/batch/log_results` | 1 | same file | no — named absence |
| `POST /api/evaluations/{:evaluator,:evaluator/:subpath}/evaluate`, `POST /api/guardrails/:evaluator/evaluate`, `POST /api/dataset/evaluate` | 4 | same file | **yes, now** — over the evaluator runtime `api-evaluator-execution.composition.ts` composes |
| `GET /api/sse/*` | 1 | **deleted** | n/a — `createSseSubscriptionApp` has served this wire since `0fc9e4120d` |

### What moved

- `platform/app/src/app/api/traces/[[...route]]/{app,app.v1}.ts` (617 lines) →
  `packages/features/trace/server/src/transport/api-rest/traces.api.ts`. The
  three-line `app.ts` went with it: a `createProjectApp` call and a
  registration are what `createTracesRestApp` now is.
- `platform/app/src/server/routes/traces-legacy.ts` (349) → `.../trace-legacy.api.ts`.
- `platform/app/src/server/routes/collector.ts` (721) → `.../collector.api.ts`.
- `platform/app/src/server/routes/evaluations-legacy{,.schemas}.ts` (1,858) →
  `packages/features/evaluation/server/src/transport/api-rest/`.
- `platform/app/src/server/routes/sse.ts` (303) DELETED, not moved.
  `apps/api/src/app-trpc/app-trpc.sse.ts` is the same protocol byte for byte —
  the same three frame types, the same `sseErrorFrame`, the same 25-second
  keep-alive comment, the same `superjson` line splitting, the same 400 on a
  missing path and 404 on an unknown procedure — and it takes the caller as a
  port instead of importing `~/server/api/root`. Moving the platform copy would
  have been moving a second implementation of a wire that already had one.
- `platform/app/src/server/api/ports/traces.schemas.ts` and its suite DELETED:
  the move took its last consumer, and `API_TRACE_LIST_INPUT` in
  `apps/api/src/app/api-trace-read-stack.composition.ts` is the same schema
  built on the same shared analytics filter vocabulary. `server/api/ports/` is
  now empty and gone.
- Six platform route suites DELETED with the routes they drove
  (`collector.unit`, `collector-validation-diagnostics.unit`,
  `traces-legacy-{get-trace,thread}.unit`, `traces-legacy.share.unit`,
  `evaluations-legacy-skipped-cost.integration`), plus the three
  `app/api/traces/__tests__` suites. Every one of them mocked a platform module
  path — `~/server/app-layer/app`, `~/server/db`, `~/server/traces/*` — so none
  survives a move that turns those reaches into ports; the four families are
  covered instead by the two integration suites below, which drive the REAL
  Hono apps.
- The two ingest rules the collector was recorded as blocked on had already
  landed: `maybeAddIdsToContextList` and `extractChunkTextualContent` are
  `@langwatch/trace-contract`'s `trace-rag-chunks.ts`, and
  `evaluationNameAutoslug` is `@langwatch/evaluation-server`'s
  `EvaluationNameAutoslugService`. Nothing in `trace/web` held them any more,
  so this slice found the parking already cleared.

### What the API process grew

- **`composeApiTraceIngest` now composes BOTH ingest doors from one
  `TraceIngestionService`.** It answers `{ otlp, ingestSpan, collectorCredential }`
  rather than the OTLP ports alone. One composition rather than two because a
  second ingestion service would be a second dedup gate: a span posted to
  `/api/collector` and retried against `/api/otel/v1/traces` would then be
  recorded twice.
- **`ApiTraceReadStackPort` grew `getApiKeyProtections`.** It is the anonymous
  resolution with costs put back — exactly what `getProtectionsForProject` did
  — and it is on the READ STACK rather than in a mount so the REST doors and
  the explorer redact one trace one way.
- **The trace-group half publishes its read stack.** `ApiTraceGroupCollaborators`
  gained `traceReads`, because the public trace doors need two things `TraceApp`
  does not expose: the legacy read's own `getAllTracesForProject` with its
  projection and date-axis options, and the API key's redactions.
- **`EvaluationNameAutoslugService` is constructed once, on the composition.**
  Three paths derive an evaluator id from an evaluation NAME — the collector,
  the evaluate doors and Trace's custom-evaluation sync — and the derived id IS
  the key a verdict is stored under.

### Named absences

- **`GET /api/traces/:traceId/transcript` is moved but its route is NOT
  REGISTERED.** The transcript joins the coding-agent session store and the log
  canonicaliser, and this process composes neither — the trace-group
  composition already refuses `evaluations` and `codingAgents` on its
  `TraceApp` by name, and the read stack's log records have no canonicaliser.
  An empty transcript reads as "this agent did nothing", which is a different
  and wrong fact, so the door answers 404 instead. Same shape as the OTLP log
  and metric signals.
- **`PATCH /api/traces/:traceId/metadata` is registered only where the process
  holds the `trace_processing` producer.** The amendment is a synthetic span on
  the ingestion pipeline; a PATCH that answered 200 while recording nothing is
  a change a caller cannot tell did not happen.
- ~~**The four evaluate doors are moved but NOT mounted.**~~ **CLOSED** by
  "The evaluator runtime, and the three doors that were waiting on it" below.
  They needed the evaluator RUNTIME — the thing that calls langevals, a
  workflow or a model — and `apps/api` now composes one in
  `api-evaluator-execution.composition.ts`. All four are registered where it is
  composed, and where a deployment names no `LANGEVALS_ENDPOINT` they stay
  unregistered for the original reason: a door that authenticates, validates
  and then fails at the last step is one an SDK retries forever.
- **`POST /api/evaluations/batch/log_results` is moved but NOT mounted.** Its
  find-or-create-experiment rule is Experiment's, over Experiment's own
  service, and it is published by neither the experiment package nor this one —
  it lives in `platform/app/src/pages/api/experiment/init.ts`, whose family
  (`POST /api/experiment/init`) belongs to the `misc.ts` lane. Rebuilding it at
  the mount would need a third copy of the deployment's `slugify` (the only two
  are browser modules), and an SDK whose `experiment_slug` resolved one way
  through `/api/experiment/init` and another way here would silently write its
  rows against a second experiment. The port group is declared; supplying it is
  the whole of what is left.
- **The collector enforces no plan allowance.** `apps/api` composes no usage
  meter, so `usageLimit` is absent and no monthly allowance is checked. That is
  the SAME degradation this path has always had when the allowance LOOKUP
  failed — the batch is accepted and the failure logged — and it is the
  decision the OTLP receiver on the same process already records.
- **The collector no longer stamps the customer trace id onto the
  error-reporting scope.** The platform route called
  `getCurrentScope()?.setPropagationContext?.({ traceId, … })` so a failure
  reported from inside the handler carried the customer's own trace id. That is
  PostHog's scope, this process composes no such sink, and adding an optional
  port nobody supplies would be inert. The `reportError` port carries the
  project and the trace id in its context argument instead.

### Judgment calls recorded

- **The search BODY is built at the mount, not in the package.** Both trace
  search bodies are the deployment's shared analytics filter vocabulary
  (`API_TRACE_LIST_INPUT`) with the family's own additive half merged on. The
  family publishes that half as `traceSearchBodyExtensions` — the projection
  DSL, the output format, the date axis, with their `describe()` text, because
  that text IS the public API documentation — and the process supplies the
  vocabulary. Same split the analytics timeseries body already records.
- **The deprecated `/api/trace/search` keeps its STRICT parse.** The v1 search
  validates non-strictly and strips an unknown key; the deprecated one has
  always rejected it. Loosening it would silently accept a typo a caller
  currently gets told about, so the mount's schema carries `.strict()`.
- **The collector's credential port answers a DISCRIMINATED refusal**
  (`kind: "credential" | "ceiling"`) rather than a body. The unauthenticated
  sentence — `{error:"Unauthorized", message:"Invalid credentials"}` — is the
  collector's own copy, quoted by every LangWatch SDK's error handling, and it
  differs from the three-shape sentence `ApiHandlerManagedCredentials`
  publishes. Keeping the copy in the family and the RESOLUTION in the process
  is what stops the two doors deciding differently while still answering
  differently.
- **`ProjectionValidationError` still becomes a 422 `validation_error`, not a
  400.** The body parsed and a field in it names a column that does not exist,
  which is the same KIND of fact a schema failure is; the boundary's own
  `RequestValidationError` names every offending path at once. Unchanged from
  the platform route, and pinned by the suite.
- **`zod-validation-error` was added to `@langwatch/trace-server`,
  `@langwatch/evaluation-server` and `apps/api`.** Three of the four families
  answer a rendered `fromZodError(...).message` as their 400 body, and that
  prose is the wire a deployed SDK shows a customer. Restating the library's
  format by hand would have been a copy of it that drifts; the package was
  already in the store (`platform/app` pins the same version).
- **`evaluationInputSchema` is declared in the moved
  `evaluations-legacy.schemas.ts`.** Its only other holder is the evaluator
  wizard's form model in `@langwatch/evaluator-web`, and a server package may
  not value-import a browser one. This is the copy the PUBLIC door publishes,
  so it lives beside the door; collapsing the two belongs with whoever drains
  that browser package. The three `describeRoute` helpers the family used from
  `routes/misc.schemas.ts` (`requestBodySchema`, `acknowledgementSchema`,
  `legacySentenceErrorSchema`) moved into the same file for the same reason —
  `misc.ts` still holds its own.
- **The evaluation ksuid prefixes and the two fallback model ids are STATED**
  (`"eval"`, `"cost"`, `openai/gpt-5`, `openai/text-embedding-3-small`). The
  constants module that named them is a browser one; all four are persisted or
  published wire constants rather than decisions. Same precedent as the export
  id's prefix in wave 3b.
- **`POST /api/dataset/evaluate` raises a handled `not_found` instead of a
  tRPC `NOT_FOUND`.** The platform handler threw a `TRPCError` from inside a
  REST route, where the boundary rendered it as an unrecognisable 500. The
  status a caller sees is now the 404 the route always meant.
- **`ModelNotConfiguredError` is caught at the mount, not in the family.** The
  evaluate doors' only response to an unconfigured cascade is to fall back to
  the evaluator's own default, so the port answers `string | null` and the
  distinction the exception carried has no consumer inside the family.

### Coverage

Two integration suites drive the real Hono apps over fakes at every port:

- `apps/api/src/features/trace/__tests__/trace-rest.integration.test.ts` (10) —
  the v1 search streaming an enriched, deep-linked page with the project taken
  from the credential and the ISO date coerced; an unknown `select` path
  answering 422 `validation_error` with the read never reached; the 404
  sentence for a missing trace; the transcript route absent; the deprecated
  read with its `Deprecation` header and successor `Link`; the bare
  `{ message }` 401 with the read never reached; the share mint landing on the
  one ledger; a REAL legacy collector payload reaching the producer as a
  `recordSpan` command; a payload naming no trace refused with nothing
  enqueued; and the collector's own unauthenticated sentence.
- `apps/api/src/features/evaluation/__tests__/evaluations-legacy-rest.integration.test.ts`
  (3) — the catalogue answering with its settings schemas and the three
  excluded evaluator families absent, and both unmounted halves answering 404
  rather than 401.

### Gates

Re-run whole on 2026-09-03, after the concurrent lanes had moved further in the
same working tree. Every number below is that re-run's, and every failure named
is another lane's file rather than this one's.

- `apps/api` `tsc --noEmit`: clean. `tsc --noEmit -p tsconfig.test.json`: 3
  errors, all in `app-trpc/__tests__/app-trpc.features.unit.test.ts` (its
  namespace list, wave 3a's), none in this lane's files. The two other groups
  this record listed on 2026-09-02 — `api-gateway-idempotency.integration.test.ts`
  and the untracked `app-trpc-error-formatter.unit.test.ts` — their lanes have
  since fixed.
- `apps/api` vitest over this lane's paths: 13 tests, all green — 10 in
  `trace-rest.integration.test.ts`, 3 in `evaluations-legacy-rest.integration.test.ts`.
  `api-trace-ingest.otlp.integration.test.ts` and
  `api-trace-filter-input.unit.test.ts` (the two suites this lane's composition
  changes touch) green with them: 5 files / 37 tests.
- `apps/api` whole suite: 83 files, 706 tests, ONE assertion failure and no load
  failures. The failure is `app/__tests__/api-trpc-collaborators.org-group.integration.test.ts`
  — the org-group lane's topic-clustering refusal, which now degrades to the
  generic unknown instead of naming itself. Not this lane's file and not
  reachable from one.
- `@langwatch/trace-server`: 137 files / 2,318 tests pass. `tsc --noEmit`: 4
  errors in two UNTRACKED files a concurrent lane landed in this package at
  23:28 on 2026-09-02, `transport/api-trpc/__tests__/trace-read-mappers.{conversation-context,redaction}.unit.test.ts`
  — the platform `server/api/routers/__tests__/tracesV2.*` suites, moved by the
  lane that owns `server/api/**`, importing an unresolved
  `@langwatch/data-privacy-server` and a `CategoryVisibility` this package does
  not export. They are the same two files that fail to LOAD in the run. No
  error and no failure in this lane's files, and the ClickHouse repository
  integration files the earlier gate named are excluded from the package's own
  script.
- `@langwatch/trace-contract`: `tsc` clean; 21 files / 339 tests pass.
- `@langwatch/trace-web`: `tsc` clean; 231 files / 1,817 tests pass.
- `@langwatch/evaluation-server`: `tsc` clean; 25 files / 193 tests pass.
- `git diff --numstat -- platform/app`: **0 insertions** on every row.
- `api-router.ts` was 342 lines at the start of wave 3b and is 251 in this
  working tree. Exactly ten of the fall are this lane's — five import lines and
  five `api.route` lines — and the rest is the concurrent authoring/workbench
  and auth lanes', removed from the same file at the same time.

### Not moved this slice, and why

`server/evaluations/runEvaluation.ts` stays: it is the app-layer residue lane's
tree, and it reaches four services (`modelProviders`, `managedProviders`,
`workflows`, `evaluators`) whose composition is that lane's to settle. It is
the single port the four evaluate doors are waiting on.
`pages/api/experiment/init.ts` stays for the same reason on the batch side —
its family is `misc.ts`'s.


## REST wave 3e: the CLI's two halves and the Activity Monitor's receivers, 2026-09-03

**Two platform route modules (3,991 lines, 24 routes) left
`platform/app/src/server/api-router.ts` and four platform files were deleted.**
Wave 3a declined both of them by name; this lane took the decision they were
waiting on. `routes/auth-cli.ts` is not one family, it is TWO families sharing
a path prefix, so it was SPLIT by owner rather than moved whole — seven RFC
8628 routes into `@langwatch/auth-server`, thirteen governance routes into
`@langwatch/enterprise-governance-server`. `routes/ingest/**` went to
governance with its two broken imports repaired against the packages that
superseded them.

### Route family → mount

| Family | Moved to | Mounted in `apps/api` |
| --- | --- | --- |
| `POST /api/auth/cli/{device-code,exchange,refresh}`, `GET /lookup`, `POST /{approve,deny,logout}` | `@langwatch/auth-server` `transport/api-rest/auth-cli-device-flow.api.ts` | **yes, where a host supplied the browser-session transport and this process holds Redis** |
| `GET /api/auth/cli/{budget/status,bootstrap,budget-overview,personal-project}`, `POST /{virtual-key,project-key}`, and the seven `/governance/*` reads and mints | `@langwatch/enterprise-governance-server` `transport/api-rest/governance-cli.api.ts` | **yes, where a host supplied the Enterprise governance application** — no host in this repository supplies one, so the family is absent on the OSS entrypoint |
| `POST /api/ingest/otel/:sourceId` | `@langwatch/enterprise-governance-server` `transport/api-rest/governance-ingest.api.ts` | **yes**, over the SAME `trace_processing` producer registration the project-scoped OTLP receiver made |
| `POST /api/ingest/webhook/:sourceId`, `POST /api/ingest/otel/:sourceId/v1/{logs,metrics}` | moved with the family | no — **not registered**, because this process folds neither logs nor metrics |

Twenty of the twenty routes `auth-cli.ts` declared are accounted for (wave 3a's
note said twenty-one; the file has twenty), and all four receivers moved.

### What moved, beyond the transports

- **The split point is the OWNER, not the path.** Eighteen of the CLI's routes
  answer under `/api/auth/cli`, and only seven of them are auth's: the device
  grant WRITES the session keyspace, and the other thirteen READ one before
  dispatching into `GovernanceService`, the Enterprise plan gate and two RBAC
  probes. Wave 3a refused to put Enterprise governance behind an auth
  package's door and refused to move governance out of its own lane; splitting
  is the answer that does neither. The two path sets are disjoint, so Hono
  routes them without an ordering rule between them.
- **The device-session state machine was already package-owned.**
  `services/cli-device-session.service.ts` and `ports/cli-device-session-store.port.ts`
  landed in `504d1517f7`; what was still on platform was the TRANSPORT over
  them. This lane moved that and supplied the process's adapter,
  `ApiCliDeviceSessionStore`, over the one Redis it opened.
- **The Redis adapter is single-key on purpose.** Every record the grant
  writes is TTL'd and read only by its own key, so the port is five key
  operations rather than a repository — and each one touches a single key,
  because a Redis cluster CROSSSLOT-rejects a multi-key operation whose keys
  hash to different slots, which the device code, its user-code index and the
  two token records always do. The poll throttle is `SET NX EX` in one round
  trip; a get-then-set spelled by hand would let two concurrent polls both see
  the window free.
- **One keyspace, two packages.** `GovernanceCliAccessTokenPort` is bound in
  `api-production.composition.ts` to the device grant's OWN
  `CliDeviceSessionService` instance, so the writer and the reader of the CLI
  token keyspace can never be two spellings of it. No device grant therefore
  means no governance CLI either. A second reader would fail silently: tokens
  would keep working and the sessions would simply stop being found.
- **`resolveSupportContact` and `resolveOrgAdminEmail` moved into governance**
  as `services/organization-support-contact.service.ts`. Wave 3a named the
  first of them as one of the reasons `auth-cli.ts` could not move; the
  governance CLI's ingestion-key mint is their only consumer left anywhere in
  the repository, so they went with it rather than to the organization lane.
- **`routes/ingest/rateLimit.ts` became `ports/governance-ingest-rate-limit.port.ts`** —
  an abstract `GovernanceIngestRateLimitPort`, `extractIngestClientIp`, and the
  two window constants (60 requests / 60 seconds, and the `lwingest:rate:` key
  prefix, both unchanged). The process binds it to the SAME fixed-window
  counter every other throttle on `apps/api` meters through, so one caller has
  one budget per rule.
- **The receivers' two broken imports were repaired against their successors.**
  `./ingest-key-provenance.utils` no longer existed: the three provenance rules
  are now `enforceApiKeyIdOn{Trace,Log,Metric}Request` in `@langwatch/trace-server`.
  `~/server/otel/parseOtlpBody` was superseded by `@langwatch/otlp`'s
  `readOtlpBody` and `parseOtlp{Traces,Logs,Metrics}`. These are the two
  half-finished demolitions wave 3a would not repair inside another package;
  both are now consumed rather than reinstated.
- **`@langwatch/enterprise-governance-server` grew five dependencies** —
  `@langwatch/enterprise-plan-gate`, `@langwatch/entitlement-contract`,
  `@langwatch/otlp`, `@langwatch/trace-server` and
  `@opentelemetry/otlp-transformer`. `@langwatch/auth-server` grew none: the
  device grant reaches nothing it did not already declare, because the
  organization application and the personal workspace arrive as ports.

### Named absences

- **Both governance families are absent without an Enterprise application.**
  They ARE Enterprise governance — the CLI half reads sources, budgets and
  ingestion templates; the receivers resolve a source's secret. A deployment
  that composed none and mounted them anyway would answer 500 to every
  `langwatch claude` pre-flight and 401 to every correctly configured
  collector, both worse than the 404 a door that plainly is not there gives.
- **The device grant is absent without Redis, the database, a browser session
  or the credential service**, and each is fatal on its own: without Redis a
  device code has nowhere ephemeral to live, so `/device-code` would hand out a
  code no poll could resolve; without the database the membership re-derivation
  that stands between an offboarded person and a live credential cannot run;
  without a session the three browser routes cannot name who is approving,
  which is the whole of what approval means; without the credential service
  there is no user-scoped CLI key to mint.
- **The budget pre-flight has no spend store on this process.** The gateway
  group holds the spend decisions, and the port is left off rather than stubbed
  — the family's documented degradation is `{ok: true}`, and the gateway still
  surfaces the real block on the first request through the same decision. A
  stand-in that guessed at a balance would refuse work nobody is over budget
  for.
- **The log and metric receivers are NOT REGISTERED.** This process folds
  neither signal — the same absence the project-scoped OTLP receiver reports —
  so `POST /api/ingest/webhook/:sourceId` and both `/v1/*` sub-paths 404.
- **Nothing an ingest receiver carries is priced.** The gateway spend ledger,
  its budget resolution and its change feed travel together as one optional
  port, because one write without the others is worse than none: a debit row
  nobody evicts a cache for is spend the gateway keeps routing against a stale
  balance. Cost extraction lives on `/v1/logs`, which is unmounted here anyway.
- **`LW_INGEST_RATE_LIMIT_DISABLED` is gone.** It was a `process.env` read
  inside the route module, and a package may not read one. The escape hatch it
  gave the volume-regression scenario is now the composition's: a deployment
  that wants no ingest throttle leaves the port off, and every request passes —
  the same answer the flag gave, decided where configuration is decided.

### Judgment calls recorded

- **The receivers JOIN this process's `trace_processing` producer registration
  rather than making one of their own.** The brief suggested a producer-only
  registration of the governance ingestion definitions, in the shape of
  `api-agent-pipelines.composition.ts`. Reading
  `apps/worker/src/app/worker-governance-ingestion.composition.ts` says those
  definitions are `pulled_usage_processing` and `ingestion_pull_processing` —
  the PULL-mode ingestion's aggregates, which a scheduled puller writes and
  these push receivers never touch. What a receiver actually emits is
  `recordSpan` on `trace_processing`. Registering a second copy of that
  definition would put one aggregate in the event catalogue twice and give the
  worker two descriptions of one stream, so `traceCollection` is HANDED IN from
  `api-trace-ingest.composition.ts` — which is also why this mount is absent
  wherever the OTLP receiver is.
- **`/api/ingest/otel/:sourceId` is mounted and its three siblings are not,
  from ONE port set.** The alternative — mounting all four and answering 501 on
  the three — tells a collector to retry forever. Registration is where the
  absence belongs, because a 404 is the only answer an exporter reads as "this
  receiver does not serve that signal".
- **Both halves of `/api/auth/cli` declare the same `basePath`.** Two
  `createServiceApp({ basePath: "/api/auth/cli" })` calls in two packages look
  like a duplication and are not: each mounts its own disjoint path set, and
  the shared prefix is the URL contract the CLI is already shipped against.
  Collapsing them would put one of the two packages inside the other.
- **The governance CLI's thirteen inventory rows were rewritten.** They read
  "not mounted — `apps/api` composes no Enterprise governance application",
  which was true when no mount existed. The mount now exists and is conditioned
  exactly the way `/api/github/*`'s is, so the rows say "mounted where a host
  supplied the Enterprise governance application — no host in this repository
  supplies one, so the family is absent on the OSS entrypoint". The fact is
  unchanged; what changed is that the absence is now the host's rather than the
  code's.
- **The ingest throttle open-fails, and that is the contract rather than one
  implementation's accident.** Ingest availability beats brute-force
  protection: a receiver that refuses because its counter is unreachable drops
  a customer's telemetry for an outage of ours, and the secret check still runs
  either way. The port sits between the cheap header regex and the expensive
  secret lookup, which is the position that makes it protect anything at all.

### Coverage

Three integration suites drive the real Hono apps returned by
`createApiProcessRestFeatures` over fakes, and each pins refusals rather than
only the golden path:

- `apps/api/src/features/auth/__tests__/auth-cli-device-flow-rest.integration.test.ts`
  (3) — the whole grant as one state machine over one in-memory store
  (`/device-code` → `/lookup` → `/approve` → `/exchange`, asserting the session
  carries the personal project and the scoped CLI key); a second poll inside
  the window answering `slow_down` from ONE atomic claim; and a seat disabled
  between approve and exchange refused with the CLI's one fatal code AND the
  device code burned — because the CLI treats any non-200 as "keep polling", so
  a refusal that left the record approved would spin one ceiling walk every
  four seconds with no terminal error on screen.
- `apps/api/src/features/enterprise/__tests__/governance-cli-rest.integration.test.ts`
  (6) — the source list on Enterprise with the permission held; 402 with the
  upgrade link raised BEFORE any permission is probed; 403 for an Enterprise
  member without the governance permission, with no source read; 401 for a
  missing or malformed bearer, before the plan is looked up; and on the
  project-key door, the offboarded caller whose presented session is SEVERED
  rather than left to expire, and the active member without project write
  refused 403 rather than handed the shared write credential.
- `apps/api/src/features/enterprise/__tests__/governance-ingest-rest.integration.test.ts`
  (5) — a REAL OTLP export posted at the mounted app, asserted at the PRODUCER:
  a `recordSpan` command carrying the span, tenanted to the hidden governance
  project rather than to the source's organization; origin attributes REPLACED
  rather than appended when the payload supplies its own, because two entries
  under one key would let a payload forge the origin every downstream
  governance filter reads; a valid secret pointed at another source's path
  refused with the same bare 401 an unknown secret gets, so the answer never
  confirms that some other source id exists; `wrong_endpoint` for a source type
  that emits no spans; and 404 from all three unregistered receivers.

### Gates

- `apps/api` `tsc --noEmit`: **0 errors**. `tsc --noEmit -p tsconfig.test.json`:
  4 errors in two files, none of them this lane's — three in
  `src/app-trpc/__tests__/app-trpc.features.unit.test.ts`, whose `TestContext`
  names no `github` on `ctx.app` (the gateway-group tRPC lane's mount added
  it), and one in the gateway-internal lane's untracked
  `src/app/__tests__/api-gateway-internal-rest.integration.test.ts`. Stale
  `.tsbuildinfo` cleared before both runs.
- `apps/api` vitest over this lane's three files: **14 tests, all green.**
- `apps/api` whole suite: **480 tests passed, 0 test failures**, 66 files
  passed. Seventeen files failed to LOAD, none of them this lane's, and the
  cause is not this working tree: re-running the four directories that hold
  them loads all seventeen (44 files / 402 tests, one assertion failure in
  `app/__tests__/api-trpc-collaborators.org-group.integration.test.ts`, the
  tRPC error-formatter lane's — a topic-clustering refusal now rendering as the
  generic unknown). The load failure the whole run printed was
  `Cannot find package '@azure/identity'` out of
  `stored-object/server/src/adapters/azure-blob-token-provider.ts`, a
  concurrent lane's `pnpm install` relinking `node_modules` mid-run.
- `@langwatch/auth-server`: `tsc --noEmit` clean; 6 files / **57 tests**, the
  wave 3a baseline.
- `@langwatch/enterprise-governance-server`: `tsc --noEmit` clean; 65 files /
  **591 tests**, the stated baseline.
- `git diff --numstat -- platform/app`: **0 insertions** on every row.
- `api-router.ts`: 297 lines at HEAD, 251 in this working tree. **Four of the
  46 removed lines are this lane's** — two imports (`authCliApp`,
  `ingestionRoutesApp`) and the two `api.route` lines under them; the rest
  belong to the concurrent REST and leftovers lanes removing from the same
  file. No platform module now names `routes/auth-cli`, `routes/ingest` or
  `ingest-key-provenance`, and `platform/app/src/server/routes/ingest/` is
  gone.

### Not moved this slice, and why

`platform/app/src/server/app-layer/__tests__/governance-ingestion-template.integration.test.ts`
stays. It exercises the app-layer's ingestion-template service rather than the
route, names neither receiver, and `server/app-layer/**` is off this lane's
map.


## REST wave 3d: the authoring doors, the workbench and the SDK's experiment, 2026-09-03

**Eight route files left `platform/app/src/server/routes/` and twenty-six
routes are serving from `apps/api`.** Six of the eight moved into the package
that owns them keeping their shape, one moved into `apps/api` itself because
what it probes is the process, and one was DELETED rather than moved. A ninth
family — the SDK's `POST /api/experiment/init` — came out of `misc.ts`, and
taking it out is what unblocked the batch result log wave 3c had to leave
unmounted.

### Route family → mount

| Family | Routes | Moved to | Mounted in `apps/api` |
| --- | --- | --- | --- |
| `POST /api/workflows/{code-completion,post_event}` | 2 | `@langwatch/workflow-server` `transport/api-rest/workflow-studio.api.ts` | **yes** — `features/workflow/workflow-studio-rest.mount.ts` |
| `POST /api/workflows/:workflowId/run`, `.../:versionId/run`, `POST /api/optimization/:workflowId/:versionId` | 3 | `.../workflow-run.api.ts` | **yes** — `features/workflow/workflow-run-rest.mount.ts` |
| `/api/experiments/*` (the workbench's ten doors) | 10 | `@langwatch/experiment-server` `transport/api-rest/experiment-v3.api.ts` | **yes** — `features/experiment/experiment-v3-rest.mount.ts` |
| `ALL /api/evaluations/v3/*` (the alias) | 1 | same file | **yes** — returned by the same mount, in registration order |
| `POST /api/experiment/init` | 1 | `.../experiment-init.api.ts` | **yes** — `features/experiment/experiment-init-rest.mount.ts` |
| `POST /api/evaluations/batch/log_results` | 1 | already moved in wave 3c | **yes, now** — the port group the init door's service supplies |
| `POST /api/scenario/generate` | 1 | `@langwatch/scenario-server` `transport/api-rest/scenario-generate.api.ts` | **yes** — `features/scenario/scenario-generate-rest.mount.ts` |
| `POST /api/dataset/generate` | 1 | `@langwatch/dataset-server` `transport/api-rest/dataset-generate.api.ts` | **yes** — `features/dataset/dataset-generate-rest.mount.ts` |
| `POST /api/playground` | 1 | `@langwatch/model-provider-server` `transport/api-rest/playground.api.ts` | **yes** — `features/model-provider/playground-rest.mount.ts` |
| `GET /api/health/{collector,evaluations,processor,triggers,workflows}` | 5 | `apps/api/src/features/health/` | **yes** — the probes test THIS process's boundary, so they are the process's |
| `POST /api/elevenlabs/webhook/:modelProviderId` | 1 | `@langwatch/gateway-server` `transport/api-rest/elevenlabs-webhook.api.ts` | **yes, now** — over the realtime bag `composeApiGatewayRealtimeSessions` publishes |
| `GET\|POST /api/cron/{old_lambdas_cleanup,seed_demo}` | 4 | **deleted, not moved** | n/a |

### What moved

- `routes/experiments-v3.ts` (1,424 lines) → `experiment-v3.api.ts` (1,466).
  The biggest single file in the wave, and the split it forced is the one worth
  recording: TWO credential classes on one base path. `/execute` and `/abort`
  are a browser session; the other eight are an SDK key answering the handled
  ceiling payload a CI job branches on. Both arrive as ports so the process
  resolves a person and a key exactly once however many families ask.
- `routes/workflows.ts` (279) → `workflow-studio.api.ts` (282), plus
  `workflow-code-completion.adapter.ts` (62) for the model call the completion
  door makes.
- The three synchronous run URLs came out of `misc.ts` (191 lines) into
  `workflow-run.api.ts` (256). ONE handler for all three: the legacy
  `/api/optimization/...` path carried its own copy of the run with its own
  catch-and-flatten-to-500, and the two had already drifted to disagree about
  the status for identical failures.
- `routes/scenario-generate.ts` (193) → `scenario-generate.api.ts` (211) plus
  `scenario-generate.nlpgo-error.ts` (92); `routes/dataset-generate.ts` (109)
  and `app/api/dataset/generate/tools.ts` → `dataset-generate.{api,tools}.ts`
  (137 + 47); `routes/playground.ts` (139) → `playground.api.ts` (162).
- `routes/health-checks.ts` (556) and `server/health-probes/canary.service.ts`
  → `apps/api/src/features/health/{health-probe-rest,health-canary.service}.ts`
  (581 + 126). These did NOT go to a feature package on purpose: every probe
  sends a canary back through this deployment's own public boundary and reads
  what came out the other side, so what they describe is the PROCESS, not a
  feature. That is also why the family is absent where no public origin is
  declared — five endpoints answering 500 to an alerting rule is worse than a
  404 a monitor notices.
- `routes/elevenlabs.ts` (302) → `elevenlabs-webhook.api.ts` (333), unmounted.
- **`POST /api/experiment/init` and its rule.** The handler moved to
  `experiment-init.api.ts` (256) and `findOrCreateExperiment` — the last
  production code in `platform/app/src/pages/api/experiment/init.ts`, now
  DELETED — became `ExperimentFindOrCreateService` (126) in
  `@langwatch/experiment-server`. That is the whole unblock: wave 3c left the
  batch result log unmounted because the rule "lives in
  `platform/app/src/pages/api/experiment/init.ts` … it joins the moment that
  rule has a home a server package can import". It has one.
- `routes/_lib/internal-secret.ts` and its suite DELETED: the cron, gateway
  internal and ingest routes were its only three consumers and all three are
  gone.
- Nine platform route suites went with the routes they drove
  (`experiments-results-archived`, `experiments-route-auth`,
  `playground-proxy.integration`, `scenario-generate.unit`,
  `cron-seed-demo.unit`, `files/permissionDenial.unit`,
  `scenario-events/delete-scenario-events.unit`, `_lib/internal-secret.unit`,
  and `inventoryBouncerExemption.unit`). Every one mocked a platform module
  path, so none survives a move that turns those reaches into ports; the
  families are covered instead by the five suites below, which drive the REAL
  Hono apps.

### What the API process grew

- **`composeApiAuthoringRest` — the four doors a person reaches while authoring
  something, composed as one.** The Studio's completion and run dispatch, the
  playground, the dataset row generator and the scenario author-assist share
  one fact: every one is `handlerManagedAuth({ credential: "session" })` and
  answers a bare `{ error }` the browser reads. A process with no
  browser-session transport mounts NONE of them rather than four doors that
  refuse everybody, and each door's own second condition (a model gateway, the
  workflow application, the execution proxy's address) is named in the log at
  boot by `LoggedApiAuthoringRestAbsence`.
- **`composeApiExperimentFindOrCreate` — ONE construction, two doors.** The
  create-or-take call and the batch result log are handed the same
  `ExperimentFindOrCreateService` instance. An SDK whose `experiment_slug`
  resolved one way through `/api/experiment/init` and another way through
  `/api/evaluations/batch/log_results` would silently write its results against
  a second experiment, and nothing downstream could tell the two apart. The
  integration suite drives both doors with one slug and asserts exactly one
  creation.
- **`ApiExperimentRunOptions` / `composeApiExperimentRun`** (landed in
  `9d55b657d3`) is what the workbench's four run doors bind to, and its absence
  is answered INSIDE the family: a deployment with no progress store gets a 503
  naming the capability on those four while the four workbench doors keep
  reading and writing a saved setup. Mounting nothing would have taken the
  saved setup away from a deployment that can serve it perfectly well.

### Named absences

- ~~**`POST /api/elevenlabs/webhook/:modelProviderId` is moved but NOT
  mounted.**~~ **CLOSED** by "The evaluator runtime, and the three doors that
  were waiting on it" below. The webhook settles a brokered voice session
  through the same `GatewayRealtimeSessionCollaborators` bag the gateway's own
  `book-session` route uses, and that bag was constructed PRIVATELY inside
  `composeApiGatewayInternalRest`. It is now built by an exported
  `composeApiGatewayRealtimeSessions` in the same module, which both doors
  call, so the booking and the settlement still hold one connection, one rating
  seam and one confirmation.
- **`GET|POST /api/cron/*` is DELETED, not moved.** Two routes, two different
  reasons. `old_lambdas_cleanup` called `src/tasks/cleanupOldLambdas.ts`, which
  the task lane already deleted as unreached — no chart, workflow, Makefile
  target or dev script named it — so the route had nothing left to call.
  `seed_demo` runs `scripts/dogfood/governance/seed-demo`, a tree with no exit
  owner, and it already has a CLI entry that is the SAME code path
  (`pnpm tsx scripts/dogfood/governance/seed-demo.ts --execute`). **Action for
  whoever owns the SaaS chart:** the langwatch-saas Kubernetes CronJob that
  curls this route with `CRON_API_KEY` must be repointed at that CLI or
  retired; nothing else calls either route.
- **`POST /api/dspy/log_steps` stays in `misc.ts`.** Its LLM-call enrichment
  reads the deployment's per-project MODEL-COST catalogue through
  `getLLMModelCosts` and `matchModelCostWithFallbacks`, and both platform
  modules are already deleted by the model-provider and trace lanes. The
  packaged replacements in `@langwatch/model-provider-contract` are
  `matchModelCost`/`estimateCost` — the arithmetic without the per-project
  custom-cost read — and `ModelCostCatalogService` is not composed on this
  process. A DSPy step recorded with every `cost` null is a step an optimizer
  dashboard renders as a free run, which is a wrong fact rather than a missing
  one. It moves with whoever composes the cost catalogue here.
- **`POST /api/analytics` (the legacy timeseries path) stays.** It is the
  analytics family's SECOND path, and its refusals are not that family's: it
  answers `{ error: <rendered zod sentence> }` at 400 and converts a
  `TRPCError` BAD_REQUEST into `{ code, message }`, where the mounted
  `/api/analytics/timeseries` answers the family's own. Registering it as an
  alias would change a wire two doors currently answer differently, so it
  belongs with whoever owns `createAnalyticsRestApp` rather than with a route
  file's last tenant.
- **The plan's experiment LIMIT is not enforced on `/api/experiment/init`.**
  The route this replaces caught the licence layer's `LimitExceededError` and
  re-rendered its sentence from the organization's own allowance before
  answering 403. `apps/api` composes no licence enforcement, so nothing on this
  path raises it and the branch is unreachable today. It is transcribed anyway,
  matched on the handled CODE, so the flat body an SDK's limit handling reads
  (`{error, message, limitType, current, max}`) is already correct the moment
  enforcement composes here — what it does not do is the message enrichment,
  which needs the licence layer's own builder.
- **`routes/ops.ts` stays put, by the ruling already recorded.**
  `POST /api/ops/clickhouse/explain` is cross-tenant BY DESIGN and wants the
  separate `CLICKHOUSE_OPS_URL` readonly identity;
  `ApiClickHouseInfrastructure` hands out only a tenant-keyed `resolveClient`
  precisely so a caller cannot read one organization's data on another's
  endpoint. Widening that seam is a decision about the safety property, not a
  move.
- **`app/api/{agent-cache,agents,copilotkit,dataset,middleware,shared,simulation-runs}`
  stay.** Every one of them is a PORT the platform router still passes into
  `createAppRestFeatures`, and that call is still there. They are unreachable
  the moment the packaged families are mounted from `apps/api`, and not one
  moment before.

### Judgment calls recorded

- **The slug rule is transcribed into `@langwatch/experiment-server`, not
  imported.** `~/utils/slugify` pre-replaces `:`, `?`, `&` and `_` with `-`
  before slugify runs and defaults the options to
  `{ lower: true, strict: true, replacement: "-" }`. Both halves are
  load-bearing — without the pre-replacement `my_batch_run` slugs to
  `mybatchrun`, a different URL for the same name — and the only two surviving
  copies of that module are BROWSER modules (`@langwatch/workflow-web`,
  `@langwatch/trace-web`), which a server package may not value-import. The
  four characters and the three options are pinned by literal in the service's
  own test, which is the precedent `EvaluationNameAutoslugService` set for
  exactly this reason. Wave 3c named this as the blocker ("a third copy of the
  deployment's `slugify`"); a copy pinned by test in the package that owns the
  rule is what makes it one rule again rather than three.
- **`/api/experiment/init` gets its own mount rather than joining the
  workbench's.** They share the `/api/experiment*` prefix but not the
  credential class: the workbench doors take the RICH credential (a run link is
  built from the project's slug, a workbench write is attributed to the person
  the key was minted for), and this one is an SDK's project key wanting an id
  and a slug. Two mounts, one service.
- **The health probes narrow the credential AFTER resolving it.** The probe key
  resolves through the process's ONE API-key service — so there is one answer
  to "whose key is this" — and is then narrowed to the deprecated project key,
  which is the only class these routes have ever accepted. Reading the column
  directly would have been a second resolution; skipping the narrowing would
  have widened the door.
- **The Studio's two doors travel together and the playground does not.** The
  completion and the run dispatch are one Hono app on one base path, so a
  process holding a gateway but no workflow application would publish half of
  it. The playground is its own app with its own second condition (the
  execution proxy's address), and it is absent on its own: a playground with no
  proxy to dial fails AFTER the customer has been shown a streaming response,
  which is the one failure they cannot tell from a bad answer.
- **`slugify` and `@langwatch/config` were added to
  `@langwatch/experiment-server`.** The first for the rule above; the second
  for `zodErrorMessage`, which is what the moved route answered its 400 with —
  not `fromZodError`, which is what the retired Next.js twin used. The two
  render differently and the sentence is the wire.
- **The batch log's three collaborators travel together.** The find-or-create
  service, the run-history writer and the verdict command are ONE write: the
  rows are addressed by the experiment the first resolved and scored by the
  command the third sends. A door holding two of the three would answer 200 to
  results that land nowhere a customer can read them back.

### Coverage

Five suites drive the real Hono apps over fakes at every port (54 tests):

- `app-rest/__tests__/api-rest.authoring-families.integration.test.ts` (11) —
  the run dispatch preparing an event through the workflow application and
  streaming the engine's events, the 410 `optimize_disabled` refusal reached
  without the engine, the 403 before the application is read, the completion
  door's 400 with no model resolved and its 401 in the family's own body, the
  dataset generator resolving its feature key, the scenario assist's 400 before
  the permission probe and its fast 504 envelope, the playground refusing a
  provider the project switched off rather than streaming from another, and —
  the one that pins the composition — a process with no session transport
  serving NONE of the four rather than four that refuse everybody.
- `features/experiment/__tests__/experiment-v3-rest.integration.test.ts` (10).
- `features/experiment/__tests__/experiment-init-rest.integration.test.ts` (5)
  — the create with the app path built from the project's slug, ONE experiment
  across the init door and the batch log driven with one slug, the validation
  sentence with nothing read, the bare `{message}` on a body that is not JSON,
  and the ceiling refusal answered as sent.
- `features/workflow/__tests__/workflow-run-rest.integration.test.ts` (14) —
  all three URLs through one handler, and the three named refusals keeping
  their own codes rather than collapsing into one.
- `features/health/__tests__/health-probe-rest.integration.test.ts` (6) +
  `health-canary.service.unit.test.ts` (8) — the accepted header spellings
  named before anything resolves, an invalid token told apart from a missing
  one, an absent trigger told apart from one that has simply not fired, and a
  deployment with no public origin serving no probes at all.
- `packages/features/experiment/server/src/services/__tests__/experiment-find-or-create.service.unit.test.ts`
  (5) — the four pre-replaced characters, the existing slug TAKEN BACK rather
  than duplicated, an id-only request served, neither identifier refused, and a
  rename preserving the slug already in the customer's URLs.

### Gates

- `apps/api` `tsc --noEmit`: CLEAN.
  `tsc --noEmit -p tsconfig.test.json`: 4 errors in 2 files, none in this
  lane's — 3 in `app-trpc/__tests__/app-trpc.features.unit.test.ts` (the tRPC
  lane's namespace list) and 1 in
  `app/__tests__/api-gateway-internal-rest.integration.test.ts` (the gateway
  lane's in-flight realtime-session work).
- `apps/api` vitest over this lane's paths: 8 files / 54 tests, all green.
  Whole suite: 88 files / 765 tests, 762 pass; the 3 failures are two other
  lanes' — 1 in `api-trpc-collaborators.org-group.integration.test.ts` (a tRPC
  error-formatter change swallowing a refusal sentence) and 2 in
  `api.config.unit.test.ts` (the auth lane's new `browserSession` leaf). None
  is an assertion in a file this lane touched.
- `@langwatch/experiment-server`: `tsc` clean; 5,248 tests pass.
  `@langwatch/evaluation-server`: `tsc` clean; 214 pass.
  `@langwatch/workflow-server` 57, `@langwatch/dataset-server` 117,
  `@langwatch/model-provider-server` 176 — all green and `tsc` clean.
  `@langwatch/scenario-server` 823 pass with the two Redis-dependent files
  failing to load, which is the recorded baseline.
- `git diff --numstat -- platform/app`: **0 insertions** on every row.
- `api-router.ts` stands at 251 lines, down from 408 at `3aedccbb74`. Thirty-two
  of the fall are this lane's: eleven import lines (cron, dataset-generate,
  elevenlabs, health-checks, playground, scenario-generate, workflows, and the
  four-line statement that took experiments-v3 and its alias together), the
  nine `api.route` lines those mounted, and the twelve-line comment explaining
  why the v3 family had to be registered before the packaged experiments one —
  an ordering the process's own feature array now states in code. The rest of
  the fall is the five concurrent lanes', removed from the same file in the
  same working tree. What remains mounted from platform is
  `createAppRestFeatures`, `miscApp` and `opsApp`, so the file STAYS: it is
  three mounts from deletable and not one of the three is this lane's.

### Not moved this slice, and why

`misc.ts` keeps nine routes across five unrelated verticals — the legacy
analytics path, the demo hotel bot, the DSPy step log, the MCP OAuth authorize
step, the two tracked-event doors, the Slack trigger, the Stripe webhook and
the image proxy. Each waits on a different owner, and three of them
(`track_event`, `track_usage`, `webhooks/stripe`) reach `server/app-layer/**`,
which no lane in this wave may touch. `ops.ts` stays by the recorded ruling.
The seven surviving `app/api/**` directories are ports of the platform
`createAppRestFeatures` call and are unreachable only once that call is.

## The tenant-data verticals: privacy, retention, Azure and the invitation half, 2026-09-03

The last twelve `platform/app/src/server` subtrees this migration held for the
data a tenant OWNS rather than the product it runs: `data-privacy`,
`data-retention`, `stored-objects`, `invites`, `organizations`, `api-key`,
`auth`, `scopes`, `agents`, `webhooks`, `evaluations` and `langevals`. Eight of
the twelve were already empty when this lane resumed — earlier slices had moved
the code and this lane found only the deletions and the tests still to place.
Two absences that earlier lanes recorded by name are CLOSED here rather than
carried: the invitation service and the Azure Blob driver.

`platform/app/src/server` no longer holds any of the twelve.

### Subtree → package

| Subtree | Went to | Lines |
| --- | --- | --- |
| `data-privacy/**` (8 modules, 6 tests) | twins already stood in `@langwatch/data-privacy-contract` and `@langwatch/data-privacy-server`; 4 tests moved beside them, the rest deleted | 735 moved |
| `stored-objects/azure-*` (3 modules, 5 tests) | `@langwatch/stored-object-server` `adapters/azure-blob{,-credentials,-token-provider}` + 4 tests | 2,937 |
| `tasks/migrate-object-storage.*` + `objectStorageMigration` + `groupQueueMigrationAudit` (5 modules, 2 tests) | `apps/worker/src/tasks/migrate-object-storage.*` | 1,838 |
| `langevals/stagedFetch.ts` | `@langwatch/topic-server` `adapters/langevals-staged-payload.adapter.ts` + a new staging port | 287 |
| `data-retention/retentionPolicy.schema*` (1 module, 2 tests) | twin already in `@langwatch/data-retention-contract`; the schema suite moved beside it | 209 moved |
| `evaluations/__tests__/**` (3 tests) | `@langwatch/evaluator-contract` (2) and `@langwatch/evaluation-server` (1) | 522 |
| `stored-objects/__tests__/coerce-content-to-array` | `@langwatch/trace-server` `services/__tests__` | 136 |
| `invites`, `organizations`, `api-key`, `auth`, `scopes`, `agents`, `webhooks` | already moved by earlier slices; nothing left to place | — |

### The invitation absence, closed

Recorded by the org-group tRPC lane and again by the organization REST mount:
`InviteService` reached the licence-enforcement counts, the plan provider, the
role service and the mailer, so eleven tRPC ports and three REST routes refused
with `service_unavailable`. All four reaches have moved, and each arrived as
something `apps/api` already holds:

- the seat census is `PrismaUsageMembershipRepository` from
  `@langwatch/entitlement-server` — the SAME reading the usage panel shows, so
  a seat refused on an invitation and a seat counted on the usage card cannot
  be two numbers;
- the plan is the one every allowance banner reads;
- the roles are `this.composedProductGroup.roles`, the service `role.*` and
  `roleBinding.*` mount, which is why that field was exposed beside the
  application in the first place;
- the grant ledger is `this.composedAuthz.grants`.

`composeApiOrganizationInvites` now returns `{ trpc, rest, buildInviteAcceptUrl }`
and `ApiProductionComposition` composes it ONCE, right after the product-group
half opens, holding it on `composedOrganizationInvites`. The tRPC half takes
`.trpc`; the management REST family takes `.rest` and the link builder. One
service behind both doors is the point: a provisioning tool that creates an
invitation over REST and an administrator who lists them in the app must see
one set of invitations, with one acceptance link each and one seat census
behind them.

`ApiOrganizationInvitePort` survives as the injection seam — a host that
composes its own service still wins — and the org-group half keeps its own fold
for a host that composes that half directly.

The mail gateway stays a PORT and stays unfilled, and that is a supported state
rather than a degradation: rendering a LangWatch message is react-email, which
`frontend-boundary.unit.test.ts` exists to keep off a backend graph. An
invitation is written either way, it carries its accept URL in the listing, and
the caller is told `emailNotSent` so the screen can show the link to copy —
byte for byte what the platform application did on a deployment with no
`SENDGRID_API_KEY`.

### The Azure Blob absence, closed

Recorded by the product-infra lane: no Azure driver was registered, so a
deployment whose objects live in Azure got the registry's refusal by scheme.
The driver, the credential resolver and the token cache now live in
`@langwatch/stored-object-server/adapters`, and
`api-trpc-collaborators.product-infra.composition.ts` registers the driver as
the registry's lazy `azure-blob` FACTORY. An install that never reads an
`azure-blob://` URI never resolves credentials, so a deployment with no Azure
block is not made to fail at boot over a backend it does not use; the
resolver's `purpose: "read"` arm is what lets an operator who migrated OFF
Azure keep reading what was written before. `LoggedApiProductInfraAbsence` lost
its `azure-blob` arm.

Three env reads were moved to the composition root at the seam, because a
feature package reads no environment:

- `resolveAzureCredentials` took `env.AZURE_BLOB_*` and
  `env.STORED_OBJECTS_BACKEND`; it now takes an `AzureBlobCredentialsConfig`
  record, and `api.config.ts` reads the seven variables plus the three the AKS
  azure-workload-identity webhook injects.
- the plaintext-endpoint escape hatch read
  `process.env.AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS` and
  `NODE_ENV` from inside the guard; the composition root now resolves it to a
  boolean, and it is `false` in production by construction rather than by a
  check the guard could be called without.
- the token provider read `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and
  `AZURE_FEDERATED_TOKEN_FILE` off process globals. They now travel ON the
  credential, which is exactly what the module's own #6088 caveat asked for:
  the cache key varies with the identity, so two identities can no longer share
  one cached bearer token. `mode` is still not part of the key, and no
  composition resolves two modes against one identity.

### Named absences and recorded losses

**The Redis-shared data-privacy cache, and its version gate.** The platform
`DataPrivacyPolicyCache` was a Redis `TtlCache` shared by every pod across a
rolling deploy, with a `reviveCached` gate that defaulted collections a blob
written by an older pod could be missing — the read-back that dropped span
processing in production on 2026-07-31. `@langwatch/data-privacy-server`'s
cache is a per-process in-memory `Map` with a TTL, already wired into two
services. On that design the hazard cannot occur — a value is written and read
by one process version — so the four cases guarding it have no subject and the
suite was deleted rather than rewritten against a cache that cannot fail that
way. **The loss is throughput, not correctness:** with N ingestion pods the
PROJECT → DEPARTMENT → TEAM → ORGANIZATION cascade is now walked N times per
TTL window instead of once. Nobody has measured that.

**The `LANGWATCH_DEFAULT_RETENTION_DAYS` production refusal.** The platform
resolver refused the variable outright outside development and test — "lowering
it would silently expire customer data" — and refused a value that was not a
whole number of weeks or that would wrap the `UInt16` retention column. The
contract now reads no environment and exposes
`platformDefaultRetentionDaysSchema` for a boot-time reader to validate
against; `apps/worker`'s reader deliberately does the opposite on a bad value
("unparseable is the default rather than a refusal … a typo must not stop the
fleet folding"). **No process refuses the variable in production any more.**
Four of the eight platform cases were rebound to the schema (whole weeks, the
ceiling, zero and negative); the production refusal and the
unrecognized-environment refusal are gone and have no owner.

**The staged-payload upload, as a port.** `stagedFetch` reached
`~/server/s3/stagePayload`, which a sibling lane deleted from `platform/app`
with no packaged twin. The moved adapter takes `LangevalsPayloadStagingPort`
instead, and no process composes one yet: a deployment that configures
`LANGEVALS_STAGING_THRESHOLD_BYTES` and composes no staging now gets
`LangevalsPayloadStagingUnavailableError` naming the gap rather than posting a
payload the Lambda would reject with a 413. Below the threshold — every
self-hosted install — nothing changes.

**The object-storage migration's composed entrypoint.** `execute()` read
`~/env.mjs`, `~/server/db`, `~/server/dataplane-s3` and
`~/server/outboundProxy`. Three have equivalents `apps/worker` already
composes; the fourth does not — the migration's inventory reads live
stored-object rows out of ClickHouse through `StoredObjectsRepository`, and the
worker composes no stored-object ClickHouse connection. Only the API does. The
runner is absent and the reason is on the module, in the same shape
`backfill-dataset-content-to-object-storage.task.ts` already uses; everything
below it takes its collaborators as parameters, so a runner is a few lines the
moment a repository is composable there. Defaulting it would have been worse
than absent: an inventory over a connection that resolved the wrong tenant
would report a project's objects as already migrated and let `finalize` flip a
cutover over rows it never copied.

**The `platform/app/package.json` zod-generation guard.** The first block of
`zod-source-of-truth.unit.test.ts` asserted that `start:prepare:files` no longer
runs `types:zod:generate`, that `ts-to-zod` is in neither dependency list, and
that two config files are absent — all of `platform/app`, which is being
deleted. It was dropped; the other six blocks moved whole into
`@langwatch/evaluator-contract`.

### Judgment calls

- **`applyOtlpSpanContentDrop.unit.test.ts` deleted rather than moved.** The
  packaged `otlp-span-content-drop.service.unit.test.ts` is a rewrite covering
  14 cases against the platform file's 9, and every behaviour class in the 9
  appears in the 14. Two platform cases name attributes the packaged file
  covers by category rather than by key (`gen_ai.prompt`, the tool-call
  argument keys); that specificity is not preserved.
- **`dropKeyCatalog`'s four free functions became four methods.** The packaged
  subject is `ContentDropPolicyService`, so the moved suite calls
  `service.droppedKeys(...)` where it called `computeDroppedKeys(...)`. The
  assertions are unchanged.
- **The rich `resolveDataPrivacy` suite landed beside the thin one** as
  `data-privacy.resolution.cascade.unit.test.ts` rather than replacing
  `data-privacy.resolution.unit.test.ts`. The 51-line file is another slice's
  and deleting it is not this lane's call; the 335-line one is a strict
  superset and both pass.
- **The Azure helm guards went to `@langwatch/stored-object-server`**, not to
  `charts/`, following the precedent
  `packages/features/auth/server/.../helm-auth-base-url.unit.test.ts` already
  set. Their repo-root resolution was changed from counting `..` off
  `process.cwd()` to walking up for `charts/langwatch` — the count was correct
  for exactly one package directory. Two source-reading guards inside them were
  repointed at the moved files (`stored-objects.service.ts` →
  `packages/features/stored-object/server/src/services/`, migration 00023 →
  `apps/api/src/tasks/clickhouse-migrate/migrations/`); left alone they would
  have thrown ENOENT and taken the whole suite with them.
- **`groupQueueMigrationAudit.ts` travelled with the migration** even though
  the leftovers-B split names `tasks/` generally. Its only consumer is
  `migrate-object-storage.redis.adapter.ts`; leaving it behind would have left
  a moved module importing a platform file.
- **`stagedLangevalsFetch`, the free env-reading entrypoint, was dropped.**
  Nothing imported it — every caller went through
  `LangevalsStagedPayloadClient`, which already took its configuration as a
  value.
- **`safeUrlHost` was inlined** into the moved adapter. It was three lines in
  the `server/s3` module a sibling lane deleted, and it is what keeps a
  presigned URL's signature out of the log line.
- **`AzureBlobDriver.signedFetch`'s `body` is `Uint8Array<ArrayBuffer>`, not
  `BodyInit`.** A process compiled without the DOM lib has no name for
  `BodyInit`, and `ArrayBufferLike` admits a `SharedArrayBuffer` that `fetch`
  refuses. Every caller passes exactly this shape.

### Coverage

- `packages/features/data-privacy/contract/src/__tests__/data-privacy.{visibility,config-schema,resolution.cascade}.unit.test.ts`
  — the audience check a `restrict` category is read through, the config
  schema's entity and level rules, and the whole
  PROJECT → DEPARTMENT → TEAM → ORGANIZATION cascade including the
  personal-project narrowing and the PII exception-pattern union.
- `packages/features/data-privacy/server/src/services/__tests__/content-drop-policy.service.unit.test.ts`
  — which keys a `drop` category covers, which custom patterns compile, and the
  wildcard strip reporting the keys it removed.
- `packages/features/stored-object/server/src/adapters/__tests__/azure-blob-token-provider.unit.test.ts`
  (13) — rewritten so the identity varies by CREDENTIAL rather than by an
  environment variable, which is what now proves two identities never share a
  cached token.
- `apps/api/src/app/__tests__/api-trpc-collaborators.product-infra.integration.test.ts`
  (+2) — an `azure-blob://` object probed end to end with `fetch` stubbed: the
  request goes to the configured account endpoint, as a `HEAD`, under a
  `SharedKey` signature, and the probe answers `available`. And the same object
  on a deployment with no Azure block refusing rather than reporting the file
  missing — the two answers lead an operator to opposite actions.
- `apps/api/src/app/__tests__/api-trpc-collaborators.org-group.integration.test.ts`
  (+2) — with the grant ledger and role service composed, the pending-invite
  read answers FROM THE ROW rather than merely stopping refusing, and the
  acceptance link is built on this deployment's own origin.
- `apps/api/src/app-rest/__tests__/api-rest.product-families.integration.test.ts`
  (+1) — `GET /api/organization/latest/invites` reaching the injected service
  and returning what it holds. The refusal case beside it is unchanged.

### Gates

- `apps/api` `tsc --noEmit`: CLEAN.
- Package `tsc --noEmit`: clean for `@langwatch/data-privacy-{contract,server}`,
  `@langwatch/data-retention-contract`, `@langwatch/stored-object-server`,
  `@langwatch/topic-server`, `@langwatch/evaluator-contract`,
  `@langwatch/organization-server`, `@langwatch/evaluation-server`,
  `@langwatch/worker`.
- Package vitest: data-privacy contract 49, data-privacy server 136,
  data-retention contract 31, stored-object server 124, topic server 158,
  evaluator contract 19, organization server 185, worker `src/tasks` 17,
  `@langwatch/evaluation-server` helm suite 21,
  `@langwatch/trace-server` content-array 18 — all green.
- `@langwatch/trace-server` `tsc` reports 4 errors, all in two untracked files
  under `transport/api-trpc/__tests__/trace-read-mappers.*` that belong to the
  trace REST lane; none is in a file this lane touched.
- `apps/api` vitest, whole suite: 88 files / 770 tests, 767 pass. The one
  failure is another lane's — the topic-clustering refusal case in
  `api-trpc-collaborators.org-group.integration.test.ts`, which now reads "An
  unknown error occurred" because `api.application.ts` was rewired to the
  untracked `app-trpc/app-trpc.error-formatter.ts`. No assertion in a file this
  lane touched fails.
- `git diff --numstat -- platform/app`: **0 insertions** on every row, 166 rows.
- `platform/app/src/server` no longer contains `data-privacy/`,
  `data-retention/`, `stored-objects/`, `invites/`, `organizations/`,
  `api-key/`, `auth/`, `scopes/`, `agents/`, `webhooks/`, `evaluations/` or
  `langevals/`.


## The tRPC infrastructure remainder, the loose server files and the task tail, 2026-09-03

The lane that closes `server/api/**`, the sixteen loose `server/*.ts` files, the
twelve small `server/<dir>/` buckets, the four surviving `src/tasks` entries and
what the census left of `src/{pages,types,factories,stores,prompts,shared,styles}`.

**`server/api/**` is gone.** Two files were left when the lane resumed. The
`gatewayBudgets.principal-cascade` integration suite — five PRINCIPAL-scope
budget cases against real Postgres — became
`packages/features/gateway/server/src/services/__tests__/gateway-budget.principal-cascade.integration.test.ts`,
composed the way the package's own Postgres suites compose (`PrismaConnectionService`
over a `DATABASE_URL`, `describe.skipIf` when there is none) and built through
`PrismaGatewayAdapter` rather than the `GatewayService.create(prisma)` signature
the platform copy still called, which four collaborators ago stopped existing.
Its one live Project read needed `TestProjectService.tryGetWithTeam` to carry the
contract's parameter; the fake declared it with none, so an override could not
answer it. `openapi-response-required.ts` stays, because it is
`generateOpenAPISpec`'s private helper and that file cannot move yet (below).

**The loose files, by what they turned out to be.**

| File | Outcome |
| --- | --- |
| `server/dataplane-s3.ts` (+ its 250-line suite) | **twin, deleted.** Both applications already parse `DATAPLANE_S3__*` themselves, and both parsed it by hand. `parseDataplaneS3RoutingTable` is now `@langwatch/config`'s, with the env-parsing half of the platform suite rewritten against an explicit source; `api.config.ts` and `worker.config.ts` each call it. |
| `server/storage.ts` | **twin, deleted.** `StorageService` had no importer left, `createS3Client` only `server/s3`, and `resolveS3ClientTarget` only `runtime/app/**`. Both applications compose the packaged `StoredObjectStorageRuntime`/`StoredObjectProjectS3ConfigPort` graph for the same job. |
| `server/static-handler.ts`, `server/asset-base.ts` (+ both suites) | **moved to `apps/api/src/app-static/`.** The chart expects the app image to serve the SPA: `app.assetBase` defaults to `""`, documented as "serves them same-origin straight from the pod", and renders `LANGWATCH_ASSET_BASE` only when set. Deleting them would have deleted the self-host serving path. 42 tests green in their new home. |
| `server/dbSlowQueryWarning.ts` (+ suite) | **moved to `@langwatch/prisma-client`** as `slow-query-warning.ts`. The package forbids ambient environment reads (`import-side-effects.test.ts` reads its own sources), so `resolveSlowQueryBudgetMs` now takes the bag and `reportQueryDuration` defaults to the package constant — a composition root resolves `POSTGRES_SLOW_QUERY_MS` and hands the budget down. |
| `server/auth.ts` | **twin, deleted.** `apps/api/src/app/api-auth.composition.ts` and `api-handler-managed-session.ts` already resolve a verified Better Auth session through `auth.tryResolveBrowserSession`, which is the whole of what `getServerAuthSession` did. |
| `server/rateLimit.ts` | **twin, deleted.** `apps/api/src/platform/infrastructure/api-rate-limit.infrastructure.ts` is the same fixed-window counter — same Redis `incr`/`expire`/`ttl`, same in-memory fallback with the same sweep — without the inline `import()` of the app global. |
| `server/metrics.ts` | **left whole, and this is the lane's largest recorded absence.** See below. |

**`server/metrics.ts` cannot be distributed yet.** Of the 76 series it declares,
49 already have owners — the whole `es_*` family is `@langwatch/eventing`'s
`metrics.ts`, and the stored-object, authz, job and Langy families are declared
in feature packages. The other 27 (`automation_*` ×5, `evaluation_*` ×2,
`ingestion_pull_*`, `topic_clustering_page_*`, `process_manager_retention_*`,
`langwatch_edge_*`, `langwatch_langy_{blocks,dispatch,rate_limit,turns}_total`,
`payload_size_bytes`, `event_loop_lag_milliseconds`, `worker_restarts`,
`coding_agent_session_list_read_duration_milliseconds`, `job_processing_duration_milliseconds`)
have no owner — and every site that increments them is inside `runtime/**` or
`server/app-layer/**`, which no lane may touch and which the migration has not
moved. Moving the declarations alone would publish series nothing writes, which
is worse than leaving them: a dashboard panel that is flat because the metric is
inert reads exactly like a system that is idle. `worker_restarts` is already in
that state — nothing outside the file increments it.

**The twelve small buckets.**

- **`server/shutdown/**` (7 files) — twin, deleted.** Both applications own their
  own drain (`api-process.lifecycle.ts`, `worker.executable.ts`), and
  `shutdown/telemetry.ts`'s flush registry is `ProcessObservabilityOptions.flushers`.
- **`server/websockets/**` (4 files) — dead, deleted.** It binds `appRouter` and
  `createTRPCContext` from `server/api/`, both gone. **Named absence:** no
  process serves `/api/trpc-ws`; `apps/api` serves subscriptions over
  `GET /api/sse/*` on the same root instead, and `apps/ui/vite.config.ts` still
  proxies the dead path.
- **`server/context/**` (4 files) — twin, deleted.** A banned compatibility
  re-export of `@langwatch/observability/context` plus two three-line context
  builders that `packages/api`'s `rest/middleware.ts` and
  `trpc/trpc-runtime-policy.ts` already do for themselves.
- **`server/s3/**` (2 files) — deleted.** Reached only from
  `server/langevals/stagedFetch.ts`, itself reached only from
  `runtime/app/features/topic.ts`. **Named absence:** `langevals` and
  `services/nlpgo/adapters/httpapi/staged_payload.go` still accept
  `X-Payload-S3-URL`, and no TypeScript process composed by `apps/api` or
  `apps/worker` produces one any more — the last writer was the Lambda-invoke
  path in platform's dead preset graph.
- **`server/event-sourcing/**` (2 files) — residue, deleted.** Only two tests
  remained; their pipeline had already left in an earlier commit and exists
  nowhere in `apps/**` or `packages/**`. **Recorded coverage loss:** the
  one-price-three-consumers agreement across a model-catalog change, and the
  transient-commit rule that every message key is a pure function of its event.
- **`server/profiling/**` — moved to `@langwatch/observability/node`** as
  `profiling.ts` (+ 21 tests). `require` became `createRequire(import.meta.url)`
  because the package is ESM; the deferral is the point of the module, so an
  inline `import()` was not an option. **Named absence:** neither application
  parses a Pyroscope endpoint leaf yet, so nothing composes it as a flusher.
- **`server/ops/**` (3 files) — moved to `@langwatch/ops-server`** as
  `services/ops-clickhouse-explain.{core,service}.ts`. The service's repository
  import pointed at an `app-layer` file that no longer exists; the package
  already declares `OpsExplainClickHouseRepository` beside its resolver port, so
  the service now names that.
- **`server/analytics/**` (4 files) — split three ways.** `chartKinds.ts` →
  `@langwatch/analytics-contract` (`analytics.chart-kind.ts`), which is the one
  place above both the chart builder and the workbench. `lwqlKeyMap.repository.ts`
  and `lwql-key-map.service.ts` → `@langwatch/analytics-server` beside the
  provisioning they share a table with; the service took two arguments on the
  way — the source database (a package must not parse the deployment's
  connection string) and an `LwqlKeyMapErrorSinkPort` in place of
  `captureException`. The ClickHouse `memory-safety` suite → `@langwatch/trace-server`,
  where the source it reads now lives; it had been dead by `ENOENT` since
  `server/traces/clickhouse-trace.service.ts` moved, and one assertion named the
  old App-shaped client access (`clickhouse.resolveClient(`) rather than the
  repository's own (`this.resolveClient(`). 8 tests, alive again.
- **`server/middleware/**` (2 files) — moved to `@langwatch/langy-server`** as
  `services/langy-github-pr-quota.service.ts`. `tryGetApp()?.redis` became a
  `LangyGithubPrCounterPort` threaded through all five functions, and the suite
  dropped its module-mock-and-reload dance for the port. 12 tests green.
- **`server/repositories/organization.repository.ts` — superseded, deleted.**
  Two of its four methods are answered by the packaged organization service and
  `ProjectService.listIdsByOrganization`; the other two are the Stripe reads the
  identity slice already recorded as deliberately dropped.
- **`server/schemas/sign-up-data.schema.ts` — deleted.** Its `ATTRIBUTION_FIELDS`
  source is now `@langwatch/onboarding-web`, the payload is already declared as
  `SignupData` in `@langwatch/enterprise-billing-contract`, and nothing in
  `apps/**` or `packages/**` parses through the zod copy.
- **`server/health-probes/**` — already empty when the lane resumed.**

**The task tail.** `migrateCustomModels` and `migrateModelProviderKeys` split
the way the grammar wants: both row conversions became
`@langwatch/model-provider-server`'s `services/model-provider-legacy-migration.service.ts`
(pure, with the credential half taking the existing `ModelProviderCredentialCipherPort`
rather than platform's `encrypt`, because the ciphertext is a wire format), and
the walk over the table became `apps/api/src/tasks/model-provider-migrate/`
behind `task:model-provider-migrate <custom-models|credentials>`. 13 tests moved
with the conversions. `provisionLwql` moved whole to
`apps/api/src/tasks/lwql-provision/` behind `task:lwql-provision`: the eleven
`productionProvisioning`/`provisioning` symbols it needed are now exported from
`@langwatch/analytics-server`'s barrel, `LWQL_KEY_MAP_INSERT_SETTINGS` came with
the key-map repository, `parseConnectionUrl` was already in the same app's
ClickHouse migrate task, and the global `prisma` became an injected
`LwqlProvisioningDatabase` naming exactly the two operations it performs.

**`generateOpenAPISpec.ts` still cannot move, and the reason changed.** Twelve
of its fifteen inputs have left `platform/app` — SCIM routes, the RBAC
vocabulary, `appRestSecurity`, the analytics REST app, the analytics-SQL app,
the current spec JSON, the organization REST app, `tracesMapping`, the
evaluations-legacy and experiments-v3 apps, the prompts REST app and the traces
app. Three have not: `app/api/middleware/enterprise-gate`, `server/routes/misc`
and `runtime/app/features/secret`, each in another lane's hands or off-limits.
Moving the generator now would add fifteen import rewrites of which three cannot
resolve, reddening `apps/api`'s typecheck for every concurrent lane. It moves
when those three land. `src/runtime/task/legacy-platform-task.executor.ts`,
`scripts/run-task.sh` and `scripts/generate-task-registry.mjs` therefore survive
for exactly one task. `src/tasks.generated.ts` is stale (it still lists eight
deleted modules) and stays stale, because regenerating it is an insertion into a
deletes-only tree and `start:prepare:files` rewrites it anyway.

**What the census left of `src/`.** `factories/project.factory.ts` deleted (its
only consumer is a `runtime/app/features/__tests__` file).
`pages/[project]/__tests__/evaluations.lite-member.integration.test.tsx` deleted —
it lazily imports a page that is gone and mocks fifteen `~/components/**` and
`~/hooks/**` modules from a directory the census emptied. **Recorded coverage
loss:** the lite-member permission visibility on the Experiments page; `apps/ui`
owns that surface (`features/evaluations/ui/sections/evaluation-routes.tsx`) and
carries no equivalent test. `styles/{globals,markdown}.scss` moved to
`apps/ui/src/styles/`, unimported for now: two package modules
(`workflow/web`'s Crisp policy, `design-system`'s config) name `globals.scss` in
their own comments as the place a rule and the Inter import live, so deleting it
would have lost both; the import lands with `index.html` and `public/**`, which
the census assigns to the UI lane. **Left in place, with cause:**
`pages/api/collector.stress.test.ts` (collected only by `vitest.stress.config.ts`,
and it moves with the harness), `types/next-stubs.ts` (named type-only by
`server/api-router.ts`, the REST lane's file), and the nine repository-wide
guards in `src/__tests__/**` — their home under `dev/scripts` or `tools/` has no
TypeScript test runner, and root `pnpm test:unit` still resolves to
`@langwatch/web`, so moving them now would take them out of CI rather than into
it. Empty directories left by the census were removed (`prompts/`, `stores/`,
`shared/`, `server/queues/`, `runtime/ui/` and eleven more).

**Judgement calls recorded.** The worker's `DATAPLANE_S3__*` reader drops the
skipped-variable list rather than logging it, because `worker.config.ts` is a
pure projection with no logger and the API reads the same variables and names
them; `TestProjectService.tryGetWithTeam` was widened to the contract's
signature rather than bypassed with a cast; the `memory-safety` assertion was
re-pointed at `this.resolveClient(` and paired with a `createClient(` prohibition
rather than deleted, because the invariant it guards (no bare driver client
skipping the query-default policy) survived the move even though its spelling
did not; and `LwqlKeyMapService`'s error sink defaults to silence rather than
refusing, because the row is repaired by the scheduled backfill either way and a
refusal would fail project creation over a report.

**Gates.** `tsc --noEmit` clean: `@langwatch/api`, `@langwatch/config`,
`@langwatch/prisma-client`, `@langwatch/observability`,
`@langwatch/analytics-contract`, `@langwatch/analytics-server`,
`@langwatch/gateway-server`, `@langwatch/ops-server`, `@langwatch/langy-server`,
`@langwatch/model-provider-server`, `@langwatch/worker`. Vitest: api 359,
config 38, prisma-client 101, observability 188, analytics-contract 5,
analytics-server 654, gateway-server 289 (+5 skipped, the moved Postgres suite),
ops-server 341, langy-server 495, model-provider-server 189, trace-server 2344,
worker 438 — all green. `apps/api` typecheck reports three errors, all in
`app-trpc/__tests__/app-trpc.features.unit.test.ts`, a file this lane does not
touch; its suite is 769/770 with the one failure the tenant-data lane already
recorded above (the topic-clustering refusal reading "An unknown error
occurred"). `@langwatch/trace-server`'s four typecheck errors are the same two
untracked `trace-read-mappers.*` files that lane recorded. `git diff --numstat
-- platform/app`: **0 insertions** on every row.

## Bucket 4 — the platform composition root is gone, 2026-09-03

The lane that deletes what composed the platform process: `src/runtime/**`, the
seven `server/app-layer/*.ts` files every server root landed in, the process
entry points, the task lane, `src/types` and the `server/api` remainder.
**233 files, 41,072 lines**, `git diff --numstat -- platform/app` **0 insertions
on all 233 rows**. Nothing was moved — see the moves table below for why each
candidate was not.

```
  BEFORE (second census, 2026-09-02)        AFTER (this bucket)

  apps/api      apps/worker                 apps/api      apps/worker
      │              │                          │              │
      ▼              ▼                          ▼              ▼
  server/api    runtime/app/**              (their own composition roots,
  /root.ts      runtime/api/**               unchanged — nothing outside
      │              │                       platform ever imported these)
      ▼              ▼
  server/app-layer/** ◄── src/tasks/**       platform/app/src is a
  (139 files, 34,982 lines)                  server remainder:
  presets.ts alone 3,973                       server/**    27 files  5,618
      ▲                                        __tests__/    6 files    698
      └── src/instrumentation*.ts              pages/, docs/, server.mts
          src/start.ts                         (38 files, 6,813 lines, with
                                                the final REST lane's
                                                concurrent app/api/** delete)
```

### What was deleted

| Tree | Files | Lines | Why it went |
| --- | ---: | ---: | --- |
| `src/runtime/**` (`app/`, `api/`, `task/`, the eight `runtime/*.config.ts`, all four `__tests__` trees) | 207 | 31,668 | The composition root itself. Every non-test file is either `App<Feature>Runtime` glue over a global `PrismaClient` + a package service, or an adapter whose collaborator already moved. **142 of the 229** distinct `~/…` specifiers this bucket's scope imports resolve to nothing at `HEAD`: the tree had no working import graph left. |
| `server/app-layer/{app,config,dependencies,index,presets,redis-readiness,worker-eventing-handoff}.ts` | 7 | 5,361 | The 5-file knot the last two censuses named. `presets.ts` alone was 3,670. |
| `server/app-layer/identity/__tests__/sso-onboarding-refusals.unit.test.ts` | 1 | 119 | Residue — its only subject import, `~/features/errors/logic/presentation`, was already gone. |
| `src/{start,env-load,instrumentation,instrumentation.node,instrumentation.redis,task}.ts`, `src/{env,env-create}.mjs`, `src/test-unit-global-setup.ts`, `src/langwatchPlatformGuard{,.boot,.unit.test}.ts` | 12 | 2,249 | Process entry points for a process that no longer boots. `apps/api/src/api.entrypoint.ts` and `apps/worker/src/worker.entrypoint.ts` own the equivalents. |
| `src/__tests__/{alignDevAuthUrlsToPort,env-create,instrumentation.redis}.unit.test.ts` | 3 | 677 | Died with their subjects. The other six files in `src/__tests__/` are repo-level guards over the Dockerfile, `.env.example`, the langyagent shell tools, postinstall and binary source files; they stay. |
| `src/tasks/generateOpenAPISpec.ts` (+ the untracked `src/tasks.generated.ts`) | 1 | 802 | **Twelve of its sixteen** in-repo module inputs no longer existed at `HEAD` — `server/enterprise/scim/routes`, `server/analytics/analytics-rest`, `server/api/{security,prompts-rest,management/rbac-vocabulary,management/organization-rest}`, `server/tracer/tracesMapping`, `server/routes/{evaluations-legacy,experiments-v3}`, `app/api/{traces,analytics-sql}/[[...route]]/app`, `app/api/openapiLangWatch.json` — and the final REST lane has since taken `server/routes/misc` too. The generator could not have run. |
| `src/server/api/openapi-response-required.ts` | 1 | 153 | The previous lane kept it as "`generateOpenAPISpec`'s private helper"; the generator is gone, so it is. |
| `src/types/next-stubs.ts` | 1 | 43 | Type-only, and its one consumer (`server/api-router.ts`) belongs to the final REST lane, which deletes it. |

### Moves: none. Each candidate, and why

The mandate was to move any last copy of real logic before deleting. Every
candidate resolved to a twin, a superseded decision, or a composition-root
wiring job that belongs to whoever owns that root.

| Candidate | Ruling | Evidence |
| --- | --- | --- |
| `runtime/api/nlp-lambda.*` (7 files, 1,126 lines — the only AWS-Lambda NLP transport in the repository) | **deleted; the absence is already recorded in `apps/api`'s own code.** | `apps/api/src/app/api-packaged-rest.composition.ts:407` declares the family absent in so many words: *"API process serves no /api/copilotkit: the prompt-studio adapter it dispatches through reaches the retired studio post-event module, **the platform Lambda runtime** and a browser package, none of which a server composition may hold."* Its only live caller was `app/api/copilotkit/[[...route]]/service-adapter.ts`, which is the final REST lane's file. `apps/api` composes `HttpWorkflowStudioStreamAdapter` over `LANGWATCH_NLP_SERVICE` instead. |
| `runtime/trace-privacy.config.ts` | **twin.** | `apps/worker/src/platform/config/worker.config.ts` states all four inputs and the same projection, down to `DEFAULT_PRESIDIO_TIMEOUT_MS = 60_000` and `nativePolicyEnforced: … !== "off"` (lines 31, 313, 319, 759-781, 1124-1147). |
| `runtime/app/mailer.private-config.ts` | **twin.** | `worker.config.ts` states `EMAIL_PROVIDER`, `SMTP_*`, `RESEND_API_KEY`, `SENDGRID_API_KEY`, `USE_AWS_SES`, `AWS_SES_ENDPOINT`, `EMAIL_DEFAULT_FROM`; `EmailProviderService.resolveDefaultFrom` in `@langwatch/notification-server` is the sender derivation, and its docblock says so. |
| `server/metrics.ts`'s unowned series | **not moved. `server/metrics.ts` itself left in place** (it is not in this bucket's delete list). | Down to **16** unowned series (was 27): `automation_{auto_paused,ceiling_breach,containment_failed,overflow_flush}_total`, `coding_agent_session_list_read_duration_milliseconds`, `event_loop_lag_milliseconds`, `event_sourcing_{events_stored,store_duration}_*`, `job_processing_duration_milliseconds`, `langwatch_edge_{media_extract,spool}_fail_open_total`, `langwatch_langy_{blocks,dispatch,rate_limit,turns}_total`, `worker_restarts`. The previous lane's reasoning stands and this lane confirms it from the other side: every increment site was inside the tree just deleted, and the packages that own the behaviour already expose the port (`CodingAgentReadMetricsPort`, `TraceEdgeMediaStorePort.failOpen`, eventing's optional `metrics.{eventsStored,storeDuration}`, `LangySessionKeyMetricsPort`) with a Noop or no supplier at all. Moving 16 counter declarations without their callers publishes series nothing writes, and a panel that is flat because the metric is inert reads exactly like a system that is idle. **What is left is a wiring decision in `apps/api`'s and `apps/worker`'s composition roots, not a code move.** |
| `runtime/app/replay-runtime.adapter.ts` (220 lines) | **deleted; named absence.** | `packages/features/ops/server/src/ports/replay-runtime.port.ts` declares `OpsReplayRuntimePort` with exactly this shape, and **no file under `apps/**` composes it** — so no process can run a projection replay. The platform implementation could not travel: it reached `getApp()`, `~/server/data-retention/retentionPolicy.schema`, `~/server/app-layer/traces/lean-for-projection` and three sibling adapters, four of which no longer exist. |
| `src/langwatchPlatformGuard.ts` (+ `.boot.ts`) | **deleted; policy superseded, and the change is worth a second look.** | The guard refused to boot any platform process carrying `LANGWATCH_API_KEY`, because the SDK bootstrap would then ship the platform's own telemetry into its own ingest (a runaway `recordSpan` feedback loop). `apps/api` and `apps/worker` both *accept* the variable deliberately — `observability: { apiKey: Config.secret({ optional: true, env: "LANGWATCH_API_KEY" }), endpoint: Config.url({ optional: true, env: "LANGWATCH_ENDPOINT" }) }` — trading the blanket refusal for an explicit key + endpoint pair. That is a real decision, not an oversight, but nothing yet refuses the case the guard existed for: a key set with `LANGWATCH_ENDPOINT` pointing back at this deployment. |
| `runtime/app/{trace-processing,trace-record-span,trace-read-derivation,trace-summary-fold}.adapter.ts` | **twins.** | `apps/worker/src/app/worker-trace-processing-pipeline.composition.ts`, `packages/features/trace/server/src/adapters/trace-span-normalization.adapter.ts`, `packages/features/trace/server/src/services/trace-event-derivation.service.ts` (same `foldVersion` memo key, composed by `apps/worker/src/app/worker-automation-settlement-reads.composition.ts`), `packages/features/trace/server/src/stores/eventing/eventing.trace-summary.store.ts`. |
| `runtime/app/features/automation-adapters/**` (delivery + Slack provider) | **twins.** | `packages/features/automation/server/src/adapters/{webhook-delivery,slack-web-api.delivery,slack-provider}.adapter.ts` and `apps/worker/src/features/automation/{slack-webhook.client,automation-notification-delivery}.adapter.ts`. |
| `runtime/app/features/{sso,webhooks,billing,langy-virtual-key,langy-ui-action-surface,langy-session-key-metrics,audit-log,eventing-retention,stored-object-owner-instance-directory,experiment-run-history.observability,langevals.config,stripe.runtime}.ts` | **twins.** | Each name resolves into `apps/api/src/app/*.composition.ts`, `apps/worker/src/app/*.composition.ts` or the owning feature package; `billing.ts`, `langy-streaming.adapter.ts` and `langy-turn-context.adapter.ts` were bare re-export shims of package modules, which the grammar forbids anyway. |
| The remaining ~60 `runtime/app/features/*.ts` | **composition glue.** | Each is an `App<Feature>Runtime` that hands an already-composed `PrismaClient` and collaborator ports to a package adapter and calls `.build()` — the job `apps/api/src/app/api-production.composition.ts` and `apps/worker/src/app/worker-production.composition.ts` do for their own processes. `runtime/app/features/project.ts` is the archetype: 36 lines, one `PostgresProjectAdapter.create({...options, credentials: ProjectCredentialsAdapter.create()}).build()`. |
| `runtime/{config,logger,executable-bootstrap,azure-identity,evaluation-execution}.config.ts` | **superseded.** | Every variable is stated by `apps/api/src/platform/config/api.config.ts` or `apps/worker/src/platform/config/worker.config.ts`, which are each their process's only environment reader. |

### Reachability, re-checked after the deletion

- **Zero** real `~/…` imports remain anywhere under `apps/**` or `packages/**`. The seventeen matches are all fixture *strings* written to temp files by `packages/architecture-lint/tests/{global-app-access,api-transport-boundaries,application-workspace-boundaries,test-quality}.test.ts` and `packages/test-harness/src/__tests__/integration-lanes.unit.test.ts`.
- **Zero** deleted module paths are named as an import by anything under `apps/**`, `packages/**`, `dev/scripts/**`, `tools/**` or `.github/**`. Every `platform/app` occurrence in `apps/**` is prose in a docblock or a test comment.
- Two relative imports still reach into platform from `packages/features/trace/server/src/repositories/clickhouse/__tests__/{trace-summary,trace-analytics}.repository.integration.test.ts` (`…/platform/app/src/server/event-sourcing/__tests__/integration/testContainers`). Pre-existing — the census found them, and that path was already gone before this bucket.

### Gates

`git diff --numstat -- platform/app`: **0 insertions on all 233 rows**, 41,072
deletions. No file outside `platform/app` was modified by this lane.
`apps/api` typecheck: 6 errors, all pre-existing in-flight work by other lanes
(`api-production.composition.ts:3079` `options.config`, the evaluator-execution
`EvaluatorService` shape, and `@langwatch/{egress,config}` not linked into
`node_modules`); none names a platform module. `apps/worker` typecheck: 2
errors, both `Cannot find module '@langwatch/{workflow-server,config}'` — the
same unlinked-workspace-package state. `apps/worker` vitest: **367 passed**, 5
suites fail to collect on `Cannot find package '@langwatch/config'`.
`apps/api` vitest: **473 passed**, 29 suites fail to collect on
`Cannot find package '@langwatch/{config,api,model-provider-contract}'`. Those
packages are declared as workspace dependencies and are not linked — the tree
needs a `pnpm install`. **Zero lines of either app's failure output mention
`platform/app`.**

`apps/ui`'s two error-registry guards scan `platform/app/src` as one of five
roots (behind an `existsSync` filter, so the root drops out on its own when the
tree goes), which makes them the one suite outside platform a shrinking platform
tree can turn red. Run: **967 passed, 1 failed** — `src/model/errors/__tests__/codes.unit.test.ts`
reports `credential_class_mismatch` and `invalid_credentials` as codes with copy
and no raiser. **Not this bucket's doing, and proven so:** none of the 233
deleted files mentions either string at `HEAD`, and no matchable declaration for
either exists anywhere in `HEAD`. Both are raised by
`apps/api/src/api-rest.security.ts` in the one shape the scanner's docblock says
it cannot see — a union-typed `declare readonly code: "missing_credentials" |
"invalid_credentials"` (the pattern captures only the first literal) and a code
chosen by a constructor parameter at `:340`. **For the REST/security lane:**
either split them into subclasses that each declare their own literal, or add
both to `PARAMETERIZED_CODES` in that guard and accept hand-maintenance.

### Cutover checklist — every file outside `platform/app` that names it

Read, not edited: these are the cutover files. Grouped by what happens to each
at cutover; the count in brackets is how many lines in that file match
`platform/app` or `@langwatch/web`.

**Broken NOW by this bucket** (act on these first):

| File:line | The line | What broke |
| --- | --- | --- |
| `Makefile:375` | `cd platform/app && pnpm run task generateOpenAPISpec` | `src/task.ts`, `src/tasks/` and the generator are gone. The OpenAPI spec has no producer. |
| `platform/app/package.json` → `start:prepare:files` → `scripts/generate-task-registry.mjs:22` | `readdirSync(tasksDir)` over `src/tasks` | `src/tasks/` no longer exists, so the script throws `ENOENT`. This breaks `pnpm prepare:files`, `platform/app` `build`, `dev:app`, and `.github/actions/prepare-generated-files`. |
| `.github/scripts/verify-generated-files.sh:26-28` | `require_file "platform/app/src/server/evaluations/evaluators.generated.ts"` / `…/src/tasks.generated.ts` / `…/src/shared/langy/langySkills.generated.json` | Two of the three were already unreachable before this bucket (`server/evaluations/` and `src/shared/` are gone); the task registry is the third. |
| `.github/actions/prepare-generated-files/action.yml:39-41,54` | the same three paths, plus `platform/app/src/tasks/**` in the cache key | Same. Every app-CI job that calls this action fails at the prepare step. |
| `platform/app/vitest.config.ts:86` | `globalSetup: ["./src/test-unit-global-setup.ts"]` | Deleted. Root `pnpm test:unit` (which is `pnpm --filter @langwatch/web test:unit`) cannot start. `platform/app/test-setup.ts:8` has the same problem with `./src/env.mjs`. **Deliberately not edited — `vitest.config.ts` and `test-setup.ts` are the harness files the census reserved for the cutover move.** Use per-app/per-package vitest until then. |
| `.github/workflows/sdk-javascript-ci.yml:95` | `- 'platform/app/src/start.ts'` | A path filter that can never match again, so that lane silently stops triggering. Same shape at `:83,87,90` (`server/routes/**`, `server/api-router.ts`, `server/otel/**` — the last two are the final REST lane's). |
| `infra/docker/Dockerfile:204` | `CMD cd /app/platform/app && pnpm -s run prisma:migrate && cd /app/apps/api && pnpm -s run task:clickhouse-migrate && cd /app/platform/app && pnpm -s run lwql:provision && pnpm start` | `pnpm start` runs `scripts/start.sh` → `src/server.mts` → `./env-load`, `./instrumentation.node`, `./start`, all deleted. `lwql:provision` runs `pnpm run task provisionLwql`, and the task lane is gone (`apps/api` has `task:lwql-provision`). **The production image entry point no longer boots.** |

**Already broken before this bucket** (recorded so the cutover does not re-diagnose them):

| File:line | The line |
| --- | --- |
| `infra/docker/Dockerfile:59-61,64` | `COPY platform/app/src/server/{tracer,filters,evaluations}/types.ts` and `platform/app/src/app/api/openapiLangWatch.json` — all four absent. |
| `infra/docker/Dockerfile.langyagent:160-166` | The same four COPY lines. |
| `.github/workflows/go-services.yaml:50-54,129-133` | Path filters on those same five files. |
| `.github/workflows/gateway-matrix.yaml:56-58` | `platform/app/src/server/{gateway/**,routes/gateway-internal.ts}`, `platform/app/ee/governance/process-manager/gatewayDebits.process.ts`. |
| `.gitleaks.toml:27,42-47,55,73,177` | Ten allowlist paths under `platform/app/{ee,src/server}` that no longer exist. |
| `dev/lint/semgrep/langwatch.yml:99-100,121-122,151-152` | ClickHouse rule scopes under `platform/app/src/server/clickhouse/**` and `server/repositories/**`. |
| `.oxlintrc.architecture.json:496-497,525-611` | ~90 debt-register and override paths under `platform/app/src/{components,hooks,pages,prompts,server,optimization_studio,experiments-v3,features,utils}`. |

**Baselines that now carry stale entries** (architecture-lint reports these as findings, which the ruling makes backlog, not a gate):

| File | Entries naming a file this bucket deleted |
| --- | --- |
| `packages/architecture-lint/src/legacy-feature-fragment-baseline.json` | 21 (of 144 platform lines) |
| `packages/architecture-lint/src/legacy-application-boundary-baseline.json` | 6 (of 295) — including `platform/app/src/{server.mts,workers.ts,env-load.ts,tasks.generated.ts}` |
| `packages/architecture-lint/src/global-app-access-baseline.json` | 3 (of 158) |

**Move with the app at cutover** (unchanged by this bucket, listed for completeness):

- `package.json` [17]: every `pnpm --filter @langwatch/web …` script — `dev`, `dev:app`, `dev:concurrent`, `start`, `build:app`, `test:{unit,component,integration,e2e}`, `typecheck`, `typecheck:all`, `prepare:files`, `start:prepare:files`, `prisma:{migrate,seed}` — plus `lint:oxlint` / `lint:fix`, which name `platform/app/{src,scripts,e2e,prisma,vite}` as lint roots.
- `Makefile` [4]: `:160` `bash platform/app/scripts/refresh-dev-s3-env.sh`; `:302` `cd platform/app && pnpm concurrently --kill-others`; `:311` `cd platform/app && pnpm tsc-watch`; `:375` (above).
- `pnpm-workspace.yaml` [15]: `:15` the `platform/app` workspace member; the rest is provenance prose on the override merge.
- `pnpm-lock.yaml` [5]: the `file:platform/app/vendor/langwatch-scenario-1.3.0.tgz` dependency — it moves with whoever inherits the scenario dependency.
- `dev/compose.dev.yml` [10]: `working_dir: /platform/app` ×3, the `./platform/app:/platform/app` bind mounts, the `app_modules:/platform/app/node_modules` volume, and `pnpm install --filter '@langwatch/web...'`.
- `infra/docker/Dockerfile` [24] and `Dockerfile.langyagent` [8]: the install filters (`--filter "@langwatch/web..."`), the build (`:93`), the prod prune (`:112`), the `COPY --from=builder /app/platform/app` (`:154`) and the CMD (`:204`).
- `.github/workflows/langwatch-app-ci.yml` [63]: `working-directory: platform/app` ×14, the tsbuildinfo cache keyed on `platform/app/tsconfig.tsgo*.json`, the vite cache on `platform/app/vite.config.ts`, `platform/app/{coverage/lcov.info,vitest.durations*.json,test-failures.txt,.vitest-tmp}`, and the `platform/app/**` path filters at `:181,255`.
- `.github/workflows/e2e-ci.yml` [7]: `:51` path filter, `:258` install filter, `working-directory: platform/app` ×3, `:293` `cd platform/app && PORT=5570 pnpm start`.
- `.github/workflows/npx-server-publish.yml` [13]: the version lock against `platform/app/package.json`, `:190` build filter, and the `package/app/platform/app/dist/server/{server,workers,task,scenario-child-process}.cjs` tarball assertions.
- `.github/workflows/publish-docker-ecr.yml:183` and `sdk-javascript-ci.yml:279-312`: `platform/app/**` path filter, `working-directory: platform/app` ×5.
- `.github/release-please-config.json:368`: `"path": "platform/app/package.json"`.
- `charts/langwatch/`: `tests/e2e-full-stack.sh:270` `cd /app/platform/app && … pnpm prisma:seed`; `values.yaml:612` and `templates/_helpers.tpl:1532` and `tests/workers-shutdown.sh:38` name platform paths in comments only.
- `dev/scripts/dev.sh` [8], `boxd-fork.sh` [9], `pack-npm.sh` [17]: `cd platform/app` in the preset launchers and the fork VM driver; the pack script's exclude list is anchored on `platform/app/…`.
- `tools/thuishaven/**` [≈12] and `tools/ciguard/**` [2]: `app/play.go:872` `playEnvDirs` includes `platform/app`; `cmd/root.go:817`, `app/typecheck_test.go`, `domain/{gate,hygiene}.go` name `platform/app` paths; `ciguard/leancheckout.go:57` sparse-checks out `platform/app/vitest.durations.json`.
- `.coderabbit.yaml` [20]: every review-instruction path glob is `platform/app/src/**`.
- `apps/worker/src/platform/config/worker.config.ts:139,167,240,328,788,805,1099` — provenance comments citing `platform/app/src/{env-create.mjs,runtime/app/mailer.private-config.ts,runtime/trace-privacy.config.ts,utils/encryption.ts}`, three of which this bucket deleted. Left as written: they record where a frozen twin came from, and rewriting them would lose that.
- `apps/server/src/animation/banner.ts:4`, `packages/api/src/rest/body-limit.ts:99` and its integration test, `packages/features/{trace,data-privacy}/server/src/ports/*.port.ts`, `packages/features/langy/server/src/services/langy-prompt-registry.service.ts:29`, `packages/features/notification/server/src/services/email-provider.service.ts` — docblocks citing deleted platform files as the origin of a frozen twin. Same ruling.

## The evaluator runtime, and the three doors that were waiting on it, 2026-09-03

**One absence was written down three times, and one composition closes all
three.** `apps/api` now has a real evaluator runtime —
`app/api-evaluator-execution.composition.ts` (631 lines) — and with it the
gateway's inline guardrail check, the four legacy evaluate doors and the
studio's own trace re-score stop refusing by name. The ElevenLabs post-call
webhook, which was waiting on a different absence in the same neighbourhood, is
mounted in the same pass.

### What is composed, and from where

`composeApiEvaluatorExecution` builds ONE `EvaluationExecutionService` — the
same 676-line engine the worker runs — over this process's own graph:

| Engine dependency | Bound to |
| --- | --- |
| `traceService` | the observability half's read stack (`traceReads.readers().read`), resolved at the CALL |
| `spanDigest` | `@langwatch/trace-server`'s `formatSpansDigest` — the digest an evaluator reads and the digest a judge is shown are one text |
| `modelEnvResolver` | `ApiEvaluationModelEnv`, this module's bridge over the process's ONE model gateway |
| `langevalsClient` | the packaged `HttpLangevalsEvaluatorAdapter` over `LANGEVALS_ENDPOINT` |
| `evaluators` | the execution half's `EvaluatorService` — the same one the studio publishes evaluators through |
| `workflowExecutor` | the packaged `WorkflowEvaluationAdapter` over the execution half's own `WorkflowService` |
| `installEnvironment` | the process environment |

It publishes exactly two calls, and the shape is the point:
`runEvaluation({ projectId, evaluatorType, data, settings? })` scores data the
caller already holds, and `runEvaluationForTrace({ …, traceId, mappings })`
renders a stored trace through its mappings first. `settings` is OPTIONAL on
the first so one function satisfies both consumers — the gateway's
`EvaluatorRunner`, which may omit it, and the legacy family's `runEvaluation`,
which always sends one. That is what makes the guardrail and the monitor
provably the same evaluator: a guardrail resolving a model provider differently
from a monitor would bill a customer's key against a provider they did not
choose on one path and not the other.

**`EvaluationExecutionService` gained one public method.** The dispatch it
already had — native, installed, code and workflow, in that order — was
`private runEvaluation`, reachable only through `executeForTrace`. Two doors
ask the same question with no trace to render, so `executeForData` publishes it
and `executeForTrace` still calls it. The alternative was a second copy of that
dispatch in `apps/api`, which is exactly what the platform had.

### Configuration

`api.config.ts` grew ONE leaf, in the same change that composed its reader:
`infrastructure.execution.langevalsEndpoint` ← `LANGEVALS_ENDPOINT`, beside
`nlpServiceUrl` and `publicBaseUrl` because it is the third address the
execution half needs. It is the SAME variable the worker reads
(`worker.config.ts` projects it twice, once for Presidio and once for topic
clustering), so one variable still names one service.

### Mounted on `apps/api`

| Route | Composed by |
| --- | --- |
| `POST /api/internal/gateway/guardrail/check` | `runEvaluator` bound in `composeGatewayInternalRest`; the port was shaped for exactly this one line |
| `POST /api/evaluations/:evaluator/evaluate` | `mountEvaluationsLegacyRest`'s `evaluationRun` port group |
| `POST /api/evaluations/:evaluator/:subpath/evaluate` | same |
| `POST /api/guardrails/:evaluator/evaluate` | same |
| `POST /api/dataset/evaluate` | same |
| `POST /api/elevenlabs/webhook/:modelProviderId` | `composeApiElevenLabsWebhookRest`, routed after the internal control plane |

`evaluations.runEvaluation` (tRPC) is satisfied by the same runtime.

### The cycle, and how it is closed

The studio's re-score needs the runtime; the runtime needs the evaluator service
the EXECUTION half publishes and the trace reads the OBSERVABILITY half opens —
two halves composed on either side of it. So `ApiProductionComposition` holds
the runtime as a LAZY, memoized field: `composeExecution` passes
`runEvaluationForTrace: (_ctx, input) => this.requireEvaluatorExecution()…`,
and by the time any request arrives both halves are open. The doors that can
degrade read `resolveEvaluatorExecution()` and are left OFF where it is absent;
the one that cannot — a re-score has already told the customer an evaluation is
running — reads `requireEvaluatorExecution()` and gets
`ExecutionCapabilityUnavailableError` (503, `service_unavailable`), which is
that composition's own refusal, now exported rather than re-declared.

### The realtime bag, published

`composeApiGatewayRealtimeSessions` is a new export of
`api-gateway-internal-rest.composition.ts`, and it is the whole of what the
ElevenLabs webhook was waiting for. The internal control plane calls it with
the rating adapter it also prices a drained spend batch with; the webhook calls
it without one and gets a fresh `ModelCatalogGatewaySpendRatingAdapter`. That
is the same ANSWER — the adapter is a pure read of the static model catalogue
and holds no state — and, more to the point, the same adapter CLASS the port
was declared for, which is what the "two adapters would be two answers" rule
was protecting. A booked session and a settled one still share one connection
and one confirmation.

The webhook is left OFF on two counts, and both are the whole family: no cipher
(every delivery would fail its signature check and answer 404, which after ten
consecutive failures disables the workspace's webhook for every tenant on it),
and no spend confirmation (acknowledging a delivery consumes the one report the
vendor sends).

### Named absences remaining

- **No execution telemetry.** `evaluation_duration_milliseconds` and
  `evaluation_status_counter` are not reported from this process: the port
  takes a registry and this composition is handed none. A missing series rather
  than a wrong one, which is what the port itself documents. Reported at boot
  by `LoggedApiEvaluatorExecutionAbsence.withoutExecutionTelemetry`.
- **No `LANGEVALS_ENDPOINT`, no runtime at all.** Native, code and workflow
  evaluators do not need the endpoint, and refusing those too is the deliberate
  side of the trade: the three doors are addressed by evaluator id, and a door
  that serves a third of the catalogue fails unpredictably where one that is
  honestly absent does not. Reported at boot by `withoutEvaluatorService`.
- **The realtime settlement still writes no span.** `spanIngestion` is optional
  on the bag and still unbound; the money lands and the voice call carries no
  cost line on its trace. Unchanged by this slice — it needs the
  normalized-span seam the OTLP receiver composes, which is the trace lane's.
- **The execution RECEIPT ledger is still not composed** on either process, so
  a redelivery after a crash calls the evaluator a second time. Unchanged.

### Judgment calls

- **The Langevals transport's timeout is NEW.** The platform's evaluate call
  carried none and relied on the socket; the packaged transport requires a
  number. Five minutes, stated as a constant beside one retry — the retry count
  is the platform's own `retries = 1`.
- **`ApiEvaluationAzureSafetyCredentials` is exported and the execution half
  reads it.** The Azure Content Safety branch of the model environment reads
  the project's `azure_safety` provider row, and
  `api-trpc-collaborators.execution.composition.ts` already had that read
  inline as `tryResolveAzureSafetyEnv`. One port implementation now answers
  both, so the runtime and the evaluator-inventory surface cannot disagree
  about whether a project has credentials.
- **Two row reads in the legacy mount go to Prisma directly.**
  `tryGetMonitorBySlug` and `tryGetDatasetBySlug` are transcribed from the
  platform route rather than routed through a service: `MonitorService` has no
  slug lookup at all, and `DatasetService.getBySlugOrId` throws where the row
  is absent, while these doors answer a 404 body an SDK already parses.
- **`resolveForExecution` is narrowed at the mount.** The evaluator service
  answers a saved evaluator with `settings?: Record<string, unknown>` and the
  door reads a record; `{}` is what the handler's own merge falls back to on
  that branch anyway, because there is no monitor behind an `evaluators/{slug}`
  call for `undefined` to defer to.
- **`resolveModelForFeature` swallows the cascade's throw.** The port is
  declared to answer `null` for "nothing configured at any scope", and the
  caller's only response to that is the evaluator's own default, so the
  distinction the exception carried has no consumer on this path.

### Proof

`apps/api/src/app/__tests__/api-evaluator-execution.composition.integration.test.ts`
(3 tests) drives BOTH doors over real HTTP with `fetch` faked at the process
boundary, so the real `HttpLangevalsEvaluatorAdapter` builds the URL, the body
and the response parse. A signed `/guardrail/check` reaches
`POST {endpoint}/openai/moderation/evaluate` carrying the request-direction
mapping (`input` the prompt, `output` empty) and the environment the model-env
resolver produced, and a `passed: false` verdict comes back as `decision:
"block"`; a `POST /api/evaluations/ragas/bleu_score/evaluate` reaches the same
transport with the fields the SDK posted and answers the verdict. The third
pins the absence: a blank endpoint composes no runtime and names it.

`apps/api/src/app/__tests__/api-elevenlabs-webhook.integration.test.ts`
(3 tests) signs a post-call delivery the way the vendor signs one, over row
doubles, and asserts the settlement reached the spend confirmation with the
session's own id, `usage.audio_ms` of 12,000 and a `registry@…` rate identity —
which can only have come from the model-catalog rating adapter this composition
binds — and that the row is closed only after. A bad signature answers 401 and
confirms nothing; a process with no spend pipeline mounts no webhook.

### Gates

`apps/api`: `tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.test.json
--noEmit` both **0 errors in this lane's files**. What remains in the tree is
other lanes' in-flight work — `src/index.ts` naming a `copilotkit-rest` module
that is mid-move, `../ui/src/behavior/public-config.ts` reaching for `document`
under this project's `lib`, `@langwatch/api` not yet linked into
`packages/enterprise/features/billing/server`, and the two context-drift errors
in `app-trpc.features.unit.test.ts` the previous lane already recorded.
`vitest run`: **93 files / 798 tests, 797 passing**. The one failure is
`api-trpc-collaborators.org-group.integration.test.ts` expecting the wire to
carry `"Failed to trigger topic clustering"` — a plain `Error` thrown by
`@langwatch/project-server`'s tRPC transport, which the formatter degrades to
"An unknown error occurred". Nothing in this lane touches that path.
`@langwatch/evaluation-server`: `tsc` clean; **26 files / 214 tests**, at
baseline. `@langwatch/gateway-server`: `tsc` clean; **37 files / 289 tests**,
at baseline. `git diff --numstat -- platform/app`: **0 insertions on every
row**.

## The identity producer pipelines and Langy's title generator, 2026-09-03

**Three identity pipelines were unregistered on `apps/api`, and one of the three
was breaking sign-in ceremonies outright.** The producer-only mode landed by
`bb7b334882` closed the framework half of this for the agent-side pipelines and
recorded `join_requests` and `sso_connections` as "same mechanism, now
unblocked". Taking them turned up a third that needed no mechanism at all:
`identity` declares NO process manager, was simply never registered here, and
`IdentityLedgerWriter.stage` THROWS on a null sender rather than degrading —
`"identity ledger cannot stage: the identity pipeline exposes no \"…\" sender"`.
Every ceremony that states an identifier fact on this tier — attaching a sign-in
method, verifying an address, marking a primary, detaching one, erasing a user,
proposing a link, and the seven two-step verification commands — failed on that
line. It is also the one ledger that needs no event log of its own: it does not
append and then stage, the QUEUED RUN appends, so registering the pipeline
closes it completely.

### What was composed

`packages/identity-eventing/src/adapters/producer.identity-pipelines.adapter.ts`
adds `createIdentityProducerPipeline`, `createJoinRequestProducerPipeline` and
`createSsoConnectionProducerPipeline`, built exactly like
`createSimulationProcessingProducerPipeline`: the SAME packaged definition, with
stand-ins for every consumer-side dependency that exist so the definition can be
CONSTRUCTED and refuse by name if one is ever CALLED. The projection heads and
the two process-manager ports are hand-written refusals; the nine guard
repositories behind `IdentityGuards`, `MfaGuards`, `JoinRequestGuards` and
`SsoConnectionGuards` are one proxy helper, because a producer reaches none of
them (guards run inside the command handler, which is the consumer's work) and a
hand-written double would be a second description of nine interfaces.

`apps/api/src/app/api-identity-pipelines.composition.ts` registers all three on
this process's own Eventing and resolves their senders EAGERLY into a registry —
thirteen identity commands, five join-request commands, fourteen connection
commands. A command a ledger names that the definition no longer declares fails
this process's BOOT rather than one person's ceremony.
`ApiEventingIdentityAdapter.tryPipelineCommand` now reads that registry instead
of answering `null` for an unregistered pipeline, and the adapter takes the
`EventSourcing` runtime rather than the infrastructure that wraps it, because
the store is all it uses.

`scim-sync` is deliberately NOT registered: nothing on this process composes
`ScimSyncLedgerWriter`, so a registration would publish senders for commands no
surface here can make.

### The Langy title generator moved

`platform/app/src/runtime/app/features/langy-title-generation.adapter.ts` (139
lines) is DELETED. Its work is now
`@langwatch/langy-server`'s `services/langy-title-generator.service.ts` —
the transcript, the prompt, the character budget, the sanitiser and the
`generateText` call — over `ports/langy-title-model.port.ts` and the
already-packaged `LangyEventingPorts.trustedMessages`. The package gains `ai`.

The resolve-then-fall-back cascade did NOT travel with it, and that is the one
shape change: only `ModelNotConfiguredError` means "the cascade resolved
nothing", that type belongs to `@langwatch/model-provider-contract`, and a
feature package that never depends on it cannot tell that refusal from a
disabled provider or an unknown project. So the port takes `featureKey` and
`fallbackModel` and the ADAPTER makes the two attempts —
`apps/worker/src/app/worker-langy-title-model.composition.ts`, which is also
where the engine address and the workflow feature's proxy path are joined.

### Absences closed

| Absence | Before | After |
| --- | --- | --- |
| `identity` staged senders (`apps/api`) | every identifier and two-step ceremony threw at `stage` | thirteen real dispatchers, registered at boot |
| `join_requests` staged senders (`apps/api`) | `tryPipelineCommand` answered `null`; the ledger threw | five real dispatchers |
| `sso_connections` staged senders (`apps/api`) | the same | fourteen real dispatchers, for an injected Enterprise application composed over this process's eventing |
| `withoutTitleGeneration()` (`apps/worker`) | unconditional | CONDITIONAL — reported only where no model gateway, project directory or execution proxy is composed |
| `withoutModelTranslation()` (`apps/worker`) | unconditional | CONDITIONAL — the packaged `VercelAiModelTranslationAdapter` takes the seat wherever `LANGWATCH_NLP_SERVICE` is named |

`apps/worker/src/platform/config/worker.config.ts` gains
`infrastructure.modelProvider.nlpServiceUrl` from `LANGWATCH_NLP_SERVICE` — the
same variable `apps/api` resolves its authoring model handles through, so a
model call this process makes and one that process makes cannot reach two
proxies. The address rather than the proxy PATH: the path is the workflow
feature's and the composition root joins them, which is the join
`withoutModelTranslation()` previously named as its own blocker.

`worker-production.composition.ts` LIFTS the model-gateway composition above
Langy's conversation pipeline, because that pipeline now reads it. Nothing
between the two positions depended on it.

### Absences remaining, and the exact blocker

- **The join-request ledger's own DURABLE APPEND still refuses**, and it is the
  one absence this lane opened rather than closed —
  `ApiIdentityPipelinesAbsenceReport.withoutDurableAppend()`, logged at `warn`.
  `JoinRequestLedgerWriter.commit` appends the facts itself BEFORE staging the
  command, and this process's store is `EventStoreProducerOnly`, which refuses
  `storeEvents` by name. Closing it means composing
  `EventingClickHouseEventStore` over the ClickHouse resolver `apps/api`
  already holds plus an `EventingRetentionConfiguration` this process's config
  does not read — and, before that, a decision that the API tier writes to the
  event log directly, which is the opposite of the producer-only property
  `ApiEventingInfrastructure` states three times over. The identity ledger is
  unaffected: it stages and the queued run appends.
- **`withoutTitleGeneration()` and `withoutModelTranslation()` are conditional
  but still REPORTED in production**, because `tryCreateWorkerModelProviders`
  is still handed `tenancy: undefined`. That is the `ProjectService` wave the
  worker blocker graph already names, with the same wall: an
  `OrganizationService` needs an `AuthzService`, and `PostgresAuthzAdapter`
  needs a prom-client `Registry` this process deliberately does not hold. This
  lane adds nothing to that blocker and removes nothing from it.
- **`UnavailableApiLangyUiActionCatalog`** is not one composition away and never
  will be from a server process: the only catalogue that exists is the
  experiments workbench's, which is a browser module, and
  `src/server/__tests__/frontend-boundary.unit.test.ts` walks the real graph.
- **`withoutEvaluatorExecution()` (`apps/worker`)** wants a seven-member
  execution bundle — engine, monitors, trace evidence, Azure safety
  credentials, settings recovery, inputs offload and costs — not one
  composition, and `api-evaluator-execution.composition.ts` belongs to a
  concurrent lane.
- **`withoutAppCredentials()` and `withoutDirectoryTokenRevocation()`** are
  deployment credentials and a SCIM directory capability. Neither is a
  composition.

### Judgment calls

`IdentityLedgerWriter`'s null-sender path was left THROWING rather than softened
now that a sender exists: with the registration in place the throw is
unreachable on this tier, and it is the only thing that would catch a future
process composing eventing without registering the pipeline.
`stagedSenderVia` in `join-request-ledger.adapter.ts` still returns a wrapper
whose `send` resolves `undefined` when the port answers `null` — a silent drop
in the shape of a success — but it is a package file whose other consumer is the
worker, and this lane's registration means the API never takes that branch; it
is recorded here rather than changed under a concurrent lane.

The producer's guard repositories are a `Proxy` rather than nine classes.
Every access answers a function that rejects naming the process, the pipeline
and the read; symbol properties answer `undefined` so the object is not
accidentally thenable.

`ApiEventingIdentityAdapter.create` changed shape (it now takes
`{ eventSourcing, pipelines }`), which is a breaking change to one call site in
`api-production.composition.ts` and none elsewhere.

### Gates

`apps/worker`: `vitest run` **59 files / 440 tests, all passing** (baseline
59 / 438 — this lane adds two composition scenarios), `tsc --noEmit` and
`tsc --noEmit -p tsconfig.test.json` both **0 errors**,
`apps/worker/src/features/job-registry.json` **byte-unchanged**.
`apps/api`: `vitest run` **94 files / 810 tests, 809 passing**; the one failure
is `api-trpc-collaborators.org-group.integration.test.ts` expecting the wire to
carry `"Failed to trigger topic clustering"`, which a concurrent lane's new
`app-trpc.error-formatter.ts` degrades to "An unknown error occurred" — the
same failure that lane already recorded, and nothing in this lane touches it.
`tsc --noEmit` has **1 error**, `../ui/src/behavior/public-config.ts` reaching
for `document`; `tsc --noEmit -p tsconfig.test.json` has **8**, all in other
lanes' REST and tRPC test files. None is a file this lane wrote.
`@langwatch/identity-eventing`: **13 files / 60 tests** (baseline 12 / 56),
`tsc` and `tsc -p tsconfig.test.json` both clean.
`@langwatch/langy-server`: **54 files / 506 tests, all passing**, `tsc` clean.
`git diff --numstat -- platform/app`: **0 insertions on every row** (68 rows,
all deletions).

**API absence count** (`grep -rn "abstract without" apps/api/src`): **9
declared**, two of them this lane's (`withoutQueue`, `withoutDurableAppend`).
The count going up while three pipelines come online is the honest shape: a
write path that could not be composed at all had no absence to declare, and one
that is composed declares the substrate it still does not hold.

**Worker absence count** (`grep -rn "abstract without" apps/worker/src`): **26
declared, unchanged.** Two of them — `withoutTitleGeneration()` and
`withoutModelTranslation()` — moved from unconditional to conditional, and both
declarations stay because the deployment each names is still reachable.

## The final REST lane: the packaged enumeration, `misc.ts`, `ops.ts` and the router itself, 2026-09-03

**`platform/app/src/server/api-router.ts` is deleted, and with it
`platform/app/src/server/routes/` and `platform/app/src/app/api/`.** The
platform tree serves no HTTP. `src/app/` is gone entirely; `src/server/**` is
27 files of loose helpers and test files with no router among them.

The lane had four subjects and one shape. `createAppRestFeatures` was the last
all-or-nothing enumeration — thirty-two product services in one object, mounted
as one spread, which is why `apps/api` could never call it while it composed
fewer than thirty-two. `misc.ts` was five unrelated verticals sharing a
`secured` handle. `ops.ts` was one operator endpoint waiting on a ruling about a
safety property. And the router was the file that mounted all three. Each one
resolved by asking the same question: which service does this process ALREADY
compose, and what is the honest answer where it composes none.

### The packaged enumeration, family by family

`apps/api/src/app-rest/app-rest.packaged-families.ts` replaces
`createAppRestFeatures` with a per-family conditional list, and
`apps/api/src/app/api-packaged-rest.composition.ts` binds it. The composition
TAKES services off the halves the process already built — it constructs no
second copy of anything.

| Family | Mounted from | Source |
| --- | --- | --- |
| `agent-cache` | `AgentCacheService` over this process's Redis, or memory | `apps/api/src/features/agent-cache/**` (moved from platform) |
| `agents` | `AgentApp` wrapping the agent-group half's `AgentService` | `composedAgentGroup` |
| `coding-agent` | product-group half | `composedProductGroup` |
| `dashboards` | analytics half — mounts **two** apps, dashboards and graphs | `composedAnalytics` |
| `dataset` | product-group half's `DatasetApp` | `composedProductGroup` |
| `evaluators` | execution half's evaluator catalogue | `composedExecution` |
| `experiments` | product-group half | `composedProductGroup` |
| `files` | product-infra half's `StoredObjectsService` | `composedProductInfra` |
| `governance` | Enterprise governance application, where a host supplies one | `composedOrgGroup` |
| `groups` | identity half | `composedIdentity` |
| `me` | identity half | `composedIdentity` |
| `model-providers` | product-infra half — mounts **two** apps, model-defaults and model-providers | `composedProductInfra` |
| `monitors` | product half | `composedProduct` |
| `organizations` | identity half's `OrganizationService & OrganizationProvisioningPort` | `composedIdentity` |
| `projects` | identity half | `composedIdentity` |
| `role-bindings`, `roles` | authz half, with the RBAC vocabulary derived rather than hand-kept | `composedIdentity` |
| `scenario-events` | agent-group half's `ScenarioService`, media through `ApiTraceMediaStore` | `composedAgentGroup` + `composedProductInfra` |
| `scenarios` | agent-group half's `ScenarioService` | `composedAgentGroup` |
| `scim-tokens` | Enterprise SCIM application, where a host supplies one | `composedOrgGroup` |
| `secret` | `SecretApp` wrapping the product-infra half's `SecretService` | `composedProductInfra` |
| `simulation-runs` | agent-group half's `ScenarioTabRegistry` | `composedAgentGroup` |
| `suites` | agent-group half | `composedAgentGroup` |
| `teams` | identity half | `composedIdentity` |
| `triggers` | automation half — mounts **two** apps, `/api/triggers` and `/api/trigger/slack` | `composedProduct` |
| `webhooks` | product half's webhook platform | `composedProduct` |
| `workflows` | product-group half | `composedProductGroup` |

Four accessors were PUBLISHED off existing compositions rather than composed a
second time, which is the whole point of the shape: `scenarioService` and
`scenarioTabs` from the agent-group half, `organizationProvisioning` (with the
four provisioning operations added to `MEMBERSHIP_OPERATIONS`) from the identity
half, and `storedObjectBytes` from the product-infra half. Two services needed
only their `App` wrapper, which the composition builds inline (`agentAppFrom`,
`secretAppFrom`). `storedObjectOwners` was declared in the old enumeration and
never used — it is dropped, not carried.

`ApiTraceMediaStore` is the one cross-feature bridge, and it lives in the
process because that is where a bridge belongs: the scenario-event door extracts
inline media through the trace vertical's `extractInlineMediaFromEvent` and
stores the bytes through the stored-object vertical's `storeFromBytes`. Neither
package may import the other; the composition holds both.

### `misc.ts`, split five ways

| Route | Owner | Outcome |
| --- | --- | --- |
| `POST /api/analytics` | `@langwatch/analytics-server` `analytics-legacy.api.ts` | mounted; its three 400 bodies transcribed, not folded |
| `POST /api/dspy/log_steps` | `@langwatch/experiment-server` `experiment-dspy-steps.api.ts` | mounted; cost catalogue a REQUIRED port off the model-provider host |
| `POST /api/mcp/authorize` | `@langwatch/hosted-mcp-server` `mcp-authorize.api.ts` | mounted; demo-project refusal still precedes the permission probe |
| `POST /api/trigger/slack` | `@langwatch/automation-server` `slack-trigger.api.ts` | mounted as the `triggers` family's second app |
| `GET /api/image-proxy` | `apps/api/src/features/image-proxy/` | mounted over `@langwatch/egress` |
| `POST /api/webhooks/stripe` | `@langwatch/enterprise-billing-server` `stripe-webhook.api.ts` | moved, **not mounted** — no Stripe client here |
| `POST /api/track_event` | `@langwatch/trace-server` `tracked-event.api.ts` | **named absence** — no span builder |
| `POST /api/track_usage` | — | **deleted** |
| `POST /api/demo/hotel_bot` | — | **deleted** |

### `ops.ts`: the ruling applied, without widening the seam

Recorded at wave 3b as "stays put, deliberately", because the endpoint is
cross-tenant by design and `ApiClickHouseInfrastructure` hands out only a
tenant-keyed `resolveClient`. The resolution is a THIRD identity rather than a
`shared()`: `CLICKHOUSE_OPS_URL` and `LANGWATCH_OPS_API_KEY` are their own
config leaves, `ops-clickhouse-explain-rest.mount.ts` composes a separate
readonly runtime, and the transport moved to `@langwatch/ops-server`. Adding
`shared()` would have removed the tenant-keying property from every read path
that depends on it, to satisfy one operator door.

### Named absences

- **`user-avatar`.** The family's broad read is safe only because it refuses any
  object whose owner kind is not the avatar one, and this process's file read
  answers a row that does not carry the owner kind. Mounting it would let one
  authenticated caller pull another tenant's trace media.
- **`tracked-events`** (`/api/events/track`, `/api/track_event`). The span
  builder both URLs record through was the retired application's and no package
  owns it. A door mounted here would accept a customer's feedback event and
  record nothing, which is worse than 404.
- **`copilotkit`.** The prompt-studio adapter it dispatches through reaches the
  retired studio post-event module, the platform Lambda runtime and a browser
  package. `apps/api/src/features/copilotkit/` is deleted rather than kept as a
  stub.
- **Stripe webhooks.** Moved with the billing package, not mounted: the
  signature check over raw bytes IS the security of the door, and this process
  composes no Stripe client to perform it.
- **Workflow evaluation triggering.** `triggerWorkflowEvaluation` rejects with
  `ApiRestCapabilityUnavailableError("workflow evaluation runner")` rather than
  silently succeeding.

All five are logged at boot by `LoggedApiPackagedRestAbsence`, each with the
consequence rather than the missing symbol.

### Judgment calls

- **`createAppRestFeatures` deleted, not adapted.** Its only two consumers were
  `api-router.ts` and the already-broken `generateOpenAPISpec` task. Keeping it
  would have meant keeping an all-or-nothing signature the process can never
  satisfy.
- **The mount point is after the legacy evaluations family and before the
  collector/OTLP alias.** Every packaged family owns a literal first segment, so
  ordering within the block is free; ordering relative to the process's own
  families is not, and the enumeration says so where it mounts.
- **`DISALLOWED_REDIRECT_SCHEMES` is transcribed into
  `mcp-authorize.api.ts`, not imported.** The consent page that navigates to the
  URI is a browser module and no server transport may value-import one. The
  duplication is recorded at both copies.
- **The DSPy cost catalogue port is REQUIRED, not optional.** A step stored with
  every `cost` null renders as a free run — a wrong fact, not a missing one. A
  process with no catalogue does not mount the family.
- **`traceUsageGuard` is a pass-through.** Same degradation the OTLP receiver
  already has here; introducing a second, stricter answer for one door would
  have made two doors disagree about the same limit.
- **The legacy analytics path is its own family, not a second route.** Its 400
  bodies differ from `createAnalyticsRestApp`'s envelope, and a customer holding
  the legacy URL holds those bodies.
- **`@langwatch/enterprise-sso-server`'s legacy-callback guard was rewritten,
  not deleted.** It read `platform/app/src/server/api-router.ts` as TEXT to
  prove no `rewriteCallback` was mounted for a legacy provider. That file is
  gone and the process that mounts the auth catch-all is a different workspace,
  so the guard now pins the fact this package owns — that it ships no rewriting
  helper — and the mount-side regression belongs to whoever mounts it.
- **Two stale architecture-lint baseline rows sets were pruned** (5 fragment
  rows, 4 boundary keys) because both linters fail on a baseline entry naming a
  file that no longer exists. Only rows for paths THIS lane deleted were
  removed; the rest of the platform baselines belong to the lanes still deleting
  them.

### Gates

- `apps/api` REST suites: **4 files / 41 tests, all passing**
  (`api-rest.packaged-families.integration.test.ts` 8,
  `api-rest.retired-router-families.integration.test.ts` 12, plus the product
  and authoring families).
- `apps/api` whole suite: **94 files / 810 tests, 809 passing**. The one failure
  is `api-trpc-collaborators.org-group.integration.test.ts` asserting a plain
  `Error`'s prose survives the tRPC boundary — the concurrent tRPC lane's
  untracked `app-trpc.error-formatter.ts` is what changed that. No file this
  lane wrote fails.
- `tsc --noEmit`: **1 error**, `../ui/src/behavior/public-config.ts` reaching
  for `document` through another lane's untracked `app-static`.
  `tsc --noEmit -p tsconfig.test.json`: **5 errors**, all in
  `src/app-static/**` and `src/app-trpc/**`. **0 in this lane's files.**
- Touched packages, all `tsc` clean and at or above baseline:
  `@langwatch/analytics-server` 654, `@langwatch/automation-server` 228,
  `@langwatch/experiment-server` 5,248, `@langwatch/hosted-mcp-server` 47,
  `@langwatch/ops-server` 341, `@langwatch/enterprise-billing-server` 268,
  `@langwatch/enterprise-sso-server` legacy-callback guard 8.
  `@langwatch/trace-server` 2,357 passing with 3 load failures — two ClickHouse
  integration files that want a datastore and one untracked file from the trace
  lane.
- `git diff --numstat -- platform/app`: **0 insertions on every row**, and no
  untracked file under `platform/app`. The row count moves as the concurrent
  lanes land their own deletions, so the gate is the insertion column, not the
  number of rows.

## The self-ingest refusal and the two invisible credential codes, 2026-09-03

The two absences bucket 4 recorded rather than closed. Both are small, and
both were left because they belong to a boundary bucket 4 was not allowed to
edit: the api and worker configuration roots, and the REST security module.

### 1. The self-ingest loop guard

`platform/app/src/langwatchPlatformGuard.ts` refused to boot ANY platform
process carrying `LANGWATCH_API_KEY`, because the SDK bootstrap would then
wire an exporter and ship the platform's own operational telemetry into its
own ingest. That is a feedback loop rather than observability: every ingested
span does real work — Redis, Postgres, ClickHouse — and that work emits more
spans. The symptom seen in production was a runaway `recordSpan` backlog.

`apps/api` and `apps/worker` accept the variable deliberately, paired with
`LANGWATCH_ENDPOINT`, because exporting to a DIFFERENT LangWatch install is a
supported shape. So the refusal narrowed from "a key is set" to "a key is set
and the endpoint is us", which is the only case the blanket rule was ever
protecting.

```
  BEFORE (platform)                    AFTER (both processes)

  LANGWATCH_API_KEY set?               LANGWATCH_API_KEY set?
        │                                    │ no ──────────► boot
        ▼ yes                                ▼ yes
      REFUSE                        endpoint ?? SDK default
                                            │
                                            ▼
                              resolves onto BASE_HOST / NEXTAUTH_URL /
                              the api's own listener / a sibling of this
                              worktree's *.langwatch.localhost stack?
                                     │ no ──────────────────► boot
                                     ▼ yes
                                   REFUSE
```

| Piece | Where |
| --- | --- |
| The rule, and its only implementation | `packages/config/src/self-ingest-guard.ts` (`assertObservabilityDoesNotSelfIngest`, `SelfIngestingObservabilityError`, `DEFAULT_LANGWATCH_ENDPOINT`) |
| The api's own addresses | `apps/api/src/platform/config/api.config.ts` (`refuseApiSelfIngest`), called from `resolveApiConfig` immediately after the parse |
| The worker's own addresses | `apps/worker/src/platform/config/worker.config.ts` (`refuseWorkerSelfIngest`), called from `resolveWorkerConfig` immediately after the parse |
| Spec | `specs/observability/self-ingest-guard.feature`, 4 scenarios, all `@unit`, **4/4 bound** by `check-feature-parity` |
| Tests | `packages/config/src/__tests__/self-ingest-guard.unit.test.ts` (15), plus 5 wiring cases in each config's own suite |

The refusal reaches the operator as the process's fatal boot line —
`[langwatch:api] fatal boot failure: …` / `[langwatch:worker] …` — because both
resolvers run inside the executable's boot try, and both boot-failure writers
render `error.message` first. A refusal names `LANGWATCH_API_KEY`,
`LANGWATCH_ENDPOINT`, the endpoint's HOST, and the deployment variable it
collided with. It never names the key: nothing in the decision needs its value,
only whether one was given, and a test asserts the key's value appears in
neither the message nor any field.

### 2. `credential_class_mismatch` and `invalid_credentials`

`apps/ui/src/model/errors/__tests__/codes.unit.test.ts` reported both as copy
with no raiser. Both ARE raised, by `apps/api/src/api-rest.security.ts`, in the
one shape that file's own docblock says the scanner cannot see: a code chosen by
a constructor PARAMETER, and a `declare readonly code:` union whose pattern
captures only the FIRST literal.

Fixed by the remedy that docblock prefers — a subclass per code — rather than by
adding two entries to `PARAMETERIZED_CODES`. The preference has a condition
("unless the family genuinely shares one body") and neither family met it:
`ApiOrganizationAuthenticationError` spanned two statuses, two faults, two
legacy labels and a `meta` on exactly one of its five codes. Two classes over
seven codes became seven classes over seven codes:

| Was | Now |
| --- | --- |
| `ApiRestAuthenticationError(code)` | `ApiRestMissingCredentialsError`, `ApiRestInvalidCredentialsError` |
| `ApiOrganizationAuthenticationError(code)` | `ApiOrganizationMissingCredentialsError`, `ApiOrganizationInvalidCredentialsError`, `ApiOrganizationCredentialClassMismatchError`, `ApiOrganizationNotFoundForCredentialError`, `ApiOrganizationAuthenticationUnavailableError` |

Every status, message, `meta` and `legacyError` is carried over verbatim; the
`organizationAuthenticationDetails` switch that held them is gone, and its five
branches are the five constructors. `apps/api/src/index.ts` exports the seven
names in place of the two — no compat re-export. The 500 (`internal_error`)
declares `fault: "platform"` explicitly, which the old ternary derived.

The guard's intent is preserved in both directions and is now stronger: an
eighth credential code added here declares its own literal, so the scanner sees
it and a code without copy fails the suite rather than passing unseen.

### Judgment calls

- **The rule lives in `@langwatch/config`, not twice in the two configs.** Both
  processes already import it as their only environment reader, and the
  matching logic (loopback aliases, the `.langwatch.localhost` stack, the port
  rule) is the kind of thing two copies drift on. Each config supplies only its
  OWN addresses, which is genuinely per-process: the api has a listener, the
  worker has none.
- **A port only distinguishes when BOTH sides state one.** An origin written
  without a port is the whole host, so `http://app.example.test` and
  `https://app.example.test` behind a proxy are one deployment and are refused;
  `http://localhost:5560` and `http://localhost:5570` are two development
  instances and boot. The alternative — filling in the scheme's default port —
  would have let a proxy's scheme change hide the loop.
- **`0.0.0.0` and `::` are loopback.** They are bind addresses, not
  destinations: a listener bound to every interface answers at `localhost`, so
  an endpoint written that way is the same process. Without this the api's own
  listener (default `API_HOST=0.0.0.0`) could never match anything.
- **An unset `LANGWATCH_ENDPOINT` is checked against the SDK's default**
  (`https://app.langwatch.ai`, `sdks/typescript/src/internal/constants.ts`)
  rather than skipped. On the deployment that serves that host the absence IS
  the loop, and that deployment is exactly where the original guard was
  earning its keep.
- **An unparseable endpoint is accepted, not refused.** It is an endpoint
  nothing can show to be this deployment, and refusing a malformed URL is
  `Config.url`'s job — this guard raising over it would produce a second,
  worse-worded refusal for a problem that already has one.
- **The worker reads `NEXTAUTH_URL` from its source, not from a projection
  leaf.** It consumes no such value; it needs only to recognise its own front
  door. A leaf nothing reads would be a configuration field with no consumer,
  and both config suites assert the whole projection with `toEqual`.
- **A new spec file rather than an amendment.** Nothing in `specs/` bound the
  deleted guard — it had a unit test and no scenario — so
  `specs/observability/self-ingest-guard.feature` is where the behaviour is
  now stated.

### Gates

- `packages/config`: `tsc --noEmit` clean; **6 files / 53 tests passing** (the
  new guard suite adds 15).
- `apps/worker`: `tsc --noEmit` and `tsc --noEmit -p tsconfig.test.json` both
  **0 errors**. Config suite **41 tests passing** (5 new).
- `apps/api`: `tsc --noEmit` **1 error**, `tsc --noEmit -p tsconfig.test.json`
  **5 errors** — the same `../ui/src/behavior/public-config.ts` `document`
  reach and the same `src/app-static/**` + `src/app-trpc/**` rows the final REST
  lane recorded above. **0 in this lane's files.** REST and config suites:
  **5 files / 70 tests passing** (5 new).
- `apps/ui`: `pnpm exec vitest run src/model/errors` **8 files / 207 tests, all
  passing** — was 1 failed before this lane.
- `check-feature-parity`: `specs/observability/self-ingest-guard.feature`
  **4/4 scenarios bound**.
- `git diff --numstat -- platform/app`: **0 insertions on every row**, and this
  lane contributed none of them.
