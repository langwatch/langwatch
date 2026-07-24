Feature: HTTP agent body templates always render valid JSON
  As a user running scenarios against an external HTTP agent (n8n, custom webhook)
  I want scenario-provided values interpolated into the body template to be JSON-safe
  So that multi-line or quote-containing conversation turns don't produce a body
  the upstream rejects with "Failed to parse request body".

  Background: tracking a customer report. A scenario pointed at an n8n webhook
  failed with `HTTP 422: Unprocessable Entity` and the upstream hint
  "Bad control character in string literal in JSON at position 90". The body
  template `{"chatInput": "{{ input }}"}` interpolated a user message that
  contained a raw newline straight into a JSON string literal, so the bytes
  LangWatch sent were not valid JSON. The body template engine must escape
  scalar string interpolations the way the URL engine already URL-encodes its
  interpolations.

  @unit
  Scenario: A user message with a newline is escaped inside a JSON string literal
    Given an HTTP agent with body template '{"chatInput": "{{ input }}"}'
    And the last user message content is "line one\nline two"
    When the adapter builds the request body
    Then the rendered body parses as JSON
    And the parsed "chatInput" equals "line one\nline two"

  @unit
  Scenario: A user message containing a double quote is escaped
    Given an HTTP agent with body template '{"chatInput": "{{ input }}"}'
    And the last user message content is 'she said "hi"'
    When the adapter builds the request body
    Then the rendered body parses as JSON
    And the parsed "chatInput" equals 'she said "hi"'

  @unit
  Scenario: A user message containing a backslash is escaped
    Given an HTTP agent with body template '{"chatInput": "{{ input }}"}'
    And the last user message content is the literal path "C:\\temp\\new"
    When the adapter builds the request body
    Then the rendered body parses as JSON
    And the parsed "chatInput" equals the literal path "C:\\temp\\new"

  @unit
  Scenario: Pre-serialized conversation history is still injected as raw JSON
    Given an HTTP agent with body template '{"messages": {{messages}}}'
    And the conversation has messages with multi-line content
    When the adapter builds the request body
    Then the rendered body parses as JSON
    And the parsed "messages" is the conversation array, not a JSON string

  @unit
  Scenario: The default body template survives an awkward conversation
    Given an HTTP agent using the default template with "threadId" and "messages"
    And a conversation whose turns contain newlines and quotes
    When the adapter builds the request body
    Then the rendered body parses as JSON

  @unit
  Scenario: A user can opt a scalar out of escaping with the raw filter
    Given an HTTP agent with body template '{"raw": {{ input | raw }}}'
    And the last user message content is the literal JSON object '{"a":1}'
    When the adapter builds the request body
    Then the parsed "raw" equals the object {"a": 1}

  @unit
  Scenario: Mapped scenario fields routed to a string slot are escaped
    Given an HTTP agent with body template '{"q": "{{query}}"}'
    And "query" is mapped to the scenario input
    And the scenario input contains a newline
    When the adapter builds the request body
    Then the rendered body parses as JSON

  @integration
  Scenario: Adapter posts a parseable body to a real HTTP endpoint
    Given a local echo server that JSON-parses the request body and 422s on failure
    And an HTTP agent with body template '{"chatInput": "{{ input }}"}'
    And a user message that contains a newline and a double quote
    When the adapter calls the endpoint
    Then the echo server parses the body successfully
    And the adapter does not raise an HTTP 422
