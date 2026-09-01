@governance @ingestion
Feature: Pulled provider usage becomes visible, attributed cost
  When we pull the record of what a customer already spent directly with an AI
  provider, that spend must show up in the usage screens they already use,
  attributed to the right team, and it must never block spending. It stays
  correct when the provider revises a number, and it is honest about which
  figures are exact and which are estimates. Decision: ADR-088.

  Background:
    Given a connected provider source that pulls usage on a schedule
    And the source belongs to an organization

  @integration
  Scenario: Pulled cost shows in the usage view
    When the source pulls a usage record with a known cost
    Then that cost appears in the customer's usage view

  @integration
  Scenario: Pulled cost never blocks spending
    Given the source belongs to a team whose spending is at its limit
    When the source pulls a usage record whose cost would exceed that limit
    Then the pulled cost is recorded
    And the team's spending limit is not tripped by the pulled cost
    And gateway requests for that team are still allowed

  @unit
  Scenario: The pulled-cost exclusion changes the budget rollup in place
    Given the migration that excludes pulled cost from budget totals
    Then it changes the rollup view's query in place, rather than dropping and
      recreating the view
    And it keeps the filter that excludes pulled scope
    And it keeps the spend column that budget enforcement reads

  @integration
  Scenario: Pulled cost is attributed to the source's team
    Given the source belongs to a team
    When the source pulls a usage record
    Then the recorded cost is attributed to that team and its organization

  @integration
  Scenario: A source with no team is attributed to its organization
    Given the source has no team configured
    When the source pulls a usage record
    Then the cost is attributed to the organization, with no team
    And it is never attributed to an internal governance project

  @integration
  Scenario: Re-pulling an unchanged period records nothing new
    Given a usage period has already been pulled
    When the same unchanged period is pulled again
    Then no additional cost is recorded

  @integration
  Scenario: A corrected period replaces its earlier cost
    Given a usage period was pulled with one cost
    When the provider later reports a corrected cost for the same period
    Then the reported cost reflects the corrected figure
    And the earlier figure is not added on top

  # --- Money the provider reports as a credit ---

  @unit
  Scenario: A refunded day is recorded as the credit the provider reported
    Given a provider reports a day's cost as a credit rather than a charge
    When the source pulls that day
    Then the recorded amount is the credit, with its sign intact
    # Clamping it to zero does not make the books safer, it makes them wrong in
    # the customer's disfavour: the charge that the credit reverses is already
    # recorded, so dropping the credit leaves them looking like they spent
    # money the provider has since given back.

  @unit
  Scenario: Widening money to allow credits does not admit values that are not money
    When a provider sends a cost that is not a number at all
    Then the record is recorded at zero rather than carrying the unusable value
    # A guard on the same boundary the scenario above loosens, not new
    # behaviour: allowing a minus sign must not be done by removing the check
    # that the value is a number, which is the cheapest way to make the
    # scenario above pass and the one that lets "banana" through as money.

  @unit
  Scenario: An exact provider cost is marked exact
    When a provider reports an exact cost for a usage record
    Then the record is marked exact

  @unit
  Scenario: A self-priced usage record is marked estimate
    When a provider gives only usage quantities that we price ourselves
    Then the record is marked estimate

  @integration
  Scenario: Pulled and gateway cost for the same usage are not merged
    Given the same usage is both pulled and seen by the gateway
    Then the two costs are reported separately, not summed into one total

  # --- Currency travels with the money ---

  @unit
  Scenario: A record from a provider that bills in another currency says which
    When a source pulls a record priced in a currency other than dollars
    Then the record carries that currency alongside the amount
    And no exchange rate is applied anywhere on the way in

  @unit
  Scenario: A record whose provider states no currency is treated as dollars
    When a source pulls a record that names no currency
    Then the record is treated as dollars
    # Every source shipped before this existed reported dollars, so this is
    # what they already meant. It is a default, not a guess about a provider
    # that told us something else.

  @unit
  Scenario: Records already on the durable log still read after the change
    Given a usage record written before money carried a currency
    When it is read back
    Then it still parses
    And it reads as dollars with no biller conversion
    # The event log is append-only history. A shape change that cannot read
    # what is already on it is a rebuild, not a migration.
