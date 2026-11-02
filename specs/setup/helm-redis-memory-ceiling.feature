Feature: The bundled Redis refuses writes at a memory ceiling instead of being killed
  As someone running LangWatch on my own cluster,
  I want the chart's Redis to stop accepting writes before it reaches its
  container limit,
  so that Kubernetes does not kill it and lose the work queued in it.

  Under ingest Redis snapshots to disk about once a minute. The snapshot copies
  each memory page Redis changes, so memory briefly approaches double the data.
  Load tests with Redis at 60 to 85 percent of its limit saw it killed for memory
  on every size profile; with snapshots off it was not. A ceiling at half the
  limit leaves room for the copy, and under noeviction Redis then refuses writes
  past the ceiling rather than dying.

  # Verified by rendering the chart: charts/langwatch/tests/redis-maxmemory.sh
  # (helper: langwatch.redisMaxmemory in templates/_helpers.tpl).

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
    Scenario: A numeric zero ceiling is an explicit override
      Given an operator who has set redis.master.maxmemory to the number 0 in a values file
      When the chart renders
      Then the ceiling is 0, not the half-limit default

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
