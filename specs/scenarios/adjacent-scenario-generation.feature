Feature: Adjacent Scenario Generation ("Fan Scenarios")
  As a LangWatch user
  I want to generate a batch of adjacent test scenarios from a real failure
  So that I discover related failure modes before a customer finds them

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Seeding — Failed Scenario Run
  # ============================================================================

  @e2e @unimplemented
  Scenario: Generate adjacent scenarios from a failed run
    Given scenario "Refund Flow" has a failed run
    When I open the failed run result view
    And I click "Find related failures"
    Then a fan-out batch is created seeded from that run
    And I am navigated to the review drawer with generated variants

  @integration
  Scenario: Generated variants inherit the seed's target
    Given scenario "Refund Flow" has a failed run against a prompt target
    When I generate adjacent scenarios from that run
    Then every generated variant targets the same prompt

  @integration
  Scenario: A run seed reuses its own scenario text
    Given the seed is a scenario a human already wrote
    When I generate adjacent scenarios from a failed run of it
    Then the batch's seed situation and criteria are that scenario's own

  @unit
  Scenario: A run with no recorded target type still offers the entry point
    Given a failed run whose metadata records what it ran against but not which kind of target it was
    When I open that run
    Then "Find related failures" is still offered
    And I am asked which target the generated scenarios should run against

  # ============================================================================
  # Seeding — Free Text
  # ============================================================================

  @e2e @unimplemented
  Scenario: Generate adjacent scenarios from a pasted incident description
    Given I am on the scenarios list page
    When I open "Find related failures" from the toolbar
    And I enter "Customers report the agent refuses to process refunds over $500" as the description
    And I pick a target
    And I click "Find related failures"
    Then a fan-out batch is created seeded from the description
    And I am navigated to the review drawer with generated variants

  @integration
  Scenario: Free-text generation drafts a seed situation and criteria first
    Given I enter a free-text incident description with no situation or criteria
    When generation runs
    Then the batch's seed situation and criteria are LLM-drafted from the description

  # ============================================================================
  # Seeding — Annotated Trace (deferred)
  # ============================================================================
  # Issue #6123 asks for a third entry point, from a trace annotation. It is not
  # built: these describe the intent, and the seed types the code accepts stop
  # at a failed run and a pasted description until they are.

  @e2e @unimplemented
  Scenario: Generate adjacent scenarios from an annotated trace
    Given a production trace has an annotation describing a customer complaint
    When I click "Find related failures" on the annotation
    Then a fan-out batch is created seeded from that trace and annotation
    And I am navigated to the review drawer with generated variants

  @integration @unimplemented
  Scenario: Annotated-trace seed requires an explicit target
    Given a production trace has an annotation with no associated scenario target
    When I click "Find related failures" on the annotation
    Then I am prompted to pick a target before generation starts

  # ============================================================================
  # Lens Catalogue
  # ============================================================================

  @integration
  Scenario: Default generation covers the six adjacency lenses
    Given a seed with a situation and criteria
    When I generate adjacent scenarios with no lens override
    Then the generated variants cover the lenses:
      | paraphrase                   |
      | entity_substitution          |
      | tone_shift                   |
      | adjacent_intent              |
      | boundary_value               |
      | multi_turn_context_variation |

  @integration
  Scenario: Every generated variant is a real, persisted scenario
    Given a seed with a situation and criteria
    When I generate adjacent scenarios
    Then each variant has a scenario row of its own that dispatch can run

  @unit @unimplemented
  Scenario: Each generated variant states why it's a meaningful adjacent case
    Given a seed with a situation and criteria
    When I generate adjacent scenarios
    Then every variant includes a rationale distinct from the seed's situation

  @unit @unimplemented
  Scenario: Batch size stays within 5 to 8 variants
    Given a seed with a situation and criteria
    When I generate adjacent scenarios with no count override
    Then the batch contains between 5 and 8 variants

  # ============================================================================
  # Error Handling
  # ============================================================================

  @integration @unimplemented
  Scenario: Show a clear error when no model provider is configured
    Given the project has no model providers configured
    When I try to generate adjacent scenarios
    Then I see an error explaining API keys are not configured
    And I see guidance to configure API keys in Settings

  @integration
  Scenario: Show a clear error when the seed scenario is gone
    Given the scenario a fan-out would be seeded from has been deleted
    When I try to generate adjacent scenarios from it
    Then generation is refused with a named error rather than a generic failure
    And no fan-out batch is left in a stuck "generating" state

  @integration @unimplemented
  Scenario: Show a retryable error when generation fails
    Given the generation service returns an error
    When I try to generate adjacent scenarios
    Then I see a clear, retryable error
    And no fan-out batch is left in a stuck "generating" state
