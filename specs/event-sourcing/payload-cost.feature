Feature: Payload cost governs the scheduling plane
  As an operator running the event-sourcing platform
  I want a worker's memory to be governed by the work that actually matters to
  it, not by the volume of traffic flowing past it
  So that overload shows up as a visible backlog I can act on, instead of as a
  worker the platform kills for memory it never chose to hold.

  # Why this exists — the worker probe-kill loop
  #
  # One subscriber needed a small slice of each relevant event, but every event
  # in every project queued a copy of the whole payload for it. A single busy
  # project's ordinary traffic was enough to fill a worker's memory ceiling and
  # get it killed, taking the unrelated work queued beside it with it. The fix
  # is a doctrine, not a patch: an irrelevant event costs nothing, and a
  # relevant one waits in the queue at the cost of a pointer.
  #
  # See dev/docs/adr/069-payload-cost-doctrine.md. The scenarios below the last
  # divider are @planned — phases 2-4, not yet built.

  Background:
    Given a subscriber that needs only a small derived slice of each relevant event

  @unit
  Scenario: a non-matching event never mints a job
    Given the subscriber declares which events are relevant to it
    And an event the subscriber considers not relevant
    When the event is published
    Then no work is queued for that subscriber
    And the subscriber never processes that event

  @unit
  Scenario: a matching event mints a job for the subscriber
    Given an event the subscriber considers relevant
    When the event is published
    Then work is queued for that subscriber

  @unit
  Scenario: a redelivered event resolves to the unit of work already queued
    Given a relevant event already queued for the subscriber
    When the same event is published again within the deduplication window
    Then it resolves to the same unit of work, so the queue recognises it as a duplicate
    And an event on another aggregate never resolves to that same unit

  @unit
  Scenario: two relevant events that share no payload identity are still delivered separately
    Given two distinct relevant events on the same aggregate
    And neither carries an identity of its own within that aggregate
    When both are published within the deduplication window
    Then each is queued as its own unit of work
    And neither event's facts are dropped in favour of the other's

  @unit
  Scenario: work queued before the relevance rule existed still reaches the same outcome
    Given work queued by the previous release, which queued every event
    And that work carries an event the subscriber would now consider not relevant
    When the subscriber processes it after the upgrade
    Then it reaches the same outcome as it did before the upgrade

  # An event is discarded while it is being published, and publishing is not
  # retried. The scenarios below pin the honest semantics: a subscriber that
  # cannot decide relevance loses that event, and the loss is reported rather
  # than disguised as a decision.
  @unit
  Scenario: a subscriber that cannot decide relevance is reported, not read as declining
    Given a relevant event the subscriber errors on while deciding relevance
    When the event is published
    Then publishing reports the failure
    And no work is queued for that subscriber
    And the failure is distinguishable from the event having been considered irrelevant

  @unit
  Scenario: a subscriber that cannot decide relevance loses only its own work
    Given two subscribers observing the same event
    And the first subscriber errors while deciding relevance
    When the event is published
    Then the second subscriber still receives the event
    And the other events published alongside it still reach their subscribers

  @unit
  Scenario: a subscriber that cannot decide relevance never fails the write behind it
    Given a recorded event the subscriber errors on while deciding relevance
    When the recording completes
    Then the record is kept
    And the failure is reported to operators
    And nothing retries that subscriber for that event

  @unit
  Scenario: enqueue outcomes are visible to operators
    Given a stream of relevant and irrelevant events
    When they are published
    Then an operator-visible count distinguishes events discarded as irrelevant from events queued as work

  @unit
  Scenario: work that never reaches the queue is not counted as queued
    Given an event the subscriber considers relevant
    And the subscriber's queue is unavailable
    When the event is published
    Then publishing reports the failure
    And the event is not counted among the work queued

  @unit
  Scenario: work lost before it was queued is visible as lost
    Given a subscriber that cannot decide relevance
    When the event is published
    Then an operator-visible count records the work as lost
    And the counted outcomes account for every event routed to that subscriber

  # --- Discarding work is reversible without a release ---

  @unit
  Scenario: a subscriber can be stopped for one tenant without a deploy
    Given a subscriber that discards the events it considers irrelevant
    And an operator has stopped that subscriber for one tenant
    When an event for that tenant is published
    Then the subscriber neither judges the event nor receives work for it
    And no event is recorded as discarded on that tenant's behalf

  # --- Waiting work costs a pointer, not a payload ---

  @unit
  Scenario: relevant work waits in the queue at the cost of a pointer, not of its payload
    Given a relevant event whose payload is large
    When the event is published
    Then the queued work holds only enough to find the payload again
    And the subscriber still produces exactly the result the whole payload would have produced
    And a redelivery of that event still collapses to one unit of work

  @unit
  Scenario: work whose payload is not readable yet retries, never drops
    Given queued work whose payload has not yet landed where the subscriber reads it
    When the subscriber processes that work
    Then the attempt fails into the queue's retry
    And the work completes once the payload becomes readable

  @unit
  Scenario: work a build cannot read fails loudly, never half-processed
    Given queued work in a shape this build does not recognise
    When the subscriber processes it
    Then the attempt fails into the queue's retry
    And the work is never mistaken for a shape the build does know

  @unit
  Scenario: an event whose payload cannot be pointed at is still processed
    Given a relevant event that carries no identity to find its payload by
    When the event is published
    Then the queued work carries the event itself
    And the subscriber reaches the same outcome as it did before payloads waited as pointers

  # The tempting failure mode here is the quiet one — queueing the payload
  # whole when the pointer cannot be built, which would hide the fault behind
  # exactly the cost the pointer exists to avoid.
  @unit
  Scenario: a failure preparing queued work is reported, never hidden behind the whole payload
    Given a relevant event the subscriber errors on while preparing its queued work
    When the event is published
    Then publishing reports the failure
    And the subscriber never processes that event

  # --- Phases 2-4: the remaining ADR-069 invariants ---

  @integration
  # ADR-069 phase 2, shipped: the encoder records the pre-compression,
  # pre-offload payload size on the envelope header, and the coalescing drain
  # spends its byte budget against that rather than the stored value's length.
  Scenario: an offloaded payload's reference advertises its true cost
    Given a job whose payload is offloaded to blob storage
    When the job is staged
    Then its reference declares the payload's true byte size
    And every byte budget the job passes through counts that size, not the size of the reference

  @planned
  # Not yet implemented as of 2026-07-28 — ADR-069 phase 2: only coalesced
  # drains are byte-bounded; in-flight dispatch and retry buffers bound by count.
  Scenario: every stage that holds payloads is bounded in bytes
    Given a stream of jobs whose sizes vary by orders of magnitude
    When jobs are held in flight, buffered for retry, or drained
    Then each stage admits work up to a byte budget
    And never up to an item count alone

  @planned
  # Not yet implemented as of 2026-07-28 — ADR-069 phase 3: memory grants.
  Scenario: a job acquires memory before it hydrates
    Given a bounded per-process memory pool
    And a job whose declared cost exceeds the pool's remaining budget
    When the job is due to hydrate its payload
    Then it waits in the queue as a reference
    And it hydrates only once a grant for its declared cost is acquired

  @planned
  # Not yet implemented as of 2026-07-28 — ADR-069 phase 3: overload still
  # presents as allocator pressure before it presents as backlog.
  Scenario: overload presents as queue depth, never as memory pressure
    Given more declared work than the memory pool can grant at once
    When the backlog builds
    Then the excess is visible as queue depth
    And the process's memory use stays inside its budget

  @planned
  # Not yet implemented as of 2026-07-28 — ADR-069 phase 4: per-key fairness
  # across groups.
  Scenario: a hot aggregate degrades itself, not the fleet
    Given one aggregate producing work orders of magnitude faster than its peers
    When work is scheduled across aggregates
    Then the hot aggregate's own backlog grows
    And the other aggregates' work keeps draining

  @planned
  # Not yet implemented as of 2026-07-28 — ADR-069 phase 4: bulkheads for the
  # heavy workload class.
  Scenario: heavy-class overload stays a heavy-class incident
    Given a workload class far heavier than the median
    When that class is overloaded
    Then the overload is contained to that class's own pool and budget
    And the rest of the platform's work is unaffected

  @planned
  # Not yet implemented as of 2026-07-28 — ADR-069 phase 4: the shedding
  # ladder; today the kubelet is the shedding layer.
  Scenario: the system sheds itself before the platform sheds it
    Given sustained overload beyond what waiting can absorb
    When the system degrades
    Then intake pauses first
    And work defers or spills durably second
    And parking with operator visibility comes last
    And the process is never killed by the platform for memory it chose to hold
