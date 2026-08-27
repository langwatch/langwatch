# Platform application exit ledger

**Updated:** 2026-08-28

**Committed application baseline:** `903fb2e4c5`

**Goal:** delete `platform/app`.

This ledger records committed progress, the current review gate, and the next
dependency-closed deletion batches. Feature ownership remains defined by
`packages/features/catalogue.json` and the accepted architecture in
[ADR-101](../adr/101-feature-package-surfaces.md),
[ADR-111](../adr/111-physical-application-workspaces.md), and
[ADR-112](../adr/112-singular-feature-ownership.md).
Non-blocking structural improvements discovered during extraction are recorded
in [the follow-up ledger](core-application-feature-extraction-future-work.md).

## Active UI/web lane hand-off

The frontend lane owns `apps/ui`, the Prompt web-package export pilot,
frontend architecture lint, and `packages/design-system` Storybook. The backend
lane concurrently owns API, Secret, Agent server/composition, and backend
transport lint changes. Each lane must commit before integration; reconcile the
shared `pnpm-lock.yaml` and this ledger after both checkpoints exist.

Integration note for the concurrent Agent UI work: browser RPC ports and
adapters belong under `apps/ui/src/platform/agent`, not directly under
`apps/ui/src`. Update their exports and tests during reconciliation; the new
source-root rule intentionally rejects root-level feature and transport files.

Completed and under final review:

- `apps/ui` uses independent user-facing `features`, not a mirror of backend
  features. Its linted roots are `app`, `platform`, `features`, and `testing`.
- Frontend lint has 14 passing fixtures covering catalogue ownership,
  dependency direction and cycles, owner-only screens, exact narrow surfaces,
  recursive browser-safe closure, and dynamic module loads.
- Prompt is the first export-boundary pilot: its package exposes the owner-only
  `screens/prompt-studio` entry and three narrow `surfaces` entries. This does
  not claim that the full Prompt Studio page or its transport hooks have moved.
- The UI runtime owns the existing Design System provider seam and exact
  `Suspense(fallback={null})`/`RouterProvider` shell shape. The legacy adapter
  still supplies the live outer providers and router, preserving the current
  `platform/app` UI rather than introducing a replacement shell.
- `packages/design-system` has package-local Storybook 10.5.10 using the real
  provider, accessibility/docs addons, and a Foundations, Primitives,
  Components, and Patterns catalogue. Typecheck, 38 tests, and the static
  Storybook build pass.

Next hand-off:

- Keep `LegacyUiShellAdapter` until outer-provider and route closure can move
  without app/server imports. Then move real routes incrementally.
- Complete the Prompt screen only when its real page, hooks, and narrow
  platform transport ports compose in `apps/ui`.
- Add route declarations, overlay intents, composition-hub rationale, and graph
  metrics to frontend lint before those capabilities spread.
- Promote the first genuine app-independent Design System Pattern, then add
  Storybook Vitest/browser interaction coverage for interactive stories.

## Progress

Only committed deletions count as progress:

```sh
git ls-tree -r --name-only HEAD platform/app | wc -l
```

