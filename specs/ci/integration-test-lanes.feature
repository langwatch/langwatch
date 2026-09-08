Feature: Integration tests run in the lane their dependencies call for
  As a developer waiting on the integration shards
  I want a test that needs no datastore to run without one
  So that rendering a component does not cost a Postgres, a ClickHouse and a Redis

  # The `.integration.test.*` suffix states a test LEVEL — renders a component,
  # mocks its boundaries — and that is the right name for such a test. CI had
  # been reading it as a request for INFRASTRUCTURE: every one of the 1024 files
  # ran on a shard that booted three datastores, migrated two schemas, installed
  # goose and set up Helm first. 548 of them declare jsdom and name no datastore
  # at all.
  #
  # So the lane follows the dependencies rather than the filename. Both vitest
  # configs derive their file list from the same partition, which is what makes
  # the two lanes a complete and non-overlapping cover of the suite — a
  # hand-maintained list would eventually drop a file from CI entirely, and read
  # green while doing it.

  Background:
    Given every file named `*.integration.test.*` belongs to exactly one lane
    And the component lane runs with no service containers

  Rule: the lane is decided by what the file needs, not by what it is called

    @unit
    Scenario: A jsdom test that names no datastore runs without one
      Given a test file declaring the jsdom environment
      And it names no database, queue or cache
      When its lane is decided
      Then it runs in the component lane

    @unit
    Scenario: A jsdom test that reaches for a datastore keeps its datastore
      Given a test file declaring the jsdom environment
      And it names a datastore
      When its lane is decided
      Then it runs in the datastore lane

    @unit
    Scenario: A node-environment test keeps its datastore
      Given a test file that does not declare the jsdom environment
      When its lane is decided
      Then it runs in the datastore lane

    @unit
    Scenario Outline: Every datastore a test could reach sends it to the datastore lane
      Given a test file declaring the jsdom environment
      And it names <dependency>
      When its lane is decided
      Then it runs in the datastore lane

      Examples:
        | dependency  |
        | prisma      |
        | clickhouse  |
        | redis       |
        | bullmq      |
        | groupQueue  |

  Rule: the safe lane is the default

    @unit
    Scenario: A file that cannot be read runs where everything is available
      Given a test file whose source cannot be read
      When its lane is decided
      Then it runs in the datastore lane

    @unit
    Scenario: A new test file with no marker at all runs in the datastore lane
      Given a test file declaring neither an environment nor a datastore
      When its lane is decided
      Then it runs in the datastore lane

  Rule: the two lanes cover the suite exactly once

    @unit
    Scenario: No integration file is dropped from CI
      Given the set of integration test files on disk
      When the suite is partitioned into lanes
      Then every file appears in one lane or the other

    @unit
    Scenario: No integration file runs twice
      Given the set of integration test files on disk
      When the suite is partitioned into lanes
      Then no file appears in both lanes

    @unit
    Scenario: The partition is stable across the processes that compute it
      Given the suite is partitioned in one process
      When it is partitioned again in another
      Then both lanes list the same files in the same order

  Rule: a lane's file list survives being read as a glob

    # Vitest has no "exactly these files" option — `include` takes globs. Twelve
    # of the app's integration tests live under `src/pages/[project]/`, and to a
    # glob engine `[project]` is a character class matching one of p/r/o/j/e/c/t,
    # so it does not match the directory literally named that. Handed over
    # unescaped, those twelve files are selected by NEITHER lane: they stop
    # running, and both lanes report a clean pass over what is left.

    @unit
    Scenario: A path containing a Next.js route segment matches only itself
      Given a test file under a directory named with square brackets
      When the lane's file list is turned into include patterns
      Then the pattern matches that file
      And it does not match a path formed from the bracketed characters

    @unit
    Scenario Outline: Pattern syntax in a path is escaped
      Given a test file whose path contains <character>
      When the lane's file list is turned into include patterns
      Then the character is escaped

      Examples:
        | character     |
        | a square bracket |
        | a brace       |
        | a parenthesis |
        | an asterisk   |
        | a question mark |

    @unit
    Scenario: An ordinary path is left alone
      Given a test file whose path contains no pattern syntax
      When the lane's file list is turned into include patterns
      Then the pattern is the path unchanged
