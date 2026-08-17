Feature: HTTP agent headers render templates and carry trace context
  As a user pointing a scenario at an external HTTP agent
  I want header values to render through the same template engine as the url
  and body, with the turn's trace context available as template variables
  So that a system that cannot read the standard traceparent header can still
  receive the trace id in a header or field of its own naming, and join its
  spans to the scenario turn the judge reads.

  Background: what a turn propagates.
    Every call an http target takes carries the turn's trace context. The
    automatic traceparent header stays and stays always on. On top of it, the
    template context binds "traceId" and "traceparent" beside "threadId", so
    the url, the body template and every header value can read them. Header
    values render as plain text: nothing is URL-encoded or JSON-escaped on the
    way into a header. Secret references in header values keep the discipline
    they already have in the url: resolution happens before the render, the
    resolved value never passes through the template engine, and a reference
    to a name the project does not have stays exactly as written. Code and
    workflow targets receive the same context as "params.trace_id" and
    "params.traceparent", so a code node can forward them to whatever it
    calls.

  @unit
  Scenario: A header value renders run parameters
    Given an http target with a header whose value reads "params.region"
    And the run resolves "region" to "eu-central"
    When the target takes a turn
    Then the request carries "eu-central" in that header

  @unit
  Scenario: A header value renders the turn's trace id and traceparent
    Given an http target with headers reading "traceId" and "traceparent"
    When the target takes a turn
    Then those headers carry the turn's trace id and traceparent values

  @unit
  Scenario: A secret reference in a header value survives rendering byte for byte
    Given a project secret "AGENT_TOKEN"
    And an http target with a header that reads "secrets.AGENT_TOKEN" next to "params.region"
    When the target takes a turn
    Then the header carries the secret's value exactly as stored, with the parameter rendered around it
    And a secret value that is itself template syntax is never read as template source

  @unit
  Scenario: A failing header template names the header it came from
    Given an http target with a header whose value is a malformed template
    When the target takes a turn
    Then the failure names the "headers" field and the header's key

  @unit
  Scenario: A rendered header value cannot carry a line break
    Given an http target with a header whose interpolated content renders a line break
    When the target takes a turn
    Then the render fails naming the header, before the value reaches the HTTP client

  @unit
  Scenario: The automatic traceparent does not replace one the target configured
    Given an http target that writes its own "traceparent" header from a template
    When the target takes a turn
    Then the request carries the configured value, not the automatic one
    And a target with no such header still receives the automatic traceparent

  @unit
  Scenario: The url and body templates can read the turn's trace id and traceparent
    Given an http target whose url and body template read "traceId"
    When the target takes a turn
    Then the request carries the turn's trace id in both places

  @unit
  Scenario: A code execution receives the trace context in its params
    Given a code target
    When the target takes a turn
    Then the code can read the turn's trace context from "params.trace_id" and "params.traceparent"

  @unit
  Scenario: A workflow execution receives the trace context in its params
    Given a workflow target
    When the target takes a turn
    Then a code node inside the workflow can read "params.trace_id" and "params.traceparent"

  @unit
  Scenario: The trace context wins over a run parameter with the same name
    Given a code or workflow target and a run supplying its own "trace_id" value
    When the target takes a turn
    Then "params.trace_id" carries the turn's real trace id, not the supplied value
