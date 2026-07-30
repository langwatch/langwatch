# Design: dev/docs/adr/108-the-dispatch-plane.md (decision 11)
# Related: dev/docs/adr/107-the-pipeline.md (decision 9: absent vs undecodable;
# decision 16: an intent's key may not depend on the clock)
#
# Merges process-manager-inbox-key.feature, scheduled-process-arming.feature
# and post-event-work.feature, deleted once every scenario below accounts for
# one of theirs. Scenarios owned by a sibling module not yet built in this
# change (the Prisma-backed ProcessStore, the event producer's hand-off retry,
# the live-notification subscriber) are carried forward as @unimplemented
# rather than dropped — they are still true, just not bound here.

Feature: A process manager is durable, and its work leaves through an outbox

  One pure step per delivery: load state, evolve it against the event, persist
  the result and stage whatever intents that evolution minted — all as one
  step, never as one step per event in a batch. The intents leave later,
  through an outbox with its own attempt budget, so a slow or failing endpoint
  never blocks the state transition that produced it.

  Background:
    Given a process manager identified by its process name, project id and process key

  # ============================================================================
  # A durable step loads once, evolves once, and persists once
  # ============================================================================

  Rule: A stored row is found, genuinely absent, or present but undecodable

    @unit
    Scenario: The first delivery for an instance starts from genesis
      Given no row has ever been stored for this process instance
      When a delivery arrives for it
      Then the process starts from its own init() state
      And the resulting state is saved at revision 1

    @unit
    Scenario: A later delivery evolves the stored state, not a fresh one
      Given a process instance with an existing stored state
      When a further delivery arrives for it
      Then the stored state is loaded and evolved, not re-initialised

    @unit
    Scenario: A stored row this build cannot decode is never treated as genesis
      Given a stored row whose version does not match what this build expects
      When a delivery arrives for that instance
      Then the delivery fails rather than starting over from init()
      And no state is overwritten

  Rule: A save whose expected revision no longer matches must fail, not clobber

    @unit
    Scenario: A concurrent advance loses the race rather than the update
      Given a process instance loaded at revision 1
      And another delivery has since advanced it to revision 2
      When the first delivery tries to save at its stale expected revision
      Then the save fails
      And the row keeps the state the concurrent delivery wrote

  Rule: An event with no declared handler runs no step at all

    @unit
    Scenario: An unhandled event leaves state, intents and the armed deadline untouched
      Given a process manager with no handler declared for a given event type
      When a delivery carries only that event
      Then no state is saved
      And no intent is staged
      And the armed deadline is not touched

  Rule: A coalesced batch produces one emission, not one per event

    @unit
    Scenario: Several events in one delivery advance state through one save
      Given a process manager whose handler advances state on each of several event types
      When a delivery carries three such events for the same instance
      Then the state reflects all three events
      And exactly one save is made for the whole delivery

    @unit
    Scenario: Intents from a batch are staged in a single outbox call
      Given a process manager whose handler emits an intent on each event it handles
      When a delivery carries several events that each emit an intent
      Then every intent minted across the batch is staged in one outbox call
      And not once per event

  # ============================================================================
  # nextWakeAt has three distinct meanings
  # ============================================================================

  Rule: null clears, a number replaces, and the same number leaves it as it was

    @unit
    Scenario: Returning null clears a previously armed deadline
      Given a process instance with an armed wake deadline
      When a delivery's step returns nextWakeAt as null
      Then the saved row carries no armed deadline

    @unit
    Scenario: Returning a new number replaces the armed deadline
      Given a process instance with an armed wake deadline
      When a delivery's step returns a different nextWakeAt
      Then the saved row's deadline is the new value

    @unit
    Scenario: Returning the same number leaves the armed deadline as it was
      Given a process instance with an armed wake deadline
      When a delivery's step returns that same nextWakeAt back
      Then the saved row's deadline is unchanged

  Rule: A backed-up consumer cannot schedule a wake into the past

    @unit
    Scenario: A wake computed while running late is scheduled from now, not from the stale instant
      Given a process whose onWake computes its next deadline from the one that just came due
      And the consumer runs it well after that deadline has passed
      When onWake runs and returns a next deadline that is still in the past
      Then the saved deadline is clamped forward to the current time
      And the process is not left spinning on a deadline already behind it

  # ============================================================================
  # A wake's intent key survives a retry unchanged
  # ============================================================================

  Rule: A wake's intent key comes from the scheduled instant, never the clock at step time

    @unit
    Scenario: Two wake attempts for the same due deadline stage one row, not two
      Given a process whose onWake emits an intent keyed by the deadline it was woken for
      When the same due instance is woken twice, once as a retry of the first
      Then the outbox holds exactly one row for that intent
      And it is not dispatched twice

  # ============================================================================
  # A schedule is armed once at boot, and never rearmed
  # ============================================================================
  #
  # From scheduled-process-arming.feature. A worker boot gives a schedule its
  # FIRST deadline and nothing more: arming on every boot would recompute the
  # deadline from the present, pushing it forward before it ever matures.

  Rule: Arming establishes the first deadline and never rewrites an existing one

    @unit
    Scenario: A schedule with no deadline yet is armed by a worker boot
      Given a maintenance process that has never been armed
      When a worker boots and arms it
      Then the process is given a deadline one interval away
      And its state is the process's own genesis state

    @unit
    Scenario: A schedule that already holds a deadline is left alone by a later boot
      Given a maintenance process that was armed by an earlier boot
      When a later worker boots and arms the same process again
      Then the existing deadline is not touched
      And no save is made

    @unit
    Scenario: A schedule that cannot be armed reports the failure rather than corrupting state
      Given a process store that fails while arming a schedule
      When a worker boots and arms it
      Then the failure propagates to the caller
      And no partial row is left behind

  # ============================================================================
  # The inbox keys idempotency on a bounded digest
  # ============================================================================
  #
  # ProcessManagerInbox is a live table (platform/app/prisma/schema.prisma).
  # The source event id is idempotencyKey ?? id, composed by whichever pipeline
  # emits the command, so its length is that domain's business — Postgres
  # refuses to index a btree row past ~2704 bytes, and an oversized id turned
  # the inbox insert into a hard error inside the commit transaction, which
  # blocked every later event for that process. The store derives a
  # fixed-width digest of the source event id and constrains uniqueness on
  # that instead, keeping the raw id as an unindexed diagnostic column.
  #
  # This is the Prisma-backed ProcessStore's own behaviour — outside
  # packages/event-sourcing, which imports neither Prisma nor Postgres — so
  # these are parked here rather than bound by this change.

  Rule: The inbox's unique constraint is a fixed width whatever the source event id

    @unimplemented
    Scenario: A source event id far past the index limit is still consumed
      Given a process manager subscribed to an event
      And that event's idempotency key is several thousand characters long
      When the process commits its consumption of the event
      Then the commit succeeds
      And the raw source event id is kept on the row for diagnostics

    @unimplemented
    Scenario: Two different long source event ids stay distinct
      Given two events whose idempotency keys are long and share a common prefix
      When a process manager commits its consumption of each of them
      Then both are consumed
      And neither is mistaken for a redelivery of the other

    @unimplemented
    Scenario: Redelivery of a long source event id is still deduplicated
      Given a process manager has consumed an event with a very long idempotency key
      When the same event is delivered to it again
      Then the second delivery is reported as a duplicate
      And no second inbox row is written

    @unimplemented
    Scenario: A long source event id no longer blocks the process
      Given a process manager subscribed to an event whose idempotency key exceeds the index limit
      When the event is delivered
      Then the commit does not raise a database error
      And a later event for the same process is still processed

  Rule: The digest is derived by the store, never by the caller

    @unimplemented
    Scenario: The same source event id always derives the same key
      Given a source event id
      When its inbox key is derived twice
      Then both derivations produce the same value

    @unimplemented
    Scenario: The derived key is a fixed width regardless of input length
      Given a very short source event id and a very long one
      When each one's inbox key is derived
      Then the two keys are the same length

  # ============================================================================
  # Work that must happen, happens
  # ============================================================================
  #
  # From post-event-work.feature. Reframed onto the substrate that actually
  # gives these guarantees: the process-manager step plus its outbox, rather
  # than a mechanism-agnostic "post-event work" in general.

  Rule: Chargeable work survives the worker that started it

    @unit
    Scenario: Work that costs money survives the worker that started it
      Given an event has caused a process manager to stage a chargeable intent
      When the worker that staged it is replaced before the intent is dispatched
      Then a fresh dispatcher run, reading the same outbox, still delivers it

    @unit
    Scenario: Work is retried until it succeeds
      Given a staged intent whose delivery fails on its first attempt
      When the dispatcher runs again after the failure's backoff
      Then it is attempted again
      And it stops being attempted once it succeeds

    @unit
    Scenario: Work scheduled for later survives a restart
      Given a process armed with a wake deadline in the future
      When every process is restarted before that deadline arrives
      And a fresh runtime instance later polls the same store past the deadline
      Then the work still happens when it comes due

  Rule: Something not yet readable is retried, not read as a permanent no

    @unit
    Scenario: A step that cannot yet read a fact it needs is retried, not treated as done
      Given a process manager whose step reads a fact derived from another stream
      And that fact has not been derived yet at the moment the step runs
      When the step throws rather than silently proceeding
      Then no state is saved and no intent is staged for that delivery
      And the caller's retry is what gives the fact time to arrive

  # ============================================================================
  # Handing work over is itself work that can fail
  # ============================================================================
  #
  # From post-event-work.feature. This is the seam between a committed event
  # and a lane job existing for it (EventProducer's fan-out), which sits
  # upstream of the process manager and is not built in this change.

  Rule: A blip on the hand-off does not silently lose the work

    @unimplemented
    Scenario: A blip handing work to its queue does not lose the work
      Given work that must happen in response to an event
      When the first attempt to hand it over fails and a later one succeeds
      Then the work is queued
      And it is counted as queued rather than as lost

    @unimplemented
    Scenario: Handing the same work over twice leaves one piece of work
      Given a hand-off that fails after the queue has already accepted the work
      When the hand-off is attempted again
      Then the queue holds one piece of work for that event, not two

    @unimplemented
    Scenario: A queue that stays unavailable gives up rather than holding up the write
      Given work that must happen in response to an event
      And a queue that fails every attempt
      When the event is published
      Then the attempts stop after a bounded number
      And an operator-visible count records the work as lost
      And the committed write behind it still stands

    @unimplemented
    Scenario: Work whose hand-off cannot succeed is not retried
      Given work whose hand-off fails for a reason retrying cannot change
      When the event is published
      Then the hand-off is attempted once
      And the work is recorded as lost

    @unimplemented
    Scenario: Work that fails while running is not mistaken for a failed hand-off
      Given work that fails while it runs rather than while it is handed over
      When the event is published
      Then the hand-off does not run it again
      And the failure is left to the retry that covers work as it runs

  # ============================================================================
  # Work that is allowed to be lost
  # ============================================================================
  #
  # From post-event-work.feature. Belongs to the live-notification subscriber
  # substrate, not built in this change.

  @unimplemented
  Scenario: A live update missed by a closed page is not redelivered
    Given someone was watching a page when an event arrived
    When they close the page before the update reaches them
    Then the update is not delivered later
    And nothing about it is kept

  @unimplemented
  Scenario: A missed live update does not change what the page shows
    Given a live update was lost
    When the page is opened again
    Then it shows the same thing it would have shown had the update arrived

  # ============================================================================
  # The outbox: a delivery failure is classified into retry or dead
  # ============================================================================

  Rule: Classification decides between a backoff and surfacing the row as dead

    @unit
    Scenario: A retryable failure schedules a backoff rather than killing the row
      Given a claimed row whose intent's delivery throws a retryable DispatchError
      When the dispatcher processes it
      Then the row is scheduled to retry after a backoff
      And it is not marked dead

    @unit
    Scenario: A terminal failure is marked dead without a retry
      Given a claimed row whose intent's delivery throws a non-retryable DispatchError
      When the dispatcher processes it
      Then the row is marked dead
      And no backoff is scheduled

    @unit
    Scenario: An unclassifiable failure defaults to retryable
      Given a claimed row whose intent's delivery throws an error carrying no recognizable classification
      When the dispatcher processes it
      Then the row is scheduled to retry rather than marked dead

    @unit
    Scenario: A successful delivery settles the row
      Given a claimed row whose intent's delivery succeeds
      When the dispatcher processes it
      Then the row is settled
      And it is not retried

    @unit
    Scenario: A row naming an intent nobody declares is marked dead rather than retried forever
      Given a claimed row whose intent type matches no registered process manager
      When the dispatcher processes it
      Then the row is marked dead

  Rule: An endpoint that logs and returns as if nothing happened is the failure this guards against

    @unit
    Scenario: A delivery that swallows its own failure and returns settles as if it had succeeded
      Given an intent whose delivery catches its own failure internally and returns normally
      When the dispatcher processes the row
      Then the row is settled
      And this is exactly why a delivery must throw to be seen as failed

    @unit
    Scenario: A cache update failing after a successful durable effect still settles
      Given an intent whose delivery performs its durable effect and then a best-effort cache update
      And the cache update throws while the durable effect already succeeded
      When the dispatcher processes the row
      Then the row is settled

    @unit
    Scenario: A durable effect failing is never masked by an earlier best-effort signal
      Given an intent whose delivery emits a best-effort signal and then its durable effect throws
      When the dispatcher processes the row
      Then the row is not settled
      And it is classified for retry or death like any other failure

  Rule: A logical intent dispatches at most once

    @unit
    Scenario: Two evolutions of the same logical intent stage one outbox row, not two
      Given a process manager whose handler emits the same messageKey across two separate deliveries
      When both deliveries run
      Then the outbox holds exactly one row for that message key

  Rule: Pruning dispatched history is scoped to one process manager

    @unit
    Scenario: Pruning one process manager's dispatched history leaves another's untouched
      Given dispatched rows belonging to two different process managers
      When one process manager's history is pruned
      Then its own old rows are removed
      And the other process manager's rows are untouched
