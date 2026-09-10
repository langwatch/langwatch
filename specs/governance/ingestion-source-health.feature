@governance @ingestion
Feature: A broken puller is visible, a flaky one is not
  A cost number that silently stops updating is worse than an error: it reads
  as "we spent nothing". A source that keeps failing must say so on the
  screen, a single flake must not cry wolf, and a day with no data must never
  be shown as zero dollars.
  Decision: ADR-128.

  Background:
    Given an organization with a connected provider source

  @unit
  Scenario: A single failed run does not mark the source unhealthy
    Given the source's last run succeeded
    When one run fails
    Then the source is still considered healthy

  @unit
  Scenario: Three consecutive failed runs mark the source unhealthy
    When three runs in a row fail
    Then the source is marked unhealthy

  @unit
  Scenario: A successful run records its time and resets the failure count
    Given the source has two consecutive failed runs
    When a run succeeds
    # The success time is a NEW field on the source, distinct from the
    # existing last-event time. A test satisfiable by writing lastEventAt
    # proves nothing — ADR-128 disqualifies that field by name, because it
    # only moves when events arrive.
    Then the source's last-successful-run time is updated
    And the consecutive-failure count starts over

  @unit
  Scenario: A run that partly succeeded does not reset the failure count
    Given the source has two consecutive failed runs
    When a run completes but reports errors alongside its progress
    Then the consecutive-failure count is neither reset nor increased
    And the last-successful-run time is not updated
    # A run that delivered something but also hit errors — unreadable rows it
    # stepped over, a next-page link it refused to follow — is not the clean
    # run that proves the source works. Counting it as one stamped a fresh
    # success over exactly the signals that were meant to be loud.

  @unit
  Scenario: A run that finds nothing new still counts as a success
    Given the provider reports no new usage for the period
    When the run completes without error
    Then it counts as a successful run, not a failure
    And the last-successful-run time is updated
    And the last-event time stays unchanged

  @integration
  Scenario: A day with no data is shown as unknown, never as zero
    Given the source has been unhealthy since its last successful pull
    When a viewer looks at a day after that last successful pull
    Then the screen says there is no data since the last successful pull
    And the day is not shown as zero spend

  # --- A run that stopped early is not the run that proves the source works ---
  # A page limit or a time limit ends a run with nothing to report as an
  # error, so every honesty rule above reasons from the moment that run
  # finished: days after it are called collected, and days nobody read are
  # shown as costing nothing. What those rules actually need is the point
  # the read reached, which is never later than the run that made it and is
  # often much earlier. The far side of these is already pinned by the two
  # scenarios above - a run that drained the period, and one that found
  # nothing new, both still count as successes.

  @unit
  Scenario: A run that stopped at its page limit records the point it read through to
    Given the provider holds more pages than one run is allowed to read
    When the run stops at that limit without reporting an error
    Then the run records the point it read through to
    And the run is remembered as having stopped before the end

  @unit
  Scenario: A run that ran out of time before the end is remembered the same way
    Given the provider still holds pages the run has not read
    When the run stops because it ran out of time, without reporting an error
    Then the run records the point it read through to
    And the run is remembered as having stopped before the end

  @unit
  Scenario: A source whose last run stopped early is shown as partly collected
    Given a source whose last run stopped before the end
    When a viewer looks at the source
    Then the source reads as partly collected rather than as active
    And it names the date and the time that run read through to
    And it states no date for a collection that never finished
    # The invented completion date is the worst of the three: it is the one
    # sentence on the page a reader would take as proof the period is whole.
    # The point carries a time as well as a date because a page limit stops
    # in the middle of a day, and a date alone rounds that day up to reached.

  @unit
  Scenario: A source stuck half-read keeps reporting the same stopped-at point
    Given a source whose runs keep stopping at the same point
    When a viewer looks at it after several of those runs
    Then it still reads as partly collected
    And the point it stopped at is the one the run before it reported
    # This is the whole visible difference between a source that stopped
    # early once and then finished, which reads as active again with a
    # later point, and one that is stuck, which reads as partly collected
    # with a point that never moves. Nothing else on the page separates
    # them, and elapsed time is not something anything here measures.

  @unit
  Scenario: A day a run never reached is not treated as collected
    Given the source's last run stopped before the end
    When a viewer looks at a day after the point that run read through to
    Then the day is reported as not collected
    And the day is not shown as zero spend

  @unit
  Scenario: A day the provider had not yet published is not treated as collected
    Given a run that finished without error
    And the newest figures the provider had published were older than the run itself
    When a viewer looks at a day between the two
    Then the day is reported as not collected
    # A run that genuinely drained everything on offer still stops where the
    # provider stops. Reasoning from the clock rather than from the data
    # claims a day was collected on every provider that publishes late.

  @unit
  Scenario: A source that has never finished a run still says how far it got
    Given a source whose runs have all stopped before the end
    When a viewer looks at where the figures stop being complete
    Then it says the source has collected up to the point it reached and not finished
    And the source is not passed over as having nothing to report
    # Silence is the worst answer available here. A source that has never
    # completed a run has no successful run to date a gap from, so a rule
    # that reads only that date drops the one source most likely to be wrong.
