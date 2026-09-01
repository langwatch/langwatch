@governance @cost
Feature: Daily cost rollup that can always be rebuilt and never lies
  Every cost event folds into one summary row per day and dimension. The
  summary is a pure consequence of the event history: rebuild it and you get
  the same numbers. When a provider revises a day, the new figure replaces
  the old on screen and the change stays visible. Different currencies stay
  different numbers. Watchdogs catch drift before a customer does.
  Decision: ADR-128.

  Background:
    Given an organization with recorded cost events

  @integration
  Scenario: A day's spend lands as one summary row per dimension combination
    When cost events for one day and one dimension combination are processed
    Then the summary holds exactly one row for that day and combination
    And its amount is the sum of those events

  @integration
  Scenario: Two spenders with identical numbers stay two rows after compaction
    Given two different spenders with the same provider, model, day, and amount
    When their events are processed
    # Force the background merge (OPTIMIZE ... FINAL) BEFORE asserting.
    # Storage keeps both rows until it compacts, so without forcing the
    # merge this passes even when the spender is missing from the dedup key
    # — and then the first real merge silently deletes one spender's money
    # (the migration-00069 bug class named by ADR-128).
    And the summary storage is compacted
    Then the summary still holds a separate row for each spender

  @integration
  Scenario: Amounts in different currencies stay separate rows after compaction
    Given one day has events in two currencies
    When the day is summarized
    # Same rule as the two-spenders scenario: compact first, then assert,
    # or a currency missing from the dedup key hides until the first merge
    # deletes one currency's money.
    And the summary storage is compacted
    Then each currency keeps its own total
    And no combined single figure is produced

  @integration
  Scenario: A restated day reads as the restated amount even before compaction
    Given a day was summarized at one amount
    When the provider restates that day at a different amount
    # Assert WITHOUT compacting storage: both versions of the row are still
    # present, and a plain SUM would return their total. The read must be
    # version-aware (argMax / IN-tuple per ADR-015) to pass. This is the
    # test that must FAIL on a naive read.
    Then reading the summary returns only the restated amount
    And the reader can see the day was revised and what it was before

  @unit
  Scenario: A pulled event in another currency is summarized under that currency
    Given a pulled usage event whose provider billed in a currency other than dollars
    When that event is summarized
    Then the summary row names the currency the event carried
    And it is not filed under dollars
    # Driven through the real summarizing step from a real event, not by
    # building the row by hand: the currency has to survive the trip from the
    # event, and a hand-built row proves only that the row has a field.

  @unit
  Scenario: A non-dollar day reports no dollar figure unless the biller gave one
    Given a pulled usage event in a currency other than dollars
    And the provider published no dollar equivalent for it
    When that event is summarized
    Then the row's dollar figure is absent rather than zero
    And the row still carries the full amount in the currency it was billed in
    # Absent and zero are different facts. Zero charts as free usage and would
    # quietly erase real spend from a dollar total; absent says we hold money
    # here that no dollar column can honestly state.

  @unit
  Scenario: The biller's own dollar conversion is what the dollar figure reports
    Given a pulled usage event carrying both its own currency and the biller's dollar equivalent
    When that event is summarized
    Then the row keeps the provider's own amount and currency
    And the row's dollar figure is the one the provider published
    And that figure is not derived from the original amount by any rate
    # We never invent a rate. The only dollar figure we will state is one the
    # biller itself stands behind, and it is a separate number carried from
    # ingest rather than anything this step calculates.

  @unit
  Scenario: A day in two currencies keeps a separate running total for each
    Given one day holding events in two different currencies
    When they are summarized
    Then each currency has its own total
    And no total mixes the two

  @unit
  Scenario: A credit summarizes against the charge it reverses
    Given a day holding one charge and a later credit of the same size in the same currency
    And the two are separate items rather than a revision of one
    When they are summarized
    Then the day's total for that currency reads as zero
    # Two items, not a restatement: a restatement replaces and would read as
    # zero even if credits were being dropped, which is the failure this is
    # meant to catch.

  @unit
  Scenario: The watchdog compares the amount in the currency it was billed in
    Given a summary row in a currency other than dollars that disagrees with its events
    When the comparator runs
    Then the drift is counted
    # Comparing the dollar column makes the watchdog blind exactly where that
    # column is empty by design — every non-dollar row, where both sides read
    # as absent and agree with each other while the real amounts differ. The
    # comparison has to be on the billed amount, which every row has.

  @integration
  Scenario: Rebuilding the summary from history reproduces it exactly
    Given a populated summary
    # Seed inside the event-log retention horizon (ADR-022), or the replay
    # proves nothing.
    When the summary is rebuilt from the event history
    Then every row matches the original summary

  @integration
  Scenario: Trace cost stays out of the rollup
    # ADR-128 reserves the trace lane and excludes it from wave 1: trace
    # cost must not appear in the summary under any cost source label.
    Given the organization has trace cost for a day
    When that day is summarized and read
    Then no summary row carries trace cost

  @integration
  Scenario: The comparator counts a summary that drifted from its events
    Given a summary row that no longer matches the sum of its events
    When the scheduled comparator runs
    # Reported = the mismatch metric increments (prom-client counter,
    # labelled by cost source, org in the log line). Wave 1 surfaces
    # signals and sends nothing — no alert fires anywhere.
    Then the drift metric counts the mismatch
    And the mismatch details are in the log

  @unit
  Scenario: The summary's lag behind the event log is measured
    Given events newer than the latest summarized moment
    When the lag is computed
    # Exposed as a gauge per lane; the assertion is the computed value,
    # not a threshold or an alert.
    Then it reports how far the summary is behind
