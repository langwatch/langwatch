# Platform application exit plan

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Working checkpoint:** `367178c4be`

**Current execution waves:** Wave 3 internal tRPC + strict-layout hygiene

**State as of `367178c4be`.** Fifty-one package-owned tRPC APIs are written
across `packages/**/server/src/api/app-trpc/`, in thirty-five feature packages.
The transport surface now stands in three shapes, and the difference between
them is the whole remaining job:

| Shape | Count | Where the mount lives | Imports from `platform/app` |
| --- | --- | --- | --- |
| Mounted from `apps/api` | 9 routers | `apps/api/src/features/*/…-trpc.mount.ts` | none |
| Mounted from `platform/app` | 19 routers | `platform/app/src/runtime/app/internal-api/*.router.ts` | root, policy chain, some services |
| Not yet moved | 44 routers | `platform/app/src/server/api/routers/*.ts` | everything |

Seventy-two router files remain under `server/api/routers/`. Nine of them are
already thin compositions that import their behaviour from
`@langwatch/platform-api/app-trpc` and hold no logic; the other sixty-three
still own their procedures outright.

**The `apps/api` shape is the target, and it is already reachable.**
`platform/app` declares `@langwatch/platform-api` as a workspace dependency and
the `./app-trpc` subpath is exported, so a mount placed in `apps/api` can be
consumed by `root.ts` today — nothing needs to be built or published first.
`apps/api/src/app-trpc/app-trpc.policy.ts` imports only types from
`@langwatch/authz-contract` and takes the process's concrete middlewares as a
parameter, which is what keeps the dependency pointing the right way.

**The nineteen `internal-api` mounts are not yet movable, and the reason is
specific.** Each one reaches into `~/server/api/trpc.root`,
`~/server/api/trpc.runtime-policy`, `~/server/api/trpc.scope-lineage-middleware`
and `~/server/app-layer/authz/trpc-middleware` — roughly 1,900 lines of policy
spine that still lives in `platform/app`. Several also reach feature services
that have not been extracted yet (`~/server/modelProviders/*`,
`~/server/app-layer/traces/*`, `~/utils/modelLimits`, `~/utils/safeRegex`).
Moving the spine into `@langwatch/trpc` unblocks all nineteen at once; moving
those services is a separate, smaller wave. Until then, a mount in
`internal-api` is the correct intermediate rather than a regression: it holds a
policy chain and a service handoff, and no feature behaviour.

Waves 1 and 2 are closed. Wave 3's internal-tRPC column is now the active
front, running beside the architecture-lint hygiene the strict layout needs in
order to mean anything. Parallel work still requires independent file
ownership: the concurrent transport verticals each own their own routers and
their own package, and none of them edits `server/api/root.ts` — the mount
point is applied once, centrally, because four agents editing one import block
would clobber each other.

**Goal:** delete `platform/app` after its UI, API, worker, configuration,
backend, tests, assets and deployment responsibilities have canonical owners.

This is the executable ledger for the whole exit. It replaces the earlier
historical narrative with ordered work, dependencies, deletion boundaries and
verification gates. The shorter operational restart notes remain in the
[core hand-off](core-application-feature-extraction-handoff.md) and
[API transport hand-off](api-transport-extraction-handoff.md).

## Authorities and invariants

### Nothing new goes in `platform/app`

