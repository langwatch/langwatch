Feature: The prompt editor reports a modified prompt only when it was modified
  As someone editing a prompt in the prompt editor drawer,
  I want the modified mark to mean that I changed something,
  So that the unsaved-changes warning keeps protecting the work it was built for.

  # The drawer decides "modified" by comparing the form against a baseline taken
  # from the stored prompt. The form does not sit still after a load: it derives
  # the demonstration columns from the prompt's inputs and outputs and writes
  # them into itself. The stored prompt carries no such columns, so the first
  # comparison read two different shapes and reported an edit nobody made, on
  # every seeded prompt, together with an "Update to v2" that would record no
  # change. The baseline now carries the same derived columns, so both sides are
  # the same shape from the first comparison on.

  Background:
    Given a prompt that was created by seeding and never edited

  @integration
  Scenario: An untouched prompt is not reported as modified
    When the prompt editor drawer opens the prompt
    And nothing is typed
    Then no modified mark is shown
    And the save action reads as saved rather than offering a new version

  @integration
  Scenario: Closing an untouched prompt warns about nothing
    When the prompt editor drawer opens the prompt
    And nothing is typed
    And the drawer is closed
    Then no unsaved-changes warning is shown

  @integration
  Scenario: A real edit is still reported as modified
    When the prompt editor drawer opens the prompt
    And one character is typed into the prompt
    Then the modified mark is shown
    And the save action offers the next version

  @unit
  Scenario: Stored demonstrations that already match are left alone
    Given a stored prompt whose demonstrations already carry the derived columns
    When its form values are read
    Then the demonstrations are the stored ones, unchanged

  @unit
  Scenario: A stored prompt carries the demonstration columns its fields imply
    Given a stored prompt with one input and one output
    When its form values are read
    Then the demonstrations carry one column for the input and one for the output
    And the stored demonstration records are kept
