Feature: haven logs
  Every service's output is captured per-service whether the stack is
  attached or detached, so logs can be replayed, followed, and filtered
  from any terminal — no detach flag to have remembered, no grepping a
  giant combined file, no query language. See ADR-064.

  Background:
    Given a worktree with a registered haven stack

  Scenario: Logs are captured no matter how the stack was started
    Given the stack was started attached in another terminal
    When the developer runs "haven logs" from a new terminal
    Then recent output from every service appears

  Scenario: Everything, labelled and interleaved
    When the developer runs "haven logs"
    Then recent lines from all services print in time order
    And every line is labelled with its service
    And warnings and errors are visually distinct

  Scenario: Filtering to one service is a plain argument
    When the developer runs "haven logs nlp"
    Then only nlp's lines appear
    And "haven logs nlp gateway" combines the two

  Scenario: Tailing is -t and only -t
    When the developer runs "haven logs -t"
    Then output streams live until interrupted
    And "-t" means tail nowhere else and nothing else in the CLI

  Scenario: A time window is one flag
    When the developer runs "haven logs --since 10m"
    Then only lines from the last ten minutes appear

  Scenario: Severity is a filter, not a grep
    When the developer runs "haven logs --level warn"
    Then only lines at warn or above appear

  Scenario: Another stack's logs by name
    When the developer runs "haven logs --stack otherslug"
    Then that worktree's services print instead of this one's

  Scenario: Logs outlive the stack
    Given the stack was stopped or crashed
    When the developer runs "haven logs"
    Then the last run's output is still readable

  Scenario: The observability stack is a log target like any other
    When the developer runs "haven logs obs"
    Then the observability stack's container output appears

  Scenario: Log files never grow without bound
    Given a service that logs heavily for days
    Then its captured log stays within the per-service size cap