| Ledger item                                                |       Count | Status                                                           |
| ---------------------------------------------------------- | ----------: | ---------------------------------------------------------------- |
| Original application baseline                              | 6,398 files | Reference                                                        |
| Committed `platform/app` at `45aa52e4f5`                   | 5,804 files | Last pre-merge extraction checkpoint                             |
| Committed `platform/app` at `5770224e31`                   | 6,404 files | Authoritative integrated baseline                                |
| Automation cut                                             |    73 fewer | Committed                                                        |
| Coding Agent/GitHub cut                                    |    36 fewer | Committed                                                        |
| Trace processing cut                                       |    45 fewer | Committed                                                        |
| Evaluation processing cut                                  |    42 fewer | Committed                                                        |
| Langy application cut                                      |    37 fewer | Committed                                                        |
| Model Provider application cut                             |    45 fewer | Committed                                                        |
| Workflow application cut                                   |     3 fewer | Committed                                                        |
| Feature-web and Ops composition cuts                       |     5 fewer | Committed                                                        |
| Legacy Feature Flag cut                                    |    21 fewer | Committed                                                        |
| Gateway persistence and policy cut                         |    47 fewer | Committed                                                        |
| Trace projection-persistence cut                           |     8 fewer | Committed                                                        |
| Topic clustering application cut                           |    39 fewer | Committed                                                        |
| Simulation and Suite eventing cut                          |    44 fewer | Partial checkpoint committed                                     |
| Scenario/Suite folder and run-plan cut at `4c7bbddd73`     |    19 fewer | Suite app implementation deleted                                 |
| Scenario version and displaced Suite stack at `4ae157efda` |    16 fewer | Committed and pushed                                             |
| Dataset storage migration at `3442ff8509`                  |     0 fewer | 573 lines removed; app task reduced to composition               |
| Model Provider resolution at `8b2c6b33f1`                  |     8 fewer | Legacy resolver and duplicate tests deleted                      |
| Experiment workbench at `549db70b20`                       |    11 fewer | Legacy workbench service/repository stack deleted                |
| SCIM direct composition at `3f58620f22`                    |     0 fewer | Forwarding runtime adapter deleted; route restored               |
| Monitor guardrail read at `7ceb8544e2`                     |     0 fewer | Two direct Prisma reads removed                                  |
| Trace query/facet compiler at `3f559ed641`                 |    32 fewer | Compiler and 11 unit suites moved intact                         |
| Suite execution fan-out at `7558bc2a97`                    |     1 fewer | Execution policy and five tests canonical                        |
| Simulation legacy read stack at `903fb2e4c5`               |     6 fewer | Canonical service retained; duplicate app implementation deleted |
| Evaluation-wave and caller checkpoints since `fa00f3d7ec`  |    46 fewer | 41 commits; incomplete slices named below                        |

The Automation contract, server and web packages have 559 passing tests, and
their displaced application roots are empty. Coding Agent/GitHub has 266
passing Coding Agent tests, 87 passing GitHub tests with 31 deliberately
skipped, and both old application pipeline roots are empty.

The package-only checkpoints for API, Gateway, Evaluation, Langy, Topic,
Analytics, Workflow, Model Provider, Ops, Share and Secret preserve completed
package work but do not count as application deletion. Their application
cutovers remain explicit ledger work.

## Current gate

