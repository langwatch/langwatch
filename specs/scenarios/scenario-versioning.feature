Feature: Scenario versions
  As a person who edits agent scenarios over months
  I want every save to keep the version before it
  So that I can see what changed, when, and who changed it

  Background: how a version is made.
    A scenario carries a version number. The number starts at 1 when the scenario
    is created and goes up by one on every save. Each version keeps a copy of
    the scenario as it was saved, the person or the caller that saved it, the time
    of the save, and the list of fields that changed.

    Saves are explicit. The editor saves when Save or Save and Run is chosen,
    never while typing, so a version is one deliberate edit.

    Every path that writes a scenario writes a version: the editor, the public API
    and the command line.

  # --- Numbering ---

  @integration
  Scenario: A new scenario starts at version 1
    When a scenario is created
    Then the scenario reads as version 1
    And its history holds one entry named Created

  @integration
  Scenario: Each save raises the version by one
    Given a scenario at version 1
    When its situation is edited and saved
    And its criteria are edited and saved
    Then the scenario reads as version 3
    And its history lists version 3, version 2 and version 1, newest first

  @integration
  Scenario: A save that changes nothing still records a version
    Given a scenario at version 2
    When it is saved with no field changed
    Then the scenario reads as version 3
    And the history entry lists no changed field

  # --- What the history shows ---

  @integration
  Scenario: A history entry names the number, the author, the date and the changed fields
    Given a scenario edited by "Lena Fischer" who changed the name and the criteria
    When the history is read
    Then the newest entry reads as version 2
    And it names "Lena Fischer"
    And it shows the date of the save
    And it lists the name and the criteria as the fields that changed

  @unit
  Scenario: The changed field list holds only the fields whose value differs
    Given a stored scenario and an edit that changes the situation only
    When the change list is worked out
    Then it holds the situation and nothing else

  @integration
  Scenario: A save from the command line is recorded with the command line as its author
    Given a scenario at version 1
    When it is updated from the command line
    Then the scenario reads as version 2
    And the history entry names the command line as the author

  @integration
  Scenario: A save over the public API is recorded with the API as its author
    Given a scenario at version 1
    When it is updated over the public API with a project key
    Then the scenario reads as version 2
    And the history entry names the API as the author
    And the entry names no person

  # --- Concurrent saves ---

  @integration
  Scenario: Two saves at the same time produce two different versions
    Given a scenario at version 4
    When two saves are started at the same moment
    Then the versions recorded are 5 and 6
    And no version number is used twice

  @integration
  Scenario: Saving over a version somebody else already replaced is refused with scenario_stale_version
    Given a scenario open in the editor at version 4
    And somebody else saved the scenario, so it is now at version 5
    When the first editor saves against version 4
    Then the save is refused with "scenario_stale_version"
    And the stored scenario is unchanged
    And the editor says the scenario changed and offers to reload it
    And the offer says the reload discards the edits in the form

  # --- Scenarios that existed before versions ---

  @integration
  Scenario: A scenario created before versions existed shows a made-up first entry
    Given a scenario stored before version history existed
    When its history is opened
    Then one entry is shown, named Created and numbered version 1
    And it carries the date the scenario was created
    And it lists no changed field

  @integration
  Scenario: The first save of a pre-existing scenario starts real history
    Given a scenario stored before version history existed
    When it is edited and saved
    Then the scenario reads as version 2
    And the history holds the new entry above the made-up Created entry

  # --- Permissions and tenancy ---

  @integration
  Scenario: A viewer can read version history but cannot save
    Given a person with read-only access to the project
    When they open the history of a scenario
    Then they see every version
    But saving the scenario is refused with "insufficient_permissions"

  @integration
  Scenario: Version history of a scenario in another project is not readable
    Given a scenario that belongs to another project
    When its history is requested
    Then the request is refused with "not_found"
