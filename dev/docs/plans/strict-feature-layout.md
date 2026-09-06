# Strict feature layout: the one plan

Branch `feat/strict-feature-layout-v0` to `main`. Everything live about the
migration is in this document. Findings logs stay as separate files and are
linked in section 7. Retired documents and where their content went are in
section 8.

Consolidated 2026-09-06 from the plan sweep
(`/Users/afr/.claude/jobs/eeb488e6/tmp/plan-sweep/report.md`).

## 1. Goal and definition of done

Four processes compose 44 feature packages:

```
  apps/ui        the browser application (Vite SPA)
  apps/api       the interactive process: tRPC, REST, SSE
  apps/worker    queues, schedulers, projections, process managers
  apps/tasks     one-shot migrations and backfills
        │
        │ install
        ▼
  packages/features/*            {contract, server, web}
  packages/enterprise/features/* the same grammar, enterprise licence
```

### The eight clauses of the exit plan

1. `apps/api` owns the request lifecycle. **Done.**
2. `apps/worker` owns the background lifecycle. **Done.**
3. `apps/ui` boots the browser with no `platform/app` imports. **Done.**
4. Every catalogue feature has one canonical contract, service and repository
   graph. **Done**, except the layout burn-down in section 4 item 12.
5. No production code uses global `App`, `getApp`, `tryGetApp`, global Prisma,
   package-level environment access or import-time registration. **Done.**
   `global-app-access` stays as a permanent tripwire.
6. Public REST, internal tRPC, SDK, MCP, webhook, ingestion and generated
   OpenAPI and client contracts have explicit parity proof. **Not done.**
   See section 4 items 9 and 30.
7. Migrations, tasks, assets, E2E suites, scripts, instrumentation, CI and
   deployment definitions no longer assume `platform/app`. **Done**, except
   the haven binary release note (section 4 item 31).
8. `platform/app` and every reference to it are deleted. **Done**
   (`faaa9ec333`).

### The five clauses added after the exit

- 0 unbound scenarios on the parity summary line.
- oxlint errors 0, with no debt registers used as a baseline.
- architecture-lint hard findings 0, with no baseline file present.
- One install surface per application.
- The three journeys green: browser, SDK and CLI.

### Invariants that govern every later change

Where an ADR states one, the ADR is the authority and this list is the index.

- `packages/features/catalogue.json` is the authority for feature owners.
- `apps/api`, `apps/worker`, `apps/ui` and `apps/tasks` are the physical
  composition roots. `apps/server` is local orchestration only.
- A feature owns its contract, its canonical server implementation and its
  reusable web behaviour. A process installs those surfaces. A process never
  reimplements them.
- Preserve URLs, procedure names, OpenAPI shapes, response fields, auth,
  errors, ordering, pagination, time and money units, effects, retries and
  idempotency, unless an explicit decision changes them.
- A package never reads an environment module. Each process parses and
  validates configuration once through `packages/config`, then injects typed
  values.
- The api and the worker each construct one process-owned logger and tracer
  graph from `@langwatch/observability/node`. The ui uses browser-safe
  observability only.
- Generated Prisma stays private to strict Prisma repository adapters.
- Core never imports an enterprise implementation. Role-specific enterprise
  composition stays under `packages/enterprise/composition/**`.
- A shared worktree is never staged wholesale. Stage exact paths. Commit
  coherent slices.

## 2. Counters, and how each is measured

| Counter | Command | Value (2026-09-06) | Target |
| --- | --- | --- | --- |
| Unbound scenarios | `pnpm check:feature-parity`, then read the summary line `THIS RUN FAILS: N unbound`. Never `grep -c`: a per-line count reads about 50 percent low | 1 unbound, 13 unknown annotations | 0 |
| oxlint errors | `pnpm lint:oxlint` | 44 | 0, with no register used as a baseline |
| architecture-lint hard findings | `pnpm --filter @langwatch/architecture-lint lint`. A hard violation is an entry followed by an `  allowed:` line. Diff the violation list, never the total | red, five baseline files still present | 0, and all five baseline files deleted |
| Typecheck | `pnpm typecheck:all 2>&1 \| sed 's/\x1b\[[0-9;]*m//g' \| grep -E 'error TS'`. Strip the colour first: `tsc` puts escape codes between `error` and the code, so a raw grep matches nothing | not clean | prints nothing |
| Boot smoke | `PORT=5640 pnpm dev:api` logs `API HTTP listener started`. The same for `pnpm dev:worker`. Run after every composition edit | passes | passes |
| Browser journey | `pnpm test:e2e` | 9 of 13 legs green | 13 of 13 |
| SDK and CLI journeys | `pnpm --filter langwatch test:e2e sdk-app cli-journey` | 27 of 32 green | 32 of 32 |
| Visual diff | `tools/visualdiff`, main against the branch, every route | not run: blocked on the migrations | no unexplained row |
| Composition files | `find apps -name '*.composition.ts' \| wc -l` | 136. `api-production.composition.ts` is 4,608 lines, `worker-production.composition.ts` is 2,247 | 0 under `apps/**` after the composition design lands |
| Comment blocks over the limit | `packages/architecture-lint/src/comment-block-roots.json` | 2,550 blocks on `apps/*` roots, expiry 2026-09-17 | swept, or the dates moved on purpose |

Every whole-repository check takes a machine-wide slot. Run the per-package
form while a lane is open. Run the whole-repository form once, before a push.

## 3. Decisions taken

