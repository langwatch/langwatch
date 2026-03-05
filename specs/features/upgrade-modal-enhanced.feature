Feature: Enhanced upgrade modal with plan comparison
  When a user hits a resource limit, the upgrade modal shows the limit
  message alongside a two-column comparison of their current plan vs
  the Growth plan, giving users clear context about why they should upgrade.

  Background:
    Given the user is logged in to an organization

  Scenario: Modal shows limit message with plan comparison
    When a resource limit is reached and the upgrade modal opens
    Then the modal displays the limit trigger message
    And a two-column comparison is shown with current plan and Growth plan

  Scenario: Current plan column shows plan name and features
    Given the organization is on the Free plan
    When the upgrade modal opens for a limit violation
    Then the left column header shows "Free plan"
    And the left column lists the Free plan features

  Scenario: Growth plan column shows features with checkmarks
    When the upgrade modal opens for a limit violation
    Then the right column header shows "Growth plan"
    And a "Recommended" badge appears next to the Growth plan title
    And the right column lists the Growth plan features with checkmarks

  Scenario: Comparison hidden when overrideAddingLimitations is true
    Given the organization plan has override adding limitations enabled
    When the upgrade modal opens
    Then the plan comparison columns are not shown

  Scenario: Comparison hidden for license-based plans
    Given the organization has a license-based plan
    When the upgrade modal opens
    Then the plan comparison columns are not shown

  Scenario: Skeleton shown while plan data loads
    When the upgrade modal opens and plan data is still loading
    Then the current plan column shows a placeholder for the plan name

  Scenario: Modal degrades gracefully when API fails
    When the upgrade modal opens but the plan API call fails
    Then the modal still displays the trigger message and upgrade button
    And the plan comparison columns are not shown

  Scenario: Upgrade button navigates to subscription settings
    When the user clicks the upgrade button in the modal
    Then the user is navigated to the subscription management page
