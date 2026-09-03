Feature: SaaS browser integrations

  Scenario: Third-party scripts stay dormant off SaaS
    Given the SaaS footer receives isSaas false
    When it renders
    Then it emits no third-party script

  @integration
  Scenario: Delayed analytics globals are used
    Given a signed-in SaaS user and organization context
    When Reo and gtag appear after mount
    Then the footer identifies and tracks the user once
