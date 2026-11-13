Feature: The organization picks its PII redaction level on the Data Privacy page
  As an organization admin
  I want to choose between Essential and Strict PII redaction for the whole organization
  So that I can see what each level stores, and what Strict costs, before I pick it

  # Strict is the LangWatch PII Redaction Model; Essential is the included standard
  # detection, which finds emails, phones, cards, IPs and national IDs but no names
  # or street addresses. The picker reads and writes the organization's own privacy
  # rule through the same setForScope call the rule drawer saves with, changing only
  # its PII level. Everything here is behind release_pii_redaction_model_enabled:
  # with the flag off for the organization the page and the drawer are as they were.
  # The price shown is derived from the rate billing charges (ADR-201).

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app"

  @integration
  Scenario: Without the flag the page offers no level picker and no price
    Given release_pii_redaction_model_enabled is off for "acme"
    When an admin opens the Data Privacy page for project "web-app"
    Then the page shows no organization PII level picker
    And the page names no price and no LangWatch PII Redaction Model
    And the effective summary names the PII level as before

  @integration
  Scenario: With the flag the page offers Essential and Strict for the organization
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Essential
    When an admin opens the Data Privacy page for project "web-app"
    Then the organization PII level picker shows Essential selected
    And Essential reads "Included" and "Standard detection"
    And Strict reads "LangWatch PII Redaction Model" with "$0.50 per 1M characters, pay as you go"

  @integration
  Scenario: The example follows the selected level
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Essential
    When an admin opens the Data Privacy page for project "web-app"
    Then the synthetic example shows what Essential stores, with the name and the address left as sent
    And the example does not show what Strict stores

  @integration
  Scenario: Picking Strict writes the organization rule and shows Strict's example
    Given release_pii_redaction_model_enabled is on for "acme"
    And an organization rule on "acme" that drops trace input and leaves PII inheriting
    When an admin picks Strict in the organization PII level picker
    Then the organization rule is saved with PII level strict
    And the rule still drops trace input
    And the synthetic example shows the name and the address masked

  @integration
  Scenario: Picking Essential on a Strict organization writes Essential back
    Given release_pii_redaction_model_enabled is on for "acme"
    And an organization rule on "acme" with PII level strict
    When an admin picks Essential in the organization PII level picker
    Then the organization rule is saved with PII level essential

  @integration
  Scenario: A failed save tells the admin and keeps the level that was stored
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Essential
    And saving the organization rule fails
    When an admin picks Strict in the organization PII level picker
    Then the host is told the save failed
    And the picker still shows Essential selected

  @integration
  Scenario: A member who cannot write the organization rule sees the picker read-only
    Given release_pii_redaction_model_enabled is on for "acme"
    And the caller cannot write a rule at the organization scope
    When the caller opens the Data Privacy page for project "web-app"
    Then both levels in the organization PII level picker are disabled

  @integration
  Scenario: The billing and fallback small print sits behind the price
    Given release_pii_redaction_model_enabled is on for "acme"
    When an admin opens the information beside Strict's price
    Then it says only Strict spans are billed, with no quota or plan
    And it says a span falls back to the standard detector when the model is unavailable or the span is over 8,000 characters

  @unit
  Scenario: The price is derived from the rate billing charges
    Given billing charges 500 nano-dollars per character for the PII redaction model
    Then the page shows "$0.50 per 1M characters"

  @unit
  Scenario: Changing the organization level keeps the rest of the organization rule
    Given an organization rule with PII level custom, its entities and one exception pattern
    When the organization level is set to strict
    Then the rule's PII level is strict with no entities and the same exception pattern
    And every other field of the rule is unchanged

  @integration
  Scenario: The rule drawer shows the rule's own level and its example
    Given release_pii_redaction_model_enabled is on for "acme"
    When an admin sets a rule's PII redaction to Strict in the drawer
    Then the drawer says the rule runs the LangWatch PII Redaction Model, with its price
    And the drawer shows what Strict stores on the synthetic example
    When the admin sets it to Essential
    Then the drawer shows what Essential stores on the synthetic example

  @integration
  Scenario: Without the flag the rule drawer shows no model, price or example
    Given release_pii_redaction_model_enabled is off for "acme"
    When an admin sets a rule's PII redaction to Strict in the drawer
    Then the drawer names no LangWatch PII Redaction Model, no price and no example

  @integration
  Scenario: With the flag the effective summary names what runs the level
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Strict
    When an admin opens the Data Privacy page for project "web-app"
    Then the effective summary reads "Strict · LangWatch PII Redaction Model" for PII redaction
