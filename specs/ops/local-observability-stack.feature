Feature: Local observability stack for debugging
  As a developer (or an agent) debugging local development
  I want the app's and services' logs, traces, and metrics in one queryable place
  So that I can correlate what happened without hunting across scattered stdout

  Background:
    Given the local observability stack is running
    And local dev is pointed at the collector

  Scenario: The stack exposes a collector and Grafana
    When the stack starts
    Then an OTLP collector accepts logs, traces, and metrics
    And Grafana is reachable with Loki, Tempo, and Prometheus already connected

  Scenario: The TypeScript app sends all three signals
    When the app handles requests
    Then its traces appear in Tempo
    And its structured logs appear in Loki
    And its runtime metrics appear in Prometheus

  Scenario: The console stays quiet while the stack is up
    When the stack is running
    Then the app's console shows only warnings and errors
    And its info and debug logs are sent to the collector instead
    And each console line keeps only its trace and span id, not the full context

  Scenario: An error links straight to its trace
    When a request fails
    Then the error response carries the trace and span id
    And a Grafana link that opens the failing trace, clickable from the network inspector

  Scenario: Go services dual-export their own telemetry
    When a Go service produces telemetry
    Then its product traces still reach the LangWatch app
    And its own traces, logs, and metrics also reach the collector

  Scenario: Go behaviour is unchanged when the collector is not configured
    Given no debug collector is configured
    When a Go service starts
    Then it behaves exactly as it did before the stack existed

  Scenario: An agent reads the telemetry
    Given the agent has been granted read access to the local Grafana
    When the agent queries for recent logs, traces, or metrics
    Then it receives the data collected from local development

  Scenario: Tearing down the stack discards its data
    When the stack is stopped
    Then all collected telemetry is discarded
    And the developer's previous environment configuration can be restored
