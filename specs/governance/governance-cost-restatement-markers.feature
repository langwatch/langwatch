@governance @cost
Feature: A cost day says how much to trust its own figure
  Providers restate what a day cost, sometimes weeks later, and no provider
  ever tells us a day is final. So a day carries two independent markers: it
  was already revised, and it can still change. Both are read from our own
  record of when a pull last looked at that day, never from the calendar and
  never from the clock at the moment we happen to render.
  Decision: ADR-128 section 15.

  Background:
    Given an organization with recorded cost events

  @unit
  Scenario: A restated day shows what it was before
    Given a day was reported at one amount
    When the provider restates that day at a different amount
    Then the day reads as the restated amount
    And it names the amount it held before
    And it records when the restatement was observed

  @unit
  Scenario: A re-pull that confirms the same amount is not a revision
    Given a day was reported at one amount
    When a later pull reports that same day at the same amount
    Then the day is not marked as revised
    And it names no earlier amount
    # Otherwise the screen says "revised, was $X" with X equal to the figure
    # on display, which is a marker contradicting the number beside it.

  @unit
  Scenario: A re-pull that confirms the same amount still refreshes the day
    Given a day was reported at one amount
    When a later pull reports that same day at the same amount
    Then the day records the later pull as the last time it was observed
    # This is the observation that says the provider has stopped moving the
    # day, and it is the only thing that can ever let the day read as settled.

  @unit
  Scenario: A day a pull touched recently can still change
    Given a day a pull touched within the settling window
    When the cost screen reads that day
    Then the day is marked as able to still change

  @unit
  Scenario: A day no pull has touched for longer than the settling window reads settled
    Given a day no pull has touched for longer than the settling window
    When the cost screen reads that day
    Then the day is not marked as able to still change
    # Anchored on the pull, not the calendar. A first connect backfills ninety
    # days at once, so a calendar test would call every one of them settled the
    # instant it landed, having been read exactly once.

  @unit
  Scenario: A day that was revised and can still change says both
    Given a day was restated and a pull touched it within the settling window
    When the cost screen reads that day
    Then the day says it was revised, what it was, and that it may still change
    # The common case, not an edge one: providers restate inside the same
    # window the settling test covers.

  @unit
  Scenario: Gateway days never claim they might change
    Given a day whose cost the gateway metered as it served the traffic
    When the cost screen reads that day
    Then the day is not marked as able to still change
    # We metered it ourselves and nobody restates it, so a warning here would
    # be about something that cannot happen — on the most-viewed numbers.

  @unit
  Scenario: A revised day whose earlier figure cannot be stated in dollars withholds it
    Given a day was restated but part of it holds no amount in US dollars
    When the cost screen reads that day
    Then the day is marked as revised
    And it names no earlier amount
    # A partial earlier figure reads as the whole one, which is the same lie
    # the lane total already refuses to tell.

  @unit
  Scenario: Replaying the event log reproduces when each day was last observed
    Given a day observed by several pulls
    When the summary is rebuilt from the event log
    Then each day reports the same last-observed time as before the rebuild
    # The value is the pull's own observation time carried on the event. Read
    # off the clock instead, a replay would stamp every day as observed today,
    # and an erasure that deletes and replays would flip long-settled days
    # back to changeable just because somebody was erased.

  @unit
  Scenario: Rebuilding after a stale observation is redelivered keeps the newer time
    Given a day observed by a later pull
    When an earlier observation of another item in that day is delivered afterwards
    Then the day still reports the later pull as the last time it was observed
    # The fold has no re-fold path and its events arrive in any order, so the
    # anchor has to be order-independent or a redelivery moves it backwards.

  @integration
  Scenario: The markers survive a read taken before storage compacts
    Given a day was restated
    When the summary is read before storage is compacted
    Then the read returns only the newest revision marker and last-observed time
    # Both versions of the row are still present, and a read that is not
    # replacement-aware returns the older marker beside the newer amount.

  @integration
  Scenario: A day summarized before the markers existed reads as settled
    Given a day summarized before the markers were added to storage
    When the cost screen reads that day
    Then the day is not marked as revised
    And it is not marked as able to still change
    # The deliberate backfill. The pullers look thirty days back, so any day
    # genuinely still settling is re-stamped by the next daily pull, and any
    # day this called settled was one no pull was going to touch again.
