@governance @ingestion
Feature: Pulled provider cost has a home and never leaks
  Cost we pull from a provider's billing records belongs to the organization,
  not to any person or team. Wave 1 gives every pulled row an explicit
  organization-level home so nothing arrives homeless, while keeping two
  promises: users never see the internal home in their own screens, and
  pulled cost never counts against anyone's spending limits.
  Decision: ADR-128.

  Background:
    Given an organization with a connected provider source

  @integration
  Scenario: A pulled row gets the organization's governance home on arrival
    When the source pulls a usage record
    Then the record is stored under the organization's governance home
    And the fields that would name a spender stay empty

  @integration
  Scenario: The governance home never appears in user-facing lists
    Given the organization's governance home exists
    When a member lists their projects
    Then the governance home is not among them

  @integration
  Scenario: A homed pulled row still never counts against spending limits
    Given a team whose spending is at its limit
    When a pulled usage record is stored under the governance home
    Then the team's spending limit is not tripped by the pulled cost
    And gateway requests for that team are still allowed
