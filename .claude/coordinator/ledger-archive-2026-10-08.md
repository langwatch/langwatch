# Ledger archive (#8493), moved 2026-10-08

The issue body reached GitHub's size limit; these older sections moved here unchanged.

## decisions, rounds 1 to 33

### 2026-10-08: rounds 29 to 33

full text in [`rulings-2026-10-07.md`](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-07.md), from "## Round 29" to the end.

- **CI-1 (R29), contract package cycle (b):** callers pass the fields. evaluation-contract keeps the custom-evaluator requirements rule but takes the required fields as input; workflow-contract publishes the one mapping helper the two callers use (`evaluations-legacy.rest.ts:794`, `experiment-dataset-evaluation.service.ts:151`). no new `*Api` operation.
- **PAR-1 (R29), parity:** `langy-trace-explorer-actions.feature:220` is tagged `@unimplemented` with a gap note; parity zero means zero in enforced files, and the legacy list is shrink-only and burned down after merge.
- **PC-1 (R29), kept edges:** analytics gets its judge through a channel the process fills from `InstantEvalApi`, so analytics holds no `InstantEvalApi` peer; organization and identity is the one named, linted exception in the peer-cycles policy, with its reasons (the SSO-test guard, verified addresses).
- **CI-2 and CI-3 (R29), merge criterion:** all 17 non-zero architecture policies reach zero before merge (Alex chose this over the small-ones-only option), each joining the CI list as it reaches zero; `cycles` joins once CI-1 lands.
- **PC-3 (R30), trace to evaluation:** trace peer-folds evaluation's existing facts into its own read model for list filters and the legacy read; queueing and reporting move to evaluation as subscribers of trace's span facts; display is composed in the browser (R9); filtering by evaluation becomes eventual.
- **PC-2 (R30), cut plan:** re-derive the layering from today's graph (a minimum feedback arc set over the peer-cycle findings) before manifesting the remaining lanes; the new layering replaces the plan's design order as the target.
- **WF-2 (R30), run-evaluation door:** the trigger moves to experiment (`experiments.*`) and the workflow browser repoints (a UI-internal path change).
- **WF-1 (R30), monitor names:** the workflow browser reads monitor names from `monitor-client`; the preview needs `monitors:view` too; workflow to monitor goes.
- **ID-1 and CT-2 (R31), join requests:** the door moves to identity as `identity.joinRequests.*`; the organization, auth and onboarding browsers repoint; the 13 renames are recorded as internal wire differences; names come from `UserApi.getProfiles`; `getJoinAdmissions` moves with it and takes member ids as input.
- **CT-1 (R31), clients on demand:** create identity-client and monitor-client now; any other client when a second module's browser first reads it; section 3.4 becomes "every module whose procedures another browser reads has a client".
- **LIN-1 (R31), lineage scope:** the three data-retention scope procedures take `organizationId` in their input and the route declares its permission at organisation scope from that input, so the door checks it (no `.serviceAuthorized`, no hand-rolled check); the service asks only that the target belongs to that organisation, through the project fold; if the door cannot take an organisation scope from an input field, packages/api is extended for exactly that (rule 6).
- **LIN-2 (R31), feature-flag:** the re-derived layering decides; feature-flag to organization is cut only if the new cut set includes it (membership via `AuthzApi`, creation date folded from an organization fact).
- **CT-9 Q90 (R32), prompt author:** a REST-supplied `authorId` must hold `prompts:create` or `prompts:update` on the project, checked through prompt's existing `AuthzApi` peer; else `HandledError` `prompt_author_unknown` (422) in prompt-contract. no fold, no new edge.
- **User facts (R32):** user records `created` and `erased` facts from every creation and erase path (SSO and OAuth through `UserApi.create`, SCIM, credential, passkey, the erase task), never silently dropped, plus a user-owned background step recording `created` for existing users; nurturing subscribes.
- **CT-3 (R32), archive dialog:** evaluator serves `evaluators.listByWorkflow` under `workflows:view`; the archive dialog uses it.
- **WF-3 (R32):** `WorkflowApi.deleteUncommitted` stays as a compensating operation; the round 28 CD-1 line is amended.
- **CT-8 (R33), annotation facts:** stay awaited (a failed append fails the request and the keyed retry repairs it); move to an outbox row in the same transaction the next time annotation's write path is touched.
- **CT-4 (R33), dead reads:** delete `CanonicalLogRecordRepository.findLogsByTraceId` and `WorkflowRepository.findFieldSources` with their twins and tests, and retire their two scenarios.
- **ST-1 Q210 (R33), channels:** one framework lane builds `.withChannels` and `defineChannels`; then lanes convert the ten hand-built channel registrations, move the five `Pick<XService>` readers to `*Api` and write the eight memory twins, all before merge.
- **bulk confirm (R33):** every default in `dev/docs/plans/open-decisions-2026-10-08.md` section 7 (39 items) is ruled as built.
- **CT-5 (R33):** dataset operations wait for the evaluation cut.
- **CT-6 (R33):** 2.4 bytes per token, a recorded departure from main's 2.7.
- **CT-7 (R33):** shared-table declarations stay in the policy's central list.
- **CT-10 (R33):** `TraceApi.findTraceCosts` and the `refusalAudit` member stay as built.
- **DP-1 (R33), DEPLOY-HOOKS:** closed as safe either way; the runbook says so and asks the cloud deploy owners one yes/no.

