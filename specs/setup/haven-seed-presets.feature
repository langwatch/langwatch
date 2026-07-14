Feature: Seed presets — a database that is ready to look at
  A freshly seeded project greets you with the onboarding "waiting for your
  first message" screen, which is the wrong starting point when you are working
  on everything after onboarding. Presets let a seed put the project in the
  state you actually need.

  Scenario: The default seed is unchanged
    When I run "haven seed"
    Then the stable local identity is seeded exactly as before

  Scenario: Seeding a project that has already received traffic
    Given this worktree's stack is running
    When I run "haven seed --preset demo"
    Then the seeded project is past onboarding
    And sample traces are ingested through the stack's real collector
    And re-running updates the same traces instead of duplicating them

  Scenario: The demo preset needs the stack for its traces
    Given this worktree's stack is not running
    When I run "haven seed --preset demo"
    Then the identity is seeded past onboarding
    And the command fails explaining the stack must be up for the sample traces

  Scenario: Unknown presets are rejected with the available choices
    When I run "haven seed --preset nosuch"
    Then the command fails
    And the error lists the presets I can pick from
