Feature: Python SDK OpenAI tracer survives a completion with no choices
  As a Python SDK user whose OpenAI calls are autotracked
  I want the tracer to tolerate a response that carries no choices
  So that tracing never turns the provider's answer into a crash in my code

  Background:
    The AI Gateway keeps a slow non-streaming call warm with heartbeat bytes,
    which commits status 200 before the provider answers. When the provider
    then fails, the error envelope arrives under that 200 with the
    X-LangWatch-Heartbeat-Active header (specs/ai-gateway/
    non-streaming-time-to-first-byte.feature). The openai client builds a
    ChatCompletion from any 2xx body, so the tracer receives one whose
    choices is None. The tracer records no output for it and hands the
    response back to the caller exactly as the client built it.

  @unit
  Scenario: a chat completion with no choices returns the caller's response untouched
    Given an OpenAI client autotracked inside a LangWatch trace
    And the endpoint answers 200 with a heartbeat-committed error envelope
    When the caller creates a chat completion
    Then the caller receives the response the openai client built, error envelope included
    And the LLM span records no output

  @unit
  Scenario: a legacy completion with no choices records no output
    Given a text completion response whose choices is None
    When the completion tracer handles it
    Then the span is ended with no outputs

  @unit
  Scenario: a streamed chunk with no choices is skipped
    Given a chat completion stream with a chunk whose choices is None
    When the tracer accumulates the deltas
    Then the content of the other chunks is still recorded
