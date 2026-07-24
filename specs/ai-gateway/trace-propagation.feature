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
    And the span has attribute "gen_ai.usage.input_tokens" set to the provider-reported count
    And the span has attribute "gen_ai.usage.output_tokens" set to the provider-reported count
    And the span has attribute "langwatch.status" = "success"

  Scenario: cache-token breakdown on cache-hit responses (iters 40+41)
    Given the request resolves to Anthropic and the request carries cache_control markers
    When the provider returns a response reporting cache_read_input_tokens=1500 + cache_creation_input_tokens=0
    Then the span has attribute "gen_ai.usage.cache_read.input_tokens" = 1500
    And the span has attribute "gen_ai.usage.cache_creation.input_tokens" = 0
    And the LangWatch ingest pipeline maps these onto the trace's cache_read_input_tokens / cache_creation_input_tokens fields (otel.traces.ts:951-967 + span.mapper.ts:284-288)
    And the trace UI renders the cached-vs-fresh token split

  Scenario: OpenAI cache-hit reports via cached_tokens field
    Given the request resolves to OpenAI gpt-5-mini
    When the provider returns a response with usage.prompt_tokens_details.cached_tokens=800
    Then Bifrost normalises that to PromptTokensDetails.CachedReadTokens=800
    And the span has attribute "gen_ai.usage.cache_read.input_tokens" = 800
    And cache_creation_input_tokens is unset (OpenAI has no write-to-cache dimension)

  Scenario: responses with no cache usage have cache-token attrs at zero or unset
    Given a response with no cache markers
    When the span is finalised
    Then "gen_ai.usage.cache_read.input_tokens" is 0 OR unset
    And "gen_ai.usage.cache_creation.input_tokens" is 0 OR unset
    And the span is still valid (never fails to export due to missing cache attrs)

  Scenario: messages API (/v1/messages) also emits cache-token attrs (iter 41 bonus fix)
    Given a request to /v1/messages that hits Anthropic cache
    When the gateway records the span
    Then the span has attribute "gen_ai.usage.cache_read.input_tokens" set to the Anthropic-reported count
    And the same attribute naming contract holds as on /v1/chat/completions (no divergence between the two endpoints)

  Scenario: per-tenant attribution happens at the ingest layer, not at export
    Given the gateway has a SINGLE OTLP endpoint configured (GATEWAY_OTEL_DEFAULT_ENDPOINT)
    When the gateway finishes 3 spans tagged "langwatch.project_id"=proj_01 and 2 spans tagged proj_02
    Then all 5 spans are exported to the SAME endpoint
    And LangWatch ingest reads "langwatch.project_id" on each span and files the trace under the owning project
    And tenant A cannot see tenant B's traces in the LangWatch UI (project-scoped view enforces isolation)
    # Note: pre-iter-25 the gateway had per-project OTLP routing via a customer-facing
    # observability_endpoint override. That surface was removed since we sell observability
    # and the attribution-at-ingest architecture is simpler + equally tenant-isolated.

  Scenario: spans without a project_id fall back to the default LangWatch workspace
    Given the gateway has GATEWAY_OTEL_DEFAULT_ENDPOINT configured
    When the gateway finishes a span that has no "langwatch.project_id" attribute
    Then the span is exported to the default endpoint
    And ingest logs a warning (missing project_id on a production span is anomalous)

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
