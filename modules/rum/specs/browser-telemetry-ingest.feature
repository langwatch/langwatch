Feature: The platform's own browser telemetry reaches its collector through the app

  The LangWatch app's browser tracing exports OTLP/JSON to `POST /api/rum/v1/traces`
  on the app's own origin, and the `rum` module forwards it to the platform's
  collector, which stays off the internet. This is the platform describing
  itself, not customer traces (ADR-058).

  The door is public because a browser has no credential to present, so every
  report is untrusted: its size, its span count, its rate and the identity it
  claims are all bounded here before anything reaches the collector.

  Rule: rum owns its collector; the shared OTLP variables are a deprecated fallback

    The collector used to be named by `OTEL_EXPORTER_OTLP_ENDPOINT` and
    `OTEL_EXPORTER_OTLP_HEADERS`, which also configure the server's own
    telemetry and stay owned by it. rum now owns `RUM_COLLECTOR_ENDPOINT` and
    `RUM_COLLECTOR_HEADERS`, and falls back to the old pair so no deployment
    goes dark on upgrade.

    @integration
    Scenario: rum's own collector variables win over the deprecated ones
      Given a deployment that sets both RUM_COLLECTOR_* and OTEL_EXPORTER_OTLP_*
      When the browser reports telemetry
      Then the report is forwarded to the RUM_COLLECTOR_ENDPOINT collector with RUM_COLLECTOR_HEADERS
      And no deprecation is logged

    @integration
    Scenario: The deprecated OTLP variables still work and warn once at boot
      Given a deployment that sets only OTEL_EXPORTER_OTLP_*
      When the browser reports telemetry twice
      Then both reports are forwarded to the OTEL_EXPORTER_OTLP_ENDPOINT collector with its headers
      And exactly one warning names the deprecated variables and the ones to set instead

    @integration
    Scenario: A report to a deployment with no collector is refused as not configured
      Given a deployment that names no collector in either pair of variables
      When the browser reports telemetry
      Then the report is refused with "rum_ingest_disabled"

  Rule: An accepted report reaches the collector as the browser app

    @integration
    Scenario: An accepted report is forwarded with the collector's headers
      Given a deployment whose collector expects a bearer token
      When the browser reports telemetry
      Then the door answers 202
      And the collector receives the report at its traces address with the configured headers

    @unit
    Scenario: A report claiming to be another service reaches the collector as the browser app
      When a report carries a second "service.name" naming another service
      Then the collector receives exactly one "service.name", the browser app's

    @unit
    Scenario: A report cannot set its own origin marker
      When a report marks itself as customer data
      Then the collector receives it marked as platform-internal

    @unit
    Scenario: A collector outage is not surfaced to the browser
      Given the collector cannot be reached
      When the browser reports telemetry
      Then the report is accepted
      And the dropped forward is logged for operators

  Rule: The door bounds what an untrusted report may cost

    @integration
    Scenario: A report over the byte cap is refused before it is read whole
      When the browser reports a body larger than the byte cap
      Then the report is refused with "rum_payload_too_large"
      And nothing reaches the collector

    @unit
    Scenario: A small report carrying too many spans is refused
      When a report under the byte cap carries more spans than the span cap
      Then the report is refused with "rum_payload_too_large"
      And nothing reaches the collector

    @unit
    Scenario: A report that is not a walkable OTLP export is refused as malformed
      When a report is not JSON, has no spans, or nests a field the door walks in the wrong shape
      Then the report is refused with "rum_payload_invalid"
      And nothing reaches the collector

    @unit
    Scenario: One caller flooding the door is throttled at its own budget
      When one claimed session reports more than its per-minute budget
      Then exactly its budget is accepted and every further report is refused with "rum_rate_limited"

    @unit
    Scenario: A flood rotating its claimed identity is bounded by the door's shared budget
      When reports under a new claimed identity each exceed the door's shared per-minute budget
      Then further reports are refused with "rum_rate_limited" whatever identity they claim

    @unit
    Scenario: A refused flood mints no bucket named by the caller
      Given the door's shared budget is spent
      When a report arrives under an identity never seen before
      Then it is refused without opening a bucket for that identity

    @unit
    Scenario: A caller with no session is named by the nearest proxy's address
      When a report carries no session and a forwarded-for chain
      Then it is counted against the last address in the chain

  Rule: rum owns the browser tracing switch it hands the page

    `RUM_ENABLED` and `RUM_SAMPLE_RATIO` are rum's config, and rum projects
    its slice of the page's browser config: tracing is on only when switched
    on AND a collector would receive what the browser sends.

    @unit
    Scenario: Browser tracing stays off while the switch is off
      Given a deployment that names a collector but does not set RUM_ENABLED to "true"
      When rum projects its browser config
      Then browser tracing is disabled

    @unit
    Scenario: Browser tracing is on with the sample ratio when switched on and a collector is configured
      Given RUM_ENABLED is "true" and RUM_SAMPLE_RATIO is "0.25"
      And RUM_COLLECTOR_ENDPOINT or the deprecated OTEL_EXPORTER_OTLP_ENDPOINT names a collector
      When rum projects its browser config
      Then browser tracing is enabled with a sample ratio of 0.25

    @unit
    Scenario: Browser tracing stays off when switched on without a collector
      Given RUM_ENABLED is "true" and neither collector variable is set
      When rum projects its browser config
      Then browser tracing is disabled
