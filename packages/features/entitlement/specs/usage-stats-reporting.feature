Feature: Usage statistics reporting
  As an operator of any deployment
  I want the month's usage reading to answer on every page load
  So that the sidebar meter and the usage page show where an organization stands

  @unit @entitlements
  Scenario: An uncapped plan reports a finite allowance
    Given an organization on a plan with no monthly usage cap
    When the usage reading is taken
    Then the reported allowance is a finite number
    And the reading satisfies the published usage contract

  @unit @entitlements
  Scenario: A capped plan reports the allowance it was given
    Given an organization on a plan with a monthly message allowance
    When the usage reading is taken
    Then the limit summary quotes that allowance
    And the reading satisfies the published usage contract
