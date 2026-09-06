# Restore or retire: behaviour the lift left behind

Status: RULED 2026-09-05 12:30 by Alex: **restore everything**. No behaviour main has may be lost on this branch. The only retirements admitted are rows whose behaviour was already replaced or already executed on main itself (marked "retire" below with the reason); every other row is a restore lane. Cross-feature web imports: named `surfaces/<id>` entries, oxlint admits `screens/*` and `surfaces/*`. The core-to-enterprise UI slot seam is to be built.

Original framing: Each row is a scenario (or group) whose test
bound on `origin/main` but whose behaviour is absent on
`feat/strict-feature-layout-v0`. The port lanes did not write tests for these
and did not delete the scenarios. Two outcomes per row: **restore** the
behaviour (a lift from main or a rewrite in the new shape) or **retire** the
scenario (delete it, or mark the file `@unimplemented`). Rows already fixed
today are listed at the end so the same regression is not re-found.

Prior lists: `binding-gaps-2026-09-04.md` (written at 1,333 unbound) and
`spec-rebind-manifest.md`.

## Product behaviour a customer would notice

| area | scenarios | what is missing | main's subject |
| --- | ---: | --- | --- |
| webhooks | 19 | `OutboxDispatcherService` is not on eventing's public surface; confirmed spend events never become deliveries | `platform/app/ee/webhooks/__tests__/webhookDelivery.process.integration.test.ts` |
| navigation | 15 | `WorkspaceSwitcher` component simplified away | `platform/app/src/components/__tests__/WorkspaceSwitcher.integration.test.tsx` |
| model providers | 10 | `MissingModelToast` never ported | `platform/app/src/components/__tests__/MissingModelToast.integration.test.tsx` |
| components | 11 | `GraphicsQualityProvider` and `evaluateFpsSample` (adaptive graphics quality); apps/ui fills the slot with a pending provider | `platform/app/src/components/__tests__/GraphicsQualityProvider.integration.test.tsx` |
| home | 15 | **retired 2026-09-05**: the morph's host `LangyHomeLantern` was mounted by nothing on main, and main removed the receipts rail for the attention inbox (ported). Unbound scenarios deleted; the three bound ones stay | `platform/app/src/features/langy/hooks/__tests__/useComposerMorph.unit.test.tsx` |
| langy | 3 | `langyNavigateFallback` (page-name navigation), inline model setup with key field and "Save and continue", derived-stat bar leading marker | `platform/app/src/server/app-layer/langy/streaming/__tests__/langyNavigateFallback.integration.test.ts` |
| traces-v2 | 10 | `LegacyTraceDrawerRedirect` (5), `PresenceMenuItem` (3), `AnnotationExpectedOutputs` (2) | `platform/app/src/...` per scenario |
| experiments-v3 | 4 | `TargetVariablesPanel` (3); workbench beside a compact navigation menu (1, `compactMenu` explicitly did not travel) | |
| suites | 6 | **restored/bound 2026-09-06**: default-suite auto-filing lives in `ScenarioService.create`, the archive cascade in `PrismaScenarioRepository.archiveTestSuite`; both bound against Postgres and ClickHouse | `platform/app/src/server/suites/__tests__/test-suite-membership.integration.test.ts` |
| scenarios | 2 | reason-based downgrade of an unrecognised failure; ES-by-trace-id span query (superseded by ADR-097: retire) | |
| ops feature flags | 9 | catch-all-aware rule placement, keyboard and drag reordering, exclusion-aware catch-all note, new-users age-range logic and scope-kind picker | `platform/app/src/components/ops/featureFlags/__tests__/FeatureFlagRulesDialog.integration.test.tsx` |
| prompts | 3 | standalone Inputs section (needs a UI decision) | |
| traces | 1 | saved-views UI | |
| ai-governance | 3 | `CliKeyScopeSummary.permissions` | |
| identity | 5 | see the identity section of `binding-gaps-2026-09-04.md` | |
| licensing | 13 + 1 | `sdk-scenario-set-limit.feature` written ahead of the feature (tag `@unimplemented` or build); `GlobalUpgradeModal` has no component | |
| automations | 1 | grandfathered condition-less automations "keep firing" via `confirmSettledMatch`; dispatch now goes through runaway containment | |
| members | 1 | "Two team admins removed at the same time cannot both succeed" needs the real Prisma fence | |

## Platform behaviour

