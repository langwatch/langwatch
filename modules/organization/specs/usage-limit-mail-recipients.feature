Feature: Usage-limit mail recipients
  Billing's usage-limit mails reach an organization's administrators and remember
  when the plan-limit alert last went out, as main's organization repository did.

  @unit
  Scenario: Reads the organization with its administrators only
    Given an organization with one administrator and one member
    When billing reads it with its administrators
    Then only the administrator is listed, with their name and email

  @unit
  Scenario: Refuses an unknown organization by code
    When billing reads an organization that does not exist
    Then the read refuses with organization_not_found

  @unit
  Scenario: Records when the plan-limit alert was sent
    Given an organization that has never been alerted
    When billing records the plan-limit alert as sent
    Then the organization reads back that moment
