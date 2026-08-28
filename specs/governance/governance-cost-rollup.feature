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
  Scenario: Two spenders with identical numbers stay two rows
    Given two different spenders with the same provider, model, day, and amount
    When their events are processed
    Then the summary holds a separate row for each spender

  @integration
  Scenario: A restated day reads as the restated amount only
    Given a day was summarized at one amount
    When the provider restates that day at a different amount
    Then reading the summary returns only the restated amount
    And the reader can see the day was revised and what it was before

  @integration
  Scenario: Rebuilding the summary from history reproduces it exactly
    Given a populated summary
    When the summary is rebuilt from the event history
    Then every row matches the original summary

  @integration
  Scenario: Amounts in different currencies are never added together
    Given one day has events in two currencies
    When the day is summarized and read
    Then each currency keeps its own total
    And no combined single figure is produced

  @integration
  Scenario: The comparator flags a summary that drifted from its events
    Given a summary row that no longer matches the sum of its events
    When the scheduled comparator runs
    Then the mismatch is reported

  @unit
  Scenario: The summary's lag behind the event log is measured
    Given events newer than the latest summarized moment
    When the lag is computed
    Then it reports how far the summary is behind
