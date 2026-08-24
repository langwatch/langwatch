Feature: Test case history in the interface
  As a person who edits a test case
  I want to see its version and open its history
  So that I can tell what I changed and go back if I need to

  Background: where history is shown.
    The case editor shows the current version as a small chip beside the case
    name. A ghost History control with a history icon sits to the left of
    Rerun in the run detail drawer and in the editor footer area.

    Choosing History opens a drawer that lists the versions, newest first. Each
    entry shows its number, who saved it, when, and which fields changed.

    The domain rules are in specs/scenarios/scenario-versioning.feature and
    specs/scenarios/scenario-version-restore.feature.

  # --- The version chip ---

  @integration
  Scenario: The editor shows the current version beside the case name
    Given a test case at version 4
    When its editor is opened
    Then a chip beside the name reads version 4

  @integration
  Scenario: The chip goes up after a save
    Given a test case at version 4 open in the editor
    When a field is changed and the case is saved
    Then the chip reads version 5

  @integration
  Scenario: The run detail drawer shows the version the run used
    Given a finished run of a case at version 3, while the case is now at version 6
    When the drawer is opened
    Then it reads version 3, the version that ran
    And it does not read version 6

  # --- The History drawer ---

  @integration
  Scenario: History opens a drawer listing the versions newest first
    Given a test case with three versions
    When History is chosen
    Then a drawer lists version 3, version 2 and version 1 in that order

  @integration
  Scenario: A history entry names the author, the date and the changed fields
    Given a version saved by "Lena Fischer" that changed the name and the criteria
    When the history drawer is read
    Then that entry names "Lena Fischer"
    And it shows the date of the save
    And it lists the name and the criteria as changed

  @integration
  Scenario: Choosing a version shows what it held
    Given the history drawer with three versions
    When version 2 is chosen
    Then the content of version 2 is shown, read-only
    And the current version is still marked in the list

  @integration
  Scenario: A case that never had a save shows one Created entry
    Given a test case saved before version history existed
    When History is opened
    Then one entry reads Created at version 1
    And it carries the date the case was created

  @integration
  Scenario: The History control is not shown for a case in an external set
    Given a case that only exists as runs from an external set
    When its run is opened
    Then no History control is offered

  # --- Restore ---

  @integration @unimplemented
  Scenario: Restore writes a new version and closes the drawer on the new one
    Given the history drawer with a test case at version 5
    When version 2 is restored
    Then the drawer lists a new version 6 at the top
    And the editor reads the content of version 2
    And version 5 is still listed

  @integration @unimplemented
  Scenario: Restore asks for confirmation before it writes
    Given the history drawer with an older version chosen
    When Restore is chosen
    Then a confirmation names the version being restored
    And leaving the confirmation writes nothing

  @integration @unimplemented
  Scenario: A viewer sees history but no Restore control
    Given a person with read-only access to the project
    When they open the history drawer
    Then the versions are listed
    And no Restore control is offered

  # --- Failure paths ---

  @integration
  Scenario: A save that lost a race says the case changed
    Given a test case open in the editor while somebody else saves it
    When Save is chosen
    Then the editor says the case changed since it was opened
    And it offers to reload the newer version
    And it does not read "unknown error"

  @integration
  Scenario: A history drawer that cannot load says so and offers to retry
    Given the history of a test case cannot be read
    When History is chosen
    Then the drawer says the history could not be loaded
    And it offers to try again
