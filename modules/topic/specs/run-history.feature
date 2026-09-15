# See dev/docs/adr/051-event-sourced-topic-clustering.md — the run events are
# the source of truth; history is a rebuildable read model over them.
Feature: Topic clustering run history

  The topic clustering settings page shows the project's recent run
  history, not just the latest outcome: when each run happened, what
  triggered it, whether it completed, was skipped, or failed, and how
  much work it did. History is an audit read model folded from the run
  events; losing it loses nothing that a replay cannot rebuild.

  Background:
    Given a project whose clustering process has recorded runs

  Scenario: Each finished run appears once in the run history
    When the user opens the topic clustering settings page
    Then they see the project's recent runs, newest first
    And each run shows when it ran, what started it, and its outcome
    And a completed run shows the traces processed and topics found

  Scenario: A multi-page run is one history entry
    Given a run that walked its backlog across several pages
    When the user views the run history
    Then that run appears as a single entry
    And its counts accumulate every page of the run

  Scenario: A failed run keeps its guidance without raw error detail
    Given a run that failed with a failure the user can fix
    When the user views the run history
    Then the failed run shows the same guidance as the status card
    And the raw error text is not part of the history read model

  Scenario: A run that is still working appears as running
    Given a clustering run has started and has not finished
    When the user views the run history
    Then the newest entry shows as running

  Scenario: A run abandoned by the scheduler is not shown as running forever
    Given a run whose terminal outcome was never recorded
    When a later run starts
    Then the abandoned run's entry stops reading as running

  Scenario: History is bounded
    Given a project with more recorded runs than the history keeps
    When the user views the run history
    Then only the most recent runs are shown

  Scenario: History is rebuildable from the event log
    Given the run history read model is lost or corrupted
    When projections are replayed from the event log
    Then the run history shows the same entries as before
