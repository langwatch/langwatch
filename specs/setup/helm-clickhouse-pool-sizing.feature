Feature: Pods size their ClickHouse connection pools against the whole fleet
  As someone running LangWatch on my own cluster,
  I want each pod to know how many siblings it has and what the ClickHouse
  server will accept,
  so that scaling the app or the workers cannot quietly ask the database for
  more connections than it is willing to hand out.

  # Cross-references:
  #   packages/clickhouse-client/src/pool.ts - resolvePoolSize, which owns the
  #     rules; this feature is only about the inputs reaching it.
  #   charts/langwatch/templates/_helpers.tpl - langwatch.clickhousePoolSizingEnv.
  #   charts/langwatch/templates/app/deployment.yaml and
  #   charts/langwatch/templates/workers/deployment.yaml - where it is emitted.
  #   charts/langwatch/tests/clickhouse-pool-sizing.sh - the test that renders
  #     the chart and asserts the numbers that reach the pods.
  #
  # Context. A pool belongs to one client instance, and a process builds two
  # (the raw client and the app-layer factory), so the server's
  # max_concurrent_queries has to cover every pool on every pod. A fixed 64,
  # reasoned about as a handful of pods holding one client each, met a fleet of
  # app and worker pods holding two each; on 2026-07-31 ClickHouse rejected tens
  # of thousands of queries with TOO_MANY_SIMULTANEOUS_QUERIES, and the retry
  # path drove every rejection back into the same wall.
  #
  # resolvePoolSize replaced the fixed number with a derivation, but it is inert
  # without its inputs: a pod that is not told the replica count cannot divide
  # by anything, so the derivation is skipped and the historical 64 stands. That
  # failure mode renders as valid YAML and a healthy pod, which is why these
  # scenarios assert the rendered environment rather than the template text.
  #
  # The replica count cannot come from the downward API. fieldRef exposes
  # pod-level fields only, and the replica count belongs to the Deployment, so
  # it is templated from the same value that sets spec.replicas. An operator who
  # scales outside Helm has to keep that value in step.

  Rule: Each pod is told the size of its own deployment

    @e2e
    Scenario: Every pod that builds a ClickHouse client is told its own replica count
      Given an installation running both the app and the workers
      When the chart renders
      Then each app pod is told how many app replicas there are
      And each worker pod is told how many worker replicas there are

    @e2e
    Scenario: Scaling one deployment leaves the other's sizing alone
      Given an installation that scales the app but not the workers
      When the chart renders
      Then the app pods size their pools for the larger app deployment
      And the worker pods still size theirs for the worker deployment alone

  Rule: The server's budget is stated once, for every client

    @e2e
    Scenario: The server's budget defaults to the ClickHouse default
      Given an operator who has said nothing about their ClickHouse tuning
      When the chart renders
      Then every pod divides the ClickHouse default concurrent-query limit

    @e2e
    Scenario: An operator with a tuned server states the budget once
      Given an operator whose ClickHouse accepts a different number of concurrent queries
      When they set that limit as a chart value
      Then the app pods and the worker pods both divide the limit they gave
