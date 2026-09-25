@governance @ingestion
Feature: Seat licences are pulled beside usage
  A provider bills seats whether or not anyone sits in them. The usage record
  says what was used; only the licence record says what is being paid for. So
  a source that reads a tenant's usage can also read its seat licences, and
  the two land side by side — that is what lets a customer see the seat they
  pay for and nobody uses.

  Background:
    Given a Copilot Studio source whose credential can read the tenant's licences
    And the source is reading seat licences

  @unit
  Scenario: Licence reading is on unless an admin switches it off
    Given a source created without touching the licence setting
    When its configuration is read
    Then the source reads seat licences
    And the setting is offered as a switch that is already on
    # Seats are the half of the money the conversations cannot show — a seat
    # nobody sits in produces no usage at all — so a source that reads one and
    # not the other answers "what is this costing us" wrong, and an admin
    # would have had to know the setting existed to get the right answer.

  @unit
  Scenario: A source whose licence reading is switched off reads none at all
    Given an admin switched the licence reading off
    When the source runs
    Then no licence request is made
    And the conversations are delivered as before
    # The switch is what makes this a setting rather than a constant: the
    # licence read needs its own admin consent on the tenant, and a customer
    # who only wants transcripts must be able to decline it outright rather
    # than leave a request that is refused on every run.

  @unit
  Scenario: A day already reported is not asked about again
    Given a run already reported today's licences and its position was kept
    When the source runs again the same day
    Then the licences are not asked for again
    # A licence count moves on procurement's timescale, not the log's. But
    # "once a day" is a property of the KEPT position: a run whose position
    # was thrown away has not reported anything, and the next run asks again —
    # that re-read is the subject of the replacement scenario below.

  @unit
  Scenario: Each licence pool is recorded with bought and assigned counts
    Given the tenant holds a licence pool with seats bought and some assigned
    When the source reads the licences
    Then the pool is recorded with how many seats are bought
    And with how many are assigned to a person
    # Bought minus assigned is the money conversation: seats paid for that
    # nobody sits in. Neither number alone can say that.

  @unit
  Scenario: Both reads of a re-read day describe the same pool under the same identity
    Given a day's licences were recorded and that run's position was thrown away
    When the next run reads the same day again
    Then both reads carry the same identity for the same pool and day
    # Replacement itself is the store's job and is already exercised for cost.
    # What this source must guarantee is the half a unit test can see: the
    # identity is stable, so the second read lands over the first rather than
    # beside it.

  Rule: A pool is recorded with the facts that classify it, and only a live,
    paid, per-person pool is counted as seats

    A tenant's licence list mixes real seats with pools that only look like
    them. Counting those would report money nobody is spending: a live read of
    a real tenant said 27 unused seats when the true answer was 2. The facts
    are independent — a pool can be free AND company-wide AND suspended at
    once — so the record carries each fact separately rather than one label.

    @unit
    Scenario: A pool covering the whole company is not counted as seats
      Given a licence pool that applies to the company rather than to a person
      When the source reads the licences
      Then the pool is recorded, marked as not per-person
      And it is not counted as per-person seats

    @unit
    Scenario: A free or trial pool is not counted as paid seats
      Given a licence pool whose product is free, a trial, or a developer plan
      When the source reads the licences
      Then the pool is recorded, marked as free
      And it is not counted as paid seats

    @unit
    Scenario: A suspended pool is not counted as live seats
      Given a licence pool the provider has suspended
      When the source reads the licences
      Then the pool is recorded, marked as not live
      And it is not counted as live seats

    @unit
    Scenario: A pool in its grace period still counts as live seats
      Given a licence pool the provider marks as lapsed but still in grace
      When the source reads the licences
      Then the pool is counted as live
      # The provider's own portal still honours these seats; a customer whose
      # renewal is a week late has not stopped paying for people to sit in
      # them. Dropping the pool would erase real spend exactly when the
      # customer most needs to see it.

    @unit
    Scenario: Suspended units inside a live pool are not counted as bought
      Given a live pool where some prepaid units are suspended
      When the source reads the licences
      Then the bought count excludes the suspended units
      # Suspension is per unit, not only per pool. A pool can be live with a
      # slice of its units frozen, and that slice is not being paid for.

  @unit
  Scenario: A failed licence read holds the day rather than recording zero
    Given the licence read is refused or cannot reach the provider
    When the source runs
    Then no seat count is recorded for the day
    And the next run asks again
    # Being refused says nothing about how many seats exist. A zero here would
    # be a confident wrong number that a summary would faithfully honour.

  @unit
  Scenario: A list whose every pool is unreadable holds the day
    Given the provider answers the licence read
    And no pool in the answer can be read
    When the source runs
    Then no seat count is recorded for the day
    And the next run asks again
    # A list nothing could be read from and a tenant that genuinely holds no
    # licences arrive as the same empty list. Reporting the day publishes the
    # second answer for the first, and a day already marked reported is never
    # asked about again.

  @unit
  Scenario: A day held for too long is given up rather than held forever
    Given a day whose licence read has kept failing for longer than the cap
    When the next run starts
    Then the source stops holding that day and moves on
    # Same rule as the cost window: holding is right for a refusal that is
    # merely transient. A consent that was never granted would otherwise pin
    # every run to a request that can never succeed.

  @unit
  Scenario: A failed licence read never fails a run that read conversations
    Given the source read conversations
    And the licence read is refused or cannot reach the provider
    When the source runs
    Then the conversations the run read are still recorded
    And the licence failure is not counted as a run error
    # The licence read degrades like the cost read: it holds its own day and
    # never throws, so the conversation half decides the run's fate alone.

  @unit
  Scenario: A source position written before seats existed still reads
    Given a source position stored before licences were read
    When it is read back
    Then it still parses
    And the licences are read as never yet reported