| Area                   | Current fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Exit condition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trace process          | The 154-file cut is committed at `ef6c41f1f7`: `+2,208/-12,378`, for a net 45-file application reduction. The required Eventing preparation seam is committed at `cb5feeb6aa`. Old schema imports are zero; Coding tests pass 266/266 and Trace server typechecks.                                                                                                                                                                                                                                                                                | Keep the remaining 18 files only while their named composition/effect responsibilities exist; delete each as its owning feature or worker composition moves.                                                                                                                                                                                                                                                                                                                                                                                           |
| Trace reads            | The projection-persistence move is committed at `64e18e11a6`. The query/facet compiler and 11 unit suites moved at `3f559ed641`, deleting 32 application files. Trace contract has 210 passing tests and Trace server has 1,095. `trace_analytics`, `trace_summaries` and timeseries rollups remain separate repositories and tables.                                                                                                                                                                                                             | Add only the narrow full-trace read/mapping boundary needed by Evaluation, then move edit/protection and usage cohorts while preserving every response field and query semantic.                                                                                                                                                                                                                                                                                                                                                                       |
| Evaluation             | Evaluation processing is committed at `d4f11f4da7`. Its package already owns events, process management and execution intents. The remaining app execution engine depends on full Trace reads and trace mapping/digest types that the Trace contract does not yet expose. Monitor guardrail eligibility is canonical at `7ceb8544e2`.                                                                                                                                                                                                             | First move the portable full-trace evaluation read/mapping boundary, then move the execution engine, factories and cost recorder without a callback-shaped compatibility layer.                                                                                                                                                                                                                                                                                                                                                                        |
| Langy                  | Langy package work is committed at `086250abca`; its 120-file application cut is committed at `b1599b2080`: `+1,001/-10,163`, for a net 37-file application reduction.                                                                                                                                                                                                                                                                                                                                                                            | Prove the focused feature/app checks, then move the remaining eventing pipeline and UI composition without restoring app-layer services.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Model Provider         | Model Provider package work is committed at `435d8711d0`; its 130-file application cut is committed at `14fc0f4282`. The legacy resolution stack and duplicate coverage were removed at `8b2c6b33f1`; contract 169 tests and server 67 tests pass.                                                                                                                                                                                                                                                                                                | Move the remaining UI and process composition without restoring the deleted repositories, catalogue, resolver or service.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Gateway                | Package ownership starts at `9b03f579ee`; the 137-file app cut is committed at `e1ff7b9f3f`, deleting 47 net application files. Gateway package typecheck, 128 server tests and 12 contract tests pass. Twenty app service modules remain.                                                                                                                                                                                                                                                                                                        | Move the remaining virtual-key, config/materialisation, guardrail, cache and realtime collaborators behind the same canonical Gateway service; remove the final `getApp` route.                                                                                                                                                                                                                                                                                                                                                                        |
| Topic                  | Package ownership is committed at `ee3c64f882`; the 56-file app cut is committed at `1f0ee01ec9`, deleting both old roots and 39 net application files. Topic typechecks and 157 tests pass. Docker integration was unavailable.                                                                                                                                                                                                                                                                                                                  | Clear the strict-layout and relocated task/test import findings without restoring app business logic; rerun Testcontainers integration where Docker exists.                                                                                                                                                                                                                                                                                                                                                                                            |
| API framework          | The first-class REST surface is committed package-only at `755db4b875`. No caller uses it. Its package checks pass, but its RPC and REST builder types still need separating before adoption.                                                                                                                                                                                                                                                                                                                                                     | During the `apps/api` cut, adopt mandatory Zod input/output schemas and `/api/v1/{service}/{optional date-or-latest}/{endpoint}`, with the date version also accepted by header. Do not churn current routes first.                                                                                                                                                                                                                                                                                                                                    |
| Feature Flag           | The canonical package is committed at `607f5e728e`; the 23-file legacy cleanup is committed at `d191ef8c32`, deleting the old server implementation and PostHog local-evaluation copy. Source imports of the old boundary are zero.                                                                                                                                                                                                                                                                                                               | Move the remaining browser/API/worker composition during the physical app split; do not restore app-owned flag rules, stores or services.                                                                                                                                                                                                                                                                                                                                                                                                              |
| UI and feature web     | Active inventory: `apps/ui` is already the passing three-source-file `@langwatch/ui` runtime shell and `platform/app/src/main.tsx` delegates mounting to it, but it has no HTML entry, Vite config or build script. The Vite build, 149-route router, providers, route/page composition and compatibility adapter remain in `platform/app`. The browser tree has 99 production and 149 total direct server/app-layer importers. The 21 core and four Enterprise feature web surfaces are reusable browser packages, not a second web application. | Take reusable feature UI before the physical app cut. Start with Prompt after reconciling the open, currently conflicting PR 7371: the app-owned Prompt tree alone has 97 production files, including 18 tRPC-hook files, three server-type edges, four generated-Prisma edges and 12 cross-feature app importers. Keep transport hooks and route composition in `apps/ui`; move controlled Prompt presentation and browser behaviour to `@langwatch/prompt-web`, then cut the physical bootstrap only when it produces a runnable browser-safe build. |
| Evaluation wave        | Experiment workbench persistence/versioning is canonical at `549db70b20`: 49 files changed and 5,148 lines removed, with 5,114 package tests green. Monitor owns the guardrail eligibility query. Evaluator is active; the duplicate Simulation app read stack was deleted at `903fb2e4c5`. Strict-layout findings and some app proof remain red.                                                                                                                                                                                                 | Drain the remaining execution adapters, transports, runtime, workers and reusable UI. A moved process manager alone does not complete a feature.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Scenario and Suite     | Scenario versioning is committed at `4ae157efda`. Simulation's duplicate app read stack was deleted at `903fb2e4c5`. Inventory found a circular Scenario/Simulation feature dependency around the same scenario-run domain. Suite execution fan-out moved at `7558bc2a97`; Suite server typecheck and 44 tests pass.                                                                                                                                                                                                                              | Collapse Simulation package ownership into singular Scenario while retaining authoring and durable run lifecycle as separate internal collaborators. Preserve Simulation routes, wire/event names, tables and projections as compatibility vocabulary. Keep Suite independent.                                                                                                                                                                                                                                                                         |
| Trace boundary         | The old request-collection service, its app-owned types and its unit suite are deleted. Query/facet compilation is canonical at `3f559ed641`; old-path residue is zero. Public outputs, query pagination, tables and ingestion were untouched.                                                                                                                                                                                                                                                                                                    | Add the narrow required full-trace Evaluation read and mapping/digest ownership. Continue with protection/edit and usage readers without changing `trace_analytics`, `trace_summaries`, rollups or public response fields.                                                                                                                                                                                                                                                                                                                             |
| Integration checkpoint | The one merge of `origin/main` at `5a9cd02001` is committed at `5770224e31` with no unmerged paths, conflict markers, stale `@ee` imports, old Prisma migration root or `platform/app/ee`. Upstream added 600 net application files to the 5,804-file pre-merge checkpoint, leaving a 6,404-file integrated baseline.                                                                                                                                                                                                                             | Push the resolved merge, then resume deletion from the named residuals below. Do not count upstream integration as extraction progress.                                                                                                                                                                                                                                                                                                                                                                                                                |

