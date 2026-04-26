Feature: License Settings Page Styling
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

  # Drawer structure compliance
  @integration @unimplemented
  Scenario: License generator drawer uses standard close behavior
    When I open the license generator drawer
    Then the drawer does not use Drawer.Backdrop component
    And the drawer uses closeOnInteractOutside true
    And the drawer uses modal false
    And clicking outside the drawer closes it

  @integration @unimplemented
  Scenario: License generator drawer header follows platform pattern
    When I open the license generator drawer
    Then the drawer header uses Heading component without explicit size override
    And the drawer header does not have explicit borderBottomWidth prop
    And the Drawer.CloseTrigger is a direct child of Drawer.Content

  @integration @unimplemented
  Scenario: License generator drawer body uses standard layout pattern
    When I open the license generator drawer
    Then the drawer body has padding 0
    And the drawer body has display flex with flexDirection column
    And internal content uses VStack with paddingX 6 and paddingY 4
    And internal content has overflowY auto for scrollable content

  @integration @unimplemented
  Scenario: License generator drawer footer follows platform pattern
    When I open the license generator drawer
    Then the drawer footer has borderTopWidth 1px
    And the drawer footer has borderColor border
    And the footer buttons use HStack with gap 3 for alignment

  @integration @unimplemented
  Scenario: License generator drawer uses correct size
    When I open the license generator drawer
    Then the drawer uses size "lg" for adequate form space

  # Form field styling compliance
  @integration @unimplemented
  Scenario: Form fields use Field.Root component pattern
    Given I open the license generator drawer
    Then each form field is wrapped in Field.Root
    And each field label uses Field.Label with fontWeight medium
    And helper text uses Field.HelperText or Text with fg.muted color
    And error messages use Field.ErrorText component

  @integration @unimplemented
  Scenario: Form inputs use consistent sizing
    Given I open the license generator drawer
    Then text inputs do not specify explicit size (use default)
    And textarea inputs use appropriate row count
    And select fields use NativeSelect.Root pattern

  # Button styling compliance
  @integration @unimplemented
  Scenario: Primary buttons use colorPalette instead of colorScheme
    Given I view license components
    Then the "Generate License" button uses colorPalette "blue"
    And the "Activate License" button uses colorPalette "blue"
    And the "Copy to Clipboard" button uses colorPalette "blue"

  @integration @unimplemented
  Scenario: Secondary buttons use outline variant
    Given I view license components
    Then the "Generate Another" button uses variant "outline"
    And the "Remove License" button uses variant "outline"

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

  @unit @unimplemented
  Scenario: LicenseGeneratorForm uses correct layout structure
    Given the LicenseGeneratorForm component
    Then the root VStack has paddingX 6
    And the root VStack has paddingY 4
    And the VStack has flex 1 for proper sizing
    And the VStack has overflowY auto for long content
