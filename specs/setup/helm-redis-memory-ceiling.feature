Feature: The bundled Redis refuses writes at a memory ceiling instead of being killed
  As someone running LangWatch on my own cluster,
  I want the chart's Redis to stop accepting writes before it reaches its
  container limit,
  so that Kubernetes does not kill it and lose the work queued in it.

  # Cross-references:
  #   charts/langwatch/templates/_helpers.tpl — langwatch.redisMaxmemory.
  #   charts/langwatch/templates/redis/statefulset.yaml — both command forms.
  #   charts/langwatch/examples/overlays/size-prod.yaml and size-ha.yaml —
  #     Redis at 3Gi / 1 CPU.
  #   charts/langwatch/tests/redis-maxmemory.sh — the test that renders the
  #     chart and asserts the byte count that reaches the pod.
  #
  # Context. Under ingest Redis snapshots to disk about once a minute. The fork
  # shares memory pages with the parent and copies each one the parent changes,
  # so memory briefly approaches double the data. Load tests with the chart's
  # Redis at 60 to 85 percent of its limit saw it OOMKilled on every size
  # profile; a run with snapshots off was not. A ceiling at half the limit
  # leaves room for the copy, and with the noeviction policy Redis then refuses
  # writes past the ceiling rather than dying.
  #
  # These scenarios are verified by rendering the chart. The helper parses
  # Kubernetes quantities and does arithmetic on them, and a number written in
  # a values file reaches it as a float, so only a render of the real input
  # shows the byte count the pod receives.

  Rule: The ceiling follows the memory limit

    @e2e
    Scenario: The ceiling is half of the memory limit
      Given a Redis memory limit written as a size such as 512Mi or 1.5Gi
      When the chart renders
      Then Redis is started with a ceiling of half that limit in bytes

    @e2e
    Scenario: Production and HA profiles give Redis three gibibytes
      Given the production or HA size profile
      When the chart renders
      Then Redis requests 1Gi and is limited to 1 CPU and 3Gi
      And its ceiling is 1610612736 bytes

    @e2e
    Scenario: Both ways of starting Redis carry the ceiling
      Given Redis with authentication on, or off
      When the chart renders
      Then the ceiling is on the command line in both forms
      And the noeviction policy is kept

  Rule: The operator stays in charge

    @e2e
    Scenario: An explicit ceiling wins over the computed one
      Given an operator who has set redis.master.maxmemory
      When the chart renders
      Then that value is the ceiling, taken as written rather than halved

    @e2e
    Scenario: A plain number in a values file is read as bytes
      Given a limit or a ceiling written as a plain number in a values file
      When the chart renders
      Then it is read as bytes, the same as when it is passed with --set

    @e2e
    Scenario: A memory value the chart cannot read is refused
      Given a limit or a ceiling that is not a size
      When the chart renders
      Then the install is refused, naming the value the operator wrote

    @e2e
    Scenario: With no memory limit Redis gets no ceiling
      Given Redis with no memory limit and no explicit ceiling
      When the chart renders
      Then Redis starts without a ceiling, as it did before
