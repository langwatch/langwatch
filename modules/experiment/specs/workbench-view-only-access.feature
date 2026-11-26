Feature: A workbench the reader's role cannot change says so
  A member whose role can view experiments but not change or run them (a Lite
  Member seat, say) still opens the workbench. The page tells them up front
  that it is view only, does not send saves or runs the server would refuse,
  and explains any refusal the server sends anyway.

  @integration
  Scenario: A role that cannot change experiments sees the workbench as view only
    Given I can view experiments but not change them
    When I open an experiment in the workbench
    Then a notice says the experiment is view only and who can give me access
    And the save status reads View only

  @integration
  Scenario: A Lite Member can request access from the view-only notice
    Given I hold a Lite Member seat and the workbench is view only
    When I read the view-only notice
    Then it offers Request access to run and save experiments

  @integration
  Scenario: A view-only workbench does not send my edits to the server
    Given I can view experiments but not change them
    And the workbench is open
    When I edit a cell
    Then no save is sent

  @integration
  Scenario: The Run button says why a role that cannot run evaluations cannot use it
    Given I can view experiments but not run evaluations
    When I look at the Run button
    Then it is disabled
    And its hint and the view-only notice say my role can't run evaluations

  @integration
  Scenario: Running part of a view-only workbench explains instead of calling the server
    Given I can view experiments but not run evaluations
    When I run one cell
    Then no run request is sent
    And a message says my role can't run evaluations

  @integration
  Scenario: A save the server refuses for my role stops autosave and says why
    Given the page offered me saving
    When the server refuses a save because my role does not allow it
    Then the workbench shows the view-only notice
    And no further edit is sent to the server

  @integration
  Scenario: A run the server refuses for my role says why
    Given the page offered me Run
    When the server refuses the run because my role does not allow it
    Then a message shows the refusal in the registry's words
