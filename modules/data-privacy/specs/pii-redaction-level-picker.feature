Feature: The organization picks its PII redaction level on the Data Privacy page
  As an organization admin
  I want to choose between Essential and Strict PII redaction for the whole organization
  So that I can see what each level stores, and what Strict costs, before I pick it

  # Strict is the LangWatch PII Redaction Model; Essential is the included standard
  # detection, which finds emails, phones, cards, IPs and national IDs but no names
  # or street addresses. The picker reads and writes the organization's own privacy
  # rule through the same setForScope call the rule drawer saves with, changing only
  # its PII level. Everything here is behind release_pii_redaction_model_enabled on
  # LangWatch Cloud: with the flag off for the organization the page and the drawer
  # are as they were. The browser cannot see whether the deployment names a model
  # endpoint. On a self-hosted deployment the model comes with the Enterprise license,
  # never priced: licensed with the flag (the chart forces it with the endpoint), the
  # page offers the model; licensed without it, the drawer says to ask for it to be turned
  # on; unlicensed, the drawer advertises the license. A self-hosted page never names Cloud.
  # The price shown is derived from the rate billing charges (ADR-201); organizations
  # on release_pii_redaction_model_free see Strict as included instead.

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
    And Strict reads "LangWatch PII Redaction Model" with "$0.50 per 1M characters excl. VAT, pay as you go"

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
    And an organization admin already accepted the model's price
    And an organization rule on "acme" that drops trace input and leaves PII inheriting
    When an admin picks Strict in the organization PII level picker and confirms
    Then the organization rule is saved with PII level strict
    And the rule still drops trace input
    And the synthetic example shows the name and the address masked
    And the page says projects or teams with their own Strict rule keep it when the organization moves to Essential

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
    When an admin picks Strict in the organization PII level picker and confirms
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
    Then it says every span the model answers is billed by the characters sent, even when it finds nothing, with no quota or plan, and fallbacks are free
    And it says a span goes to the rule-based detector (Presidio) when the model is unavailable or the span's text is over 8,000 characters in total, and can then go to Google Cloud DLP

  @integration
  Scenario: With long-span splitting on, the small print names the split limit and how a split span is billed
    Given release_pii_redaction_model_enabled and release_pii_redaction_model_split_enabled are on for "acme"
    When an admin opens the information beside Strict's price
    Then it says a span goes to the rule-based detector (Presidio) when the model is unavailable or the span's text is over 32,000 characters in total
    And it says a span over 8,000 characters is sent to the model in several parts and billed once on its own characters, the overlap between parts free
    And where Strict is included it says only that such a span is sent in several parts, naming no billing

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
    And an organization admin accepted the model's price
    When an admin opens the Data Privacy page for project "web-app"
    Then the effective summary reads "Strict · LangWatch PII Redaction Model" for PII redaction

  @integration
  Scenario: Turning on Strict asks to confirm with the price
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Essential
    When an admin picks Strict in the organization PII level picker
    Then a confirmation names the LangWatch PII Redaction Model and its price
    And nothing is saved until the admin confirms
    When the admin cancels
    Then nothing is saved and Essential stays picked

  @integration
  Scenario: A free organization sees Strict as included and turns it on without a price
    Given release_pii_redaction_model_enabled is on for "acme"
    And release_pii_redaction_model_free is on for "acme"
    When an admin opens the Data Privacy page for project "web-app"
    Then Strict reads "Included for your organization" and names no price
    When the admin picks Strict
    Then the organization rule is saved with PII level strict without a confirmation
    And the page does not say Strict is billed

  @integration
  Scenario: An organization on Custom sees its level and confirms replacing it
    Given release_pii_redaction_model_enabled is on for "acme"
    And an organization rule on "acme" with PII level custom and two entities
    When an admin opens the Data Privacy page for project "web-app"
    Then the picker shows the organization on "Custom (2 types)" with neither level picked
    When the admin picks Essential
    Then a confirmation says it replaces the custom PII settings
    And the organization rule is saved with PII level essential once the admin confirms

  @integration
  Scenario: An organization with PII redaction off sees its level
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Off
    When an admin opens the Data Privacy page for project "web-app"
    Then the picker shows the organization on "Off" with neither level picked

  @integration
  Scenario: A self-hosted deployment without an Enterprise license advertises the license
    Given a self-hosted deployment whose organization has no Enterprise license
    When an admin opens the Data Privacy page for project "web-app"
    Then the page shows no organization PII level picker and no price
    When the admin sets a rule's PII redaction to Strict in the drawer
    Then the drawer says Strict here uses the rule-based detector
    And it shows the Enterprise lock line: the LangWatch PII Redaction Model is part of LangWatch Enterprise
    And it links to activating a license, or tells a reader who cannot manage it to ask an admin
    And it does not mention LangWatch Cloud

  @integration
  Scenario: A licensed self-hosted deployment that runs the model offers Strict on it, included
    Given a self-hosted deployment with an Enterprise license and release_pii_redaction_model_enabled forced on
    When an admin opens the Data Privacy page for project "web-app"
    Then the picker shows Strict as included with the Enterprise license, with no price
    And the drawer does not say Strict is rule-based

  @integration
  Scenario: A licensed self-hosted deployment without the model says how to turn it on
    Given a self-hosted deployment with an Enterprise license and no model configured
    When an admin opens the Data Privacy page for project "web-app"
    And the admin sets a rule's PII redaction to Strict in the drawer
    Then the drawer says Strict here uses the rule-based detector and the license includes the model, and to ask whoever runs the deployment to turn it on

  @unit
  Scenario: The page reads the license only self-hosted, and only for a reader allowed to
    Then the plan is read on a self-hosted deployment for a reader who may view the organization
    And it is never read on LangWatch Cloud
    And an Enterprise plan reads as the license, any other plan as none
    And a read in flight is loading, and a refused or failed read is unknown
    And a failed refresh is unknown, even while an earlier answer is still cached

  @unit
  Scenario: The Strict offer on a self-hosted deployment follows the license and the model flag
    Then a self-hosted deployment offers the model, never priced, only with an Enterprise license and the flag on
    And with the license and no flag it says to ask for the model to be turned on
    And without the license it advertises the license, whatever the flag says
    And while the plan is not answered yet, or cannot be read, it offers nothing
    And no self-hosted note names LangWatch Cloud

  @integration
  Scenario: A level changed elsewhere after a pick shows the stored level
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Essential
    When an admin picks Strict in the organization PII level picker and confirms
    And the stored level becomes Strict
    And a rule change later sets the organization back to Essential
    Then the picker shows Essential

  @integration
  Scenario: Saving a rule at Strict asks to confirm with the price
    Given release_pii_redaction_model_enabled is on for "acme"
    And a project rule on "web-app" with PII level essential
    When an admin sets that rule's PII redaction to Strict in the drawer and saves
    Then a confirmation names the LangWatch PII Redaction Model and its price
    And the rule is saved only once the admin confirms

  @unit
  Scenario: Saving a rule asks for the price only when it turns Strict on at a price
    Then a rule already on Strict, a free organization, a self-hosted deployment and a level other than Strict save without asking
    And so does a member who cannot accept the price while no organization admin has accepted it

  # On LangWatch Cloud a priced organization reaches the model only once an organization admin
  # accepted its price on this page (ADR-201 decision 15). Until then Strict runs the rule-based
  # detector (Presidio) at no charge, however it was set. The snapshot the page reads says
  # whether the organization accepted. A free organization and a self-hosted deployment need
  # no acceptance and see the page as before.

  @integration
  Scenario: An organization on Strict that never accepted the price sees it is rule-based, at no charge
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Strict
    And no organization admin accepted the model's price
    When an admin opens the Data Privacy page for project "web-app"
    Then the picker says "Organization on Strict (rule-based)"
    And Strict reads "Currently on rule-based (Presidio), no charge" beside its title
    And Strict offers "Switch to the PII Redaction Model" under its price
    And the page says "Switching to the model asks an organization admin to accept its price first."
    And the page does not say Strict is billed
    And the effective summary does not say Strict runs the LangWatch PII Redaction Model

  @integration
  Scenario: Accepting the price from the picker switches the organization to the model
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Strict and no organization admin accepted the price
    When an admin presses "Switch to the PII Redaction Model"
    Then a confirmation names the LangWatch PII Redaction Model and its price
    And it says the acceptance covers every Strict rule in the organization
    And nothing is accepted until the admin confirms
    When the admin confirms
    Then the organization's acceptance of the price is recorded
    And the page says Strict is billed from the next trace

  @integration
  Scenario: Picking Strict through the price prompt records the acceptance first
    Given release_pii_redaction_model_enabled is on for "acme"
    And the organization's PII level resolves to Essential and no organization admin accepted the price
    When an admin picks Strict in the organization PII level picker and confirms
    Then the acceptance is recorded, then the organization rule is saved with PII level strict
    And an acceptance that fails saves nothing and tells the admin

  @integration
  Scenario: A member who cannot accept the price is not asked it in the rule drawer
    Given release_pii_redaction_model_enabled is on for "acme"
    And no organization admin accepted the model's price
    And the caller cannot write a rule at the organization scope
    When the caller sets a project rule's PII redaction to Strict in the drawer
    Then the drawer says Strict stays rule-based, at no charge, until an organization admin accepts its price
    And the rule is saved without a price confirmation and nothing is accepted

  @integration
  Scenario: An admin saving a rule at Strict accepts the price with the confirmation
    Given release_pii_redaction_model_enabled is on for "acme"
    And no organization admin accepted the model's price
    When an admin sets a project rule's PII redaction to Strict in the drawer, saves and confirms the price
    Then the acceptance is recorded and the rule is saved

  @unit
  Scenario: Only an organization admin can accept the price
    Then accepting the PII redaction model's price is declared at organization:manage on the organization it names
    And the acceptance records the organization and the admin who accepted it

  @unit
  Scenario: The page's snapshot says whether the organization accepted the price
    Then the snapshot reads the organization's acceptance of the model's price
    And a personal project, with no organization, reads as not accepted without asking

  @unit
  Scenario: The settings page names the model's own length limit
    Given the process routes a span over PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS to Presidio
    Then the fallback note names that same limit, read from the contract
    And with long-span splitting on for the organization it names PII_REDACTION_MODEL_MAX_SPLIT_CHARACTERS instead
