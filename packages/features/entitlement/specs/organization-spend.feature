Feature: An organization's spend
  As a member of an organization
  I want the billing screen to show what my projects have spent
  So that a cost is read against the allowance it was taken under

  @unit @entitlements
  Scenario: Spend is rolled up only for the projects a caller can reach
    Given an organization whose spend is recorded per project
    When a member asks for the organization's spend
    Then the rollup covers the projects that member can reach
    And a caller who can reach none of them is answered with an empty rollup

  @unit @entitlements
  Scenario: A spend window ending within the last hour is read as up to now
    Given a caller asks for a window whose end is inside the last hour
    When the spend rollup is taken
    Then the window is read up to the present instant
    And a window that ended earlier is taken exactly as it was asked for
