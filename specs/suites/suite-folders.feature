Feature: A test suite is a folder of test cases
  As a person who owns a growing set of agent test cases
  I want to group my cases into named test suites
  So that I can find them, run them together, and archive them together

  Background: what a folder is.
    A folder and a run plan are the same kind of record. A folder carries the
    name a person reads in the rail, the cases that belong to it, and the run
    plan that runs those cases. A case belongs to at most one folder. A case
    that belongs to no folder is unfiled and stays visible in the case list.

    Folders are a v2 surface. The v1 run plan list never shows them. See
    specs/suites/folder-run-plan-reuse.feature for the run path and the v1
    guard, and specs/suites/folder-membership-invariant.feature for the
    membership rule.

  # --- Creating ---

  @integration
  Scenario: A new folder is created empty and appears in the rail
    Given a project with no folders
    When a folder named "Refunds" is created
    Then "Refunds" is listed in the test suites rail
    And it holds no test cases
    And it is not rejected for holding no cases and no targets

  @integration
  Scenario: A folder created with a name another suite already uses keeps both names readable
    Given a run plan named "Refunds" already exists
    When a folder named "Refunds" is created
    Then the folder is created
    And it reads as "Refunds" in the rail
    And its address differs from the address of the existing run plan

  @unit
  Scenario: A folder created with a blank name is rejected with validation_error
    When a folder is created with a name of only spaces
    Then the request is rejected with "validation_error"
    And no folder is stored

  # --- Renaming ---

  @integration
  Scenario: Renaming a folder keeps its cases and its run history
    Given a folder "Refunds" holding three test cases and one finished run
    When the folder is renamed to "Refunds and credits"
    Then the rail reads "Refunds and credits"
    And the same three test cases are still in it
    And the finished run is still listed under it

  @integration
  Scenario: Renaming a folder in another project is refused with suite_not_found
    Given a folder that belongs to another project
    When a rename of that folder is requested
    Then the request is refused with "suite_not_found"
    And the folder keeps its name

  # --- Archiving ---

  @integration
  Scenario: Archiving a folder archives the cases in it
    Given a folder "Refunds" holding two active test cases
    When the folder is archived
    Then the folder is gone from the test suites rail
    And both test cases are gone from the case list
    And neither test case is listed as unfiled

  @integration
  Scenario: Archiving a folder archives its run plan too
    Given a folder "Refunds" with a run plan that has run before
    When the folder is archived
    Then the run plan is gone from the Test Runs list
    And the runs it produced are still readable in the results view

  @integration
  Scenario: The archive dialog names the folder and says what happens to its cases
    Given a folder "Refunds" holding two test cases
    When Archive suite is chosen from the folder menu
    Then the dialog names "Refunds"
    And the dialog says the test cases in it are archived as well
    And leaving the dialog without confirming archives nothing

  @integration
  Scenario: Archiving a folder that is already archived changes nothing
    Given an archived folder "Refunds"
    When the folder is archived again
    Then the request succeeds
    And the time it was first archived is unchanged

  # --- Case membership ---

  @unit
  Scenario: A folder reads back with the cases filed in it
    Given a folder holding two active cases and one archived case
    When the folder is read for its detail view
    Then the folder row comes back with the name of each active case
    And the archived case is left out

  @unit
  Scenario: A scenario belongs to at most one folder
    Given a test case in the folder "Refunds"
    When the case is moved to the folder "Checkout"
    Then the case is in "Checkout" only
    And "Refunds" no longer holds it

  @integration
  Scenario: A case cannot be filed into a run plan that is not a folder
    Given a custom run plan "Nightly"
    When a test case is moved into "Nightly"
    Then the request is refused with "scenario_folder_not_found"
    And the case keeps the folder it had

  @integration
  Scenario: A case cannot be filed into an archived folder
    Given an archived folder "Refunds"
    When a test case is moved into "Refunds"
    Then the request is refused with "scenario_folder_not_found"
    And the case stays unfiled

  # --- Permissions ---

  @integration
  Scenario: A viewer can read folders but cannot create or archive one
    Given a person with read-only access to the project
    When they open the test suites rail
    Then they see every folder in the project
    But creating a folder is refused with "insufficient_permissions"
    And archiving a folder is refused with "insufficient_permissions"

  # --- What the folder editor may save ---

  @unit
  Scenario: The suite editor refuses execution settings on a folder suite
    Given a folder suite in the project
    When the suite editor saves a name and labels
    Then the folder shows the saved values on the next read
    And the folder keeps its address the person opened it under
    When the suite editor saves targets, a repeat count or a model override
    Then the change is refused with "validation_error"
    And the refusal names every execution field the request carried

    A folder holds what it collects, never how a run of it is executed. The
    targets, the repeat count and the models travel with each run and are
    written onto the run plan that run resolves. See
    specs/suites/folder-run-plan-reuse.feature.

  @unit
  Scenario: The suite editor refuses to broaden a folder into a code-owned suite
    Given a folder suite in the project
    When the suite editor tries to change what the folder collects to a plain rule
    Then the change is refused with "suite_scope_not_allowed"
    When the suite editor tries to name the cases directly
    Then the change is refused with "validation_error"
