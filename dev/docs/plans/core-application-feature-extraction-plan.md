# Platform application exit ledger

**Updated:** 2026-08-28

**Committed application baseline:** `99c65c0848` — 6,307 tracked files; 5,951 under
`platform/app/src`.

**Goal:** delete `platform/app`.

**Working checkpoint HEAD:** `3d1166d8cc` on
`feat/strict-feature-layout-v0`. The shared working tree is unstaged at this
checkpoint; only reviewed exact-path slices may be staged.

This ledger records committed progress, the current review gate, and the next
dependency-closed deletion batches. Feature ownership remains defined by
`packages/features/catalogue.json` and the accepted architecture in
[ADR-101](../adr/101-feature-package-surfaces.md),
[ADR-111](../adr/111-physical-application-workspaces.md), and
[ADR-112](../adr/112-singular-feature-ownership.md).
Non-blocking structural improvements discovered during extraction are recorded
in [the follow-up ledger](core-application-feature-extraction-future-work.md).
The current branch state and next-agent instructions are recorded in the
[extraction hand-off](core-application-feature-extraction-handoff.md). The
REST, tRPC and Secret restart point is recorded separately in the
[API transport hand-off](api-transport-extraction-handoff.md).

## 2026-08-28 working checkpoint

Two independent foundations are committed:

- `410c5dc1eb` enforces the two-scope feature-web layout, including global
  `model`, `behavior`, `ui`, `screens` and `surfaces`, private
  `features/<feature>/{model,behavior,ui}`, exact screen/surface entries,
  declared cross-feature dependencies and cycle detection. Its focused
  typecheck, Oxfmt, diff check and 20 tests pass.
- `3d1166d8cc` adds the semantic OpenAPI 3 JSON comparator under
  `tools/openapidiff` and `cmd/openapidiff`, including recursive component and
  Path Item reference handling, OAS 3.1 boolean schemas, deterministic
  human/JSON output, strict validation mode and CI coverage. Go test, race,
  vet, focused golangci-lint, formatting and diff checks pass.

The following reviewed work is present but is not committed progress yet:

| Slice                 | Current proof                                                                                                                                                                                                                                                                                                                                                                                                                                 | Remaining gate                                                                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent web/UI          | Two-scope package layout, narrow `apps/ui` RPC adapter and platform host are complete. Agent web typecheck and 24 tests, UI typecheck and 10 tests, and six real-composition host tests pass. The review-blocking copy/push, permission-disabled and Cancel cases are covered.                                                                                                                                                                | Run the final exact-path migration review, stage only the Agent paths and exact manifest/baseline hunks, then commit. Retained legacy Agent drawers are named follow-up slices.                                                                                                                             |
| Trace full-read       | Package mapper preserves normalized stored spans, legacy event identity/timestamps, metrics/error precedence, metadata, bounded JSON recall and the dropped-privacy marker. Trace contract typecheck and 212 tests, Trace server typecheck and 1,108 tests, app typecheck, formatting and focused lint pass.                                                                                                                                  | Root migration review and exact-path commit. Public viewer-specific detail/export/thread reads remain deliberate app residuals; no deletion is safe in this internal-only batch.                                                                                                                            |
| tRPC/AuthZ            | `@langwatch/trpc` owns generic typed root creation. AuthZ owns scope-lineage decisions over its repository; the old app Prisma guard and test are deleted. AuthZ server typecheck and seven focused cases pass.                                                                                                                                                                                                                               | Reconcile workspace links/lockfile, export or replace the missing `BlankScopeIdError`, run tRPC/app suites, then compose the live API server policy. The named legacy Next/SSG `getApp()` fallback remains only in the app context adapter.                                                                 |
| Secret/API            | Modern REST and retained named compatibility adapters are present. `apps/api` owns one injected tRPC root and a typed Secret caller pilot.                                                                                                                                                                                                                                                                                                    | Real API boot/server, process observability, request policy, and Secret plus Agent callable routers are not complete. Add real auth/permission coverage before any live cutover.                                                                                                                            |
| Worker/Eventing/Topic | `WorkerEventingRuntime` constructs consumer-enabled EventSourcing from explicit EventStore, queue factory, durable ProcessStore, execution target and retention. Startup installs feature pipelines before queue readiness; shutdown drains feature/Eventing/lifecycle/resources. Topic registers on that runtime, owns seeds and manual command dispatch. Topic server has 158 passing tests; focused process/runner/boot/manual tests pass. | Compose production Prisma/EventStore/ProcessStore, Group Queue, ClickHouse, Redis, model provider, Langevals, metrics, Trace assignment pipeline, logging/tracing and typed config. Workspace links must be reconciled before worker/API typechecks. Keep live app Topic until those dependencies are real. |
| Process observability | `@langwatch/observability/node` provides one process-owned logger/tracer graph, SDK diagnostic routing and idempotent shutdown; typecheck and 123 tests pass.                                                                                                                                                                                                                                                                                 | Construct it once in API and worker boot, bind request/queue context, and flush after drain. UI may use only the browser-safe logging root.                                                                                                                                                                 |

