Feature: Workbench actions
  As a user working with an assistant on an evaluation
  I want the assistant to make the same edits I can make by hand
  So that what it does to the workbench is exactly what I would have done

  Background:
    Given I have an evaluation workbench with a dataset, a target and an evaluator

  # ============================================================================
  # Duplicating a target
  # ============================================================================

  @unit
  Scenario: A duplicated target keeps the wiring of the target it came from
    Given the evaluator reads a field on the target that no name matching can guess
    When I duplicate the target
    Then the copy is added as a new column
    And the evaluator reads the same field on the copy

  @unit
  Scenario: A duplicated target is graded on its own output
    Given the evaluator reads the target's output
    When I duplicate the target
    Then the evaluator reads the copy's output for the copy's column
    And the original column keeps its own wiring

  # ============================================================================
  # Prompt and model edits
  # ============================================================================

  @unit
  Scenario: Changing the model needs a prompt draft to change
    Given the target runs a saved prompt with no unsaved draft
    When I ask to change the target's model
    Then the change is refused and says the target has no draft prompt

  # ============================================================================
  # Dataset edits
  # ============================================================================

  @unit
  Scenario: Rows and columns of a saved dataset are not edited through the workbench
    Given the workbench holds a saved dataset
    When I ask to write a cell of that dataset
    Then the change is refused and says the dataset is saved

  @unit
  Scenario: New rows land in every column
    When I add two rows that fill only one column
    Then both rows are appended
    And the other column gets an empty cell for each new row

  @unit
  Scenario: A cell is only written to a column the table shows
    When I ask to write a cell of a column the dataset does not have
    Then the change is refused and says the column does not exist
    And no column is added to the dataset

  # ============================================================================
  # Wiring a target or an evaluator
  # ============================================================================

  @unit
  Scenario: A mapping only names entities the workbench holds
    When I ask to map a field to a dataset, a target or an evaluator that does not exist
    Then the change is refused and says which one is missing
    And no mapping is stored

  # ============================================================================
  # Adding a column, and running a subset of them
  # ============================================================================

  @unit
  Scenario: An id the workbench already holds is refused
    When I ask to add a target or an evaluator under an id the workbench already holds
    Then the change is refused and says the id is in use
    And the workbench keeps the column it already had

  @unit
  Scenario: A scoped run names real targets
    When I ask to run a list of targets and one entry names no target
    Then the run is refused instead of covering every target

  # ============================================================================
  # Adding an evaluator
  # ============================================================================

  @unit
  Scenario: Only the comparison judge can be a standalone comparison column
    When I ask to add a plain evaluator together with a comparison config
    Then the change is refused and says which evaluator can be a comparison column
    And it says to leave the comparison config out so the evaluator grades every column

  @unit
  Scenario: An evaluator names a type that exists
    When I ask to add an evaluator under a type no evaluator has
    Then the change is refused and says how to list the types the workbench accepts

  @integration
  Scenario: A stored comparison config on a plain evaluator is repaired
    Given a saved evaluation whose plain evaluator carries a comparison config
    When the assistant edits that evaluation
    Then the evaluator reads back as a score attached to every target column
    And the edit is saved rather than refused for a field no one typed

  # Two boundaries refuse the same shape, and an agent that reads two wordings for
  # one rule reads them as two rules. Pinned against a live stack, because the
  # wording is a shared constant and a copy of it is what drifts.
  @e2e
  Scenario: The save boundary refuses a comparison config in the dispatch's own words
    Given a saved evaluation whose plain evaluator is given a comparison config
    When the setup is written back over the API
    Then the write is refused as an invalid setup
    And the refusal says the same thing the action dispatch says

  # ============================================================================
  # What the assistant is allowed to do, and what it can see
  # ============================================================================

  @unit
  Scenario: Every action names the permission it needs
    When I list the actions the workbench exposes
    Then each one names a payload schema and a required permission
    And reading the workbench needs only the permission to view experiments

  @unit
  Scenario: Every action documents what it does
    When I list the actions the workbench exposes
    Then each action carries prose saying what it does and when to use it
    And adding an evaluator says that leaving the comparison config out attaches it to every column as a score
    And running says it runs on the open page, falls back to a server run, and answers with the run id

  @unit
  Scenario: The state an assistant reads names every column
    Given two columns of the workbench share one name
    When the assistant reads the workbench state
    Then each column carries the name its own header shows
    And the two same-name columns are numbered the way a run's errors number them
    And a column whose name is not resolved reads as its own id

  @unit
  Scenario: The state an assistant reads shows what a comparison judges
    Given the workbench holds a comparison over two columns
    When the assistant reads the workbench state
    Then the comparison names the columns it judges, by id and by name
    And it says whether it judges against a golden answer, and which field holds it
    And an evaluator column names the saved evaluator it runs

  @unit
  Scenario: The state an assistant reads says how the last run went
    Given the last run filled some cells and failed others
    When the assistant reads the workbench state
    Then each column reports how many cells are filled, of how many rows
    And each column reports how many rows failed, with up to three distinct failure kinds
    And each column reports the pass, fail and score totals of every evaluator on it
    And the state names the run the cells came from
    And the failure kinds and the evaluator totals are the first results detail dropped when the state has to shrink

  @unit
  Scenario: The state an assistant reads stays small
    Given the workbench holds more data than the assistant's budget
    When the assistant reads the workbench state
    Then the sample rows are dropped first
    And the state says it was truncated

  @unit
  Scenario: The state an assistant reads never exceeds the budget
    Given the workbench still overruns the budget with every detail dropped
    When the assistant reads the workbench state
    Then whole entries are left out until the state fits
    And the state counts how many entries it left out
