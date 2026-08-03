Feature: The evaluations service sizes its worker pool to the container, not the node
  As someone running LangWatch on my own cluster,
  I want the CPU I allot the evaluations service to decide how many workers it
  runs,
  so that its memory stays inside the limit I set instead of scaling with
  whatever machine it happened to land on.

  # Cross-references:
  #   charts/langwatch/templates/_helpers.tpl — langwatch.langevals.cpuCount.
  #   charts/langwatch/templates/langevals/deployment.yaml — where it is emitted.
  #   charts/langwatch/tests/langevals-sizing.sh — the test that renders the
  #     chart and asserts the number that reaches the pod.
  #   specs/setup/helm-langevals-memory.feature — the ceilings this count needs.
  #
  # Context. The service sizes its gunicorn pool from its own get_cpu_count().
  # That function's "Kubernetes" branch reads /sys/fs/cgroup/cpu/cpu.shares, a
  # cgroup **v1** path. Current nodes run cgroup v2, where the file does not
  # exist, so the lookup raises and it falls through to sched_getaffinity() —
  # which reports the NODE's CPU count. A container limited to 500m forks one
  # worker per node core.
  #
  # The pool is expensive: each worker lazily loads its OWN copy of every local
  # model it serves, roughly 2.1Gi. Measured on the published images, one CPU
  # limit, an 8-vCPU node: 11Gi and still climbing, having OOM-killed at the
  # chart's own 8Gi default. Pinned to one worker, the same load holds flat at
  # 2.5Gi.
  #
  # CPU_COUNT is the variable get_cpu_count() honours ahead of any detection.
  # WEB_CONCURRENCY is not: the service passes an explicit worker count to
  # gunicorn, which overrides the environment default.
  #
  # These scenarios are verified by rendering the chart, because the helper does
  # real arithmetic on a Kubernetes CPU quantity. Asserting that the template
  # contains "ceil" would pass just as happily if it said "floor" — only a
  # render shows the number that lands in the pod. The checker does not scan
  # .sh files, so these carry @e2e and the feature is deny-listed rather than
  # reported as bound; an "all bound ✓" here would not be true.

  Rule: The worker count follows the container's CPU allowance

    @e2e
    Scenario: A profile that asks for a fraction of a core gets a single worker
      Given a profile that limits the evaluations service to well under a core
      When the chart renders that profile
      Then the service is told to run one worker

    @e2e
    Scenario: A profile that asks for more CPU gets a proportionally larger pool
      Given the default profile, which allows the service two cores
      When the chart renders it
      Then the service is told to run two workers

    @e2e
    Scenario: A fractional allowance rounds up to a whole worker
      Given an allowance that is not a whole number of cores
      When the chart renders it
      Then the worker count is rounded up, so the allowance is never wasted
      And an allowance below a single core still yields one worker, never zero

  Rule: The operator stays in charge

    @e2e
    Scenario: An operator who sets the worker count keeps it
      Given an operator who has set CPU_COUNT themselves
      When the chart renders
      Then their value is the one the service receives
      And the chart does not also emit its own alongside it
