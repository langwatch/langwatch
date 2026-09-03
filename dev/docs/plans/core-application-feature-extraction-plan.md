# Platform application exit plan

**Landed 2026-09-03.** `platform/` is deleted (`faaa9ec333`, Cutover C: 306
rows, `git diff --numstat -- platform` zero insertions on every one). The
executable ledger this file used to carry — twelve waves, the working-tree
slice partition, the worker blocker graph and the slice-by-slice record of
every vertical's move — is git history. What is below is the exit's outcome,
the invariants that still govern, and the findings that outlived it.

## What the exit produced

Three Node applications and a feature-package workspace:

- **`apps/api`** is the live HTTP/tRPC/REST process. It owns request context,
  auth, authorisation, limits, error mapping, logging, tracing and graceful
  shutdown; `createAppTrpcFeatures` composes every namespace on its own root
  behind its own policy chain, and `/api/sse/*` serves subscriptions on that
  same root (`ui-subscription-transport.md`).
- **`apps/worker`** is the live background process, the packaged registry its
  one consumer since `4542cdc38c`. It owns queues, Eventing, projections,
  process managers, wakes, retry-safe intents, scheduled tasks, liveness and
  graceful drain.
- **`apps/ui`** boots the browser and owns all routing and page composition,
  installing reusable feature-web screens through its own feature declarations
  (`ui-family-move-manifests.md`).
- **`apps/tasks`** is the fourth executable, one composition root and one CMD
  for every one-shot program (`tasks-launch-interface-and-saas.md`).

Cutover A repointed the OpenAPI target and the root `test:*` scripts; Cutover E
closed the lockfile, the root `dev`/prepare/seed scripts, `pack-npm.sh`, the
four repo-level guards and haven's seed presets. The one `platform/` path left
in a live file is `.gitleaks.toml`'s allowlist (Cutover D's).

## Definition of done — where each clause stands

1. `apps/api` owns the request lifecycle. **Done.**
2. `apps/worker` owns the background lifecycle. **Done.**
3. `apps/ui` boots the browser with no `platform/app` imports. **Done.**
4. Every catalogue feature has one canonical contract/service/repository graph.
   **Done**, modulo the layout burn-down (`architecture-lint-burn-down-plan.md`).
5. No production code uses global `App`, `getApp`, `tryGetApp`, global Prisma,
   package-level env access or import-time registration. **Done**, and
   `global-app-access` is kept as a permanent tripwire against reintroduction.
6. Public REST, internal tRPC, SDK, MCP, webhook, ingestion and generated
   OpenAPI/client contracts have explicit parity proof. **Not done** — 22
   documented REST operations are still unserved and the checked-in OpenAPI
   artefacts are stale. See below and `restructure-bug-hunt-2026-09-03.md`.
7. Migrations, tasks, assets, E2E suites, scripts, instrumentation, CI and
   deployment definitions no longer assume `platform/app`. **Done**, except
   that a `haven` binary built before the removal still refuses to start —
   `make haven install` is required after this branch lands.
8. `platform/app` and every reference to it are deleted. **Done.**

## Invariants that still govern

These are not history; they are the rules any later change is read against.
Where an ADR states one, the ADR is the authority and this is the index.

- `packages/features/catalogue.json` is the authority for the singular feature
  owners.
- `apps/api`, `apps/worker`, `apps/ui` and `apps/tasks` are physical process
  composition roots. `apps/server` is local/development orchestration only.
- A feature owns its contract, canonical server implementation and reusable web
  behaviour. Processes install those surfaces; they do not reimplement them.
- Preserve URLs, procedure names, OpenAPI shapes, response fields, auth,
  errors, ordering, pagination, time/money units, effects, retries and
  idempotency unless an explicit decision changes them.
- Packages do not read environment modules. Each process parses and validates
  configuration once through `packages/config` and injects typed semantic
  values.
- API and worker construct one process-owned logger/tracer graph from
  `@langwatch/observability/node`; UI uses only browser-safe observability.
- Generated Prisma stays private to strict Prisma repository adapters.
- Core never imports Enterprise implementations. Role-specific Enterprise
  composition stays under `packages/enterprise/composition/**`.
- Shared-worktree changes are never staged wholesale. Stage exact paths and
  commit coherent slices.

## Resolved decisions worth keeping

1. **Eventing adapters** use the server-only `@langwatch/eventing/server`
   export; no second package, no adapters in Topic or the worker.
2. **ClickHouse:** the managed tenant-aware resolver stays in
   `@langwatch/clickhouse-client`; Eventing and features consume it through
   injected typed dependencies.
3. **Queue payloads:** Group Queue owns shared payload offload, staging
   headers, cleanup, limits and retry/redelivery semantics.
4. **Enterprise model providers** extend `@langwatch/enterprise-worker`; the
   core worker consumes the portable service.
5. **Secret REST** accepts singular and plural resources with and without the
   version prefix (`/api/v1/secret`, `/api/v1/secrets`, `/api/secret`,
   `/api/secrets`) plus their item paths; unversioned selects latest,
   `X-API-Version` may select `v1`, and path/header disagreement is rejected.
