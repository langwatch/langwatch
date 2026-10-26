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
  Scenario: A subpath import from project code is left to Node
    Given a "#" import in project code that Node resolves into node_modules
    When a worker resolves it twice
    Then Node answers it both times
    And nothing about it is cached

  @unit
  Scenario: A cached lookup is not shared across resolution conditions
    Given a worker resolved a package name under the import conditions
    When the same name is resolved under the require conditions
    Then Node answers the second lookup

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
  Scenario: A deleted installed file is not served from the cache
    Given an earlier worker loaded a file from node_modules
    And the file has since been deleted
    When a later worker loads it
    Then Node's own error reaches the worker

  @unit
  Scenario: A file that changes while Node reads it is not kept
    Given an installed file that is rewritten while Node reads it
    When a worker loads it
    Then the worker gets what Node read
    And nothing about it is cached

  @unit
  Scenario: A source larger than the cap is not kept
    Given an installed file larger than 8 MB
    When a worker loads it twice
    Then Node answers both loads
    And nothing about it is cached

  @unit
  Scenario: A cached source is not served to a caller expecting another format
    Given an earlier worker loaded a file from node_modules as CommonJS
    When a later worker loads it expecting an ES module
    Then Node answers the load

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
  Scenario: An install changes the name of the cache files
    Given the cache files are named from the lockfile, pnpm's install state and the Node setup
    When the lockfile changes, pnpm rewrites its install state, or symlinks are preserved
    Then the name differs, so the next worker starts from an empty cache

  @unit
  Scenario: A temporary file a killed worker left behind is removed once it is old
    Given a temporary file from a worker that was killed mid-save more than an hour ago
    And one from a save still in flight
    When any worker saves
    Then the old file is removed and the recent one stays

  # Two saves that overlap can drop the earlier writer's additions: that costs a
  # lookup or a read next run, never a wrong answer (ADR-183, "Writing").
  @unit
  Scenario: A save keeps what other workers saved before it
    Given a worker that opened the cache file and added entries
    And another worker that saved its own entries since
    When the first worker saves
    Then the file on disk holds both workers' entries

  @unit
  Scenario: Entries no recent save touched are dropped
    Given an entry that no worker added or read in the last 200 saves
    And an entry a saving worker read
    When a worker saves
    Then the untouched entry is gone and the one that was read stays

  @unit
  Scenario: The cache file stays under its byte cap
    Given entries that together pass the cap of 96 MB per file
    When a worker saves
    Then the entries touched longest ago are dropped until the file fits

  @unit
  Scenario: A damaged cache file reads as empty
    Given a cache file that was cut short or is not a cache file
    When a worker opens it
    Then every lookup misses and nothing wrong is served

  @unit
  Scenario: The cache is on for local runs and off in CI unless asked
    When the shared vitest config is resolved
    Then on a local run its execArgv holds --import and the path of the register file
    And in CI it sets no execArgv
    And LANGWATCH_VITEST_MODULE_CACHE set to 0 or 1 outranks both

  @unit
  Scenario: Fast mode off leaves the workers as they were
    Given LANGWATCH_VITEST_FAST is 0
    When the shared vitest config is resolved
    Then the workers get no extra Node options

  @unit
  Scenario: A later worker reads what an earlier worker saved to disk
    Given a worker that resolved a package and exited normally
    When a later process starts with the cache and resolves the same package
    Then it gets the saved answer, and a process without the cache gets Node's

  @unit
  Scenario: A forked worker ended with SIGTERM still saves its cache
    Given a forked worker that loaded a package
    When Vitest ends it with SIGTERM
    Then the cache files are on disk afterwards
    And the worker still ends by the signal
