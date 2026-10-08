# Open decisions inventory 2 (unruled), 2026-10-08

Read-only sweep, second pass. The first pass (open-decisions.md, 37 items) was ruled almost entirely by rounds 24 to 28 of `.claude/coordinator/rulings-2026-10-07.md`, including the "as built", "revised" and coordinator-default lines and the round 28 bulk confirm. This pass finds what is still open after those rounds.

Sources read: the sections 11 and 12 (or the whole short note) of all 57 `.claude/handoffs/*.md` modified today (48 at the start of the sweep; nine landed during it: browser-config-finish, ci-quick-fixes, openapi-sync, contract-build-cycles, audit-refusal-budget, experiment-trace-cost, prompt-author-check, trace-peer-folds, lineage-from-door); `.claude/coordinator/held-questions.md` (Open, Held and "Rounds 24-28" entries, and the new "Held (2026-10-08, for rounds 29-33)" block, which already lists five of the items below: Q90 mechanism, contract build cycle (b), Langy e2e :220, lineage D-c and D-f); `questions-2026-10-06.md`, `question-triage-2026-10-06.md` and `ask-priority-2026-10-07.md` for the numbered backlog.

Measured today on the working tree (58 uncommitted paths from other lanes, so counts can move by a few):
- `pnpm lint:architecture --policies peer-cycles --all`: 167 findings.
- `pnpm lint:architecture` (all policies): 1609 findings across 19 policies (table in CI-3).
- `check:feature-parity`: 1 unbound scenario in enforced files.
- `pnpm lint:architecture --policies cycles`: 1 package cycle.

Section numbers cite `dev/docs/ARCHITECTURE.md`: §3.2 process half and repositories, §3.3 four-way rule, §3.4 browser half and `<name>-client`, §5 boot and peer cycles, §7 stores and migrations, §8 transports, §9 eventing, §10.1 lends, §12 errors, §13 testing and parity, §15 deleted spellings, §17 enforcement.

Counts: 25 itemised decisions (plus ST-2, a recount for information) (merge gates 7, peer-cycle cut shapes 6, contracts doors and wire 10, deploy and rollout 1, structural backlog 1), then a final section of 39 low-consequence defaults for one bulk confirm. Five items are already in the coordinator's "rounds 29-33" hold (CI-1, PAR-1, LIN-1, LIN-2, CT-9); the other twenty are new to the held list.

Order inside the file: themes ranked by consequence, merge gates first (peer cycles, then parity, then CI); inside a theme, highest consequence first.

---

## 1. Merge gates: peer cycles, parity, CI

