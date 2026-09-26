Feature: License Settings Page Styling

  # All scenarios in this file describe design-system-compliance details
  # of the License settings page (button colorPalette, drawer
  # header/body/footer pattern, dropzone styling, badge styling, semantic
  # colors, skeleton, warning/error boxes). They all require a page-level
  # component test or Playwright E2E against the rendered License page.
  # No license-page component fixture exists yet — all aspirational pending
  # that harness.

  As a user
  I want the license settings page to match the platform design language
  So that I have a consistent user experience across the application

  Background:
    Given I am logged in as an administrator
    And I am on the license settings page at /settings/license

  # Layout consistency with members page pattern
  @e2e @unimplemented
  Scenario: License page uses members-style layout with description
    Then the page header shows "License" as the heading
    And the page has a description below the header explaining license management
    And the content uses the full available width
    And the layout follows the same pattern as /settings/members

  @e2e @unimplemented
  Scenario: License details card shows only essential information
    Given a valid license is installed
    Then the license card displays only:
      | Field        |
      | Plan         |
      | Licensed to  |
      | Expires      |
    And the card does NOT display resource limits
    And the card does NOT display usage statistics

  @integration @unimplemented
  Scenario: Resource limits are shown on Usage page instead of License page
    Given a valid license is installed
    When I navigate to /settings/usage
    Then I see the resource limits section showing:
      | Resource    |
      | Members     |
      | Projects    |
      | Prompts     |
      | Workflows   |
      | Scenarios   |
      | Evaluators  |
    And each resource shows current usage vs limit

  # Visual consistency with platform patterns - full system verification

  @e2e @unimplemented
  Scenario: License activation form follows platform form patterns
    Given no license is installed
    Then the "Activate License" button uses colorPalette "blue"
    And form fields use Field.Root with Field.Label components
    And the card uses platform border styling

  # Button styling compliance
  @integration @unimplemented
  Scenario: Primary buttons use colorPalette instead of colorScheme
    Given I view license components
    Then the "Activate License" button uses colorPalette "blue"

  @integration @unimplemented
  Scenario: Secondary buttons use outline variant
    Given I view license components
    Then the "Remove License" button uses variant "outline"

  @integration @unimplemented
  Scenario: Danger buttons use red colorPalette with outline variant
    Given a license is installed
    Then the "Remove License" button uses colorPalette "red"
    And the "Remove License" button uses variant "outline"

  # Card styling compliance
  @integration @unimplemented
  Scenario: License cards use platform border and spacing
    Given I view the license status section
    Then license cards use borderWidth "1px"
    And license cards use borderRadius "lg"
    And license cards use padding 6
    And card content uses VStack with gap 4

  @integration @unimplemented
  Scenario: Status badges use appropriate styling
    Given a valid license is installed
    Then the status badge uses colorPalette instead of colorScheme
    And the badge displays the plan name for valid licenses
    And the badge uses "green" colorPalette for valid status
    And the badge uses "red" colorPalette for expired or invalid status

  # Typography styling compliance
  @integration @unimplemented
  Scenario: Text elements use semantic colors
    Given I view license components
    Then label text uses "gray.500" or "fg.muted" color
    And value text uses fontWeight "medium"
    And section headers use fontWeight "semibold"
    And muted descriptive text uses "fg.muted" color

  @integration @unimplemented
  Scenario: Loading skeleton matches platform patterns
    Given the license status is loading
    Then the skeleton wrapper uses consistent card styling
    And skeleton elements use Chakra Skeleton components

  # Alert and notification styling
  @integration @unimplemented
  Scenario: Warning and error boxes follow platform patterns
    Given an expired license is installed
    Then the warning box uses backgroundColor based on status color
    And the warning box uses borderRadius "md"
    And the warning text uses appropriate status color

  # License activation error messages - user-friendly

