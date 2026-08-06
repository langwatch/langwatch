@governance @ingestion
Feature: Pulled provider usage becomes visible, attributed cost
  When we pull the record of what a customer already spent directly with an AI
  provider, that spend must show up in the usage screens they already use,
  attributed to the right team, and it must never block spending. It stays
  correct when the provider revises a number, and it is honest about which
  figures are exact and which are estimates. Decision: ADR-088.

  # Binding tags (@integration / @unit) and @scenario annotations are added
  # per scenario as each test lands, so feature-parity stays green in between.

  Background:
    Given a connected provider source that pulls usage on a schedule
    And the source belongs to an organization and a team

  Scenario: Pulled cost shows in the usage view
    When the source pulls a usage record with a known cost
    Then that cost appears in the customer's usage view

  Scenario: Pulled cost never blocks spending
    Given a team that is already over its spending limit
    When the source pulls a usage record for that team
    Then the pulled cost is recorded
    And no spending limit is tripped by it

  Scenario: Pulled cost is attributed to the source's team
    When the source pulls a usage record
    Then the recorded cost is attributed to the source's organization and team

  Scenario: A source with no resolvable team is reported as unattributed
    Given a connected source with no team configured
    When the source pulls a usage record
    Then the cost is recorded as unattributed
    And it is never attributed to an internal governance project

  Scenario: Re-pulling an unchanged period records nothing new
    Given a usage period has already been pulled
    When the same unchanged period is pulled again
    Then no additional cost is recorded

  Scenario: A corrected period replaces its earlier cost
    Given a usage period was pulled with one cost
    When the provider later reports a corrected cost for the same period
    Then the reported cost reflects the corrected figure
    And the earlier figure is not added on top

  Scenario: An exact provider cost is marked exact
    When a provider reports an exact cost for a usage record
    Then the record is marked exact

  Scenario: A self-priced usage record is marked estimate
    When a provider gives only usage quantities that we price ourselves
    Then the record is marked estimate

  Scenario: Pulled and gateway cost for the same usage are not merged
    Given the same usage is both pulled and seen by the gateway
    Then the two costs are reported separately, not summed into one total
