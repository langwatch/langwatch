# Platform application exit ledger

**Updated:** 2026-08-27

**Committed baseline:** `fa00f3d7ec`

**Goal:** delete `platform/app`.

This ledger records committed progress, the current review gate, and the next
dependency-closed deletion batches. Feature ownership remains defined by
`packages/features/catalogue.json` and the accepted architecture in
[ADR-101](../adr/101-feature-package-surfaces.md),
[ADR-111](../adr/111-physical-application-workspaces.md), and
[ADR-112](../adr/112-singular-feature-ownership.md).

## Progress

Only committed deletions count as progress:

```sh
git ls-tree -r --name-only HEAD platform/app | wc -l
```

| Ledger item                                          |       Count | Status                                |
| ---------------------------------------------------- | ----------: | ------------------------------------- |
| Original application baseline                       | 6,398 files | Reference                             |
| Committed `platform/app` at `fa00f3d7ec`             | 5,850 files | Authoritative current progress        |
| Current physical tree from `rg --files platform/app` | 5,828 files | Unreviewed work; not counted          |
| Automation cut                                       |    73 fewer | Committed                             |
| Coding Agent/GitHub cut                              |    36 fewer | Committed                             |
| Trace processing cut                                 |    45 fewer | Committed                             |
| Evaluation processing cut                            |    42 fewer | Committed                             |
| Langy application cut                                |    37 fewer | Committed                             |
| Model Provider application cut                       |    45 fewer | Committed                             |
| Workflow application cut                             |     3 fewer | Committed                             |
| Feature-web and Ops composition cuts                 |     5 fewer | Committed                             |
| Legacy Feature Flag cut                              |    21 fewer | Committed                             |
| Gateway persistence and policy cut                   |    47 fewer | Committed                             |
| Trace projection-persistence cut                      |     8 fewer | Committed                             |
| Topic clustering application cut                     |    39 fewer | Committed                             |
| Simulation and Suite eventing cut                    |    44 fewer | Partial checkpoint committed          |

The Automation contract, server and web packages have 559 passing tests, and
their displaced application roots are empty. Coding Agent/GitHub has 266
passing Coding Agent tests, 87 passing GitHub tests with 31 deliberately
skipped, and both old application pipeline roots are empty.

The package-only checkpoints for API, Gateway, Evaluation, Langy, Topic,
Analytics, Workflow, Model Provider, Ops, Share and Secret preserve completed
package work but do not count as application deletion. Their application
cutovers remain explicit ledger work.

## Current gate

| Area          | Current fact                                                                                                                                                                                                                                                                | Exit condition                                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace process | The 154-file cut is committed at `ef6c41f1f7`: `+2,208/-12,378`, for a net 45-file application reduction. The required Eventing preparation seam is committed at `cb5feeb6aa`. Old schema imports are zero; Coding tests pass 266/266 and Trace server typechecks. | Keep the remaining 18 files only while their named composition/effect responsibilities exist; delete each as its owning feature or worker composition moves. |
| Trace reads   | The 11-file projection-persistence move is committed at `64e18e11a6`; Trace server typecheck and 633 tests pass. `trace_analytics`, `trace_summaries` and timeseries rollups remain separate repositories and tables.                                                        | Move the query/facet compiler, then edit/protection and usage cohorts while preserving every response field and query semantic. |
| Evaluation    | Evaluation processing is committed at `d4f11f4da7`: 67 files, `+1,304/-8,875`, for a net 42-file application reduction. Package implementation is checkpointed separately at `48585548d6`.                                                                            | Prove the focused package/app checks, then drain remaining execution, evaluator, monitor and transport callers without collapsing the distinct Evaluation/Evaluator/Monitor/Experiment/Scenario/Simulation/Suite owners. |
| Langy         | Langy package work is committed at `086250abca`; its 120-file application cut is committed at `b1599b2080`: `+1,001/-10,163`, for a net 37-file application reduction.                                                                                               | Prove the focused feature/app checks, then move the remaining eventing pipeline and UI composition without restoring app-layer services. |
| Model Provider | Model Provider package work is committed at `435d8711d0`; its 130-file application cut is committed at `14fc0f4282`: `+1,315/-30,905`, for a net 45-file application reduction.                                                                                      | Prove the focused feature/app checks, then move the remaining UI and process composition without restoring the deleted repositories, catalogue or service. |
| Gateway       | Package ownership starts at `9b03f579ee`; the 137-file app cut is committed at `e1ff7b9f3f`, deleting 47 net application files. Gateway package typecheck, 128 server tests and 12 contract tests pass. Twenty app service modules remain.                                  | Move the remaining virtual-key, config/materialisation, guardrail, cache and realtime collaborators behind the same canonical Gateway service; remove the final `getApp` route. |
| Topic         | Package ownership is committed at `ee3c64f882`; the 56-file app cut is committed at `1f0ee01ec9`, deleting both old roots and 39 net application files. Topic typechecks and 157 tests pass. Docker integration was unavailable.                                              | Clear the strict-layout and relocated task/test import findings without restoring app business logic; rerun Testcontainers integration where Docker exists. |
| API framework | The first-class REST surface is committed package-only at `755db4b875`. No caller uses it. Its package checks pass, but its RPC and REST builder types still need separating before adoption.                                                                          | During the `apps/api` cut, adopt mandatory Zod input/output schemas and `/api/v1/{service}/{optional date-or-latest}/{endpoint}`, with the date version also accepted by header. Do not churn current routes first. |
| Feature Flag  | The canonical package is committed at `607f5e728e`; the 23-file legacy cleanup is committed at `d191ef8c32`, deleting the old server implementation and PostHog local-evaluation copy. Source imports of the old boundary are zero.                                                | Move the remaining browser/API/worker composition during the physical app split; do not restore app-owned flag rules, stores or services. |
| Evaluation wave | Evaluator duplicate vocabulary, native implementations and code-evaluator ownership are being removed; Experiment, Simulation and Suite old eventing roots are physically empty. Simulation and Suite have a 44-file committed partial checkpoint at `fa00f3d7ec`. | Finish the seven distinct feature cuts through transports, runtime, workers and reusable UI. A moved process manager alone does not complete a feature. |

