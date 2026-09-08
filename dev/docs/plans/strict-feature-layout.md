# Strict feature layout: the one plan

Branch `feat/strict-feature-layout-v0` to `main`. Everything live about the
migration is in this document: what is done, what is running, what is queued,
what is blocked, and what only Alex can decide. Findings logs stay as separate
files and are linked in section 13. Retired documents and where their content
went are in section 14. Live lane briefs (work orders a running or queued lane
reads) are listed in section 8; every one of them is subordinate to this file.

Consolidated 2026-09-06 from the plan sweep; rewritten 2026-09-08 23:30 to fold
in the API rebuild, the feature conversion drive, the process wiring waves and
the architecture-lint rebuild. HEAD `74d8aeae66`, 492 commits since
`771069e998`, 68 of them on 2026-09-08.

Status words used below: **DONE** (committed, hash given), **RUNNING** (an
Opus lane holds it now), **QUEUED** (brief written, no lane yet), **BLOCKED**
(waits on a named thing), **DECISION** (only Alex can move it).

## 1. Goal and definition of done

Four processes compose the feature packages:

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

### The eight clauses of the exit plan (2026-09-06)

1. `apps/api` owns the request lifecycle. **DONE.**
2. `apps/worker` owns the background lifecycle. **DONE.**
3. `apps/ui` boots the browser with no `platform/app` imports. **DONE.**
4. Every catalogue feature has one canonical contract, service and repository
   graph. **DONE**, except the layout burn-down (section 10 item 12).
5. No production code uses global `App`, `getApp`, `tryGetApp`, global Prisma,
   package-level environment access or import-time registration. **DONE.**
   `global-app-access` stays as a permanent tripwire.
6. Public REST, internal tRPC, SDK, MCP, webhook, ingestion and generated
   OpenAPI and client contracts have explicit parity proof. **Not done.**
   Section 10 items 9 and 30.
7. Migrations, tasks, assets, E2E suites, scripts, instrumentation, CI and
   deployment definitions no longer assume `platform/app`. **DONE**, except
   the haven binary release note (section 10 item 31).
8. `platform/app` and every reference to it are deleted. **DONE**
   (`faaa9ec333`).

### The clauses added 2026-09-07 and 2026-09-08 (the shape drive)

9. **Annotation is the shape.** Every feature is `defineFeature(...)
   .withRepositories(registry).withApp(App).withTransports(...)`, one
   `<Feature>Api` token in the contract, procedures declared once with
   `defineTrpcContract` / `defineRestRouter`, mounted by the process with
   `runtime.mount`, Prisma and memory repository twins behind
   `defineRepositories` and proven by a contract test, flat web entries. Done
   means `feature-shape-baseline.json` has no rows. **In progress: 280 rows
   across 41 features, 30 still on the deleted transport builders** (section 4).
10. **One runtime per transport in `@langwatch/api`**, nine transport files,
    the legacy builders deleted (`1dfbc5dcf1`). Done means every family runs on
    it and the remaining gaps in section 5 are closed. **In progress.**
11. **A folder is one concept, a file one readable part.** `source-folder-shape`
    (12 files per folder, 20-line fragment floor) and the review messages that
    read as the instruction an agent should have followed. **Lint DONE
    (`64322961e3`); 360 baselined rows to burn.**
12. **`packages/features` becomes `modules`**, with `enterprise/{packages,modules}`.
    **DECISION on the tree shape, then QUEUED** (section 9, D-a).
13. **The linter is rebuilt** to the same discipline (section 7).

### The five clauses added after the exit (unchanged)

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
  reusable web behaviour. A process installs those surfaces and never
  reimplements them.
- Preserve URLs, procedure names, OpenAPI shapes, response fields, auth,
  errors, ordering, pagination, time and money units, effects, retries and
  idempotency, unless an explicit decision changes them. Dated version
  addresses are a product promise.
- A package never reads an environment module. Each process parses and
  validates configuration once, then injects typed values.
- The api and the worker each construct one process-owned logger and tracer
  graph. The ui uses browser-safe observability only.
- Generated Prisma stays private to strict Prisma repository adapters. A
  repository claims only tables its feature owns; a read into another feature's
  tables is a port or that feature's API.
- Core never imports an enterprise implementation. Role-specific enterprise
  composition stays under `packages/enterprise/composition/**`.
- A knowable failure a caller can act on is a `HandledError` with a stable
  code and presentation copy; no `TRPCError` or `HTTPException` outside a
  transport file. The spec wins over the code: a test is never rewritten to
  match a changed refusal.
- A shared worktree is never staged wholesale. Stage exact paths. Commit
  coherent slices. Lanes never run git write commands.

## 2. Counters, and how each is measured

| Counter | Command | Value 2026-09-06 | Value 2026-09-08 23:30 | Target |
| --- | --- | --- | --- | --- |
| Feature-shape rows | `node -e` over `packages/architecture-lint/src/feature-shape-baseline.json` (key `<feature>\|<kind>` after lint L2) | 392 rows, 47 features | **246 rows, 39 features, 27 on the legacy transport** (09-09 01:4x, after lint L2: evaluation, stored-object and monitor rows removed; agent's six and api-key's one read stale against uncommitted work that is not mine) | 0 |
| Fully converted features | rows = 0 | 1 (annotation) | **14**: annotation, api-key (Kimi), dashboard, data-privacy, data-retention, entitlement, feature-flag, notification, platform-health, secret, share, sso, suite, topic | every feature |
| Source-folder-shape rows | same file family | 431 (09-08 17:50) | **356** | 0 |
| Unbound scenarios | `pnpm --filter @langwatch/architecture-lint check:feature-parity`, read `THIS RUN FAILS: N unbound` | 1 | **140** (rose with the restored legacy specs and the lanes' new scenarios; every converted feature's own specs are `✓ all bound`) | 0 |
| `apps/api` typecheck | `tsc --noEmit -p apps/api/tsconfig.test.json`, colour stripped | not clean | **1,432 errors, red by design** until every family converts | prints nothing |
| `apps/worker` typecheck | same for the worker | not clean | **742** | prints nothing |
| architecture-lint findings | `pnpm --filter @langwatch/architecture-lint lint` (summary first since `111eb16bf2`) | red, five baselines | **2,990 findings, 36 policies**, 9 stale rows; 14 baseline files in 8 shapes (L2 running) | 0, no baseline files |
| Handled-error codes added tonight | `packages/handled-error/src/app-codes.ts` | — | **15** (data-privacy 5, data-retention 8, platform-health 2) | every knowable failure |
| Uncommitted paths in the worktree | `git status --porcelain \| wc -l` | — | **~1,400**, almost all the 09-07 pile (section 6) | 0 |
| Disk free | `df -h /` | — | 22 GiB (was 40 at 16:00; lane transcripts and declaration caches) | keep above 15 |

