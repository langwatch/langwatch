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
  Scenario: Valid input mapping with no outputs configured passes the predicate
    Given an agent configuration with a source mapping for the "input" scenario field
    And no outputs are declared
    When the mapping validity is evaluated
    Then the result is valid

  @unit
  Scenario: Valid input mapping with outputField explicitly cleared passes the predicate
    Given an agent configuration with a source mapping for the "input" scenario field
    And outputs are declared
    But the output-field selection has been explicitly cleared
    When the mapping validity is evaluated
    Then the result is valid

  @unit
  Scenario: Valid messages mapping with no outputs configured passes the predicate
    Given an agent configuration with a source mapping for the "messages" scenario field
    And no outputs are declared
    When the mapping validity is evaluated
    Then the result is valid

  @unit
  Scenario: No input or messages mapping fails the predicate regardless of outputs
    Given an agent configuration with no source mapping for "input" or "messages"
    And outputs are fully configured
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

  # ── AC Coverage Map ───────────────────────────────────────────────────────
  # "isScenarioMappingValid returns true for input-only mapping" →
  #   "Valid input mapping with no outputs configured passes the predicate"
  #   "Valid input mapping with outputField explicitly cleared passes the predicate"
  #   "Valid messages mapping with no outputs configured passes the predicate"
  # "isScenarioMappingValid is fail-closed" →
  #   "No input or messages mapping fails the predicate regardless of outputs"
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
