Feature: OTLP endpoint path canonicalisation

  An OpenTelemetry exporter builds its own URL. Given a base endpoint it appends
  `/v1/traces`, `/v1/logs` or `/v1/metrics` itself, so a customer who pastes our
  signal-specific URL into the base setting ends up posting to
  `/api/otel/v1/traces/v1/logs`. A customer who pastes the collector URL ends up
  posting to `/api/collector/api/otel/v1/traces`. Both are seen in production.

  The customer cannot see any of this. Exporters do not surface a 404 anywhere a
  human looks, so the telemetry simply never arrives and the account looks idle.
  Worse, a base endpoint of the site root posts to `/v1/traces`, which the web
  server answered with the application's HTML shell and a 200 - the exporter
  reads that as success and discards the batch.

  So the receiver accepts these paths and serves them from the canonical
  handler. It does not redirect: an OTLP exporter is not a browser, and the two
  largest client stacks will not follow one. The Java exporter's HTTP client
  refuses to replay a POST across 307 and 308, and the Node exporter issues its
  request without any redirect handling at all, so a redirect would repair some
  of the fleet and go on silently dropping the rest.

  The signal is taken from the suffix the exporter appended, never from the base
  it was given, because the suffix is the part that describes the payload.

  Only paths that a known misconfiguration produces are accepted. Everything
  else keeps answering exactly as it does today.

  Background:
    Given a project with a valid ingestion key

  Rule: A misconfigured exporter path still delivers its telemetry

    @unit
    Scenario: An endpoint that already named a signal
      Given an exporter configured with our traces URL as its base endpoint
      When it posts log records to the path that base produces
      Then the request is served as log ingestion

    @unit
    Scenario: An endpoint that named the collector
      Given an exporter configured with our collector URL as its base endpoint
      When it posts spans to the path that base produces
      Then the request is served as trace ingestion

    @unit
    Scenario: An endpoint that named the site root
      Given an exporter configured with our site root as its base endpoint
      When it posts spans to the path that base produces
      Then the request is served as trace ingestion
      And the response is never the application's web page

    @unit
    Scenario: An endpoint with a stray trailing slash
      When an exporter posts spans to the canonical path with a trailing slash
      Then the request is served as trace ingestion

  Rule: The appended suffix decides the signal, not the base endpoint

    @unit
    Scenario: A metrics suffix under a traces base is metric ingestion
      When an exporter posts metrics to a traces base with a metrics suffix
      Then the request is served as metric ingestion
      And it is not served as trace ingestion

  Rule: Correcting the path changes nothing else about the request

    @unit
    Scenario: A corrected path still needs a valid key
      Given an exporter with no ingestion key
      When it posts to a misconfigured path
      Then the response refuses the request for want of credentials

    @unit
    Scenario: A corrected path answers like the canonical one
      When an exporter posts spans to a misconfigured path
      Then the response is the ordinary ingestion response
      And the response does not ask the client to send the batch elsewhere

  Rule: Only known misconfigurations are accepted

    @unit
    Scenario: An unrelated path that happens to end in a signal name
      When a request arrives on an unrelated path ending in a signal name
      Then the path is not treated as ingestion

    @unit
    Scenario: A path naming something other than a signal
      When a request arrives on a misconfigured base with an unknown suffix
      Then the path is not treated as ingestion

  Rule: A corrected path is recorded so the customer can be told

    @unit
    Scenario: The correction names the path the exporter used
      When an exporter posts spans to a misconfigured path
      Then the platform records the path the exporter used
      And it records the canonical path the request was served from

    @unit
    Scenario: A caller cannot claim its path was corrected
      When a request arrives on the canonical path claiming a corrected origin
      Then the claim is discarded
