Feature: Workflow agent mapping surfaces unwired entry fields
  As a scenario author iterating on a workflow
  I want every declared entry-node output field to be mappable
  So that I can wire scenario inputs to fields before drawing internal edges

  # Bug fix for #3362. Both the Edit Workflow Agent drawer and the server-side
  # auto-compute routine derive their list of mappable workflow inputs from
  # `getInputsOutputs(edges, nodes)` in `src/optimization_studio/utils/nodeUtils.ts`.
  # That helper only walks edges sourced from the entry node, so a declared
  # entry-output without a downstream edge is silently dropped. The entry node's
  # `data.outputs` (the declared fields, source of truth) is never consulted.
  #
  # Fix: seed inputs from `entryNode.data.outputs` while preserving the
  # evaluator-only `optional` flag derived from edges. Both call sites pick up
  # the fix transparently. End outputs (`endNode.data.inputs`) are unaffected.

  Background:
    Given a project with a scenario that expects "input" and "messages" fields
    And the scenario expects "response" as the agent output
    And a workflow agent linked to a workflow with declared entry outputs

  # --- AC 1: drawer surfaces unwired entry fields ---

  @integration
  Scenario: Edit Workflow Agent drawer lists an unwired entry field as a mappable input
    Given the workflow's entry node declares an output field "new_field"
    And "new_field" has no downstream edge in the workflow
    When the user opens the Edit Workflow Agent drawer for the linked agent
    Then the scenario-mapping section lists "new_field" as a mappable input

  @unit
  Scenario: Pure unwired entry field still appears as an input
    Given the workflow's entry node declares an output field "orphan_field"
    And the workflow has no edges at all
    When the inputs list is extracted via getInputsOutputs for the drawer
    Then the inputs include exactly one entry with identifier "orphan_field"
    And the entry does not carry the optional flag

  # --- AC 2: auto-compute includes unwired entry fields ---

  @unit
  Scenario: Auto-compute on workflow save includes an unwired entry field in scenarioMappings
    Given the workflow's entry node declares an output field "new_field"
    And "new_field" has no downstream edge in the workflow
    And the linked agent has no scenarioMappings configured
    When the workflow version is saved
    Then the agent's scenarioMappings include an entry whose source identifier is "new_field"
    And the entry uses best-match defaults for the scenario target field

  # --- AC 3: regression — wired entry fields still surface in both paths ---

  @unit
  Scenario: Wired entry field still appears once in the drawer's mappable inputs
    Given the workflow's entry node declares an output field "query"
    And "query" is wired to a downstream non-evaluator node
    When the inputs list is extracted via getInputsOutputs for the drawer
    Then the inputs include exactly one entry with identifier "query"
    And the entry does not carry the optional flag

  @unit
  Scenario: Wired entry field still appears in auto-computed scenarioMappings
    Given the workflow's entry node declares an output field "query"
    And "query" is wired to a downstream non-evaluator node
    And the linked agent has no scenarioMappings configured
    When the workflow version is saved
    Then the agent's scenarioMappings include an entry whose source identifier is "query"

  # --- AC 4: regression — evaluator-only wired entry outputs keep their optional flag ---

  @unit
  Scenario: Evaluator-only wired entry output keeps its optional flag
    Given the workflow's entry node declares an output field "eval_only"
    And "eval_only" is wired only to an evaluator node
    When the inputs list is extracted via getInputsOutputs for the drawer
    Then the inputs include an entry with identifier "eval_only"
    And that entry is marked optional

  @unit
  Scenario: Mixed wired and unwired entry fields all appear exactly once with correct flags
    Given the workflow's entry node declares output fields "wired", "unwired", and "eval_only"
    And "wired" is wired to a downstream non-evaluator node
    And "unwired" has no downstream edge
    And "eval_only" is wired only to an evaluator node
    When the inputs list is extracted via getInputsOutputs for the drawer
    Then the inputs include exactly one entry for "wired" without the optional flag
    And the inputs include exactly one entry for "unwired" without the optional flag
    And the inputs include exactly one entry for "eval_only" marked optional

  # --- End-output regression — change is scoped to entry side ---

  @unit
  Scenario: End-node outputs continue to derive from endNode.data.inputs unchanged
    Given the workflow's end node declares inputs "response" and "score"
    When the outputs list is extracted via getInputsOutputs
    Then the outputs match the end node's declared inputs

# --- AC Coverage Map ---
# AC 1: "Drawer lists unwired entry field as mappable" → Scenario: Edit Workflow Agent drawer lists an unwired entry field as a mappable input
# AC 1: "Drawer lists unwired entry field as mappable" → Scenario: Pure unwired entry field still appears as an input
# AC 2: "Auto-compute includes unwired entry field" → Scenario: Auto-compute on workflow save includes an unwired entry field in scenarioMappings
# AC 3: "Regression — wired entry fields unchanged in both paths" → Scenario: Wired entry field still appears once in the drawer's mappable inputs
# AC 3: "Regression — wired entry fields unchanged in both paths" → Scenario: Wired entry field still appears in auto-computed scenarioMappings
# AC 4: "Regression — evaluator-only wired entry outputs keep optional flag" → Scenario: Evaluator-only wired entry output keeps its optional flag
# AC 4: "Regression — evaluator-only wired entry outputs keep optional flag" → Scenario: Mixed wired and unwired entry fields all appear exactly once with correct flags
# (Out-of-AC supporting coverage)
# End-output invariant: → Scenario: End-node outputs continue to derive from endNode.data.inputs unchanged
