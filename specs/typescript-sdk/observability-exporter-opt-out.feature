# Why the SDK stands its own telemetry graph up instead of using NodeSDK.
#
# `@opentelemetry/sdk-node` requires every OTLP exporter at module load --
# unconditional top-level requires of the trace, metrics and logs gRPC
# exporters -- so it cannot load at all unless `@grpc/grpc-js` is installed.
# That makes gRPC mandatory for every customer who installs this package for
# Node observability, including the overwhelming majority who export over
# HTTP and will never speak gRPC. Standing the graph up from
# `@opentelemetry/sdk-trace-node` (three dependencies, no exporters) lets each
# protocol be an optional peer: supported when wanted, absent when not.

Feature: Choosing an OTLP exporter without paying for the ones you do not use

  Background:
    Given a Node process setting up LangWatch observability

  @unit
  Scenario: The default export path needs no gRPC
    Given no exporter and no protocol are configured
    When observability starts
    Then spans are exported over HTTP
    And nothing in the loaded graph requires the gRPC exporter

  @unit
  Scenario: A caller brings its own exporter
    Given the caller passes a span exporter of its own
    When observability starts
    Then that exporter receives the spans
    And the SDK builds no exporter of its own

  @unit
  Scenario: gRPC is available to a process that wants it
    Given the protocol is configured as gRPC
    And the gRPC exporter package is installed
    When observability starts
    Then spans are exported over gRPC

  @unit
  Scenario: gRPC is asked for but was never installed
    Given the protocol is configured as gRPC
    And the gRPC exporter package is not installed
    When observability starts
    Then it refuses, naming the package to install
    And the refusal says which setting asked for gRPC

  # What NodeSDK did for us, which the replacement must keep doing. Each of
  # these fails silently if dropped: telemetry simply stops arriving, and the
  # process reports nothing wrong.

  @unit
  Scenario: Context still propagates across async boundaries
    Given observability has started
    When a span is opened and an async boundary is crossed
    Then work after the boundary still reports that span as its parent

  @unit
  Scenario: The tracer provider is the global one
    Given observability has started
    When any code asks the OpenTelemetry API for a tracer
    Then it receives the provider this setup registered, not a proxy

  @unit
  Scenario: Shutdown flushes what is buffered
    Given observability has started and spans are buffered
    When the process shuts observability down
    Then the buffered spans are exported before shutdown resolves
