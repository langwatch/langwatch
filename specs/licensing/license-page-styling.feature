Feature: License Settings Page Styling
  As a user
  I want the license settings page to match the platform design language
  So that I have a consistent user experience across the application

  Background:
    Given I am logged in as an administrator
    And I am on the license settings page at /settings/license

  # Layout consistency with members page pattern
  @e2e
  Scenario: License page uses members-style layout with description
    Then the page header shows "License" as the heading
    And the page has a description below the header explaining license management
    And the content uses the full available width
    And the layout follows the same pattern as /settings/members

  @e2e
  Scenario: License details card shows only essential information
    Given a valid license is installed
    Then the license card displays only:
      | Field        |
      | Plan         |
      | Licensed to  |
      | Expires      |
    And the card does NOT display resource limits
    And the card does NOT display usage statistics

  @integration
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
  @e2e
  Scenario: License generator drawer follows platform drawer styling
    When I click the "New License" button
    Then the license generator drawer opens
    And the drawer has the same frosted glass background as other platform drawers
    And the drawer has rounded corners matching other drawers
    And the drawer header and footer styling matches EvaluatorEditorDrawer
    And the primary action button uses colorPalette "blue"

  @e2e
  Scenario: License activation form follows platform form patterns
    Given no license is installed
    Then the "Activate License" button uses colorPalette "blue"
    And form fields use Field.Root with Field.Label components
    And the card uses platform border styling

  # Drawer structure compliance
  @integration
  Scenario: License generator drawer uses standard close behavior
    When I open the license generator drawer
    Then the drawer does not use Drawer.Backdrop component
    And the drawer uses closeOnInteractOutside true
    And the drawer uses modal false
    And clicking outside the drawer closes it

  @integration
  Scenario: License generator drawer header follows platform pattern
    When I open the license generator drawer
    Then the drawer header uses Heading component without explicit size override
    And the drawer header does not have explicit borderBottomWidth prop
    And the Drawer.CloseTrigger is a direct child of Drawer.Content

  @integration
  Scenario: License generator drawer body uses standard layout pattern
    When I open the license generator drawer
    Then the drawer body has padding 0
    And the drawer body has display flex with flexDirection column
    And internal content uses VStack with paddingX 6 and paddingY 4
    And internal content has overflowY auto for scrollable content

  @integration
  Scenario: License generator drawer footer follows platform pattern
    When I open the license generator drawer
    Then the drawer footer has borderTopWidth 1px
    And the drawer footer has borderColor border
    And the footer buttons use HStack with gap 3 for alignment

  @integration
  Scenario: License generator drawer uses correct size
    When I open the license generator drawer
    Then the drawer uses size "lg" for adequate form space

  # Form field styling compliance
  @integration
  Scenario: Form fields use Field.Root component pattern
    Given I open the license generator drawer
    Then each form field is wrapped in Field.Root
    And each field label uses Field.Label with fontWeight medium
    And helper text uses Field.HelperText or Text with fg.muted color
    And error messages use Field.ErrorText component

  @integration
  Scenario: Form inputs use consistent sizing
    Given I open the license generator drawer
    Then text inputs do not specify explicit size (use default)
    And textarea inputs use appropriate row count
    And select fields use NativeSelect.Root pattern

  # Button styling compliance
  @integration
  Scenario: Primary buttons use colorPalette instead of colorScheme
    Given I view license components
    Then the "Generate License" button uses colorPalette "blue"
    And the "Activate License" button uses colorPalette "blue"
    And the "Copy to Clipboard" button uses colorPalette "blue"

  @integration
  Scenario: Secondary buttons use outline variant
    Given I view license components
    Then the "Generate Another" button uses variant "outline"
    And the "Remove License" button uses variant "outline"

  @integration
  Scenario: Danger buttons use red colorPalette with outline variant
    Given a license is installed
    Then the "Remove License" button uses colorPalette "red"
    And the "Remove License" button uses variant "outline"

  # Card styling compliance
  @integration
  Scenario: License cards use platform border and spacing
    Given I view the license status section
    Then license cards use borderWidth "1px"
    And license cards use borderRadius "lg"
    And license cards use padding 6
    And card content uses VStack with gap 4

  @integration
  Scenario: Status badges use appropriate styling
    Given a valid license is installed
    Then the status badge uses colorPalette instead of colorScheme
    And the badge displays the plan name for valid licenses
    And the badge uses "green" colorPalette for valid status
    And the badge uses "red" colorPalette for expired or invalid status

  # Typography styling compliance
  @integration
  Scenario: Text elements use semantic colors
    Given I view license components
    Then label text uses "gray.500" or "fg.muted" color
    And value text uses fontWeight "medium"
    And section headers use fontWeight "semibold"
    And muted descriptive text uses "fg.muted" color

  @integration
  Scenario: Loading skeleton matches platform patterns
    Given the license status is loading
    Then the skeleton wrapper uses consistent card styling
    And skeleton elements use Chakra Skeleton components

  # Alert and notification styling
  @integration
  Scenario: Warning and error boxes follow platform patterns
    Given an expired license is installed
    Then the warning box uses backgroundColor based on status color
    And the warning box uses borderRadius "md"
    And the warning text uses appropriate status color

  # License activation error messages - user-friendly
  @e2e
  Scenario: Show user-friendly error when activating invalid license
    Given no license is installed
    When I paste an invalid license key
    And I click "Activate License"
    Then I see an error toast with title "Failed to activate license"
    And the error message is "The license key is invalid or has been tampered with. Please check the key and try again."

  @e2e
  Scenario: Show user-friendly error when activating expired license
    Given no license is installed
    When I paste an expired license key
    And I click "Activate License"
    Then I see an error toast with title "Failed to activate license"
    And the error message is "This license has expired. Please contact support to renew your license."

  @integration
  Scenario: License validation errors are user-friendly
    Given the license validation returns an error
    Then the error messages map as follows:
      | Technical Error     | User-Friendly Message                                                              |
      | Invalid license format   | The license key is invalid or has been tampered with. Please check the key and try again. |
      | Invalid signature   | The license key is invalid or has been tampered with. Please check the key and try again. |
      | License expired     | This license has expired. Please contact support to renew your license.            |

  # Unit tests for style constants
  @unit
  Scenario: Components export consistent style constants
    Given the license component files
    Then border radius values are "lg" for cards and "md" for inner elements
    And padding values follow the 6/4/3/2 scale pattern
    And color tokens use semantic naming (fg.muted, bg.subtle)

  @unit
  Scenario: Button props use colorPalette over colorScheme
    Given button component props
    When buttons need color variants
    Then colorPalette prop is used instead of colorScheme
    And this applies to all license-related buttons

  @unit
  Scenario: LicenseGeneratorDrawer uses correct Drawer configuration props
    Given the LicenseGeneratorDrawer component
    Then the Drawer.Root has size "lg"
    And the Drawer.Root has closeOnInteractOutside true
    And the Drawer.Root has modal false
    And the component does not render Drawer.Backdrop

  @unit
  Scenario: LicenseGeneratorForm uses correct layout structure
    Given the LicenseGeneratorForm component
    Then the root VStack has paddingX 6
    And the root VStack has paddingY 4
    And the VStack has flex 1 for proper sizing
    And the VStack has overflowY auto for long content