**Decided 2026-08-28.** No slice may add a file under `platform/app`. Editing an
existing file there to repoint an import is fine, and deleting from it is the
entire point, but the tree only shrinks.

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
| API physical activation         | `apps/api` owns an injectable typed boot/process boundary, a real Node/Hono listener, request policy, graceful drain, Agent/Secret tRPC and all four Secret REST bases. `ab64885d6f` requires the canonical Auth service plus an injected Better Auth transport for browser-session resolution. `f7e89e5200` adds project-key and current API-key authentication with preserved header precedence, credential-derived project selection and AuthZ ceiling refusal. `bb541a9ac5` adds `markUsed`, attributed 2xx mutation audit, an API-owned Redis/Group Queue infrastructure and `startApiExecutable` as the boot-failure boundary. `ffd59b1307` adds a readiness gate before the listener accepts traffic, `/api/health` and an optional metrics port. It still has no package start command and no PAT/admin or rate-limit adapter, nothing outside its own tests composes `ApiProductionComposition`, and the platform route graph remains live and still owns the API-key ceiling that serves traffic. | Compose PAT/admin and rate-limit adapters and an executable start command, close the `F-APIKEY-01` and `F-APIKEY-02` policy-parity gaps before any cutover, then migrate the remaining REST/tRPC route graph by vertical before deleting compatibility routers. `createAppTrpcFeatures` (the tRPC twin of `createAppRestFeatures`) now mounts twelve package-owned surfaces by one spread and their twelve platform delegation routers are deleted; analytics waits on its five sub-router test suites, and user/workflows on draining their inline procedures. |
| Worker physical activation      | `2923114cc0` makes the deployed worker entry `src/workers.ts` boot through the physical `WorkerExecutable`, which owns typed configuration, logger/tracer, a signal policy with a shutdown deadline, fatal uncaught/unhandled reporting and finalization; `LegacyWorkerExecutableComposition` is the named compatibility adapter that still supplies the legacy registry. Worker configuration now parses Redis, Group Queue policy, stored-object storage and outbound proxy. `4bfb7bd679` adds concrete S3/filesystem drivers, a typed BYOC source and lazy Azure factory port. `WorkerProductionComposition` and `createWorkerPrivateInfrastructureComposition` are exported but have no production caller. Both Eventing consumer switches remain off because the shared queue still contains every legacy pipeline.                                                                                                                                                                                    | Supply concrete project-BYOC and Azure sources and give the private infrastructure composition a production caller, then in Wave 4 install the complete registry and intent ports before enabling the one shared-queue consumer.                                |
| UI physical activation          | Chunk recovery, runtime behaviour, shell sections, browser-safe public config and Agent browser transport now follow the enforced global/private hierarchy. `apps/ui/src/app`, `platform` and `testing` are invalid roots and contain no production files. The private source projection remains in `platform/app` as a compatibility boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Move the actual browser entry, providers, source projection, router, overlays and route families out of `platform/app`, retaining the legacy shell adapter until URL/provider parity is proven.                                                                 |
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
| 8     | Organization owns settings, then team lookup and auth revocation | Wave 2 Organization | Blocked. Two new abstract contract methods break six implementors, and no displaced app-layer code is deleted.                          |
| 9     | SCIM and Ops email-change revocation         | `F-USER-AUTH-01`                | **Landed** in `56fd1271c3`: `F-LOCK-01` is closed, both halves carry `@scenario` bindings, and `F-USER-AUTH-01` is closed with them.                                                          |
| 10    | apps/api API-key organization REST security  | `F-API-06`, `F-APIKEY-01/02`    | **Landed** in `efa933315d` plus the infrastructure-catch logging repair on top of it, closing `F-APIKEY-01` and the cause-loss half of `F-APIKEY-02`. The Organization-settings dependency was satisfied by the existing `organizations.getSettings` contract method rather than the two abstract methods slice 8 proposes. |
| 11    | ~~Local-orchestrator task executable~~           | Wave 1 boot entry points        | Blocked. The new `./task` export is not packed, so self-hosted `clickhouse:migrate` and `lwql:provision` break.                          |
| 12    | Azure identity and AWS process config        | Infrastructure clients          | Blocked. Two module-scope `AppDatasetStorageResolver` constructions now throw.                                                           |
| 13    | Analytics/Dashboard persistence (app half LOST)              | Analytics/Dashboard persistence | Blocked. The new service exceeds the 500-line ceiling and cannot be baselined, and 20 spec scenarios lost their bindings.                |
| 14    | Gateway persistence (app half LOST)                          | Gateway persistence             | Blocked. Four new error codes are unregistered and the composition surface still imports generated Prisma, so the plan gate is unmet.    |
| 15    | Prompt persistence                           | `F-PROMPT-01`                   | Blocked on the plan's own gates: no persistence port exists, the type fakes remain and the new rollback test does not typecheck.         |
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

- [ ] Inventory every `src/app/api/**` route, method, auth mode, response schema,
      ordering constraint and OpenAPI operation.
- [ ] Move feature routes to feature-server REST adapters and mount in
      `apps/api`; keep compatibility aliases thin and explicit.
- [ ] Preserve special ordering: concrete routes before catch-alls, auth CLI
      before Better Auth, gateway OpenAPI before parameter routes and experiments
      v3 before siblings.
- [ ] Cover ingestion/collector, OTEL/RUM, SSE, MCP, admin/ops/health/cron,
      uploads/exports, webhooks and internal control-plane routes, not only product
      CRUD.

#### Internal tRPC

**In progress — 8 of 95 mounted routers moved.** Agent, Secret, Presence, Data
Retention, Feature Flag, Role, role bindings and GitHub are package-owned and
mounted from `runtime/app/internal-api/`; 87 modules remain under
`server/api/routers/**`.

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
