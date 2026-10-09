Feature: haven seed fills a stack with every kind of data, at any size, without running out of memory
  A developer needs a stack that looks lived in: every persona, every state, weeks of history,
  sized from one span to about two million. One deterministic generator (tools/seedgen) plans it;
  configuration, lifecycle and bulk telemetry go through installed module APIs in the tasks
  process, a slice goes through the public doors, and the stack's real worker does the rest.
  Design: dev/docs/plans/seed-2026-10-09.md. Rulings: Alex, 2026-10-09.

  # Every scenario is @unimplemented until the lane named in the design's section 14 binds it.

  Background:
    Given a haven stack whose api, worker and sims are up

  # --- Auto-seed on haven up -------------------------------------------------------------

  @integration @unimplemented
  Scenario: haven up seeds an empty stack with the tiny tier
    Given the stack's stores hold nothing beyond the fixed local identity
    When I run "haven up"
    Then the tiny tier is seeded for the four personas
    And every data kind has at least one record once the worker drains
    And "haven up" reports ready within 60 seconds

  @unit
  Scenario: haven up does not wait past a minute for the auto-seed
    Given the tiny seed has not drained after 60 seconds
    When "haven up" reaches its wait limit
    Then it reports the stack ready and that the seed continues in the background
    And "haven seed status" shows the seed's progress until it finishes

  @integration @unimplemented
  Scenario: haven up leaves a stack with data alone
    Given the stack's stores already hold seeded or hand-made data
    When I run "haven up"
    Then no seed runs

  @unit
  Scenario: The auto-seed can be turned off
    Given HAVEN_AUTO_SEED is 0, or I pass "--no-seed"
    When I run "haven up" on an empty stack
    Then only the fixed local identity is seeded

  # --- haven seed on demand --------------------------------------------------------------

  @integration @unimplemented
  Scenario: haven seed takes size, history, personas and seed
    When I run "haven seed --size small --days 30 --persona startup,enterprise --seed 7"
    Then the startup and enterprise personas are seeded at the small tier
    And their telemetry spans the 30 days before the anchor
    And the run manifest records the flags, the anchor and the recipe version

  @unit
  Scenario: The same seed gives the same logical content
    Given two plans built from the same flags, seed and anchor
    Then their actions, natural keys, payload fields, business times and counts are identical

  @integration @unimplemented
  Scenario: Seeding again with the same seed adds nothing
    Given a stack seeded with seed 7
    When I run "haven seed" with the same flags and seed 7
    Then every action finds its record by natural key and creates nothing new

  @unit
  Scenario: Any telemetry size from one span to two million is accepted
    When I run "haven seed --spans 1" or "haven seed --spans 2000000"
    Then the plan holds exactly that many spans, with logs and metric points in proportion

  @unit
  Scenario: Bad flags are refused before anything is written
    When I run "haven seed --size huge" or "haven seed --days 0" or "haven seed --persona nosuch"
    Then the command exits 2 naming the flag and the values it accepts
    And no store is touched

  @unit
  Scenario: A dry run prints the plan without writing
    When I run "haven seed --size medium --dry-run"
    Then it prints the counts per kind, the estimated rows and bytes per store and the expected duration
    And no store is touched

  @unit
  Scenario: haven seed returns the logins and the credentials haven made up
    Given a stack that is up
    When "haven seed" finishes
    Then it prints the app URL, the seeded admin login, the organization, team and project slugs,
      the project API key, the personal access token, the SCIM token and the instance admin key
    And every secret value is masked unless "--reveal" is given
    And "--json" prints the same as one object

  @unit
  Scenario: The access block lists every seeded org and its logins
    Given a seed whose run record holds the ids the product returned
    When "haven seed" prints its access block
    Then it lists each org the product created, with its id, persona and member logins
    And an org or user the product never returned an id for is not listed
    And every login's password is the one dev password, masked unless "--reveal" is given

  @unit
  Scenario: The seeded admin is an admin of every org the seed creates
    Given the stack's admin email
    When a seed creates organizations
    Then the admin account is found or created once
    And each org's owner admits the admin with an admin role on the org and its main team

  @unit
  Scenario: haven seed creates the orgs it is asked for
    When I run "haven seed --org name=acme,users=4 --org name=globex,persona=enterprise"
    Then exactly those orgs are planned, named as asked, each with its owner and users
    And a malformed name, an unknown key, a plan that is not built yet or a user count out of range is refused naming --org

  @unit
  Scenario: haven seed --into sends telemetry into one existing project
    When I run "haven seed --into <org-id>/<project-id>"
    Then no user, org, project or membership is created
    And every telemetry chunk lands in that project
    And --into with --org, or without a project, is refused naming --into

  @unit
  Scenario: Old telemetry lands at its own time so retention can be tested
    When I run "haven seed --days 30 --age 90d"
    Then every trace, log and metric is timed between 120 and 90 days ago
    And the data goes through the owners' ingest, so tenancy and the retention policy apply to it
    And an age that is negative, not whole days, or reaching past 365 days with --days is refused naming --age

  @unit
  Scenario: Each project gets long conversations whose turns share one conversation id
    When I run "haven seed --conversations 2 --turns 15"
    Then each project gets two conversations of fifteen turns, one trace per turn, minutes apart
    And every turn carries its conversation's gen_ai.conversation.id
    And their spans come out of the span budget, so the span count stays exact
    And a budget too small for them seeds none, and bad counts are refused naming the flag

  @unit
  Scenario: haven seed refuses a stack that is not up
    Given the stack's api or worker is not running
    When I run "haven seed"
    Then the command exits 2 naming the process that is down and "haven up"

  @integration @unimplemented
  Scenario: Reset empties the stack before seeding
    When I run "haven seed --reset --yes"
    Then the stack's stores are emptied and the seed starts from an empty stack

  # --- Paths: module APIs, batched ingest, a door slice ----------------------------------

  @integration @unimplemented
  Scenario: Configuration and lifecycle data go through module APIs and the real worker
    When the seed creates prompts, datasets, evaluators, workflows, grants and the rest
    Then each is created by an installed module API operation in the tasks process
    And the worker runs the commands, projections, subscribers and process managers they cause

  @unit
  Scenario: The fixed local identity's grants come from real commands
    When the fixed local identity is seeded
    Then its grants and roles are attached through the authz API
    And no Grant, Role or RoleBinding row is written by hand
    And the admin can sign in and both seeded tokens can ingest

  @integration @unimplemented
  Scenario: A slice of telemetry goes through the public doors with each project's key
    When a seed runs
    Then at least 2 percent of telemetry chunks, and one per signal per project, are sent to the public OTLP doors
    And each is authenticated with that project's API key

  @integration @unimplemented
  Scenario: A kind with no API write operation takes the door or is exempt
    Given a data kind whose owner exposes no write operation on its API
    Then the seed creates it through its public door as the persona owner, or lists it as exempt with a reason
    And no new API operation exists for seeding

  # --- Memory guard ----------------------------------------------------------------------

  @unit
  Scenario: The seed backs off when ClickHouse nears its memory limit
    Given ClickHouse memory use passes 70 percent of its configured limit
    When the guard reads its signals
    Then the in-flight window halves and the change is logged with the signal and value
    And above 85 percent sending pauses until use drops below 60 percent

  @unit
  Scenario: The seed backs off when the worker falls behind
    Given the worker's queued jobs pass 20,000 or the oldest job is older than 60 seconds
    When the guard reads its signals
    Then the in-flight window halves
    And sending pauses above 50,000 jobs until the backlog drops below 10,000

  @unit
  Scenario: The seed backs off on too many ClickHouse parts, Redis memory or host memory pressure
    Given any of those signals passes its threshold
    When the guard reads its signals
    Then the in-flight window halves, or pauses at the critical threshold

  @unit
  Scenario: A seed that stays paused stops with a checkpoint and resumes later
    Given sending has been paused for 10 minutes
    Then the seed exits 4 "stalled", naming the signal and its value
    And "haven seed --resume" continues from the last acknowledged action without duplicating data

  @unit
  Scenario: The seed refuses a plan that cannot fit
    Given the plan's estimated bytes exceed the free disk, or ClickHouse's limit is below the tier's floor
    When the seed starts
    Then it exits 2 before writing, naming the shortfall and the haven limit that raises it

  @unit
  Scenario: The generator streams instead of holding the plan
    When the plan for the large tier is walked end to end
    Then the generator's memory stays under 256 MB

  # --- Time and retention ----------------------------------------------------------------

  @integration @unimplemented
  Scenario: Retention is set before any data lands
    When the seed starts on an organization
    Then its retention is set to at least the history plus 14 days, as its plan allows, before any data is sent

  @integration @unimplemented
  Scenario: A plan that refuses the needed retention stops that organization's seed
    Given an organization whose plan cannot hold the requested history
    When the seed sets retention
    Then that organization's seed stops before any data, naming the organization, plan and value

  @integration @unimplemented
  Scenario: History is backdated in business time only
    When the seed sends 30 days of telemetry
    Then spans, logs and metric points carry times across those 30 days
    And the commands and events they cause carry the time they were processed

  @integration @unimplemented
  Scenario: History past 31 days uses the internal backdated path
    When I run "haven seed --days 90"
    Then spans up to 90 days old are stored through the in-process backdated input
    And the public OTLP door still drops a span older than 31 days

  # --- Personas and hybrid tenancy -------------------------------------------------------

  @integration @unimplemented
  Scenario Outline: Each persona is seeded with its characteristic data
    When I run "haven seed --persona <persona>"
    Then the run report lists <evidence> as present

    Examples:
      | persona    | evidence                                                                   |
      | startup    | one project, prompt versions, monitors, a dashboard and an alert          |
      | enterprise | SSO connections, SCIM churn, custom roles, grants and keys in every state |
      | gateway    | virtual keys and budgets in every state, gateway spend in every outcome   |
      | agent-eval | workflow, scenario, suite and experiment runs in every terminal state     |

  @integration @unimplemented
  Scenario: Private organizations get their own ClickHouse and bucket while Postgres stays shared
    When I run "haven seed --size small --private 1"
    Then haven creates a private ClickHouse database and a private bucket for one organization
    And routes that organization to them and restarts the api and worker with the routes loaded
    And the organization's telemetry lands only on its private targets

  @integration @unimplemented
  Scenario: The isolation check finds a leak
    Given a private organization's telemetry row exists on the shared ClickHouse
    When I run "haven seed isolation"
    Then it exits 1 naming the table, the tenant and the target it should be on

  @integration @unimplemented
  Scenario: Shared tenants never reach a private target
    When the isolation check runs after a mixed seed
    Then no shared organization's row is on any private target and no private object is in a shared bucket

  # --- Optional services -----------------------------------------------------------------

  @integration @unimplemented
  Scenario: A missing optional service skips its kinds and says so
    Given nlpgo is not running
    When a seed with the agent-eval persona runs
    Then the workflow kinds are skipped and the report lists them as unavailable, naming nlpgo
    And the seed exits 0

  @integration @unimplemented
  Scenario: Under strict mode a missing optional service fails the run
    Given langevals is not running
    When I run "haven seed --strict"
    Then the seed exits 1 naming the evaluator kinds that could not run and langevals

  # --- Snapshot cache --------------------------------------------------------------------

  @integration @unimplemented
  Scenario: A verified seed is cached and restored in seconds next time
    Given a seed passed its checks and was captured to the cache
    When an empty stack is seeded with the same size, history, personas and seed
    Then the stores are restored from the cache instead of being generated

  @integration @unimplemented
  Scenario: A schema change invalidates the cache
    Given a cached seed made before a new Prisma or ClickHouse migration
    When an empty stack is seeded with the same flags
    Then the cache key does not match and the seed is generated again
    And the new seed is cached under the new key

  @integration @unimplemented
  Scenario: A restored seed is topped up to today
    Given a cached seed whose anchor is three days old
    When it is restored
    Then the generator fills the three days since its anchor with the same seed

  @integration @unimplemented
  Scenario: The cache restores only into the stack's own empty stores
    Given the stack's stores hold data
    When a cached seed would be restored
    Then the restore is refused, naming the store that is not empty, and nothing is written

  # --- Live mode -------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Live mode keeps a gentle stream through the public APIs
    Given a seeded stack
    When I run "haven seed --live"
    Then a seed-live lane sends traces, logs, metrics and gateway calls through the public doors at 30 traces a minute
    And it shows in "haven status" and stops with "haven seed --live --stop" or the stack

  @unit @unimplemented
  Scenario: Live mode needs a seed first
    Given a stack with no seed manifest
    When I run "haven seed --live"
    Then it exits 2 asking me to run "haven seed" first

  # --- Coverage --------------------------------------------------------------------------

  @unit
  Scenario: The static coverage check names an item with no generator
    Given an event type, enum value, lifecycle column, table or process manager with no generator and no exemption
    When "seedgen coverage --static" runs
    Then it lists that item by id as a gap

  @unit
  Scenario: The static coverage check names a stale entry
    Given coverage.json names an item that no longer exists in the tree
    When "seedgen coverage --static" runs
    Then it lists that entry as stale

  @integration @unimplemented
  Scenario: The run-time coverage check names a covered item that produced no rows
    Given a seed has drained
    And an item mapped to a generator has no rows
    When "haven seed coverage" runs
    Then the item is reported as a gap by id, with its generator

  @integration @unimplemented
  Scenario: An unexpected dead letter fails the run
    Given a job dead-letters outside the labelled fault cohort
    When the seed's drain completes
    Then the report names the lane and job and the seed exits 1

  # --- Nightly ---------------------------------------------------------------------------

  @e2e @unimplemented
  Scenario: The nightly seeds medium with every persona and reports
    When the nightly workflow runs
    Then it seeds the medium tier with all personas and two private organizations on the configured ref
    And it publishes the verdict, gaps by id, unavailable kinds, the isolation result and durations

  @e2e @unimplemented
  Scenario: A coverage gap turns the nightly red without blocking pull requests
    Given the nightly's coverage check finds a gap
    Then the nightly job fails and its report names the gap by id
    And no pull request check depends on it
