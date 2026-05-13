@unimplemented
Feature: Langy in-product AI assistant — baseline (v1)
  As a user of LangWatch
  I want an in-product AI assistant that can read project state and propose changes
  So that I can operate my LLM systems without leaving the product

  # Behavioral contract for the v1 baseline that already exists on this branch.
  # Tests should bind to these scenarios before any new behavior is added.

  Background:
    Given I am authenticated
    And I have access to project "demo"

  # ============================================================================
  # Mounting and visibility
  # ============================================================================

  Scenario: Langy is available on every project page
    When I navigate to any "/[project]/*" route in project "demo"
    Then the Langy handle is visible
    And Langy is not visible on public or ops routes

  Scenario: Open Langy from the handle
    Given Langy is closed
    When I click the Langy handle
    Then the Langy panel opens docked on the right
    And the page content shifts left to make room

  Scenario: Close Langy by clicking outside
    Given the Langy panel is open
    When I click outside the panel
    Then the panel closes
    And page content returns to full width

  # ============================================================================
  # Project isolation
  # ============================================================================

  Scenario: Tool calls are scoped to the active project
    Given I am viewing project "demo"
    When Langy lists evaluators
    Then it returns only evaluators belonging to "demo"
    And no evaluator from another project is included

  Scenario: Permission gate at chat entry
    Given I do not have "evaluations:view" permission for project "demo"
    When I send a message to Langy in project "demo"
    Then the request is rejected with a 403

  # ============================================================================
  # Read-only tools (information retrieval)
  # ============================================================================

  Scenario: Ask Langy what evaluators exist
    Given evaluators "RagFaithfulness" and "Toxicity" exist in "demo"
    When I ask "what evaluators are configured?"
    Then Langy lists "RagFaithfulness" and "Toxicity"
    And Langy does not fabricate evaluator names

  Scenario: Ask Langy why rows are failing
    Given experiment "exp1" has 3 rows failing the "Toxicity" evaluator
    When I ask Langy "which rows are failing and why?"
    Then Langy returns the 3 rows with the failing evaluator named

  # ============================================================================
  # Propose-apply pattern
  # ============================================================================

  Scenario: Propose creating an evaluator without applying it
    When I ask Langy "suggest an evaluator for hallucinations"
    Then Langy proposes a new evaluator
    And the proposal is shown as a card with "Apply" and "Discard" buttons
    And no evaluator is created until I click "Apply"

  Scenario: Apply a proposed evaluator
    Given Langy has proposed creating evaluator "Hallucination v1"
    When I click "Apply"
    Then evaluator "Hallucination v1" is created in "demo"
    And the proposal card transitions to "Applied" state
    And the card shows a link to open the new evaluator

  Scenario: Discard a proposal
    Given Langy has proposed creating evaluator "X"
    When I click "Discard"
    Then no evaluator is created
    And the proposal is dismissed

  Scenario: Destructive proposals are visually distinct
    When Langy proposes archiving an evaluator
    Then the proposal card is rendered with the destructive variant
    And the action requires explicit confirmation before applying

  # ============================================================================
  # Streaming and cancellation
  # ============================================================================

  Scenario: Stream responses token by token
    When I send a message
    Then Langy renders tokens as they arrive
    And tool calls are visible as they execute

  Scenario: Stop an in-flight generation
    Given Langy is generating a response
    When I click "Stop"
    Then generation halts
    And the partial response is preserved

  # ============================================================================
  # Mode toggle (PR-3.1)
  # ============================================================================

  Scenario: Default mode is non-expert
    Given I have never set my Langy mode preference
    When I open Langy in project "demo"
    Then Langy responds in plain language
    And Langy asks me to confirm before applying destructive proposals

  Scenario: Switch to expert mode
    Given I am in project "demo"
    When I open Langy settings and turn on "Expert mode"
    Then my preference is saved
    And subsequent Langy responses are terse and skip restating my question

  Scenario: Mode preference persists across sessions
    Given I have turned on "Expert mode" in project "demo"
    When I reload the page or sign back in
    Then "Expert mode" is still on

  Scenario: Mode is scoped per project
    Given I have turned on "Expert mode" in project "demo"
    When I switch to project "other"
    Then my mode in "other" is whatever I set there, independent of "demo"

  # ============================================================================
  # Rate limiting (PR-3.2)
  # ============================================================================

  Scenario: Burst of messages is throttled per user per project
    Given I have sent the per-minute message limit to Langy in project "demo"
    When I send one more message
    Then the request is rejected with a 429
    And the response tells me how many seconds until I can retry
    And the throttle does not affect other users in the same project
    And the throttle does not affect me in a different project

  Scenario: Runaway agent loops are capped per message
    Given I have sent one message to Langy
    When the agent attempts to chain tool calls past the configured cap
    Then the run halts at the cap
    And Langy returns its best partial answer

  # ============================================================================
  # Tool-output validation (PR-3.3)
  # ============================================================================

  Scenario: Langy cannot act on entities it never looked up
    Given Langy has not called list_evaluators in this conversation
    When Langy proposes updating an evaluator by slug
    Then the proposal is refused with a "not surfaced by list_evaluators" error
    And the same rule applies to prompts and datasets

  Scenario: Langy can act on entities surfaced by an earlier list call
    Given Langy has called list_evaluators and seen evaluator "Toxicity"
    When Langy proposes updating that evaluator
    Then the proposal is accepted and presented to me as a card

  Scenario: Malformed tool output never reaches the model raw
    Given a Langy tool returns data that does not match its declared schema
    When the tool result is sent back to the model
    Then the model receives a "tool_output_invalid" error envelope
    And the envelope does not include raw stack traces
    And the failure is logged for telemetry with the tool name

  # ============================================================================
  # Read-only boundary (v1)
  # ============================================================================

  Scenario: Langy never mutates data without a proposal
    When Langy decides an evaluator should change
    Then it must call a "propose_*" tool
    And it must not directly call a mutation
