Feature: License form defaults and unlimited plan limits
  As an administrator generating licenses
  I want sensible defaults and the ability to leave limits unlimited
  So that license creation is fast and flexible for enterprise customers

  Background:
    Given I am logged in as an administrator
    And I open the license generation drawer

  # --- Usage Unit Defaults (template-level change) ---

  @unit
  Scenario: Enterprise plan template defaults to "events" usage unit
    When resolving Enterprise plan defaults
    Then the usage unit is "events"

  @unit
  Scenario: PRO plan template defaults to "events" usage unit
    When resolving PRO plan defaults
    Then the usage unit is "events"

  @integration
  Scenario: Form loads with "events" as default usage unit
    When the form loads with the default Enterprise plan
    Then the usage unit dropdown shows "Events"

  @integration
  Scenario: Switching plan type preserves "events" as default usage unit
    When I switch the plan type to "PRO"
    Then the usage unit dropdown shows "Events"
    When I switch the plan type to "ENTERPRISE"
    Then the usage unit dropdown shows "Events"

  # --- Empty Fields = Unlimited ---

  @integration
  Scenario: Cleared number field displays Unlimited placeholder
    When I clear the "Max Members" field
    Then the field shows an empty input with an "Unlimited" placeholder

  @integration
  Scenario: Cleared number field submits as unlimited
    When I clear the "Max Members" field
    And the form is submitted
    Then the value for maxMembers is sent as unlimited

  @integration
  Scenario: All plan limit fields support empty-as-unlimited
    When I clear each plan limit field
    Then each cleared field shows the "Unlimited" placeholder
    And submitting the form sends each cleared value as unlimited

  @integration
  Scenario: Entering a number after clearing replaces unlimited
    Given I have cleared the "Max Members" field
    When I type "50" into the "Max Members" field
    Then the field shows "50"
    And when the form is submitted, the value is sent as 50

  @integration
  Scenario: Generated license stores unlimited limits correctly
    Given I fill in all required fields
    And I clear the "Max Members" field to leave it unlimited
    When I generate the license
    Then the signed license data contains maxMembers as unlimited
    And the license passes validation

  @integration
  Scenario: Plan template selection resets fields to template defaults
    Given I have cleared the "Max Members" field
    When I switch the plan type to "ENTERPRISE"
    Then "Max Members" shows the Enterprise default value of 100
    And the field is no longer in the unlimited state

  # --- Complete Form Fields ---

  @integration
  Scenario: Form includes all license plan limit fields
    When the form loads
    Then the plan limits section contains fields for:
      | Field                  |
      | Max Members            |
      | Max Lite Members       |
      | Max Teams              |
      | Max Projects           |
      | Max Messages/Month     |
      | Evaluations Credit     |
      | Max Workflows          |
      | Max Prompts            |
      | Max Evaluators         |
      | Max Scenarios          |
      | Max Agents             |
      | Max Experiments        |
      | Max Online Evaluations |
      | Max Datasets           |
      | Max Dashboards         |
      | Max Custom Graphs      |
      | Max Automations        |

  @integration
  Scenario: All plan limit fields are included in generated license
    Given I fill in all required fields with Enterprise defaults
    When I generate the license
    Then the signed license data includes all plan limit fields
    And no fields default to unlimited by omission
