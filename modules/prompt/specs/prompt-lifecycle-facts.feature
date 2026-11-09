Feature: Prompt records when a version is saved and when a prompt is deleted
  Saving a version and deleting a prompt are prompt's own facts, recorded on its
  prompt_lifecycle pipeline after the write returns, with ids only. Peers count or
  react from their own side and read anything else through PromptApi (ARCHITECTURE.md §9).
  Nurturing does not read them yet.

  @unit
  Scenario: saving a new version of a prompt records that a version was saved
    Given prompt_lifecycle is connected in the process
    When a prompt is updated
    Then prompt sends one version saved fact carrying only ids, keyed to the project

  @unit
  Scenario: restoring an earlier version records the restored copy as a saved version
    Given prompt_lifecycle is connected in the process
    When an earlier version of a prompt is restored
    Then prompt sends one version saved fact for the new version the restore wrote

  @unit
  Scenario: pushing or syncing a source onto a copy records a saved version on the copy
    Given prompt_lifecycle is connected in the process
    When a source prompt is written onto one of its copies
    Then prompt sends one version saved fact for the copy, keyed to the copy's project

  @unit
  Scenario: creating a prompt records no saved version
    Given prompt_lifecycle is connected in the process
    When a prompt is created
    Then no version saved fact is sent, since lw.prompt.created already covers it

  @unit
  Scenario: deleting a prompt by its handle records that the prompt was deleted
    Given prompt_lifecycle is connected in the process
    When a prompt is deleted by its handle
    Then prompt sends one deleted fact carrying the prompt's id, keyed to the project

  @unit
  Scenario: a redelivered lifecycle command records nothing new
    Given a version saved or a deleted command
    When the command is handled twice
    Then both events carry one idempotency key

  @unit
  Scenario: a lost lifecycle fact never fails the write
    Given every prompt_lifecycle send fails
    When a prompt is updated and then deleted
    Then the update and the delete succeed and nothing is thrown
