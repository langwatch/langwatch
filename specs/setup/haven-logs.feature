@unit
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

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Another stack's logs by name
    When the developer runs "haven logs --stack otherslug"
    Then that worktree's services print instead of this one's

  Scenario: Logs outlive the stack
    Given the stack was stopped or crashed
    When the developer runs "haven logs"
    Then the last run's output is still readable

  @integration @unimplemented
  Scenario: The observability stack is a log target like any other
    When the developer runs "haven logs obs"
    Then the observability stack's container output appears

  Scenario: One unreadable line never ends the capture
    Given a service that prints a single line of several megabytes
    When the supervisor captures its output
    Then the long line is split across captured lines instead of dropped
    And the lines printed after it are still captured
    And the service is never blocked writing to a pipe with no reader

  Scenario: A read error is recorded, not swallowed
    Given the supervisor cannot read a service's output stream
    When the read fails
    Then the failure is written to that service's log
    And everything read before the failure is kept

  Scenario: Capture comes back after the log file cannot be written
    Given the log directory is momentarily unwritable
    When the service keeps printing
    Then capture retries the file instead of giving up for the life of the process
    And a rotation that cannot happen keeps appending past the cap rather than going silent

  Scenario: Log files never grow without bound
    Given a service that logs heavily for days
    Then its captured log stays within the per-service size cap

  # Rotation bounds the file; this bounds the read, and they are not the same
  # thing. One generation of a busy service is still far larger than any view
  # of it, and the default view is the last 200 lines. Bound by cmd/logs_test.go.
  Scenario: A huge capture is read from its tail, not whole
    Given a captured log far larger than the command will ever print
    When the developer runs "haven logs"
    Then only the tail of the capture is read into memory
    And the newest lines still appear
    And a following tail resumes from the end of the file, not the end of what was read
    And the developer is told that older history was elided
