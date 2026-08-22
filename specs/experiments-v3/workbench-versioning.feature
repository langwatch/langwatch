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

  Rule: The same seam is reachable over REST

    An agent or a CI job builds an experiment without a browser. It creates
    one, reads the setup, saves a new one, lists what was saved and brings an
    old one back — through the same seam, with the same refusals.

    @integration
    Scenario: Creating an experiment over REST gives a workbench you can open
      Given a caller with a project API key
      When it creates an experiment and sends no setup
      Then the experiment starts at version 1 with one empty dataset

    @integration
    Scenario: An agent edits an experiment through the REST surface
      Given an experiment created over REST
      When the caller reads its setup, saves a new one, and restores the first
      Then the history lists both saves and the restore, newest first

    @integration
    Scenario: A poller checks for changes without pulling the setup
      Given an experiment with a saved setup
      When the caller asks for the version field only
      Then it gets the version and the timestamp, and no setup

    @integration
    Scenario: A stale save is refused with the version to read again
      Given an experiment somebody else already saved on top of
      When the caller saves naming the version it read before that
      Then the save is refused and names the version stored now

    @integration
    Scenario: A setup that cannot be read is refused with its code
      Given an experiment with a saved setup
      When the caller saves a setup that does not match the schema
      Then the save is refused with the invalid-setup code

    @integration
    Scenario: An unknown experiment reads as not found
      Given a slug no experiment in this project has
      When the caller reads its setup
      Then the read answers not found

    @integration
    Scenario: A restore of a version that does not exist reads as not found
      Given an experiment with one version
      When the caller restores a version number it never had
      Then the restore answers not found

    @integration
    Scenario: The workbench endpoints refuse an unauthenticated caller
      Given a request carrying no credentials
      When it reaches a workbench endpoint
      Then the request is refused as unauthenticated

    @integration
    Scenario: Each workbench endpoint declares the grain it needs
      Given the route registry
      When the workbench endpoints are read from it
      Then reading declares the view grain and writing declares the update grain

    @unit
    Scenario: A create call with no setup stores a workbench that loads
      Given a create call that sends no setup
      When the blank setup is built
      Then it matches the persisted schema

    @unit
    Scenario: The server blank matches the workbench a browser starts from
      Given the blank setup the server builds
      When it is compared with the workbench a browser starts from
      Then the dataset, its columns, the targets and the evaluators are the same

    @unit
    Scenario: The server blank starts with no rows
      Given the blank setup the server builds
      When its dataset is read
      Then the dataset has no rows

  Rule: The command line drives the same endpoints

    @unit
    Scenario: Creating an experiment from the CLI
      Given the create command with a name
      When it runs
      Then it reports the new slug and version

    @unit
    Scenario: Checking an experiment's version without pulling its setup
      Given the get-state command asked for the version field
      When it runs
      Then it reports the version and does not pull the setup

    @unit
    Scenario: Saving a setup from a file
      Given the set-state command pointed at a file holding a setup
      When it runs with an expected version and a message
      Then the setup is sent with both

    @unit
    Scenario: Listing an experiment's versions
      Given the versions command
      When it runs
      Then it prints a row per version naming who saved it

    @unit
    Scenario: Restoring an experiment version from the CLI
      Given the restore command with a version number
      When it runs
      Then it restores that version and reports the version the restore wrote

  Rule: The workbench shows its own history

    @integration
    Scenario: The version history names each version and who saved it
      Given an experiment with saved versions
      When the version history opens
      Then each row names the version, its author and when it was saved

    @integration
    Scenario: A restore asks for confirmation first
      Given the version history is open
      When the reader clicks restore on a version
      Then nothing is restored until the reader confirms

    @integration
    Scenario: Restoring a version reloads the workbench
      Given the version history is open
      When the reader confirms a restore
      Then the restored setup is loaded into the workbench

    @integration
    Scenario: Restore is not offered without the permission
      Given a reader who cannot update experiments
      When the version history opens
      Then no row offers a restore
