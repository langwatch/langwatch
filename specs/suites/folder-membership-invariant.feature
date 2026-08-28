Feature: Folder membership never disagrees with itself
  As an engineer who owns the folder data model
  I want one answer to "which cases are in this folder"
  So that the case list, the rail counts and the run path can never disagree

  Background: the rule.
    The folder recorded on a test case is the source of truth. The list of
    cases held on the folder is a copy kept for the run path and the history
    queries. Every write that can change membership recomputes that copy in the
    same transaction. Nothing adds or removes a single entry by hand.

    The rule holds for active cases. Archiving a folder is the one deliberate
    exception: it keeps the membership as it stood, so the folder can be read
    back later as it was.

  # --- Every write keeps the two sides in step ---

  @integration
  Scenario: Creating a case inside a folder puts it on both sides at once
    Given an empty folder "Refunds"
    When a test case is created inside "Refunds"
    Then the case names "Refunds" as its folder
    And "Refunds" holds exactly that case

  @integration
  Scenario: Moving a case between folders updates both folders
    Given folders "Refunds" and "Checkout", with one case in "Refunds"
    When the case is moved to "Checkout"
    Then the case names "Checkout" as its folder
    And "Checkout" holds the case
    And "Refunds" holds no case

  @integration
  Scenario: Taking a case out of its folder files it into Default
    Given a case in the folder "Refunds"
    When the case is taken out of "Refunds"
    Then the case names the Default suite as its folder
    And "Refunds" holds no case
    And the Default suite holds the case

  @integration
  Scenario: Archiving one case drops it from its folder
    Given a folder "Refunds" holding two cases
    When one of the cases is archived
    Then "Refunds" holds only the remaining case

  @integration
  Scenario: Archiving many cases at once drops all of them from their folders
    Given a folder "Refunds" holding four cases
    When three of them are archived in one action
    Then "Refunds" holds only the remaining case
    And the count is right after a single recompute, not after three

  @integration
  Scenario: Restoring an archived case puts it back in its folder
    Given an archived case that named "Refunds" as its folder
    And the folder "Refunds" is active
    When the case is restored
    Then "Refunds" holds the case again

  # --- Transactional ---

  @integration
  Scenario: A move that fails leaves both sides untouched
    Given a case in the folder "Refunds"
    When a move is attempted and the write fails part way
    Then the case still names "Refunds" as its folder
    And "Refunds" still holds the case

  @unit
  Scenario: Recomputing membership counts only active cases
    Given a folder whose cases include archived ones
    When membership is recomputed
    Then only the active cases are held on the folder

  # --- The archived snapshot ---

  @integration
  Scenario: An archived folder keeps the membership it had
    Given a folder "Refunds" holding three active cases
    When the folder is archived
    Then the archived folder still names those three cases
    And each of those cases is archived as well

  # --- The invariant walk ---

  @integration
  Scenario: The two sides agree after a full create, move, archive and batch-archive walk
    Given two folders and five test cases
    When the cases are created, moved, archived and batch-archived in turn
    Then after each step every active case names at most one folder
    And every folder holds exactly the active cases that name it

  # --- Two writers at once ---

  @integration
  Scenario: Two cases filed into one folder at the same time both land in it
    Given a folder "Refunds" and two test cases in the Default suite
    When both cases are filed into "Refunds" at the same time
    Then "Refunds" holds both of them
    And neither case is left naming a folder that does not hold it
