Feature: Vitest workers load installed packages from a cache
  As a developer waiting on the package suites
  I want each Vitest worker to find and read installed packages without asking the disk again
  So that a suite that starts a fresh worker per file stops paying for the same lookups every time

  # Under isolation every test file gets a new worker, and Node resolves and reads
  # the same few thousand node_modules files again in each one: about a fifth of a
  # trace UI worker's CPU. ADR-183 has the design and the measurements.

  Background:
    Given a suite whose config comes from the shared vitest config

  @unit
  Scenario: A worker answers a package lookup it has seen before from the cache
    Given an earlier worker resolved a package name to a file in node_modules
    When a later worker resolves the same name from the same directory
    Then the answer comes from the cache without asking Node

  @unit
  Scenario: A lookup that lands in project source is left to Node
    Given a specifier that resolves to a file outside node_modules
    When a worker resolves it twice
    Then Node answers it both times

  @unit
  Scenario: A worker reads an unchanged installed file from the cache
    Given an earlier worker loaded a file from node_modules
    When a later worker loads the same unchanged file
    Then its source comes from the cache

  @unit
  Scenario: A changed installed file is read again, never served stale
    Given an earlier worker loaded a file from node_modules
    And the file has since been edited
    When a later worker loads it
    Then the worker gets the edited source from disk
    And the cache keeps the edited source

  @unit
  Scenario: Generated files under node_modules are left to Node
    Given a file in a dot directory under node_modules, such as Vitest's own cache
    When a worker loads it
    Then nothing about it is cached

  @unit
  Scenario: An install starts a fresh cache
    Given a cache file written before an install
    When a worker starts after the install
    Then it starts from an empty cache
    And the next save removes the old file

  @unit
  Scenario: Workers that save at once keep each other's entries
    Given two workers that each added different entries
    When both save their cache
    Then the file on disk holds both workers' entries

  @unit
  Scenario: A damaged cache file reads as empty
    Given a cache file that was cut short or is not a cache file
    When a worker opens it
    Then every lookup misses and nothing wrong is served

  @unit
  Scenario: The cache is on for local runs and off in CI unless asked
    When the shared vitest config is resolved
    Then a local run loads the cache into every worker
    And a CI run does not
    And LANGWATCH_VITEST_MODULE_CACHE set to 0 or 1 outranks both

  @unit
  Scenario: Fast mode off leaves the workers as they were
    Given LANGWATCH_VITEST_FAST is 0
    When the shared vitest config is resolved
    Then the workers get no extra Node options