- **2026-09-01. The migration is not gradual.** `platform/app` did not have to
  compile, boot or serve during the move. The only permitted edit there was a
  deletion.
- **2026-09-02. Lift and shift, not redesign.** Move a module into the package
  that owns it and keep its shape. Fix the moved code's imports. Leave every
  other `platform/app` importer broken. Delete what the move made unreachable.
  Redesign only at a seam.
- **2026-09-03. Merge main directly on the feature branch.** Never rebase: a
  rebase drops the merge resolutions.
- **2026-09-03. Physical extraction is real.** `Capability`,
  `CapabilityRegistry`, `FeatureDefinition`, `FeatureRuntimeBuilder` and
  `RuntimeBoot` were never adopted and are deleted. Both processes compose by
  hand in their `*-production.composition.ts` roots (ADR-102 amendment).
- **2026-09-04. Decision 1 (R7).** `rules/<subject>.rules.ts` is a layout kind.
  A rules file declares no class and no `new` expression, and its value imports
  reach only `node:*`, another rules file, a contract package, or a package
  whose own closure never reaches Prisma, ClickHouse or another package's
  implementation directories.
- **2026-09-04. Decision 2 (R8).** The boundary-edge baseline expires and only
  shrinks. An unlisted edge fails. An expired entry fails as
  `boundary-edge-expired`. A stale entry fails as
  `boundary-edge-baseline-stale`.
- **2026-09-04. Decision 3.** The tRPC flatten proceeds; steps C and D landed.
- **2026-09-04. Decisions 4 and 5.** The run-plans and test-suites families
  answer under `/api/v1` only.
- **2026-09-04. Decision 6.** Producer pipelines land as one shape
  (`9c368cf4f6`).
- **2026-09-04. Decision 7.** langwatch-saas keeps one task as a plugin. The
  other five move into this repository.
- **2026-09-04. Decision 9.** saas-only behaviour ships as plugins.
- **2026-09-04. Decision 15b.** `global-app-access-baseline.json` and
  `legacy-application-boundary-baseline.json` are deleted outright. Both were
  drained to zero, and each rule reads a missing baseline as an empty one.
- **2026-09-04. Decision 16.** `experiment-run-orchestrator.service.ts` splits
  from 3,956 lines to 385 lines plus 27 sibling services.
- **2026-09-04. Decision 18.** `ParsedCustomModels` and the picker are the one
  shape.
- **2026-09-04. Decision 20.** Every REST family answers at `/api/v1` and at
  `/api`. `/api/v1` is canonical. Four families are v1-only and carry
  `v1Alias: false`.
- **2026-09-05. Restore everything.** No behaviour that main has may be lost on
  this branch. The only admitted retirements are rows whose behaviour main
  itself already replaced or already executed.
- **2026-09-05. A web surface is a door.** `surfaces/<id>/index.ts` is the
  package's public entry. It may reach its own directory, `src/model/**`,
  `src/behavior/**` and `src/ui/**`, and nothing else. Private code still may
  not import a surface.
- **2026-09-05. The UI slot seam is built.** A core screen asks the composition
  for a block by name and renders the fallback when nothing came back. Only
  `apps/ui` names both halves. See `best_practices/ui-install.md`.
- **2026-09-05. Flatten the tRPC groups.** One root, one policy chain.
- **2026-09-06. Spec rulings.** `runtime-composition.feature`: the 8 unbound
  scenarios are deleted. `typescript-7.feature`: reworded to a root tsconfig
  every package extends. `memory-footprint.feature`: the production-mode
  scenario is deleted. `api-reference`: reworded to "answers only under
  `/api/v1`". `licensing`: the license-router and getLicenseHandler scenarios
  are deleted.
- **2026-09-06. apidiff is not approved.** The REST body-shape drift survey on
  about 253 mounted operations stays unfunded. The Fable review is pending at
  the root session.

## 4. Open items

Size: S is under 2 hours, M is half a day, L is a day or more, XL is
multi-day. Kind: U is user-visible, Sec is security, Perf is performance, H is
hygiene. RB marks an item that blocks the merge to main. Owner is blank until
a person takes the row.

Release-blocking rows come first.