Every whole-repository check takes a machine-wide slot. Lanes run the
per-package form; the whole-repository form runs once before a push.

## 3. Decisions taken

2026-09-01 to 2026-09-06 (unchanged from the 09-06 plan):

- **09-01. The migration is not gradual.** `platform/app` did not have to compile during the move.
- **09-02. Lift and shift, not redesign.** Move a module into the package that owns it and keep its shape. Redesign only at a seam.
- **09-03. Merge main directly on the feature branch.** Never rebase.
- **09-03. Physical extraction is real.** `Capability`, `CapabilityRegistry`, `FeatureDefinition`, `FeatureRuntimeBuilder`, `RuntimeBoot` deleted; both processes compose by hand (ADR-102 amendment).
- **09-04. Decisions 1 to 20** as recorded on 09-06: `rules/` is a layout kind; the boundary-edge baseline expires and only shrinks; the tRPC flatten; run-plans and test-suites answer under `/api/v1` only; producer pipelines one shape (`9c368cf4f6`); saas tasks and plugins; two drained baselines deleted; the orchestrator split (3,956 → 385 + 27); `ParsedCustomModels`; every REST family at `/api/v1` and `/api`, four v1-only.
- **09-05. Restore everything.** No behaviour main has may be lost.
- **09-05. A web surface is a door**; the UI slot seam; flatten the tRPC groups.
- **09-06. Spec rulings** (runtime-composition, typescript-7, memory-footprint, api-reference, licensing). **apidiff is not approved.**

2026-09-07 and 2026-09-08 (this rewrite):

- **09-07. Configuration is schema-driven.** Each feature's config is a zod schema parsed at boot; `process.env` only in the boot file.
- **09-07. `try*` methods are refused.** Absence is a nullable return on `find*` only.
- **09-08. Annotation is the shape** (clause 9). The `module` skill (`references/convert.md`) is the procedure; the feature-shape lint is the ratchet.
- **09-08. Rebuild `@langwatch/api` around one path per transport.** Two paths during phase 2; `MANAGEMENT_API_VERSION` dies in phase 3; `ConnectUpgradeRouterPort` stays; dated addresses are a promise (`api-package-rebuild.md`, decisions 1 to 5).
- **09-08. Fold `@langwatch/platform-api-client` and `@langwatch/runtime-composition/contract` into `@langwatch/api`** (`./web`, `./contract`). DONE `a0e6374877`.
- **09-08. Rename features to modules** after the fold, one agent, TS-LSP, mostly `git mv`; `featureApi` and kin take module names in the same lane. Tree shape unconfirmed (section 9).
- **09-08. "Just delete legacy."** The legacy transport builders are deleted, not retired gradually; 44 features and `apps/api` go red and convert or do not build. DONE `1dfbc5dcf1`.
- **09-08. "Add lint so it can't happen again, not targeted but intent, with errors that are prompts."** `source-folder-shape`. DONE `64322961e3`.
- **09-08. The audit log sits behind one port**, OSS null recorder, enterprise recorder. DONE `008a5cd882`.
- **09-08. Full review of the architecture-lint package**, then rebuild it (section 7).
- **09-08. Every finding from a review becomes a fix, a lint rule or a skill line.** Tonight's sample review produced `memory-twin-untested`, the mount and installer fragment exemptions, two false-positive fixes, four skill rules and a fix lane.

## 4. The conversion board

One row per feature. "Open" lists the feature-shape kinds still on the baseline
for it (after the pending row removals named in section 2). A feature is done
when its row reads 0.

