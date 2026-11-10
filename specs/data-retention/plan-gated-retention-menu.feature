Feature: Plan-gated data-retention menu
  As LangWatch
  I restrict which retention lengths each plan tier can choose
  So that retention is a clear paid→enterprise packaging lever and no one can
  set an arbitrary window that is expensive or risky to apply

  # Retention length is gated by plan:
  #   - Free      cannot configure retention at all (unchanged).
  #   - Paid      may pick only the Growth options offered at upgrade: "30 days",
  #               "60 days", "90 days", "180 days" or "1 year", no custom.
  #   - Enterprise (and self-hosted) get the full menu plus a custom value.
  # The server enforces the rule at the write boundary; the menu only mirrors it.
  # Existing out-of-menu values are grandfathered — never auto-changed or deleted.

  @unit
  Scenario: A paid organization sees only the fixed Growth options
    Given an organization on a paid, non-enterprise plan
    When a manager opens the retention policy editor
    Then the only retention choices are "30 days", "60 days", "90 days", "180 days" and "1 year"
    And there is no custom option
    And there is no keep-forever option

  @unit
  Scenario: A stored preset reads as the option that was picked
    Given an organization whose retention was set to the "1 year" option
    And the stored value carries the whole-week margin
    When the retention is shown in settings
    Then it reads "1 year", not the stored number of days

  @unit
  Scenario: A paid organization cannot save an off-menu retention value
    Given an organization on a paid, non-enterprise plan
    When a manager attempts to set a retention of five years
    Then the change is rejected as not available on their plan
    And the retention is left unchanged

  @unit
  Scenario: An enterprise organization gets the full menu and a custom value
    Given an organization on an enterprise plan
    When a manager opens the retention policy editor
    Then the choices include "30 days", "60 days", "90 days", "180 days", "1 year", and "5 years"
    And a custom value is available
    When the manager enters a custom retention shorter than the recovery floor
    Then the change is rejected as below the minimum for their plan

  @unit
  Scenario: A self-hosted deployment gets the full retention range on any paid plan
    Given a self-hosted deployment whose organization is on a paid, non-enterprise plan
    When a manager sets a custom retention of one year
    Then the plan does not cap the value to the fixed pair

  @unit
  Scenario: Keep-forever stays a platform-admin capability on every plan
    Given an organization on an enterprise plan
    And the acting user is not a platform administrator
    When the manager opens the retention policy editor
    Then keep-forever is not offered
    And attempting to set keep-forever is rejected

  @integration
  Scenario: A grandfathered value is shown but never silently changed
    Given a paid organization whose traces retention was previously set to one year
    When a manager opens the retention policy editor for that scope
    Then the current value is shown as a read-only "legacy" entry
    And saving is disabled until the manager picks an available option
    And the stored retention is never shortened on its own

  @integration
  Scenario: Saving a policy from the editor never rewrites stored data by itself
    Given a manager is setting a new retention policy
    When they save it from the editor
    Then the editor saves only the scopes and the period
    And the page, not the editor, offers to apply it to stored data

  @unit
  # A checkout that carried a retention pick sets it instead: specs/billing/retention-at-upgrade.feature
  Scenario: A billing event never overwrites an existing retention policy
    Given an organization whose org-level traces retention is set to five years
    When a seat/subscription billing event without a retention pick is processed for that organization
    Then the five-year traces policy is left unchanged
    And only retention categories that had no policy are provisioned to the default