### PC-1  Two ruled kept edges are half of a two-node cycle; the gate cannot reach zero until the reverse edge is cut
- **id:** rulings-2026-10-07.md round 20 ("Judge cycle": allow analytics -> InstantEvalApi) and round 23 (organization -> identity kept for the SSO-test guard D2 and verified addresses D4); ARCHITECTURE.md §5 ("every cycle is now reported and none is allowed"; the shrink-only list was deleted 2026-10-05); `packages/architecture-enforcer/tests/boundary-ratchets.unit.test.ts:79` ("the tree has no peer cycle edge"); held-questions.md line 175 ("the peer-cycles policy has no named-exception list, so the finding stays counted").
- **subject:** the peer-cycles gate and the two cycles Alex kept on purpose.
- **architectural background:** The policy counts a declared edge whose target reaches back. Keeping A -> B therefore only reaches zero if B has no path back to A. Today both pairs are mutual: analytics -> instant-eval (kept, `judgeQuery`) and instant-eval -> analytics (`InstantEvalRowSourceService` executes the LWQL pass through analytics, instant-eval-row-source.service.ts:198); organization -> identity (kept, D2 and D4) and identity -> organization (identity calls 14 OrganizationApi operations: membership, administrators, join setting, domains, `applyPendingInvite`). The design layering in `plans/peer-cycle-cuts-2026-10-06.md` puts analytics below instant-eval and organization below identity, so it counts both kept edges as upward cuts. The other kept edges in plan §9 (auth -> identity, auth -> user, auth -> sso, identity -> scim, project -> data-privacy, gateway -> evaluation, instant-eval -> licensing) are downward in that order and clear once their reverse edges go (identity -> auth, user -> auth, licensing -> instant-eval, data-privacy -> feature-flag chain).
- **options:**
  - (a) Cut the reverse edge: instant-eval stops calling analytics, and identity stops calling organization. Second one is a rewrite of identity's membership reads (14 operations) into facts or a channel; first one means the judge's row source is fed rows instead of querying.
  - (b) Invert the kept side by a channel the process fills (ruled precedent: round 17, the Codex handle seam filled from another module's key): analytics declares an outbound judge channel, apps composition supplies it from InstantEvalApi, so analytics holds no InstantEvalApi peer; organization declares an SSO-test guard channel and a verified-emails channel filled from IdentityApi. Policy goes green without a list; behaviour stays synchronous. Risk: it moves the dependency out of `static dependencies` without removing it, which some reviewers will read as gaming the rule (CLAUDE.md "never game a rule").
  - (c) Re-introduce a named, linted exception list in the policy with reason and owner, shrink-only, holding exactly these two (and the plan §9 pairs that stay mutual). Reverses the 2026-10-05 deletion of the list, so it needs Alex.
- **recommendation:** (b) for analytics -> instant-eval (the channel is a port in the sense of §3.2: "channel = messages to anything the module doesn't own") and (c) limited to organization <-> identity if identity's 14 reads cannot be turned into facts. State in the ruling that a kept edge always names the reverse edge it requires cut.
- **blocking:** peer-cycles zero target; `boundary-ratchets` test and therefore the architecture-enforcer job in CI (PC-2, CI-3); the plan §9 kept list; peer-b3-o-identity lane (D2, D4 stay).

### PC-2  The 167 remaining findings: one component of 32 modules, 19 mutual pairs, 30 upward edges against the design order
- **id:** `pnpm lint:architecture --policies peer-cycles --all` today (167, down from 248 on 2026-10-06 and 173 at the start of today); handoffs topic-experiment-cuts, organization-identity-facts, workflow-tidy, workflow-evaluator-doors.
- **subject:** which cut lanes remain, in which order, and whether the plan's design layering stays the target.
- **architectural background:** All 167 edges sit in one strongly connected component of 32 modules (every finding is a declared edge whose target reaches back; §5). Grouped by edge, the findings split into 19 mutual pairs (38 edges) and 129 edges that are in longer loops. Grouped by source module the heaviest are trace 14, experiment 13, auth 10, evaluation 9, gateway 9, instant-eval 8 (full list in Appendix A). Against the plan's target order (peer-cycle-cuts plan section 2), 30 declared edges point upward; cutting those 30 clears all 167 provided the kept pairs of PC-1 are settled. The 30 group into lanes as below.
  - AL, 7: audit-log -> agent, annotation, dataset, monitor, project, prompt, workflow. Ruled in round 6 and R6; the recent-items strip is now composed from owner lists (c583dd2635), but audit-log still declares all seven peers, and the approved deletion of `agent-audit-log-ids.task.ts` and `AgentApi.findIdsCreatedInWindow` has not happened (both still in the tree).
  - E, 5: entitlement -> billing, licensing, organization, project, user. The entitlement merge lane (meter landed, 29b3e1a19a) has not cut these.
  - O, 4: organization -> api-key, identity (PC-1), project, user. Sign-up first-account rule ruled in round 21.
  - T, 4: trace -> annotation (facts landed f2284de127, fold in the working tree), topic (fold in the working tree), instant-eval (traces.instantEval.* door move, unstarted), evaluation (PC-3).
  - W, 3: workflow -> agent, experiment, monitor (WF-1, WF-2).
  - LI, 2: licensing -> instant-eval (ruled R8, not done; the licensing getConnectServiceState work added more coupling) and licensing -> gateway (plan marks it redundant).
  - Single edges: analytics -> instant-eval (PC-1), identity -> auth, user -> auth, project -> trace, feature-flag -> organization (redundant, hygiene only; LIN-2).
  - Not in the 30 but on the same loops: data-retention -> entitlement, organization, project, user (lineage fold, LIN-1; the project and organization calls cut by the fold, entitlement and user by the seat-retention cycle noted in lineage-from-door.md).
- **options:**
  - (a) Keep the design layering as the target and run the remaining lanes in the order O/E/AL (foundations first, they unlock the most findings), then T, W, LI, and the single edges.
  - (b) Re-derive the layering from the current graph (the unweighted minimum feedback arc set was 44 edges on 2026-10-06; today's equivalent is likely lower) to find a cheaper target.
  - (c) Cut only what the zero gate needs and leave "hygiene" edges (feature-flag -> organization, licensing -> gateway).
- **recommendation:** (a) with (c): the order is already ruled in outline (round 2 GO); what is missing is a manifest for each of the five lanes with no manifest today (AL, E, O-remainder, LI, T-evaluation) and a statement that no cut changes the plan's layering without asking.
- **blocking:** peer-cycles zero; the architecture-enforcer CI job (PC-1, CI-3).

### PC-3  trace -> evaluation (batch B3 T, evaluation cut): server-side filters cannot be composed in the browser
- **id:** peer-cycle-cuts plan B3 T "evaluation" (size L, ruling R9 = "evaluation results on trace screens are composed in the browser", rulings-2026-10-05.md); topic-experiment-cuts.md section 11 ("goes when plan B3 T's evaluation cut lands"); the clickhouse-table-ownership finding "trace reads evaluation_runs" (trace-legacy-read.repository.ts:2097).
- **subject:** trace -> evaluation, and through it the longer loops trace -> evaluation -> workflow -> experiment -> trace (new edge experiment -> trace from the SR-5 ruling), trace -> evaluation -> workflow -> agent, evaluation -> analytics -> trace.
- **architectural background:** Trace still calls EvaluationApi for six things: `queueTraceEvaluation` (trace-processing-runtime.pipeline.ts:177), `reportEvaluation` and `deriveEvaluatorId` for custom evaluations (:181-182), `findSummariesByTraceIds` in the list read (trace-list-read.service.ts:213), `matchesEvaluationFilters` for legacy filter matching (legacy-filter-matching.service.ts:20) and the legacy read service (trace-legacy-read.service.ts:109). R9 settles display on trace screens; it does not settle server-side evaluation filters, sorting and the legacy REST read, which cannot be composed in a browser. Round 22 (subscribe first) applies: evaluation already records `scheduled`, `started`, `completed` and `reported` facts (evaluation.events.ts).
- **options:**
  - (a) Trace peer-folds evaluation's existing facts into a trace-owned read model (pattern iii) used by list filters and the legacy read; the trigger subscriber and `reportEvaluation` move to evaluation as peer subscribers of trace's span facts; the browser composes display via evaluation-client (R9). New trace table, replay step, migration.
  - (b) Evaluation owns evaluation filters: trace sends the filter expression and evaluation answers matching trace ids. Keeps the edge (it is the same call), so no cycle cut.
  - (c) Keep trace -> evaluation as a ruled kept edge and cut evaluation -> trace instead. Not viable: evaluation reads trace data to run.
- **recommendation:** (a). It is the only option consistent with round 22 and R9 together. It needs a manifest with three slices (subscribers, read model plus replay, browser composition) and a ruling that list filtering by evaluation becomes eventual (R7).
- **blocking:** T lane completion; peer-cycles zero (about 43 of the 167 findings run through trace); clickhouse-table-ownership finding on evaluation_runs; the experiment -> trace -> evaluation loop.

### PAR-1  What "parity at zero" means: 1 enforced scenario, 93 legacy, 3893 inert
- **id:** `check:feature-parity` today; langy-e2e-port.md section 7; ask-priority-2026-10-07.md section 4; held-questions SB-1 (default: tag `@unimplemented` with a gap note, confirmed in round 28).
- **subject:** the parity gate and the one scenario left, `specs/langy/langy-trace-explorer-actions.feature:220` (`@e2e`).
- **architectural background:** The check fails on 1 unbound scenario in enforced files, down from 94 on 2026-10-06. It tolerates 12 legacy files (190 of 283 scenarios bound, 93 unbound; home-views and eleven Langy files) and counts 313 inert files with 3893 scenarios, 1429 of them parked `@unimplemented`. The e2e lane stopped because the branch has no Explorer page helper (main's `fake-explorer-tab.ts` was replaced); its options were a new helper, porting main's fake tab, or leaving the row unbound. The bulk confirm already chose the tag, so no lane has applied it.
- **options:**
  - (a) Tag :220 `@unimplemented` with a gap note now (the ruled default). Check goes green. Gap stays visible in the 1430 parked scenarios.
  - (b) Build a Playwright Explorer helper and port the test (costly; needs a model key or the llmsim stand-in).
  - Scope sub-question: treat "zero" as zero in enforced files only (as CI does), with the 93 legacy and the inert files as a shrink-only list; or require the 93 legacy unbound to be bound or tagged before merge.
- **recommendation:** (a), and define zero as enforced-files zero with LEGACY_INERT shrink-only. Burn down the legacy Langy files after merge.
- **blocking:** the parity line of CI (`check:feature-parity` fails today); the PR checklist.

### CI-1  Package cycle (b): the application image cannot build; who owns "custom evaluator requirements"
- **id:** contract-build-cycles.md sections 8, 9 and 11 (status blocked, 2026-10-08 10:23); `pnpm lint:architecture --policies cycles` today (1 finding).
- **subject:** module-contract package graph: annotation-contract -> user-contract -> organization-contract -> project-contract -> data-privacy-contract -> evaluation-contract -> workflow-contract -> dataset-contract -> annotation-contract.
- **architectural background:** `infra/docker/Dockerfile:161` runs `pnpm --filter "@langwatch/ui..." --filter "@langwatch/platform-api..." --filter "@langwatch/worker..." run build`, which fails with ERR_PNPM_TASK_CYCLE while this loop exists. Cycle (a) (user-contract -> enterprise-governance-contract) is already cut in the working tree. All eight remaining edges carry a real import; seven are fixed by ownership rulings or cost more than they save. The cheapest is evaluation -> workflow (one call in one file: `getInputsOutputs` and `StudioEdge/StudioNode` in evaluator-requirements.ts:12). `data-privacy -> evaluation` is ruled ownership (§3.3, §6 rule 3) and not cuttable.
- **options:**
  - A. Move evaluator-requirements.ts into evaluator-contract: refused by the graph (workflow-contract already depends on evaluator-contract: a new nine-package loop).
  - B. Move it into workflow-contract (workflow -> evaluation-contract for the CustomEvaluator type): acyclic, but workflow does not own `evaluator`.
  - C. Keep it in evaluation-contract and invert: callers (evaluations-legacy.rest.ts:794, experiment-dataset-evaluation.service.ts:151) pass required fields or a `requiredFieldsOf` function built from workflow-contract. Acyclic; changes an exported signature; risks duplicating the inputs-to-identifiers mapping.
  - D. Move the rule into evaluation-process behind a new EvaluationApi operation (design choice, new `*Api` op).
- **recommendation:** C, with the mapping helper published once from workflow-contract so there is no duplicate. It keeps ownership where §3.3 puts it and adds no `*Api` operation. If a second owner is wanted for the "custom evaluator requirements" subject, record it in `modules/catalogue.json` (evaluator), which settles A and B by owner.
- **blocking:** the production image build and the publish workflows (publish-docker-app.yml, publish-docker-ecr.yml); CI-2 cannot go green; the `ui`, `platform-api` and `worker` filtered builds.

### CI-2  No guard keeps the live tree free of workspace package cycles
- **id:** contract-build-cycles.md section 11 step 4; `.github/workflows/langwatch-app-ci.yml:1104-1111`.
- **subject:** the `cycles` policy (`packages/architecture-enforcer/src/policies/boundaries/cycles.ts`, finding id `package-cycle`).
- **architectural background:** The policy exists and counts devDependencies and framework packages as nodes. CI runs a named list of zero-finding policies (application-boundaries, declaration-project-references, default-test-lane, prisma-migration-access, prisma-table-ownership, service-projection-boundaries, workspace-seams, teaching-citations, deleted-spellings-in-teaching, lint-rule-skill-pointers, feature-configuration, rest-namespace-owners); `cycles` is not on it, and the enforcer's tests exercise the policy only on fixtures (feature-package-boundaries.test.ts:1126-1159), not on the live tree. The one image build that would catch a cycle runs only in the publish workflows, after merge. The policy also has a weakness: its DFS shares one `visited` set and reports one representative cycle per component, so cycle (b) surfaced only after (a) was cut.
- **options:**
  - (a) Add `cycles` to the CI policy list once CI-1 is cut, and report per strongly connected component (Tarjan) with every member listed.
  - (b) Add a live-tree test beside `boundary-ratchets.unit.test.ts` (as peer cycles has) instead of the CI list entry.
  - (c) Run the Dockerfile's filtered build as a dry run in the PR workflow.
- **recommendation:** (a) now and (c) as a cheap later addition; (b) adds nothing over (a).
- **blocking:** nothing hard once CI-1 lands; it prevents the next ERR_PNPM_TASK_CYCLE from reaching the publish job.

### CI-3  Which architecture policies gate the merge: 17 are non-zero and not on the CI list
- **id:** `pnpm lint:architecture` today; `.claude/rules/lint-tooling.md` ("CI runs the zero-finding policies by id"); langwatch-app-ci.yml:1104.
- **subject:** the merge criterion for whole-tree policies.
- **architectural background:** A policy joins the CI list when its findings reach zero (workflow comment). Today's non-zero policies (the baseline-tracked ones are shrink-only lists checked by `boundary-ratchets`, so their raw count overstates debt): peer-cycles 167 (guarded by the ratchets test), source-folder-shape 197, unused-module-export 108, eventing-table-access 37 (baselined; 36 are ops, 1 is data-retention's `event_log` map), service-ceilings 33, feature-shape 23, migration-owners 21 (baselined; 10 ClickHouse and 11 Prisma historic multi-owner files), feature-layout 10, framework-module-contracts 10 (baselined), clickhouse-table-ownership 3 (trace writes `stored_log_records`, trace reads `evaluation_runs`, `lwql_api_key_tenant_map` has no owner), architecture-record 2 (tools/dev-runtime has no boundary ADR), browser-package-exports 2, private-runtime-export 2, browser-node-leak 1, cycles 1 (CI-1), retired-package-runtime 1, service-projection-write-boundary 1. Two more are environment dependent: public-declarations 374 (needs `tsc -b` output) and deleted-spellings-in-code 616 (shrink-only, path rendering looked wrong when run through the root script, so treat as unverified).
- **options:**
  - (a) Merge criterion = the current CI list plus peer-cycles via the ratchets test plus `cycles`, with every other policy a shrink-only report, not a blocker.
  - (b) Require all 17 at zero before merge (large: source-folder-shape and unused-module-export alone are 305 findings).
  - (c) Add the small ones (architecture-record 2, browser-package-exports 2, private-runtime-export 2, browser-node-leak 1, retired-package-runtime 1, service-projection-write-boundary 1, clickhouse-table-ownership 3, cycles 1: 13 findings) to the CI list now and queue the rest.
- **recommendation:** (c): the 13 findings are each a one-file change, and CI then protects the gains; (a) for the rest.
- **blocking:** the definition of done for "CI green"; the PR description's gate list.

---

## 2. Peer-cycle cut shapes still undecided

### WF-1  workflow -> monitor (D3): no monitor facts and no monitor-client exist
- **id:** peer-b4-w.md section 11 (D3 STOP); round 23 coordinator default; workflow-tidy.md section 11 ("workflow -> monitor stays, for D3").
- **subject:** the workflow archive preview's monitor names and the archive cascade's monitor lookups (`MonitorApi.list`, workflow-linked-rows.service.ts:47).
- **architectural background:** The round 23 default is "workflow peer-folds monitor's existing facts for the preview if they carry what it needs; otherwise a monitor client package (shared files, coordinator) and the browser composes; never a new MonitorApi read". Checked in the tree: monitor records no facts about monitors (its only pipeline is `monitor-evaluator-cleanup.pipeline.ts`), and `modules/monitor` has no `client/` package. So the default's second branch applies, and it needs a new package.
- **options:**
  - (a) Create `modules/monitor/client` (derived tRPC hooks; §3.4) and have the workflow browser compose monitor names. Preview then needs `monitors:view` as well as `workflows:view`; the cascade's monitor deletion already runs from workflow's archived fact and is unaffected.
  - (b) Monitor records created, renamed and deleted facts and workflow folds them: new pipeline, new contract events, replay step. Heavier; round 22 prefers it only if facts carry what is needed, and none exist.
  - (c) Keep workflow -> monitor for the preview only (a kept edge; adds a 2-cycle, since monitor -> workflow also exists).
- **recommendation:** (a). It follows the round 23 default and the precedent set by the evaluators in the preview (workflow-tidy.md, now read from evaluator-client).
- **blocking:** peer-cycles (workflow -> monitor and the monitor/evaluation/gateway loops through it); `WorkflowApi.getRelatedEntities` slimming; monitor-client is also the missing owner read for audit-log's recent items.

### WF-2  workflow -> experiment (`triggerWorkflowEvaluation`) keeps evaluator <-> workflow alive
- **id:** workflow-tidy.md section 11 ("evaluator <-> workflow is still reported via workflow -> experiment -> evaluator"); plan W "experiment: the trigger moves to experiment".
- **subject:** the door at workflow.app.ts:677 (`setup.dependencies.experiments.triggerWorkflowEvaluation`).
- **architectural background:** The evaluator door cut (90960559fb) and the preview slimming (e0465f0f7b) removed workflow -> evaluator, but evaluator still reports `evaluator -> workflow` because workflow -> experiment -> evaluator closes the loop (experiment holds evaluators, agents, monitors, traces, workflows). The plan's pattern (ii) moves the trigger to the module that owns the subject. Round 26 and the as-built CD-2 line settle that a moved door takes its tRPC namespace with it (one namespace per module, §8), so this is a wire path move.
- **options:**
  - (a) Move the trigger door and procedure to experiment (`experiments.*`); the workflow browser repoints. UI-internal path change, no REST caller.
  - (b) Record a workflow fact and let experiment subscribe: only valid if the trigger may become eventual; it is a user action expecting an immediate run id, so no.
  - (c) Keep the edge: leaves evaluator <-> workflow and agent <-> workflow in place.
- **recommendation:** (a), consistent with CD-2 as built and exemplar 94ef04fcf5.
- **blocking:** peer-cycles (workflow -> experiment is one of 4 findings on the evaluator/workflow/experiment loop); the W lane's agent remainder (studio-event-preparer, workflow-agent-mapping, linked rows, agent copy) follows it.

### WF-3  `WorkflowApi.deleteUncommitted` still has two live callers and no cut
- **id:** round 28 CD-1 ("goes when its evaluator and monitor callers are cut"); callers verified today: evaluator-linked-rows.service.ts:76 (`deleteReplicatedWorkflow`) and monitor-replication.service.ts:53 (`rollback`).
- **subject:** compensation of a failed cross-module copy: evaluator and monitor replication each create a workflow in the target project and delete it if the later save fails.
- **architectural background:** Both callers are saga rollbacks, not reads. The ruling deletes the operation when the callers are cut, but nothing says how a rollback leaves the evaluator/monitor modules. Workflow's own copy path already lives in workflow (E3), and workflow-agent-copy.service.ts:98 calls its own `deleteUncommitted`.
- **options:**
  - (a) Move the replicate-and-rollback sequence into workflow as one `WorkflowApi` copy door (evaluator and monitor call it once; workflow rolls back itself). Removes `deleteUncommitted` from the contract; adds one operation (workflow copy for linked entities).
  - (b) Workflow sweeps uncommitted workflows older than a bound (a scheduled process manager); callers just abandon. Eventual cleanup, no new operation.
  - (c) Keep `deleteUncommitted` as a legitimate compensating operation and amend the CD-1 line.
- **recommendation:** (c). Both callers are in-flight compensations that need immediate, ordered deletion; (a) and (b) change behaviour for no cycle benefit (neither caller adds a peer-cycle finding of its own that (a) or (b) alone would clear). Amend round 28 so the op is not scheduled for deletion.
- **blocking:** the `WorkflowApi` slimming; the round 28 CD-1 line stays half-done until ruled.

### ID-1  Organization's `joinRequests.*` door moving to identity changes 13 wire paths and needs a user-names read
- **id:** peer-b3-o-identity.md section 12 item 1; organization-identity-facts.md section 12; round 26 CD-2 as built (namespace moves with its owner).
- **subject:** 13 `OrganizationApi` join-request operations, `joinRequests.*` tRPC (`modules/organization/contract/src/join-request.trpc.ts`), `organization-join-door.service.ts`.
- **architectural background:** The handoff planned pattern (ii) with the path unchanged via a transport-local token (exemplar 94ef04fcf5). The CD-2 build showed that a path-identical move is impossible: two modules cannot share a tRPC namespace (DuplicateTransportNamespaceError, packages/process/src/transport-mounting.ts:65). So the move renames `joinRequests.*` to an identity namespace. Browser callers outside the organization module also repoint: `modules/auth/browser/src/behavior/auth-api.ts:9` and `modules/onboarding/browser/src/behavior/onboarding-api.ts:16` (the latter has no identity-contract dependency). The service also needs names for the admin list and `UserApi` has no names-by-ids operation (the handoff says to check `UserApi.getProfiles` before adding one; ops used it in CD-3).
- **options:**
  - (a) Move the door and rename the namespace to `identity.joinRequests.*` or merge into `identity.*`; use `UserApi.getProfiles`; add `identity-client` (CT-1).
  - (b) Leave the door in organization and call identity per operation (keeps organization -> identity, which PC-1 already keeps for D2 and D4).
- **recommendation:** (a) with `UserApi.getProfiles`, no new user operation. Record the 13-path rename in the wire-difference list (internal tRPC, UI is the only caller).
- **blocking:** D1 residue (`#answerOpenJoinRequests` already removed by 973f923bce, but the 13 operations stay on OrganizationApi until the door moves); dropping `identity` from OrganizationModule.dependencies stays blocked by D2 and D4 regardless.

### LIN-1  Lineage D-c: data-retention's scope-targeted procedures authorise themselves, so "organisation from the door" needs a framework extension
- **id:** lineage-from-door.md section 11 (D-c); held-questions.md "Held (2026-10-08, for rounds 29-33)"; round 28 coordinator line (D-b and D-d taken as defaults, "D-c and D-f held for Alex").
- **subject:** data-retention -> project and organization (4 findings: data-retention -> entitlement, organization, project, user) and the DataRetentionApi `setForScope`, `previewScopeRemoval`, `removeForScope` (data-retention.trpc.ts:41-79).
- **architectural background:** The three procedures are `.serviceAuthorized`, so the door resolves no scope and hands the service null; the organisation then comes from a directory reader that queries Team and Project tables directly (data-retention-policy.service.ts:228, :263), a pre-existing breach of rule 2. CLAUDE.md rule 6 says authorisation is declared on the route, never hand-rolled. The worker fold itself (project facts, newer wins, a not-yet-folded project refuses so the job retries) is ruled by default and blocked only by the shared Prisma model and migration (D-a).
- **options:**
  - (i) Extend `packages/api` so a route can declare a scope from a `{ scopeType, scopeId }` input with per-tier any-of permissions: a framework extension plus a permission-wire question.
  - (ii) Keep `.serviceAuthorized` and add `organizationId` to the three DataRetentionApi inputs (Q151 "pass it into each operation" arguably covers it); the anchor stays in the service.
  - (iii) Leave these three on the anchor and cut only ProjectApi through the fold.
- **recommendation:** (i) is the clean ending, because it also removes the hand-rolled check (rule 6), but (iii) now and (i) later keeps the peer-cycle lane moving: the three procedures are admin writes with no worker caller. Confirm which.
- **blocking:** the data-retention lane's second slice (drop ProjectApi and OrganizationApi); the Prisma model (shared schema.prisma and a migration, modelled on DataPrivacyProjectScope); peer-cycles for the data-retention edges.

### LIN-2  Lineage D-f: feature-flag's organization edge carries membership and creation date, not lineage
- **id:** lineage-from-door.md section 11 (D-f, "manifest premise wrong"); held-questions.md (rounds 29-33).
- **subject:** feature-flag -> organization (`memberOrganizationIds`, feature-flag.app.ts:169; `findProvisioningSummary` createdAt for age rules, organization-created-at-cache.service.ts:40); the edge sits on 9 peer cycles (10 modules reach feature-flag).
- **architectural background:** The manifest said feature-flag held ProjectApi for lineage; it does not (project to organisation already goes through `AuthzApi.getScope`). Plan §9 lists feature-flag -> organization as "redundant once the other cuts land" and the design layering counts it among the 30 upward edges (PC-2). All seven procedures are `.serviceAuthorized` over a tagged-union target (feature-flag.trpc.ts:29-99).
- **options:**
  - (a) Membership through `AuthzApi.hasPermission("organization:view")` per organisation (in-module precedent feature-flag.app.ts:309; N calls, member versus permission semantics differ), createdAt folded from an organization fact carrying it (new feature-flag table, shared schema) or passed by the caller.
  - (b) A new AuthzApi batch read for the organisations a user may view.
  - (c) Leave the edge: it is the one the plan calls hygiene, and cutting it is not needed for zero once the other 29 upward edges go.
- **recommendation:** (c). The plan already drops it as redundant; spend the rulings on the 29 that matter. Revisit only if the zero count shows it still closing a loop.
- **blocking:** nothing hard, if (c).

---

## 3. Contracts, doors and wire

### CT-1  identity-client does not exist, and 29 modules with tRPC have no client
- **id:** organization-identity-facts.md section 11 ("Ruling said identity-client: no identity-client package exists"); ARCHITECTURE.md §3.4 (lines 495-497: "every module with tRPC has a `<name>-client` package").
- **subject:** the §3.4 sentence against the tree.
- **architectural background:** 18 modules have `client/`. Contract-level tRPC declarations without a client: auth, automation, dashboard, data-privacy, data-retention, entitlement, evaluation, feature-flag, gateway, github, identity, monitor, ops, presence, role, secret, share, slack, stored-object, suite, topic, user, webhook and enterprise billing, enterprise-gateway, enterprise-ops, licensing, scim, sso (29). The organization lane followed the in-tree precedent of deriving a peer's hooks from its contract in behaviour (scim-api.ts:56-62; `join-admissions-api.ts` for identity). The record says a client "holds the web row's share" and browser packages may import it; it does not say a client must exist before a reader does.
- **options:**
  - (a) Create `identity-client` now (and `monitor-client` under WF-1) and leave the rest to be created when a second module's browser reads them; amend §3.4 to "every module whose procedures another browser reads has a client".
  - (b) Create all 29 now (mechanical, but 29 packages, lockfile and tsconfig churn, many with no reader).
  - (c) Keep behaviour-local derived hooks as the accepted pattern and drop the sentence.
- **recommendation:** (a). The two lanes that need one are already known (identity for provenance and join door, monitor for WF-1).
- **blocking:** CT-2; the shared-file request for the package (lockfile, tsconfig references, `modules/catalogue.json`); the record and the code disagree, which the architecture-review checklist flags.

### CT-2  `identity.getJoinAdmissions` lives in the session-user `identity.*` namespace
- **id:** organization-identity-facts.md section 11 (wire difference 3); `modules/identity/contract/src/identity.trpc.ts:64`.
- **subject:** an administrator read (`organization:manage`) added to a namespace whose header says it holds "the session user's own identity".
- **architectural background:** Round 24 EF-3 retired `organization.getMemberProvenance` and had the browser compose identity admissions with organization's invited ids. Identity has three tRPC files: `identity.trpc.ts` (session user), `identity-lookup.trpc.ts`, `two-step-verification.trpc.ts`. §8 allows one namespace per module; mixing session-user and admin reads in `identity.*` makes permission review per procedure instead of per namespace. It also returns every approved request, including people since removed (opaque ids only); the browser keys by current members so output is unchanged.
- **options:**
  - (a) Keep in `identity.*` with the header amended (as built).
  - (b) Rename with the join-request door under ID-1 (`identity.joinRequests.*` or `identity.admissions.*`): one rename of one procedure, free if ID-1 goes ahead.
  - (c) Scope the read to current members server-side (input: member ids) to drop the removed-people leak and bound the payload.
- **recommendation:** (b) and (c): move with ID-1, and take member ids as input so the answer is bounded and the removed-people ids are never returned.
- **blocking:** nothing hard; it is a wire path that is cheaper to name once.

### CT-3  Archive preview needs `evaluations:view`, and a plain archive still takes the evaluators the member cannot see
- **id:** workflow-tidy.md section 11 ("Permission shift"); round 27 BC-3 (every archive takes its evaluators and monitors; the dialog lists what goes); `modules/workflow/browser/src/behavior/use-workflow-archive-preview.ts:23`.
- **subject:** `workflow.getRelatedEntities` no longer returns `evaluators`; the browser reads `evaluators.getAll` (permission `evaluations:view`) and filters by workflow id.
- **architectural background:** Built-in roles hold both permissions. A custom role with `workflows:manage` but not `evaluations:view` sees no evaluator names in the dialog, yet BC-3 means the archive still takes those evaluators (eventually). That contradicts the card's "nothing offered that would be refused" rule in reverse: something is done that the dialog does not show. The preview also now fetches every evaluator in the project (with computed fields) to filter in the browser, heavier than the old by-workflow read.
- **options:**
  - (a) Accept as built and say so in the dialog when evaluator names cannot be read ("and any evaluators it backs").
  - (b) Evaluator serves a by-workflow read (`evaluators.listByWorkflow`, permission `workflows:view`) that the preview uses: one tRPC procedure in evaluator's contract, no `*Api` operation (evaluator already has `listByWorkflow` on `EvaluatorApi`).
  - (c) Make the archive cascade conditional on the member holding `evaluations:manage`: contradicts BC-3.
- **recommendation:** (b). Keeps the dialog honest for every role at the cost of one procedure that already has its service method.
- **blocking:** the BC-3 dialog contract (round 27); custom-role behaviour.

### CT-4  Dead repository reads left behind by the peer cuts
- **id:** dead-ops-log-coding.md section 11 (`CanonicalLogRecordRepository.findLogsByTraceId`); workflow-tidy.md section 11 (`WorkflowRepository.findFieldSources`). Both verified today: only tests call them.
- **subject:** `modules/log/process/src/repositories/canonical-log-record.repository.ts:10` (abstract, ClickHouse and memory twins, three unit tests) and `modules/workflow/process/src/repositories/workflow.repository.ts:49` (Prisma and memory twins, two repository tests).
- **architectural background:** Rule 2 of CLAUDE.md: a repository takes only its own state and is called by its module's services. No service calls either. Log's read: the spec "The append surface offers no read" (`modules/log/specs/log-processing-composition.feature:22`, same title in metric) binds the split between an append-only and a full repository, so removal touches a bound scenario. Workflow's read is bound by "Linked features discover workflow fields without reading workflow tables" (`modules/workflow/specs/workflow-service.feature:4`), which was written for the removed `listFields` operation.
- **options:**
  - (a) Delete both reads, their twin methods and tests; delete or reword the two scenarios.
  - (b) Keep the log read as the full repository's read surface (it is the twin of trace's own `findLogsByTraceId`, which the trace log lane now uses) and delete only the workflow one.
  - (c) Keep both until the specs are reworded in a spec-tidy lane.
- **recommendation:** (a) for workflow; (a) for log too if the append/full split scenario can stand without a read (reword: "the append surface offers no read" then has nothing to contrast with, so retire it with the method).
- **blocking:** unused-module-export and memory-twin-drift cleanliness; nothing else.

### CT-5  `EvaluationApi.findDatasetBySlug` and `recordDatasetEvaluationRow` are now only an experiment path
- **id:** peer-b2-ev2.md section 11 ("Follow-up, not done"); verified callers: evaluation-dataset-lookup.service.ts:20 and experiment-dataset-evaluation.service.ts:46.
- **subject:** two `EvaluationApi` operations whose only caller is experiment's `evaluateDataset` flow, after `ExperimentApi.evaluateDataset` took ownership of the route (round 15).
- **architectural background:** The write path was kept on EvaluationApi "to keep it identical". The data belongs to dataset (reads) and the rows to evaluation (writes); experiment can read the dataset through DatasetApi directly, which also drops an evaluation-side dataset peer.
- **options:** (a) Move the dataset read to `DatasetApi` and keep only `recordDatasetEvaluationRow`; (b) leave both until the peer-cycle lane for evaluation (PC-3) reshapes the API; (c) delete both and give experiment a direct evaluation-run writer. 
- **recommendation:** (b). The shape of EvaluationApi changes in PC-3 anyway; a second reshape now adds churn.
- **blocking:** none.

### CT-6  Judge fit ratio: the analytics trim uses 2.4 bytes per token, main used 2.7
- **id:** judge-limits.md section 11; `modules/instant-eval-judge/contract/src/instant-eval-judge.api.ts:246-248`.
- **subject:** `InstantEvalApi.getJudgeLimits` and the derivations `toInstantEvalQuestion`, `computeInstantEvalTranscriptFit` (new contract exports, not operations).
- **architectural background:** Main measured and rendered an over-budget conversation at `bytesPerInputToken` (2.7); this branch uses `transcriptFitBytesPerInputToken` (2.4), the ratio the judge itself fits a transcript at (`instant-eval-classifier-text.rules.ts`, `instantEvalTranscriptRenderTokens`). The judge therefore never re-cuts the re-render. The contract comment says live transcripts measure 2.4 to 2.7. 2.4 is stricter: slightly less text per verdict than main. Related: truncation is reported as `APP_FUNCTION_VALUE_TRUNCATED` with `function: "conversation"` (main counted it on the eval call), and `getJudgeLimits` takes no project id (one judge is wired).
- **options:** (a) Keep 2.4 (as built; stricter, no re-cut); (b) switch both sides to 2.7 as main (more text per verdict, risk of the judge re-cutting); (c) publish both and let analytics pick per judge kind.
- **recommendation:** (a), recorded as a deliberate departure with the reason (no double cut), plus a note that a per-project judge would need a project input.
- **blocking:** the three lwql/eval-functions scenarios bound to this behaviour; nothing else.

### CT-7  Where a shared-table declaration lives: the policy's list, not the owner
- **id:** analytics-shared-tables.md section 11 R3; round 25 EF-5 ("an owner declares a table shared for reading by named modules"); `packages/architecture-enforcer/src/policies/persistence/clickhouse-table-ownership.ts` (`DeclaredOwnership.shared`).
- **subject:** trace_analytics, trace_analytics_rollup, trace_summaries, stored_spans (owner trace) and evaluation_runs (owner evaluation), readers analytics.
- **architectural background:** The ruling says the owner declares; the build declares them in the enforcer's central `DECLARED_OWNERSHIP` list because an owner-side declaration would be a new framework API. The effect is the same for the lint, but the declaration sits away from the owner's code, a reader module can be added without the owner seeing it, and the generated READMEs cannot show "shared with" on the owner page.
- **options:** (a) Keep the central list (as built); (b) add an owner-side declaration (a `.withSharedTables` fact on the module or a field in the module class) that the policy and READMEs read; (c) both, central list as the fallback.
- **recommendation:** (a) now; (b) only if a third owner needs it. It avoids new framework API for five rows.
- **blocking:** nothing; clean-up of the ruling's wording.

### CT-8  Annotation facts are awaited: an append failure fails the request with the row stored
- **id:** annotation-facts.md section 11 (first bullet; "Coordinator may overrule").
- **subject:** annotation's new pipeline (f2284de127): `AnnotationService.create/update/delete` and `upsertScore` append facts after the Postgres write.
- **architectural background:** There is no outbox between the Postgres write and the event append, so an append failure returns an error to the caller after the annotation exists. Trace reads only these facts for its legacy annotation read, so a missed fact is a missing annotation in trace. The alternative (best effort, as organization's notices are) loses facts silently. The backfill, Postgres row and event dedupe grain is `(AggregateType, AggregateId, IdempotencyKey)`; the memory event store has no dedupe, so trace's fold must be idempotent, keep the newest `updatedAt` and treat delete as a tombstone (a backfill racing a delete can append created after deleted).
- **options:** (a) Loud, as built (a retry by the caller repairs it; idempotency key makes it safe); (b) best effort plus a periodic reconcile from rows; (c) an outbox row in the same transaction (the pattern for audit via outbox, held-questions Q72, landed 8ef727ba85).
- **recommendation:** (a) for now with the retry-safe key, and (c) when annotation next touches its write path. The reconcile in (b) duplicates work the backfill step already does.
- **blocking:** trace's annotation fold (in the working tree) is only as complete as the facts.

### CT-9  Q90 prompt author check: the mechanism, now that the fold cannot know every user
- **id:** prompt-author-check.md section 11; held-questions.md "Q90 mechanism" (rounds 29-33); backlog-2026-10-06.md item 22 ("blocked, ask Alex: fact-fold vs accept cycle").
- **subject:** POST `/api/prompts` and PUT `/api/prompts/:id` refusing an unknown `authorId`; prompt -> user.
- **architectural background:** The ruled route (fold from user's facts) fails because user records only `registered`, from one path with the failure swallowed: `UserApi.create` (SSO/OAuth, SCIM), `createCredentialUser`, `createPasskeyUser` and the erase task record nothing. A prompt-side fold would therefore refuse legitimate authors and never learn of erased users. Round 22 allows a new shape "only where a subscription cannot carry the data, and say why": this is that case. The same gap also explains nurturing's missing `user_created`.
- **options:**
  - A. User records `created` and `erased` facts from every path (not best effort), plus a user-owned background seed step for existing users; prompt folds into a Postgres table and checks. New user-contract shapes, user lane, fold lag (a user minted moments before a REST write is refused unless retryable).
  - B. A synchronous check through prompt's existing AuthzApi peer: the REST-supplied authorId must hold `prompts:create` or `prompts:update` on the project. No new edge, no fold, no lag, no user work; stricter than "unknown author" (an existing user outside the project is refused too).
  - C. `UserApi.findById`: closes two peer cycles; ruled out.
- **recommendation:** B, as a reading of Q90 ("not someone who may write here"), with the HandledError `prompt_author_unknown` (422) in prompt-contract. A is the right fix for user's missing facts, but it should be its own user lane (it also repairs nurturing) and not hold the prompt check.
- **blocking:** the prompt-author-check lane; wire: an unknown `authorId` refusal on the two prompt REST writes (ruled departure from main).

### CT-10  Two shapes that landed on lane defaults and need the architecture review's yes
- **id:** experiment-trace-cost.md section 11 (SR-5 ruled the read, not its signature); audit-refusal-budget.md section 11 (round 10 ruled the budget "via the host's RateLimiter", not the member).
- **subject:** (1) `TraceApi.findTraceCosts` (new `*Api` operation); (2) `refusalAudit`, a new optional member on the exported `TrpcRuntimePolicyMembers` in `packages/api`.
- **architectural background:** The architecture-review checklist flags every new `*Api` operation or framework member without a ruling. (1) is named `find*` (ADR-146: array return, precedent `findExistingTraceIds`), takes an inline input and an `occurredAt` epoch-ms window, returns `TraceCost[]` with unknown ids absent, has no cap on the id count (main had none) and no `cost:view` redaction (matching main's raw `TotalCost` read); it sits on `TraceExistenceRepository` to avoid registry wiring in shared `trace.app.ts`. (2) reuses `RateLimiter` and `Logger`; the once-per-hour warning is gated by a second limiter key because the port returns no `remaining`; without a limiter the budget fails open and records every refusal (today's behaviour, unbounded flood); the key `trpc-refusal-audit:<userId>` matches main, not the throttle's scheme.
- **options:** (a) Confirm both as built; (b) cap the id count (a chosen constant) and name a dedicated repository for the cost read; (c) make the audit budget fail closed (drop records over the cap even without a limiter) or require a limiter.
- **recommendation:** (a). Both follow existing precedents and main's behaviour; record the departures (second limiter key, fail-open) in the parity rulings.
- **blocking:** none hard; architecture review of the two lanes' diffs.

---

## 4. Deploy and rollout

### DP-1  DEPLOY-HOOKS: does cloud's deploy run the pre-upgrade hook on a rollback?
- **id:** `dev/docs/plans/migrations-blitz-2026-10-06.md` section 7 (research gap "cloud's deploy is private"); ADR-173 decision 1 ("whether cloud's private deploy uses that Job is not known from this repository"); `dev/docs/runbooks/upgrade-on-deploy.md:36-41`.
- **subject:** the pre-roll Job (`charts/langwatch/templates/app/migrate-pre-roll-job.yaml:29-36,63`, `pre-upgrade` only, never `pre-rollback`) under a deployer that runs hooks on every sync (ArgoCD and Flux map `pre-upgrade` to PreSync).
- **architectural background:** A rollback puts an older image on a newer schema (expand and contract rules guarantee that is safe). If the deployer runs the hook from the older image on a rollback, `upgrade` runs from the older build. The runner's behaviour is covered by tests: an older image's run reopens the newer releases' done background steps (`upgrade-runner.integration.test.ts:544`, Q-U5 rule 2, ruled), and a rollback with no hook is detected from the serving roster (S3-ROLLBACK, round 9; `serving-roster/rollback.ts`). The runbook says "whether a run from the older image is then a pure no-op is the runner's to prove, and is held until it is". It is not a pure no-op by design (it reopens background steps), which is the ruled behaviour and not a harm.
- **options:**
  - (a) Close as covered either way: update the runbook to say the older-image run reopens background steps and is safe, and ask the cloud deploy owners a single yes/no to record which path they take.
  - (b) Add a deployment-impact CI check that flags chart changes touching hook annotations (the repository already has `deployment-impact-check.yml`).
  - (c) Make `upgrade` refuse to run from an image older than the ledger's floor unless forced: contradicts Q-U5 rule 2, which wants the reopening.
- **recommendation:** (a). Behaviour is safe both ways; only the documentation is waiting for the deploy owners' answer, which cannot be found in this repository.
- **blocking:** nothing in code; the runbook's held sentence.

---

## 5. Structural backlog

### ST-1  Q210: channels, `Pick<XService>` consumers and memory twins
- **id:** questions-2026-10-06.md Q210 (handoffs/policy-shape-records.md section 12); ask-priority-2026-10-07.md rows 16, 17 and 19 (never asked); today's policy counts (feature-shape 23, service-projection-write-boundary 1, unused-module-export 108).
- **subject:** five sub-items. (1) 10 channel-registry findings need `.withChannels` / `defineChannels`, which do not exist in `packages/process` (verified: no match in packages/process or packages/module). Hand-calling `registry.live.create` is a §15 deleted spelling. (2) 5 contract-service findings: deleting the abstract services breaks cross-module `Pick<XService>` consumers (208 files mention a `Pick<...Service>` today, most test or intra-module). (3) tools/dev-runtime needs an ADR plus a spec (architecture-record finding; ADR-168 is Proposed). (4) digest has no app or installer (feature-shape finding; plan weekly-digest). (5) 8 memory-twin findings (enterprise-gateway, governance, licensing, saas, instant-eval, log, metric, usage).
- **architectural background:** CLAUDE.md rule 3 (channel = messages to anything the module doesn't own). Q210 was ranked 16th of 20 in ask-priority and cut with the tail. The triage proposal was: build `.withChannels` first (names stand, ARCHITECTURE.md:2796), convert `Pick<XService>` consumers to `*Api`, then delete the abstract services; real memory twins per §13.
- **options:**
  - (a) Follow the proposal in order: one framework lane for `.withChannels`, then ten channel conversions, five consumer conversions, eight memory-twin lanes.
  - (b) Do only the framework piece and the cheap policy fixes (dev-runtime ADR, digest decision) before merge; leave the twins and consumer conversions on the CI-3 shrink-only report.
  - (c) Rule that the findings are accepted for now and raise the policies' thresholds.
- **recommendation:** (b). The framework piece unblocks ten findings in one lane; the rest is mechanical debt that does not touch the wire.
- **blocking:** feature-shape and architecture-record policies reaching zero (CI-3); `.withChannels` blocks nothing else.

### ST-2  Re-count of the numbered backlog (information, no decision)
The old note counted "up to 79 ids in questions-2026-10-06.md that no ruling cites" plus 91 "bind round 2" rows. Re-counted against the rulings, the triage file and the tree:
- The triage file's own count of the uncited older ids was 85 (answered 21, moot 22, default taken 24, real decisions 16, waiting 2).
- All 16 real decisions are cited in rounds 1 to 23 of rulings-2026-10-07.md (Q39, Q45, Q65, Q96, Q134, Q156, Q157, Q202 to Q209, Q211, Q212).
- The 91 bind rows and the 82 unbound-scenario rows are moot: parity went from 94 unbound (2026-10-06) to 1 enforced (PAR-1).
- Of the 24 default-taken ids plus two leftover parts, 9 are done or moot (Q53, Q55, Q62, Q146, Q167, Q172 by parity and round 16; Q169 organization guard landed 6b6222aa95; Q191 landed 14ac832cf7; Q197 built as option B), leaving 15 plus Q121 and Q166(1): 17 live defaults, all low consequence, listed in section 7.
- 3 wait on evidence or another lane: Q107 (second `langwatch login` drops `default_personal_vk`; main's CLI not checked), Q128 (system-migrations-runner rows, waits on tenant steps), Q143 (the `@architecture` tag, 86 scenarios).
- Net live backlog: 17 defaults and 3 waiting, from 79 to 20.

---

## 6. Already ruled or in flight, not re-asked

Checked against rounds 24 to 28 and removed: EF-1 to EF-8, SR-1 to SR-8, CD-1 (except the WF-3 residue), CD-2 to CD-12, BC-1 to BC-4, SB-1 to SB-5 of the first pass; CD-7 revised (sso-signin-reword, 811643dee1); judge limits operation (CD-4, fa8fc787c1); drain retry as built (2f9edf9276); topic names fold and experiment run metrics (1bcd286460, "as built" line); the analytics hosting undone (6f95769769); trace-pure-analytics-fns (moot after round 25: analytics no longer hosts the fold, so the codex-scope injection and the MAX_PROCESSED_SPANS twin concern fall away; confirm the transitional re-export shims were not left in `packages/span-normalisation` consumers); instant-eval copy (c9b53b6458); SSO overview canView (fdfe9a526c); picker keeps archived (b0a1fc3669); workflow evaluator doors (90960559fb); ops audit reads (210327725d); small reds, replicate test, browser-config-claims R1 to R4 (89f59b25fa).

---

## 7. Low-consequence defaults for one bulk confirm

None has an architectural fork; each was taken by a lane or the coordinator, none blocks work. Reply "confirmed" to take them all.

Numbered backlog defaults (questions-2026-10-06.md; 17 live):
1. Q54: `WorkflowApi.completeCode` stays without `userId` (nothing reads it).
2. Q68: delete the unreachable `OrganizationCapabilityUnavailableError` branches (4 references remain in the tree after round 16 made the invitation service non-null).
3. Q75: leave the customer's own provider id in `routing_excluded_providers` (no credentials).
4. Q88: `offboardUser` stays on `AuthzLedgerReadRepository`, the repository the ruling named.
5. Q165: Langy retry stays 3 attempts at 5, 10 and 20 s (9859d1df33); the per-person throttle is unchanged; confirm the Go manager (`services/langyagent`) does not also retry.
6. Q168: "OKTA" uppercased, the SCIM group-dialog copy, the agent type-select row split, break-glass counting live grants.
7. Q173: no limiter on memory stacks (the rate-limit counter is ported on the Redis limiter only).
8. Q188: the workflow create dialog submits twice, as on main.
9. Q195: the authz epoch test helper waits for the next authz touch (`login-user-scoped-key.integration.test.ts` bumps `authz:epoch:<org>` directly).
10. Q199: the live suite tier requires Redis; the shared OTEL headers secret handle in `@langwatch/secrets`; assert the foreign-key code, not prose.
11. Q201: a team outside the key's organization answers organization's `TeamNotFoundError`; team-only keys are refused on their own team routes (main's behaviour).
12. Q214(1): `module-classes` ignores a file whose class is private (lint semantics).
13. Q217: azure-blob-workload-identity:344 reworded to the task's own credentials; lazy shared backend as main; the unused staging classes already deleted.
14. Q220: delete `BuiltInPullerRegistryService` and the uninstalled governance registry (3 references remain).
15. Q121: scim `copy-input.tsx` raw error toast and the tree-wide guard.
16. Q166(1): 402 gets its own error type `payment_required` (today it reads `internal_error`).
17. Q55 and Q62 wording moves (two credential scenarios into auth's spec; sso-onboarding-tiers:85) as cosmetic spec tidy.

Lane defaults from today's handoffs, not covered by the round 28 bulk confirm (22):
18. browser-config-claims: `UiDeployment` is the source for navigation's other facts and degrades to `PRODUCTION_UI_DEPLOYMENT` without a shell; `readUiProcessConfig` as the pre-render read; notification, ops and rum refuse just after `createUi().render()` (before `UiRuntime.start()` paints); interim document read of `hideDevIndicator` until ui-app-chrome lands.
19. browser-config-claims: organization browser `ui-scope-capability.ts:69` still hand-reads the `authz` slice through `parsePublicConfigSlice`; its owner lane moves it.
20. sso-can-view: with `canView` true and a stale session the card shows LoadFailure rather than the refused card (session permission is the sole gate, as on main).
21. instant-eval-copy: UI copy outside `modules/instant-eval` that pins the old "own key" wording was not searched.
22. picker-keeps-archived: `model-provider-defaults-binding-visibility.integration.test.ts:160` stub ignores `includeArchived`; the Prisma branch has no database-backed run.
23. eventing-peer-retention: peer lanes do not fall back to the runtime-wide resolver; replay stamps every lane with the one resolver ops hands it; global map projections are not covered.
24. eventing-drain-retry: a genuinely bad event type now retries for about 2.6 hours and holds its per-aggregate group for that time (round 26 as built); no attempt-aware final log line.
25. organization-identity-facts: `OrganizationApi.getMemberProvenance` becomes `getInvitedMemberIds` and `JoinAdmissionsApi.findForMembers` becomes `findForOrganization` (no net new operation); no unit test for the two `useMemberProvenance` hooks; an old pod's `members_invited` without `invitees` resolves nothing.
26. workflow-evaluator-doors: the two new evaluator input schemas restate workflow's scope shape instead of importing it; evaluator create on the switch goes straight to the runtime service (the skipped guard cannot fire on this path).
27. topic-experiment-cuts: topic's declaration guard admits a peer contract value import (matching the scenario's actual rule); experiment enqueue keys on `evaluation.run_id`; a failed `computeRunMetrics` send is retried by the queue.
28. licensing-finish and port-8416: `getAccess` reads the licence row once per access read; `judgeRoute` is asked twice; `viaConnect` loops the licensed organizations on every self-hosted access read; the Connect judge's per-organization answer is cached 30 s (an admin switch can take up to 30 s).
29. bind-license-task: billing's webhook chain (`BillingSubscriptionLifecycleService` licenses option, `EEWebhookService`, `clearTrialLicense` deletion) is the follow-up for the next billing touch.
30. codex-ping-restore: `ensureGatewayV1BaseUrl` restated in model-provider rules beside langy-contract's copy (3 lines); the unused `codexHandles` road reuses the channel later.
31. port-8486: credential-validation:482 "subscription-billed provider with no listing endpoint" is unbound until main's `providerPing` test is ported into model-provider-process.
32. peer-b3-t-log-annotation and replay-steps-meter-logs: trace keeps a second copy of every trace-correlated log record; tests register stand-in owner pipelines by literal name because owners do not export pipeline names.
33. merge-main-1008: `experiment-replicate` identity scenario is bound by both a unit and an integration test; spec files kept at main's paths (specs/auth, specs/experiments-v3); `evaluations-v3-table.tsx` comment re-read.
34. spec-tidy-b9: a blank `.env.example` runs a fresh clone with the gateway off (503 on `/api/gateway/v1/*`), the ruled behaviour; the boots-clean test checks only the all-or-none validator.
35. repo-generated-impact (SB-4 of the first pass, in bulk): `specs/ci/pr-impact-map.feature` leaves LEGACY_INERT and all 16 scenarios are tagged; snapshots now classify as generated; `generatedMatcher` implements the glob subset in use.
36. ci-quick-fixes and openapi-sync: the picomatch step needs network access to npm on the runner; the OpenAPI regeneration must be committed on a clean tree before the CI diff check can pass (5 modified and 7 new generated files).
37. SR-3 (default confirmed, not yet built): eventing surfaces `event_log` retention enrolment and size; 36 ops findings and one data-retention finding stay on the shrink-only list until then.
38. SR-4 (default confirmed, not yet built): the policy attributes `lwql_api_key_tenant_map` to analytics (still 1 clickhouse-table-ownership finding).
39. small-reds: governance memory twin filters `enabled` like Prisma; manifest regenerated (done, listed for completeness).

---

## Appendix A. The 167 peer-cycle findings, grouped by source module and edge

Each entry is a declared peer edge whose target reaches back (one finding per edge). Source (count): targets.

- trace (14): annotation, api-key, data-privacy, data-retention, entitlement, evaluation, evaluator, feature-flag, instant-eval, model-provider, monitor, project, share, topic
- experiment (13): agent, api-key, data-retention, dataset, entitlement, evaluation, evaluator, model-provider, monitor, project, prompt, trace, workflow
- auth (10): api-key, audit-log, entitlement, feature-flag, identity, licensing, organization, project, sso, user
- evaluation (9): analytics, data-retention, dataset, evaluator, feature-flag, model-provider, monitor, trace, workflow
- gateway (9): api-key, evaluation, evaluator, feature-flag, model-provider, monitor, organization, project, trace
- instant-eval (8): analytics, entitlement, feature-flag, gateway, licensing, organization, project, trace
- analytics (7): data-privacy, data-retention, entitlement, feature-flag, instant-eval, project, trace
- audit-log (7): agent, annotation, dataset, monitor, project, prompt, workflow
- identity (7): audit-log, auth, entitlement, licensing, organization, scim, user
- agent (6): audit-log, feature-flag, project, trace, user, workflow
- billing (6): audit-log, data-retention, gateway, licensing, organization, project
- organization (6): api-key, entitlement, identity, project, role, user
- workflow (6): agent, api-key, dataset, experiment, model-provider, monitor
- annotation (5): entitlement, organization, project, trace, user
- entitlement (5): billing, licensing, organization, project, user
- data-retention (4): entitlement, organization, project, user
- evaluator (4): audit-log, model-provider, user, workflow
- licensing (4): gateway, instant-eval, organization, project
- project (4): audit-log, data-privacy, organization, trace
- prompt (4): entitlement, model-provider, project, workflow
- scim (4): audit-log, entitlement, organization, user
- sso (4): audit-log, feature-flag, identity, licensing
- model-provider (3): data-privacy, organization, project
- monitor (3): evaluator, feature-flag, workflow
- topic (3): evaluation, model-provider, trace
- user (3): auth, organization, project
- api-key (2): organization, project
- dataset (2): entitlement, project
- share (2): data-retention, project
- data-privacy (1): feature-flag
- feature-flag (1): organization
- role (1): entitlement

Most-targeted modules: project 20, organization 15, entitlement 13, feature-flag 10, user 9, trace 9, audit-log 8, model-provider 8, workflow 7.

The 19 mutual pairs (both directions declared): agent/audit-log, agent/workflow, analytics/instant-eval, annotation/trace, api-key/organization, audit-log/project, auth/identity, auth/user, entitlement/organization, evaluation/trace, experiment/workflow, identity/organization, instant-eval/licensing, instant-eval/trace, monitor/workflow, organization/project, organization/user, project/trace, topic/trace.
