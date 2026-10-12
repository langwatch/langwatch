Feature: Replicating an experiment creates an independent copy
  As a user replicating an experiment
  I want the copy to save to itself
  So that editing the copy's experiment state never changes the original

  @integration
  Scenario: A replicated experiment does not carry the original's identity
    Given an experiment whose saved state holds its own id, slug and results
    When the experiment is replicated
    Then the copy's saved state has no experiment id or slug
    And the copy's saved state has no results
    And the copy is named "<name> (copy)"

  @integration
  Scenario: Saving a replicated experiment leaves the original untouched
    Given a replicated experiment
    When the copy is opened in the editor and saved with edits
    Then the original's saved state and update time are unchanged
    And the copy's saved state has the edits

  @integration
  Scenario: Opening a copy made before the fix edits the copy
    Given a copy whose saved state still holds the original's id and slug
    When the copy is opened in the editor and saved with edits
    Then the original's saved state and update time are unchanged
    And the copy's saved state has the edits

  @integration
  Scenario: A copy of a copy and a second copy are independent of the original
    Given an original whose saved state holds its own id and slug
    And a copy, a second copy and a copy of the first copy
    When the copy of the copy is opened in the editor and saved with edits
    Then the original and the other copies are unchanged

  @integration
  Scenario: A save is written to the experiment it is addressed to
    Given a copy
    When a save addressed to the copy carries the original's id and slug in its state
    Then the original's saved state and update time are unchanged
    And the copy's saved state has the edits

  @integration
  Scenario: Opening a copy in the editor saves to the copy
    Given a copy, saved by the fixed server or made before the fix
    When it is opened in the editor, edited and autosaved
    Then every save is addressed to the copy's id

  @integration
  Scenario: A replicated experiment in another project can be saved
    Given an experiment replicated into another project
    When the copy is opened in the editor and saved in that project
    Then the save succeeds

  @integration
  Scenario: A copy into another project with its dataset copied can be saved
    Given an experiment using a saved dataset
    And the experiment is replicated into another project with its datasets copied
    When the copy is opened in the editor and saved in that project
    Then the save succeeds
    And the copy uses a dataset in the other project
    And the original's saved state and update time are unchanged

  @integration
  Scenario: Saving a copy in another project that still uses a source-project prompt is refused
    Given an experiment whose target uses a prompt
    And the experiment is replicated into another project
    When the copy is opened in the editor and saved in that project
    Then the save is refused because the prompt does not exist there
    And the original's saved state and update time are unchanged

  @unit
  Scenario: Loading a copy made before the fix keeps the loaded row's identity
    Given an editor opened on an experiment row with its own id and slug
    When a saved state carrying another experiment's id and slug is loaded
    Then the editor keeps the row's id and slug

  @unit
  Scenario: The replicate dialog says prompts, evaluators and agents are shared within the same project
    Given the replicate dialog target is the current project
    When the note is shown
    Then it says editing prompts, evaluators and agents in the copy also changes the original

  @unit
  Scenario: The replicate dialog says prompts, evaluators and agents are not copied to another project
    Given the replicate dialog target is another project
    When the note is shown
    Then it says prompts, evaluators and agents are not copied

  @unit
  Scenario: The note is not shown for a workflow-based experiment
    Given the replicate dialog is opened on a workflow-based experiment
    When a target project is picked
    Then no note about prompts, evaluators and agents is shown

  @integration
  Scenario: Opening another experiment starts from a clean editor
    Given the editor holds an experiment with run results
    When another experiment without results is opened in the same editor
    Then the editor holds no results
    And its saves are addressed to the other experiment

  @integration
  Scenario: Opening an experiment with no saved state does not keep the previous one's content
    Given the editor holds an experiment with content
    When an experiment with no saved state is opened in the same editor
    Then the editor holds none of the previous experiment's content
    And nothing of the previous experiment is saved into it
