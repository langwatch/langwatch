Feature: The excludeHttpRequests preset drops HTTP instrumentation spans only
  As a service owner shipping the LangWatch observability Go SDK
  I want the default span filter to recognise real HTTP instrumentation spans
  So that my own spans named after everyday verbs are never silently dropped

  # The preset exists to stop the SDK's own exporter traffic from feeding back
  # on itself. It used to match any span whose name began with an HTTP verb
  # word followed by a word boundary, case-insensitively, so ordinary user
  # spans like "post-publish-smoke" vanished before export with no error and
  # no signal. A span an SDK user creates is data; only spans the HTTP
  # instrumentations emit are filter noise.
  #
  # This mirrors the TypeScript SDK preset (see
  # specs/typescript-sdk/observability-http-span-filter.feature) so both SDKs
  # identify HTTP spans the same way: by scope first, then by the
  # semantic-convention method attribute, and only then by the
  # uppercase-verb name shape.
  #
  # Implementation:
  #   sdks/go/filter.go

  Background:
    Given the observability Go SDK is set up with its default filters

  @unit
  Scenario: A user span named after a hyphenated verb word reaches the exporter
    When the application records a span named "post-process"
    Then the excludeHttpRequests preset keeps it
    And the same holds for "get-user-profile", "delete-account", "put-record" and "patch-config"

  @unit
  Scenario: An HTTP instrumentation span is still excluded
    When a span carries the "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp" instrumentation scope
    Or it carries the "http.request.method" attribute
    Then the excludeHttpRequests preset drops it

  @unit
  Scenario: The name fallback matches only the uppercase verb shape OpenTelemetry emits
    When a span from an unknown scope is named "POST" or "POST /v1/traces"
    Then the excludeHttpRequests preset drops it by name
    But a span named "post /v1/traces" or "GETAWAY" or "postgres-query" stays