### 2026-10-08: rounds 24 to 28

full text in [`rulings-2026-10-07.md`](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-07.md), from "## Round 24" onwards.

- **EF-1 (R24), trace to annotation:** annotation records facts (created, updated, deleted and score definitions, with content) from a pipeline, plus a data step for existing rows; trace peer-folds them into a trace-owned table and drops its `AnnotationApi` calls.
- **EF-2 (R24), invitee ids:** `members_invited` gains optional `invitees: { inviteId, userId }[]`; identity closes open join requests from it, and the lane proves identity's approve is idempotent for an existing member.
- **EF-3 (R24), member provenance:** the browser composes it (SCIM's browser joins identity-client join admissions with organization's invited ids; wire difference recorded); `organization.getMemberProvenance` retires.
- **EF-4 (R24), old pods:** `packages/eventing` treats an undeclared queued event type as retryable during the drain window, so a new pod takes the job; lands before the entitlement merge deploys.
- **SR-1 (R25), `usage_trace_meter`:** 13-month TTL, enrolled in data-retention's managed tables (one new migration).
- **SR-1 clarification (coordinator, entitlement-meter-finish section 11):** the data-retention reconciler manages only tenant-shrinkable tables; `usage_trace_meter` follows the billing-grade `gateway_spend` precedent (00067) with a fixed `INTERVAL 13 MONTH DELETE` outside it (00106, not enrolled), pinned by `retention-ttl.unit.test.ts:143-163`; no new retention list.
- **EF-7 (R25), meter parse:** trace-contract exports a narrow metering schema (ids, timestamp); the meter's peer lane parses only that.
- **SR-2 (R25):** `TraceMeterSeedService`, `seedMonth` (both twins) and the Q14 seed scenarios are deleted in the commit that adds the seed replay step.
- **EF-5 (R25), analytics tables (overrides Q207 of 10-06 and the round 16 and 20 hosting):** the writing module owns and writes its analytics tables (trace keeps `trace_analytics` and `trace_analytics_rollup` on its own pipeline, as on main); analytics reads them as declared shared tables; an owner declares a table shared for reading by named modules, the table-ownership policy admits those reads and writes stay owner-only. the analytics hosting (a4ff969301) and its replay step are undone, and `withRetiredLanes`/`since` go unless something else uses them. no new handover framework work.
- **CD-2 (R26), workflow D6:** both evaluator doors (`optimization.disableAsEvaluator`, the `setWorkflowFlags` evaluator toggle) move to evaluator on a transport-local token, wire identical (exemplar 94ef04fcf5); the lane cycle-checks evaluator to workflow.
- **CD-3 (R26), ops audit trail:** `AuditLogApi` gains a list-by-target-kind read and `UserApi` a names-by-ids read; ops' repositories stop querying `auditLog` and `user`.
- **CD-7 (R26), scim-sso-signin:28:** auth passes the provisioned membership into identity's `resolveUser` as an input (main's behaviour); no transaction across an `*Api` call.
- **CD-4 (R26), judge limits:** a second `InstantEvalApi` read returns the judge's limits; analytics trims before `judgeQuery`.
- **EF-4 as built (R26, coordinator review of eventing-drain-retry):** retries spend the group queue's existing budget (25 attempts, about 2.6 h) and then end on each lane's declared outcome (§9: trace dead-letters, others block for an ops redrive), not a forced dead-letter; the pipeline-local check is retryable too, since the same deploy hits a pipeline's own lanes.
- **BC-1 (R27), instant-eval:** the spec and error copy say a self-hosted install "has judging turned off"; the route value `own_key` stays (no wire change).
- **BC-2 (R27), recent items:** each owner's list asks its own permission; rows the member cannot open drop out of the strip.
- **BC-3 (R27), workflow archive:** every archive takes its evaluators and monitors (eventual), and the archive dialog lists what goes.
- **CD-8 (R27), SSO overview card:** `SsoHostApi` gains `canView()` beside `canManage()`; the card's query runs only when it is true.
- **CD-1 (R28):** delete `WorkflowApi.listFields`, `WorkflowApi.copy`, `LogApi.getLogsByTraceId` and `CodingAgentApi.backfillPullRequestMappings` now; `WorkflowApi.deleteUncommitted` goes when its evaluator and monitor callers are cut.
- **CD-5 and CD-6 (R28), browser config:** each owner's web module declares the slices it reads (evaluator claims `evaluation`; `rum` gets an owner), then strictness turns on; typing via `withConfig(schema, project)`.
- **bulk confirm (R28):** every coordinator default listed under "Rounds 24-28" in `held-questions.md` is ruled as built, except the model-defaults scope picker, which keeps archived projects as on main (`includeArchived` on `ProjectApi.findLiveNonGovernanceIdsByOrganization` or its successor).
- **SR-5 (R28), experiment trace cost:** asked why trace calls experiment: only trace's `experimentMetricsSync` reactor (`trace-processing-runtime.pipeline.ts:195`, `ExperimentApi.computeRunMetrics` and `lookupExperimentId`), which round 23 already moves to an experiment subscription on `span_received`, so trace no longer calls experiment once that lands. ruled by Alex: experiment reads trace cost through a by-ids `TraceApi` read, landing after that subscription removes trace to experiment (no cycle).
- **EF-5 follow-up (R28, coordinator):** analytics' other reads of `trace_summaries`, `stored_spans` (trace) and `evaluation_runs` (evaluation) are declared as shared tables too.
- **CD-2 as built (R28, coordinator):** the two doors move namespace with their owner, `optimization.*` becomes `evaluators.disableAsEvaluator` and `evaluators.toggleSaveAsEvaluator` (one tRPC namespace per module; UI-only internal paths).
- **CD-3 as built (R28, coordinator):** `AuditLogApi.findByTargetKind`; the trail's names come from the existing `UserApi.getProfiles`, no second user read.
- **CD-5 and CD-6 framework defaults (R28, coordinator):** `withConfig(slices, project)` with `project` required; the framework always admits and parses `process`; ops owns `rum`; an unclaimed slice refuses with the existing `browser_config_refused` code.
- **CD-7 revised (Alex, 2026-10-08):** nothing writes a membership inside the SSO callback transaction before `resolveUser`, on this branch or on main. scenario :28 is reworded to what happens (identity reads the committed membership; a member disabled before sign-in is refused) and bound by a test that disables first, then signs in. no new input on `resolveUser`.
- **round 23 topic and experiment as built (R28, coordinator):** `traces.getTopicCounts` moves to `topics.getTopicCounts` (UI-internal path); jobs queued on the removed `trace_processing.experimentMetricsSync` lane at deploy are not drained (at most one settling window of experiment run metrics is missed across a deploy, accepted); trace's topic-name fold drops removed topics on a REPLACE, as topic's own fold and main do.

