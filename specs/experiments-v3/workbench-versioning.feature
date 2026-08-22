Feature: Versioned workbench saves

  Every write to an evaluations workbench goes through one server-owned seam,
  whoever makes it: a person typing, the assistant, or an API caller. The seam
  validates the state, refuses a save that is built on a version somebody else
  already replaced, advances a version counter, and records a version row.

  Ordinary typing keeps one rolling autosave row so a long editing session does
  not bury the versions that mean something. A named commit, an assistant write
  and a restore each add a numbered row.

  @regression @integration
  Scenario: A save that names an old version is refused before anything is written
    Given an evaluation was saved and its version advanced
    When a client saves again naming the version it read before that save
    Then the save is refused as stale
    And the stored state and version are unchanged

  @regression @integration
  Scenario: A save with no expected version advances the counter
    Given an evaluation at some version
    When a client saves without naming a version
    Then the stored version is one higher

  @regression @integration
  Scenario: Repeated typing keeps a single rolling autosave row
    Given a person saves an evaluation several times with no commit message
    When the version rows are listed
    Then exactly one autosaved row exists
    And its version matches the evaluation's current version

  @regression @integration
  Scenario: A commit creates a numbered version with its message
    Given an evaluation with a saved state
    When the caller commits it with a message
    Then a new version row exists that is not an autosave
    And it carries the message

  @regression @integration
  Scenario: An assistant write is recorded as its own version
    Given an evaluation with a saved state
    When the assistant saves through the seam
    Then a new version row exists that is not an autosave
    And it is attributed to the assistant

  @regression @integration
  Scenario: A restore writes the old state forward
    Given an evaluation with an earlier version
    When the caller restores that version
    Then the current state matches the restored version
    And the earlier version row is still in the list
    And the current version is higher than both

  @regression @integration
  Scenario: An archived evaluation refuses a save
    Given an evaluation that was archived
    When a stale client saves with its id
    Then the save is refused as not found
    And the archived row is unchanged

  @regression @integration
  Scenario: A save cannot reach another project's evaluation
    Given an evaluation in another project
    When a caller saves it naming its own project
    Then the save is refused as not found

  @regression @unit
  Scenario: A state that does not match the schema is refused
    When a caller saves a state with a missing required field
    Then the save is refused as an invalid workbench state

  @regression @unit
  Scenario: A state pointing at a row that no longer exists is refused
    When a caller saves a state naming a deleted prompt, agent, evaluator, workflow or dataset
    Then the save is refused and names which kind of row and which id is missing

  @regression @unit
  Scenario: Run results are not stored in the version snapshot
    Given a state that carries run results
    When it is saved
    Then the version snapshot holds the setup without the results

  @regression @integration
  Scenario: A run stops when a target's agent was deleted
    Given an evaluation whose target names an agent that no longer exists
    When the run loads its execution data
    Then the run fails and names the missing agent

  @regression @integration
  Scenario: A run stops when an evaluator was deleted
    Given an evaluation whose evaluator no longer exists
    When the run loads its execution data
    Then the run fails and names the missing evaluator