| Feature | State | Landed | Open kinds | Blocked on / note |
| --- | --- | --- | --- | --- |
| annotation | DONE (reference) | 09-07 | `refusing-composition` (Kimi's api-key twin, leaves with api-key) | |
| api-key | Kimi's lane | — | 8 | Kimi; not touched by these lanes |
| audit-log (ent) | DONE behind a port | `008a5cd882` | `memory-twin-untested` | contract test |
| dashboard | DONE | `56b01cb75d` | 0 | 35-operation door: DECISION D-f |
| data-privacy | DONE | `77f4346117` | 0 | nullable redaction in the API: DECISION D-c |
| data-retention | DONE | `1b99fb790c` + `ef107474de` | 0 | |
| entitlement | DONE | `1b20a34b78` | 0 | `costs.*` unused: DECISION D-g |
| feature-flag | DONE | `b96cf81b47` | 0 | worker must provide authz/project/organization to boot flags: DECISION D-h |
| log | DONE bar registry | 09-08 | `unregistered-repositories` | ClickHouse persistence per feature: DECISION D-i |
| metric | DONE bar registry | `16b2707e2a` | `unregistered-repositories` | same; the OTLP metrics sink is composed by nothing |
| notification | DONE | 09-08 | 0 | |
| platform-health | DONE | `e9670fd13e` | 0 (rows pending removal) | needs `internalSecret` door + non-2xx statuses (runtime round two) |
| presence | DONE | `d7d5ea94c0` | `memory-twin-untested` | contract test; actor identity cache: DECISION D-j |
| role | DONE bar REST mount | `84ae292008` + `cccfe396b0` | `memory-twin-untested` | mount waits on the door port (section 6) |
| secret | DONE | `9d279eef12` | 0 | |
| share | DONE | `403a40bd2a` | 0 | `PinnedToActiveShareError` still raw |
| sso (ent) | DONE | `c1363cbb99` | 0 | ledger is a port until identity has an API token |
| suite | DONE | `814620f1bf` + `cba1e5bd02` | 0 | web package governed |
| topic | DONE | `a8508cf3c7` | 0 | |
| authz | 3 of 8 | `7540100bd5` | `contract-service`, `persistence-adapter`, `postgres-without-memory`, `unregistered-repositories`, `nested-web-entry` (scope-picker) | `AuthzService` rename across ~150 files + `PostgresAuthzAdapter` in three processes: QUEUED for a quiet tree; vocabulary package cycle: DECISION D-k |
| user | 3 of 8 | `1c795cfe76` | `contract-service`, `persistence-adapter`, `nested-transport`, `legacy-transport-runtime`, `refusing-composition` | tRPC runtime: anonymous procedure, session row id, caller address (runtime round three); Better Auth directory typed `UserService`: DECISION D-l |
| dataset | DONE bar wiring | `bce3912c7e` | 0 | api wiring landed `9697edd1f5`; nine routes undeclared: multipart, session door, raw bytes, 201-or-200, streamed generator (round three A/B); `dataset-table` surface key + experiment imports in wave 4; `handled-error-surfaces.feature` has four dead scenarios |
| evaluation | 4 of 7 | `ccf912e810` | `contract-service`, `nested-transport` (REST half), `legacy-transport-runtime` | legacy REST family needs the shared-prefix addressing mode (round three); `EvaluationService` typed in six packages outside the lane, incl. `tryGetRunByEvaluationId`/`tryGetInputs` callers in trace; `listCustomEvaluators` wants a `WorkflowApi` operation; process wiring in wave 4 |
| evaluator | 6 of 9 | `80ac67f8a4` | `contract-service`, `no-installer`, `persistence-adapter` | ~15 packages type against `EvaluatorService`; `WorkflowApp` peer to narrow to five operations; process wiring in wave 4 |
| monitor | DONE bar install | `b93fb67ed4` + `9697edd1f5` | 0 | api install blocked on the replication peer (wave 5); tRPC AND-permission gap (round three C); evaluator peer once evaluator lands |
| stored-object | 6 of 8 | `edee46b6e1` | `legacy-transport-runtime`, `nested-transport` | the `/api/files` byte family: raw responses, HEAD twin, in-handler owner resolution (round three A/B); `createUpload` needs a union output (A5); process wiring + tasks inventory port in wave 4 |
| hosted-mcp | BLOCKED | | 3 | OPTIONS preflight, raw OAuth bodies |
| webhook | BLOCKED | | 6 | `v1-in-path` addressing (round two), raw request bytes for signatures |
| gateway | BLOCKED | | 9 | `v1-in-path`, raw bytes (elevenlabs webhook) |
| project, organization | QUEUED | | 8, 9 | route-scoped permission, `dated { v1Twin: false }` (round two) |
| scim (ent) | BLOCKED | | 7 | `scimToken` door (round two) |
| experiment, trace | BLOCKED | | 8, 8 | any-method pass-through routes |
| ops | BLOCKED | | 8 | optional credential (bug-report) |
| auth | BLOCKED | | 9 | BetterAuth any-method handshake |
| coding-agent | BLOCKED | | 9 | `anyAuthenticated` door (round two) |
| agent | QUEUED | | 10 | `agent-call.rest.ts` binds a fact under `middleware:` (move to `facts:`); agent server clean-up brief |
| prompt, model-provider, workflow, github, langy, analytics, automation | QUEUED | | 9 to 11 each | by size; langy and automation last |
| billing, governance, licensing (ent) | QUEUED | | 9 each | enterprise; billing's `createTrpcService` blocks `enterprise-api` declarations |
| identity | QUEUED | | 6 | ADR-115 plan; no API token yet |
| managed-provider (ent) | ORPHAN | | 3 | carries the 09-07 pile's uncommitted work |
| navigation, onboarding | QUEUED | | `nested-web-entry` | web only |

The nineteen per-feature cleanup reviews under `dev/docs/plans/feature-cleanup/`
(2026-08-28 to 09-04, stages review/verify/enact) are the findings logs for this
board. Fifteen features were reviewed and seven partly enacted before the shape
drive replaced enactment with conversion; a conversion lane reads
`feature-cleanup/<feature>.md` when it exists and its open findings ride the
conversion. The README's own status table is retired; this board is the one.

## 5. The API runtime (`@langwatch/api`)

Nine transport files (`rest/{runtime,request,credential,response,openapi,security}.ts`,
`trpc/{runtime,policy,audit}.ts`), one `__tests__/<file>` each. `runtime.ts` is
2,107 lines and its split is a lane of its own (round two reports the cut).

Landed tonight:

| Capability | Commit |
| --- | --- |
| Legacy builders deleted; idempotency ledger, personal caller, management audit, deprecation, capabilities, hand-written docs absorbed | `1dfbc5dcf1` |
| Body limit before validators (413), `ScopeInputMismatchError` 403, docs `tags`, no trailing slash on collection dated addresses | `e7631f0318` |
| Bound facts on `rest.mount` (`projectRestFacts`, `bindRestHeader`), `.withAddressing("v1-only")`, `withDeprecated` + `documentedResponses` + `RestDeprecationLogPort`, `publicRoute({ reason })` | `864a7151df` |
| Organization door: `.withCredential("organizationKey")`, `DoorScope`, `doorScopeOf`, mount refuses the other door by name | `5080220f88` |

| Round two: `anyAuthenticated({ reason })` door via `identity.identify`, `.withPermission(p, { at: "route", param })` via `identity.authorize`, `v1-in-path` and `dated { v1Twin: false }`, `internalSecret` door (scope `null`, by name never by value), `.responds({ 200, 503 })`, `scimToken` door | `0bbce5b9c0` |

`runtime.ts` is now 2,520 lines. Round two's cut for the split: `declaration.ts`
(builder, declaration-time asserts, generic vocabulary; no Hono), `runtime.ts`
(mount and execution), `addressing.ts` (every "which URL" question), the
registry into `security.ts`, idempotency out of `request.ts`. That is ten files
where the fold promised nine: **DECISION D-o.**

| Round three A: `withRawBody`, `withRawResponse({ produces })`, `.methods([...])` with a HEAD twin, `.anyMethod()` + `declined()`, the 405 guard with `Allow`, discriminated-union outputs | `6789a94a1d` |

`runtime.ts` is 3,105 lines after round three A; D-o is now blocking.
Running: **round three, part B** (`api-rest-runtime-gaps-3.md`): item 8 (a
literal-path family) gates the trace OTLP alias, experiment v3's alias and
evaluation's legacy family, which have every other capability they need. Part C (tRPC: anonymous procedure, session row id, caller address,
AND-composed permission) follows. `anyAuthenticated` exists twice
until coding-agent and project convert: the old no-argument `AccessPolicy` from
`@langwatch/api` and the new door from `@langwatch/api/access`.
`packages/api/README.md` still documents the deleted builders.
`apps/api/src/features/discovery/openapi-document.json` and
`docs/api-reference/openapiLangWatch.json` regenerate once `apps/api` compiles.

## 6. Process wiring

Feature lanes never touch `apps/api/src/app/*`, `app-trpc/*`, `app-rest/*` or
`apps/worker/src/app/*`; their reports carry the exact lines and one wiring
lane per wave applies them with HEAD-variant blobs for files that carry other
lanes' hunks.