### 2026-10-08: rounds 17 to 23

full text in [`rulings-2026-10-06-rounds.md`](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-06-rounds.md).

- **R17:** agent archive by fact; workflow owns the copy; the agent fields live in config JSON with a backfill; the HTTP test runs after the monitor cut; the Codex handle takes option A; `OrganizationApi.findSupportContact`; `.env.example` ships the gateway secrets blank; accept the archive dialog read.
- **R18:** the Codex key is read through a read-only `SecretApi`; the analytics pipeline is named `trace_analytics` with the tables unchanged; price comes from static rates; the sentinel test asserts empty.
- **R19:** `LicensingApi.getConnectServiceState`.
- **R20:** trace drawer option B (declared in the registry); peer-lane retention extends eventing; agent field defaults.
- **R21:** `UserApi.checkSignUp`.
- **R22:** subscribe-first principle; the entitlement meter everywhere, with a self-hosted seed; trace folds log facts; trace folds annotation facts (blocked: annotation records none).
- **R23:** organization to identity is kept for the SSO-test guard and verified addresses; the topic and experiment defaults; the workflow preview default.

### 2026-10-07 evening: rounds 15 and 16

full text in [`rulings-2026-10-07.md`](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-07.md) (commit `4b3af3f250`).

- **R15, `/api/dataset/evaluate`:** uses an outcome union; experiment's transport maps each refusal to main's body.
- **R15, `setLicense`:** takes `validatedAt`.
- **R15, licence writes:** move to OrganizationApi (`setLicense`, `clearLicense`); reads stay for now.
- **R15, auth memory tier:** local and test only; live truth is Postgres and the event log.
- **R16, trace analytics cut-over:** a lane-boundary handover with two framework additions (a drain into another pipeline's lane, and `since` on the replay step); no rollup replay.
- **R16, workflow and agent:** break by cutting agent to workflow.
- **R16, `/api/me/usage`:** packages/api lets a dated family share a namespace, so `/api/me/usage` moves to governance.
- **R16, parity rows:** take the recommended options.

### 2026-10-07 midday: rounds 5 to 8

full text in [`rulings-2026-10-07.md`](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-07.md) (commits `61064572`, `63fa89d1`, `11d8c674`, `829e71d6`).

- **auth owner reads (round 5):** the reads better-auth storage cannot hold (Organization, OrganizationUser, Project, `User.signupConfirmationPending`) go through the owners' APIs plus a hidden field, on both tiers: organization-by-SSO-domain and membership reads and writes through `OrganizationApi`, Project through a new auth to project read, and `signupConfirmationPending` as a better-auth `additionalField` with input and returned false, proven absent from `/api/auth/get-session`. three lanes in order: auth-memory-store, auth-owner-reads, auth-storage-registry.
- **auth memory twin defaults (round 5, no new question):** the memory session and verification-token twins read the memoryAdapter's arrays; the memory tier gets a Map-backed secondary storage while a live process without Redis keeps today's drop-and-warn fallback; the live registry requires `encryption` for the SSO provider-config cipher.
- **trace analytics fold state, dedupe key, rollup (round 6):** A1 (derive from the summary fold) and B (the source span event id in the fact) are superseded by round 8; C2 stays: the rollup is a per-span ledger in a ReplacingMergeTree keyed by (tenant, bucket, model, span type, source event id), deduped on read.
- **S2 deploy window (round 6):** a background `.withMigrations` step at upgrade re-feeds suite's peer subscribers with scenario's run facts for suite runs still open at deploy (S2-REPLAY). default taken: scenario grades runs suite never queued from its own test suite plus the existing `EvaluatorApi.findByIdWithFields`.
- **audit-log repair task (round 6):** deleting the agent-audit-log-ids task, service and repository, `AgentApi.findIdsCreatedInWindow`, the tasks CLI entry and the two backfill scenarios was approved after the permission classifier refused it twice. default taken: audit-log's missing owner reads (workflow, annotation, monitor) come from client packages, no new `*Api` operation.
- **change-gate matcher, Q-CI2 (round 7):** git pathspecs plus a guard. `pull_request_target` filters match with git `:(glob)` pathspecs read by the runner's yq, nothing installed in a job with secrets; a guard rule refuses braces and `!` negation in those filters; diff the head SHA against the merge-base, any fetch failure forces every filter; `persist-credentials: false` on the change checkout.
- **visualdiff rerun (round 7):** trace-view and trace-open-spans are recorded as flake (they pass on `662a02a80c`); trace-share-link failed again, so a lane on the shared trace page is queued once the trace analytics lanes release the trace module (TRACE-SHARE-LINK).
- **AL agent edge (round 7):** skipped for now. the permission classifier refused the repair-task deletion three times; the agent edge stays and B2-AL proceeds with the six recent-items edges only.
- **SDK heartbeat, TypeScript and Go (round 7, defaults):** the TypeScript SDK has no OpenAI instrumentation, so nothing to extend; the Go SDK needs otelhttp's shared status lifecycle changed (status Ok only after the extractor reports no error) and is its own lane.
- **auth memory rows hold `Date` (round 7, default):** the memory store joins the `temporal-only` rule's persistence seam rather than borrowing better-auth's column types for auth's own columns; folded into the next auth lane.
- **trace analytics shape (round 8):** Alex rejected a new fact per trace ("what was wrong with 2 projections from one event?"). analytics hosts both projections on trace's existing `span_received` (and the slim fold's other inputs) as peer projections; trace's pure computations (span cost, normalisation, model cost, the slim-row derivation) move into trace-contract; `packages/eventing` gains a peer fold. no new event, no cycle, analytics the sole writer. this supersedes the round 1 feeding shape and round 6 A1 and B; the attempt-2 fact slice is withdrawn.
- **still in force under round 8:** the round 1 cut-over (old trace projections drain one release); round 6 C2 (per-span ledger, deduped on read); analytics writes `trace_analytics` rows with `UpdatedAt` strictly below the old fold's so the old fold's row wins until the drain ends; all rollup readers move in one slice, each proven equal to the old read, and the AggregatingMergeTree retires after the drain.

