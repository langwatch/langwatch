Feature: The standalone API process serves its own metrics
  As an operator scraping a LangWatch API deployment
  I want the API process to expose the metrics its own work records
  So that a tier running without the web process is not an observability hole

  # WHY THIS EXISTS
  #
  # The API process could be handed a metrics transport by a host, and no host
  # ever handed it one — so the tier had no /metrics at all, and the Group
  # Queue and eventing counters it records went nowhere. The process now
  # composes its own.
  #
  # The operator-visible contract is deliberately the SAME credential and the
  # same rules the web and worker tiers already carry
  # (specs/server/metrics-collection.feature), so an operator holds one rule
  # about METRICS_API_KEY rather than one per tier. What is process-specific,
  # and what these scenarios pin, is the composition decision: a tier that
  # cannot serve metrics safely serves no metrics endpoint at all.

  Rule: A configured key gates the endpoint and nothing else opens it

    @unit
    Scenario: An authenticated scrape renders what this process recorded
      Given the API process is configured with a metrics API key
      When a caller scrapes its metrics endpoint with that key
      Then the response is successful
      And it carries the samples this process recorded, not an empty registry

    @unit
    Scenario: A scrape with no credential or the wrong one is rejected
      Given the API process is configured with a metrics API key
      When a caller scrapes its metrics endpoint with no credential or an incorrect one
      Then the request is rejected as unauthorized
      And no metric samples are returned

  Rule: A process that cannot serve metrics safely serves no endpoint

    @unit
    Scenario: In production an unset key leaves the process with no metrics endpoint
      Given the API process runs in production with no metrics API key configured
      When it composes
      Then it names the absence at boot
      And its metrics endpoint is absent rather than open
      # Fail-closed, as the worker tier is: an unset key is a misconfiguration,
      # not an invitation. Absent rather than refusing, because a route that
      # answers every caller with a refusal is a surface with no purpose.

    @unit
    Scenario: Outside production an unset key leaves the endpoint open
      Given the API process runs outside production with no metrics API key configured
      When a caller scrapes its metrics endpoint without credentials
      Then the response is successful
      # The convenience the web process has always allowed, kept identical so
      # the credential has one rule across the deployment rather than two.

  Rule: A host that owns the graph owns the transport

    @unit
    Scenario: An injected metrics transport answers every scrape
      Given a host supplies the API process with its own metrics transport
      When the process composes
      Then scrapes are answered by the host's transport
      And what this deployment configured for a registry of its own is not consulted

  Rule: Composing metrics twice does not cost the process its metrics

    @unit
    Scenario: A registry that already carries default collectors is left intact
      Given a process whose registry already carries its default collectors
      When the API composition installs them again
      Then composition succeeds
      And a scrape still renders every sample the registry holds
      # Registering a collector twice is refused by the registry, so a process
      # that hosts a second composition would otherwise fail at boot.
