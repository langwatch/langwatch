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

  @unit
  Scenario: A refused Anthropic collision names the fields the two rows differed in
    Given Anthropic's cost report answers with two rows for the same day,
      workspace, model and description at different amounts
    And the rows also differ in a field the key does not carry, such as
      service tier, token type, context window or inference region
    When the read runs
    Then the page is refused and nothing from it is recorded
    And the refusal names the key the rows share
    And the refusal names the fields the two rows differed in
    And the key the rows share is not changed to tell them apart
    # The refusal already existed for two amounts under one key. It named
    # the key and stopped there. The fields that would explain the
    # collision were on the stored row all along; the guard never read
    # them. Naming them turns a dead end into a lead. The guard is not widened: two rows
    # alike in key and amount still merge, and a zero-amount repeat must
    # not wedge the source over money that does not exist. The key is not
    # widened either: it is what a re-read uses to replace an earlier
    # figure in place, and changing it would record the same spend twice.

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

  @unit
  Scenario: An exported usage record names the currency beside its amount
    When a pulled record is prepared for export
    Then the exported record carries the amount and the currency it was billed in
    And the amount does not travel under a name that says dollars
    # The currency reached the export only buried inside a bag of extra
    # fields, while the amount sat at the top under a dollar name. A reader
    # taking the export at face value read every provider as billing in
    # dollars, which for one of them is already false.

  @unit
  Scenario: A bill the provider issued in euros is not exported as a dollar figure
    Given a provider bill issued in euros
    When that day is prepared for export
    Then the euro amount is exported as euros
    And the only dollar figure exported is one the provider itself published

  # --- Days read while cost recording was off ---
  # The pull cursor advances whether or not the money path is live, because
  # audit-only is a supported way to run a source. That makes the loss one-way:
  # turning recording on later stops it growing but recovers nothing already
  # read. These say the loss out loud, so a day nobody priced reads as unknown
  # rather than as a day that cost nothing.

  @unit
  Scenario: A day read without recording cost is remembered as unpriced
    Given an organization that is not recording pulled cost
    When a source pulls a day that carries a price
    Then the day's spend is not recorded
    And the source remembers that day as one it could not price

  @unit
  Scenario: The unpriced window spans the first lost day to the last
    Given an organization that is not recording pulled cost
    When a source pulls several priced days in one run
    Then the source remembers the window from the earliest to the latest

  @unit
  Scenario: A later loss never shrinks an earlier one
    Given a source that already remembers an unpriced day
    When a later run fails to price a later day
    Then the remembered window covers both days
    # Widen-only. A short run inside a long gap must not make the gap look
    # smaller than it is.

  @unit
  Scenario: A day that never carried a price is not remembered as lost
    Given an organization that is not recording pulled cost
    When a source pulls a day with no price on it
    Then the source remembers no unpriced window

  @unit
  Scenario: Recording cost normally remembers no loss
    Given an organization that is recording pulled cost
    When a source pulls a day that carries a price
    Then the day's spend is recorded
    And the source remembers no unpriced window

  @unit
  Scenario: Reading back across the whole window clears it
    Given a source that remembers an unpriced window
    And an organization that is recording pulled cost again
    When a run prices a day at or before the start of that window
    Then the source remembers no unpriced window
    # The cost adapters re-read a whole trailing window from the source's start
    # date, so reaching the earliest lost day means reaching every later one.

  @unit
  Scenario: A re-read that starts inside the window leaves it alone
    Given a source that remembers an unpriced window
    When a run prices only a day inside that window
    Then the source still remembers the whole window
    # Half a repair is not a repair, and narrowing the window would claim days
    # that were never re-priced.

  # --- A read that stopped halfway is honest about where it stopped ---
  # A read can end for three reasons that are not errors: it hit the number
  # of pages one run may take, it ran out of time, or it failed after some
  # pages had already been read. All three end with money already gathered
  # and a period that was never finished. The collection state that follows
  # from that is specified in specs/governance/ingestion-source-health.feature;
  # what follows here is what happens to the money.

  @unit
  Scenario: A read that stops before the end keeps the money it already gathered
    Given a period that needs more than one page to read
    When the read stops early after some of them
    Then the amounts already read are recorded
    And the period is not recorded as read through to its end

  @unit
  Scenario: A read of a stored log that stops at its file limit says it stopped early
    Given a store holding more log files than one run is allowed to read
    When the read stops at that limit
    Then the run reports that it stopped before the end
    # The one source that used to hide its own limits: it ended a part read
    # and a whole read through the same exit, so nothing above it could tell
    # the two apart, and a source stuck on a fraction of its bucket read as
    # healthy forever.

  @integration
  Scenario: Restarting after a read that stopped halfway does not record the spend twice
    Given a read that recorded part of a period and then failed
    When a later read covers that period again from the start
    Then each day of the period counts once
    And the recorded total is what the provider reported rather than twice it

  # --- Reading back over a window a provider may still correct ---

  @unit
  Scenario: A cost read looks back a few days so a late correction is picked up
    Given a source that has already read money up to a recent day
    When the next cost read starts
    Then it starts a few days earlier than the day it had reached
    And it never starts before the day the connection was told to begin at
    # This provider corrects money after the fact. Reading only forward
    # meant the first figure we ever saw for a day was the last one we would
    # ever hold, and it disagreed with the provider console within a week.
    # A few days is what the sibling connection already does, and it costs
    # one request.

  @unit
  Scenario: Once a day the cost read reaches a month back
    Given a source whose last deep read was on an earlier day
    When it makes its next scheduled run
    Then that run looks a month back rather than a few days
    And once that run finishes, the runs that follow it the same day look back a few days again
    And a deep read that fails before it finishes is tried again on the next run
    # A month of corrections has to be picked up eventually, and reading a
    # month on every run multiplies this connection's traffic by its
    # cadence. The day of the last deep read is remembered alongside the
    # rest of the connection's state, so nothing new has to be scheduled to
    # make it happen. It is remembered when the deep read finishes, not when
    # it is asked for: a day whose deep read broke off has not been read.

  @unit
  Scenario: Looking back does not move the saved position backwards
    Given a cost read that started earlier than the day it had reached
    When that read finishes
    Then the position it saves is never earlier than the one it started from
    And the read after it does not look back again from the looked-back day
    # Saving the looked-back day walks the source backwards on every run
    # until it reaches the day it was first connected. An empty answer, a
    # credit, and a workspace somebody deleted all produce exactly that.

  @unit
  Scenario: The token usage read is not rewound
    Given a source reading token usage rather than money
    When the next read starts
    Then it starts where the last one finished
    # A known limit, stated rather than left to be discovered. Usage rows are
    # identified partly by how the customer asked for them to be bucketed, so
    # re-reading a period after that choice changed would land the same usage
    # beside itself rather than replacing it. Money rows carry no such choice.

  @unit
  Scenario: A cost row read again replaces the record it already exported
    Given a day whose cost was read once and written to the export
    When a later read reports a different figure for that same day
    Then the exported record for that day carries the newer figure
    And no second record is added for the same day
    # Stated because it is already what happens and reading further back
    # makes it happen far more often. A customer who took their copy of the
    # export before the correction holds a figure that no longer matches
    # ours, and neither copy says so. Adding a correction record instead is
    # a separate piece of work, deliberately not done here.

  # --- Small honesty repairs on the way in ---

  @unit
  Scenario: A read that loses per-person attribution says so before carrying on
    Given a provider that refuses to break a period down per key
    When the read falls back to asking for the period undivided
    Then the run records that it continued without per-key attribution
    And the money for the period is still recorded
    # The fallback is correct and the money survives it. What was missing was
    # any trace that it happened, so a provider quietly widening what it
    # refuses would cost every customer their attribution in silence.

  @unit
  Scenario: Days a bill was never priced for are remembered as never read
    Given a source that waited as long as it is allowed for a bill that never arrived
    When it gives up and moves on to a more recent period
    Then those days join the period the source already reports as unpriced
    And that period only ever grows to take them in, never shrinks
    And those days are not reported as costing nothing
    # Giving up is the right call: the alternative pins the source on one
    # missing bill forever. The period a source reports as unpriced is the
    # only place a reader is already shown unknown rather than zero, so the
    # abandoned days belong there and not in a field nothing renders.

  @unit
  Scenario: The cloud bill is asked only for the lines that carry AI spend
    Given a subscription billing both AI services and unrelated infrastructure
    When the bill is read
    Then the request asks only for the categories that carry AI spend
    And unrelated infrastructure lines are not recorded as AI cost

  @unit
  Scenario: A bill read that comes back with no AI lines at all is an error
    Given a subscription whose bill is asked only for the categories that carry AI spend
    When the provider answers with no lines
    Then the run fails and says no AI lines were found
    And the source reads as failing for that reason
    And the position it had reached does not move
    # An empty answer used to be recorded as a day that was priced, walking
    # the read position forward over money nobody ever saw. Before the
    # filter an empty answer was impossible on a live subscription, so
    # narrowing the request removes the accident that kept this honest.

  @unit
  Scenario: The conversation read asks the provider for the page size it intends to read
    When a source reads a period of conversations
    Then the request states the page size it wants
    # Naming a row count without stating it as a preference leaves this
    # provider free to answer with its own far larger page, so the limit on
    # how many pages one run may take bounds a much bigger read than intended.

  @unit
  Scenario: The agent list follows the provider next-page link
    Given a tenant holding more agents than one page returns
    When the agent list is read
    Then the following pages are read as well
    And no agent is left showing an identifier in place of its name