| Wave | Features | State |
| --- | --- | --- |
| 1 | entitlement, presence, share | DONE `f445a8a470` (one broadcast fabric composed first, no proxy) |
| 2 | secret, feature-flag, data-retention | DONE `94513f717e` (deferred `LocalFeatureApis` references break the flag → eventing → authz → tenancy ring; secret slice moves onto the feature record; nobody-key write refusal restored as `authenticated_actor_required`) |
| 3 | topic, data-privacy, sso, metric | DONE `882ebfa479` (enterprise-api resolves from source; stale `dist/` deleted) |
| 4 | dashboard, platform-health, role (incl. REST mount), suite, authz, user, evaluation, stored-object (api + tasks), monitor (types, remediation) | DONE `9697edd1f5`, 40 files, 17 HEAD-variant blobs |
| 5 | monitor's production install (replication peer stranded on the evaluator graph), twelve untracked worker compositions (D-b), scenario composition (needs the uncommitted ScenarioApi/PromptApi rework), evaluation-read composing the installed feature, dataset content backfill task, OpenAPI regeneration | QUEUED, `wave4-process-wiring.md` §Wave 5 |

**BLOCKED by the 09-07 pile.** Six wiring files could not be committed
because their changed blocks exist only in about 1,400 uncommitted paths left
by the stopped 09-07 lane: `apps/worker/src/app/{worker-tenancy,worker-production,worker-telemetry-read,worker-observability-apps}.composition.ts`,
`apps/worker/src/__tests__/codex-coding-defaults.integration.test.ts`,
`apps/api/src/app/api-trace-read-stack.composition.ts`,
`apps/api/src/features/trace/__tests__/api-key-cost-protections.unit.test.ts`.
The worker cannot land cleanly until the pile has an owner: **DECISION D-b.**

## 7. The architecture-lint rebuild

Review: `architecture-lint-review-2026-09-08.md` (`55c5ac8bd0`). Verdict: the
policies are mostly right (91/91 spec scenarios bound); the package around them
is not (55 files flat in `src`, six over 700 lines, 14 baselines in 8 shapes,
six empty ratchets still carrying loaders and flags, one run printed 30,645
lines of which the first 18,522 were a comment inventory, nine tree walkers,
two import parsers, 99 policy ids registered in three places, 37 of 71 tests
guarding things outside the package, 29 failing, 17 policies untested).

| Lane | Scope | State |
| --- | --- | --- |
| fixes | `memory-twin-untested` kind; `*.server.ts` and `*.mount.ts` exempt from the fragment rule; type-only imports no longer make a reader; `.d.ts` package exports are not runtime entrypoints | DONE `a3a8f40a92`, `c1363cbb99`, `f6ea1c26f1` |
| L1 report and CLI | summary first, 25 per policy, `--all`, `--review-comment-blocks`, exit 0/1/2 pinned, lint queue removed | DONE `111eb16bf2` |
| L2 one baseline shape | `{ version: 1, policy, entries[{ key, measured, expires?, count? }] }`, `readBaseline`/`formatBaseline`/`shrinkCheck` in `baseline.ts`, stale rows from one code path, six empty baselines and 277 lines of their plumbing deleted, 18 stale composed-exports rows removed; D2 kept per policy behind `enforceExpiry`; `README.md` lists the files | DONE `6a643f6527` |
| L3 workspace snapshot | `workspace/{layout,module-graph,snapshot}.ts`, one walk, one parse cache, 25 policies take the snapshot, `source-folder-shape` reads value imports from the graph | DONE `58d0a759b9`; 22.6 s → 12.4 s queue-free, the 10 s bar waits on L5 (one AST pass per file) and one changed-files computation |
| L4 frontend grammar | governed = discovered, flat entries the only spelling, `frontend-ui-boundaries.ts` split four ways | QUEUED (D7) |
| L5 registry and folders | `policies/index.ts` with `definePolicy`, package passes its own folder rule | RUNNING (Sonnet) |
| L6 parity out | own tool; `@inert` tag replaces `LEGACY_INERT` | QUEUED (D1) |
| L7 repo guards home | 37 tests to the code they guard, 29 failing fixed or deleted | QUEUED (D5) |
| L8 messages | 289 sites against the contract, `allowed` on every finding | QUEUED |

## 8. Lanes live now, and their work orders

| Lane | Brief | Started |
| --- | --- | --- |
| REST runtime round three B | `api-rest-runtime-gaps-3.md` | 09-09 01:3x |
| lint L5 | `architecture-lint-review-2026-09-08.md` §Lanes | 09-09 02:0x |

Live briefs kept as work orders: `wave4-process-wiring.md` (landed `9697edd1f5`; its Wave 5 section is the open work order),
`api-rest-runtime-gaps-3.md` (part A RUNNING, B and C QUEUED), `api-package-rebuild.md` (phase 3
deletion list, QUEUED for after the last family converts),
`modules-rename.md` (DECISION then QUEUED), `agent-server-cleanup.md` (QUEUED
with the agent conversion), `architecture-lint-review-2026-09-08.md` (L3 to
L8). Every landed brief is retired in section 14.

Rules every lane runs under: Opus only; Read/Edit/Write, no scripted rewrites,
read before delete, `mv` not `git mv`; no git writes; no root typecheck, lint or
format; no baseline edits (the root session does them); the spec wins; a
memory twin ships with a contract test; `source-folder-shape` applies; one
`pnpm install` per package.json change; report in the skill's shape with exact
wiring lines for the root session.

## 9. Decisions open for Alex

Ordered by what they unblock.

