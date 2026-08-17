Feature: The compiled nlpgo test binary survives between CI runs
  As a developer waiting on the integration shards
  I want a cached nlpgo binary to be reused when no Go source changed
  So that a shard does not pay a 90-second Go compile to run one test

  # Two integration files boot the REAL nlpgo service, so they compile it. The
  # workflow caches the compiled artifact, and the cache restores — but the
  # build ran anyway on every observed run, because the staleness decision
  # compared FILE MODIFICATION TIMES.
  #
  # Git does not record mtimes. actions/checkout writes every source file
  # fresh, so on CI each .go file carries the time of THIS run's checkout,
  # while the restored binary carries the time it was compiled in a PREVIOUS
  # run. Every source therefore looks newer than the binary and the cache can
  # never hit, no matter how well it is keyed.
  #
  # Content is the honest question — "are these the sources this binary was
  # built from" — and it is the same question whether the tree came from a
  # checkout, a cache restore or a local edit. So the decision reads a stamp
  # written beside the binary recording the digest of the sources it was
  # built from.

  Background:
    Given two integration files boot the real nlpgo service
    And the compiled binary is cached beside a stamp of the sources it was built from

  Rule: staleness is decided by source content, not by modification time

    @unit
    Scenario: A cache restore whose sources were rewritten by checkout is reused
      Given a cached binary built from the current sources
      And every Go source carries a modification time newer than the binary
      When a test asks for the nlpgo binary
      Then the cached binary is reused
      And no Go compile runs

    @unit
    Scenario: A changed Go source rebuilds
      Given a cached binary built from earlier sources
      And a Go source has changed since the binary was built
      When a test asks for the nlpgo binary
      Then the binary is rebuilt
      And the stamp records the digest of the current sources

    @unit
    Scenario: A binary with no stamp rebuilds
      Given a cached binary with no stamp beside it
      When a test asks for the nlpgo binary
      Then the binary is rebuilt

    @unit
    Scenario: A stamp with no binary rebuilds
      Given a stamp whose binary is missing
      When a test asks for the nlpgo binary
      Then the binary is rebuilt

  Rule: the digest covers exactly what the build reads

    @unit
    Scenario: A file added to a watched tree changes the digest
      Given a digest of the current sources
      When a Go file is added under a watched tree
      Then the digest changes

    @unit
    Scenario: A file removed from a watched tree changes the digest
      Given a digest of the current sources
      When a Go file is removed from a watched tree
      Then the digest changes

    @unit
    Scenario: Renaming a file changes the digest even when the content is unchanged
      Given a digest of the current sources
      When a Go file is renamed within a watched tree
      Then the digest changes

    @unit
    Scenario: Touching a file without editing it leaves the digest alone
      Given a digest of the current sources
      When a Go file's modification time moves but its bytes do not
      Then the digest is unchanged

    @unit
    Scenario: A non-Go file is ignored
      Given a digest of the current sources
      When a README is added under a watched tree
      Then the digest is unchanged
