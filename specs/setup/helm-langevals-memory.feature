Feature: The evaluations service sizes its worker pool to the CPU it was given
  As someone installing LangWatch on my own cluster,
  I want the evaluations service to stay inside the memory I allotted it,
  so that following the quickstart gives me a working install rather than a
  crash loop, and a running install does not die once people start using it.

  # Cross-references:
  #   charts/langwatch/templates/_helpers.tpl — langwatch.langevals.cpuCount.
  #   charts/langwatch/templates/langevals/deployment.yaml — where it is emitted.
  #   charts/langwatch/examples/values-local.yaml — the Kind quickstart profile.
  #   charts/langwatch/examples/values-test.yaml — the CI smoke profile.
  #   charts/langwatch/examples/overlays/size-dev.yaml — laptop / small team.
  #   charts/langwatch/examples/overlays/size-minimal.yaml — smallest that boots.
  #
  # Context. The evaluations service runs a gunicorn pool and sizes it from its
  # own get_cpu_count(). That function's "Kubernetes" branch reads
  # /sys/fs/cgroup/cpu/cpu.shares, a cgroup **v1** path. Current nodes run
  # cgroup v2, where the file does not exist, so the lookup raises and it falls
  # through to sched_getaffinity() — which reports the NODE's CPU count, not the
  # container's. A container limited to 500m forks one worker per node core.
  #
  # The pool is expensive. Each worker lazily loads its OWN copy of every local
  # model it serves (PII detection, language detection), so memory climbs by
  # roughly 2.1Gi per worker as requests round-robin across the pool, until
  # every worker holds every model.
  #
  # Measured against the published images, one CPU limit, an 8-vCPU node:
  #
  #   idle, evaluator stack imported ...............   543 MiB
  #   one worker, both local models resident ....... 2,571 MiB
  #   eight workers, sustained mixed load .......... 11,087 MiB and still rising,
  #                                                  having OOM-killed at the
  #                                                  chart's own 8Gi default
  #
  # Pinned to one worker, the same sustained load holds flat at 2,530 MiB.
  #
  # The small profiles tried to contain this with WEB_CONCURRENCY, which this
  # server never reads: it passes an explicit worker count to gunicorn, which
  # overrides the environment default. CPU_COUNT is the variable get_cpu_count()
  # honours ahead of any detection.
  #
  # None of this showed up in CI: the chart e2e either disables the evaluations
  # service or grants it 4Gi on a small runner, and `helm template` only proves
  # the YAML renders.

  Rule: The worker pool follows the container's CPU allowance, not the node's

    @unit
    Scenario: A profile that asks for a fraction of a CPU gets a single worker
      Given a profile that limits the evaluations service to well under a core
      When the chart renders that profile
      Then the service is told to run one worker
      And its memory stays bounded by the models one worker holds

    @unit
    Scenario: A profile that asks for more CPU gets a proportionally larger pool
      Given the default profile, which allows the service two cores
      When the chart renders it
      Then the service is told to run two workers
      And the default memory ceiling still covers what those workers load

    @unit
    Scenario: An operator who sets the worker count keeps it
      Given an operator who has set the worker count explicitly
      When the chart renders
      Then their value is the one the service receives
      And the chart does not also emit its own

  Rule: Every shipped profile can hold what it starts

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
