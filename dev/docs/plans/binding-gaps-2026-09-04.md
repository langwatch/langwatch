# Scenario binding gaps found by the 2026-09-04 lift-and-shift pass

The binding lanes moved main's platform/app tests into the owning feature
packages (commit 700fb68c5c). Unbound scenarios went from 3094 to 1333 in the
day. What is left falls into three kinds, and only the first is more binding
work. The other two are product regressions against origin/main or deliberate
simplifications that the spec has not caught up with; each needs a ruling
(restore, or retire the scenario) before anyone writes a test for it.

```
  1333 unbound
  ├── binding work left          REST-family harness (teams, organization, run plans,
  │                              test suites, experiments; lane running), LWQL suites,
  │                              authorization-declaration audits, model-provider remainder
  ├── behaviour absent           regressions or simplifications listed below
  └── needs datastore            integration tests written, run only with the test
                                 databases configured (see specs/ci/no-docker-integration-tests)
```

## Behaviour absent on this branch (present on main)

| Spec | What is missing | Evidence |
| --- | --- | --- |
| scenarios/execution-blocked-by-configuration (4) | prefetch failures log at error unconditionally; main's reason-based downgrade to warn for customer-caused failures never travelled | scenario-processor.service.ts handleFailed |
| agents/connected-agents (1) | AgentService.copy has no guard refusing a connected-agent source | main had one |
| scenarios/served-agent-instance-on-runs (4) | the parent run never records agentInstance | scenario run projection |
| scenarios/scenario-version-on-runs (2) | runs never store scenarioVersion | same |
| agents/agent-session-echo (1) | HTTP agent editor drawer has no Session path field though config.sessionPath exists | AgentHttpEditorDrawer |
| suites/test-suite-membership-invariant, default-suite (22) | archive cascade and execution-settings refusals missing; suite server has no integration lane | packages/features/suite/server has no test:integration script |
| model-providers/missing-model-popup (11) | MissingModelToast and the generateCommitMessage port never ported | |
| model-providers/model-cost-scoping (3) | cost repository has no scope-tier sort (project over team over org) | |
| model-providers/default-model-resolution (6) | replaced by model-default-config-cascade; retire the file | |
| ai-governance/login-user-scoped-key (3) | CliKeyScopeSummary lacks the permissions field main had | |
| monitors/evaluator-slug (1) | slug generator has no collision retry | latent bug |
| identity/scim-connection-sync (1) | SCIM provisioning hardcodes role MEMBER; scim-role-resolver.ts exists and is never imported | |
| identity/mfa-and-session-shape (2) | cannot_impersonate_without_second_factor defined, never thrown; ImpersonationService.start has no MFA check | |
| identity/identity-storage-adapter (1) | IdentityNewbornReconciliationService.runPass never wired into a migration pass | |
| identity/identifier-model (1) | PrismaUserTenantSource has no enrollment cohort filter | adapter comment admits it |
| rbac/credential-arbitration (1) | projectAuthorization fails open when called before authentication | apps/api/src/api-rest.security.ts |
| rbac/scoped-role-bindings (2) | no batch permission-check API | |
| traces-v2/presence-toggle-placement (3), home/langy-home-morph (6), home/langy-briefing-receipts (9) | presence toggle, composer morph and briefing receipts never travelled from platform/app | |
| traces-v2/default-drawer-routing (5) | traceDetails legacy drawer key never registered in apps/ui | |
| navigation/workspace-switcher (16) | per-team create-project and nested My Workspace rows simplified away; org-scoped switch never lands on /settings | documented in code |
| navigation/drawer-chunk-warmup (2) | use-preload-drawer is a documented no-op | |
| webhooks/webhook-endpoints (19) | OutboxDispatcherService not on @langwatch/eventing's public surface; webhook server has no ClickHouse dependency for events listing | |
| data-privacy/privacy-migration (5) | the backfill ran once as a migration; retire the file | prisma migration 20260611120000 |
| prompts/prompt-editor-outputs (3) | no standalone Inputs section with Add button | needs a UI decision |
| traces/saved-views (1) | saved-views UI absent | |
| feature-flag (3), feature-package-boundaries (10), pull-request-linkage (20) | anonymous-key allowlist gate, enterprise composition-graph lint rules, PR-linkage integration tests | |
| scenarios/otel-trace-context-propagation, remote-trace-judging | superseded by ADR-097 | |

## Needs a production change first (security-adjacent, from the same pass)

- automation REST create route still forwards actionParams unvalidated
  (the PATCH twin was closed in ed54437604).
- prompt REST tag PUT/DELETE lack the cascade authorization the tRPC twins
  gained in 9ba4858351; the family has no authorization port.
- Better Auth federation still resolves unlicensed: no LicenseStoragePort
  adapter exists in production code (9fad294018 made it say so at boot).
- GitHub installation claim needs user-to-server OAuth for full proof.

## Needs datastore

Integration tests written this pass and gated on the test database variables:
identity account-credential cascade and projection repository, experiments-v3
workbench and archive, dashboard saved-view persistence, group-queue
record-span dedup identity, scenario simulation-run-state readback and model
selection, prompts runtime-parameters, list-copy-counts and tags, media
rendering. Run `pnpm test:integration` with the variables set, or under CI.

## LangWatchQL analytics (84 scenarios, all need test infrastructure, none need production changes)

Every one of these has a live binding on `origin/main`; the branch carries the
behaviour unchanged. Two harnesses never made the port:

- **Migrated ClickHouse mode.** `packages/features/analytics/server/src/langwatch-ql/__tests__/lwql-clickhouse-harness.ts`
  only offers the two-table `"fixture"` mode. Main's harness also ran the real
  `trace_summaries` / `stored_spans` / `evaluation_runs` migrations. On this
  branch `ClickHouseMigrateTask` in `packages/clickhouse-client/src/tasks/clickhouse-migrate.task.ts`
  is a public seam that can drive them. Blocks: `lwql-api.feature` views/REST
  answerable-questions (24), `clickhouse-memory-safety` (4),
  `evaluation-pass-rate-consistency` (5), `evaluation-runs-join-time-bounds` (5).
- **Postgres engine mapping.** Main's `startLangWatchQLPostgres` /
  `mapPostgresIntoClickHouse` named-collection setup was not ported. Blocks the
  17 `postgresEngineIsolation` scenarios in `lwql-api.feature`.
- **Dashboard REST/tRPC harness with real auth.** `packages/features/dashboard/server`
  has fakes-only unit tests and Postgres persistence tests, no transport tests
  with real project/API-key auth. Blocks `lwql-saved-charts` (17),
  `lwql-langy-authoring` (11), `dashboard-rest-api` (2). Achievable without
  ClickHouse; the suite-family harness is the model to follow.
