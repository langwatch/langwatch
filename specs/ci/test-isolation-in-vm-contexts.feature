Feature: Isolated jsdom test files share a worker instead of starting a process each
  As a developer waiting on the jsdom suites
  I want an isolated test file to stop loading jsdom from scratch
  So that isolation costs a fresh window, not a fresh process

  # With a process per isolated file, every file loads jsdom's code again:
  # about 700ms of CPU, against about 6ms to build another window once it is
  # loaded. Vitest's vmForks pool keeps one worker per lane, loads jsdom once
  # in it, and gives each file a fresh module registry and window in its own
  # vm context. See ADR-184.

  Background:
    Given a suite whose config isolates some or all of its files through the shared vitest config

  @unit
  Scenario: Isolated files share a worker and get a fresh window each
    Given the suite's config asks for isolation in vm contexts
    When the suite's config is resolved
    Then the isolated files run on the vmForks pool, with a memory limit per worker
    And the files that share modules stay where they were
    And each project runs as a group of its own, so shuffled files do not restart its workers

  @unit
  Scenario: A file that cannot run in a vm context keeps a process of its own
    Given the suite's config asks for isolation in vm contexts
    And a test file the config names as needing its own process, or one that asks for the node environment
    When the suite's config is resolved
    Then that file runs isolated in a process of its own
    And no file runs in both places

  @unit
  Scenario: A suite that does not ask for vm contexts keeps a process per isolated file
    Given the suite's config does not ask for isolation in vm contexts
    When the suite's config is resolved
    Then its isolated files run on the forks pool, a process each

  @unit
  Scenario: Turning fast mode off keeps a process per isolated file
    Given the suite's config asks for isolation in vm contexts
    And fast mode is turned off for the run
    When the suite's config is resolved
    Then every isolated file runs on the forks pool, a process each
