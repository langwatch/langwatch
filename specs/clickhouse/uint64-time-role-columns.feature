Feature: A time role is a semantic property, independent of its wire representation

  `defineTable` decides whether a column may anchor a partition, a TTL or a
  `ReplacingMergeTree` version by asking three questions of the column: which
  of the four ADR-099 roles does it play, is it frozen for the row's life, is
  it platform-controlled. None of those three answers says anything about how
  the value crosses the wire. Yet every column capable of answering "yes" was
  built on `DateTime64`, so a table whose deployed DDL stamps its version and
  its partition anchor as a `UInt64` epoch integer could not be declared
  through `defineTable` at all.

  The fix widens the column builders, not `defineTable`'s validator: the
  validator already reasoned about roles and never inspected the underlying
  ClickHouse type. A `UInt64`-backed column carrying the same role and the
  same frozen/platform-controlled flags decodes and encodes an epoch integer
  instead of a `DateTime64` string, and is otherwise indistinguishable to
  everything downstream of the column builder.

  `event_log`'s deployed migration (`00002_create_schema.sql`) is immutable,
  so its own declaration is the proof: `EventTimestamp` anchors the
  `ReplacingMergeTree` version and `EventOccurredAt` anchors the partition,
  both `UInt64`, and both work through the same `defineTable` rules a
  `DateTime64` column does.

  # ---------------------------------------------------------------------------
  # The epoch-millisecond codec
  # ---------------------------------------------------------------------------

  Rule: An epoch-millisecond UInt64 round-trips through the wire exactly

    @unit
    Scenario: an epoch-millisecond wire value round-trips to the same instant
      Given a UInt64 column decoding epoch milliseconds
      And a known wire value naming an exact millisecond
      When it is decoded
      Then it produces the Date at that exact millisecond

    @unit
    Scenario: encoding a Date produces the exact epoch-millisecond wire string
      Given a UInt64 column decoding epoch milliseconds
      And a Date instance
      When it is encoded and decoded again
      Then the result is the same instant

    @unit
    Scenario: decoding a UInt64 beyond Number.MAX_SAFE_INTEGER throws instead of losing precision
      Given a UInt64 column decoding epoch milliseconds
      And a wire value whose integer value exceeds Number.MAX_SAFE_INTEGER
      When it is decoded
      Then decoding throws rather than silently rounding to a nearby millisecond

  # ---------------------------------------------------------------------------
  # The role wrappers, UInt64-backed
  # ---------------------------------------------------------------------------

  Rule: The UInt64-backed role columns carry the same role and the same flags as their DateTime64 counterparts

    @unit
    Scenario: a UInt64-backed acceptedAt column is still frozen and platform-controlled
      Given a UInt64-backed acceptedAt column
      When its role and its frozen/platform-controlled flags are inspected
      Then it reports the acceptedAt role, frozen, and platform-controlled — identical to the DateTime64-backed acceptedAt column

    @unit
    Scenario: a UInt64-backed writtenAt column is still platform-controlled and moving
      Given a UInt64-backed writtenAt column
      When its role and its frozen/platform-controlled flags are inspected
      Then it reports the writtenAt role, not frozen, and platform-controlled — identical to the DateTime64-backed writtenAt column

  # ---------------------------------------------------------------------------
  # event_log — the deployed table this exists for
  # ---------------------------------------------------------------------------

  Rule: event_log declares its version and its partition on UInt64-backed roles, matching the deployed migration

    @unit
    Scenario: the event_log table anchors its ReplacingMergeTree version on a UInt64-backed writtenAt column
      Given the event_log table declaration
      When its merge strategy and its EventTimestamp column are inspected
      Then EventTimestamp is the declared ReplacingMergeTree version
      And EventTimestamp is a UInt64 column carrying the writtenAt role

    @unit
    Scenario: the event_log table anchors its partition on a UInt64-backed role column
      Given the event_log table declaration
      When its partition column is inspected
      Then EventOccurredAt is the declared partition column
      And EventOccurredAt is a UInt64 column that is frozen and platform-controlled

    @unit
    Scenario: a full event_log row round-trips through the declared codec with its UInt64 columns intact
      Given the event_log table declaration
      And a raw wire row with UInt64 wire strings for EventTimestamp and EventOccurredAt
      When the row is decoded through the table's schema
      Then EventTimestamp and EventOccurredAt decode to the instants their wire values name
