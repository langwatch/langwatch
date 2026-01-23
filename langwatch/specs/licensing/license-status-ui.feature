@wip @unit
Feature: License Status UI Component
  As a LangWatch administrator
  I want to view and manage my license in the settings UI
  So that I can activate, view status, and remove licenses

  Background:
    Given I am on the license settings page
    And I am an admin of the current organization

  # ============================================================================
  # No License State
  # ============================================================================

  Scenario: Displays message when no license is installed
    Given the organization has no license
    When the component renders
    Then I see text "No license installed"
    And I see text "Running in unlimited mode"

  Scenario: Shows license input textarea when no license
    Given the organization has no license
    When the component renders
    Then I see a textarea with placeholder "Paste your license key here..."
    And I see an "Activate License" button

  Scenario: Activate button is disabled when textarea is empty
    Given the organization has no license
    When the component renders
    And the license textarea is empty
    Then the "Activate License" button is disabled

  # ============================================================================
  # Valid License State
  # ============================================================================

  Scenario: Displays license status badge when valid
    Given the organization has a valid "GROWTH" license
    When the component renders
    Then I see a green badge with text "GROWTH"

  Scenario: Displays plan name
    Given the organization has a valid license with plan name "Growth"
    When the component renders
    Then I see "Plan:" label with value "Growth"

  Scenario: Displays member usage
    Given the organization has 5 members
    And the license allows 10 members
    When the component renders
    Then I see "Members:" label with value "5 / 10"

  Scenario: Displays expiration date
    Given the organization has a license expiring "December 31, 2025"
    When the component renders
    Then I see "Expires:" label with value "December 31, 2025"

  Scenario: Shows remove license button for valid license
    Given the organization has a valid license
    When the component renders
    Then I see a "Remove License" button

  Scenario: Hides license input when license exists
    Given the organization has a valid license
    When the component renders
    Then I do not see a license textarea

  # ============================================================================
  # Invalid/Expired License State
  # ============================================================================

  Scenario: Displays red badge for invalid license
    Given the organization has an invalid license
    When the component renders
    Then I see a red badge with text "Invalid"

  Scenario: Displays warning for expired license
    Given the organization has an expired license
    When the component renders
    Then I see a red badge
    And I see warning text about expiration

  # ============================================================================
  # License Upload Flow
  # ============================================================================

  Scenario: Shows loading state during upload
    Given the organization has no license
    And I enter a license key in the textarea
    When I click "Activate License"
    Then the button shows a loading spinner
    And the button is disabled

  Scenario: Shows success toast on successful activation
    Given the organization has no license
    And I enter a valid license key
    When I click "Activate License"
    And the upload succeeds
    Then I see a success toast with text "License activated"
    And the textarea is cleared
    And the license status is refreshed

  Scenario: Shows error toast on failed activation
    Given the organization has no license
    And I enter an invalid license key
    When I click "Activate License"
    And the upload fails with error "Invalid license format"
    Then I see an error toast with text "Invalid license format"

  # ============================================================================
  # License Removal Flow
  # ============================================================================

  Scenario: Shows info toast on license removal
    Given the organization has a valid license
    When I click "Remove License"
    And the removal succeeds
    Then I see an info toast with text "License removed"
    And the license status is refreshed

  # ============================================================================
  # Loading State
  # ============================================================================

  Scenario: Shows skeleton while loading status
    Given the license status is loading
    When the component renders
    Then I see loading skeletons
    And I do not see the license content
