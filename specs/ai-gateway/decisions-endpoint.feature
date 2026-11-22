Feature: Gateway Decisions endpoint, OpenAI Decisions API through a virtual key
  As a developer asking a model typed questions about an input
  I want the gateway to serve POST /v1/decisions with a virtual key
  So that decision calls get the same budgets, spend and tracing as /v1/embeddings
  And so pointing an OpenAI client's base URL at the gateway is all a caller changes

  # Bifrost has no typed Decisions request, so the body goes through its OpenAI
  # passthrough lane. The provider's base URL decides the region: an empty one
  # means api.openai.com, https://eu.api.openai.com (with or without /v1) means
  # the EU endpoint. Non-streaming only.

  Background:
    Given the gateway is running with a control plane
    And a virtual key "vk-lw-test" bound to a project with an OpenAI provider configured

  @unit
  Scenario: A decisions call is relayed and metered
    When the client POSTs /v1/decisions with model "openai/gpt-6-luna", an input and typed questions
    Then the provider receives the body at /v1/decisions with the resolved model "gpt-6-luna"
    And the provider receives the provider API key, never the virtual key
    And the response is 200 with the provider's answer bytes unchanged
    And the spend record carries the usage input_tokens and output_tokens the provider reported
    And cached input tokens the provider states apart are recorded as cache reads

  @unit
  Scenario: A decisions call attributes spend to its safety_identifier
    When the client POSTs /v1/decisions with "safety_identifier" set and no end-user header
    Then the spend record names that identifier as the end user
    And an X-LangWatch-End-User-Id header still wins over the body field

  @unit
  Scenario: The provider's base URL decides where a decisions call goes
    Given the OpenAI provider has a base URL, written with or without a trailing /v1
    When the client POSTs /v1/decisions
    Then the provider at that base URL receives the call at /v1/decisions
    And with no base URL the call goes to the stock OpenAI endpoint

  @unit
  Scenario: An exhausted budget blocks a decisions call before the provider
    Given the virtual key's budget is exhausted
    When the client POSTs /v1/decisions
    Then the response is 402 with error type "budget_exceeded"
    And the provider is never called

  @unit
  Scenario: A provider error on a decisions call keeps its status
    Given the provider answers /v1/decisions with 400 and an OpenAI error body
    When the client POSTs /v1/decisions
    Then the response is 400, never 200
    And the provider's error message reaches the caller

  @unit
  Scenario: A decisions call on a key without an OpenAI provider is refused
    Given the virtual key holds only an Anthropic provider
    When the client POSTs /v1/decisions
    Then the request is refused with an error naming "openai" as the provider the route needs
    And no provider is called

  @unit
  Scenario: A decisions call naming a model the key does not allow is refused
    Given the virtual key allows only "openai/gpt-5-mini"
    When the client POSTs /v1/decisions with model "openai/gpt-6-luna"
    Then the response is 400 with error type "model_not_allowed"
    And no provider is called

  @unit
  Scenario: A decisions call with no model is refused
    When the client POSTs /v1/decisions with no "model" field
    Then the response is 400 naming POST /v1/decisions and the missing "model" field

  @unit
  Scenario: A decisions span carries usage and cost but no input or answers
    When a decisions call completes
    Then the customer trace span carries the model, provider, token usage and cost
    And it carries neither the request input, the questions nor the answers
