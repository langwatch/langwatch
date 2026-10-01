@setup @unit
Feature: Machine resource limits are settable from the CLI and the hub
  The ClickHouse, observability and Redis caps, the colima VM shape and the
  unit test worker count can be set without editing .env, and every change
  says when it takes effect.

  Scenario: A limit resolves from the environment, then .env, then the settings file, then its default
    Given a limit is set in the environment, in .env and in the settings file
    Then the environment value applies
    When the environment does not set it
    Then the .env value applies
    When .env does not set it either
    Then the settings file value applies
    When nothing sets it
    Then the computed default applies and is reported as the default
    And only the limits' own knobs ever read the settings file

  Scenario: haven limits set and unset round-trip through the settings file
    When I run haven limits set redis-maxmemory-mb 256
    Then the value is saved in haven's home and every reader of the knob sees it
    And haven limits --json reports it with the source "settings" and when it applies
    And the environment still wins over it
    When I run haven limits unset redis-maxmemory-mb
    Then no settings file is left and the default applies
    And a value under the floor, over the machine, or a ClickHouse cap the colima VM cannot hold is refused
    And an unknown limit name is refused
    And a colima limit prints the exact colima stop and colima start command

  Scenario: The hub reads and edits the machine limits over HTTP
    When the page GETs /api/limits
    Then it receives the same report as haven limits --json
    When the page PUTs a value to /api/limits/<name> from the dashboard itself
    Then the limit is saved and the answer says when it applies
    When the page DELETEs /api/limits/<name>
    Then the limit is reset
    And a refused value answers 400 with the reason
    And a request from another origin is refused with 403

  Scenario: The instant-eval mock judge is a setting that reaches the stack's environment
    Given the instant-eval-mock-judge setting is 1, from the CLI, the hub, the environment or .env
    When a modular checkout's stack is brought up
    Then its overlay sets INSTANT_EVAL_CLASSIFIER to "memory"
    And a monolith checkout's stack gets nothing, because its parse does not know the value
    And the setting is 0 by default, which emits nothing
