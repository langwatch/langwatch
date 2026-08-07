Feature: Pods size their ClickHouse connection pools against the whole fleet
  As someone running LangWatch on my own cluster,
  I want every pod that queries ClickHouse to divide the same budget between the
  same number of siblings,
  so that scaling any part of the platform cannot quietly ask the database for
  more connections than it is allowed.

  # PARKED behind #6614. The scenarios below are correct about the inputs, and
  # the chart wiring they bind to works. What is NOT settled is whether the
  # derived number should reach the client at all:
  #
  #   - Pool size is a ceiling on sockets, and sockets are not the quantity that
  #     reaches the server. ClickHouse holds roughly one connection per statement
  #     in flight and closes idle ones inside `idle_socket_ttl` (1500 ms), so the
  #     cap is never approached in practice.
  #   - #6614 sets the statement limiter's `maxConcurrent` FROM this number. Once
  #     it lands, a value that is too small stops bounding sockets and starts
  #     bounding in-flight statements, shedding past the queue as a
  #     customer-visible ClickHouseOverloadedError.
  #   - The values this chart derives - 8 on a default install, 5 at a
  #     production shape - sit an order of magnitude below observed working
  #     concurrency (GLOBAL_QUEUE_CONCURRENCY is 100-256 per pod).
  #
  # The real bound should be decided from `clickhouse_statements_in_flight` and
  # `clickhouse_statement_wait_seconds` once #6614 puts those in production.
  # Deriving a ceiling before that measurement exists is how the previous
  # hardcoded 25 was chosen, and #6399 removed it for exactly this reason.
  #
  # Cross-references:
  #   packages/clickhouse-client/src/pool.ts - resolvePoolSize, which owns the
  #     rules; this feature is only about the inputs reaching it.
  #   packages/clickhouse-client/src/rateLimit.ts - the statement limiter that
  #     #6614 wires this number into.
  #   charts/langwatch/templates/_helpers.tpl - langwatch.clickhousePoolSizingEnv,
  #     langwatch.clickhouse.clientReplicas and
  #     langwatch.clickhouse.chartManagedAdmissionLimit.
  #   charts/langwatch/templates/app/deployment.yaml and
  #   charts/langwatch/templates/workers/deployment.yaml - where it is emitted.
  #   charts/langwatch/tests/clickhouse-pool-sizing.sh - the test that renders
  #     the chart and asserts the numbers that reach the pods.
  #
  # Context. A pool belongs to one client instance, so the concurrent-query
  # budget the platform is granted has to cover every pool on every pod. A fixed
  # 64, reasoned about as a handful of pods, met a fleet several times that
  # size; on 2026-07-31 ClickHouse rejected tens of thousands of queries with
  # TOO_MANY_SIMULTANEOUS_QUERIES, and the retry path drove every rejection back
  # into the same wall.
  #
  # resolvePoolSize replaced the fixed number with a derivation, but it is inert
  # without its inputs: a pod that is not told the fleet size cannot divide by
  # anything, so the derivation is skipped and the historical 64 stands.
  #
  # The count has to be the FLEET, not one deployment. resolvePoolSize divides
  # the whole budget by the count it is handed, so a deployment reporting only
  # its own replicas sizes as though it owned the whole budget - and every other
  # deployment does the same against the same server. Both halves then fit
  # individually and overrun together, which is the original arithmetic error
  # reached from the other direction.
  #
  # The budget is not invented. A chart-managed ClickHouse admits
  # min(cpu x 25, 200) - its image computes that from CPU - so a default install
  # at cpu 2 admits 50, and no CPU size reaches past the 200 cap. An external
  # server's configuration is invisible to the chart, so it falls back to
  # ClickHouse's stock 300 and the operator states anything else.
  #
  # The fleet size cannot come from the downward API. fieldRef exposes pod-level
  # fields only, and a replica count belongs to a Deployment, so a pod cannot
  # read even its own. It is templated from the values that set spec.replicas,
  # and an operator who scales outside Helm has to keep those in step.
  #
  # These scenarios assert the rendered environment rather than the template
  # text, because every failure they describe renders as valid YAML on a healthy
  # pod: a missing include, a per-deployment count, a duplicate entry that a
  # later `extraEnvs` wins, and a budget the server never had.

  Rule: Every pod divides the same fleet

    @e2e
    Scenario: Every pod that builds a ClickHouse client counts the whole fleet
      Given an installation running both the app and the workers
      When the chart renders
      Then the app pods are told how many pods hold a client in total
      And the worker pods are told the same total
      And neither pod is given a second, conflicting answer

    @e2e
    Scenario: Scaling one deployment resizes the pools of both
      Given an installation that scales the app but not the workers
      When the chart renders
      Then the app pods size their pools for the larger fleet
      And the worker pods size theirs for that same larger fleet

    @e2e
    Scenario: A deployment that renders no pods is not counted
      Given an installation with the workers turned off
      When the chart renders
      Then only the app pods are counted in the fleet
      And a deployment scaled to zero is counted the same way

  Rule: The budget describes a limit the server actually has

    @e2e
    Scenario: The budget defaults to what this chart's own ClickHouse admits
      Given an operator who has said nothing about their ClickHouse tuning
      When the chart renders
      Then every pod divides what this chart's ClickHouse will admit
      And that figure follows the CPU the server was given, up to its own cap

    @e2e
    Scenario: An external server falls back to the ClickHouse default
      Given an installation pointing at a ClickHouse this chart does not manage
      When the chart renders
      Then every pod divides ClickHouse's own default admission limit

    @e2e
    Scenario: An operator granted a different budget states it once
      Given an operator whose ClickHouse admits a different number of queries
      When they set that budget as a chart value
      Then the app pods and the worker pods both divide the budget they gave

    @e2e
    Scenario: A budget larger than the chart's own server is refused
      Given an operator who sets a budget above what this chart's ClickHouse admits
      When the chart renders
      Then the render stops and names the limit the server actually has

  Rule: The chart and the client agree on the names

    @e2e
    Scenario: The chart emits the names the client actually reads
      Given the variables the chart sets on every pod
      When they are checked against the client that reads them
      Then each one is a name the client looks for
