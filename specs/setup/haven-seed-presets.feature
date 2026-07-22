Feature: Seed presets — a database that is ready to look at
  A freshly seeded project greets you with the onboarding "waiting for your
  first message" screen, which is the wrong starting point when you are working
  on everything after onboarding. `haven db reset` always lands the stable
  local identity; `--demo` additionally puts the project in the state you
  actually need (ADR-064 folded the old seed command into db reset).

  # Behavior lives in tools/thuishaven `app/db.go` (DBReset: drop + migrate +
  # seed, demo layering, stack-liveness check for the traces) plus the seed
  # scripts it runs in langwatch/ (prisma:seed, seed:sample-traces). Bound by
  # Go tests (`go test ./...` in tools/thuishaven): `app/db_test.go`
  # (TestDBReset). The full ingest-through-the-collector path is only
  # exercised manually, so that scenario stays `@unimplemented`. The parity
  # checker (`langwatch/scripts/check-feature-parity.ts`) scans
  # tools/thuishaven's Go tests: @unit scenarios are bound by `// @scenario`
  # annotations above those test funcs.

  @unit
  Scenario: The default seed is unchanged
    When I run "haven db reset" and confirm
    Then the databases are recreated, migrated, and seeded with the stable
      local identity (user, organization, project, API key)
    And no preset content is added

  @e2e @unimplemented
  Scenario: Seeding a project that has already received traffic
    Given this worktree's stack is running
    When I run "haven db reset --demo"
    Then the seeded project is past onboarding
    And sample traces are ingested through the stack's real collector
    And re-running updates the same traces instead of duplicating them

  @unit
  Scenario: The demo preset needs the stack for its traces
    Given this worktree's stack is not running
    When I run "haven db reset --demo"
    Then the identity is seeded past onboarding
    And the command fails explaining the stack must be up for the sample traces

  # The seed-script scenario below runs prisma/seed.ts against a real
  # database; no automated harness drives that today, so it stays
  # @unimplemented (the Go tests only cover the env plumbing).
  @integration @unimplemented
  Scenario: Model providers are seeded from the environment by default
    Given a provider API key is set in the environment or a dotenv layer
    When I run "haven db reset" and confirm
    Then that provider is seeded as an enabled org-scoped credential
    And re-running updates the same credential instead of duplicating it
    And HAVEN_SEED_MODEL_PROVIDERS=0 in the environment seeds no providers
