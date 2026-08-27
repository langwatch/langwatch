# Platform application exit ledger

**Updated:** 2026-08-27

**Committed baseline:** `31b214a0f1`

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

| Ledger item                                          |             Count | Status                                  |
| ---------------------------------------------------- | ----------------: | --------------------------------------- |
| Committed `platform/app` at `31b214a0f1`             |       6,225 files | Authoritative baseline                  |
| Current physical tree from `rg --files platform/app` | about 5,908 files | Working-tree queue only; not progress   |
| Automation cut                                       |         321 files | Committed; removed 73 application files |

Automation contract, server and web have 559 passing package tests. The focused
app composition suite has 21. The displaced app-layer and eventing roots are
empty.

## Current gate

| Area                    | Current fact                                                                                                                                                                                                           | Exit condition                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coding Agent and GitHub | This is the next deletion-sized batch.                                                                                                                                                                                 | Move the two pipelines to their feature owners and delete the 37 old pipeline files; leave only process registration and ordering in worker composition.                                         |
| Trace                   | Package consolidation is committed, but the final application cut is not ready. Physical residue remains: `event-sourcing/pipelines/trace-processing` 80 files, `server/app-layer/traces` 134, and `server/traces` 83. | Resolve the current 160 architecture errors and 182 application test/typecheck diagnostics, preserve all query/event/persistence parity, then define exact dependency-closed deletion manifests. |
| API framework           | The future REST surface is package-only and must not be adopted by existing callers yet.                                                                                                                               | During the `apps/api` cut, adopt one Zod input/output contract and `/api/v1/{service}/{optional date-or-latest}/{endpoint}`, with the date version also accepted by header.                      |

The Trace package commit is ownership progress, not proof that the three old
application roots can be deleted. Physical movement in the shared worktree is
also not progress until the corresponding paths are reviewed and committed.

## Deletion queue

The next committed batches are:

1. **Coding Agent/GitHub:** delete the 37 displaced pipeline files after package
   ownership and worker composition are proven.
2. **Trace follow-up cuts:** split the remaining 297 files across the three old
   Trace roots into the smallest dependency-closed manifests only after the
   architecture and application diagnostics are cleared.
3. **API composition:** adopt the package-only REST surface when `apps/api` is
   created; do not churn current routes before that physical cut.

Feature Flag, Evaluation and the other feature slices remain open. They are not
completion fallout from the batches above:

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
