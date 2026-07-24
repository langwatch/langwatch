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
    And I click "Generate adjacent scenarios"
    Then a fan-out batch is created seeded from that run
    And I am navigated to the review drawer with generated variants

  @integration @unimplemented
  Scenario: Generated variants inherit the seed's target
    Given scenario "Refund Flow" has a failed run against a prompt target
    When I generate adjacent scenarios from that run
    Then every generated variant targets the same prompt

  # ============================================================================
  # Seeding — Annotated Trace
  # ============================================================================

  @e2e @unimplemented
  Scenario: Generate adjacent scenarios from an annotated trace
    Given a production trace has an annotation describing a customer complaint
    When I click "Generate adjacent scenarios from this trace" on the annotation
    Then a fan-out batch is created seeded from that trace and annotation
    And I am navigated to the review drawer with generated variants

  @integration @unimplemented
  Scenario: Annotated-trace seed requires an explicit target
    Given a production trace has an annotation with no associated scenario target
    When I click "Generate adjacent scenarios from this trace"
    Then I am prompted to pick a target before generation starts

  # ============================================================================
  # Seeding — Free Text
  # ============================================================================

  @e2e @unimplemented
  Scenario: Generate adjacent scenarios from a pasted incident description
    Given I am on the scenarios list page
    When I open "Generate adjacent scenarios" from the toolbar
    And I enter "Customers report the agent refuses to process refunds over $500" as the description
    And I pick a target
    And I click "Generate"
    Then a fan-out batch is created seeded from the description
    And I am navigated to the review drawer with generated variants

  @integration @unimplemented
  Scenario: Free-text generation drafts a seed situation and criteria first
    Given I enter a free-text incident description with no situation or criteria
    When generation runs
    Then the batch's seed situation and criteria are LLM-drafted from the description
    And the drafted seed is shown alongside the generated variants for context

  # ============================================================================
  # Lens Catalogue
  # ============================================================================

  @unit @unimplemented
  Scenario: Default generation covers the six adjacency lenses
    Given a seed with a situation and criteria
    When I generate adjacent scenarios with no lens override
    Then the generated variants cover the lenses:
      | paraphrase                  |
      | entity_substitution         |
      | tone_shift                  |
      | adjacent_intent             |
      | boundary_value              |
      | multi_turn_context_variation |

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

  @integration @unimplemented
  Scenario: Show a retryable error when generation fails
    Given the generation service returns an error
    When I try to generate adjacent scenarios
    Then I see a clear, retryable error
    And no fan-out batch is left in a stuck "generating" state

  # ============================================================================
  # Plan Limits
  # ============================================================================

  @integration @unimplemented
  Scenario: Generated variants count against the scenario plan limit
    Given the project is at its scenario plan limit
    When I try to generate adjacent scenarios
    Then generation is blocked with the existing plan-limit message