- **D-a. The modules tree shape.** Repo-root `modules/` and `enterprise/{packages,modules}` (my reading of "in the root we have packages, modules, enterprise") or `packages/modules/*`. Also: run before or after Kimi lands api-key. Unblocks clause 12.
- **D-b. The 09-07 pile.** About 1,400 uncommitted paths from the stopped lane (worker-tenancy rewrite, api-trace-read-stack, catalogue rewrites, ~890 files yesterday). Adopt by slice, hand to an owner, or discard. Unblocks the worker side of wave 4.
- **D-c. data-privacy redaction in the API process.** Nullable collaborator throwing a plain `Error` (only log and metric call it, worker-only) versus a record-redaction port owned by log and metric.
- **D-d. `Claude-Session` commit trailer.** The harness requires it; your older rule was no attribution trailers.
- **D-e. A test database.** `LANGWATCH_TEST_DATABASE_URL` is set neither by haven (no stack registered for this worktree) nor in the root `.env`. Every Prisma half of the five contract test suites skips until it is. Set it once and run the five `test:integration src/repositories/__tests__` commands.
- **D-f. `DashboardApi` carries 35 operations** (dashboards, graphs, saved workbench charts, saved views). Keep one door or split saved views and workbench charts back out.
- **D-g. entitlement `costs.*`** is read by no UI: delete.
- **D-h. api-role-scoped dependencies in runtime-composition.** `static dependencies` resolve in every role, so the worker provides authz, project and organization just to boot feature flags.
- **D-i. Per-feature persistence.** `defineRepositories` keys on the application's one `withPersistence` backend, so a ClickHouse feature booted in a Postgres graph (log, metric) cannot register. Proposed `withFeature(x, { persistence: "clickhouse" })`.
- **D-j. Presence actor identity.** The tRPC actor carries only an id, so presence pays a directory read per cursor tick at 15 Hz. A short-lived cache, or email on the actor.
- **D-k. The authz vocabulary cycle.** `@langwatch/api` depends on `@langwatch/authz-contract` for the permission vocabulary, so authz's contract cannot declare its tRPC procedures. Split the vocabulary into its own package (phase-3 cycle). Also: `AuthzApi` has 54 operations.
- **D-l. Better Auth's user directory** is typed `UserService` and calls operations `UserApi` does not offer. `UserApi` grows them, or auth owns a port.
- **D-m. Role behaviour changes to confirm.** Custom-role create/update/assign answered 503 on every deployment (no plan gate was ever composed) and now work under the Enterprise gate; `removeExclusiveApiKeyRoles` deleted as uncalled (Kimi's api-key retirement may want it).
- **D-n. `AuditLogApi` widening, OSS audit log, ClickHouse persistence, the feature-catalogue split, org-door and agent-server brief pastes** (the five from 09-08 morning, still open).
- **D-o. `packages/api/src/rest` at ten files, not nine.** Round two's cut splits `runtime.ts` (2,520 lines) into declaration, runtime and addressing and moves the registry into `security.ts` and idempotency out of `request.ts`. Either the nine-file promise moves to ten, or `request.ts` and `response.ts` merge to pay for it. Round three grows the file further until this is decided.
- **Lint D1 to D7** (section 7's review): parity tool Go or TS; `expires` enforced or shrink-only; the 26 web-package cycles; comment-block ratchet beside the oxlint rule; the 17 untested policies; where the oxlint baseline check lives; refuse `screens/*` spellings now or after the drive.

## 10. Open items carried from 2026-09-06

Size: S under 2 hours, M half a day, L a day or more, XL multi-day. RB marks a
merge blocker. Where 09-08 changed an item, the note is at the end of its text.

| # | Item | Size | RB | Kind | Owner | Lane |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Feature-transport security Highs with no closing commit. C1: `project:view` mints a full-access legacy project key through the MCP OAuth approval (`api-production.composition.ts:1994`, `mcp-authorize.api.ts`). H6: a legacy key reads any organisation's OTTL rules by id. H9: `workflows:view` escalates to a run through a legacy-key self-fetch. H12: gateway budget and cache-rule REST mutations check the project and act organisation-wide. H14: a licence key carries no organisation binding (`license-generation.service.ts:71`). Verify each against the tree first. The pass predates six security commits | XL | yes | Sec | | security |
| 2 | Fail-open shapes in `@langwatch/api`. `handlerManagedAuth` declares and nothing verifies (42 routes; `langy-local.api.ts:49` enforces key ownership only). `SecuredApp.hono` is public. Legacy project keys skip every `requires()` gate. `internalSecret` without `verifySecret` is an empty chain. The tRPC chain has no type-level scope coupling. The eight-point design is in the authz audit report. 09-08: the legacy builders are deleted; `publicRoute`, doors and facts replace `handlerManagedAuth`; the tRPC scope coupling is `serviceAuthorized` + declared access. | XL | yes | Sec | | authz |
| 3 | Journey defects with no fix commit. D13: a trace read waits on ClickHouse for ever. D17: a span evaluation never reaches the trace read. D11: "Create Online Evaluation" is intermittently inert and silent. D19: the worker outbox drain stalls ingestion with `P2028` (a boot-window transient on the 09-04 walk). D20: the agent-testing run drawer crashes when turns render | XL | yes | U | | e2e |
| 4 | Lint rulings only Alex can give, then the burn. `ui-screen-closure`, `ui-surface-closure`, `ui-web-public-entry` and `ui-feature-implementation-import` (46, 38, 30, 8): may a screen import another package's `surfaces/<id>` door? `enterprise-composition` (19): seven governance adapters shared by both compositions have no admitted home. `comment-block-size` (1,265): raise the cap, scope it to production code, or make it advisory. `application-boundary` (1): `apps/ui` names `AppRouter`, which waits on ADR-130 stage 2. `feature-source-layout` (1): the langy delivered-calls set. `apps/api/src/features/agent-cache/` was never extracted | XL | yes | H | | lint |
| 5 | Comment-block roots expire 2026-09-17 and fail the run that day: `apps/api` 1,281, `apps/ui` 671, `apps/worker` 499, `apps/server` 93, `apps/tasks` 6. Sweep each application, or move the dates on purpose. The sweep remainder is the rest of `trace/server` plus about 35 feature server packages, 726 blocks | L | yes | H | | comment-sweep |
| 6 | PR #7536 is still a draft, so no gate in any plan has run in CI. Drafts skip the build and race jobs. Mark it ready and read the first full run as the baseline | S | yes | H | | ci |
| 7 | langwatch-saas does not build against this branch. Delete the five moved tasks. Keep `backfillInviteUsersToCio` as a `@langwatch/task` plugin. Drop the submodule. Build `FROM` the public image. Repoint `sync-model-registry.yaml`. Other repository | L | yes | U | | saas |
| 8 | Visual diff of every route, main against the branch, with no unexplained row. `tools/visualdiff` exists (`d3d8a930a6`). Blocked on applying the three 2026-09-04 additive migrations to the shared dev database | M | yes | U | | visual-diff |
| 9 | `GET /api/traces/{traceId}/transcript` is a documented operation and is still unmounted. It waits on a composed `LogService`. `1c180c7204` only names the absence. 09-08: still unmounted; waits on log's ClickHouse registry (D-i). | M | yes | U | | api |
| 10 | Wire `oxlint-tsgolint`. It restores `noFloatingPromises`, `noMisusedPromises`, `useOptionalChain` and `useLiteralKeys`, all lost with Biome. Only a comment in `.oxlintrc.architecture.json:3511` names it | M | no | H | | lint |
| 11 | ADR-130 stages 2 to 4: move 38 procedure maps to contracts, declare `AppApiMap`, annotate `ApiApplication.trpc`, add the conformance test. Then the api-map lane: 39 `createFeatureApi<` sites become `trpcReact`, and `feature-api.ts` and `use-invalidate-procedure.ts` are deleted. No `AppApiMap` is in the tree yet; `04ba1ac99d` moved 22 entries | XL | no | Perf/H | | api-map |
| 12 | Architecture-lint burn-down slices still open. A1 and A2: `apps/api` and `apps/worker` stop importing enterprise feature packages. A3: plan-gate rename, agent-cache move, `custom-evaluators.ts` port. A5a to A5c: adapter doors for about 56 consumed private exports. A6a to A6c: `PrismaClient` outside the seam, with `typed-prisma-seam-baseline.json` still present. A7: Prisma enums in contracts. A9: `try*` renames. L1 to L6: 303 layout moves. W1 and W3. A12 to A19. Every count predates R1 to R6. Re-derive first. 09-08: superseded by the feature-shape ratchet (section 4) and the lint rebuild (section 7). | XL | no | H | | burn-down |
| 13 | Tasks lane. `topic-clustering-run` is still unregistered and needs its runner's collaborator graph (3 days). Fix 16: lazy handle composition on `TasksHost`, because `prisma-migrate` opens ClickHouse and Redis it never reads. Fix 18: audit the `stored-object/server` index exports | L | no | H | | tasks |
| 14 | `NlpLambdaRuntimeService` is restored in workflow-server and composed by nothing: the Lambda invoke port has no adapter. The S3 round-trip scenario needs a dogfood bucket lane | M | no | U | | nlp |
| 15 | Parked behaviour needing a UI decision. The prompt editor standalone Inputs section (3 scenarios, `@unimplemented`). The workspace-switcher tooltip and auto-focus (3, parked). `sdk-scenario-set-limit.feature` (14 `@unimplemented`, written ahead of the feature: build it or delete it) | M | no | U | | product |
| 16 | The one unbound scenario: `shared-section-navigation-layout.feature` narrow viewport needs a real browser lane, because jsdom cannot evaluate a media query. Plus 13 unknown annotations to reconcile | S | no | H | | parity |
| 17 | `worker: null` is still in `apps/api/src/features/langy/langy.composition.ts:211`. Nobody probed whether a browser turn-start can reach the API-side refusal | S | no | U | | langy |
| 18 | Two rulings due at merge. Legacy `/api/secrets` write-actor and duplicate-error byte compatibility. Which single SDK or OTel entry owns api, worker and Eventing instrumentation. 09-08: the `/api/secrets` write actor is settled (a key bound to nobody is refused, `authenticated_actor_required`); the alias is deprecated with the successor named. | S | no | H | | decisions |
| 19 | Unverified walk findings. F2: a failed `organization.getAll` renders an empty document with no error state. F5: one REST request writes up to 21 identical log lines. F7: `system.backup_log` collection is on by default and warns every boot. F8: `apps/ui/vite.config.ts:35` loads `.env.portless` with `override: true` while the api and the worker do not | M | no | U/H | | e2e |
| 20 | The extracted full-read path trusts a stale storage-anchor hint. It was never verified against the legacy mapper characterisation | M | no | U | | trace |
| 21 | Exit-ledger remainders. `modelProvider.getAllForProjectForFrontend` no longer returns `modelMetadata`, so the settings page may render none. `MODERN_API_METHODS` still lists `register` (`api-transport-boundaries.ts:23`). Of the five unwired pipelines, `identity` and `join-request` installers are now imported by the worker composition; `sso-connections`, `scim-sync` and `agent_sandbox_maintenance` are unverified | M | no | U/H | | api |
| 22 | Run the seam review. Fable reads seams 1a to 1d once. Sample the `trace` and `governance` packages. Sonnet lanes write findings per package to `seam-review-2026-09-06/<pkg>.md`. Turn on "Require review from Code Owners" for `main` | L | no | H | | review |
| 23 | Product ruling on the web host. `@langwatch/workflow-web/studio-host/api` has 79 importers from other features' screens. The studio drawer and dialog supersets move to the design system. `model/prisma-types` moves to `workflow-contract`. `member-seat-usage.tsx:7` still imports the enterprise `resource-limits` surface directly | L | no | H | | ui |
| 24 | Fourteen narratives cut from comments need their ADR homes written: the idempotency ledger ADR, the tRPC chain ADR, five ADR-129 appendices, an ADR-127 appendix, an ADR-060 appendix, an error-handling security note, and the trace storage-anchor history. The full table is in section 10a | M | no | H | | adr |
| 25 | Memory repositories for every service unit test, and a chdb spike for repository tests (2 days, go or no-go) | L | no | H | | test |
| 26 | `caseFiling.integration.test.tsx` is skipped. Run-plan folder grouping lives in `PlanScopeField.CaseChoices`, which has no test | S | no | H | | test |
| 27 | Agent-testing web modules still compose Scenario, Prompt, Agent and Suite behaviour together. Inventory the mixed modules and separate them around named browser responsibilities: scenario case editing, agent and prompt target selection, suite plan editing, and the small `apps/ui` composition layer. Do not replace the mixture with one large shared context | L | no | H | | ui |
| 28 | `setNurturingDatabase` had no caller. Nurturing repositories now exist in billing: verify they are wired. `apps/api` has no integration lane, so its Postgres tests use `describe.skipIf` | S | no | H | | billing |
| 29 | REST chain and security spine remainders. The better-auth `Request` pass-through is unproven and multipart is unparsed. Spine mediums unverified: M1 rate limit after body parse, M3 empty `X-Project-Id` 500, M8 `/api/auth/validate` unthrottled oracle, M9 origin gate on `/api/auth/*` only, M13 EXPLAIN `system.*` guard quoted-identifier bypass, M15 five project-scoped models exempt from the tenancy guard, M16 eleven list endpoints with no page size | L | no | Sec | | security |
| 30 | Residual unknowns. Body-shape drift on about 253 mounted REST operations (apidiff's job, not approved). Procedure-level gaps inside mounted namespaces. haven `migrations failed: context canceled` | M | no | H | | api |
| 31 | Release note: run `make haven install` after the merge. A binary built before the removal hard-refuses at boot | S | no | H | | release |


### 10a. ADR homes still to write

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
| `apps/api/src/features/enterprise/webhook.composition.ts` | The webhook entitlement gate is a plan read, not an enterprise capability, so a deployment with no governance app answers a 403 instead of a 503 | Best practice: composition roots |
| `packages/features/webhook/server/src/app/webhook.app.ts` | Why `WebhookApp` is a holder rather than a restatement of endpoint-store operations | `best_practices/service-repository-adapter-port.md` |
| `apps/api/src/features/trace/trace-rest.mount.ts` | Named absence: the coding-agent transcript join is not supplied, because `composeApiTraceReadStack` refuses `LogService.getLogsByTraceId` by name | Best practice: composition roots |
| `apps/ui/e2e/langy/local-control-fixture.ts` | The CLI API key mint is read back before use. `apiKey.create` answering 200 has left the binding unwritten under load | ADR-129 appendix |

## 11. Deferred to post-release

- **Decision 21: the canonical error envelope.** The flat REST error body
  becomes one envelope. It needs its own ADR, a dated version, about 20
  families and the SDKs. XL.
- **`check-unspecced-features`**, in three stages, covering everything that
  starts after this release.
- **Mail growth hooks.** A product decision.
- **ADR-009 retirement**, with `otel-trace-context-propagation.feature`
  (10 `@unimplemented` scenarios). ADR-097 supersedes the platform span
  collection.
- **Agent-testing web decomposition** (section 10 item 27), after the move.

## 12. The diff-drive gate

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

## 13. Reference material

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
documents named in section 14. Copy it into `dev/docs/adr/` when Alex accepts
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

## 14. Retired plans

Every document below was deleted on 2026-09-06 or 2026-09-08. Each line names
what the document was for, what it decided or found, and where its remainder went.


| Document | What it was for | What it decided or found | Remainder |
| --- | --- | --- | --- |
| `main-merge-plan.md` | The recipe for merging `origin/main` into the branch | Merge directly on the feature branch, never rebase | Section 3 (2026-09-03). The commits are `9a62f5929b` and `d4e51c8e22` |
| `worker-consumer-cutover-plan.md` | How the deployed worker becomes the one consumer of the eventing jobs | Registry handoff: the App eventing instance is producer-only on the worker role, and the packaged composition is the only consumer | ADR-102 amendment (2026-09-06) |
| `core-application-feature-extraction-handoff.md` | An operational restart note, 2026-08-28 | Nothing durable | Deleted. Git history |
| `api-transport-extraction-handoff.md` | An operational restart note, 2026-08-28 | Nothing durable | Deleted. Git history |
| `core-application-feature-extraction-future-work.md` | Structural work outside the behaviour-preserving extraction | Agent-testing web modules mix four domains and must be separated after the move | Section 10 item 27 |
| `core-application-feature-extraction-plan.md` | The platform application exit plan | The eight definition-of-done clauses, the invariants, and seven resolved decisions | Sections 1 and 3. It is the seed of this document |
| `connected-agents-restore-plan.md` | The 134 KB restore plan for connected agents | The runtime shape, the WebSocket hosting decision and the slice order. ADR-128 holds the contract | ADR-128 "Consequences" (the named absences). The rest is git history |
| `core-application-exit-decisions-for-review.md` | The 366 KB exit ledger, 167 sections | Almost every section closed | Sections 70, 125 and 167 are section 10 item 21. The rest is git history |
| `suite-restore-review.md` | Review of the suite run-plan restore | The suites are restored and bound against Postgres and ClickHouse (2026-09-06) | Closed. Section 3 (decisions 4 and 5) |
| `tasks-lane-review.md` | Review of the `apps/tasks` lane | Three fixes stayed open | Section 10 item 13 |
| `tasks-launch-interface-and-saas.md` | The tasks launch interface and the langwatch-saas split | Five saas tasks move into this repository. `backfillInviteUsersToCio` stays a private `@langwatch/task` plugin, because it repairs one incident rather than a repeatable operation. `onboarding-completion-rate` is blocked on an onboarding server package | ADR-102 amendment (the plugin mechanism). Section 10 item 7 (the saas steps) |
| `trpc-flatten-design.md` | The tRPC group flatten | Steps A to D. All landed | Section 3 (2026-09-05) |
| `trpc-flatten-review.md` | The review of that flatten | Steps C and D landed | Section 3 (2026-09-05) |
| `install-composition-review-2026-09-03.md` | Install and composition review of the platform-api packages | Sections A and B landed in `268eb2ed83`. The api-map lane is step E and stayed open | Section 10 item 11 |
| `composition-simplification-options.md` | Options A to J for simplifying composition | Superseded | The composition design ADR draft, section 13 |
| `feature-application-and-typed-transports.md` | A typed feature-application transport shape | Superseded | The composition design ADR draft, section 13 |
| `typed-rest-context-design.md` | A typed REST context | Superseded | The composition design ADR draft, section 13 |
| `architecture-lint-burn-down-plan.md` | The burn-down of 2,946 architecture-lint violations | The seven ground rules, R1 to R9 landed, and the open code slices | Section 12 (the ground rules). Section 10 item 12 (the open slices) |
| `architecture-lint-review-2026-09-03.md` | Companion review of the lint rules | Folded into the lint review lane | The lint review report, section 13 |
| `experiment-orchestrator-split-plan.md` | The split of an 88 KB orchestrator service | Done: 3,956 lines became 385 lines plus 27 sibling services | Section 3 (decision 16) |
| `ui-family-move-manifests.md` | Eighteen manifests for the UI family moves | The drawer registry mechanism moves, not the drawers. `@langwatch/ui-drawer` owns the address vocabulary, the navigation stack, the stores, the lazy registry and `CurrentDrawer` | `best_practices/drawers.md`, section "The drawer registry" |
| `ui-subscription-transport.md` | The tRPC subscription wire for the browser | All nine live procedures resolve on the api root and stream over `/api/sse/*`. The wire is ours, not tRPC's | ADR-128 (public REST and internal tRPC) amendment |
| `ui-install-surface-2026-09-05.md` | One install surface for the browser application | `uiFeature` and `installUiFeatures`. A duplicate page key or drawer name is refused by name | `best_practices/ui-install.md` |
| `ui-slots-2026-09-05.md` | The core-to-enterprise UI slot seam | A core screen asks for a block by name and renders its fallback. Only `apps/ui` fills a slot | `best_practices/ui-install.md`. The open ruling is section 10 item 23 |
| `ui-host-capabilities-2026-09-05.md` | The browser host ports in `packages/ui-host` | Router, toaster, error presenter and link move to `@langwatch/ui-host` | `best_practices/ui-install.md`. The product ruling is section 10 item 23 |
| `rest-chain-extensions-2026-09-05.md` | The REST chain gap survey, G1 to G12 | All twelve are built. The remaining unknowns are the better-auth pass-through and multipart | `packages/api/adrs/005-rest-chain-extensions.md`. Section 10 item 29 |
| `trpc-fluent-chain-2026-09-05.md` | The tRPC fluent chain | The chain is one argument and terminates in `.handle(fn)`. `withOutput` never reaches tRPC's `.output()` | `packages/api/adrs/006-trpc-fluent-chain.md` |
| `e2e-walk-2026-09-03.md` | The first end-to-end walk | It boots and it cannot be used: `/api/auth` was mounted by no process | ADR-010 amendment (2026-09-06) |
| `e2e-platform-plan-2026-09-04.md` | The plan for the four end-to-end suites | Eight decisions, including "the evaluator was hit is proven through a monitor" and "known platform gaps fail by name" | ADR-010 amendment (2026-09-06) |
| `why-so-many-bugs-2026-09-04.md` | Why the branch shipped so many bugs | Five causes and the six-point gate | Section 12 (the gate and the causes). `TESTING_PHILOSOPHY.md` (the pieces-against-product cause) |
| `open-decisions-2026-09-03.md` | Every decision needing Alex | 19 of 21 decisions resolved | Section 3 (resolved). Section 10 items 5, 6, 11, 17 and 18 (unresolved) |
| `binding-gaps-2026-09-04.md` | The unbound-scenario census, written at 1,333 unbound | Superseded by the restore-or-retire rows and the parity run | Section 10 items 15 and 16 |
| `restore-or-retire-2026-09-05.md` | Behaviour the lift left behind, row by row | Ruled 2026-09-05: restore everything. No behaviour main has may be lost | Section 3 (the ruling). Section 10 items 4, 14, 15, 16 and 28 |
| `restructure-bug-hunt-2026-09-03.md` | The hunt for unserved surfaces and restored bugs | 22 documented REST operations were unmounted | Section 10 items 9 and 30 |
| `unmounted-surfaces-audit-2026-09-04.md` | The unmounted-surface audit | Platform-era. Superseded by the route-coverage gate `2653514dfd` | Section 10 item 9 |
| `openapi-parity-2026-09-04.md` | OpenAPI parity, 78 KB | Platform-era. The generator landed in `60ca74941a` | Section 10 item 30 |
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
| `span-referenced-payloads-are-not-in-the-event-union.md` | `makeId` is typed for events it cannot name | A subscriber has two types, not one: the event it is delivered and the payload its own `stage` returns. Separating them is an eventing framework change | The eventing design ADR draft, section 13 |
| `test-doubles-drift-because-the-check-that-would-catch-them-is-drowned.md` | Why test doubles drift | The check exists (`typecheck:tests`) and is red for unrelated reasons. Drive the count down; do not claim tests are unchecked. A "does this exist" sweep must match declaration forms, not the export keyword | `TESTING_PHILOSOPHY.md`, section "Test doubles drift" |
| `automatic-migration-enrolment-gap.md` | One finding: an enrolment gap | Closed | Deleted. Git history |
| `gateway-budget-check-is-unguarded.md` | One finding: an unguarded budget check | Closed | Deleted. Git history |
| `api-boot-gaps-durable-append-rate-limit.md` | Boot gaps: durable append and rate limit, 53 KB | Closed | Deleted. Git history |
| `package-move-capability-gaps.md` | Capability gaps left by the package moves | When a move re-authors rather than renames, diff the two files by behaviour. A constant or a state field that travelled without the control that drove it is the tell | `TESTING_PHILOSOPHY.md`, section "A move that re-authors". Section 10 item 26 |
| `seam-review-2026-09-06.md` | How to review the branch | Machines review the bulk, Fable reads the seams once, Sonnet lanes emit findings | Section 12 (the seam review method). Section 10 item 22 |
| `adr-candidates-from-comment-sweeps-2026-09-06.md` | Fourteen narratives cut from comments | Each needs an ADR home | Section 10a |
| `api-transport-split.md` | Phase 1 of the API rebuild: one path per transport, the annotation reference on it | Landed `123bd57406` + `3985d284a0` | Section 5. `api-package-rebuild.md` keeps the phase-3 list |
| `api-package-fold.md` | Fold `platform-api-client` and `runtime-composition/contract` into `@langwatch/api` | Landed `a0e6374877`, `75b713c020` | Section 3 (09-08) |
| `api-legacy-delete.md` | Delete the legacy transport builders and fold `@langwatch/api` to nine files | Landed `1dfbc5dcf1`; four specs kept `@unimplemented` | Sections 3 and 5 |
| `api-runtime-defects.md` | Four REST runtime defects the secret conversion exposed | Landed `e7631f0318` | Section 5 |
| `api-rest-runtime-gaps.md` | Facts, v1-only families, deprecation with documented responses, public routes | Landed `864a7151df` | Section 5 |
| `api-rest-organization-door.md` | The organization credential door on the declared REST path | Landed `5080220f88`; role declares it `cccfe396b0` | Section 5; the mount is in `wave4-process-wiring.md` |
| `wave1-process-wiring.md` | entitlement, presence, share into the api | Landed `f445a8a470` | Section 6 |
| `wave2-process-wiring.md` | secret, feature-flag, data-retention into api and worker | Landed `94513f717e` | Section 6 |
| `wave3-process-wiring.md` | topic, data-privacy, sso, metric into api and worker | Landed `882ebfa479`; six files blocked by the pile | Section 6, D-b |
| `audit-log-port.md` | The audit log behind one port, OSS null recorder | Landed `008a5cd882` | Section 3 (09-08) |

Thirty-nine comments in source files still name a retired document, most of them
`ui-family-move-manifests.md`. Each is a historical pointer, not a link a
reader follows to run something. The table above is the index: look the
filename up here to learn what the record held and where the remainder went,
and recover the original text with `git log -p -- dev/docs/plans/<name>`. A
comment sweep may repoint them; do not repoint one at a document that does not
carry the fact, because that turns a stale pointer into a false statement.

Two directories were kept. `dev/docs/plans/main-merge-ledger/` holds eight
generated path lists from the 2026-09-03 merge. `dev/docs/plans/feature-cleanup/`
holds nineteen per-feature cleanup reviews and a README whose working rules (the
fold procedure, the six rewrite hazards, the divergence pattern) still apply;
its status table now points here. Neither is empty and neither holds only
retired documents, so both stay.

Retired 2026-09-09: `api-rest-runtime-gaps-2.md` (round two of the REST runtime; landed `0bbce5b9c0`, every item and its consumer lines are in section 5 and `api-rest-runtime-gaps-3.md`).
