Feature: LangWatch NoAI fake model provider (local dev)
  As a developer working on LangWatch without provider API keys,
  I want a built-in `langwatch_noai/*` provider that talks to a tiny local
  Go service speaking OpenAI's /v1/chat/completions and /v1/responses,
  so that I can run flows, evaluators, simulators, and tests without
  spending any external provider budget — and the rest of the platform
  treats it as a real OpenAI-compatible upstream end to end.

  Background:
    The provider is registered as `langwatch_noai` in the model registry
    with `devOnly: true`. The matching webserver lives at
    `services/noai/` (Go, default port 5577). The provider is hidden from
    project seeding and the model picker when NODE_ENV=production.

  @unit
  Scenario: provider is registered in the dev registry
    Given the model providers registry
    When the registry is enumerated
    Then "langwatch_noai" is present
    And its endpointKey is "LANGWATCH_NOAI_BASE_URL"
    And its devOnly flag is true

  @unit
  Scenario: provider is hidden from project seeding in production
    Given NODE_ENV is "production"
    When ModelProviderService seeds defaults for a new project
    Then the resulting providers do not include "langwatch_noai"

  @unit
  Scenario: provider is visible in development
    Given NODE_ENV is "development"
    When ModelProviderService seeds defaults for a new project
    Then the resulting providers include "langwatch_noai"

  @integration
  Scenario: echo-text returns the canned echo string
    Given the noai service is running on :5577
    When a POST is made to /v1/chat/completions with model "langwatch_noai/echo-text"
    And the last user message is "hello"
    Then the response choices[0].message.content equals 'Fake LLM Response to: "hello"'

  @integration
  Scenario: echo-audio includes a base64 audio/wav blob
    Given the noai service is running on :5577
    When a POST is made to /v1/chat/completions with model "langwatch_noai/echo-audio"
    Then choices[0].message.audio.format equals "wav"
    And choices[0].message.audio.data is a non-empty base64 string

  @integration
  Scenario Outline: judge-* returns a deterministic JSON verdict
    Given the noai service is running on :5577
    When a POST is made to /v1/chat/completions with model "<model>"
    Then choices[0].message.content parses as JSON
    And the parsed verdict has passed=<passed> and score=<score>

    Examples:
      | model                            | passed | score |
      | langwatch_noai/judge-text-pass   | true   | 1     |
      | langwatch_noai/judge-text-fail   | false  | 0     |
      | langwatch_noai/judge-audio-pass  | true   | 1     |
      | langwatch_noai/judge-audio-fail  | false  | 0     |

  @integration
  Scenario: user-simulation-text produces a follow-up user line
    Given the noai service is running on :5577
    When a POST is made to /v1/chat/completions with model "langwatch_noai/user-simulation-text"
    And the last user message is "what's your favourite colour?"
    Then choices[0].message.content contains 'Fake user follow-up to:'

  @integration
  Scenario: /v1/responses returns the new Responses-API shape
    Given the noai service is running on :5577
    When a POST is made to /v1/responses with model "langwatch_noai/echo-text" and input "hello"
    Then output_text equals 'Fake LLM Response to: "hello"'
    And output[0].content[0].type equals "output_text"

  @integration
  Scenario: /v1/responses with an audio model returns an output_audio part
    Given the noai service is running on :5577
    When a POST is made to /v1/responses with model "langwatch_noai/echo-audio"
    Then output[0].content contains an item with type "output_audio"
    And that item carries format "wav"

  @integration
  Scenario: stream=true on /v1/chat/completions emits SSE chunks ending with [DONE]
    Given the noai service is running on :5577
    When a POST with stream=true is made to /v1/chat/completions
    Then the response Content-Type is "text/event-stream"
    And the stream contains at least one chat.completion.chunk data line
    And the stream ends with `data: [DONE]`

  @integration
  Scenario: stream=true on /v1/responses emits typed events ending with response.completed
    Given the noai service is running on :5577
    When a POST with stream=true is made to /v1/responses
    Then the stream contains a "response.created" event
    And the stream contains a "response.output_text.delta" event
    And the stream contains a "response.completed" event
