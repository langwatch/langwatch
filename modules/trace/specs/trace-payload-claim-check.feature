Feature: Recalling an oversized span's payload from outside the application

  An OTLP span whose serialized command exceeds the inline threshold does not
  travel through the queue whole. The edge writes the payload to a transient
  spool object, the command carries a marker instead of the bytes, and the
  command worker reads the object back before recording the span. Once the
  event is in `event_log`, that row is the durable copy and the spool object is
  deleted; a later read recalls the offloaded field out of the event itself.

  Both halves are moving out of the application ahead of the trace conversion,
  so for now two copies of each exist and neither compiles against the other.
  Everything they must agree about fails silently when it drifts. A different
  object path is a read that misses, and a miss on the spool is a span written
  to the sole source of truth with its attributes already cleared — permanent,
  silent loss. A different `event_log` predicate is a recall that returns
  nothing, and a recall that returns nothing degrades to the 64 KB preview
  without an error anywhere.

  @unit
  Scenario: The spool object path is derived from the command, never read from it
    Given a spooled command whose reference names another tenant's object
    When the command worker reads the spool
    Then it reads the object derived from the command's own tenant and span ids

  @unit
  Scenario: An id that is not a safe path segment is hashed, not escaped
    Given a span whose trace id contains path separators
    When the spool object path is built
    Then that segment is replaced by a hash and the path stays one level deep

  @unit
  Scenario: The transient object path carries the lifecycle prefix first
    Given a project, trace and span
    When the spool object path is built
    Then the path begins with the lifecycle prefix and the tenant follows it

  @unit
  Scenario: A write refuses a destination that cannot reap an orphan
    Given a project whose storage destination is the local filesystem
    When the edge tries to spool an oversized payload
    Then the write is refused by name and ingestion continues inline

  @unit
  Scenario: Azure refuses until the operator asserts the lifecycle rule
    Given a project on Azure Blob storage
    When the operator has not confirmed orphan retention
    Then a spool write is refused and a spool read still succeeds

  @unit
  Scenario: A legacy reference is pinned to the command's own tenant
    Given a command carrying a v1 spool key naming a different tenant
    When the command worker reads or deletes the spool
    Then the read is refused and the delete is refused and logged

  @unit
  Scenario: A spool object larger than the cap is refused rather than buffered
    Given a spool object larger than the read cap
    When the command worker reads it
    Then the read is aborted rather than buffering the whole object

  @unit
  Scenario: The event log read names the tenant first
    Given an offloaded field recorded against a trace
    When the field is recalled from the event log
    Then the query filters on tenant before any other predicate

  @unit
  Scenario: The partition window is derived from the event id itself
    Given an event id that is a parseable KSUID
    When the field is recalled
    Then the query prunes to a window around the id's own creation time

  @unit
  Scenario: A row with no recorded occurred time is never pruned away
    Given an event log row whose occurred time is the column default
    When the field is recalled inside a pruned window
    Then the row is still eligible

  @unit
  Scenario: An unparseable event id falls back to an unpruned read
    Given an event id that is not a KSUID
    When the field is recalled
    Then no occurred-time predicate is applied

  @unit
  Scenario: A malformed sibling attribute cannot mask the offloaded field
    Given a stored span carrying a numeric attribute beside the offloaded one
    When the offloaded field is recalled
    Then the offloaded value is returned

  @unit
  Scenario: A log record's body is recalled from the top of the payload
    Given a log record whose body was offloaded
    When the body field is recalled
    Then the body is returned from the payload root rather than from attributes

  @unit
  Scenario: Absence answers null rather than raising at the read port
    Given an offloaded field whose event log row is missing
    When the trace read path recalls it
    Then the port answers nothing and the caller serves the preview
