Feature: Custom (OpenAI-compatible) provider routing to customer endpoints
  Customers who self-host OpenAI-compatible model servers (vLLM, LiteLLM
  proxy, ...) configure them in LangWatch as the "Custom (OpenAI-compatible)"
  provider with a base URL and an optional API key. Every dispatch path,
  virtual-key gateway traffic and in-app features (playground, workflows,
  evaluations), must send requests to the customer's endpoint, never to
  api.openai.com.

  The same story applies to self-hosted servers that speak the Anthropic
  Messages API natively (vLLM >= 0.24, Claude-compatible proxies): an
  "anthropic" provider with a base URL routes /v1/messages traffic to the
  customer's endpoint instead of api.anthropic.com, keeping clients like
  Claude Code on LangWatch virtual keys, budgets, and tracing.

  Background:
    Given a project with a "custom" model provider configured
    And its CUSTOM_BASE_URL points at a self-hosted OpenAI-compatible server
    And its CUSTOM_API_KEY is empty because the server is unauthenticated

  Scenario: Virtual-key chat completion reaches the customer's endpoint
    Given a virtual key whose provider slot is the custom provider
    When a chat completion for "custom/<model>" is sent through the gateway
    Then the upstream request is sent to the configured base URL
    And the request body is OpenAI chat-completions shape with the bare model id

  Scenario: Playground chat completion reaches the customer's endpoint
    When the playground dispatches a chat completion using the custom provider
    Then the upstream request is sent to the configured base URL
    And no request is sent to api.openai.com

  Scenario: Empty API key is accepted for unauthenticated servers
    When a chat completion is dispatched through the custom provider
    Then the dispatch does not fail credential validation
    And the upstream request carries no bearer token

  Scenario: OpenAI provider with a base URL override routes to that URL
    Given an "openai" model provider with OPENAI_BASE_URL set to a proxy endpoint
    When a chat completion is dispatched through it
    Then the upstream request is sent to the proxy endpoint instead of api.openai.com

  Scenario: OpenAI provider without a base URL keeps default routing
    Given an "openai" model provider with only OPENAI_API_KEY set
    When a chat completion is dispatched through it
    Then the upstream request is sent to api.openai.com

  Scenario: Streaming chat completion still reports token usage
    Given a virtual key whose provider slot is the custom provider
    When a streaming chat completion for "custom/<model>" is sent through the gateway
    Then the gateway asks the endpoint for a final usage chunk
    And the streamed response reports non-zero prompt and completion tokens

  Scenario: Provider-specific sampling params reach the endpoint unchanged
    Given a virtual key whose provider slot is the custom provider
    When a chat completion carrying vLLM-specific params (top_k, chat_template_kwargs, guided_json) is sent through the gateway
    Then the upstream request preserves every param byte-for-byte
    And no provider-specific param is dropped on the way to the endpoint

  Scenario: Anthropic provider with a base URL routes /v1/messages to the customer's endpoint
    Given an "anthropic" model provider with a base URL pointing at a self-hosted Anthropic-compatible server
    When a /v1/messages request is dispatched through it
    Then the upstream request is sent to the configured base URL instead of api.anthropic.com
    And the request body is forwarded in Anthropic Messages shape unchanged

  Scenario: Streaming /v1/messages against a custom endpoint keeps native event frames
    Given an "anthropic" model provider with a base URL pointing at a self-hosted Anthropic-compatible server
    When a streaming /v1/messages request is dispatched through it
    Then the server's native Anthropic SSE events reach the client unchanged
    And no OpenAI-shape chunk is emitted

  Scenario: Anthropic provider without a base URL keeps default routing
    Given an "anthropic" model provider with only an API key configured
    When a /v1/messages request is dispatched through it
    Then the upstream request is sent to api.anthropic.com

  Scenario: Two Anthropic providers with different base URLs stay isolated
    Given two "anthropic" model providers configured with different base URLs
    When a /v1/messages request is dispatched through each
    Then each upstream request reaches its own configured endpoint
    And neither request leaks to the other endpoint

  Scenario: Empty API key is accepted for unauthenticated Anthropic-compatible servers
    Given an "anthropic" model provider with a base URL and no API key
    When a /v1/messages request is dispatched through it
    Then the dispatch does not fail credential validation
    And the upstream request carries no x-api-key header

  Scenario: An endpoint that fell out of recent use still works when dispatched to again
    Given an "anthropic" model provider with a base URL that has not been dispatched to recently
    And many other Anthropic-compatible endpoints have been dispatched to since
    When a /v1/messages request is dispatched through it again
    Then the upstream request reaches its configured endpoint
    And endpoints outside the recently used set hold no gateway resources in the meantime