| area | scenarios | what is missing |
| --- | ---: | --- |
| REST internal routes | 2 | `CRON_API_KEY` / `isInternalSecretValid` and the destructive cron route are gone |
| rbac | 1 | `projectAuthorization` fails open in `apps/api/src/api-rest.security.ts` (fix, do not retire) |
| data-retention | 5 | nothing reads `LANGWATCH_DEFAULT_RETENTION_DAYS`; only the shape rule survives |
| background | 10 | no `runGracefulShutdown` registry, per-phase budget, exit code or telemetry flush; `closeApiProcessResources` covers ordering only |
| ci | 8 + 6 | `hardFloorReport` / `resolveHardFloorMs` never ported (reporter half exists in test-harness); no ClickHouse schema-lock module |
| nlp-go | 8 | **restored 2026-09-06** as `NlpLambdaRuntimeService` over an ARN port in workflow-server (cache, single flight, image refresh) and the Lambda Web Adapter stream decoder; exported but not composed, since nothing on the branch implements the Lambda invoke port |
| trace | 7 | `AmbiguousTraceIdPrefixError` and trace-id prefix resolution |
| server | 5 + 3 | app-composition-root Redis wiring scenarios; org/project S3 config resolvers (`getS3ConfigForOrganization/Project`) |
| api | 12 | `check-openapi-route-coverage` / `hono-route-table` scripts died with platform/app |
| ops | 1 | per-URL ClickHouse migration guard (`startTestContainers` replaced by `startTestClickHouseEndpoints`, which has none) |
| eventing | 1 | keyed-latest ClickHouse map projection (`MapProjectionDefinition` has an append store only) |
| architecture-lint | 1 | "legacy platform/app findings remain only in the shrinking baseline": platform/app is deleted |
| data-privacy | 5 | backfill ran as Prisma migration `20260611120000`: retire |
| model-providers | 6 | `default-model-resolution.feature` replaced by model-default-config-cascade: retire the file |
| navigation | 2 | `use-preload-drawer` is a documented no-op: retire drawer-warmup |

## Design rulings (not restore-or-retire)

- Cross-feature web imports (598 oxlint lines, 535 `ui-screen-closure`): either features get their own procedures and hooks, or oxlint admits `@langwatch/*-web/screens/*` and `/surfaces/*` as architecture-lint already does.
- Nine core-to-enterprise component imports (`ContactSalesBlock`, `ManagedModelProviderAlert`, seat-type surfaces) need a UI slot seam on ui-host capabilities that does not exist.
- `packages/api` "A rule that matters is enforced in the editor and at startup" wants one table driving the type test and the runtime assert; no such table exists.
- `setNurturingDatabase` (billing) had no caller: both nurturing syncs are inert. Wire or delete.
- `apps/api` has no integration lane; Postgres-backed tests there use `describe.skipIf` on the database URL.

## Fixed today (do not re-report)

- HTTPException status swallowed to 500 at the REST boundary (a080ec705f).
- Team last-admin guard fired when the team already had no admin (a080ec705f).
- Suite editor accepted execution settings on a test suite (a080ec705f).
- Operator feature-flag catalogue rendered System before Product (b127645ea8).
- Secret REST family never fed the route policy registry; `track_event` alias declared no policy (0efee48b52).
- `DatasetRecordNotFoundError` dropped from the dataset contract by a module overwrite (a080ec705f).

## Needs a ruling (found 2026-09-05 afternoon; spec contradicts the branch's design, not a missing port)

