Feature: Plan-gated data-retention menu
  As LangWatch
  I restrict which retention lengths each plan tier can choose
  So that retention is a clear paid→enterprise packaging lever and no one can
  set an arbitrary window that is expensive or risky to apply

  # Retention length is gated by plan:
  #   - Free      cannot configure retention at all (unchanged).
  #   - Paid      may pick only "1 month" or "2 months" — a fixed pair, no custom.
  #   - Enterprise (and self-hosted) get the full menu plus a custom value.
  # The server enforces the rule at the write boundary; the menu only mirrors it.
  # Existing out-of-menu values are grandfathered — never auto-changed or deleted.

  Scenario: A paid organization sees only the two fixed options
    Given an organization on a paid, non-enterprise plan
    When a manager opens the retention policy editor
    Then the only retention choices are "1 month" and "2 months"
    And there is no custom option
    And there is no keep-forever option

  Scenario: A paid organization cannot save an off-menu retention value
    Given an organization on a paid, non-enterprise plan
    When a manager attempts to set a retention of one year
    Then the change is rejected as not available on their plan
    And the retention is left unchanged

  Scenario: An enterprise organization gets the full menu and a custom value
    Given an organization on an enterprise plan
    When a manager opens the retention policy editor
    Then the choices include "1 month", "2 months", "3 months", "1 year", and "5 years"
    And a custom value is available
    When the manager enters a custom retention shorter than the recovery floor
    Then the change is rejected as below the minimum for their plan

  Scenario: Keep-forever stays a platform-admin capability on every plan
    Given an organization on an enterprise plan
    And the acting user is not a platform administrator
    When the manager opens the retention policy editor
    Then keep-forever is not offered
    And attempting to set keep-forever is rejected

  Scenario: A grandfathered value is shown but never silently changed
    Given a paid organization whose traces retention was previously set to one year
    When a manager opens the retention policy editor for that scope
    Then the current value is shown as a read-only "legacy" entry
    And saving is disabled until the manager picks an available option
    And the stored retention is never shortened on its own

  Scenario: Applying a change to existing data is opt-in, not automatic
    Given a manager is setting a new retention policy
    When the editor opens
    Then "apply this change to existing data" is off by default
    So that saving a policy never rewrites existing data unless explicitly chosen

  Scenario: A billing event never overwrites an existing retention policy
    Given an organization whose org-level traces retention is set to five years
    When a seat/subscription billing event is processed for that organization
    Then the five-year traces policy is left unchanged
    And only retention categories that had no policy are provisioned to the default
