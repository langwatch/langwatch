Feature: haven service selection
  Which services a worktree runs is a sticky, visible, per-worktree choice
  expressed as deltas on up — not an env-var incantation. See ADR-064.

  Background:
    Given a worktree with a registered haven stack

  Scenario: A fresh worktree starts lean
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then the stack runs the app (workers in-process), nlp, and gateway
    And langy is not started
    And the first up prints the selection and how to change it

  Scenario: Adding a service is one word and it sticks
    When the developer runs "haven up +langy"
    Then langy starts as part of this stack
    And a later plain "haven up" in this worktree includes langy

  Scenario: Removing a service is the same shape
    Given nlp is part of this worktree's selection
    When the developer runs "haven up -nlp"
    Then nlp is stopped and leaves the selection
    And the nlp hostname resolves to the shared baseline stack instead of dead-ending

  Scenario: Up reconciles a running stack
    Given the stack is running without langy
    When the developer runs "haven up +langy"
    Then the running stack is replaced in place with langy included
    And there is no refusal and no force flag
    And a plain "haven up" on a stack that matches its selection changes nothing

  Scenario: Up recovers a half-dead stack without a force flag
    Given the registry says the stack is running but its launcher has died
    When the developer runs "haven up"
    Then the stale state is cleaned up and the stack starts

  Scenario: Selection is per-worktree
    Given worktree A selected +langy and worktree B did not
    When both run "haven up"
    Then A runs langy and B does not

  Scenario: Status shows the selection
    When the developer runs "haven status"
    Then the report names the selected services and their health
    And names the services not selected, each with the exact "+svc" to add it

  Scenario: The standalone workers lane is a selection, not an env var
    When the developer runs "haven up +workers"
    Then the workers run as their own lane instead of in-process
    And the choice sticks like any other selection

  Scenario: Legacy selection env vars bridge for one release
    When the developer runs "LANGWATCH_SKIP_NLP=1 haven up"
    Then nlp is skipped for this run only
    And a warning prints the sticky equivalent "haven up -nlp"
