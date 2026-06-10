Feature: LangWatch NoAI fake model provider (local dev)
  As a developer working on LangWatch without provider API keys,
  I want a built-in fake provider that speaks OpenAI's
  /v1/chat/completions and /v1/responses APIs,
  so that I can run flows, evaluators, simulators, and tests without
  spending any external provider budget.

  # This file owns only the noai contract: the fake model behaviours and
  # how the fake provider is exposed (or hidden) per environment.
  # Registry semantics live in
  # specs/model-providers/model-resolver-and-registry.feature; the
  # providers settings UI lives in
  # specs/model-providers/provider-list.feature.

  Background:
    Given the noai service is running on its default port 5977

  @integration
  Scenario: /v1/models lists the eight fake models
    When a GET is made to /v1/models
    Then the listing contains exactly 8 models
    And it includes echo-text, echo-audio, the four judge models,
      user-simulation-text, and user-simulation-audio

  @integration
  Scenario: echo-text returns the canned echo string with deterministic usage
    When a chat completion is requested for model "echo-text"
    And the last user message is "hello"
    Then the assistant reply equals 'Fake LLM Response to: "hello"'
    And the response reports small, deterministic token usage

  @integration
  Scenario: echo-audio includes a base64 audio/wav blob
    When a chat completion is requested for model "echo-audio"
    Then the assistant message carries audio with format "wav"
    And the audio data is a non-empty base64 string

  @integration
  Scenario Outline: judge-* returns a deterministic JSON verdict
    When a chat completion is requested for model "<model>"
    Then the assistant reply parses as JSON
    And the parsed verdict has passed=<passed> and score=<score>

    Examples:
      | model            | passed | score |
      | judge-text-pass  | true   | 1     |
      | judge-text-fail  | false  | 0     |
      | judge-audio-pass | true   | 1     |
      | judge-audio-fail | false  | 0     |

  @integration
  Scenario: user-simulation-text produces a follow-up user line
    When a chat completion is requested for model "user-simulation-text"
    Then the assistant reply contains 'Fake user follow-up to:'

  @integration
  Scenario: user-simulation-audio returns the silent-wav stub
    When a chat completion is requested for model "user-simulation-audio"
    Then the assistant message carries the silent stub audio with format "wav"

  @integration
  Scenario: request without a model is rejected with a 400 error
    When a chat completion is requested with no model
    Then the response status is 400
    And the body is an OpenAI-style error

  @integration
  Scenario: unknown model is rejected with a 404 model_not_found error
    When a chat completion is requested for model "does-not-exist"
    Then the response status is 404
    And the body is an OpenAI-style error with code "model_not_found"

  @integration
  Scenario: /v1/responses returns the Responses-API shape
    When a response is requested for model "echo-text" with input "hello"
    Then output_text equals 'Fake LLM Response to: "hello"'
    And the first output item is an output_text part

  @integration
  Scenario: streaming chat completions emit SSE chunks ending with [DONE]
    When a streaming chat completion is requested
    Then the response is a text/event-stream
    And the stream contains at least one chat.completion.chunk data line
    And the stream ends with `data: [DONE]`

  @integration
  Scenario: streaming responses emit typed events ending with response.completed
    When a streaming response is requested
    Then the stream contains "response.created", "response.output_text.delta",
      and "response.completed" events

  @unit
  Scenario: fake provider is hidden in production
    Given the platform is running in production
    Then new projects are not seeded with the fake provider
    And the fake provider does not appear in the model picker

  @unit
  Scenario: gateway does not offer the fake provider by default
    Given the operator has not explicitly enabled the fake provider
    Then the gateway does not route traffic to it
