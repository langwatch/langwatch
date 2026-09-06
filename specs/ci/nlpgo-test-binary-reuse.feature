Feature: The compiled nlpgo test binary survives between CI runs
  As a developer waiting on the integration shards
  I want a cached nlpgo binary to be reused when nothing it is built from changed
  So that a shard does not pay a 90-second Go compile to run one test

  # Two integration files boot the REAL nlpgo service, so they compile it. CI
  # caches the compiled artifact, and the cache restores — but the build ran
  # anyway on every observed run, at ~90s a shard.
  #
  # The reason is that "has this changed" was answered by file modification
  # times. Git does not record them, so a checkout writes every source with the
  # time of the current run while a restored binary carries the time it was
  # compiled in an earlier one. Every source therefore looks newer than every
  # cached binary and the cache can never hit, however well it is keyed.
  #
  # These scenarios are about the outcome — compile or reuse — because that is
  # what a developer waiting on a shard experiences. How staleness is decided is
  # a unit-test concern, in nlpgoBinaryStamp.unit.test.ts.

  Background:
    Given a test that boots the real nlpgo service
    And a binary compiled by an earlier run is available

  Rule: nothing that changes the binary is missed

    @unit
    Scenario: A restored binary is reused when nothing changed
      Given nothing the service is built from has changed
      When a test asks for the nlpgo service
      Then the cached binary is reused
      And no compile runs

    @unit
    Scenario: A checkout does not on its own force a rebuild
      Given nothing the service is built from has changed
      And a fresh checkout has rewritten every file
      When a test asks for the nlpgo service
      Then the cached binary is reused

    @unit
    Scenario Outline: A change to anything the service is built from rebuilds it
      Given <change>
      When a test asks for the nlpgo service
      Then the service is compiled again
      And the rebuilt binary is the one that gets reused next time

      Examples:
        | change                                             |
        | a change to the service's own code                 |
        | a new file added to the service                    |
        | a file removed from the service                    |
        | a file renamed, with its contents unchanged        |
        | a change to a dependency the service pulls in      |
        | a change to the Go SDK the service compiles in     |

    @unit
    Scenario: A file that changed in name only still rebuilds
      Given a file renamed, with its contents unchanged
      When a test asks for the nlpgo service
      Then the service is compiled again

  Rule: anything that cannot change the binary is ignored

    @unit
    Scenario: Documentation alongside the service does not rebuild it
      Given a README added beside the service's code
      When a test asks for the nlpgo service
      Then the cached binary is reused

  Rule: a half-present cache is never trusted

    @unit
    Scenario: A binary restored without its provenance rebuilds
      Given a cached binary with no record of what it was built from
      When a test asks for the nlpgo service
      Then the service is compiled again

    @unit
    Scenario: A record restored without its binary rebuilds
      Given a record of what was built, but no binary
      When a test asks for the nlpgo service
      Then the service is compiled again

    @unit
    Scenario: A failed compile is not recorded as a success
      Given the service fails to compile
      When a test asks for the nlpgo service again
      Then the service is compiled again rather than a broken binary reused
