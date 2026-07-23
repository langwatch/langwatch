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
  # langwatch/scripts/seed-mass.ts on the pure timeline generator in
  # scripts/seed-lib/mass-timeline.ts. Event-sourced products (scenario
  # simulations, evaluations, experiment runs) are seeded as real commands
  # whose backdated occurredAt the substrate honours verbatim — events land in
  # old event-log partitions and the running worker's projections build every
  # read model the way production does; read models are never written
  # directly. Traces are not event-sourced: they ingest through the collector,
  # which by design refuses spans older than 31 days (partition-pruning
  # guard), so trace fixtures exist only inside that window while the deep
  # history lives in the event log. HAVEN_SEED_MONTHS tunes the window
  # (default 3).
  @unit
  Scenario: The mass preset fills months of data across every product
    When I run "haven db seed mass"
    Then months of backdated scenario runs, evaluations, and experiment runs are seeded through their event logs
    And they are replayed into read models by the projection workers, never written directly
    And re-running is idempotent (deterministic ids, same window → same story)

  @unit
  Scenario: Backdated traces stay inside the collector's window
    Given the collector refuses spans more than 31 days old to protect partition pruning
    When the mass timeline is built
    Then trace fixtures are attached only to activity inside that window
    And older activity still exists as event-sourced history without a trace

  @e2e @unimplemented
  Scenario: A mass seed lands end to end on a live stack
    Given this worktree's stack is running
    When I run "haven db seed mass"
    Then the projections report every seeded scenario run, evaluation, experiment run, and windowed trace