Physical movement in the shared worktree is not progress until its exact paths
are reviewed and committed. There is no time estimate in this ledger: the next
status changes when a named proof or commit changes.

## Deletion queue

The next committed batches are:

1. **Evaluator and Monitor:** finish the active application cutover while
   keeping Evaluation, Evaluator and Monitor as separate services.
2. **Experiment:** move run processing, its process manager/projections and
   compatibility transports with the Experiment feature.
3. **Scenario, Simulation and Suite:** move each singular service and its own
   eventing/runtime slice; do not merge the three because their callers overlap.
4. **Trace query and facet compiler:** move the 34-file filter/facet compiler as
   one dependency-closed read-side collaborator.
5. **Trace edit overlay and protection:** move the 18-file edit/protection core
   and its behavioural coverage.
6. **Trace usage readers:** move the five usage-owned readers to Usage/Billing,
   not into the Trace service merely because they currently live under Trace.
7. **API composition:** adopt the parked REST surface when `apps/api` is
   created; do not churn current routes before that physical cut.

The remainder of Evaluation and the other feature slices remain open. They are
not completion fallout from the batches above:

| Remaining slice                                                            | Required deletion boundary                                                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluation, Evaluator, Monitor, Experiment, Scenario, Simulation and Suite | Keep their singular services and eventing responsibilities separate; move each complete implementation with its tests and process composition.                        |
| Identity and tenancy                                                       | Drain Auth, User, AuthZ, Role, Organization, Project and API Key without creating a second repository or service graph.                                               |
| Product features                                                           | Drain Model Provider, Prompt, Dataset, Agent, Workflow, Analytics, Dashboard, Topic, Gateway, Langy, Annotation and Share as independent verticals.                   |
| Data and operations                                                        | Drain Data Privacy, Data Retention, Secret, Stored Object, Ops and licensed Enterprise seams into their declared owners and process composition.                      |
| Browser and process composition                                            | Move reusable UI to feature web packages or the Design System; move route, API, worker and browser composition to `apps/api`, `apps/worker` and `apps/ui`.            |
| Infrastructure and repository support                                      | Move boot/config, Prisma, Redis, ClickHouse, queues, mail, storage, observability, scripts, tests, specs and assets to named owners.                                  |

A later slice receives an exact file count only when it is inventoried against
the then-current committed tree. Stale macro counts and low import counts are
not deletion authority.

## Batch proof

Every deletion batch records:

1. the before/after committed `platform/app` count and exact deleted paths;
2. canonical contract/server/web ownership and the process composition root;
3. unchanged API, auth, response, eventing, persistence and UI behaviour;
4. moved behavioural coverage and package/focused application tests;
5. Oxfmt, Oxc, architecture lint, test-quality review and `git diff --check`;
6. a residue search showing no old implementation, with every deliberate
   compatibility or composition adapter named; and
7. one coherent commit containing only the reviewed slice.

No batch is complete merely because files moved out of the physical tree.
Transports, pages, workers, tests and documentation move with their owner or are
named as deliberate process composition in that same batch.

## Final deletion

After the feature, composition, infrastructure and repository-support queues
are empty:

1. remove every external `platform/app` reference from workspace configuration,
   CI, containers, deployment, scripts, generated outputs and architecture
   baselines;
2. delete `platform/app` and prove `test ! -e platform/app`;
3. fetch and perform the final rebase onto fresh `origin/main`, resolving
   conflicts into the new owners rather than restoring application code; and
4. rerun the full workspace, parity and deletion proof on the rebased commit.