Physical movement in the shared worktree is not progress until its exact paths
are reviewed and committed. Forecasts below are ranges, not substitutes for a
named proof or commit.

Pre-merge focused proof is green for all 15 Evaluation-wave package
typechecks, Trace server typecheck and 633 tests, Suite's 28 tests, and 118
focused application tests. Architecture review remains red and is not being
called green: the full report includes 470 legacy-fragment findings, 104 stale
baseline entries, 14 test-quality findings, 14 hard comment-block failures and
218 soft comment reviews. These remain extraction/repair work after the merge.

Post-merge package proof is green for the 21 affected AuthZ, Experiment,
Simulation, Suite, Trace, Governance, SCIM and SSO package programs. Governance
has 521 passing tests and SCIM has 74. Prisma generation and schema validation
are green. The application typecheck remains an explicit red integration
baseline at 1,232 diagnostics across 378 files; it is not being described as a
successful merge check.

Main introduced four temporary application-owned behaviour cohorts. Scenario
version history and Suite folder/scope/run-plan semantics are now canonical
package behaviour; Experiment workbench persistence/versioning and legacy
Simulation ClickHouse read/export remain application-owned residuals. SCIM
lifecycle/config and Governance trace-ingestion composition also remain
explicit process residuals. They were preserved for parity rather than
silently dropped or pretended to be complete.

## Deletion queue

The next committed batches after the `origin/main` merge are:

1. **Evaluator vertical:** land the active dependency-closed cut.
2. **Evaluation full-trace prerequisite:** expose the narrow portable Trace
   read/mapping capability required by Evaluation execution; do not pass a
   callback bag or legacy Trace service.
3. **Evaluation execution:** move the app execution service, factories and
   cost recorder after the Trace prerequisite, preserving event and API parity.
4. **Evaluation-wave repair:** clear the recorded strict-layout, repository,
   subscriber and test-quality findings without restoring app implementations.
5. **Scenario ownership collapse:** merge the Simulation packages into the
   singular Scenario feature without changing public Simulation vocabulary,
   persistence or Eventing. Keep definition authoring and run lifecycle as
   separate internal collaborators behind one feature contract; remove the
   catalogue split and circular feature dependency.
6. **Evaluation-wave completion:** drain the remaining execution adapters,
   transports, workers and reusable UI across Evaluation, Evaluator, Monitor,
   Experiment, Scenario and Suite.
