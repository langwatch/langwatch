Feature: Governance draws what peers lend it by token

  Onboarding lends its guided onboarding pill, model-provider its model picker and project its
  inline ask field, each with a token from its own contract (ARCHITECTURE.md §10.1). Governance's screens read
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
  Scenario: The overview hero draws project's lent ask field
    Given project lends its inline ask field with HeroAskFieldToken
    When the governance overview hero renders the ask field with a placeholder
    Then the hero draws project's ask field with that placeholder

  @integration
  Scenario: No module lends a token governance reads
    Given no module lends GuidedOnboardingOfferToken, ModelSelectorToken or HeroAskFieldToken
    When governance renders the offer, the picker or the ask field
    Then governance draws nothing in their place