No current shared-worktree deletion counts as application-exit progress until
its owning slice passes migration review and is committed.

## Decisions due soon

1. **Shared Eventing infrastructure home.** Choose a non-feature process
   adapter package for durable EventStore/ProcessStore, retention and shared
   queue composition, or explicitly extend existing infrastructure packages.
   The recommendation is one small process/Eventing adapter package rather
   than putting cross-process stores into Topic or `apps/worker`.
2. **ClickHouse responsibility.** Decide whether the managed tenant-aware
   resolver becomes part of `@langwatch/clickhouse-client` or the new process
   adapter package. It must receive tenant resolution and typed config, not env
   or global Prisma access.
3. **Group Queue payload offload.** Select the shared storage adapter and
   configuration owner for large queued payloads. This must preserve existing
   staging headers, cleanup, limits and retry semantics before worker cutover.
4. **Enterprise model catalogue at the worker boundary.** Choose an injected
   Enterprise capability or a core-safe catalogue implementation. Core worker
   composition cannot import Enterprise implementations directly.
5. **First Agent API surface.** Decide whether the new API root initially
   mounts the complete compatibility Agent router or only the procedures used
   by the extracted Agent browser port. The recommendation is the complete
   thin router to preserve names/shapes while keeping one Agent service graph.
6. **API activation boundary.** Decide when the new API server receives live
   traffic. The recommendation is to make Secret and Agent callable with full
   auth/log/trace policy first, run it alongside the current platform root,
   then switch routing only after parity tests pass.
7. **Legacy Secret client retirement.** Retained unversioned REST/public RPC
   cannot be deleted until TypeScript, Python, Go and MCP callers have a
   separately reviewed migration and release plan.
8. **Trace full-read audience.** Keep the new full-read service internal and
   all-visible for Evaluation, or make it actor-aware before public reuse. The
   current caller search supports the internal-only choice; public protected
   reads should remain on their existing path until their own vertical moves.

## Active UI/web lane hand-off

The frontend lane owns `apps/ui`, the Prompt web-package export pilot,
frontend architecture lint, and `packages/design-system` Storybook. The backend
API checkpoints are committed. The remaining Secret and Agent
server/composition work is present in the shared working tree and must be kept as
separate reviewed batches after this frontend integration.

Frontend checkpoint: `1d3e93022f` owns the Prompt boundary and lint,
`897622d6b0` owns the exact shell and Storybook, and `cad35bcd19` contains only
Oxfmt changes to touched legacy callers. The combined frontend/API integration
is committed at `13a0805bf3`; the operational hand-off is committed at
`8f2986764e` and updated in the working tree as review facts change.

