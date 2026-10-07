Feature: Replicating an experiment creates an independent copy
  As a user replicating an experiment
  I want the copy to save to itself
  So that editing the copy never changes the original

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
  Scenario: A replicated experiment in another project can be saved
    Given an experiment replicated into another project
    When the copy is opened in the editor and saved in that project
    Then the save succeeds

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
