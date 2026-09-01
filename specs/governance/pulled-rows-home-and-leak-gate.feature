@governance @ingestion
Feature: Pulled provider cost has a home and never leaks
  Cost we pull from a provider's billing records belongs to the organization,
  not to any person or team. Wave 1 gives every pulled row an explicit
  organization-level home so nothing arrives homeless, while keeping two
  promises: users never see the internal home in their own screens, and
  pulled cost never counts against anyone's spending limits.
  The home says where a row is STORED. Who the money BELONGS TO is a
  different field. Storing under the home is not attributing to it.
  Decision: ADR-128.

  Background:
    Given an organization with a connected provider source

  @integration
  Scenario: A pulled row gets the organization's governance home on arrival
    When the source pulls a usage record
    # Home = the storage partition: the ClickHouse TenantId and the event's
    # projectId are the governance project. The money's owner stays on
    # Scope/ScopeId (the source's team, else the organization) and must
    # NEVER become the governance project.
    Then the record's storage home is the organization's governance project
    And the money is attributed to the source's team or organization, never to the home

  @integration
  Scenario: The organization has exactly one governance home, created when absent
    Given the organization has no governance home yet
    And a second organization already has its own governance home
    When the source pulls a usage record
    Then a governance home exists for the organization
    And pulling again creates no second home
    And the second organization's home is untouched

  @unit
  Scenario: A provider amount in minor units becomes the correct dollar amount
    # Guards the 100x bug class (#6977): a provider reporting cents must not
    # be stored as if it reported dollars.
    Given a provider that reports cost in cents
    When a pulled record of 1234 cents is processed
    Then the stored amount equals exactly 12 dollars and 34 cents

  @integration
  Scenario: The governance home never appears anywhere members list projects
    Given the organization's governance home exists
    # Table-driven over every listing surface class: the projects REST list,
    # team/RBAC settings, the API-key scope picker, data-privacy, retention
    # and model-defaults pickers, department assignment, the caller scope
    # map, and cost-by-project. Guard-that-cannot-fail: assert FIRST that
    # the unfiltered population contains the home, THEN that each surface
    # excludes it — otherwise a seeding bug reads green.
    When a member lists projects on any listing surface
    Then the governance home is not among them
    And the same listing without the safeguard would have contained it

  @integration
  Scenario: Every filtered project listing is a surface the leak gate drives
    # The scenario above only proves the surfaces it names. A listing added
    # later would filter the home on the day it lands and could quietly stop
    # filtering it a year on with nothing failing, because no surface drives
    # it. This closes that gap in both directions.
    Given the sweep finds the project repository among the modules that filter the home
    When every filtering module is matched against the surfaces this gate drives
    Then no filtering module is left without a surface that proves it keeps filtering
    And no surface names a module that no longer filters

  @integration
  Scenario: A homed pulled row still never counts against spending limits
    Given a team whose spending is at its limit
    When a pulled usage record is stored under the governance home
    Then the team's spending limit total is not increased by the pulled cost
    # The request gate lives in the Go gateway, which consults the gateway
    # spend figure. Asserting that figure unchanged is the TS-observable
    # half of "requests still allowed"; the Go side reads the same store.
    And the spend figure the request gate consults is unchanged
