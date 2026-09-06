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
| suites | 6 | auto-filing into a Default suite (no non-test code creates one); archive cascade | `platform/app/src/server/suites/__tests__/test-suite-membership.integration.test.ts` |
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
| nlp-go | 8 | `lambdaFetch` / `InvokePayloadTooLargeError` studio Lambda invoke path |
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
| `specs/dependencies/runtime-composition.feature` | 8 | names `tools/dev-runtime`, a combined process mode and an Agents RPC router; the branch runs three processes always and neither exists |
| `specs/setup/typescript-7.feature` | 3 | "the whole repository is typechecked as one program": there is no root tsconfig any more, typechecking is per package by design |
| `specs/setup/memory-footprint.feature` "pnpm start stays in production mode" | 1 | the hazard is gone: `.env` loads through `--env-file-if-exists`, which never overrides a set variable |
| `specs/migration/system-migrations-runner.feature` "An automatic cohort includes a private-dataplane organization" | 1 | the cohort has no dataplane input, so a test would assert the absence of an exclusion nothing can express |
| `specs/navigation/workspace-switcher.feature` tooltip / auto-focus | 3 | the switcher is now an always-visible per-team "New Project" row; there is no icon button, tooltip or hover state (parked `@unimplemented`) |
| `specs/api-reference` run-plans and test-suites "A dated … path and the bare alias both answer" | 2 | the tests assert 404 on purpose for the four v1 families the /api twinning leaves alone (771069e998); spec and code disagree |
| `specs/navigation/shared-section-navigation-layout.feature` narrow viewport | 1 | needs a real browser lane; jsdom cannot evaluate media queries |

| `specs/licensing/license-router.feature` "Rejects request for unauthorized organization", `subscription-handler-integration.feature` "getLicenseHandler returns same instance" | 2 | name a license router and a getLicenseHandler singleton the branch replaced with composition; asserting instance identity of a thing that no longer exists is vacuous |

| `specs/features/setup/fresh-clone-dev-setup.feature` "First-run env validation surfaces a self-documenting error for unset gateway secrets" | 1 | main's `env-create.mjs` refused short or partial gateway secrets; the branch declares them optional on purpose so a boot never fails on them. `.env.example` still ships `REPLACE_ME` and nothing rejects it. Proposed restore: all-or-none plus a minimum length **when set**, unset stays fine |

Proposed: delete the first four groups as stale against decisions already taken; keep the switcher three parked; align the api-reference wording with decision 20's exceptions; leave the browser scenario `@e2e` for the Playwright lane.