Integration note for the concurrent Agent UI work: browser RPC ports and
adapters belong under `apps/ui/src/features/agent`, not directly under
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
- Review and commit the UI-local architecture records under `apps/ui/adrs`.
- Keep Agent and Secret/API work in separate migration-review batches. Agent
  UI checks/readiness are available, but the repair is still uncommitted.
  Secret modern REST is present alongside retained unversioned REST/public RPC;
  docs-reference paths are now corrected; real-auth coverage remains a blocker,
  while full docs page generation is blocked by unrelated stale Roles ordering.

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
| Evaluator execution resolution at `0083d4e435`             |     4 fewer | Canonical resolution and error behaviour committed               |
| Scenario ownership collapse at `99c65c0848`                |     0 fewer | 186-file package consolidation; old Simulation package deleted   |
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

| Area                   | Current fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Exit condition                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace process          | The 154-file cut is committed at `ef6c41f1f7`: `+2,208/-12,378`, for a net 45-file application reduction. The required Eventing preparation seam is committed at `cb5feeb6aa`. Old schema imports are zero; Coding tests pass 266/266 and Trace server typechecks.                                                                                                                                                                                                                                                | Keep the remaining 18 files only while their named composition/effect responsibilities exist; delete each as its owning feature or worker composition moves.                                                                        |
| Trace reads            | The projection-persistence move is committed at `64e18e11a6`; the query/facet compiler and 11 suites moved at `3f559ed641`. The uncommitted full-read slice now owns a parity mapper, bounded/deduped payload recall, canonical IO, event identity/timestamps, metrics/errors/metadata and an explicit internal all-visible policy. Focused contract/server/app proof is green. Public viewer protection, annotations and edit overlays remain app-owned residuals.                                               | Root migration-review and commit the internal slice. Move public protection/edit and usage cohorts only in their own parity-proven verticals; keep analytics, summaries and timeseries repositories distinct.                       |
| Evaluation             | Evaluation processing is committed at `d4f11f4da7`. Evaluator execution resolution is canonical at `0083d4e435`; its old scalar and slug helpers are deleted. Schema/ADR repair is complete, but evaluation-server typecheck is blocked because `TestTraceService` lacks the new full-read methods. Execution remains blocked on concrete Trace repository/blob composition. Monitor guardrail eligibility is canonical at `7ceb8544e2`.                                                                          | Complete the Trace full-read implementation and test seam, then move execution, factories and cost recorder without a callback-shaped compatibility layer.                                                                          |
| Langy                  | Langy package work is committed at `086250abca`; its 120-file application cut is committed at `b1599b2080`: `+1,001/-10,163`, for a net 37-file application reduction.                                                                                                                                                                                                                                                                                                                                            | Prove the focused feature/app checks, then move the remaining eventing pipeline and UI composition without restoring app-layer services.                                                                                            |
| Model Provider         | Model Provider package work is committed at `435d8711d0`; its 130-file application cut is committed at `14fc0f4282`. The legacy resolution stack and duplicate coverage were removed at `8b2c6b33f1`; contract 169 tests and server 67 tests pass.                                                                                                                                                                                                                                                                | Move the remaining UI and process composition without restoring the deleted repositories, catalogue, resolver or service.                                                                                                           |
| Gateway                | Package ownership starts at `9b03f579ee`; the 137-file app cut is committed at `e1ff7b9f3f`, deleting 47 net application files. Gateway package typecheck, 128 server tests and 12 contract tests pass. Twenty app service modules remain.                                                                                                                                                                                                                                                                        | Move the remaining virtual-key, config/materialisation, guardrail, cache and realtime collaborators behind the same canonical Gateway service; remove the final `getApp` route.                                                     |
| Topic                  | Package ownership is committed at `ee3c64f882` and the earlier app cut at `1f0ee01ec9`. The uncommitted package installer now mounts Topic on `WorkerEventingRuntime`; EventSourcing owns queue command/event dispatch, projections, process-manager wakes, intents, redelivery/idempotency and shutdown. Topic has 158 passing tests. The live app remains because production stores, Group Queue, Trace assignment consumption, model/ClickHouse/Langevals/Redis/metrics and typed config are not yet composed. | Decide the shared process-adapter boundaries, compose the real API producer and worker consumer graphs, prove links/typechecks/integration, then delete the displaced live Topic registry/runtime/task paths.                       |
| API framework          | REST foundation is committed at `5f7f2046dc`, lint at `0b65dc696d`, boundary ADR at `6d86932ce9`, and semantic OpenAPI comparison at `3d1166d8cc`. Secret modern REST and named legacy adapters are uncommitted. `@langwatch/trpc` and AuthZ scope-lineage extraction are implemented but await workspace links and two blank-scope test repairs. `apps/api` has only a typed Secret caller pilot, not a production server with Secret and Agent mounted.                                                         | Reconcile dependencies, prove tRPC/AuthZ suites, construct one logged/traced API server with real request policy and callable Secret/Agent routers, add real Secret auth/permission coverage, then choose the live routing cutover. |
| Feature Flag           | The canonical package is committed at `607f5e728e`; the 23-file legacy cleanup is committed at `d191ef8c32`, deleting the old server implementation and PostHog local-evaluation copy. Source imports of the old boundary are zero.                                                                                                                                                                                                                                                                               | Move the remaining browser/API/worker composition during the physical app split; do not restore app-owned flag rules, stores or services.                                                                                           |
| UI and feature web     | The two-scope layout is committed and enforced at `410c5dc1eb`. Agent is the complete uncommitted pilot: package/UI typechecks, 24 Agent tests, 10 UI tests and six real host tests pass, including copy/push selection, permission-disabled and Cancel paths. Retained behavior-owning Agent drawers are explicit next slices. Prompt remains only an export-boundary pilot.                                                                                                                                     | Root migration-review and commit Agent as an exact slice. Then move each retained drawer vertically; complete Prompt only when its real page, hooks and narrow transport ports compose in `apps/ui`.                                |
| Evaluation wave        | Experiment workbench persistence/versioning is canonical at `549db70b20`: 49 files changed and 5,148 lines removed, with 5,114 package tests green. Monitor owns the guardrail eligibility query. Evaluator is active; the duplicate Simulation app read stack was deleted at `903fb2e4c5`. Strict-layout findings and some app proof remain red.                                                                                                                                                                 | Drain the remaining execution adapters, transports, runtime, workers and reusable UI. A moved process manager alone does not complete a feature.                                                                                    |
| Scenario and Suite     | Scenario owns Scenario definition and Simulation run lifecycle at `99c65c0848`; the old Simulation package has zero files. The 186-file collapse changed `+1,078/-1,633` and retained all 22 test files. Contract tests pass 230; web passes 98 with one skip; moved server review passes 245; focused lifecycle passes 105; replay/backfill passes 6; package typechecks pass.                                                                                                                                   | Drain the remaining app Scenario fragments without changing Simulation routes, wire/event names, tables or projections. Keep Suite independent. ClickHouse integration still requires a container runtime.                          |
| Trace boundary         | The old request-collection service, its app-owned types and its unit suite are deleted. Query/facet compilation is canonical at `3f559ed641`; old-path residue is zero. Public outputs, query pagination, tables and ingestion were untouched.                                                                                                                                                                                                                                                                    | Add the narrow required full-trace Evaluation read and mapping/digest ownership. Continue with protection/edit and usage readers without changing `trace_analytics`, `trace_summaries`, rollups or public response fields.          |
| Integration checkpoint | The one merge of `origin/main` at `5a9cd02001` is committed at `5770224e31` with no unmerged paths, conflict markers, stale `@ee` imports, old Prisma migration root or `platform/app/ee`. Upstream added 600 net application files to the 5,804-file pre-merge checkpoint, leaving a 6,404-file integrated baseline.                                                                                                                                                                                             | Push the resolved merge, then resume deletion from the named residuals below. Do not count upstream integration as extraction progress.                                                                                             |

