Feature: Process wakes are claimed by one worker at a time
  As an operator of the process-manager substrate
  I want every due wake handed to one worker
  So that wake throughput grows with the fleet instead of being spent on revision conflicts.

  Every worker polls by leasing due wakes: one statement moves each claimed wake's next wake time
  a lease ahead, so concurrent workers take disjoint batches. The handler's commit sets the real
  next wake. A handler that fails hands its claim back, so the wake is due again at its own time
  and stays visible to the overdue gauge and the wake-lag alert; only a crashed worker's claim
  runs to its end. A claim never moves the process revision, so the revision fence still decides
  any wake two workers both reach. Finding due wakes stays a plain read.

  Rule: The store hands each due wake to one claimer

    @unit @integration
    Scenario: Concurrent claims take disjoint batches
      Given more due wakes than one claim takes
      When several workers claim due wakes at the same moment
      Then no wake is handed to two workers
      And every due wake is handed to one of them

    @unit @integration
    Scenario: Finding due wakes claims nothing
      Given a wake due at an instant in the past
      When a caller finds due wakes twice
      Then both finds list the wake with the instant it was due
      And a worker can still claim it

    @unit @integration
    Scenario: A claimed wake carries the time it was due
      Given a wake due at an instant in the past
      When a worker claims it
      Then the claim reports the instant the wake was due, not the end of the lease
      And the claim reports the revision that scheduled the wake

    @unit @integration
    Scenario: A claimed wake nobody commits or releases fires again after its lease
      Given a worker claimed a due wake and crashed before handling it
      When other workers poll before and after the lease ends
      Then the poll before the lease ends is handed nothing
      And the poll after the lease ends is handed the wake at the same revision

    @unit @integration
    Scenario: A handled wake is next due when its handler said
      Given a worker claimed a due wake
      When the wake's handler commits a next wake time
      Then the process is next due at the handler's time, not at the end of the lease

    @unit @integration
    Scenario: A released claim is due again at the time it was first due
      Given a worker claimed a due wake
      When the worker releases the claim unhandled
      Then the process is due again at the instant the wake was first due
      And the next claim reports that instant at the same revision

    @unit @integration
    Scenario: Releasing a claim after a commit re-armed the wake changes nothing
      Given a worker claimed a due wake
      And a commit has since set the process's next wake time
      When the claim is released
      Then the release reports that it was not applied
      And the process stays due at the time the commit set

  Rule: A wake worker handles only what it claimed, inside its claim

    @unit
    Scenario: Racing wake workers handle a due wake once
      Given two wake workers polling the same due wake
      When both poll at the same moment
      Then only one worker is handed the wake
      And exactly one commit advances the process
      And the woken process schedules its next wake from the time the wake was due

    @unit
    Scenario: A wake whose handling fails is due again on the next poll
      Given a worker claimed a due wake and its handling failed
      When another worker polls long before the claim would have lapsed
      Then it is handed the wake with the time it was first due
      And its commit schedules the next wake from that time

    @unit
    Scenario: A worker leaves the tail of a batch its claim has run out on
      Given a worker claimed a batch of due wakes
      And handling the first wake outlasted the claim
      When the worker reaches the rest of the batch
      Then it hands none of them to their handlers
      And it releases their claims back to the times they were due
      And another worker is handed them on its next poll
