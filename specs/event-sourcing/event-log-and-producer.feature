# Design: dev/docs/adr/108-the-dispatch-plane.md
Feature: The event log is the sole writer, and fan-out never risks a committed write
  The engine has one durable fact: an event committed to the log. Everything
  else — a fold's state, a map's rows, a process manager's intents — is
  derived from that fact by fanning the event out to whatever subscribes to
  it. So the log is written first, and fan-out is best-effort by
  construction: staging a job can fail for reasons that have nothing to do
  with whether the event happened, and none of them may undo the commit.

  Background:
    Given an event log, a lane queue, and a registry of subscribing pipelines

  @unit
  Scenario: an event reaches the log before any lane is fanned out to
    Given a subscriber registered for one event type
    When the event is published
    Then the event log's append is called before the queue is staged

  @unit
  Scenario: a staging failure never fails the write that already landed
    Given the event log accepts the append
    And the lane queue rejects every job it is handed
    When the event is published
    Then the append still happens
    And publishing reports no failure to its caller

  @unit
  Scenario: the payload string is never re-encoded on its way to the log or a lane
    Given a command's payload serialised with its own exact formatting
    When the event carrying it is published
    Then the string the event log receives is byte-identical to the original
    And the string a subscribing lane's job body carries is byte-identical to the original

  @unit
  Scenario: a fold's lane is named by the pipeline's own aggregate id map, not a hand-written key
    Given a fold registered for one event type
    When a matching event is published
    Then the fold's lane is scoped to the aggregate id the pipeline's own id map resolves
    And the pipeline is asked for that id with the event's own type and decoded payload

  @unit
  Scenario: a process manager's lane is scoped the same way a fold's is
    Given a process manager registered for one event type
    When a matching event is published
    Then the process manager's lane is scoped to the aggregate id the pipeline's own id map resolves

  @unit
  Scenario: a map's lane is scoped by its own declaration, not by the aggregate
    Given a map registered for one event type with its own declared scope
    When a matching event is published
    Then the map's lane carries the scope the map itself declared

  @unit
  Scenario: a throwing enqueue predicate mints the job rather than losing it
    Given a subscriber whose enqueue predicate throws while deciding relevance
    When a matching event is published
    Then a job is staged for that subscriber anyway
    And the failure is counted rather than silently ignored

  @unit
  Scenario: an enqueue predicate that declines is honoured
    Given a subscriber whose enqueue predicate returns false for this event
    When the event is published
    Then no job is staged for that subscriber

  @unit
  Scenario: reference staging swaps the payload for a small reference when one can be built
    Given a map that declares a hook building a small reference from an event
    When a matching event is published
    Then the job staged for that map carries the reference, not the whole payload

  @unit
  Scenario: reference staging falls back to the whole body when no reference can be built
    Given a map whose reference hook returns nothing for this event
    When a matching event is published
    Then the job staged for that map carries the event's whole payload

  @unit
  Scenario: a member with no declared scope loses only its own work
    Given a map registered for one event type with no declared scope
    And a subscriber also registered for that event type
    When a matching event is published
    Then the subscriber still receives a staged job
    And nothing raises out of publishing on the misconfigured map's account

  @unit
  Scenario: one event's cost is measured once and shared by every lane it reaches
    Given a fold and a map both registered for one event type
    When a matching event is published
    Then every job staged for that event carries the same byte cost
    And that cost equals the byte length of the event's payload

  # --- the event log store ---

  @unit
  Scenario: appending a batch of events issues exactly one insert
    Given three committed events for one tenant
    When they are appended to the event log
    Then the store issues exactly one insert carrying every row

  @unit
  Scenario: appending an empty batch touches the store not at all
    Given no committed events
    When they are appended to the event log
    Then no insert is issued

  @unit
  Scenario: a retried append is safe because the sort key carries the idempotency key
    Given a committed event and its retried duplicate, sharing one idempotency key
    When both are appended to the event log
    Then the store marks each write as a replacing insert, which collapses duplicates at merge

  # The collapse itself is ClickHouse's ReplacingMergeTree merging by sort key
  # — a fact about the deployed table, not about this store — so proving it
  # needs a live server. Parked rather than faked (CLAUDE.md: "write them and
  # mark them, don't fake a pass").
  @integration @unimplemented
  Scenario: a retried command with the same idempotency key collapses to one row
    Given a committed event appended once
    And the same event appended again after a transient failure
    When the table is queried for that aggregate
    Then exactly one row is returned

  @unit
  Scenario: a scan always leads with the tenant predicate
    Given a scan for one tenant and aggregate type
    When the scan runs
    Then the query's first bound predicate is the tenant id

  @unit
  Scenario: a scan bounds the partition column when a time range is given
    Given a scan bounded by an occurred-from and an occurred-to instant
    When the scan runs
    Then the query restricts EventOccurredAt to that range

  @unit
  Scenario: a scan with no time range given is not partition-bounded
    Given a scan with no occurred-from or occurred-to
    When the scan runs
    Then the query carries no EventOccurredAt bound

  @unit
  Scenario: a scanned row decodes back to the event that was appended
    Given a committed event appended to the log
    When a scan matching its aggregate runs
    Then the yielded event's payload is byte-identical to the one appended