Physical movement in the shared worktree is not progress until its exact paths
are reviewed and committed. Each parity-proven vertical must delete its safely
displaced `platform/app` production paths in a coherent exact-path commit;
compatibility preparation is not a substitute for deletion. Forecasts below are
ranges, not substitutes for a named proof or commit.

Current web contract `410c5dc1eb` is committed with its exact four ADR/spec/
linter/test files; focused typecheck, Oxfmt and diff are green with 20/20 tests.
Recursive closure permits screen-to-own-narrow-surface and
surface-to-package-global-portable-model edges. Agent is complete and its
follow-up migration review findings are fixed. It remains unstaged/uncommitted
pending root exact-path review: Agent web has 24 tests and typecheck, `apps/ui`
has 10 tests and typecheck, the real platform host has six passing tests,
frontend-only lint is green, and intended platform Agent production deletions
are in the slice.

Trace full-read is commit-ready for root review. The package-owned mapper now
preserves the normalized stored fields, bounded/deduped payload recall, legacy
event identity/timestamps, metrics/error precedence, metadata and privacy
marker. The seam is internal-only with an explicit all-visible policy. Public
viewer-specific protection, annotations and edit overlays remain named
application residuals, so this batch deletes no live app read path.

The Go OpenAPI comparison tool is committed at `3d1166d8cc`. HEAD-to-worktree
facts remain platform 10 removed legacy RPC operations and 15 added modern
operations, and docs 5 removed and 15 added. Broad `origin/main` drift predates
the worktree; strict mode also exposes unrelated existing empty Responses
Objects rather than treating them as migration differences.