| spec | scenarios | why a test cannot be written honestly |
| --- | ---: | --- |
| `specs/dependencies/runtime-composition.feature` | 8 | names `tools/dev-runtime`, a combined process mode and an Agents RPC router; the branch runs three processes always and neither exists. **Ruled 2026-09-06: deleted** the 8 unbound scenarios (no code, spec-only). The 1 bound scenario ("Combined shutdown drains work before closing shared clients") and the 3 `@architecture`-tagged scenarios (untagged for enforcement, still true) stay; file not empty, kept |
| `specs/setup/typescript-7.feature` | 3 | "the whole repository is typechecked as one program": there is no root tsconfig any more, typechecking is per package by design. **Ruled 2026-09-06: reworded** to Alex's ask (a root tsconfig every package extends; incremental + own tsBuildInfoFile; checking one package doesn't cool another's cache). Verified no root tsconfig or `"extends"` exists anywhere yet (`ls tsconfig*.json` empty at root, zero of 191 package tsconfigs use `"extends"`) — scenarios reworded as the target rule, still unbound pending the config-layer work and an architecture-lint unit test (out of this spec-only lane's scope; no existing test covers it) |
| `specs/setup/memory-footprint.feature` "pnpm start stays in production mode" | 1 | the hazard is gone: `.env` loads through `--env-file-if-exists`, which never overrides a set variable. **Ruled 2026-09-06: deleted** (no code) |
| `specs/migration/system-migrations-runner.feature` "An automatic cohort includes a private-dataplane organization" | 1 | the cohort has no dataplane input, so a test would assert the absence of an exclusion nothing can express |
| `specs/navigation/workspace-switcher.feature` tooltip / auto-focus | 3 | the switcher is now an always-visible per-team "New Project" row; there is no icon button, tooltip or hover state (parked `@unimplemented`) |
| `specs/api-reference` run-plans and test-suites "A dated … path and the bare alias both answer" | 2 | the tests assert 404 on purpose for the four v1 families the /api twinning leaves alone (771069e998); spec and code disagree. **Ruled 2026-09-06: reworded** (no code) to "The run plans/test suites family answers only under /api/v1" — bare alias and dated segment both 404. Already asserted by `packages/features/suite/server/src/transport/api-rest/__tests__/run-plans-v1.api.integration.test.ts:335` and `test-suites-v1.api.integration.test.ts:217` ("serves the collection at /api/v1 and nowhere else"); those `it(` blocks still need a one-line `@scenario` docblock to bind (test-file edit, out of this spec-only lane's scope) |
| `specs/navigation/shared-section-navigation-layout.feature` narrow viewport | 1 | needs a real browser lane; jsdom cannot evaluate media queries |

| `specs/licensing/license-router.feature` "Rejects request for unauthorized organization", `subscription-handler-integration.feature` "getLicenseHandler returns same instance" | 2 | name a license router and a getLicenseHandler singleton the branch replaced with composition; asserting instance identity of a thing that no longer exists is vacuous. **Ruled 2026-09-06: deleted both** (no code) |

| `specs/features/setup/fresh-clone-dev-setup.feature` "First-run env validation surfaces a self-documenting error for unset gateway secrets" | 1 | main's `env-create.mjs` refused short or partial gateway secrets; the branch declares them optional on purpose so a boot never fails on them. `.env.example` still ships `REPLACE_ME` and nothing rejects it. Proposed restore: all-or-none plus a minimum length **when set**, unset stays fine. **Ruled 2026-09-06: restored, spec side only.** Confirmed main's exact rule via `git show origin/main:platform/app/src/env-create.mjs` — `gatewaySecretsSchema` (`z.string().min(32).optional()` per var) plus a cross-field `assertGatewaySecretsAllOrNone` banner-and-throw at boot. Reworded the one scenario into three: clean boot with none set, self-documenting error naming missing vars when partially set, and a length-refusal naming the generation command. Implementation (the config-layer rule in `apps/api/src/platform/config/api.config.ts`, its unit test, and the port-5666 no-secrets boot smoke) is **not done** — out of this spec-only lane's file scope; needs a code lane |

| `specs/scenarios/otel-trace-context-propagation.feature` remote-span collection | 9 | ADR-009's platform span collection is superseded by ADR-097, which deletes the platform path and moves remote-trace judging into the SDKs; nothing implements it here or on main. Parked `@unimplemented`; proposed retire with ADR-009 |

Proposed: delete the first four groups as stale against decisions already taken; keep the switcher three parked; align the api-reference wording with decision 20's exceptions; leave the browser scenario `@e2e` for the Playwright lane.

| `specs/nlp-go/lambda-invoke-payload-staging.feature` "A real oversized payload round-trips through S3 to the live engine" | 1 | needs a real S3 bucket and AWS credentials (main gated it on `S3_DOGFOOD_BUCKET`); the Go guard only accepts `*.amazonaws.com` hosts so no local object store can stand in. The behaviour exists and the off-S3 refusal is bound against the live engine; only this proof needs infrastructure. Proposed: leave `@e2e` for a dogfood-bucket lane |

## Lint rulings needed (found 2026-09-06 afternoon; the rule and the design disagree)

| rule | findings | question |
| --- | ---: | --- |
| `ui-screen-closure` / `ui-surface-closure` / `ui-web-public-entry` / `ui-feature-implementation-import` | 46 / 38 / 30 / 8 | a surface may import another package's `surfaces/<id>` door but a screen may not (`lintWebScreenClosures` never passes `collaboratingSurface`); ~30 screen findings are exactly that door import. Either screens take components from apps/ui composition, or the screen rule admits doors like the surface rule does. `ui-web-public-entry` wants `./drawers`, `./chrome`, `./drawer.store` renamed to `surfaces/<id>`, but drawer families reach `screens/` and `state/`, which a surface closure refuses, so the rename trades 30 findings for more |
| `enterprise-composition` | 19 | seven governance adapters shared by both process compositions live in `packages/enterprise/composition/api`; the only home the rule admits is `packages/enterprise/features/governance/server`, which turns their barrel imports into self-imports. Decide the shape before moving |
| `comment-block-size` | 1265 | a five-line cap met by splitting paragraphs makes comments worse. Raise the cap, scope it to production code, or drop the hard tier and keep the review advisory |
| `application-boundary` | 1 | `apps/ui` imports `type { AppRouter }` from the API for end-to-end tRPC types; the fix is a generated transport contract package that does not exist |
| `feature-source-layout` (langy delivered-calls) | 1 | a per-connection in-memory set of delivered call ids has no home: `rules/` must be pure, a service cannot be built inside a handler, `stores/` means projection stores |
| `prisma-containment` + `api-transport-import-boundary` | 2 + 2 | `better-auth-hooks.api.ts` holds 13 direct Prisma calls in transport (a repository and service of its own); `apps/api/src/features/agent-cache/` is a feature package that never got extracted |

Fixed the same afternoon, as rule corrections rather than code: composition roots under `apps/api/src/features` are no longer scanned as transports; `rules/` may construct pure values (Set, Map, Error, RegExp, WeakSet, Uint8Array, never Date); the service-locator detector requires a Promise-returning dispatcher. Deferred to a dogfood lane: the visual diff of every route on main and the branch needs the three additive migrations of 2026-09-04 applied to the shared dev database first.
