# The topic-clustering event stream owns the topic model. The Topic table is
# its projection: rebuildable by replay, written only by the projection.
Feature: Topic clustering owns the topic model

  Topics and subtopics are facts recorded on the project's topic
  clustering stream. Every surface that shows or filters by topics reads
  the projected model; every change to the model is an event. Projects
  that already had topics before this change are seeded into the stream
  on service start, so replay reproduces them.

  Background:
    Given a project with an event-sourced topic clustering process

  Scenario: A batch clustering run replaces the topic model through the stream
    When a batch clustering run finishes with a new set of topics
    Then the new model is recorded as an event on the project's stream
    And the projected topics replace the previous ones
    And the topic ids match the ids assigned to the project's traces

  Scenario: An incremental clustering run extends the model
    When an incremental clustering run finds new subtopics
    Then the recorded event merges them into the model
    And existing topics keep their ids and names

  Scenario: Recording the same run's topics twice changes nothing
    Given a clustering run whose topics were already recorded
    When the same run's topics are recorded again
    Then the projected model is unchanged

  Scenario: Topic surfaces read the projected model
    When the user opens a surface that shows topics
    Then the topics come from the projected model
    And filtering by topic uses the same ids as before

  Scenario: Existing topics are seeded into the stream on service start
    Given a project whose topics predate event-sourced ownership
    When the worker service starts
    Then the project's existing topics are recorded as a seed event
    And their ids, names, and hierarchy are preserved exactly
    And re-running the seed changes nothing

  Scenario: Seeding reaches every project that predates ownership
    Given many projects whose topics predate event-sourced ownership
    When the worker service starts
    Then every one of those projects is seeded, not just the first page
    And a project the projection already owns is left untouched

  Scenario: A late duplicate seed can never remove recorded topics
    Given a project whose topics were seeded and then extended by clustering
    When a duplicate seed carrying only the original topics arrives late
    Then the model keeps every topic recorded since the first seed

  Scenario: Seeding coordinates across replicas without a deploy-time job
    Given several worker replicas starting at once
    When seeding runs on service start
    Then replicas coordinate through Redis when it is available
    And without Redis the seed still runs safely because it is idempotent
    And no separate deploy-time job or chart hook is involved

  Scenario: The topic model is rebuildable from the event log
    Given the projected topic model is lost or corrupted
    When projections are replayed from the event log
    Then the same topics, hierarchy, and clustering state come back
