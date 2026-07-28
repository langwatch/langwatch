Feature: Payload cost governs the scheduling plane
  A subscriber that needs a small slice of a large event must not mint a job for
  every event it does not care about. The event is already in memory when it is
  routed; that is where an irrelevant event is discarded — so the job never
  exists. The routing seam is shared by the whole fan-out, so only a cheap,
  total predicate runs there; deriving the slice from a relevant event stays in
  the subscriber's own lane until the event carries a cost-honest claim-check
  (phase 2). Work waiting in a queue is cheap as a pointer and fatal as resident
  memory; when the platform kills a worker for memory it did not choose to hold,
  a shedding layer is missing. (ADR-069; phase 1 scenarios below are shipping,
  the planned scenarios record phases 2–4.)

  See dev/docs/adr/069-payload-cost-doctrine.md.

  # --- Phase 1: filtering at ingest ---

  Background:
    Given an event subscriber that needs only a small derived slice of each relevant event

  @unit
  Scenario: a non-matching event never mints a job
    Given the subscriber declares which events are relevant to it
    And an event the subscriber considers not relevant
    When the event is routed to subscribers
    Then no job is staged for that subscriber
    And the subscriber's handler never runs for that event

  @unit
  Scenario: a matching event mints a job for the subscriber
    Given an event the subscriber considers relevant
    When the event is routed to subscribers
    Then a job is staged for that subscriber

  @unit
  Scenario: filtering leaves the dedup identity of the jobs that remain intact
    Given two relevant events for the same aggregate
    When both are routed to subscribers
    Then a redelivery of the same event inside the dedup window stages no second job

  @unit
  Scenario: a job staged before the filter existed is still gated by the handler
    Given a job staged by the previous release, which minted one for every event
    And that job carries an event the filter would now decline
    When the handler dequeues it after the upgrade
    Then the handler discards it to the same outcome as before the upgrade

  # The routing seam has no retry, so this is a reported loss, not a recovered
  # one. That is precisely why an enqueue hook must be total — the scenario
  # below pins the honest semantics so no future adopter builds on a promise
  # the platform does not keep.
  @unit
  Scenario: a raising enqueue filter is reported as a failure, not as a decline
    Given a relevant event whose filter predicate raises
    When the event is routed to subscribers
    Then the routing attempt reports the failure
    And no job is staged for that subscriber
    And the failure is distinguishable from the event having been filtered out

  @unit
  Scenario: a raising enqueue filter loses only its own subscriber's job
    Given two subscribers observing the same event
    And the first subscriber's filter predicate raises
    When the event is routed to subscribers
    Then the second subscriber still receives the event
    And the other events in the same batch are still routed

  @unit
  Scenario: a raising enqueue filter's job is never re-dispatched
    Given a committed event whose filter predicate raises
    When the storing service completes the write
    Then the write succeeds
    And the dispatch failure is logged for operators
    And nothing re-dispatches the subscriber fan-out for that event

  @unit
  Scenario: enqueue outcomes are visible to operators
    Given a stream of relevant and irrelevant events
    When they are routed to subscribers
    Then an operator-visible count distinguishes events filtered out from events staged as a job

  @unit
  Scenario: a job that fails to reach the queue is not counted as staged
    Given a relevant event the subscriber's filter admits
    And the subscriber's queue is unavailable
    When the event is routed to subscribers
    Then the routing attempt reports the failure
    And the event is not counted among those staged as a job

  # --- Phases 2-4: the remaining ADR-069 invariants ---

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 2: with the event
  # carrying a cost-honest claim-check, the subscriber reads its slice from the
  # reference instead of the full payload riding the queue.
  Scenario: a matched event's heavy payload travels as a claim-check, not inline
    Given an event the subscriber considers relevant whose payload is large
    When the event is routed to subscribers
    Then the staged job carries a reference to the payload, not the payload
    And the handler reads only the small slice it needs through that reference

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 2: offloaded payloads
  # stage as small stubs, and byte budgets count the stub, not the payload.
  Scenario: an offloaded payload's reference advertises its true cost
    Given a job whose payload is offloaded to blob storage
    When the job is staged
    Then its reference declares the payload's true byte size
    And every byte budget the job passes through counts that size, not the size of the reference

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 2: only coalesced
  # drains are byte-bounded; in-flight dispatch and retry buffers bound by count.
  Scenario: every stage that holds payloads is bounded in bytes
    Given a stream of jobs whose sizes vary by orders of magnitude
    When jobs are held in flight, buffered for retry, or drained
    Then each stage admits work up to a byte budget
    And never up to an item count alone

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 3: memory grants.
  Scenario: a job acquires memory before it hydrates
    Given a bounded per-process memory pool
    And a job whose declared cost exceeds the pool's remaining budget
    When the job is due to hydrate its payload
    Then it waits in the queue as a reference
    And it hydrates only once a grant for its declared cost is acquired

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 3: overload still
  # presents as allocator pressure before it presents as backlog.
  Scenario: overload presents as queue depth, never as memory pressure
    Given more declared work than the memory pool can grant at once
    When the backlog builds
    Then the excess is visible as queue depth
    And the process's memory use stays inside its budget

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 4: per-key fairness
  # across groups.
  Scenario: a hot aggregate degrades itself, not the fleet
    Given one aggregate producing work orders of magnitude faster than its peers
    When work is scheduled across aggregates
    Then the hot aggregate's own backlog grows
    And the other aggregates' work keeps draining

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 4: bulkheads for the
  # heavy workload class.
  Scenario: heavy-class overload stays a heavy-class incident
    Given a workload class far heavier than the median
    When that class is overloaded
    Then the overload is contained to that class's own pool and budget
    And the rest of the platform's work is unaffected

  @planned
  # Not yet implemented as of 2026-07-24 — ADR-069 phase 4: the shedding
  # ladder; today the kubelet is the shedding layer.
  Scenario: the system sheds itself before the platform sheds it
    Given sustained overload beyond what waiting can absorb
    When the system degrades
    Then intake pauses first
    And work defers or spills durably second
    And parking with operator visibility comes last
    And the process is never killed by the platform for memory it chose to hold
