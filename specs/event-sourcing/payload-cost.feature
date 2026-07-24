Feature: Payload cost governs the scheduling plane
  A subscriber that needs a small slice of a large event must not buy the whole
  payload twice. The event is already in memory when it is routed; that is where
  an irrelevant event is discarded — so the job never exists — and where a
  needed slice is lifted, so the job carries the slice and never the bulk
  payload. Work waiting in a queue is cheap as a pointer and fatal as resident
  memory; when the platform kills a worker for memory it did not choose to
  hold, a shedding layer is missing. (ADR-069; phase 1 scenarios below are
  shipping, the planned scenarios record phases 2–4.)

  See dev/docs/adr/069-payload-cost-doctrine.md.

  # --- Phase 1: filtering and extraction at ingest ---

  Background:
    Given an event subscriber that needs only a small derived slice of each relevant event

  Scenario: a non-matching event never mints a job
    Given the subscriber declares which events are relevant to it
    And an event the subscriber considers not relevant
    When the event is routed to subscribers
    Then no job is staged for that subscriber
    And the subscriber's handler never runs for that event

  Scenario: a matching event's job carries the derived slice, not the raw payload
    Given an event the subscriber considers relevant
    When the event is routed to subscribers
    Then the staged job carries the small derived slice
    And the bulk event payload does not travel on the queue
    And the handler completes its work from the slice alone

  Scenario: extraction changes the payload, not the delivery guarantees
    Given two relevant events for the same aggregate
    When both are routed to subscribers
    Then their jobs are processed in order for that aggregate
    And a redelivery of the same event inside the dedup window stages no second job

  Scenario: a job staged before the upgrade still processes
    Given a job staged by the previous release that carries the full event payload
    When the handler dequeues it after the upgrade
    Then the job is processed to the same outcome as before the upgrade

  Scenario: a failed lift surfaces into retry, never a silent drop
    Given a relevant event whose slice cannot be derived
    When the event is routed to subscribers
    Then the routing attempt fails and is retried
    And the event is never silently discarded

  Scenario: enqueue outcomes are visible to operators
    Given a stream of relevant and irrelevant events
    When they are routed to subscribers
    Then an operator-visible count distinguishes events filtered out, events staged as a slice, and events staged whole

  # --- Phases 2-4: the remaining ADR-069 invariants ---

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
