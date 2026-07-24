Feature: Demo-seed scope-guard, runner, entry point: single dev-and-prod path
  As a platform operator running the daily demo-org seed cron
  And as a developer running the same harness locally for dogfood
  I want the seeder to refuse to run without an explicit allowlist,
  refuse to touch any org outside that allowlist, capture per-action
  outcomes without aborting the rest of the run, and exit non-zero on
  any failure so the cron alarm fires
  So that the same code path runs in dev and prod with structurally
  bounded blast radius, no fork to drift, and one source of truth.

  The harness lives at langwatch/scripts/dogfood/governance/. Dev runs
  it directly via `pnpm tsx scripts/dogfood/governance/seed-demo.ts`.
  Prod runs it via the existing K8s CronJob pattern in
  langwatch-saas/infrastructure/cronjobs.tf: a scheduled job inside
  the cluster `curl`s an internal API route on the langwatch app pod
  (`/api/cron/seed_demo`, mounted via `app.all` so both GET and POST
  match the existing convention), authenticated with `CRON_API_KEY` in
  the Authorization header, matching the existing
  `topic_clustering` and `alert_triggers` cron-route shape. The route
  handler invokes the same `runSeedActions` orchestrator the CLI
  invokes; no Lambda, no submodule, one code path.

  Background:
    Given an allowlist of demo organization ids is configured via the
      `DEMO_ORG_IDS` env var as a comma-separated list
    And every id in the allowlist matches `[A-Za-z0-9_-]{8,64}`
    And the langwatch prisma client is connected to the target database

  # ─────────────────────────────────────────────────────────────────────
  # DEMO_ORG_IDS allowlist parsing: refuse-to-run on missing or malformed
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @scope-guard
  Scenario: Missing DEMO_ORG_IDS refuses to run
    Given `DEMO_ORG_IDS` is unset in the environment
    When `DemoOrgScope.fromEnv()` is called
    Then it throws `DemoScopeMisconfigured`
    And the error message names the missing env var
    And no prisma read of org-scoped data has been issued

  @bdd @demo-seed @scope-guard
  Scenario: Empty DEMO_ORG_IDS refuses to run
    Given `DEMO_ORG_IDS=""` is exported
    When `DemoOrgScope.fromEnv()` is called
    Then it throws `DemoScopeMisconfigured`
    And no prisma read has been issued

  @bdd @demo-seed @scope-guard
  Scenario: DEMO_ORG_IDS with only whitespace and commas refuses to run
    Given `DEMO_ORG_IDS=" , , "` is exported
    When `DemoOrgScope.fromEnv()` is called
    Then it throws `DemoScopeMisconfigured`
    And the error message says no usable ids were found after trimming

  @bdd @demo-seed @scope-guard
  Scenario: DEMO_ORG_IDS containing a malformed id refuses to run
    Given `DEMO_ORG_IDS="org_demo_acme,@@bad@@"` is exported
    When `DemoOrgScope.fromEnv()` is called
    Then it throws `DemoScopeMisconfigured`
    And the error message names the malformed id and the expected pattern

  @bdd @demo-seed @scope-guard
  Scenario: DEMO_ORG_IDS deduplicates while preserving order
    Given `DEMO_ORG_IDS="org_demo_acme,org_demo_other,org_demo_acme"` is exported
    When `DemoOrgScope.fromEnv()` is called
    Then the resulting allowlist is `["org_demo_acme", "org_demo_other"]`

  # ─────────────────────────────────────────────────────────────────────
  # Off-list rejection: synchronous assertion BEFORE any prisma read
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @scope-guard @blast-radius
  Scenario: Off-list orgId throws before loadOrg issues findUnique
    Given an `DemoOrgScope` constructed with allowlist `["org_demo_acme"]`
    And a prisma spy that records every call
    When `scope.loadOrg(prisma, "org_real_customer")` is called
    Then it throws `DemoScopeViolation` synchronously
    And `prisma.organization.findUnique` was never invoked
    And the error message says the id is not in the demo allowlist

  @bdd @demo-seed @scope-guard @blast-radius
  Scenario: Off-list orgId rejected before any write path
    Given an `DemoOrgScope` constructed with allowlist `["org_demo_acme"]`
    When `scope.assertOrgIdAllowed("org_real_customer")` is called
    Then it throws `DemoScopeViolation` synchronously
    And the throw is observable BEFORE any DB connection has been issued

  @bdd @demo-seed @scope-guard @blast-radius
  Scenario: loadProject rejects projects whose parent org is off-list
    Given an `DemoOrgScope` constructed with allowlist `["org_demo_acme"]`
    And a project `proj_x` exists whose parent organization id is `org_real_customer`
    When `scope.loadProject(prisma, "proj_x")` is called
    Then it throws `DemoScopeViolation`
    And the error message names the off-list parent org id

  @bdd @demo-seed @scope-guard
  Scenario: Allowlisted orgId that does not exist in DB throws DemoScopeViolation
    Given an `DemoOrgScope` constructed with allowlist `["org_demo_acme"]`
    And no organization row exists with id `org_demo_acme`
    When `scope.loadOrg(prisma, "org_demo_acme")` is called
    Then it throws `DemoScopeViolation`
    And the error message says the org is in the allowlist but not in the DB

  @bdd @demo-seed @scope-guard
  Scenario: DemoOrgScope constructor refuses to accept an empty allowlist
    When `new DemoOrgScope([])` is called
    Then it throws `DemoScopeMisconfigured`

  # ─────────────────────────────────────────────────────────────────────
  # Runner orchestration: dry-run default, per-action error capture
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @runner
  Scenario: Runner loads the target org once via the guard
    Given an allowlisted org id `org_demo_acme`
    And a list of seed actions `[A, B, C]`
    When `runSeedActions` is called with that org id and action list
    Then the org row is loaded once via `scope.loadOrg`
    And each action receives the same `Organization` value in its context
    And no action loads the org itself

  @bdd @demo-seed @runner
  Scenario: Dry-run is the default mode
    Given an allowlisted org id `org_demo_acme`
    And a single action that records the `execute` flag from its context
    When `runSeedActions` is called without `execute=true`
    Then the action's recorded `execute` flag is false
    And the report's mode is `dry-run`

  @bdd @demo-seed @runner
  Scenario: --execute opts in to mutations
    Given an allowlisted org id `org_demo_acme`
    And a single action that records the `execute` flag from its context
    When `runSeedActions` is called with `execute=true`
    Then the action's recorded `execute` flag is true
    And the report's mode is `execute`

  @bdd @demo-seed @runner @resilience
  Scenario: One failing action does not abort the rest
    Given a list of seed actions `[A, B, C]` where `B` throws synchronously
    When `runSeedActions` is invoked
    Then action `A` completed with status `succeeded`
    And action `B` is recorded with status `failed` and the captured error
    And action `C` was still invoked and completed
    And the report contains one entry per action in input order

  @bdd @demo-seed @runner @resilience
  Scenario: Action that throws a non-Error value is captured as a failed Error
    Given a seed action that throws the string `"boom"`
    When `runSeedActions` is invoked
    Then the action is recorded with status `failed`
    And the recorded error's `message` is `"boom"`

  @bdd @demo-seed @runner
  Scenario: Per-action duration is recorded in milliseconds
    Given a seed action that returns after a measurable delay
    When `runSeedActions` is invoked
    Then the action's report entry has a non-negative `durationMs`

  @bdd @demo-seed @runner
  Scenario: reportHasFailures returns true when any action failed
    Given a run report with action outcomes `[succeeded, failed, succeeded]`
    When `reportHasFailures(report)` is called
    Then it returns `true`

  @bdd @demo-seed @runner
  Scenario: reportHasFailures returns false on a clean run
    Given a run report with action outcomes `[succeeded, succeeded, skipped]`
    When `reportHasFailures(report)` is called
    Then it returns `false`

  # ─────────────────────────────────────────────────────────────────────
  # Report formatting: observable cron output
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @report
  Scenario: formatReport renders DRY-RUN header for dry-run mode
    Given a dry-run report with one succeeded action
    When `formatReport(report)` is called
    Then the output contains the line `Mode: DRY-RUN`
    And the output contains the closing line `Result: all actions ran clean.`

  @bdd @demo-seed @report
  Scenario: formatReport renders EXECUTE header for execute mode
    Given an execute-mode report with one succeeded action
    When `formatReport(report)` is called
    Then the output contains the line `Mode: EXECUTE`

  @bdd @demo-seed @report
  Scenario: formatReport closing line diverges on failure vs clean
    Given a report with one succeeded and one failed action
    When `formatReport(report)` is called
    Then the output contains the closing line `Result: at least one action failed.`

  @bdd @demo-seed @report
  Scenario: formatReport renders per-action status, duration, and detail
    Given a report with a `succeeded` action named `verifyOrgIdentity`,
      a `skipped` action with reason `"already seeded"`,
      and a `failed` action whose error message is `"boom"`
    When `formatReport(report)` is called
    Then the output contains a line matching `verifyOrgIdentity (\d+ms): succeeded`
    And the output contains a line matching `\(\d+ms\): skipped already seeded`
    And the output contains a line matching `\(\d+ms\): failed boom`

  # ─────────────────────────────────────────────────────────────────────
  # Entry point: argv parsing for seed-demo.ts
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @entry @argv
  Scenario: No args means dry-run, no override, no report path
    When `parseArgs([])` is called
    Then it returns `{ execute: false, orgId: undefined, reportPath: undefined }`

  @bdd @demo-seed @entry @argv
  Scenario: --execute flips the execute flag
    When `parseArgs(["--execute"])` is called
    Then it returns `{ execute: true, orgId: undefined, reportPath: undefined }`

  @bdd @demo-seed @entry @argv
  Scenario: --org-id consumes the next argv value
    When `parseArgs(["--org-id", "org_demo_acme"])` is called
    Then it returns `{ execute: false, orgId: "org_demo_acme", reportPath: undefined }`

  @bdd @demo-seed @entry @argv
  Scenario: --org-id without a value throws
    When `parseArgs(["--org-id"])` is called
    Then it throws an Error whose message says `--org-id requires a value`

  @bdd @demo-seed @entry @argv
  Scenario: --report-path consumes the next argv value
    When `parseArgs(["--report-path", "/tmp/run.txt"])` is called
    Then it returns `{ execute: false, orgId: undefined, reportPath: "/tmp/run.txt" }`

  @bdd @demo-seed @entry @argv
  Scenario: --report-path without a value throws
    When `parseArgs(["--report-path"])` is called
    Then it throws an Error whose message says `--report-path requires a value`

  @bdd @demo-seed @entry @argv
  Scenario: Unknown argv token throws
    When `parseArgs(["--bogus"])` is called
    Then it throws an Error whose message names `--bogus` as unknown

  # ─────────────────────────────────────────────────────────────────────
  # Entry point: target resolution + exit code
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @entry @resolution
  Scenario: Default target is the first id in DEMO_ORG_IDS
    Given `DEMO_ORG_IDS="org_demo_acme,org_demo_other"` is exported
    When the entry point is invoked with no `--org-id`
    Then `runSeedActions` is invoked with `organizationId="org_demo_acme"`

  @bdd @demo-seed @entry @resolution
  Scenario: --org-id override targets a secondary allowlisted org
    Given `DEMO_ORG_IDS="org_demo_acme,org_demo_other"` is exported
    When the entry point is invoked with `--org-id org_demo_other`
    Then `runSeedActions` is invoked with `organizationId="org_demo_other"`

  @bdd @demo-seed @entry @resolution @blast-radius
  Scenario: --org-id pointing at an off-list id refuses to run
    Given `DEMO_ORG_IDS="org_demo_acme"` is exported
    When the entry point is invoked with `--org-id org_real_customer`
    Then it throws `DemoScopeViolation`
    And `runSeedActions` was never invoked

  @bdd @demo-seed @entry @cron
  Scenario: Any failed action sets process.exitCode to 1
    Given a seed run where at least one action fails
    When the entry point completes
    Then `process.exitCode` is `1`
    So that the prod cron alarm fires on partial failure

  @bdd @demo-seed @entry @cron
  Scenario: Clean run leaves process.exitCode unset
    Given a seed run where every action succeeds
    When the entry point completes
    Then `process.exitCode` was never assigned to a non-zero value

  @bdd @demo-seed @entry @observability
  Scenario: --report-path writes the formatted report to disk
    Given a clean dry-run completion
    When the entry point is invoked with `--report-path /tmp/seed/run.txt`
    Then the directory `/tmp/seed/` is created if missing
    And `/tmp/seed/run.txt` contains the same string `formatReport(report)` returned
    And the report ends with a trailing newline

  # ─────────────────────────────────────────────────────────────────────
  # Prod cron route: /api/cron/seed_demo (K8s CronJob curls into pod)
  # Mounted via app.all so both GET and POST are accepted, matching the
  # existing /cron/triggers, /cron/schedule_topic_clustering shape.
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @cron-route @auth
  Scenario: Missing Authorization header returns 401 with empty body
    Given `CRON_API_KEY=ck_test` is set in the langwatch app env
    When a request `/api/cron/seed_demo` arrives with no Authorization header
    Then the response status is `401`
    And the response body is empty
    And `runSeedDemo` was never invoked

  @bdd @demo-seed @cron-route @auth
  Scenario: Wrong CRON_API_KEY returns 401
    Given `CRON_API_KEY=ck_test` is set
    When a request `/api/cron/seed_demo` arrives with `Authorization: Bearer ck_wrong`
    Then the response status is `401`
    And `runSeedDemo` was never invoked

  @bdd @demo-seed @cron-route @auth
  Scenario: Bare CRON_API_KEY without Bearer prefix is accepted
    Given `CRON_API_KEY=ck_test` is set
    When a request `/api/cron/seed_demo` arrives with `Authorization: ck_test`
    Then the route handler proceeds past auth
    So that the existing cron-route header convention is preserved

  @bdd @demo-seed @cron-route @http-method
  Scenario Outline: Both GET and POST are accepted on the cron route
    Given a valid CRON_API_KEY
    When a `<method>` request to `/api/cron/seed_demo` arrives with the header
    Then the route handler proceeds past auth
    And `runSeedDemo` is invoked
    So that the K8s CronJob curl can use either verb

    Examples:
      | method |
      | GET    |
      | POST   |

  @bdd @demo-seed @cron-route @execute
  Scenario: Route handler always invokes runSeedDemo with execute=true
    Given a valid CRON_API_KEY in the Authorization header
    And `DEMO_ORG_IDS="org_demo_acme"` is configured in the pod env
    When a request `/api/cron/seed_demo` arrives
    Then `runSeedDemo` is invoked with `{ execute: true }`
    And the prod path never runs in dry-run mode

  @bdd @demo-seed @cron-route @scope
  Scenario: Route handler resolves the target org via DEMO_ORG_IDS default
    Given a valid CRON_API_KEY
    And `DEMO_ORG_IDS="org_demo_acme,org_demo_other"` in the pod env
    When a request `/api/cron/seed_demo` arrives
    Then `runSeedDemo` is invoked without an explicit `organizationId`
    And `runSeedDemo` resolves the target via `DemoOrgScope.fromEnv` to the first allowlisted id

  @bdd @demo-seed @cron-route @observability
  Scenario: Clean run returns 200 with the report in the JSON body
    Given a valid CRON_API_KEY
    And every seed action succeeds for the target org
    When a request `/api/cron/seed_demo` arrives
    Then the response status is `200`
    And the response body has shape `{ report: SeedRunReport }`
    And `report.mode` equals `"execute"`
    And `report.actions` lists every action with status `"succeeded"` or `"skipped"`

  @bdd @demo-seed @cron-route @observability @cron-alarm
  Scenario: Any failed action returns HTTP 500 so the cron alarm fires
    Given a valid CRON_API_KEY
    And at least one seed action fails during the run
    When a request `/api/cron/seed_demo` arrives
    Then the response status is `500`
    And the response body has shape `{ report: SeedRunReport }`
    And the report records the failed action with its error message
    So that the K8s CronJob success-rate metric reflects the failure
       and operators page on partial-success runs

  @bdd @demo-seed @cron-route @misconfig
  Scenario: runSeedDemo throws (e.g., DEMO_ORG_IDS unset) returns 500 with error JSON
    Given a valid CRON_API_KEY
    And `DEMO_ORG_IDS` is unset in the pod env
    When a request `/api/cron/seed_demo` arrives
    Then the response status is `500`
    And the response body has shape `{ message: string, error: string }`
    And the response body does NOT contain a `report` field
    And `runSeedDemo` threw before completing

  # ─────────────────────────────────────────────────────────────────────
  # First action: verifyOrgIdentity proves the wiring
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @actions @verify
  Scenario: verifyOrgIdentity succeeds when name and slug are populated
    Given the target org has `name="Acme Demo"` and `slug="acme-demo"`
    When `verifyOrgIdentity.run(context)` is invoked
    Then the outcome is `succeeded`
    And the summary string mentions both the name and the slug

  @bdd @demo-seed @actions @verify
  Scenario: verifyOrgIdentity fails when name is missing
    Given the target org has `name=null`
    When `verifyOrgIdentity.run(context)` is invoked
    Then the outcome is `failed`
    And the error message names the missing field

  @bdd @demo-seed @actions @verify @read-only
  Scenario: verifyOrgIdentity is read-only regardless of execute mode
    Given an execute-mode context (`execute=true`)
    And a prisma spy that records every write
    When `verifyOrgIdentity.run(context)` is invoked
    Then no prisma write call was made

  # ─────────────────────────────────────────────────────────────────────
  # seedBirdEye: populated bird-eye dashboard fixture (4 teams, anomaly)
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @actions @bird-eye @dry-run
  Scenario: seedBirdEye returns skipped in dry-run mode without firing CH inserts
    Given a dry-run context (`execute=false`)
    And a `runSeedBirdEye` spy
    When `seedBirdEye.run(context)` is invoked
    Then the outcome is `skipped`
    And the reason string mentions the row count and the team count
    And `runSeedBirdEye` was never invoked

  @bdd @demo-seed @actions @bird-eye @execute
  Scenario: seedBirdEye in execute mode invokes runSeedBirdEye with prod-shape defaults
    Given an execute-mode context (`execute=true`)
    And the target org id is `org_demo_acme`
    When `seedBirdEye.run(context)` is invoked
    Then `runSeedBirdEye` is invoked with arguments
      | argument        | value           |
      | organizationId  | org_demo_acme   |
      | days            | 30              |
      | rows            | 480             |
      | withAnomaly     | true            |
    And the outcome is `succeeded`
    And the summary string includes the rows-inserted count and total synthetic spend

  @bdd @demo-seed @actions @bird-eye @scope @blast-radius
  Scenario: seedBirdEye uses the scope-asserted Organization handle, ignoring any external --org-id
    Given an execute-mode context with `organization.id="org_demo_acme"`
    And `runSeedBirdEye` records the `organizationId` it receives
    When `seedBirdEye.run(context)` is invoked
    Then `runSeedBirdEye` was invoked with `organizationId="org_demo_acme"`
    And no env var, argv flag, or external override altered that target

  @bdd @demo-seed @actions @bird-eye @resilience
  Scenario: seedBirdEye throw is captured by the runner as a failed outcome
    Given an execute-mode context
    And `runSeedBirdEye` throws an Error with message `"CH insert failed"`
    When the runner invokes `seedBirdEye.run(context)`
    Then the runner records the outcome as `failed`
    And the recorded error's message is `"CH insert failed"`
    And subsequent actions in the ACTIONS list still run

  @bdd @demo-seed @actions @bird-eye @import-safety
  Scenario: Importing seed-bird-eye does not kick off seeding
    Given a fresh module-load of `scripts/dogfood/governance/seed-bird-eye`
    When the module is imported by the runner
    Then no CH insert is issued at module-load time
    And the CLI bootstrap only fires when `import.meta.url` matches `process.argv[1]`

  # ─────────────────────────────────────────────────────────────────────
  # seedHeavyUsage: per-persona /me/usage + /gateway/usage chart fixture
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @actions @heavy-usage @persona-resolution
  Scenario: Persona resolution walks personalTeams -> personal Project -> first ACTIVE VK
    Given the target org has 3 personal teams `[t_a, t_b, t_c]` (each `isPersonal=true`)
    And `t_a` has personal project `p_a` with ACTIVE VK `vk_a`
    And `t_b` has personal project `p_b` with ACTIVE VK `vk_b1` (createdAt earlier) and `vk_b2`
    And `t_c` has personal project `p_c` with NO ACTIVE VK
    When `resolveDemoPersonas` runs against the target org
    Then the resolved personas are
      | personalProjectId | virtualKeyId |
      | p_a               | vk_a         |
      | p_b               | vk_b1        |
    And `t_c` is silently dropped from the persona list

  @bdd @demo-seed @actions @heavy-usage @persona-resolution @scope @blast-radius
  Scenario: Persona resolution is scoped to the target org only
    Given the target org has 1 personal project + ACTIVE VK
    And a separate org has 5 personal projects + ACTIVE VKs
    When `resolveDemoPersonas` runs against the target org
    Then exactly 1 persona is resolved
    And no project from the other org is included

  @bdd @demo-seed @actions @heavy-usage @budget @optional
  Scenario: VK without a virtual_key-scoped GatewayBudget resolves with budgetId undefined
    Given a persona with VK `vk_a` and no `GatewayBudget` row at scope `VIRTUAL_KEY:vk_a`
    When `resolveDemoPersonas` runs
    Then the persona's `budgetId` is `undefined`

  @bdd @demo-seed @actions @heavy-usage @budget @optional
  Scenario: runSeedHeavyUsage seeds trace_summaries even when budget is undefined
    Given a persona with `budgetId=undefined`
    When the action invokes `runSeedHeavyUsage` for that persona
    Then `trace_summaries` rows are written
    And no `gateway_budget_ledger_events` rows are written for that persona
    So that `/me/usage` (which reads trace_summaries) stays populated

  @bdd @demo-seed @actions @heavy-usage @dry-run
  Scenario: Dry-run with personas resolved returns skipped with row + persona count
    Given a dry-run context (`execute=false`)
    And `resolveDemoPersonas` returned 3 personas
    And a `runSeedHeavyUsage` spy
    When `seedHeavyUsage.run(context)` is invoked
    Then the outcome is `skipped`
    And the reason names the per-persona row count, the persona count, and the day count
    And `runSeedHeavyUsage` was never invoked

  @bdd @demo-seed @actions @heavy-usage @no-personas @graceful
  Scenario: Fresh demo org with no signed-up personas returns skipped, not failed
    Given the target org has 0 personal projects with ACTIVE VKs
    And an execute-mode context
    When `seedHeavyUsage.run(context)` is invoked
    Then the outcome is `skipped`
    And the reason directs the operator to sign up demo users + mint VKs first
    And `runSeedHeavyUsage` was never invoked
    So that the daily cron does not fail the run before the auth flow has been completed

  @bdd @demo-seed @actions @heavy-usage @execute @iteration
  Scenario: Execute mode invokes runSeedHeavyUsage once per resolved persona
    Given an execute-mode context
    And `resolveDemoPersonas` returned 3 personas with VK ids `[vk_a, vk_b, vk_c]`
    When `seedHeavyUsage.run(context)` is invoked
    Then `runSeedHeavyUsage` is invoked 3 times in persona order
    And each call carries the persona's `personalProject`, `virtualKey`, and (optional) `budget`
    And each call uses `days=30` and `rows=150`

  @bdd @demo-seed @actions @heavy-usage @execute @summary
  Scenario: Outcome summary aggregates rows, spend, and budget-coverage across personas
    Given an execute-mode context
    And `runSeedHeavyUsage` returned 100 rows + $0.50 + budgetSeeded=true for persona A
    And `runSeedHeavyUsage` returned 200 rows + $1.20 + budgetSeeded=false for persona B
    When `seedHeavyUsage.run(context)` is invoked
    Then the outcome is `succeeded`
    And the summary string includes "300 rows", "$1.7000", "2 personas", "1 with VK-scoped budgets"

  @bdd @demo-seed @actions @heavy-usage @resilience
  Scenario: A failing persona iteration aborts the action with a captured error
    Given an execute-mode context with 3 resolved personas
    And `runSeedHeavyUsage` succeeds for persona A
    And `runSeedHeavyUsage` throws for persona B
    When `seedHeavyUsage.run(context)` is invoked
    Then the action throws
    And the runner records the action's outcome as `failed` with the captured error
    And subsequent SeedActions in the ACTIONS list still run

  @bdd @demo-seed @actions @heavy-usage @import-safety
  Scenario: Importing seed-heavy-usage does not kick off seeding
    Given a fresh module-load of `scripts/dogfood/governance/seed-heavy-usage`
    When the module is imported by the wrapper
    Then no CH insert is issued at module-load time
    And the CLI bootstrap only fires when `import.meta.url` matches `process.argv[1]`

  # ─────────────────────────────────────────────────────────────────────
  # Cron vs operator-setup boundary: which scripts are wired into the
  # daily cron path, and which stay CLI-only for once-per-environment
  # operator setup.
  # ─────────────────────────────────────────────────────────────────────

  @bdd @demo-seed @runner @actions-list
  Scenario: ACTIONS list is the cron-path roster only
    Given the demo-seed entry point at `scripts/dogfood/governance/seed-demo.ts`
    When the runner is invoked (CLI dev path or `/api/cron/seed_demo`)
    Then the actions executed in order are
      | name              |
      | verifyOrgIdentity |
      | seedBirdEye       |
      | seedHeavyUsage    |
    And `seedAnomalyFixture` is NOT in the ACTIONS list
    And `seedPersonas` is NOT in the ACTIONS list

  @bdd @demo-seed @operator-setup @anomaly-fixture
  Scenario: seed-anomaly-fixture stays CLI-only for live-fire dogfood
    Given an operator wants to dogfood the live-fire anomaly-detection loop
      (mint VK, fire real LLM completion, watch alert + budget cap propagate)
    When the operator runs `pnpm tsx scripts/dogfood/governance/seed-anomaly-fixture.ts --email <signed-up-user>`
    Then the script seeds a tight personal budget + a `spend_spike` AnomalyRule
      derived from the email so multiple operators do not collide
    And it is idempotent (find-or-create on both the budget and the rule)
    And it requires a pre-signed-up user, never mints credentials
    And the script is NOT consumed by `runSeedDemo`
    So that the daily cron path does not re-fire alert state on every tick

  @bdd @demo-seed @operator-setup @personas
  Scenario: seed-personas stays CLI-only for once-per-env user provisioning
    Given an operator wants to provision personal VKs for already-signed-up demo users
    When the operator runs `pnpm tsx scripts/dogfood/governance/seed-personas.ts`
    Then the script issues personal VKs for each pre-signed-up user
    And it never mints credentials (requires pre-signed-up users)
    And `OPENAI_API_KEY` is OPTIONAL: when set, ModelProvider + RoutingPolicy
      seed runs; when unset, the script warns and skips both, the VK still
      issues but does not route until an admin attaches a provider via UI
    And the script is NOT consumed by `runSeedDemo`
    So that the production cron does not require knowledge of the real provider key

  @bdd @demo-seed @operator-setup @import-safety
  Scenario Outline: Operator-setup scripts are import-safe like the cron-wired ones
    Given a fresh module-load of `<path>`
    When the module is imported by another caller
    Then no DB write is issued at module-load time
    And the CLI bootstrap only fires when `import.meta.url` matches `process.argv[1]`

    Examples:
      | path                                                    |
      | scripts/dogfood/governance/seed-anomaly-fixture         |
      | scripts/dogfood/governance/seed-personas                |