| # | Item | Size | RB | Kind | Owner | Lane |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Feature-transport security Highs with no closing commit. C1: `project:view` mints a full-access legacy project key through the MCP OAuth approval (`api-production.composition.ts:1994`, `mcp-authorize.api.ts`). H6: a legacy key reads any organisation's OTTL rules by id. H9: `workflows:view` escalates to a run through a legacy-key self-fetch. H12: gateway budget and cache-rule REST mutations check the project and act organisation-wide. H14: a licence key carries no organisation binding (`license-generation.service.ts:71`). Verify each against the tree first. The pass predates six security commits | XL | yes | Sec | | security |
| 2 | Fail-open shapes in `@langwatch/api`. `handlerManagedAuth` declares and nothing verifies (42 routes; `langy-local.api.ts:49` enforces key ownership only). `SecuredApp.hono` is public. Legacy project keys skip every `requires()` gate. `internalSecret` without `verifySecret` is an empty chain. The tRPC chain has no type-level scope coupling. The eight-point design is in the authz audit report | XL | yes | Sec | | authz |
| 3 | Journey defects with no fix commit. D13: a trace read waits on ClickHouse for ever. D17: a span evaluation never reaches the trace read. D11: "Create Online Evaluation" is intermittently inert and silent. D19: the worker outbox drain stalls ingestion with `P2028` (a boot-window transient on the 09-04 walk). D20: the agent-testing run drawer crashes when turns render | XL | yes | U | | e2e |
| 4 | Lint rulings only Alex can give, then the burn. `ui-screen-closure`, `ui-surface-closure`, `ui-web-public-entry` and `ui-feature-implementation-import` (46, 38, 30, 8): may a screen import another package's `surfaces/<id>` door? `enterprise-composition` (19): seven governance adapters shared by both compositions have no admitted home. `comment-block-size` (1,265): raise the cap, scope it to production code, or make it advisory. `application-boundary` (1): `apps/ui` names `AppRouter`, which waits on ADR-130 stage 2. `feature-source-layout` (1): the langy delivered-calls set. `apps/api/src/features/agent-cache/` was never extracted | XL | yes | H | | lint |
| 5 | Comment-block roots expire 2026-09-17 and fail the run that day: `apps/api` 1,281, `apps/ui` 671, `apps/worker` 499, `apps/server` 93, `apps/tasks` 6. Sweep each application, or move the dates on purpose. The sweep remainder is the rest of `trace/server` plus about 35 feature server packages, 726 blocks | L | yes | H | | comment-sweep |
| 6 | PR #7536 is still a draft, so no gate in any plan has run in CI. Drafts skip the build and race jobs. Mark it ready and read the first full run as the baseline | S | yes | H | | ci |
| 7 | langwatch-saas does not build against this branch. Delete the five moved tasks. Keep `backfillInviteUsersToCio` as a `@langwatch/task` plugin. Drop the submodule. Build `FROM` the public image. Repoint `sync-model-registry.yaml`. Other repository | L | yes | U | | saas |
| 8 | Visual diff of every route, main against the branch, with no unexplained row. `tools/visualdiff` exists (`d3d8a930a6`). Blocked on applying the three 2026-09-04 additive migrations to the shared dev database | M | yes | U | | visual-diff |
| 9 | `GET /api/traces/{traceId}/transcript` is a documented operation and is still unmounted. It waits on a composed `LogService`. `1c180c7204` only names the absence | M | yes | U | | api |
| 10 | Wire `oxlint-tsgolint`. It restores `noFloatingPromises`, `noMisusedPromises`, `useOptionalChain` and `useLiteralKeys`, all lost with Biome. Only a comment in `.oxlintrc.architecture.json:3511` names it | M | no | H | | lint |
| 11 | ADR-130 stages 2 to 4: move 38 procedure maps to contracts, declare `AppApiMap`, annotate `ApiApplication.trpc`, add the conformance test. Then the api-map lane: 39 `createFeatureApi<` sites become `trpcReact`, and `feature-api.ts` and `use-invalidate-procedure.ts` are deleted. No `AppApiMap` is in the tree yet; `04ba1ac99d` moved 22 entries | XL | no | Perf/H | | api-map |
| 12 | Architecture-lint burn-down slices still open. A1 and A2: `apps/api` and `apps/worker` stop importing enterprise feature packages. A3: plan-gate rename, agent-cache move, `custom-evaluators.ts` port. A5a to A5c: adapter doors for about 56 consumed private exports. A6a to A6c: `PrismaClient` outside the seam, with `typed-prisma-seam-baseline.json` still present. A7: Prisma enums in contracts. A9: `try*` renames. L1 to L6: 303 layout moves. W1 and W3. A12 to A19. Every count predates R1 to R6. Re-derive first | XL | no | H | | burn-down |
| 13 | Tasks lane. `topic-clustering-run` is still unregistered and needs its runner's collaborator graph (3 days). Fix 16: lazy handle composition on `TasksHost`, because `prisma-migrate` opens ClickHouse and Redis it never reads. Fix 18: audit the `stored-object/server` index exports | L | no | H | | tasks |
| 14 | `NlpLambdaRuntimeService` is restored in workflow-server and composed by nothing: the Lambda invoke port has no adapter. The S3 round-trip scenario needs a dogfood bucket lane | M | no | U | | nlp |
| 15 | Parked behaviour needing a UI decision. The prompt editor standalone Inputs section (3 scenarios, `@unimplemented`). The workspace-switcher tooltip and auto-focus (3, parked). `sdk-scenario-set-limit.feature` (14 `@unimplemented`, written ahead of the feature: build it or delete it) | M | no | U | | product |
| 16 | The one unbound scenario: `shared-section-navigation-layout.feature` narrow viewport needs a real browser lane, because jsdom cannot evaluate a media query. Plus 13 unknown annotations to reconcile | S | no | H | | parity |
| 17 | `worker: null` is still in `apps/api/src/features/langy/langy.composition.ts:211`. Nobody probed whether a browser turn-start can reach the API-side refusal | S | no | U | | langy |
| 18 | Two rulings due at merge. Legacy `/api/secrets` write-actor and duplicate-error byte compatibility. Which single SDK or OTel entry owns api, worker and Eventing instrumentation | S | no | H | | decisions |
| 19 | Unverified walk findings. F2: a failed `organization.getAll` renders an empty document with no error state. F5: one REST request writes up to 21 identical log lines. F7: `system.backup_log` collection is on by default and warns every boot. F8: `apps/ui/vite.config.ts:35` loads `.env.portless` with `override: true` while the api and the worker do not | M | no | U/H | | e2e |
| 20 | The extracted full-read path trusts a stale storage-anchor hint. It was never verified against the legacy mapper characterisation | M | no | U | | trace |
| 21 | Exit-ledger remainders. `modelProvider.getAllForProjectForFrontend` no longer returns `modelMetadata`, so the settings page may render none. `MODERN_API_METHODS` still lists `register` (`api-transport-boundaries.ts:23`). Of the five unwired pipelines, `identity` and `join-request` installers are now imported by the worker composition; `sso-connections`, `scim-sync` and `agent_sandbox_maintenance` are unverified | M | no | U/H | | api |
| 22 | Run the seam review. Fable reads seams 1a to 1d once. Sample the `trace` and `governance` packages. Sonnet lanes write findings per package to `seam-review-2026-09-06/<pkg>.md`. Turn on "Require review from Code Owners" for `main` | L | no | H | | review |
| 23 | Product ruling on the web host. `@langwatch/workflow-web/studio-host/api` has 79 importers from other features' screens. The studio drawer and dialog supersets move to the design system. `model/prisma-types` moves to `workflow-contract`. `member-seat-usage.tsx:7` still imports the enterprise `resource-limits` surface directly | L | no | H | | ui |
| 24 | Fourteen narratives cut from comments need their ADR homes written: the idempotency ledger ADR, the tRPC chain ADR, five ADR-129 appendices, an ADR-127 appendix, an ADR-060 appendix, an error-handling security note, and the trace storage-anchor history. The full table is in section 4a | M | no | H | | adr |
| 25 | Memory repositories for every service unit test, and a chdb spike for repository tests (2 days, go or no-go) | L | no | H | | test |
| 26 | `caseFiling.integration.test.tsx` is skipped. Run-plan folder grouping lives in `PlanScopeField.CaseChoices`, which has no test | S | no | H | | test |
| 27 | Agent-testing web modules still compose Scenario, Prompt, Agent and Suite behaviour together. Inventory the mixed modules and separate them around named browser responsibilities: scenario case editing, agent and prompt target selection, suite plan editing, and the small `apps/ui` composition layer. Do not replace the mixture with one large shared context | L | no | H | | ui |
| 28 | `setNurturingDatabase` had no caller. Nurturing repositories now exist in billing: verify they are wired. `apps/api` has no integration lane, so its Postgres tests use `describe.skipIf` | S | no | H | | billing |
| 29 | REST chain and security spine remainders. The better-auth `Request` pass-through is unproven and multipart is unparsed. Spine mediums unverified: M1 rate limit after body parse, M3 empty `X-Project-Id` 500, M8 `/api/auth/validate` unthrottled oracle, M9 origin gate on `/api/auth/*` only, M13 EXPLAIN `system.*` guard quoted-identifier bypass, M15 five project-scoped models exempt from the tenancy guard, M16 eleven list endpoints with no page size | L | no | Sec | | security |
| 30 | Residual unknowns. Body-shape drift on about 253 mounted REST operations (apidiff's job, not approved). Procedure-level gaps inside mounted namespaces. haven `migrations failed: context canceled` | M | no | H | | api |
| 31 | Release note: run `make haven install` after the merge. A binary built before the removal hard-refuses at boot | S | no | H | | release |

### 4a. ADR homes still to write

The comment sweeps cut every block to the reason alone. The narrative below was
too long for a comment and too valuable to lose. Recover the original text with
`git log -p -S'<phrase>' -- <file>`.

| File | Narrative to record | Home |
| --- | --- | --- |
| `packages/api/src/rest/idempotency-ledger.ts` | Create-only receipt semantics, liveness-based claim supersession, fencing through a claimId rewrite, why only 2xx is stored, why the body is encrypted | New ADR: the idempotency ledger |
| `packages/api/src/trpc/trpc-api-service.ts` | A policy must wrap an already-parsed procedure or the check is a no-op. The scope-lineage guard runs before the check | New ADR: the tRPC chain |
| `apps/api/src/features/enterprise/enterprise-governance-trpc.mount.ts` | Why governance and gateway compositions are built together. Why `personalDashboard` merges into `user.*` | ADR-102 |
| `apps/api/src/features/langy/langy-trpc.mount.ts` | The demo-project refusal runs before `enforceLangyAccess`. The order is security load-bearing | ADR-129 appendix |
| `packages/clickhouse-client/src/tenancy.ts` | Fail-closed tenant routing. The cache never expires, it only evicts | ADR-127 appendix |
| `apps/api/src/features/experiment/experiment-v3-rest.mount.ts` | The two named absences pattern (no analytics sink, no progress store), also in evaluations-legacy | Best practice: composition roots |
| `apps/api/src/features/*/*.composition.types.ts` | Why the type lives apart from its composition (37 copies collapsed to one line) | `best_practices/service-repository-adapter-port.md` |
| `packages/features/langy/server/src/repositories/prisma/prisma.langy-turn-admission.repository.ts` | The `COMMITTED_ABANDON_MS` backstop, and the deploy-boundary window where pre-hash receipt ids 409 a byte-identical retry | ADR-129 appendix |
| `packages/features/langy/server/src/services/langy-local-session.service.ts` | Split-brain fencing through the presence instance id. GONE is not supersession | ADR-129 appendix |
| `packages/features/langy/server/src/adapters/redis.langy-local-presence.adapter.ts` | The heartbeat against TTL race. Replaced against restored semantics | ADR-129 appendix |
| `packages/features/langy/server/src/transport/api-trpc/langy-egress.api.ts` | The demo project leaked its egress allowlist because `project:view` is demo-granted. Gate on `langy:*` plus an explicit demo refusal | ADR-129 appendix, security note |
| `packages/features/langy/server/src/transport/api-rest/langy.local-control-http.ts` | The CLI, worker and panel route table for local control | ADR-129 appendix |
| `packages/features/langy/contract/src/cards/derived-safe.ts` | Three compile-time gates against the DERIVED-SAFE allowlist widening, plus the runtime pin test | ADR-060 appendix |
| `packages/features/trace/contract/src/trace-ai-query.ts` | `AiActionErrorDetails.reason` never carries raw provider text. A 401 body once leaked a managed-provider key | Security note in `best_practices/error-handling.md` |
| `packages/features/trace/server/src/projections/trace-derived.projection.ts` | Storage-anchor split history, the always-write-row fix for the store-miss ambiguity, and the accumulator keys coupled to `FOLD_ACCUMULATOR_KEYS` | ADR-066 and ADR-071 appendices |
| `packages/observability/src/logger.ts` | The logger factory cache keyed by name and `disableContext`. A fresh `pino()` measured 2.3 percent of production wall time. Per-request fields arrive through the mixin, so sharing is safe | New ADR: observability logger factory caching |
| `packages/observability/src/logger.ts` | Pretty-console transport options must survive `structuredClone`, because they cross a worker-thread boundary. Building the pretty stream on this thread kills the OTel log transport silently | Appendix to the same ADR |
| `apps/api/src/features/enterprise/enterprise-webhook.composition.ts` | The webhook entitlement gate is a plan read, not an enterprise capability, so a deployment with no governance app answers a 403 instead of a 503 | Best practice: composition roots |
| `packages/enterprise/features/webhook/server/src/app/webhook.app.ts` | Why `WebhookApp` is a holder rather than a restatement of endpoint-store operations | `best_practices/service-repository-adapter-port.md` |
| `apps/api/src/features/trace/trace-rest.mount.ts` | Named absence: the coding-agent transcript join is not supplied, because `composeApiTraceReadStack` refuses `LogService.getLogsByTraceId` by name | Best practice: composition roots |
| `apps/ui/e2e/langy/local-control-fixture.ts` | The CLI API key mint is read back before use. `apiKey.create` answering 200 has left the binding unwritten under load | ADR-129 appendix |

## 5. Deferred to post-release

- **Decision 21: the canonical error envelope.** The flat REST error body
  becomes one envelope. It needs its own ADR, a dated version, about 20
  families and the SDKs. XL.
- **`check-unspecced-features`**, in three stages, covering everything that
  starts after this release.
- **Mail growth hooks.** A product decision.
- **ADR-009 retirement**, with `otel-trace-context-propagation.feature`
  (10 `@unimplemented` scenarios). ADR-097 supersedes the platform span
  collection.
- **Agent-testing web decomposition** (section 4 item 27), after the move.

## 6. The diff-drive gate

Nothing counts as done on this branch until all of the following hold, in this
order. Report the counters only after them.

1. **Typecheck with the colour stripped**, per package:
   `pnpm -s typecheck 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'error TS'`
   must print nothing. Also check that `grep -cE 'error TS1[0-9]{3}'` is 0: a
   parse error aborts `tsc` and reads as clean.
2. **Boot smoke** after every composition edit: `PORT=5640 pnpm dev:api` logs
   `API HTTP listener started`, then the process is killed again.
3. **The three journeys run green** against a stack booted from the tree. A
   product defect they find is recorded in `e2e-journey-2026-09-04.md` with a
   reproduction, and it is fixed before the leg is touched.
4. **Parity is the summary line**, never a grep count, and every test tree is
   in `DEFAULT_TEST_ROOTS`.
5. **Absent behaviour refuses by name.** A port with no implementation is
   composed as a refusing adapter that names the absence.
6. **A lane never edits the worktree a person is running.** A bug walk uses a
   spare port slot or haven. Each lane is told which files another lane holds.
7. **Seams are read once by Fable**, one fresh session per seam. The seams are
   `packages/api/src/rest` and `src/trpc`; the two production compositions;
   `apps/api/src/api-rest.security.ts` with `packages/features/authz/server`;
   and the architecture-lint rules with `.oxlintrc.architecture.json`.
8. **Code Owners review is required on `main`.** `.github/CODEOWNERS` names an
   owner for every seam, so a function cannot join a complexity register
   without a person seeing the line appear.

### Why the gate exists

Alex's walk on 2026-09-04 found missing fonts, a duplicated settings sidebar,
pages reading "does not exist", a trace page spinning for ever, enterprise
menus on a free account, and a run of permission failures. Every one of them
had a passing test somewhere. Four causes, all measured that day:

1. **The tests proved the pieces, never the product.** Each moved test mocks
   the boundary it sits on. The end-to-end journeys did not exist until that
   evening, and their first runs found eleven product defects in a few hours.
2. **The type gate was hollow.** `tsc` colourises, so `grep 'error TS'` never
   matched. Packages carrying 59, 24, 23, 21 and 18 errors were reported clean.
3. **The tree was edited under the person testing it.** Up to fifteen lanes
   edited the worktree Alex ran `pnpm dev` against. A page that "does not
   exist" was usually an api that had not come back yet.
4. **The counter undercounted.** The reported figure came from
   `grep -c '✗ ['`; the report's own summary line for the same run was 50
   percent higher, and two whole test trees were not scanned at all.

### The seam review method

The branch changes several hundred thousand lines, and the strict layout makes
them homogeneous. Risk concentrates in a few thousand lines. So machines review
the bulk, Fable reads the seams once, and Sonnet lanes emit findings for
everything in between.

```
  bulk (~300k lines)        seams (~15k lines)        judgement
  ┌──────────────────┐      ┌─────────────────┐      ┌──────────────┐
  │ oxlint           │      │ packages/api    │      │ Fable, one   │
  │ architecture-lint│      │ compositions    │ ───► │ session per  │
  │ parity gate      │      │ security + authz│      │ seam         │
  │ per-package tests│      │ lint rules      │      └──────────────┘
  │ visual diff, CI  │      └─────────────────┘
  └──────────────────┘             ▲
           ▲                       │ findings only
           │              ┌────────┴────────┐
    nobody reads these    │ Sonnet lanes    │  per feature package
                          └─────────────────┘
```

Sample two packages completely with the grammar checklist, one core
(`packages/features/trace`) and one enterprise
(`packages/enterprise/features/governance`). Any defect class found is then a
grep across the other packages, not another read.

Five questions answer faster than a review, and each is a grep:

- Which repositories are reachable from a route without a project id?
- Which services are composed in the worker but not the api, and the reverse?
- Which ports have exactly one adapter, and is that adapter the production one?
- Which `HandledError` codes have no presentation entry?
- Which `.feature` files carry zero binding tags?

### Burn-down ground rules

These govern every architecture-lint slice.

1. **A finding is one of three things.** The code is wrong, so fix it in a
   slice an agent can run without judgement. The rule is wrong or redundant, so
   change the rule. Or the rule is right and the target is out of reach this
   week, so a baseline is allowed. A baseline is allowed only when it is
   shrink-only, keyed by the thing that must reach zero, fails the gate when it
   grows or expires, and never exempts a changed file.
2. **Generated shape is fixed, not baselined.**
3. **A repository never reaches a server package's surface.** Not from
   `index.ts` and not from `testing.ts`. The door is an adapter static, for
   example `PostgresAuthzAdapter.createReader({ database })`.
4. **A comment helps read the code.** Over 3 lines is reviewed, 5 is the
   maximum, and history goes to an ADR. A JSDoc block is a comment.
5. **An agent moves, it does not redesign.** Where a file does not fit a named
   class, the agent reports it and stops.
6. **Diff the violation list, not the total.** Every slice ends with a fresh
   `after.log` and `diff <(grep '^\[' before.log) <(grep '^\[' after.log)`. A
   slice that adds any line is not done.
7. **The root session runs the typecheck named per slice.** An agent runs the
   test command named per slice and nothing wider. No `git stash`, `restore`,
   `checkout --`, `reset` or `clean`. Commit by explicit pathspec.

## 7. Reference material

Findings logs kept as separate files:

- `security-pass-2026-09-04-spine.md`, `security-pass-2026-09-04-features.md`.
  Add a status column as rows close.
- `e2e-journey-2026-09-04.md`, `e2e-walk-2026-09-04.md`. Keep until D11, D13,
  D17, D19, D20, F2, F5, F7 and F8 close.
- `test-conformance-and-unspecced-features-2026-09-06.md`.
- `clickhouse-test-doubles-research-2026-09-04.md`.
- `issue3891-3860-dev-env-rework.md`, `stored-objects-delivery-plan.md`. Both
  predate the migration.

Lane designs written 2026-09-06, not yet copied into the repository. Each is
under `/Users/afr/.claude/jobs/eeb488e6/tmp/`:

| Lane | Path |
| --- | --- |
| Composition design (`app.installsFeature`, stages 0 to 3) | `composition-design/adr-draft.md`, `composition-design/plan.md` |
| Eventing declarations (stages 0 to 4) | `eventing-design/adr-draft.md`, `eventing-design/plan.md` |
| Lint review (lanes A to F) | `lint-review/report.md` |
| AuthZ audit (the eight-point design behind item 2) | `authz-audit/report.md` |
| apidiff (not approved) | `apidiff-review/plan.md`, `apidiff-review/review.md` |
| Test audit | `test-audit/checklist.md` |
| Skills review | `skills-review/report.md` |
| This plan sweep | `plan-sweep/report.md` |

The composition ADR draft is the successor of the three superseded composition
documents named in section 8. Copy it into `dev/docs/adr/` when Alex accepts
it.

Architecture Decision Records that govern this work: ADR-101 (feature package
surfaces), ADR-102 (runtime composition roots), ADR-111 (physical application
workspaces), ADR-112 (singular feature ownership), ADR-128 (public REST and
internal tRPC), ADR-128 (connected agents), ADR-129 (langy local control),
ADR-130 (the api router type is declared).

Best practices written out of the retired plans:
`best_practices/ui-install.md`, `best_practices/drawers.md`,
`best_practices/zod.md`, `best_practices/error-handling.md`,
`best_practices/service-repository-adapter-port.md`.

## 8. Retired plans

Every document below was deleted on 2026-09-06. Each line names what the
document was for, what it decided or found, and where its remainder went.

| Document | What it was for | What it decided or found | Remainder |
| --- | --- | --- | --- |
| `main-merge-plan.md` | The recipe for merging `origin/main` into the branch | Merge directly on the feature branch, never rebase | Section 3 (2026-09-03). The commits are `9a62f5929b` and `d4e51c8e22` |
| `worker-consumer-cutover-plan.md` | How the deployed worker becomes the one consumer of the eventing jobs | Registry handoff: the App eventing instance is producer-only on the worker role, and the packaged composition is the only consumer | ADR-102 amendment (2026-09-06) |
| `core-application-feature-extraction-handoff.md` | An operational restart note, 2026-08-28 | Nothing durable | Deleted. Git history |
| `api-transport-extraction-handoff.md` | An operational restart note, 2026-08-28 | Nothing durable | Deleted. Git history |
| `core-application-feature-extraction-future-work.md` | Structural work outside the behaviour-preserving extraction | Agent-testing web modules mix four domains and must be separated after the move | Section 4 item 27 |
| `core-application-feature-extraction-plan.md` | The platform application exit plan | The eight definition-of-done clauses, the invariants, and seven resolved decisions | Sections 1 and 3. It is the seed of this document |
| `connected-agents-restore-plan.md` | The 134 KB restore plan for connected agents | The runtime shape, the WebSocket hosting decision and the slice order. ADR-128 holds the contract | ADR-128 "Consequences" (the named absences). The rest is git history |
| `core-application-exit-decisions-for-review.md` | The 366 KB exit ledger, 167 sections | Almost every section closed | Sections 70, 125 and 167 are section 4 item 21. The rest is git history |
| `suite-restore-review.md` | Review of the suite run-plan restore | The suites are restored and bound against Postgres and ClickHouse (2026-09-06) | Closed. Section 3 (decisions 4 and 5) |
| `tasks-lane-review.md` | Review of the `apps/tasks` lane | Three fixes stayed open | Section 4 item 13 |
| `tasks-launch-interface-and-saas.md` | The tasks launch interface and the langwatch-saas split | Five saas tasks move into this repository. `backfillInviteUsersToCio` stays a private `@langwatch/task` plugin, because it repairs one incident rather than a repeatable operation. `onboarding-completion-rate` is blocked on an onboarding server package | ADR-102 amendment (the plugin mechanism). Section 4 item 7 (the saas steps) |
| `trpc-flatten-design.md` | The tRPC group flatten | Steps A to D. All landed | Section 3 (2026-09-05) |
| `trpc-flatten-review.md` | The review of that flatten | Steps C and D landed | Section 3 (2026-09-05) |
| `install-composition-review-2026-09-03.md` | Install and composition review of the platform-api packages | Sections A and B landed in `268eb2ed83`. The api-map lane is step E and stayed open | Section 4 item 11 |
| `composition-simplification-options.md` | Options A to J for simplifying composition | Superseded | The composition design ADR draft, section 7 |
| `feature-application-and-typed-transports.md` | A typed feature-application transport shape | Superseded | The composition design ADR draft, section 7 |
| `typed-rest-context-design.md` | A typed REST context | Superseded | The composition design ADR draft, section 7 |
| `architecture-lint-burn-down-plan.md` | The burn-down of 2,946 architecture-lint violations | The seven ground rules, R1 to R9 landed, and the open code slices | Section 6 (the ground rules). Section 4 item 12 (the open slices) |
| `architecture-lint-review-2026-09-03.md` | Companion review of the lint rules | Folded into the lint review lane | The lint review report, section 7 |
| `experiment-orchestrator-split-plan.md` | The split of an 88 KB orchestrator service | Done: 3,956 lines became 385 lines plus 27 sibling services | Section 3 (decision 16) |
| `ui-family-move-manifests.md` | Eighteen manifests for the UI family moves | The drawer registry mechanism moves, not the drawers. `@langwatch/ui-drawer` owns the address vocabulary, the navigation stack, the stores, the lazy registry and `CurrentDrawer` | `best_practices/drawers.md`, section "The drawer registry" |
| `ui-subscription-transport.md` | The tRPC subscription wire for the browser | All nine live procedures resolve on the api root and stream over `/api/sse/*`. The wire is ours, not tRPC's | ADR-128 (public REST and internal tRPC) amendment |
| `ui-install-surface-2026-09-05.md` | One install surface for the browser application | `uiFeature` and `installUiFeatures`. A duplicate page key or drawer name is refused by name | `best_practices/ui-install.md` |
| `ui-slots-2026-09-05.md` | The core-to-enterprise UI slot seam | A core screen asks for a block by name and renders its fallback. Only `apps/ui` fills a slot | `best_practices/ui-install.md`. The open ruling is section 4 item 23 |
| `ui-host-capabilities-2026-09-05.md` | The browser host ports in `packages/ui-host` | Router, toaster, error presenter and link move to `@langwatch/ui-host` | `best_practices/ui-install.md`. The product ruling is section 4 item 23 |
| `rest-chain-extensions-2026-09-05.md` | The REST chain gap survey, G1 to G12 | All twelve are built. The remaining unknowns are the better-auth pass-through and multipart | `packages/api/adrs/005-rest-chain-extensions.md`. Section 4 item 29 |
| `trpc-fluent-chain-2026-09-05.md` | The tRPC fluent chain | The chain is one argument and terminates in `.handle(fn)`. `withOutput` never reaches tRPC's `.output()` | `packages/api/adrs/006-trpc-fluent-chain.md` |
| `e2e-walk-2026-09-03.md` | The first end-to-end walk | It boots and it cannot be used: `/api/auth` was mounted by no process | ADR-010 amendment (2026-09-06) |
| `e2e-platform-plan-2026-09-04.md` | The plan for the four end-to-end suites | Eight decisions, including "the evaluator was hit is proven through a monitor" and "known platform gaps fail by name" | ADR-010 amendment (2026-09-06) |
| `why-so-many-bugs-2026-09-04.md` | Why the branch shipped so many bugs | Five causes and the six-point gate | Section 6 (the gate and the causes). `TESTING_PHILOSOPHY.md` (the pieces-against-product cause) |
| `open-decisions-2026-09-03.md` | Every decision needing Alex | 19 of 21 decisions resolved | Section 3 (resolved). Section 4 items 5, 6, 11, 17 and 18 (unresolved) |
| `binding-gaps-2026-09-04.md` | The unbound-scenario census, written at 1,333 unbound | Superseded by the restore-or-retire rows and the parity run | Section 4 items 15 and 16 |
| `restore-or-retire-2026-09-05.md` | Behaviour the lift left behind, row by row | Ruled 2026-09-05: restore everything. No behaviour main has may be lost | Section 3 (the ruling). Section 4 items 4, 14, 15, 16 and 28 |
| `restructure-bug-hunt-2026-09-03.md` | The hunt for unserved surfaces and restored bugs | 22 documented REST operations were unmounted | Section 4 items 9 and 30 |
| `unmounted-surfaces-audit-2026-09-04.md` | The unmounted-surface audit | Platform-era. Superseded by the route-coverage gate `2653514dfd` | Section 4 item 9 |
| `openapi-parity-2026-09-04.md` | OpenAPI parity, 78 KB | Platform-era. The generator landed in `60ca74941a` | Section 4 item 30 |
| `ownerless-ui-surfaces-census.md` | A census of UI surfaces with no owner | Platform-era | Deleted. Git history |
| `platform-reachability-census.md` | A census of reachable platform modules | Platform-era | Deleted. Git history |
| `api-and-worker-surface-audit.md` | An audit of the api and worker surfaces | Platform-era | Deleted. Git history |
| `inert-spec-files-census.md` | A 158 KB census of inert spec files | Regenerable from `check:feature-parity` | Section 2 (the parity counter) |
| `spec-rebind-manifest.md` | A 738 KB manifest, stale at 5,006 unbound | Regenerable, and wrong by two orders of magnitude today | Section 2 (the parity counter) |
| `lwql-workbench-granularity-regression.md` | One finding: a granularity regression | `setGranularity` travelled without the control that drove it | `package-move-capability-gaps.md`'s lesson, now in `TESTING_PHILOSOPHY.md` |
| `identity-pipelines-call-a-builder-api-that-does-not-exist.md` | One finding: `definePipeline` is called with an API that does not exist | Four identity pipelines call `withName` and `withAggregateType`, which `packages/eventing` does not declare | The identity platform wave's own work. Recorded in memory |
| `ingestion-sources-router-is-half-migrated.md` | One finding: a half-migrated router | Closed | Deleted. Git history |
| `zod-4-migration-misses.md` | What the zod 4 upgrade broke quietly | An inspected schema type-checks and still answers wrong. A test for code that inspects a library's data structures must get those structures from the library | `best_practices/zod.md` |
| `head-routes-cannot-be-served.md` | `.head()` registers a handler Hono can never reach | Hono answers HEAD from the GET route before routing, so a HEAD handler never runs and `c.req.method` reads `"GET"` | `packages/api/adrs/007-head-is-answered-from-get.md` |
| `span-referenced-payloads-are-not-in-the-event-union.md` | `makeId` is typed for events it cannot name | A subscriber has two types, not one: the event it is delivered and the payload its own `stage` returns. Separating them is an eventing framework change | The eventing design ADR draft, section 7 |
| `test-doubles-drift-because-the-check-that-would-catch-them-is-drowned.md` | Why test doubles drift | The check exists (`typecheck:tests`) and is red for unrelated reasons. Drive the count down; do not claim tests are unchecked. A "does this exist" sweep must match declaration forms, not the export keyword | `TESTING_PHILOSOPHY.md`, section "Test doubles drift" |
| `automatic-migration-enrolment-gap.md` | One finding: an enrolment gap | Closed | Deleted. Git history |
| `gateway-budget-check-is-unguarded.md` | One finding: an unguarded budget check | Closed | Deleted. Git history |
| `api-boot-gaps-durable-append-rate-limit.md` | Boot gaps: durable append and rate limit, 53 KB | Closed | Deleted. Git history |
| `package-move-capability-gaps.md` | Capability gaps left by the package moves | When a move re-authors rather than renames, diff the two files by behaviour. A constant or a state field that travelled without the control that drove it is the tell | `TESTING_PHILOSOPHY.md`, section "A move that re-authors". Section 4 item 26 |
| `seam-review-2026-09-06.md` | How to review the branch | Machines review the bulk, Fable reads the seams once, Sonnet lanes emit findings | Section 6 (the seam review method). Section 4 item 22 |
| `adr-candidates-from-comment-sweeps-2026-09-06.md` | Fourteen narratives cut from comments | Each needs an ADR home | Section 4a |

Thirty-nine comments in source files still name a retired document, most of them
`ui-family-move-manifests.md`. Each is a historical pointer, not a link a
reader follows to run something. The table above is the index: look the
filename up here to learn what the record held and where the remainder went,
and recover the original text with `git log -p -- dev/docs/plans/<name>`. A
comment sweep may repoint them; do not repoint one at a document that does not
carry the fact, because that turns a stale pointer into a false statement.

Two directories were kept. `dev/docs/plans/main-merge-ledger/` holds eight
generated path lists from the 2026-09-03 merge. `dev/docs/plans/feature-cleanup/`
holds nineteen per-feature cleanup reviews and a README. Neither is empty and
neither holds only retired documents, so both stay until their own owner
retires them.
