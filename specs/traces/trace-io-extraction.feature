Feature: Trace primary input/output extraction
  As a LangWatch user
  I want each trace to display a concise primary input and output
  So that I can scan a trace list and understand what happened without opening individual spans

  # =========================================================================
  # What this covers
  # =========================================================================
  #
  # When the ingestion pipeline processes spans, it derives a single primary
  # "input" and "output" to show at the trace level (list view + trace drawer
  # header). The logic lives in TraceIOExtractionService.
  #
  # Priority order for a given span, highest first:
  #   1. gen_ai.input.messages / gen_ai.output.messages (OTel GenAI semconv)
  #   2. langwatch.input / langwatch.output (LangWatch canonical attribute)
  #
  # For langwatch.input/output, the value may be:
  #   - a plain string  → used directly
  #   - a JSON object   → searched for a recognized "text" key
  #   - a JSON-encoded string (stringified object) → parsed, then searched
  #
  # The last case is common in practice: OTel serializes complex attribute
  # values to strings on the wire, so `langwatch.input` frequently arrives as
  # a JSON string even when the SDK set it as a dict/object.
  #
  # =========================================================================
  # Recognized "text" keys (COMMON_TEXT_KEYS)
  # =========================================================================
  #
  # When the value (or its parsed form) is an object and not message-shaped,
  # the first key found from this ordered list wins:
  #
  #   text, input, question, user_query, query, message, input_value,
  #   output, answer, content, prompt
  #
  # Nested wrappers are also supported:
  #   - { inputs: { input: "..." } }   (LangChain)
  #   - { outputs: { output: "..." } } (LangChain)
  #
  # Message-shaped objects (with role + content/parts/text/value) take
  # precedence over plain-JSON key lookup.

  Background:
    Given a trace with a single root span

  Scenario: langwatch.input is a plain string
    Given the span has langwatch.input = "hello world"
    When the service extracts the primary input
    Then the primary input text is "hello world"

  Scenario: langwatch.input is a JSON object with the "message" key
    Given the span has langwatch.input = { "message": "what's for dinner?", "thread_id": "abc" }
    When the service extracts the primary input
    Then the primary input text is "what's for dinner?"

  Scenario: langwatch.input is a JSON-encoded string with "message" + "history"
    # Regression: OTel frequently delivers complex values as stringified JSON.
    # The heuristic must parse the string before searching for text keys,
    # otherwise the entire JSON blob is shown verbatim on the trace list.
    Given the span has langwatch.input set to the JSON-string '{"message":"I think you should have some options","history":[{"role":"user","content":"decide my dinner tonight"}],"thread_id":"c9d826f2"}'
    When the service extracts the primary input
    Then the primary input text is "I think you should have some options"

  Scenario: langwatch.input is a JSON object with a LangChain-style inputs wrapper
    Given the span has langwatch.input = { "inputs": { "input": "nested hello" } }
    When the service extracts the primary input
    Then the primary input text is "nested hello"

  Scenario: langwatch.input is a plain non-JSON string that happens to contain braces
    # The JSON.parse attempt must fail gracefully and return the string as-is.
    Given the span has langwatch.input = "{not really json"
    When the service extracts the primary input
    Then the primary input text is "{not really json"

  Scenario: langwatch.input is an object with no recognized text key
    Given the span has langwatch.input = { "foo": "bar", "baz": 123 }
    When the service extracts the primary input
    Then no primary input is extracted

  Scenario: gen_ai.input.messages takes priority over langwatch.input
    Given the span has gen_ai.input.messages = [{ "role": "user", "content": "from gen_ai" }]
    And the span has langwatch.input = "from langwatch"
    When the service extracts the primary input
    Then the primary input text is "from gen_ai"