Scenario's inherited strict-layout, subscriber and service-quality findings,
and its remaining application fragments, stay as residual work. No baseline was
added for the collapse.

Pre-merge focused proof is green for all 15 Evaluation-wave package
typechecks, Trace server typecheck and 633 tests, Suite's 28 tests, and 118
focused application tests. Architecture review remains red and is not being
called green: the full report includes 470 legacy-fragment findings, 104 stale
baseline entries, 14 test-quality findings, 14 hard comment-block failures and
218 soft comment reviews. These remain extraction/repair work after the merge.

Post-merge package proof is green for the 21 affected AuthZ, Experiment,
Scenario, Suite, Trace, Governance, SCIM and SSO package programs. Governance
has 521 passing tests and SCIM has 74. Prisma generation and schema validation
are green. The application typecheck remains an explicit red integration
baseline at 1,232 diagnostics across 378 files; it is not being described as a
successful merge check.

Main introduced four temporary application-owned behaviour cohorts. Scenario
version history, Simulation lifecycle and Suite folder/scope/run-plan semantics
are canonical package behaviour; remaining app Scenario fragments and
Experiment workbench persistence/versioning are explicit residuals. SCIM
lifecycle/config and Governance trace-ingestion composition also remain
explicit process residuals. They were preserved for parity rather than
silently dropped or pretended to be complete.

## Deletion queue

Worker physical-entrypoint inventory and the first Eventing mount are complete
but uncommitted. Governed package-only roots live under
`apps/worker/src/{app,platform,features}` with testing support and a worker ADR.
`WorkerEventingRuntime` owns consumer EventSourcing, queue readiness and orderly
shutdown; Topic registers its pipeline, starts boot seeds and exposes manual
command dispatch through that runtime. There is no `platform/app` or app-layer
import. It is not deployment-ready until durable process adapters, Group Queue,
Trace assignment consumption and the remaining production dependencies are
composed and workspace links are reconciled.

The next committed batches after the `origin/main` merge are:

1. **Scenario ownership collapse:** committed at `99c65c0848`; Simulation is
   compatibility vocabulary inside the singular Scenario feature.