6. **Trace full-read** stays canonical, internal and all-visible; public
   actor/viewer protection is a separate trust boundary that composes canonical
   read, protection and edit overlays.
7. **The migration was not gradual.** `platform/app` did not have to compile,
   boot or serve during it, and the only permitted edit there was a deletion.
   The recipe from 2026-09-02 was lift-and-shift: move a module into the
   package that owns it keeping its shape, fix the moved code's imports, leave
   every other platform importer broken, delete what the move made unreachable.

## Follow-ups that outlived the exit

Everything scoped to `platform/app` closed with the tree. These are the ones
still reachable in current code, re-verified 2026-09-03.

| ID | Finding | Where it goes now |
| --- | --- | --- |
| `F-API-01` / `F-API-07` | The checked-in OpenAPI artefacts are stale, and the frozen document lists 22 operations no composition mounts (`/api/v1/agents*`, `/api/v1/run-plans*`, `/api/v1/test-suites*`). Regeneration must happen last, on the merged branch. | `restructure-bug-hunt-2026-09-03.md` |
| `F-LINT-01` | Full architecture lint is red. Superseded: the whole surface is planned slice by slice. | `architecture-lint-burn-down-plan.md` |
| `F-TRACE-01` | The extracted full-read path trusts a stale storage-anchor hint. Verify against the legacy mapper characterisation before the read stack is treated as parity-proven. | open, unowned |
| `F-GATEWAY-CAT-01` | **Still live.** `toLegacyCompatibleCustomModels` (`packages/features/model-provider/contract/src/custom-model.ts:45-57`) `safeParse`s each entry against a `.strict()` schema and `flatMap`s failures away, so a stored `customModels` entry carrying an unrecognised key is silently dropped and the model becomes unroutable with no error. | open, unowned |
| `F-HOME-01` | `user.homePagePickerState`'s first-project port and `governance.resolveHome`'s first-project query disagree: the resolver excludes personal workspaces (ADR-038 v6), the picker does not, so the picker can offer a personal-workspace slug the resolver will never route to. | open, unowned |
| `F-WEBHOOK-01` | Eight callbacks in the webhook/gateway REST integration files assert nothing the deterministic test-quality review can recognise as observable behaviour. | folds into the burn-down's `test-quality` slice (A19) |
| `F-AGENT-01` | `specs/agents/AUDIT_MANIFEST.md` still points at deleted management UI paths and does not bind the moved scenario tests. | refresh with the connected-agents parity sweep (Slice 9) |
| `F-AGENT-02` | Agent management replacement coverage does not directly assert every former dialog success/close/toast/invalidation outcome. | open, low priority |
| `F-DATASET-01` | The standalone dataset backfill task has a generated-Prisma to `DatasetMigrationDatabasePort` aggregate promise mismatch. | folds into the `dataset-content-backfill` wiring (`tasks-lane-review.md`) |
| `F-SPEC-GOV-01` | `specs/ai-gateway/governance/admin-trace-access.feature` had no binding tags, so it enforced nothing. **Now carries six** — confirm with `check:feature-parity` and close. | close on the next parity run |
| `F-BRANCH-01` / `F-CI-01` | No gate in this plan was ever checked by CI. PR #7536 is still a **draft**, and drafts skip the build and race jobs — a green draft is not evidence. | mark ready before reading any check as proof |
| `F-LINT-02` | Wire `oxlint-tsgolint`. It restores all four type-aware rules lost when Biome was removed (`noFloatingPromises`, `noMisusedPromises`, `useOptionalChain`, `useLiteralKeys`) in one move. `noImplicitAnyLet` and `noEvolvingTypes` have no oxlint equivalent at all and need TypeScript semantics. | open, needs a machine that can run a type-aware lint over the tree |

## Decisions still approaching

1. **Secret compatibility retirement** — whether legacy project-key write actor
   handling and duplicate-error text must stay byte-for-byte compatible, or may
   converge on the canonical Secret service when `/api/secrets` is retired.
2. **Observability SDK ownership** — which single LangWatch SDK/OTel entry owns
   API, worker and Eventing instrumentation.

The third ("UI platform ports") is settled: the host ports landed and the
temporary feature host adapters are deleted (`268eb2ed83`).

## Where the live work is now

| Lane | Document |
| --- | --- |
| Composition and install simplification | `composition-simplification-options.md` |
| Architecture-lint burn-down | `architecture-lint-burn-down-plan.md`, `architecture-lint-review-2026-09-03.md` |
| tRPC flatten (steps C and D) | `trpc-flatten-design.md`, `trpc-flatten-review.md` |
| Install and api-map retirement | `install-composition-review-2026-09-03.md` |
| Connected agents (ADR-128) | `connected-agents-restore-plan.md` |
| Suite run plans | `suite-restore-review.md` |
| Tasks and langwatch-saas | `tasks-launch-interface-and-saas.md`, `tasks-lane-review.md` |
| Unserved surfaces and restored bugs | `restructure-bug-hunt-2026-09-03.md` |
| Everything needing Alex | `open-decisions-2026-09-03.md` |

The shorter operational restart notes remain in
[core hand-off](core-application-feature-extraction-handoff.md) and
[API transport hand-off](api-transport-extraction-handoff.md).
