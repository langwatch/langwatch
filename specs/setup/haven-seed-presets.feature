Feature: Seed presets — a database that is ready to look at
  A freshly seeded project greets you with the onboarding "waiting for your
  first message" screen, which is the wrong starting point when you are working
  on everything after onboarding. `haven db seed [preset]` reseeds in place
  (an idempotent upsert, nothing dropped); `haven db reset [preset]` is the
  destructive sibling that starts from a fresh database. Presets are
  positional and shared by both: demo, traces, onboarding, post-onboarding,
  bare (ADR-064).

  # Behavior lives in tools/thuishaven `app/db.go` (the seedPresets registry,
  # DBSeed, DBReset, the live-stack ingest steps) plus the seed scripts they
  # run in langwatch/ (prisma:seed, seed:sample-traces,
  # seed:realistic-platform). Bound by Go tests (`go test ./...` in
  # tools/thuishaven): `app/db_test.go` (TestDBSeed, TestDBReset). The full
  # ingest-through-the-collector path is only exercised manually, so those
  # scenarios stay `@unimplemented`. The parity checker
  # (`langwatch/scripts/check-feature-parity.ts`) scans tools/thuishaven's Go
  # tests: @unit scenarios are bound by `// @scenario` annotations above those
  # test funcs.

  @unit
  Scenario: The default seed is unchanged
    When I run "haven db seed"
    Then the stable local identity (user, organization, project, API key) is seeded
    And no preset content is added

  @unit
  Scenario: Reseeding drops nothing
    Given this worktree's databases hold data
    When I run "haven db seed" with any preset
    Then no database is dropped and no confirmation is asked
    And "haven db reset" is the only path to a fresh database

  @unit
  Scenario: Unknown presets are rejected with the available choices
    When I run "haven db seed nosuch"
    Then the command fails before touching anything
    And the error lists the presets I can pick from

  @e2e @unimplemented
  Scenario: Seeding a project that has already received traffic
    Given this worktree's stack is running
    When I run "haven db seed demo"
    Then the seeded project is past onboarding
    And sample traces are ingested through the stack's real collector
    And re-running updates the same traces instead of duplicating them

  @unit
  Scenario: The demo preset needs the stack for its traces
    Given this worktree's stack is not running
    When I run "haven db seed demo"
    Then the identity is seeded past onboarding
    And the command fails explaining the stack must be up for the sample traces

  # Cheap variants composed from switches the seed scripts already understand:
  #   traces          — sample traces on top of the identity, no demo content
  #   onboarding      — first-trace flag cleared: land on the onboarding journey
  #   post-onboarding — past onboarding without demo content
  #   bare            — identity only: no env-derived providers, stock flags

  # The seed-script scenario below runs prisma/seed.ts against a real
  # database; no automated harness drives that today, so it stays
  # @unimplemented (the Go tests only cover the env plumbing).
  @integration @unimplemented
  Scenario: Model providers are seeded from the environment by default
    Given a provider API key is set in the environment or a dotenv layer
    When I run "haven db seed"
    Then that provider is seeded as an enabled org-scoped credential
    And re-running updates the same credential instead of duplicating it
    And the bare preset seeds no providers

  # --- The mass preset ---
  # Months of coherent, backdated activity, implemented in
  # langwatch/scripts/seed-mass.ts on the pure generators in
  # scripts/seed-lib/mass-timeline.ts and scripts/seed-lib/mass-metrics.ts.
  # Event-sourced products (scenario simulations, evaluations, experiment
  # runs) are seeded as real commands whose backdated occurredAt the substrate
  # honours verbatim — events land in old event-log partitions and the running
  # worker's projections build every read model the way production does; read
  # models are never written directly. Traces cover the whole window: the last
  # month goes through the real collector, and older traces are dispatched as
  # recordSpan pipeline commands, so the collector's public 31-day age guard
  # (partition-pruning protection) is never weakened. Metric series go through
  # the real OTLP metrics endpoint for the whole window — metrics have no
  # ingest-age guard. HAVEN_SEED_MONTHS tunes the window (default 3).
  @unit
  Scenario: The mass preset fills months of data across every product
    When I run "haven db seed mass"
    Then months of backdated scenario runs, evaluations, and experiment runs are seeded through their event logs
    And they are replayed into read models by the projection workers, never written directly
    And re-running is idempotent (deterministic ids, same window → same story)

  @unit
  Scenario: Traces cover the whole window without weakening the collector's guard
    Given the collector refuses spans more than 31 days old to protect partition pruning
    When the mass timeline is built
    Then every scenario run and organic conversation carries a trace across the whole window
    And the seeder sends recent traces through the real collector and older ones as pipeline commands
    And the collector's public age guard stays exactly as it is

  @unit
  Scenario: Three months of metric series go through the real metrics endpoint
    Given metric ingestion accepts backdated timestamps by design
    When the mass metrics are built
    Then deterministic hourly token, cost, latency, request, and user series cover every day of the window
    And they tell an improving story: traffic grows while errors and latency fall

  # --- Seed retention ---
  # A dev stack keeps only a week of data by default (see
  # data-retention/platform-default-override.feature), so seeded data — and
  # especially the mass preset's backdated history — would be written
  # pre-expired. Every seed preset therefore pins a two-year, partition-aligned
  # RetentionPolicy for the local-dev org first (the seed:retention step),
  # overriding the 7-day default so the seeded data survives. A bare, unseeded
  # database keeps the 7-day default. ClickHouse rows expire relative to their
  # DATA time, so a running worker must see the new policy before backdated
  # events reach it; the step waits out the resolver cache for a backdated
  # (mass) window.
  @unit
  Scenario: A seeded database keeps two years of partition-aligned history
    Given every retention-managed table is partitioned by week
    When the seed retention is computed for a window inside two years
    Then it is 728 days, exactly 104 whole weeks

  @unit
  Scenario: A deeper seed window scales retention up to outlive it
    Given a mass window deeper than two years
    When the seed retention is computed
    Then it outlives the window and stays a whole number of weeks

  @unit
  Scenario: Pinning seed retention writes every category once
    Given a database with no retention override
    When the seed retention is applied for the local-dev org
    Then a policy is written for traces, scenarios, and experiments

  @unit
  Scenario: Re-pinning seed retention is a no-op
    Given the retention policy is already at the target
    When the seed retention is applied again
    Then nothing changes and the cache wait is never triggered

  @e2e @unimplemented
  Scenario: A mass seed lands end to end on a live stack
    Given this worktree's stack is running
    When I run "haven db seed mass"
    Then the projections report every seeded scenario run, evaluation, experiment run, trace, and metric point
    And the seeded data survives because retention was raised above the 7-day default
