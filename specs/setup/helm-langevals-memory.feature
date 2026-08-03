Feature: Every shipped install profile can hold the evaluations service it starts
  As someone installing LangWatch on my own cluster,
  I want the profile I picked to give the evaluations service a memory ceiling
  it can actually live within,
  so that following the quickstart gives me a working install rather than a
  crash loop.

  # Cross-references:
  #   specs/setup/helm-langevals-worker-pool.feature — why the ceiling depends
  #     on the worker count, and how the chart bounds it.
  #   charts/langwatch/examples/values-local.yaml — the Kind quickstart profile.
  #   charts/langwatch/examples/values-test.yaml — the CI smoke profile.
  #   charts/langwatch/examples/overlays/size-dev.yaml — laptop / small team.
  #   charts/langwatch/examples/overlays/size-minimal.yaml — smallest that boots.
  #
  # These scenarios are about what the shipped values files ask for, which is a
  # fact about their text. Reading them is the direct check, not a proxy for
  # one, so they bind to a unit test. The number the chart *computes* is a
  # different question and lives in the worker-pool feature alongside a test
  # that renders the chart.
  #
  # Measured against the published images, one worker, preload disabled:
  #
  #   idle, evaluator stack imported ...............   543 MiB
  #   one worker, both local models resident ....... 2,571 MiB
  #
  # The small profiles shrank the memory limit alongside the request, to 512Mi
  # and 1Gi. A limit is not a reservation: lowering it frees no capacity on the
  # node, it only moves the point at which the kernel kills the container. So
  # those profiles bought nothing and guaranteed an OOM. The two at 512Mi died
  # while importing, before serving anything. The two at 1Gi were worse to
  # diagnose: healthy at boot, healthy until someone ran an evaluator that
  # loads a local model, dead at that moment.
  #
  # None of this reached CI: the chart e2e either disables the evaluations
  # service or grants it 4Gi, and `helm template` only proves the YAML renders.

  Background:
    Given the shipped install profiles that size the evaluations service down

  @unit
  Scenario: A small install can boot the evaluations service
    Given a profile whose ceiling is below what the service needs at rest
    When the operator installs with that profile
    Then the container is killed while importing its evaluator stack
    And the install never reaches a serving state
    But every shipped profile now sets a ceiling above the resting footprint

  @unit
  Scenario: Running a local-model evaluator does not kill the evaluations service
    Given a profile that boots but leaves under a gigabyte of headroom
    When someone runs the language-detection or PII-detection evaluator
    Then loading that model alone takes the service past its ceiling
    And the container is killed mid-request
    But every shipped profile now clears what a single worker holds loaded

  @unit
  Scenario: Shrinking the footprint shrinks the reservation, not the ceiling
    Given a profile whose whole purpose is to fit on a small node
    Then it still requests only a modest amount of memory, so it schedules there
    And its ceiling stays high enough to cover the work the service actually does

  @unit
  Scenario: The evaluations service asks for at least what it uses at rest
    Given the service holds its evaluator stack resident once imported
    Then no shipped profile requests less memory than the service idles at
    And the scheduler places it against a figure that reflects real use

  @unit
  Scenario: A default install covers every worker its CPU allowance buys
    Given no profile layered on top of the chart defaults
    Then the default ceiling covers each worker holding every local model

  @unit
  Scenario: No shipped profile claims a worker bound it does not have
    Given the service passes an explicit worker count to its web server
    Then setting WEB_CONCURRENCY changes nothing about how many workers run
    And no shipped profile sets it, so none implies a bound it does not have
