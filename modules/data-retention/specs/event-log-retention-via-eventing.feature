Feature: Event-log retention through eventing's retention operation
  data-retention owns which retention category each event-log row belongs to;
  eventing owns the event log and runs the rewrite (Q205, 2026-10-06).
  data-retention supplies its classification and never builds SQL against the
  event log itself.

  Background:
    Given a project with events in the event log of every aggregate type
    And durable identity, authorisation and virtual-key lifecycle events among them

  @unit
  Scenario: A category's retention change reaches the event log through eventing
    When the project's traces retention changes
    Then data-retention asks eventing's retention operation to retain the traces category
    And no data-retention statement names the event log

  @integration
  Scenario: A trace-category event past the new retention is marked to expire
    Given a trace event stamped with the old traces retention
    When the project's traces retention changes
    Then that event carries the new retention

  @integration
  Scenario: Durable security events never take a category's retention
    Given an identity, an authorisation and a virtual-key lifecycle event
    When the project's retention changes for any category
    Then each durable event keeps its indefinite retention

  @integration
  Scenario: Another category's events keep their retention
    Given a scenario event and an experiment event
    When the project's traces retention changes
    Then neither event's retention changes

  @integration
  Scenario: The rewrite selects the same rows as the per-row classifier
    Given seeded rows across every aggregate type, an unlisted aggregate type and each durable event type
    When each category's rewrite is evaluated against them
    Then it selects exactly the rows the event-log classifier puts in that category

  @unit
  Scenario: A rewrite for another category does not block this one
    Given an unfinished event-log rewrite recorded for the scenarios category
    When the project's traces retention changes
    Then the traces rewrite starts
    And an unmarked legacy event-log rewrite counts as a traces rewrite

  @unit
  Scenario: A category the classification does not name is refused before any rewrite
    When eventing's retention operation is asked to retain an unknown category
    Then it refuses by name
    And no statement reaches the event log

  # Only customer telemetry expires (Alex, 2026-10-09); rows stamped before then are re-stamped.
  @unit
  Scenario: Event-log rows stamped before the ruling are re-stamped to be kept forever
    Given event-log rows of never-expiring events stamped with the default retention
    When data-retention's background upgrade step runs
    Then eventing's retention operation re-stamps them to 0 days on every ClickHouse target
    And a resumed run skips the targets its checkpoint lists as done
