Feature: Inherit option on privacy rules
  As an admin editing a privacy rule
  I want every setting to offer an "Inherit" choice that shows what it resolves to
  So that I can leave a setting to the wider scope, or the platform default,
  without guessing whether a value is my own or inherited

  # A privacy rule sets only the fields an admin chooses; every other field
  # inherits from the next scope up the cascade (department, team, organization)
  # and finally the platform default. The drawer makes that explicit: every
  # control, the four content categories, PII redaction, secrets redaction, and
  # each custom-attribute rule, offers "Inherit" as its first choice and shows
  # what the field currently resolves to, so an admin sees the inherited value
  # before deciding to override it. "Inherit" is the default for a brand-new
  # rule, so an empty rule changes nothing until a field is set, and reverting a
  # field to "Inherit" hands it back to the wider scope.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app"

  @integration
  Scenario: Every content category offers Inherit as its first choice
    When an admin opens the privacy rule drawer for project "web-app"
    Then each content category offers "Inherit", "Captured", "Restricted", and "Dropped"
    And PII redaction offers "Inherit" alongside the off and level choices
    And secrets redaction offers "Inherit" alongside on and off

  @integration
  Scenario: A new rule starts with every setting inheriting
    When an admin opens the privacy rule drawer to add a rule for project "web-app"
    Then every content category shows "Inherit"
    And PII redaction shows "Inherit"
    And secrets redaction shows "Inherit"

  @integration
  Scenario: An inherited setting shows the value it resolves to
    Given an organization rule on "acme" that drops trace input
    When an admin opens the privacy rule drawer to add a rule for project "web-app"
    Then trace input shows "Inherit" resolving to "Dropped"

  @unit
  Scenario: Saving a rule with everything inheriting stores a rule that sets no fields
    Given an admin opens the privacy rule drawer for project "web-app"
    And every setting is left on "Inherit"
    When the rule is saved
    Then the stored rule sets no fields
    And project "web-app" resolves to the same policy as before the rule

  @unit
  Scenario: Setting one category leaves the rest inheriting
    Given an admin opens the privacy rule drawer for project "web-app"
    When the admin sets trace input to "Dropped" and leaves the rest on "Inherit"
    And the rule is saved
    Then the stored rule sets only trace input to dropped
    And trace output, system instructions, and tool calls still inherit

  @integration
  Scenario: Editing a rule shows unset fields as Inherit, not as a concrete default
    Given a project rule on "web-app" that only drops trace input
    When an admin opens that rule in the drawer
    Then trace input shows "Dropped"
    And trace output, system instructions, and tool calls show "Inherit"
    And the inherited categories are not shown as "Captured"

  @unit
  Scenario: Reverting a field to Inherit removes it from the rule
    Given a project rule on "web-app" that drops trace input and captures trace output
    When an admin sets trace input back to "Inherit"
    And the rule is saved
    Then the stored rule no longer sets trace input
    And trace input resolves from the wider scope again

  @integration
  Scenario: At the organization scope, Inherit resolves to the platform default
    When an admin opens the privacy rule drawer for the "acme" organization
    Then each content category shows "Inherit" resolving to "Captured"
    And PII redaction shows "Inherit" resolving to "Essential"
    And secrets redaction shows "Inherit" resolving to "On"
