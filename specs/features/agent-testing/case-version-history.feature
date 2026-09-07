Feature: Scenario history in the interface
  As a person who edits a scenario
  I want to see its version and open its history
  So that I can tell what I changed and go back if I need to

  Background: where history is shown.
    The scenario editor header carries one control that reads "v4 · History". It is
    the only way into the history of a scenario: history belongs to the scenario, not
    to any single run of it.

    Choosing it opens a popover under the control that lists the versions,
    newest first. Each entry shows its number, who saved it, when, and which
    fields changed. The scenario editor stays open under the popover.

    The domain rules are in specs/scenarios/scenario-versioning.feature and
    specs/scenarios/scenario-version-restore.feature.

  # --- The version chip ---

  @integration
  Scenario: The editor shows the current version beside the scenario name
    Given a scenario at version 4
    When its editor is opened
    Then a chip beside the name reads version 4

  @integration
  Scenario: The chip goes up after a save
    Given a scenario at version 4 open in the editor
    When a field is changed and the scenario is saved
    Then the chip reads version 5

  @integration
  Scenario: The run detail drawer shows the version the run used
    Given a finished run of a scenario at version 3, while the scenario is now at version 6
    When the drawer is opened
    Then it reads version 3, the version that ran
    And it does not read version 6

  # --- The History popover ---

  @integration
  Scenario: History opens a popover listing the versions newest first
    Given a scenario with three versions open in the editor
    When History is chosen
    Then a popover lists version 3, version 2 and version 1 in that order
    And the scenario editor stays open under it

  @integration
  Scenario: A history entry names the author, the date and the changed fields
    Given a version saved by "Lena Fischer" that changed the name and the criteria
    When the history popover is read
    Then that entry names "Lena Fischer"
    And it shows the date of the save
    And it lists the name and the criteria as changed

  @integration
  Scenario: Choosing a version shows what it held
    Given the history popover with three versions
    When version 2 is chosen
    Then the content of version 2 is shown, read-only
    And the current version is still marked in the list

  @integration
  Scenario: A scenario that never had a save shows one Created entry
    Given a scenario saved before version history existed
    When History is opened
    Then one entry reads Created at version 1
    And it carries the date the scenario was created

  @integration
  Scenario: The row menu of a scenario offers no History item
    Given a scenario with three versions in the table
    When its row menu is opened
    Then no "History" action is offered
    And the versions read inside the editor of that scenario

  @integration
  Scenario: The run drawer offers no History control
    Given a finished run open in the drawer
    When its header is read
    Then the version the run used reads as a plain chip
    And no History control is offered

  # --- Restore ---

  @integration
  Scenario: Restore writes a new version and lists the new one on top
    Given the history popover with a scenario at version 5
    When version 2 is restored
    Then the popover lists a new version 6 at the top
    And the editor reads the content of version 2
    And version 5 is still listed

  @integration
  Scenario: The version a restore wrote says that it is a restore
    Given a version written by restoring version 1
    When the history popover is read
    Then that entry reads "Restored from v1"
    And it does not read as an ordinary field change

  @integration
  Scenario: Restore asks for confirmation before it writes
    Given the history popover with an older version chosen
    When Restore is chosen
    Then a confirmation names the version being restored
    And leaving the confirmation writes nothing

  @integration
  Scenario: A viewer sees history but no Restore control
    Given a person with read-only access to the project
    When they open the history popover
    Then the versions are listed
    And no Restore control is offered

  # --- Failure paths ---

  @integration
  Scenario: A save that lost a race says the scenario changed
    Given a scenario open in the editor while somebody else saves it
    When Save is chosen
    Then the editor says the scenario changed since it was opened
    And it offers to reload the newer version
    And it does not read "unknown error"

  @integration
  Scenario: A history that cannot load says so and offers to retry
    Given the history of a scenario cannot be read
    When History is chosen
    Then the popover says the history could not be loaded
    And it offers to try again
