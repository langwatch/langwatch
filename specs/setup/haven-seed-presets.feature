Feature: Seed presets — a database that is ready to look at
  A freshly seeded project greets you with the onboarding "waiting for your
  first message" screen, which is the wrong starting point when you are working
  on everything after onboarding. Presets let a seed put the project in the
  state you actually need.

  # Behavior lives in tools/thuishaven `app/orchestrator.go` (Seed: preset
  # validation, stack-liveness check, trace-seeding env) plus the seed
  # scripts it runs in langwatch/ (prisma:seed, seed:sample-traces). The
  # preset plumbing is bound by Go tests (`go test ./...` in
  # tools/thuishaven): `app/seed_test.go` (TestSeedPresets: no preset,
  # unknown preset, stack down, live-stack trace wiring). The full
  # ingest-through-the-collector path is only exercised manually, so that
  # scenario stays `@unimplemented`. The parity checker
  # (`platform/app/scripts/check-feature-parity.ts`) scans tools/thuishaven's
  # Go tests: @unit scenarios are bound by `// @scenario` annotations above
  # those test funcs.

  @unit
  Scenario: The default seed is unchanged
    When I run "haven seed"
    Then the stable local identity (user, organization, project, API key) is seeded
    And no preset content is added

  @e2e @unimplemented
  Scenario: Seeding a project that has already received traffic
    Given this worktree's stack is running
    When I run "haven seed --preset demo"
    Then the seeded project is past onboarding
    And sample traces are ingested through the stack's real collector
    And re-running updates the same traces instead of duplicating them

  @unit
  Scenario: The demo preset needs the stack for its traces
    Given this worktree's stack is not running
    When I run "haven seed --preset demo"
    Then the identity is seeded past onboarding
    And the command fails explaining the stack must be up for the sample traces

  @unit
  Scenario: Unknown presets are rejected with the available choices
    When I run "haven seed --preset nosuch"
    Then the command fails
    And the error lists the presets I can pick from
