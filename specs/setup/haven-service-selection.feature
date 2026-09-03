@unit
Feature: haven service selection
  Which services a worktree runs is a sticky, visible, per-worktree choice
  expressed as deltas on up — not an env-var incantation. See ADR-064.

  # Bound by Go tests in tools/thuishaven (`go test ./...`): domain/selection_test.go
  # (defaults, deltas, the status line), app/restart_test.go (reconcile, recovery,
  # per-worktree stickiness), app/plan_test.go (the workers lane), and
  # cmd/root_test.go (the removed env vars). The parity checker binds them by the
  # `// @scenario` annotations above each test func.

  Background:
    Given a worktree with a registered haven stack

  Scenario: A fresh worktree starts lean
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then the stack runs the three Node lanes (ui, api, workers), nlp, gateway, and the idp simulator
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
    And the attached log view opens on langy's group
    And there is never a refusal
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

  # The workers lane stopped being selectable when the background worker became
  # its own application: every stack runs it, so ±workers has nothing to pick.
  # It is refused BY NAME rather than falling into the generic "unknown service"
  # error, which reads as a typo. See specs/setup/dev-process-topology.feature.
  Scenario: A retired service delta is refused by name
    When the developer runs "haven up +workers" or "haven up -workers"
    Then the command is refused
    And the refusal says the background worker is its own process now

  Scenario: Removed selection env vars name their replacement
    Given the developer still has "LANGWATCH_SKIP_NLP=1" set from before
    When they run "haven up"
    Then the command fails instead of starting a stack
    And the error says the variable no longer selects services
    And it names the one command that replaces it, "haven up -nlp"

  # Neither worker variable describes a topology this repository still has, so
  # both are refused on ANY value rather than only the one that used to change
  # what ran, and neither refusal offers a replacement — there is none.
  Scenario: A knob nothing reads is refused whichever way it is set
    Given the developer still has "WORKERS_IN_PROCESS" or "START_WORKERS" set from before
    When they run "haven up"
    Then the command fails instead of starting a stack
    And the error says the variable no longer does anything, naming no replacement

  # Every consumer outside haven spells truthiness differently, so matching one
  # literal lets the others through — and letting one through means running a
  # service the developer believes they turned off, which is what this whole
  # mechanism exists to prevent. Bound by cmd/root_test.go.
  Scenario: A removed selection variable is read for intent, not one spelling
    Given the developer wrote "WORKERS_IN_PROCESS=off" rather than "=0"
    When they run "haven up"
    Then it is refused exactly as "=0" would be
    And the same holds for "LANGWATCH_SKIP_NLP=yes" as for "=1"
    And a variable blanked out to nothing carries no intent and blocks nothing

  # The sticky selection is a file on disk that a developer can open, and the
  # natural thing to hand-write in it is the service you want, not all four.
  # Decoded as a whole selection, everything unwritten reads as off. Bound by
  # adapters/fileregistry/store_test.go.
  Scenario: A selection file that names only some services keeps the defaults for the rest
    Given a hand-written selection file that turns langy on and says nothing else
    When haven reads the worktree's selection
    Then langy is on
    And gateway and nlp keep the defaults they would have had
    And a file that names no services at all is treated as never written
