Feature: Test case versions
  As a person who edits agent test cases over months
  I want every save to keep the version before it
  So that I can see what changed, when, and who changed it

  Background: how a version is made.
    A test case carries a version number. The number starts at 1 when the case
    is created and goes up by one on every save. Each version keeps a copy of
    the case as it was saved, the person or the caller that saved it, the time
    of the save, and the list of fields that changed.

    Saves are explicit. The editor saves when Save or Save and Run is chosen,
    never while typing, so a version is one deliberate edit.

    Every path that writes a case writes a version: the editor, the public API
    and the command line.

  # --- Numbering ---

  @integration
  Scenario: A new test case starts at version 1
    When a test case is created
    Then the case reads as version 1
    And its history holds one entry named Created

  @integration
  Scenario: Each save raises the version by one
    Given a test case at version 1
    When its situation is edited and saved
    And its criteria are edited and saved
    Then the case reads as version 3
    And its history lists version 3, version 2 and version 1, newest first

  @integration
  Scenario: A save that changes nothing still records a version
    Given a test case at version 2
    When it is saved with no field changed
    Then the case reads as version 3
    And the history entry lists no changed field

  # --- What the history shows ---

  @integration
  Scenario: A history entry names the number, the author, the date and the changed fields
    Given a test case edited by "Lena Fischer" who changed the name and the criteria
    When the history is read
    Then the newest entry reads as version 2
    And it names "Lena Fischer"
    And it shows the date of the save
    And it lists the name and the criteria as the fields that changed

  @unit
  Scenario: The changed field list holds only the fields whose value differs
    Given a stored case and an edit that changes the situation only
    When the change list is worked out
    Then it holds the situation and nothing else

  @integration
  Scenario: A save from the command line is recorded with the command line as its author
    Given a test case at version 1
    When it is updated from the command line
    Then the case reads as version 2
    And the history entry names the command line as the author

  @integration
  Scenario: A save over the public API is recorded with the API as its author
    Given a test case at version 1
    When it is updated over the public API with a project key
    Then the case reads as version 2
    And the history entry names the API as the author
    And the entry names no person

  # --- Concurrent saves ---

  @integration
  Scenario: Two saves at the same time produce two different versions
    Given a test case at version 4
    When two saves are started at the same moment
    Then the versions recorded are 5 and 6
    And no version number is used twice

  @integration
  Scenario: Saving over a version somebody else already replaced is refused with scenario_stale_version
    Given a test case open in the editor at version 4
    And somebody else saved the case, so it is now at version 5
    When the first editor saves against version 4
    Then the save is refused with "scenario_stale_version"
    And the stored case is unchanged
    And the editor says the case changed and offers to reload it
    And the offer says the reload discards the edits in the form

  # --- Cases that existed before versions ---

  @integration
  Scenario: A test case created before versions existed shows a made-up first entry
    Given a test case stored before version history existed
    When its history is opened
    Then one entry is shown, named Created and numbered version 1
    And it carries the date the case was created
    And it lists no changed field

  @integration
  Scenario: The first save of a pre-existing case starts real history
    Given a test case stored before version history existed
    When it is edited and saved
    Then the case reads as version 2
    And the history holds the new entry above the made-up Created entry

  # --- Permissions and tenancy ---

  @integration
  Scenario: A viewer can read version history but cannot save
    Given a person with read-only access to the project
    When they open the history of a test case
    Then they see every version
    But saving the case is refused with "insufficient_permissions"

  @integration
  Scenario: Version history of a case in another project is not readable
    Given a test case that belongs to another project
    When its history is requested
    Then the request is refused with "not_found"
