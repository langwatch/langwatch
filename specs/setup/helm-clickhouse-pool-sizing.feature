Feature: Pods size their ClickHouse connection pools against the whole fleet
  As someone running LangWatch on my own cluster,
  I want every pod that queries ClickHouse to divide the same share between the
  same number of siblings,
  so that scaling any part of the platform cannot quietly ask the database for
  more connections than it is allowed.

  # Cross-references:
  #   packages/clickhouse-client/src/pool.ts - resolvePoolSize, which owns the
  #     rules; this feature is only about the inputs reaching it.
  #   charts/langwatch/templates/_helpers.tpl - langwatch.clickhousePoolSizingEnv
  #     and langwatch.clickhouse.clientReplicas.
  #   charts/langwatch/templates/app/deployment.yaml and
  #   charts/langwatch/templates/workers/deployment.yaml - where it is emitted.
  #   charts/langwatch/tests/clickhouse-pool-sizing.sh - the test that renders
  #     the chart and asserts the numbers that reach the pods.
  #
  # Context. A pool belongs to one client instance, so the concurrent-query
  # share the platform is granted has to cover every pool on every pod. A fixed
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
  # the whole share by the count it is handed, so a deployment reporting only
  # its own replicas sizes as though it owned the whole share - and every other
  # deployment does the same against the same server. Both halves then fit
  # individually and overrun together, which is the original arithmetic error
  # reached from the other direction.
  #
  # The share is smaller than the server's admission limit, because other things
  # query the same cluster and a reporting burst must not be able to starve live
  # ingest. The chart states the share; the limit itself is set on the server,
  # outside this chart.
  #
  # The fleet size cannot come from the downward API. fieldRef exposes pod-level
  # fields only, and a replica count belongs to a Deployment, so a pod cannot
  # read even its own. It is templated from the values that set spec.replicas,
  # and an operator who scales outside Helm has to keep those in step.
  #
  # These scenarios assert the rendered environment rather than the template
  # text, because both failures above render as valid YAML on a healthy pod.

  Rule: Every pod divides the same fleet

    @e2e
    Scenario: Every pod that builds a ClickHouse client counts the whole fleet
      Given an installation running both the app and the workers
      When the chart renders
      Then the app pods are told how many pods hold a client in total
      And the worker pods are told the same total

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

  Rule: The platform's share is stated once, for every client

    @e2e
    Scenario: The platform's share defaults to less than the whole server
      Given an operator who has said nothing about their ClickHouse tuning
      When the chart renders
      Then every pod divides a share that leaves room for other users of the server

    @e2e
    Scenario: An operator granted a different share states it once
      Given an operator whose ClickHouse grants the platform a different share
      When they set that share as a chart value
      Then the app pods and the worker pods both divide the share they gave
