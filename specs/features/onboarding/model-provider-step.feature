Feature: Model provider step in product onboarding
  As a new user picking how to start with LangWatch
  I want onboarding to offer a "Set up a model provider" step
  So that the AI assistant and AI assists have a model to run on from day one

  # The step renders the shared model provider screen on its "onboarding"
  # surface. specs/model-providers/codex-account-provider.feature pins the
  # Codex-first placement and copy for that surface; this file pins where
  # the step sits in the flow and that it never blocks anyone: every path
  # through it can be skipped, and the coding-agent flavours do not pass
  # through it at all.
  #
  # Tests:
  #   langwatch/src/features/onboarding/hooks/__tests__/use-product-flow.unit.test.tsx
  #   langwatch/src/features/onboarding/components/sections/__tests__/ModelProviderStepScreen.integration.test.tsx

  Background:
    Given I finished the welcome questions and reached the flavour selection

  @unit
  Scenario: Only the platform flavour passes through the step
    When I pick "Via the Platform"
    Then I see the "Set up a model provider" step before the platform overview
    And picking a coding-agent flavour instead goes straight to its setup screen with no model provider step

  @integration
  Scenario: Codex leads the step with a recommendation
    When the model provider step renders
    Then Codex is the first provider, marked "Recommended"
    And the copy says Codex suits paid OpenAI accounts and the other providers take an API key

  @integration
  Scenario: Completing provider setup advances the flow
    Given I am on the model provider step
    When I finish setting up a provider
    Then onboarding advances to the platform overview on its own

  @integration
  Scenario: Skipping advances without a provider
    Given I am on the model provider step
    When I click "Skip for now"
    Then onboarding advances to the platform overview
    And no model provider was configured
