Feature: Go SDK OpenAI middleware surfaces a heartbeat-committed error envelope
  As a Go SDK user whose OpenAI calls are traced by the middleware
  I want a provider failure delivered under a 200 to be recorded as an error
  So that tracing shows the failure without changing what my code receives

  Background:
    The AI Gateway keeps a slow non-streaming call warm with heartbeat bytes,
    which commits status 200 before the provider answers. When the provider
    then fails, the error envelope arrives under that 200 (specs/ai-gateway/
    non-streaming-time-to-first-byte.feature). The middleware marks the span
    as an error with the envelope's message and type and hands the body back
    to the caller untouched. It never turns the call into an error.

  @unit
  Scenario: A 200 carrying the error envelope marks the span as an error
    Given a Go OpenAI client traced by the LangWatch middleware
    And the endpoint answers 200 with a heartbeat-committed error envelope
    When the caller creates a chat completion
    Then the caller receives the body untouched and no error
    And the span status is error with the envelope's message and type

  @unit
  Scenario: An envelope without a message falls back to a generic one
    Given a Go OpenAI client traced by the LangWatch middleware
    And the endpoint answers 200 with an empty error envelope
    When the caller creates a chat completion
    Then the span status is error with a generic message and no error type

  @unit
  Scenario: A chat completion object carrying the envelope is an error too
    Given a Go OpenAI client traced by the LangWatch middleware
    And the endpoint answers 200 with a chat completion that carries an error
    When the caller creates a chat completion
    Then the span status is error

  @unit
  Scenario: A 200 with neither choices nor an error is not an error
    Given a Go OpenAI client traced by the LangWatch middleware
    And the endpoint answers 200 with a completion that has neither choices nor an error
    When the caller creates a chat completion
    Then the span status is ok

  @unit
  Scenario: A completion with choices and a null error is not an error
    Given a Go OpenAI client traced by the LangWatch middleware
    And the endpoint answers 200 with a completion that has choices and a null error
    When the caller creates a chat completion
    Then the span status is ok
