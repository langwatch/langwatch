@unit
Feature: langevals as an opt-in haven service
  Monitors and evaluations call the langevals evaluator service. A haven stack
  runs it only when the worktree asks, because its imports alone hold a few GiB,
  and when it does, every lane is pointed at that stack's own copy.

  # Bound by Go tests in tools/thuishaven: domain/overlay_langevals_test.go and
  # app/plan_langevals_test.go, by their `// @scenario` annotations.

  Scenario: Langevals is off until a worktree asks for it
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then no langevals lane is started
    And the status line names langevals with "haven up +langevals"
    And LANGEVALS_ENDPOINT is left to .env

  Scenario: A stack running langevals points the app at it
    When the developer runs "haven up +langevals"
    Then a langevals lane runs the checkout's services/langevals with uv on a port haven allocated
    And the overlay sets LANGEVALS_ENDPOINT to that port on loopback for the api and go lanes
    And a later plain "haven up" in this worktree still runs it

  Scenario: A diffsuite stack can run langevals
    When diffsuite is run with "-up -langevals"
    Then the branch stack it starts is brought up with "+langevals"
