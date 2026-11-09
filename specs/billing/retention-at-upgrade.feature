Feature: Data retention choice in the Growth upgrade dialog

  The upgrade dialog shows that Growth keeps data for 90 days, lets the buyer
  pick a longer or shorter retention without blocking the upgrade, and says
  that storage above 90 days is paid per GB (EUR 3 or USD 4 per GB a month).
  Tables drop data in whole weekly partitions, so each option is a round
  number of days kept up to one week longer: 30 days is 35, 60 is 63, 90 is
  91, 180 is 182 and 1 year is 371. The dialog, the settings page and the
  plan card name each option the same way.

  Background:
    Given an organization on the Free plan
    And an administrator opens the upgrade dialog

  @unit
  Scenario: The dialog starts at 90 days, included in Growth
    Then the data retention picker shows "90 days"
    And the dialog says "Included in Growth"
    And the dialog says "You can change the retention period anytime"

  @unit
  Scenario: A shorter retention is included too
    When the administrator picks "30 days"
    Then the dialog says "Included in Growth"

  @unit
  Scenario: A longer retention shows the storage line while the estimate loads
    Given the organization's storage read has not answered yet
    When the administrator picks "1 year"
    Then the dialog shows "Storage above 90 days" at "€3 per GB a month"
    And the estimate shows a loading placeholder

  @unit
  Scenario: A longer retention shows a monthly estimate from today's storage
    Given the organization stores 49 GB over the 49 days it keeps
    When the administrator picks "180 days"
    Then the dialog estimates about 91 GB above 90 days, about €273 a month excl. VAT

  @unit
  Scenario: A failed storage read still shows the unit price
    Given the organization's storage read fails
    When the administrator picks "1 year"
    Then the dialog shows "€3 per GB a month" without an estimate
    And "Continue to checkout" is still available

  @unit
  Scenario: Dollar customers see the dollar price
    Given the organization is billed in dollars
    When the administrator picks "1 year"
    Then the dialog shows "$4 per GB a month"

  @unit
  Scenario: The picked retention travels with the checkout
    When the administrator picks "180 days" and continues to checkout
    Then the checkout is opened with a retention of 182 days

  @unit
  Scenario: The storage estimate covers the organization's age when it is young
    Given an organization created 10 days ago that keeps 49 days of traces
    When the upgrade dialog asks for its storage estimate
    Then the estimate covers 10 days of data

  @unit
  Scenario: The storage estimate sums every project in the organization
    Given an organization with two projects that store data
    When the upgrade dialog asks for its storage estimate
    Then the estimate is the sum of both projects

  @unit
  Scenario: The pending subscription keeps the picked retention
    When a Growth seat checkout is opened with a retention of 182 days
    Then the pending subscription records 182 days

  @unit
  Scenario: The paid activation sets the picked retention on the organization
    Given a pending Growth Seat subscription bought with a retention of 182 days
    When the subscription is activated by a successful payment
    Then every retention category of the organization is set to 182 days

  @unit
  Scenario: A retention that is not a Growth option is ignored
    Given a pending Growth Seat subscription that carries a retention of 40 days
    When the subscription is activated by a successful payment
    Then the organization policies are provisioned at the platform default

  @unit
  Scenario: Growth administrators can pick the same options later in settings
    Given an organization on Growth
    When an administrator opens the data retention settings
    Then the presets are 30 days, 60 days, 90 days, 180 days and 1 year

  @unit
  Scenario: The plan card names the retention the organization keeps
    Given an organization on Growth that keeps traces for 371 days
    When an administrator opens the subscription page
    Then the current plan card lists "1 year retention"

  @unit
  Scenario: The plan card says 90 days until the retention is known
    Given an organization on Growth whose retention has not loaded yet
    When an administrator opens the subscription page
    Then the current plan card lists "90 days retention"