2. **Agent web (review-ready, uncommitted):** architectural and follow-up review
   blockers are closed. Focused package/UI/host tests, permission-disabled and
   Cancel paths, and post-push refresh parity are green. Root must perform the
   exact-path migration review and commit this batch without the retained
   behavior-owning legacy drawers.
3. **Secret modern REST (active, uncommitted):** retain old unversioned
   REST/public RPC mounts for released SDK, Python, Go and MCP callers; publish
   only modern `/api/v1/secret` in preferred and docs OpenAPI; add real auth
   coverage, then delete only displaced production code. Full docs page
   generation remains blocked by unrelated Roles ordering.
4. **Internal tRPC/AuthZ (active, non-production):** finish workspace-link/lock
   reconciliation and the blank-scope error export, then prove the generic
   `@langwatch/trpc` root and AuthZ-owned scope-lineage policy. Compose one
   process-owned API root with Secret and Agent routers plus request/auth/audit/
   log/trace policy. The live root remains unchanged until parity is proven.
5. **Topic clustering/Eventing (active, uncommitted):** retain the completed
   package installer and worker Eventing mount, then provide the production
   process capabilities and register both Topic and Trace assignment consumers.
   Delete displaced `platform/app` Topic registration/production only after the
   API producer and deployable worker consumer roots are proven.
6. **Trace/Evaluation full-read (review-ready):** review and commit the narrow
   internal portable Trace read/mapping capability required by Evaluation. Do
   not expand it into the public viewer-protection surface in this batch.
7. **Evaluation execution:** move the app execution service, factories and
   cost recorder after the Trace prerequisite, preserving event and API parity.
8. **Evaluation-wave repair:** clear the recorded strict-layout, repository,
   subscriber and test-quality findings without restoring app implementations.
9. **Evaluation-wave completion:** drain the remaining execution adapters,
   transports, workers and reusable UI across Evaluation, Evaluator, Monitor,
   Experiment, Scenario and Suite.
10. **Prompt web:** reconcile the redesign in
    [PR 7371](https://github.com/langwatch/langwatch/pull/7371) as the starting
    implementation for the Prompt web package and `apps/ui` composition. Do not
    migrate the displaced Prompt UI first and rewrite it again. Review the PR
    against the current Prompt contract and preserve every live transport and
    browser behaviour it does not replace. Keep `apps/ui` limited to browser
    bootstrap, routing and page composition; reusable Prompt behaviour belongs
    in `@langwatch/prompt-web`.
11. **Trace edit overlay and protection:** move the 18-file edit/protection core
    and its behavioural coverage.
12. **Trace usage readers:** move the five usage-owned readers to Usage/Billing,
    not into the Trace service merely because they currently live under Trace.
13. **API composition:** adopt the parked REST surface when `apps/api` is
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

The committed `99c65c0848` baseline contains 6,307 application files, including
5,951 under `platform/app/src`. Of the
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

| Wave                             | Dependency-closed result                                                                                                                                                                     | Likely elapsed range |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------: |
| Scenario gate                    | Ownership collapsed at `99c65c0848`; old Simulation package zero, app residuals named                                                                                                        |             Complete |
| Experiment and Evaluation family | Workbench versioning, SCIM/Governance composition, then Evaluation/Evaluator/Monitor/Experiment/Simulation completion                                                                        |            1–3 weeks |
| Remaining server owners          | Drain the 255 classified legacy implementations and their 98 transports into existing feature packages                                                                                       |            2–4 weeks |
| Feature web and UI               | Continue from the Prompt export pilot and exact shell: move real pages and controlled browser behaviour into feature-web packages while route and transport composition remains in `apps/ui` |            3–6 weeks |
| Physical processes and support   | Cut API, worker and UI boot into their app shells; move tests, E2E, scripts, assets, Prisma/config and docs; leave root specs alone; remove external references                              |            2–4 weeks |
| Final integration                | Integrate fresh `origin/main`, resolve into canonical owners, and run parity/deletion proof                                                                                                  |            1–2 weeks |

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
