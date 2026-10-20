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

  @unimplemented
  Scenario: Each finished run appears once in the run history
    When the user opens the topic clustering settings page
    Then they see the project's recent runs, newest first
    And each run shows when it ran, what started it, and its outcome
    And a completed run shows the traces processed and topics found

  @unit
  Scenario: A multi-page run is one history entry
    Given a run that walked its backlog across several pages
    When the user views the run history
    Then that run appears as a single entry
    And its counts accumulate every page of the run

  @unit
  Scenario: A failed run keeps its guidance without raw error detail
    Given a run that failed with a failure the user can fix
    When the user views the run history
    Then the failed run shows the same guidance as the status card
    And the raw error text is not part of the history read model

  @unit
  Scenario: A run that is still working appears as running
    Given a clustering run has started and has not finished
    When the user views the run history
    Then the newest entry shows as running

  @unit
  Scenario: A run abandoned by the scheduler is not shown as running forever
    Given a run whose terminal outcome was never recorded
    When a later run starts
    Then the abandoned run's entry stops reading as running

  @unit
  Scenario: History is bounded
    Given a project with more recorded runs than the history keeps
    When the user views the run history
    Then only the most recent runs are shown

  # The history keeps only the newest runs; a page continues over what is retained, never beyond it.
  @unit
  Scenario: The run history continues page by page, newest first, to its retained end
    Given the retained history holds more runs than one page
    When a member reads a page and then each page after it by the cursor it returned
    Then every retained run appears exactly once, in the order the full history lists them
    And only the last page says there is no more

  @unit
  Scenario: A project with no recorded runs has an empty single page
    Given a project whose clustering process has recorded no runs
    When a member reads the first page of the run history
    Then the page holds no runs and says there is no more

  @unit
  Scenario: A run finishing between two pages does not repeat or skip a run
    Given a member has read the first page of the run history
    When another run finishes and joins the history before they read the next page
    Then the next page continues after the last run they saw

  @unit
  Scenario: A cursor whose run has left the retained history asks the reader to restart
    Given a cursor naming a run the projection has trimmed away, or one from another project
    When a member reads the page it names
    Then the answer is cursor_expired and carries no runs

  @unit
  Scenario: A run that never finished reads as abandoned on every page
    Given a run whose terminal outcome was never recorded and is past the stale window
    When a member reads the page that holds it
    Then its entry reads as abandoned, as it does in the whole history

  @unit
  Scenario: Reading the run history by page is a project view, like reading it whole
    Given a caller without the project view permission
    When they read a page of the run history
    Then they are refused and no history is read

  @unit
  Scenario: The whole-history read keeps answering the array it always did
    Given a member who may view the project
    When they read the run history without paging
    Then they receive the full retained list as an array

  @unimplemented
  Scenario: History is rebuildable from the event log
    Given the run history read model is lost or corrupted
    When projections are replayed from the event log
    Then the run history shows the same entries as before
