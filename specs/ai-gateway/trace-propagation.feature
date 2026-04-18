Feature: Gateway trace propagation (W3C + LangWatch)
  As an SDK/CLI user whose app already started a trace
  I want the gateway to emit its span as a CHILD of my incoming trace
  So that I can see full token usage + guardrail + budget events nested
  under my existing app span — and never double-count cost.

  Background:
    Given the gateway is running
    And the OTel per-tenant router has a default endpoint configured

  Scenario: incoming W3C traceparent becomes the parent of the gateway span
    When the client calls POST /v1/chat/completions with header:
      | name        | value                                                   |
      | traceparent | 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01 |
    Then the gateway span has trace_id "4bf92f3577b34da6a3ce929d0e0e4736"
    And the gateway span parent_span_id is "00f067aa0ba902b7"
    And the response header "traceparent" is present
    And the response header "X-LangWatch-Trace-Id" is "4bf92f3577b34da6a3ce929d0e0e4736"
    And the response header "X-LangWatch-Span-Id" is a valid 16-hex span id

  Scenario: no traceparent header starts a fresh trace
    When the client calls POST /v1/chat/completions with no traceparent header
    Then the gateway span has a fresh 32-hex trace_id
    And the gateway span has no parent span context
    And the response header "X-LangWatch-Trace-Id" contains that trace_id
    And the response header "traceparent" is set for downstream correlation

  Scenario: the gateway span carries every LangWatch identity attribute
    Given the request is authenticated with a valid virtual key
    When the gateway completes the request
    Then the span has attribute "langwatch.virtual_key_id"
    And the span has attribute "langwatch.project_id"
    And the span has attribute "langwatch.team_id"
    And the span has attribute "langwatch.organization_id"
    And the span has attribute "langwatch.principal_id"
    And the span has attribute "langwatch.vk_display_prefix"
    And the span has attribute "langwatch.gateway_request_id"

  Scenario: the gateway span records model + provider + usage on success
    Given the request resolves to provider "openai" model "gpt-5-mini"
    When the provider returns a successful response
    Then the span has attribute "langwatch.model" = "gpt-5-mini"
    And the span has attribute "langwatch.provider" = "openai"
    And the span has attribute "langwatch.usage.input_tokens" set to the provider-reported count
    And the span has attribute "langwatch.usage.output_tokens" set to the provider-reported count
    And the span has attribute "langwatch.status" = "success"

  Scenario: the router sends spans to a per-project OTLP endpoint
    Given the gateway has OTLP endpoints configured per project:
      | project_id | endpoint                                |
      | proj_01    | https://otlp-a.example/v1/traces         |
      | proj_02    | https://otlp-b.example/v1/traces         |
    When the gateway finishes 3 spans tagged proj_01 and 2 spans tagged proj_02
    Then 3 spans are exported to "https://otlp-a.example/v1/traces"
    And 2 spans are exported to "https://otlp-b.example/v1/traces"

  Scenario: spans without a project_id fall back to the default endpoint
    Given the gateway has a default OTLP endpoint configured
    When the gateway finishes a span that has no "langwatch.project_id" attribute
    Then the span is exported to the default endpoint

  Scenario: streaming requests still emit a single gateway span
    When the client calls POST /v1/chat/completions with "stream": true
    And the gateway forwards SSE chunks byte-for-byte
    Then exactly one gateway span is recorded for the request
    And the span ends after the terminal chunk is flushed
    And the span has attribute "langwatch.streaming" = true

  Scenario: unauthenticated requests still get a span and a traceparent
    # So probe-abuse + misconfigured CLIs are observable and the client
    # can stitch error responses to its trace.
    When the client calls POST /v1/chat/completions with no Authorization header
    Then the response is 401
    And the response header "X-LangWatch-Trace-Id" is set
    And the span has attribute "http.response.status_code" = 401
