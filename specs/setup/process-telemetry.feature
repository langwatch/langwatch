Feature: One OpenTelemetry setup every process uses
  As an operator running the LangWatch api, worker and tasks
  I want traces, logs and metrics wired once from declared configuration
  So that every process reports the same way and no process hand-rolls exporters

  # WHY THIS EXISTS
  #
  # Telemetry is an everyone-sends-to-one-place concern, so it declares its
  # config slice and its one credential at its framework owner exactly as a
  # module does, and the preamble wires it between the secrets chain and boot.
  # Metrics are pushed and may also be pulled (ADR-175): one MeterProvider
  # carries the OTLP push and, when OTEL_METRICS_EXPORTER lists prometheus, a
  # pull reader served on its own port (OTEL_EXPORTER_PROMETHEUS_PORT, default
  # 9464), never the public one, behind METRICS_API_KEY. Nothing is mounted
  # that reads nothing: an unmounted endpoint is honest, an empty one lies.

  Rule: The exporter list decides push and pull, defaulting to push alone

    @unit
    Scenario: No metrics mode is configured
      Given a process whose observability config names no metrics exporter
      When its configuration is parsed
      Then metrics are pushed and no pull reader is asked for

    @unit
    Scenario: A deployment asks for a Prometheus scrape instead
      Given a process configured with OTEL_METRICS_EXPORTER "otlp,prometheus"
      When its configuration is parsed
      Then a pull reader is asked for beside the push

  Rule: OTLP push mounts no scrape door

    @unit
    Scenario: Metrics push over OTLP
      Given a process whose metrics exporter is "otlp"
      When its metrics are composed
      Then no route is contributed at "/metrics" and no pull port is opened
      And a lifecycle component is hosted so shutdown flushes the push

  Rule: The pull door reads the same provider the push does, on its own port

    @unit
    Scenario: Push and pull read one provider
      Given a process whose metrics exporter is "otlp,prometheus" and a collector is set
      When an instrument records and the pull port is scraped
      Then the exposition carries the recording
      And the collector still receives the push

    @unit
    Scenario: A scrape reads the process's own instruments
      Given a process whose metrics exporter lists "prometheus" and METRICS_API_KEY is set
      When its pull port is scraped at "/metrics" with that bearer
      Then the exposition names the instruments this process records

    @unit
    Scenario: The scrape door is gated by the configured token
      Given a process whose metrics exporter lists "prometheus" and METRICS_API_KEY is set
      When a caller scrapes the pull port without that bearer, or with the wrong one
      Then the response is 401

    @unit
    Scenario: An unset scrape token mounts no door
      Given a process, in production or not, whose metrics exporter lists "prometheus" and no METRICS_API_KEY
      When its metrics are composed
      Then no pull port is opened and the boot log says to set METRICS_API_KEY
      # Fail-closed in every environment, as the Go gateway's door is. LANGWATCH_METRICS_TOKEN never shipped and opens nothing.

    @unit
    Scenario: Metrics are switched off entirely
      Given a process whose metrics exporter is "none"
      When its metrics are composed
      Then no route is contributed at "/metrics" and no pull port is opened

  Rule: main's health-door /metrics stays only during the alias window

    @unit
    Scenario: main's health-door /metrics stays while the key is set
      Given a process with METRICS_API_KEY set and no OTEL_METRICS_EXPORTER written
      When its metrics are composed
      Then "/metrics" is a route on the health door behind that bearer
      And the boot log warns that it is deprecated and names OTEL_METRICS_EXPORTER=otlp,prometheus

    @unit
    Scenario: Naming the exporter list retires the health-door /metrics
      Given a process with no METRICS_API_KEY, or one whose OTEL_METRICS_EXPORTER is written
      When its metrics are composed
      Then no route is contributed at "/metrics" on the health door

  Rule: A process that boots no preamble reads the same logger names

    @unit
    Scenario: A process without a preamble reads the same logger names
      Given the tasks runner or the scenario child starts with LOG_LEVEL, a collector and OTEL_SERVICE_NAME set
      When it configures its logger from the observability slice
      Then the logger takes that level for both sinks, exports to the collector and uses that service name
      And with nothing set it keeps its own name and exports nothing

    @unit
    Scenario: A process without a preamble reads main's names as warned aliases
      Given the tasks runner or the scenario child starts with PINO_LOG_LEVEL set
      When it configures its logger from the observability slice
      Then the logger takes that level and the process logs one deprecation warning
      And an old name that disagrees with its replacement refuses the start

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

    @unit
    Scenario: A shared observability handle is returned as-is, without a second SDK setup
      Given one application has already set up the process's observability
      When a second application in the same process composes its observability with that handle
      Then it is handed the same handle
      And the telemetry SDK is not set up a second time

  Rule: The scenario child runs customer code and gets no collector access

    @unit
    Scenario: The child's environment carries the log settings and no collector credential
      Given a parent whose log level, log format and old level names are set
      And the parent's collector endpoint and OTLP headers are set
      When the scenario child's environment is built
      Then the log level and format names reach the child
      And "OTEL_EXPORTER_OTLP_ENDPOINT" and "OTEL_EXPORTER_OTLP_HEADERS" do not
