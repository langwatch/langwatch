Feature: The run note travels in the run metadata
  As a developer who starts runs from CI or from an SDK
  I want one documented place to put the note
  So that a run started from code shows the same note as a run started in the platform

  Background: the convention.
    A run note travels as the top-level "note" key of the run metadata. This is
    a public contract, written in ADR-008. Any caller that can set run metadata
    can set a note, and no caller needs a target reference or any other
    platform-only field to do it.

    The platform stamps the note onto every run of a batch when the batch is
    queued, so a run carries its note from its first moment. Batch history
    reads the note back from the runs it already loads.

    What the person sees is in specs/suites/run-notes.feature.

  # --- The write side ---

  @unit
  Scenario: The note is written under the top-level note key of the run metadata
    When a run is queued with the note "nightly regression"
    Then the run metadata carries "note" holding "nightly regression"
    And the note is not written inside the reserved langwatch namespace

  @unit
  Scenario: A run queued without a note records metadata identical to before notes existed
    When a run is queued with no note
    Then the run metadata carries no "note" key
    And it is byte-identical to the metadata the same run recorded before notes existed

  @integration
  Scenario: Every run of a batch carries the note stamped at queue time
    Given a run plan with three scenarios and two targets
    When the plan is run with a note
    Then all six queued runs carry the same note
    And the note is present before any run finishes

  @integration
  Scenario: A note set directly by an SDK caller reads like a platform note
    Given an SDK run that sets "note" in its own run metadata
    When the run is stored
    Then the note reads back on the run
    And the other metadata keys the caller set are kept too

  @unit
  Scenario: Spaces around a note on an SDK run are removed
    Given an SDK run whose "note" has spaces around it
    When the run event is read
    Then the note reads without them

  @unit
  Scenario: A blank note on an SDK run is dropped
    Given an SDK run whose "note" holds only spaces
    When the run event is read
    Then the run records no note

  # The length limit belongs to the paths that START a run. An event reports a
  # run that already happened, so refusing it over the length of its note would
  # lose the run itself.
  @unit
  Scenario: A long note on an SDK run is kept rather than refused
    Given an SDK run whose "note" holds two hundred and one characters
    When the run event is read
    Then the event is accepted
    And the note is kept in full

  # --- The read side ---

  @integration
  Scenario: Batch history reads the note from the runs it already loads
    Given a run set with several batches, some with notes and some without
    When one page of batch history is read
    Then each batch reports its note, or reports none
    And no extra query is made to read the notes

  @integration
  Scenario: The batch summary of one batch reports its note
    Given a batch whose runs carry a note
    When the summary of that batch is read
    Then the summary reports the note

  @integration
  Scenario: A batch whose runs carry no note reports no note
    Given a batch started without a note
    When batch history is read
    Then the batch reports no note

  @integration
  Scenario: An external SDK batch with no run plan record still reports its note
    Given a batch produced only by SDK runs, with no run plan record behind it
    And those runs carry a note
    When batch history for that set is read
    Then the batch reports the note

  @integration
  Scenario: Reading the note keeps the run set query bounded to the page
    Given a run set with many batches
    When batch history is read
    Then the note is read only for the batches on the page
    And the query that counts the whole set does not read run metadata

  # --- Types ---

  @unit
  Scenario: The note is a readable field on the run payload the interface consumes
    Given a stored run that carries a note
    When its payload is read
    Then the note is available as a named string field
    And a run without a note reports it as absent rather than as an empty string
