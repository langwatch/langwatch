# The topic-clustering event stream owns the topic model. The Topic table is
# its projection: rebuildable by replay, written only by the projection.
Feature: Topic clustering owns the topic model

  Topics and subtopics are facts recorded on the project's topic
  clustering stream. Every surface that shows or filters by topics reads
  the projected model; every change to the model is an event. Projects
  that already had topics before this change are seeded into the stream
  on a scheduled wake, so replay reproduces them.

  Background:
    Given a project with an event-sourced topic clustering process

  @unit
  Scenario: A batch clustering run replaces the topic model through the stream
    When a batch clustering run finishes with a new set of topics
    Then the new model is recorded as an event on the project's stream
    And the projected topics replace the previous ones
    And the topic ids match the ids assigned to the project's traces

  @unit
  Scenario: An incremental clustering run extends the model
    When an incremental clustering run finds new subtopics
    Then the recorded event merges them into the model
    And existing topics keep their ids and names

  @unimplemented
  Scenario: Recording the same run's topics twice changes nothing
    Given a clustering run whose topics were already recorded
    When the same run's topics are recorded again
    Then the projected model is unchanged

  @unimplemented
  Scenario: Topic surfaces read the projected model
    When the user opens a surface that shows topics
    Then the topics come from the projected model
    And filtering by topic uses the same ids as before

  @unimplemented
  Scenario: Existing topics are seeded into the stream on a scheduled wake
    Given a project whose topics predate event-sourced ownership
    When the clustering pipeline's seed process wakes
    Then the project's existing topics are recorded as a seed event
    And their ids, names, and hierarchy are preserved exactly
    And re-running the seed changes nothing

  @unit
  Scenario: Seeding reaches every project that predates ownership
    Given many projects whose topics predate event-sourced ownership
    When the clustering pipeline's seed process wakes
    Then every one of those projects is seeded, not just the first page
    And a project the projection already owns is left untouched

  @unit
  Scenario: A late duplicate seed can never remove recorded topics
    Given a project whose topics were seeded and then extended by clustering
    When a duplicate seed carrying only the original topics arrives late
    Then the model keeps every topic recorded since the first seed

  @unimplemented
  Scenario: Seeding coordinates across replicas without a deploy-time job
    Given several worker replicas able to run the seed
    When seeding runs on its scheduled wake
    Then replicas coordinate through a shared claim when it can be taken
    And without the claim the seed still runs safely because it is idempotent
    And no separate deploy-time job or chart hook is involved

  @unimplemented
  Scenario: The topic model is rebuildable from the event log
    Given the projected topic model is lost or corrupted
    When projections are replayed from the event log
    Then the same topics, hierarchy, and clustering state come back

  @unimplemented
  Scenario: The topic-model seed runs as an upgrade ledger step
    Given an installation upgraded from a release whose projects hold pre-ownership topics
    When the worker runs the background step "topic:seed-topic-model-history"
    Then every project without a projected topic model has its topics recorded on the stream
    And the step's checkpoint names the last project of each page it finished
    And running the step again records nothing new

  @unimplemented
  Scenario: A topic-model seed step that fails for a project resumes before that project
    Given one project's topics cannot be recorded
    When the step "topic:seed-topic-model-history" runs
    Then the step fails naming how many projects it could not seed
    And its checkpoint stops before the page that held the failed project
    And retrying the step reaches that project again

  @unimplemented
  Scenario: A dry run of the topic-model seed writes nothing
    When the step "topic:seed-topic-model-history" runs as a dry run
    Then it reports how many projects it would seed
    And it records no topics and saves no checkpoint

  @unimplemented
  Scenario: The clustering schedule seed runs as an upgrade ledger step
    Given eligible projects that predate event-sourced scheduling and have no scheduled wake
    When the worker runs the background step "topic:seed-clustering-schedules"
    Then each of those projects is asked for a bootstrap clustering run
    And projects that already have a scheduled wake are skipped
