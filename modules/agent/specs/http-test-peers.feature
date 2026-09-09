@agent
Feature: HTTP tests use the owning execution and trace APIs
  Agent owns request construction, response mapping and credential redaction.
  Workflow executes the component and Trace records its captured span.

  @integration
  Scenario: HTTP agent execution reaches the composed Workflow API
    Given the Workflow application owns the process studio dispatcher
    When Agent submits an HTTP component through WorkflowApi
    Then the real engine stream supplies the requested component's final state
    And the dispatch preserves the trace identifier and template inputs

  @unit
  Scenario: A captured agent span uses the canonical trace ingestion command
    Given the Trace application owns the process span ingestion sender
    When Agent records a captured HTTP test span through TraceApi
    Then one OTLP command preserves its tenant, span identifiers and time units
    And the command retains the agent-test metadata and attributed user
