# Platform application exit ledger

**Updated:** 2026-08-27

**Committed baseline:** `d4f11f4da7`

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
| Committed `platform/app` at `d4f11f4da7`             | 6,102 files | Authoritative current progress        |
| Current physical tree from `rg --files platform/app` | 5,909 files | Working-tree queue only; not progress |
| Automation cut                                       |    73 fewer | Committed                             |
| Coding Agent/GitHub cut                              |    36 fewer | Committed                             |
| Trace processing cut                                 |    45 fewer | Committed                             |
| Evaluation processing cut                            |    42 fewer | Committed                             |

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
| Trace reads   | At committed `HEAD`, `server/app-layer/traces` and `server/traces` remain large and are not one safe move. The 11-file projection-persistence cut is active.                                                                                                            | Cut dependency-closed read cohorts while preserving every response field and keeping `trace_analytics`, `trace_summaries` and timeseries rollups distinct. |
| Evaluation    | Evaluation processing is committed at `d4f11f4da7`: 67 files, `+1,304/-8,875`, for a net 42-file application reduction. Package implementation is checkpointed separately at `48585548d6`.                                                                            | Prove the focused package/app checks, then drain remaining execution, evaluator, monitor and transport callers without collapsing the distinct Evaluation/Evaluator/Monitor/Experiment/Scenario/Simulation/Suite owners. |
| Gateway       | Gateway package implementation is checkpointed at `9b03f579ee`; the application cutover is active.                                                                                                                                                                   | Rewire the composed service graph, preserve money/auth/query behavior and delete the displaced Gateway, virtual-key, spend and realtime implementation. |
| API framework | The first-class REST surface is committed package-only at `755db4b875`. No caller uses it. Its package checks pass, but its RPC and REST builder types still need separating before adoption.                                                                          | During the `apps/api` cut, adopt mandatory Zod input/output schemas and `/api/v1/{service}/{optional date-or-latest}/{endpoint}`, with the date version also accepted by header. Do not churn current routes first. |

Physical movement in the shared worktree is not progress until its exact paths
are reviewed and committed. There is no time estimate in this ledger: the next
status changes when a named proof or commit changes.

## Deletion queue

The next committed batches are:

1. **Trace projection persistence:** move the 11 repository/adapter files for
   Trace summaries, Trace analytics and analytics rollups without merging their
   tables or query semantics.
2. **Gateway application cutover:** delete the displaced Gateway, spend,
   virtual-key and realtime implementation after caller rewiring.
3. **Trace query and facet compiler:** move the 34-file filter/facet compiler as
   one dependency-closed read-side collaborator.
4. **Trace edit overlay and protection:** move the 18-file edit/protection core
   and its behavioural coverage.
5. **Trace usage readers:** move the five usage-owned readers to Usage/Billing,
   not into the Trace service merely because they currently live under Trace.
6. **API composition:** adopt the parked REST surface when `apps/api` is
   created; do not churn current routes before that physical cut.

Feature Flag, the remainder of Evaluation and the other feature slices remain
open. They are not completion fallout from the batches above:

| Remaining slice                                                            | Required deletion boundary                                                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature Flag                                                               | Rewire every application caller and Ops transport to the composed feature service, remove the displaced evaluation configuration, then delete the old implementation. |
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
