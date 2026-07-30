Feature: A structural column's exemption states its true role and why, per column

  ADR-099 requires a partition column, a TTL anchor and a ReplacingMergeTree
  version to be frozen and platform-controlled — anything else lets a
  customer's own clock decide part count, partition spread or which version
  of a row wins a collision. Three deployed tables violate that rule and
  their DDL is immutable, so three separate migrations each declared the
  violating column with a role it does not actually have, just to get the
  guard to pass. The guard went green; the column stayed exactly as
  dangerous as before, and nothing in the source said so.

  `defineTable` now accepts a named, per-column exemption instead of a role
  that lies. The column keeps its TRUE role — the one that fails the check on
  its own — and the table's `structuralDebt` list records, for that one
  column, the one sentence naming why the debt exists. The guard is
  unweakened for every column not named there: an exemption for one column
  proves nothing about any other, and a table that names none is checked
  exactly as before.

  # ---------------------------------------------------------------------------
  # The exemption
  # ---------------------------------------------------------------------------

  Rule: A column may opt out of one structural check by naming its true role and a reason

    @unit
    Scenario: a partition column exempted as structural debt compiles and keeps its true role
      Given a table whose partition column is customer-supplied
      And that column is named in the table's structuralDebt with a reason
      When the table is declared
      Then the declaration succeeds
      And the column still reports its true, non-structural time role

    @unit
    Scenario: a replacing version exempted as structural debt compiles and keeps its true role
      Given a table whose ReplacingMergeTree version is not a writtenAt column
      And that column is named in the table's structuralDebt with a reason
      When the table is declared
      Then the declaration succeeds
      And the column still reports its true, non-writtenAt time role

    @unit
    Scenario: a table that does not opt in is still refused for a customer-supplied partition column
      Given a table whose partition column is customer-supplied
      And the table declares no structuralDebt
      When the table is declared
      Then the declaration is refused

    @unit
    Scenario: a table that does not opt in is still refused for a version column that is not writtenAt
      Given a table whose ReplacingMergeTree version is not a writtenAt column
      And the table declares no structuralDebt
      When the table is declared
      Then the declaration is refused

    @unit
    Scenario: an exemption with no reason is refused
      Given a structuralDebt entry naming a column but leaving its reason blank
      When the table is declared
      Then the declaration is refused

    @unit
    Scenario: an exemption naming a column the table never declared is refused
      Given a structuralDebt entry naming a column absent from the table's columns
      When the table is declared
      Then the declaration is refused

    @unit
    Scenario: an exemption for a column that anchors nothing is refused
      Given a structuralDebt entry naming a column that is not the table's partition column, TTL anchor or replacing version
      When the table is declared
      Then the declaration is refused

    @unit
    Scenario: one column's exemption does not excuse a different column's structural violation
      Given a table whose partition column is customer-supplied
      And the structuralDebt list exempts a different column entirely
      When the table is declared
      Then the declaration is refused for the partition column

  # ---------------------------------------------------------------------------
  # ch.dateTime() — the plain DateTime builder the exemption needed
  # ---------------------------------------------------------------------------

  Rule: ch.dateTime() declares a plain DateTime column with no time role

    @unit
    Scenario: ch.dateTime() encodes and decodes identically to a DateTime64(0) column, only the declared type differs
      Given a ch.dateTime() column and a ch.dateTime64(0) column
      When the same instant is encoded through each
      Then both produce the same wire value
      And only ch.dateTime()'s declared ClickHouse type is the plain DateTime, not DateTime64(0)

  # ---------------------------------------------------------------------------
  # The retrofitted sites — the same bytes on the wire, an honest role in the source
  # ---------------------------------------------------------------------------

  Rule: Retrofitting a column's declared role never changes what is sent to ClickHouse

    @unit
    Scenario: event_log declares its partition column's true occurredAt role and carries it as registered structural debt
      Given the event_log table declaration
      When its EventOccurredAt column is inspected
      Then it reports the occurredAt role, not frozen, and not platform-controlled
      And event_log's structuralDebt names EventOccurredAt with a reason

    @unit
    Scenario: event_log's EventOccurredAt still encodes to the same UInt64 epoch millisecond wire value
      Given the event_log table declaration
      When a row's EventOccurredAt is encoded
      Then the wire value is the same UInt64 epoch-millisecond string it always was

    @unit
    Scenario: governance_kpis's HourBucket and LastEventOccurredAt still encode to the same wire values
      Given the governance_kpis repository's insertContributions
      When a contribution is inserted
      Then HourBucket encodes to the same DateTime wire string it always did
      And LastEventOccurredAt encodes to the same DateTime64(3) wire string it always did

    @unit
    Scenario: dspy_steps's CreatedAt still encodes to the same DateTime64(3) wire value
      Given the dspy_steps repository's insertStepDirect
      When a step is inserted
      Then CreatedAt encodes to the same DateTime64(3) wire string it always did
