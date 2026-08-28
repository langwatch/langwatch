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

  @integration @unimplemented
  Scenario: A day's spend lands as one summary row per dimension combination
    When cost events for one day and one dimension combination are processed
    Then the summary holds exactly one row for that day and combination
    And its amount is the sum of those events

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Amounts in different currencies stay separate rows after compaction
    Given one day has events in two currencies
    When the day is summarized
    # Same rule as the two-spenders scenario: compact first, then assert,
    # or a currency missing from the dedup key hides until the first merge
    # deletes one currency's money.
    And the summary storage is compacted
    Then each currency keeps its own total
    And no combined single figure is produced

  @integration @unimplemented
  Scenario: A restated day reads as the restated amount even before compaction
    Given a day was summarized at one amount
    When the provider restates that day at a different amount
    # Assert WITHOUT compacting storage: both versions of the row are still
    # present, and a plain SUM would return their total. The read must be
    # version-aware (argMax / IN-tuple per ADR-015) to pass. This is the
    # test that must FAIL on a naive read.
    Then reading the summary returns only the restated amount
    And the reader can see the day was revised and what it was before

  @integration @unimplemented
  Scenario: Rebuilding the summary from history reproduces it exactly
    Given a populated summary
    # Seed inside the event-log retention horizon (ADR-022), or the replay
    # proves nothing.
    When the summary is rebuilt from the event history
    Then every row matches the original summary

  @integration @unimplemented
  Scenario: Trace cost stays out of the rollup
    # ADR-128 reserves the trace lane and excludes it from wave 1: trace
    # cost must not appear in the summary under any cost source label.
    Given the organization has trace cost for a day
    When that day is summarized and read
    Then no summary row carries trace cost

  @integration @unimplemented
  Scenario: The comparator counts a summary that drifted from its events
    Given a summary row that no longer matches the sum of its events
    When the scheduled comparator runs
    # Reported = the mismatch metric increments (prom-client counter,
    # labelled by cost source, org in the log line). Wave 1 surfaces
    # signals and sends nothing — no alert fires anywhere.
    Then the drift metric counts the mismatch
    And the mismatch details are in the log

  @unit @unimplemented
  Scenario: The summary's lag behind the event log is measured
    Given events newer than the latest summarized moment
    When the lag is computed
    # Exposed as a gauge per lane; the assertion is the computed value,
    # not a threshold or an alert.
    Then it reports how far the summary is behind
