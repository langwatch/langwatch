Feature: Governance draws what peers lend it by token

  Onboarding lends its guided onboarding pill and model-provider lends its model picker,
  each with a token from its own contract (ARCHITECTURE.md §10.1). Governance's screens read
  those tokens, never a capability declaration, which §15 deletes for a peer lend.

  @integration
  Scenario: The overview draws onboarding's lent guided onboarding pill
    Given onboarding lends its pill with GuidedOnboardingOfferToken
    When the governance overview renders the offer for its space
    Then the overview draws onboarding's pill with that space

  @integration
  Scenario: The insights setup drawer draws model-provider's lent model picker
    Given model-provider lends its picker with ModelSelectorToken
    When the insights setup drawer renders the picker with its models
    Then the drawer draws model-provider's picker with those models

  @integration
  Scenario: No module lends a token governance reads
    Given no module lends GuidedOnboardingOfferToken or ModelSelectorToken
    When governance renders the offer or the picker
    Then governance draws nothing in their place
