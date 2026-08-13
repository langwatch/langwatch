Feature: Leaked test containers are reaped
  An interrupted integration-test run leaves its testcontainers behind in the
  shared container VM — a stray ClickHouse or Redis that nothing will ever
  stop, because the testcontainers reaper (Ryuk) dies with the run that
  started it. Two days of that and the VM's few cores are spent merging and
  checkpointing for containers nobody is using, right next to the managed
  ClickHouse they starve. The haven daemon sweeps them the same way it
  already sweeps orphaned vitest workers: containers a test library labelled
  as its own are removed once they are old enough that no live test can
  still be using them, and fresh ones are left alone.

  # Behavior lives in tools/thuishaven: `domain/testcontainers.go` decides
  # what counts as leaked, `adapters/dockerjanitor` does the docker work, and
  # `app/daemon.go` runs the sweep on the same background-hygiene tick as
  # idle-database pruning. `HAVEN_TESTCONTAINER_TTL` tunes the grace period
  # (0 disables the sweep).

  @unit
  Scenario: A test container past the grace period is removed
    Given a container labelled by a testcontainers library
    And it was created longer ago than the grace period
    When the daemon runs its background hygiene
    Then that container is removed

  @unit
  Scenario: A fresh test container is left alone
    Given a container labelled by a testcontainers library
    And it was created within the grace period
    When the daemon runs its background hygiene
    Then that container keeps running

  @unit
  Scenario: Only containers a test library marked as its own are candidates
    Given the managed ClickHouse and observability containers are running
    When the daemon runs its background hygiene
    Then neither is ever considered for removal

  @unit
  Scenario: The operator can disable the sweep
    Given test-container reaping is disabled via the environment
    When the daemon runs its background hygiene
    Then no container is considered

  @unit
  Scenario: The sweep never boots the container VM
    Given the container VM is not running
    When the daemon runs its background hygiene
    Then the sweep does nothing rather than start the VM
