Feature: A note on a run
  As a person who runs the same test suite again and again
  I want to leave a short note with each run
  So that I can tell later what I changed or what I was testing

  Background: what a note is.
    A note is one short line of free text, like a commit message or a
    hypothesis. It belongs to one batch run, not to a test case and not to a
    run plan. Every run in that batch carries the same note.

    A note can come from the platform run dialog, from the command line, or
    from an SDK or CI run. A run started without a note behaves exactly as it
    did before.

    The carrier is described in
    specs/suites/run-note-metadata-convention.feature.

  # --- Writing a note ---

  @integration
  Scenario: A note typed in the run dialog is stored with the batch
    Given the run dialog is open for a test suite
    When "Add a note to your run" is chosen and "switched judge to the stricter criterion" is typed
    And the run is confirmed
    Then the batch that starts carries that note
    And every run in the batch carries the same note

  @integration
  Scenario: A note given on the command line is stored with the batch
    Given a test suite with active cases and targets
    When the suite is run from the command line with a note
    Then the batch that starts carries that note

  @integration
  Scenario: A note given by an SDK or CI run is stored with the batch
    Given a batch started from an SDK run with a note in its run metadata
    When the batch is read back
    Then the batch carries that note
    And the note reads the same as a note written in the platform dialog

  @integration
  Scenario: A note on a single scenario run is stored with that run
    Given a test case and a target
    When a run of that case is started with a note
    Then that run carries the note

  # --- Reading a note back ---

  @integration
  Scenario: The runs sidebar shows the note under the run entry
    Given a run plan with a run that carries the note "switched judge to the stricter criterion"
    When the run plan is opened
    Then the sidebar entry for that run shows the note
    And it also shows how long ago the run started and its pass rate

  @integration
  Scenario: The run header shows the note of the selected run
    Given a run that carries a note is selected
    When its results are shown
    Then the header shows the note beside the run name

  @integration
  Scenario: A run with no note shows no note line
    Given a run started without a note
    When the run plan is opened
    Then the sidebar entry shows no note line
    And the entry keeps the same height as it had before notes existed

  @integration
  Scenario: A long note is shortened in the sidebar and readable in full on hover
    Given a run with a note of two hundred characters
    When the run plan is opened
    Then the sidebar shows the start of the note on one line
    And the full note is readable on hover

  # --- Limits ---
  #
  # These limits belong to the paths that START a run: the run dialog and the
  # CLI. A note that arrives on a run event from an SDK or a CI job is trimmed
  # the same way, but its length is not checked. See
  # specs/suites/run-note-metadata-convention.feature.

  @unit
  Scenario: A note of only spaces is dropped
    When a run is started with a note of only spaces
    Then the batch records no note
    And the metadata of the run is the same as a run started with no note at all

  @unit
  Scenario: Spaces around a note are removed before it is stored
    When a run is started with the note "  retry after the timeout fix  "
    Then the stored note reads "retry after the timeout fix"

  @unit
  Scenario: A note over two hundred characters is rejected with validation_error
    When a run is started with a note of two hundred and one characters
    Then the request is rejected with "validation_error"
    And no run is scheduled
    And the rejection names the note field

  @integration
  Scenario: The run dialog refuses a note over two hundred characters before the run starts
    Given the run dialog is open with a note field
    When more than two hundred characters are typed into it
    Then the note field shows that it is too long
    And the Run button does not start a run