### 2026-10-07 morning: 4 rounds, 14 answers

full text in [`rulings-2026-10-07.md`](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-07.md) (commit `6cdb7a8e`).

- **trace analytics feeding shape:** (c) trace records a fact, analytics' peer subscribers write both tables; cut-over: drain one release, dedupe rollup inserts by event id. the feeding shape is superseded by round 8 (above).
- **gateway 200 after the heartbeat:** (a) keep, plus SDKs surface the envelope as a span error.
- **`evaluatorTracesMapping` and `customGraph`:** copy the literal unions with a drift type test.
- **experiment `PropsOf`:** trace-client re-exports the props types; the local helper is deleted.
- **managed-provider, `sampleChoice`, `resourceLimitRow`:** the package-boundaries rule admits enterprise clients.
- **Q-CI1, Q-CI2, Q-CI3:** fix the three (built); `pull_request_target` diffs by SHA; reword the 11 comments.
- **visualdiff triage:** rerun and read the logs (per-finding artifacts are unreachable from the coordinator's environment).
- **Prisma `@@ignore` models and ledger folders:** delete both folders, the five models and LEDGER-COPY.
- **better-auth seam:** better-auth `memoryAdapter`; navigation types derived from the lent port.
- **upgrade ledger and re-runnable guard defaults:** confirmed as built (LEDGER-COPY superseded).
- **peer-cycle cuts:** GO in plan order.

### tonight (2026-10-06 late night): 23 rounds, 108 answers

Alex answered 108 questions in 23 rounds, plus six lines on the upgrade quality bar in the early hours of 2026-10-07; 9 answers went against the recommendation. full text in [`rulings-2026-10-06-rounds.md`](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-06-rounds.md). the notable ones:

- **parity regressions (round 1):** restore the sign-in, access and product rows as main had them, including the role-holders Access tab; build the Langy cards to the spec.
- **inline evals (rounds 11, 13, 20):** synchronous judging in LWQL is a regression and comes back as main had it; the "a query never judges" rewrite is reverted; one analytics to instant-eval cycle is allowed (210 to 211) because cycles should be cut with a global view.
- **#8484 port (round 2):** refuse above the plan's list bound; a per-plan download key; the annotation filtered mode restored behind a seam with no annotation to analytics edge.
- **Stripe (rounds 11, 23):** per-subject channels (customers, subscriptions, invoices, prices, webhooks, then meters) with memory twins over one client; connected invoicing stays one channel; subscriptions answer domain shapes, not Stripe types.
- **wire (rounds 9, 10):** transient 503 refusals are unmasked, amending the 5xx masking ruling; `TraceApi.otlpReportError` is removed; ops procedures rename to `ops.upgrade.*` with no aliases.
- **lends (rounds 6, 7, 7b):** lent tokens move to each owner's `<name>-client` package, superseding round 6b and the record's "a token lives in its owner's contract".
- **ClickHouse ownership (rounds 3, 4):** event_log is framework owned and the legacy tables are recorded as legacy; analytics owns the trace analytics tables; eventing exposes retention and its LWQL entries.
- **upgrade design (rounds 9 to 23):** the design is kept as built (one ledger, presence, target table, gate hook), with these changes: a lapsed presence write stops serving (readiness 503 and the worker pauses); rollbacks are detected from presence; ClickHouse is mandatory and an install without it refuses by name; the ledger lives in its own schema; new migrations must be re-runnable so the runner can auto-resolve; an eighth "never upgraded" state; a new checkup code for a failed ClickHouse step; the presence table is renamed; migration-compat stays advisory for a month.
- **Auth 32 (rounds 13, 20):** one `UserApi.adoptUnconfirmedAccount`; the identifier backfill never finalizes an unproven account.
- **quality bar (2026-10-07, early):** skills good enough that agents write the right step, extensive end-to-end tests, clear console and first-run logging, operator docs and env vars, the PR body and this issue in sync with every batch, and at most 15 to 20 more questions tonight.

### earlier (2026-10-06)

one line per decision; full text in the [rulings file](https://github.com/langwatch/langwatch/blob/feat/strict-feature-layout-v0/.claude/coordinator/rulings-2026-10-05.md). earlier 2026-10-06 sections in the same file: batch answers to `questions-2026-10-06.md`, generated READMEs, and the afternoon's peer cycles R1 to R10.

<details>
<summary>evening: commerce merge replaces R4; domains withdrawn (4, two superseded)</summary>

- [x] the eight-domain proposal is withdrawn; every other module keeps its shape and peer cuts R1 to R3 and R5 to R10 stand.
- [x] entitlement and usage merge into licensing. **superseded** the same night (late evening).
- [x] billing stays separate; the merged module calls billing. **superseded** the same night.
- [x] superseded by this ruling: R4, usage D1, peer cuts E1 and E2 as written; R8 (hosted judging moves to instant-eval) stays.

</details>

<details>
<summary>late evening: entitlement absorbs usage; licensing stays separate (4)</summary>

- [x] `modules/usage` merges into core `modules/entitlement`: one API, `EntitlementApi`; `UsageApi` and `@langwatch/usage-contract` are deleted, no re-export.
- [x] licensing and billing stay separate enterprise modules, one API each.
- [x] entitlement calls billing and licensing synchronously; they stop calling entitlement and usage and learn its state by facts only.
- [x] `dev/docs/plans/licensing-merge-2026-10-06.md` is superseded; its inventory stays as input.

</details>

<details>
<summary>night: entitlement merge questions Q1 to Q10 and the legacy error body (11)</summary>

- [x] Q1 stored names: rename usage's events to `lw.entitlement.*` with an upcast; pipeline, aggregate and projection names follow.
- [x] Q2 wording is reworded in the merge slice (feature titles, the absorbed ADR as 002, record §3 and §11).
- [x] Q3 entitlement counts from its own `billable_events` meter; `BillingApi.countBillableEventsByProjects` goes.
- [x] Q4 meter everywhere, self-hosted too.
- [x] Q5 one pricing source, through billing; `OrganizationApi.getPricing` goes.
- [x] Q6 billing keeps its type-only import from entitlement-contract.
- [x] Q7 billing's nine calls into licensing stay (one-way); only the seat-change fact is built.
- [x] Q8 usage warnings: entitlement records a threshold-crossed fact, billing subscribes and sends; `sendUsageWarning` goes.
- [x] Q9 all 12 commercial cycle cuts in this drive; licensing ends with no peers.
- [x] Q10 delete `createDeploymentPlanSources` with its feature file.
- [x] the 17 legacy REST families keep the canonical envelope and add main's root `error` string, declared per family in `packages/api`.

</details>

<details>
<summary>night, second round: stuck items, browser supply, readiness, upgrade UI Q-U1 to Q-U4 (16)</summary>

- [x] T1 D1: move the sessionGroups read into coding-agent.
- [x] T1 D2: the OTLP decoder moves into trace-contract as a pure function; no new `TraceApi` operation.
- [x] T1 D3: peer subscriber options gain `enqueue.filter`.
- [x] DP1: optional `teamId` and `isPersonal` on `lw.project.created`, a new `lw.project.department_assigned`, and a backfill per existing project.
- [x] audit producers: audit-log reacts to organization's audit facts; no organization to audit-log call.
- [x] REST namespace ownership: an explicit owner map in `modules/catalogue.json`; category prefixes stay unowned; the four overlaps are declared `withSharedPath`, analytics permanent.
- [x] PR #7536 body: full while the PR is live; a short squash summary just before merge.
- [x] identity bind rows: reword the storage-adapter scenario; build an OIDC test harness for the SSO callback.
- [x] browser supply 1: an undeclared drawer name is refused by name.
- [x] browser supply 2 and 3: build ADR-148's strict public config schema and `withConfig(schema, project)`.
- [x] browser supply 4: follow ADR-148 §4 for feature flags (replaces the 2026-10-05 `useFeatureFlag` ruling).
- [x] Q154(2): not ready until every installed module has booted and its stores answer.
- [x] Q-U1: the ledger keys schema steps by (step, target); a failed target fails the run.
- [x] Q-U2: an "Upgrades" page under Ops; "release upgrade" where ambiguous; the CLI stays `upgrade`.
- [x] Q-U3: cloud's usage-report reply gives the latest release and floor; preview runs from the target image's CLI.
- [x] Q-U4: a static unauthenticated holding page with phase and step ids only.

</details>

<details>
<summary>night, third: migrations blitz; hold all questions (8)</summary>

- [x] blitz the new migrations, researched first (prior art and our own failure modes), then lanes in parallel.
- [x] self-hosted gets the Upgrades page under Ops (Q-U1 to Q-U4 as ruled).
- [x] cloud migrates automatically on deploy, safe while old and new code serve side by side.
- [x] database migrations are version-aware; the ledger records release floors.
- [x] split by module: each module declares its steps with `.withMigrations`, no central list.
- [x] graceful: expand and contract, no downtime, rolling-deploy safe, resumable, idempotent.
- [x] no more questions to Alex until he asks; lanes proceed on a marked recommendation and record "default taken, held for Alex".
- [x] keep PR #7536 current after each landed batch. narrowed later that night: this issue is the work ledger and the PR body holds only what the PR is, its stats and its progress.

</details>

<details>
<summary>night, fourth: event upcasting (2)</summary>

- [x] build a framework upcaster in `packages/eventing`: stored events of a renamed type are upcast at dispatch, store read and replay; upcasts are declared by the owning module, appear in the migrations ledger and the Upgrades page, and ops can run an optional rewrite step.
- [x] the entitlement rename slice follows the upcaster (row M-R).

</details>

## log, older entries

- `28312c7936` refactor(workflow,automation): workflow and automation register their channels through defineChannels
- `2ec494e5cc` refactor(workflow): the archive preview names monitors from monitor-client and workflow drops its monitor dependency
- `8be2fe0ed8` docs(coordinator): rehearsal seeding call and the held rehearsal workflow
- `3b3b7cd129` refactor(billing): billing reads gateway spend and project names through declared shares; billing -> gateway and billing -> project are cut (R40)
- `6ea8ad25b6` docs(coordinator): collect the workflow edits held for review
- `1099190666` docs(coordinator): how the per-image code step list is produced
- `1588f9e43f` refactor(trace): trace reads topic names, annotations and score names through shared tables; the copies and migrations 00107 and 00108 go (R40)
- `657ae33d77` refactor(entitlement): entitlement reads project placement and organisation columns through declared shares; the never-called team path goes (R40, R-C1b)
- `aa5d78cbbc` feat(licensing): licensing owns the licence in its own table; billing clears it through LicensingApi.removeLicense
- `305301de03` refactor(github): github registers its channels through defineChannels; the host check becomes pure rules
- `8bdfde4734` docs(coordinator): add the token home question to round 44
- `49134a3577` refactor(identity,trace): split the SSO connection guards and the trace query field table under the size ceilings (service-ceilings 0)
- `82931429ed` docs(coordinator): start migration wave 0
- `318ce6b3d6` docs(plans): migration plan revision 2 after independent review
- `49c52f8d8b` refactor(dataset,experiment,scenario,suite,workflow): split services under the size ceilings
- `69aed6c364` docs(coordinator): service-ceilings joins the held CI line
- `c799116f67` docs(coordinator): prepare round 45 on the migration plan decisions
- `cee8599d20` feat(data-retention): scope writes take organizationId and the door asks the target's permission; the hand-rolled check and the organization dependency go (LIN-1)
- `9dca59cf46` fix: repair the ProcessMembers ratchet, the invite drawer test, a dead ui export and the codex event-name scenario binding
- `f6017d038f` refactor(langy): langy registers its channels through defineChannels; the worker metrics emitter becomes an HTTP channel
- `be9020463b` docs(coordinator): add the billing to organization points to round 44
- `80b1f1ee32` feat(architecture-enforcer): a package marked staged with a plan path is not asked for an installer, app or subject service (FS-4)
- `5b56957bc2` test(gateway): gateway's pulled-usage ledger suite moves into gateway; the ./testing runtime export goes
- `b7d393ed02` feat(process): installers publish as PublishedProcessModule so a package's declarations show only its Api (PD-1: governance 21 -> 0, gateway 20 -> 10)
- `d74a269bc8` docs(coordinator): add the instant-eval run windows question to round 44
- `667020b37b` fix(prisma-client): split the branch-only sign-in security migration per owner (organization, auth)
- `bfc2c122bc` fix(process): createApp().provide() fills a module's Api-bound channel tokens instead of dropping the fixture
- `d17a1b3c84` docs(coordinator): github's host service moves to rules for its channel bundle
- `74f7a739c9` refactor(log): split the canonical log service into pure rules under the size ceilings
- `c88506601f` refactor(organization): split invite, membership and organization services under the size ceilings
- `a61a6cb48c` docs(coordinator): record the LIN-1 permission call and the empty-team question
- `5b927f5a15` docs(coordinator): add the entitlement seat count question to round 44
- `37337f3873` refactor(ops,model-provider): split checkup, migration-pass and credential-probe services under the size ceilings
- `8dcfedaa1b` docs(coordinator): note the feature-layout CI line for round 44
- `7a54bf5c4e` refactor(analytics): analytics judges through a channel bound to InstantEvalApi instead of a peer dependency (round 34)
- `cb40a178d1` refactor(packages): retire the refusing twins, RestErrorHandler and absence class spellings
- `90f34bd033` docs(plans): draft migration plan for this branch on the upgrade system
- `a9c1b6a91d` docs(coordinator): the gateway suite splits by owner
- `f2888308b9` refactor(modules): fold 28 tiny source files into their neighbours (source-folder-shape 181 -> 154)
- `ed7464f3ee` docs(coordinator): record the gateway testing export call
- `7d192aa95c` Merge remote-tracking branch 'origin/feat/strict-feature-layout-v0' into feat/strict-feature-layout-v0
- `2c7927bbc2` docs(self-hosting): operator upgrade pages checked against the code (#8528)
- `4cf32bafdc` refactor(stored-object): stored-object registers its channels through defineChannels
- `d4e7cefb47` refactor(slack,stored-object,platform-health,nurturing): split services over the size ceilings into focused services and rules
- `29396194fa` docs(coordinator): record the PR triage for round 44
- `47ad7edb80` style(docs): format the coordinator question files
- `dd794ad50b` chore(browser-host): browser-host drops four feature contracts it never imported
- `9ba1e9a9c3` docs(coordinator): add instant-eval channels and bound fixtures to round 44
- `adf5b8409e` docs(coordinator): add the personal workspace question to round 44
- `7eb8f77dee` refactor(scim): scim's last-administrator guard asks authz, and oversight reads organisation names through the share
- `8ce1ac5fed` docs(architecture): refresh deleted spellings and pending renames against the tree
- `0e1e69a640` docs(coordinator): add the memory outbox question to round 44
- `224c760867` refactor(trace): trace reads log's log records through a shared table instead of keeping a copy (R40)
- `b1f45be029` docs(coordinator): prepare round 44 candidates
- `79c9eda397` refactor(slack,webhook): slack and webhook register their channels through defineChannels
- `2170675821` test(repositories): memory twins of six modules run the shared repository contract
- `3c68a75d0a` docs(coordinator): prepare round 43 on identity and user leaving auth
- `02af3ab467` refactor(identity): identity's lookup routes sign-in through its own router
- `d7abb89711` feat(organization): organization claims its tables and shares OrganizationUser with authz
- `260b428263` docs(packages): refresh the dependant counts the committed slices changed
- `e4c88d7cb7` chore(tooling): install tsgo at the root so tslsp-cli finds it
- `7b1f3620f4` refactor(billing): billing's audit and seat retention become facts audit-log and data-retention apply
- `929601067c` feat(architecture-enforcer): Postgres tables can be shared for reading by named modules
- `c429107401` refactor(data-retention): the retention map keys the event log from eventing's table list
- `40ac160369` refactor(eventing,ops): eventing serves the operator surface over its own tables
- `188f808f6b` docs(coordinator): record the billing to organization ruling
- `93f3b22fef` feat(authz): new AuthzApi read findActiveOrganizationAdministrators
- `c9ccd086c6` refactor(gateway,langy): split four oversized services under the ceiling
- `8448173df4` refactor(time): computeNextRunAt becomes nextCronFireAt
- `d6a2013ee9` refactor: fold sixteen tiny source files into their neighbours
- `a322e9c7e9` refactor(ops): the first "backoffice" spellings become Admin
- `59cc43387e` chore(demo-data): the demo-data contract records callable false
- `581a688146` chore(architecture): contracts with no callable API record callable false
- `765c8643a2` chore(architecture-enforcer): migration-owners exempts historic migrations by a frozen cutoff
- `2c1ba35a86` fix(redaction): hash bitcoin checksums with @noble/hashes in both runtimes
- `1cb390869c` fix(handled-error): list prompt_author_unknown and give it customer copy
- `6fce07d9b8` docs(coordinator): record round 42
- `da7ac240de` chore(architecture): architecture-records, browser-package-exports and manifests reach zero
- `480af99bc6` docs(coordinator): record rounds 37 to 41 and the coordinator calls since