7. **UI/web lane (active):** the initial ownership and dependency inventory
   rejects a bulk `apps/ui` move while its route graph still reaches application
   and server implementation. Reconcile the redesign in
   [PR 7371](https://github.com/langwatch/langwatch/pull/7371) as the starting
   implementation for the Prompt web package and `apps/ui` composition. Do not
   migrate the displaced Prompt UI first and rewrite it again. Review the PR
   against the current Prompt contract and preserve every live transport and
   browser behaviour it does not replace. Keep `apps/ui` limited to browser
   bootstrap, routing and page composition; reusable Prompt behaviour belongs
   in `@langwatch/prompt-web`.
8. **Trace edit overlay and protection:** move the 18-file edit/protection core
   and its behavioural coverage.
9. **Trace usage readers:** move the five usage-owned readers to Usage/Billing,
   not into the Trace service merely because they currently live under Trace.
10. **API composition:** adopt the parked REST surface when `apps/api` is
    created; do not churn current routes before that physical cut.

The remainder of Evaluation and the other feature slices remain open. They are
not completion fallout from the batches above:

| Remaining slice                                                | Required deletion boundary                                                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluation, Evaluator, Monitor, Experiment, Scenario and Suite | Move each complete implementation with its tests and process composition. Scenario owns the existing Simulation run lifecycle and compatibility vocabulary.                              |
| Identity and tenancy                                           | Drain Auth, User, AuthZ, Role, Organization, Project and API Key without creating a second repository or service graph.                                                                  |
| Product features                                               | Drain Model Provider, Prompt, Dataset, Agent, Workflow, Analytics, Dashboard, Topic, Gateway, Langy, Annotation and Share as independent verticals.                                      |
| Data and operations                                            | Drain Data Privacy, Data Retention, Secret, Stored Object, Ops and licensed Enterprise seams into their declared owners and process composition.                                         |
| Browser and process composition                                | Move reusable UI to feature web packages or the Design System; move route, API, worker and browser composition to `apps/api`, `apps/worker` and `apps/ui`.                               |
| Infrastructure and repository support                          | Move boot/config, Prisma, Redis, ClickHouse, queues, mail, storage, observability, scripts, tests and assets to named owners. Leave the existing root specs in place for this migration. |

A later slice receives an exact file count only when it is inventoried against
the then-current committed tree. Stale macro counts and low import counts are
not evidence of completion.

## Working forecast

The committed `903fb2e4c5` baseline contains 6,311 application files. Of the
`4ae157efda` baseline's 6,369 files,
3,504 are production TypeScript, 2,395 are TypeScript tests, and 486 are other
tests, scripts, assets, Prisma files, configuration and documentation. The
architecture fragment baseline identifies 255 displaced implementations, 98
transports, 26 composition files, two infrastructure adapters and 575 page
shells. Those classified files are the main semantic cut; the remaining count
is mostly reusable browser code, tests and physical process/support movement.

All 50 catalogue features already have a package owner. There are 49 contract,
48 server and 25 web package surfaces, and `apps/api`, `apps/ui` and
`apps/worker` already have runtime shells. The remaining work is therefore not
6,369 greenfield implementations, but neither is it a bulk rename: ownership,
parity and process boot still have to be proved.

The forecast assumes three continuously active migration lanes plus one review
lane, no new upstream merge, and focused slice proof where the full application
baseline is independently red.

| Wave                             | Dependency-closed result                                                                                                                                        | Likely elapsed range |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------: |
| Scenario gate                    | Committed and pushed at `4ae157efda`; 16 application files removed                                                                                              |             Complete |
| Experiment and Evaluation family | Workbench versioning, SCIM/Governance composition, then Evaluation/Evaluator/Monitor/Experiment/Simulation completion                                           |            1–3 weeks |
| Remaining server owners          | Drain the 255 classified legacy implementations and their 98 transports into existing feature packages                                                          |            2–4 weeks |
| Feature web and UI               | Move reusable browser behaviour into feature web packages, use Prompt PR 7371, and leave only route/page composition for `apps/ui`                              |            3–6 weeks |
| Physical processes and support   | Cut API, worker and UI boot into their app shells; move tests, E2E, scripts, assets, Prisma/config and docs; leave root specs alone; remove external references |            2–4 weeks |
| Final integration                | Integrate fresh `origin/main`, resolve into canonical owners, and run parity/deletion proof                                                                     |            1–2 weeks |

Several waves overlap. The current whole-program range is **8–12 elapsed weeks
if the mechanical web/process movement stays mechanical, and 12–18 weeks as
the working likely range**. Re-estimate after the Experiment/Evaluation gate:
that is the first point where the remaining rate is based on two complete
post-merge verticals rather than one.

## Batch proof

Every deletion batch records:

1. the before/after committed `platform/app` count and exact deleted paths;
2. canonical contract/server/web ownership and the process composition root;
3. unchanged API, auth, response, eventing, persistence and UI behaviour;
4. moved behavioural coverage and package/focused application tests;
5. Oxfmt, Oxc, architecture lint, test-quality review and `git diff --check`;
6. a residue search showing no old implementation, with every deliberate
   compatibility or composition adapter named; and
7. a runtime-boundary review proving an `App*Runtime` depends only on a named
   service/runtime adapter, never concrete infrastructure options; remove a
   forwarding wrapper when it owns no application lifecycle, and introduce an
   abstract base or inheritance only when multiple implementations justify it;
   and
8. one coherent commit containing only the reviewed slice.

No batch is complete merely because files moved out of the physical tree.
Transports, pages, workers, tests and documentation move with their owner or are
named as deliberate process composition in that same batch. Existing root specs
stay where they are and are not rewritten as part of extraction.

## Final deletion

After the feature, composition, infrastructure and repository-support queues
are empty:

1. remove every external `platform/app` reference from workspace configuration,
   CI, containers, deployment, scripts, generated outputs and architecture
   baselines;
2. delete `platform/app` and prove `test ! -e platform/app`;
3. fetch and integrate fresh `origin/main`, resolving conflicts into the new
   owners rather than restoring application code; and
4. rerun the full workspace, parity and deletion proof on the integrated commit.
