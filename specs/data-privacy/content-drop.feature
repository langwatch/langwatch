Feature: Dropping trace content at ingestion
  As an organization with a strict data policy
  I want chosen categories of trace content to be dropped before they are
  stored, for every trace regardless of how it reached LangWatch
  So that sensitive prompts and responses never land in storage at all

  # "Drop" strips a content category (input, output, system instructions, or
  # tool calls) before the span is written, so it is never stored and cannot be
  # recovered. Unlike hiding (which stores the data and gates who can read it),
  # dropping is irreversible and applies to new data only. Crucially it applies
  # to ALL ingestion paths - the OpenTelemetry endpoint, the REST collector, the
  # gateway, ingestion keys, and coding-agent logs - not just gateway traffic.
  # Observability metadata (tokens, cost, model, latency, span shape, names,
  # timestamps, status) is always kept, whatever is dropped.

  Background:
    Given an organization "acme" with a project "web-app"

  @integration
  Scenario: Dropped input never reaches storage from the OpenTelemetry endpoint
    Given a rule on "web-app" that drops trace input
    When a trace is ingested through the OpenTelemetry endpoint with input and output
    Then the stored trace has no input
    And the stored trace keeps its output

  @integration
  Scenario: Dropping applies to traces from the REST collector too
    Given a rule on "web-app" that drops trace input
    When a trace is ingested through the REST collector with input and output
    Then the stored trace has no input

  @integration
  Scenario: Dropping applies to gateway traffic
    Given a rule on "web-app" that drops trace input and output
    When a gateway trace is recorded for "web-app"
    Then the stored trace has no input and no output

  @integration
  Scenario: Metadata always survives a drop
    Given a rule on "web-app" that drops trace input, output, system instructions, and tool calls
    When a trace is ingested with token counts, cost, model name, and latency
    Then the stored trace keeps its token counts, cost, model name, and latency

  @integration
  Scenario: Each content category is dropped independently
    Given a rule on "web-app" that drops tool calls only
    When a trace is ingested with input, output, and tool calls
    Then the stored trace keeps its input and output
    And the stored trace has no tool-call arguments or results

  # System instructions and tool calls are not only their own attributes: they
  # also live as turns inside the captured conversation (a system message, tool
  # result messages, an assistant turn's tool_calls). Dropping the category has
  # to remove those turns from the conversation too, or the very content the rule
  # was meant to drop stays readable inside the input and output.

  @integration
  Scenario: Dropping system instructions strips the system turn from the conversation
    Given a rule on "web-app" that drops system instructions
    When a trace is ingested whose conversation starts with a system message
    Then the stored conversation has no system message
    And the stored trace keeps its user and assistant messages

  @integration
  Scenario: Dropping tool calls strips tool messages and assistant tool_calls
    Given a rule on "web-app" that drops tool calls only
    When a trace is ingested whose conversation has tool result messages and an assistant turn that calls a tool
    Then the stored conversation has no tool messages
    And the stored assistant message has no tool_calls
    And the stored trace keeps its user and assistant messages

  @integration
  Scenario: A coding-agent's full request body is never stored when input is dropped
    Given a rule on "web-app" that drops trace input
    When a coding-agent log carrying a full request body is ingested for "web-app"
    Then the stored span has no raw request body

  @integration
  Scenario: Extra blacklisted attribute keys are dropped
    Given a rule on "web-app" that also drops the attribute "http.request.body"
    When a trace is ingested carrying an "http.request.body" attribute
    Then the stored span has no "http.request.body" attribute

  @integration
  Scenario: A wildcard attribute rule drops every matching key
    Given a rule on "web-app" that drops attributes matching "app.internal.*"
    When a trace is ingested carrying "app.internal.session" and "app.public.label" attributes
    Then the stored span has no "app.internal.session" attribute
    And the stored span keeps its "app.public.label" attribute
    And the stored span records which attribute keys were dropped

  @integration
  Scenario: The trace-level computed input is cleared when input is dropped
    Given a rule on "web-app" that drops trace input
    When a trace is ingested with input
    Then the trace summary has no computed input

  # Dropping is not retroactive: it only affects spans that arrive after the
  # rule is in place. Existing stored spans are not scrubbed.

  @integration
  Scenario: Dropping does not scrub already-stored traces
    Given a trace already stored for "web-app" with input
    When a rule that drops trace input is added for "web-app"
    Then the already-stored trace still has its input

  # Dropped content is gone from storage, so the trace view marks its absence to
  # tell it apart from content that was simply never instrumented: the view names
  # the categories a privacy policy dropped and makes clear they were never
  # stored. This is read from a marker the drop stamps on the span, so it follows
  # the data and is not a guess from the project's current settings.

  @integration
  Scenario: The trace view marks content a privacy policy dropped
    Given a rule on "web-app" that drops trace input
    And a trace ingested for "web-app" while the rule is in place
    When someone opens that trace
    Then the trace view marks the input as dropped by a privacy policy
