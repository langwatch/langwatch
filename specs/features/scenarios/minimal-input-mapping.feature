Feature: Scenario agent needs only a single input mapping to save and run
  As a scenario author
  I want to save a workflow or code agent configuration that only has an input mapping
  So that I can run scenarios without being forced to configure an output-field selection upfront

  # Background: the scenario framework auto-populates the output if a single
  # output is declared; users should not be blocked from saving or running
  # just because they cleared the output-field picker or haven't touched it.
  #
  # The output-MAPPING requirement (hasOutputMapping) is relaxed in
  # isScenarioMappingValid. The structural guard on published workflow
  # outputs (workflowOutputs.length > 0 in AgentWorkflowEditorDrawer.isValid)
  # STAYS — a workflow with no end-node outputs cannot produce a scorable
  # response, so Save must remain blocked there.
  #
  # Scope of this feature:
  #   - isScenarioMappingValid predicate (unit)
  #   - AgentWorkflowEditorDrawer Save gate (integration)
  #   - AgentCodeEditorDrawer Save gate (integration)
  # Out of scope: the structural workflowOutputs.length guard (unchanged).

  # ── Core predicate ────────────────────────────────────────────────────────

  @unit
  Scenario: Input mapping alone passes the predicate
    Given an agent configuration with a source mapping for the "input" scenario field
    When the mapping validity is evaluated
    Then the result is valid

  @unit
  Scenario: Messages mapping alone passes the predicate
    Given an agent configuration with a source mapping for the "messages" scenario field
    When the mapping validity is evaluated
    Then the result is valid

  @unit
  Scenario: ThreadId-only mapping fails the predicate
    Given an agent configuration with only a "threadId" source mapping
    When the mapping validity is evaluated
    Then the result is invalid

  @unit
  Scenario: Static value mapping fails the predicate
    Given an agent configuration with only a static value mapping
    When the mapping validity is evaluated
    Then the result is invalid

  @unit
  Scenario: Empty mappings fail the predicate
    Given an agent configuration with no mappings at all
    When the mapping validity is evaluated
    Then the result is invalid

  # ── Workflow editor drawer ─────────────────────────────────────────────────

  @integration
  Scenario: Save workflow agent when output mapping is cleared but input mapping present
    Given a workflow agent with a valid input mapping for the "input" scenario field
    And the linked workflow publishes at least one end-node output
    And the user has explicitly cleared the output-field selection
    When the agent editor drawer renders
    Then the Save Changes button is enabled

  @integration
  Scenario: Save workflow agent stays blocked when the workflow has no published outputs
    Given a workflow agent with a valid input mapping for the "input" scenario field
    And the linked workflow publishes no end-node outputs
    When the agent editor drawer renders
    Then the Save Changes button is disabled

  @integration
  Scenario: Save workflow agent stays blocked when no input mapping is configured
    Given a workflow agent with only a "threadId" source mapping
    And the linked workflow publishes at least one end-node output
    When the agent editor drawer renders
    Then the Save Changes button is disabled

  # ── Code editor drawer ────────────────────────────────────────────────────

  @integration
  Scenario: Save code agent when output mapping is cleared but input mapping present
    Given a code agent with a valid input mapping for the "input" scenario field
    And the agent declares at least one output
    And the user has explicitly cleared the output-field selection
    When the agent editor drawer renders
    Then the Save Changes button is enabled

  @integration
  Scenario: Save code agent stays blocked when no input mapping is configured
    Given a code agent with only a "threadId" source mapping
    And the agent declares at least one output
    When the agent editor drawer renders
    Then the Save Changes button is disabled

  # ── Save & Run gate ───────────────────────────────────────────────────────
  # A scenario must be runnable with only the input mapping (issue AC1). The
  # run gate already used the input-only rule; these guard that contract.

  @integration
  Scenario: Run gate passes for workflow agent with input-only mapping
    Given a workflow agent with a valid input mapping and no output mapping
    When the user clicks Save and run
    Then the scenario run starts without opening the mapping editor

  @integration
  Scenario: Run gate emits no mapping warning when input is mapped
    Given a workflow agent with a valid input mapping and no output mapping
    When the user clicks Save and run
    Then no mapping-required warning is shown

  # ── AC Coverage Map ───────────────────────────────────────────────────────
  # "isScenarioMappingValid returns true for input-only mapping" →
  #   "Input mapping alone passes the predicate"
  #   "Messages mapping alone passes the predicate"
  # "isScenarioMappingValid is fail-closed" →
  #   "ThreadId-only mapping fails the predicate"
  #   "Static value mapping fails the predicate"
  #   "Empty mappings fail the predicate"
  # "Workflow drawer Save gate passes for input-only mapping" →
  #   "Save workflow agent when output mapping is cleared but input mapping present"
  # "Structural workflow-output guard is preserved" →
  #   "Save workflow agent stays blocked when the workflow has no published outputs"
  # "Workflow drawer fail-closed" →
  #   "Save workflow agent stays blocked when no input mapping is configured"
  # "Code drawer Save gate passes for input-only mapping" →
  #   "Save code agent when output mapping is cleared but input mapping present"
  # "Code drawer fail-closed" →
  #   "Save code agent stays blocked when no input mapping is configured"
