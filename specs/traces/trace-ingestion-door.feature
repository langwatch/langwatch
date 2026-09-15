Feature: The trace ingestion door is served

  The collector is the product's front door: every released SDK posts a trace to
  POST /api/collector, and a deployment that does not serve it accepts no
  telemetry at all. The door is declared public and resolves the project
  credential inside its own handler, because its refusal bodies predate the
  framework envelope and deployed SDKs parse them.

  These scenarios are bound against the module as a process composes it, not
  against the router on its own. A router answers the same whether or not
  anything mounts it, which is how this family came to be defined, exported and
  served nowhere while its own tests stayed green.

  Background:
    Given a process has composed the trace module
    And the deployment serves the trace module's REST families

  @integration
  Scenario: The collector door accepts a trace from an SDK
    Given an SDK holds a key that may create traces in its project
    When it posts a trace to the collector
    Then the trace is accepted

  @integration
  Scenario: An accepted span reaches the trace pipeline
    Given an SDK holds a key that may create traces in its project
    When it posts a trace to the collector
    Then the span is recorded against the project the credential named

  @integration
  Scenario: An accepted trace stamps the key's last-used clock
    Given an SDK holds a key that may create traces in its project
    When it posts a trace to the collector
    Then the key is marked as used

  @integration
  Scenario: The collector door refuses an unauthenticated sender
    Given a sender presents no credential
    When it posts a trace to the collector
    Then the trace is refused as unauthenticated
    And no span is recorded

  @integration
  Scenario: The collector door refuses a key without the ingest permission
    Given a sender holds a key that may not create traces
    When it posts a trace to the collector
    Then the trace is refused
    And no span is recorded

  @integration
  Scenario: A legacy project key still ingests
    Project keys predate role-based access and carry full project access by
    design, so the permission ceiling does not apply to them.

    Given a sender presents a legacy project key
    When it posts a trace to the collector
    Then the trace is accepted
    And the span is recorded
