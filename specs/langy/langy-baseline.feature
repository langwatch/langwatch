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
  # Access and rollout gating
  # Covered by src/server/routes/__tests__/langy-route-auth.test.ts
  # ============================================================================

  Scenario: Staff always have Langy regardless of rollout
    Given I am a LangWatch staff member
    And Langy has not been rolled out beyond staff
    When I send a message to Langy in project "demo"
    Then the request is not rejected by the rollout gate

  Scenario: Non-staff without rollout are blocked
    Given I am not a LangWatch staff member
    And Langy has not been rolled out to my account
    When I send a message to Langy in project "demo"
    Then the request is rejected with a 403

  Scenario: Rollout opens Langy to non-staff
    Given I am not a LangWatch staff member
    And Langy has been rolled out to my account
    When I send a message to Langy in project "demo"
    Then the request is not rejected by the rollout gate

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
  # Conversation history
  # ============================================================================

  Scenario: Deleting the active conversation resets the panel
    Given I am viewing a conversation in the recent chats list
    When I delete that conversation from the list
    Then the panel returns to a fresh empty state
    And any in-flight stream is stopped
    And proposal state from the deleted conversation is cleared

  Scenario: Deleting a non-active conversation leaves the current chat alone
    Given I am viewing one conversation and another exists in the recent list
    When I delete the other conversation
    Then the conversation I am viewing remains open with its messages intact

  # ============================================================================
  # Read-only boundary (v1)
  # ============================================================================

  Scenario: Langy never mutates data without a proposal
    When Langy decides an evaluator should change
    Then it must call a "propose_*" tool
    And it must not directly call a mutation
