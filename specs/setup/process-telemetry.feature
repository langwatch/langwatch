Feature: One OpenTelemetry setup every process uses
  As an operator running the LangWatch api, worker and tasks
  I want traces, logs and metrics wired once from declared configuration
  So that every process reports the same way and no process hand-rolls exporters

  # WHY THIS EXISTS
  #
  # Telemetry is an everyone-sends-to-one-place concern, so it declares its
  # config slice and its one credential at its framework owner exactly as a
  # module does, and the preamble wires it between the secrets chain and boot.
  # Metrics have two transports and the choice is a single knob: OTLP push (the
  # default — cheaper than a scrape at our cardinality) or a Prometheus scrape
  # door. Under OTLP the scrape door is NOT mounted: an unmounted endpoint is
  # honest, a mounted-but-empty one lies to a prober.

  Rule: The metrics transport is one declared knob, defaulting to OTLP

    @unit
    Scenario: No metrics mode is configured
      Given a process whose observability config names no metrics mode
      When its configuration is parsed
      Then the metrics mode is "otlp"

    @unit
    Scenario: A deployment asks for a Prometheus scrape instead
      Given a process configured with metrics mode "prometheus"
      When its configuration is parsed
      Then the metrics mode is "prometheus"

  Rule: OTLP push mounts no scrape door

    @unit
    Scenario: Metrics push over OTLP
      Given a process whose metrics mode is "otlp"
      When its metrics are composed
      Then no route is contributed at "/metrics"
      And a lifecycle component is hosted so shutdown flushes the push

  Rule: The Prometheus mode mounts a door that reads real numbers

    @unit
    Scenario: A scrape reads the process's own instruments
      Given a process whose metrics mode is "prometheus"
      When its metrics are composed and "/metrics" is scraped
      Then the exposition names the instruments this process records

    @unit
    Scenario: The scrape door is gated by the configured token
      Given a process whose metrics mode is "prometheus" and a scrape token is configured
      When a caller scrapes "/metrics" without that token
      Then the response is 401

    @unit
    Scenario: Metrics are switched off entirely
      Given a process whose metrics are disabled
      When its metrics are composed
      Then no route is contributed at "/metrics"

  Rule: A blank optional value is absent, not a value

    @unit
    Scenario: An optional field is left blank in the environment
      Given a process whose OTLP endpoint is declared but blank, as ".env.example" ships it
      When its configuration is parsed
      Then the endpoint is treated as unconfigured, not refused

  Rule: The collector's credential is a secret, never a config field

    @unit
    Scenario: The OTLP auth headers are declared as a handle
      Given the observability owner's declarations
      When they are read
      Then "OTEL_EXPORTER_OTLP_HEADERS" is a declared secret handle and not a config leaf

    @unit
    Scenario: The headers reach the exporter through the resolver
      Given a resolver answering the OTLP headers handle
      When telemetry is composed
      Then the header value is read through the handle rather than the environment
