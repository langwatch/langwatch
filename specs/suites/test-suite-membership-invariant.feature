Feature: Test suite membership never disagrees with itself
  As an engineer who owns the test suite data model
  I want one answer to "which scenarios are in this test suite"
  So that the scenario list, the rail counts and the run path can never disagree

  Background: the rule.
    The test suite recorded on a scenario is the source of truth. The list of
    scenarios held on the test suite is a copy kept for the run path and the history
    queries. Every write that can change membership recomputes that copy in the
    same transaction. Nothing adds or removes a single entry by hand.

    The rule holds for active scenarios. Archiving a test suite is the one deliberate
    exception: it keeps the membership as it stood, so the test suite can be read
    back later as it was.

  # --- Every write keeps the two sides in step ---

  @integration
  Scenario: Creating a scenario inside a test suite puts it on both sides at once
    Given an empty test suite "Refunds"
    When a scenario is created inside "Refunds"
    Then the scenario names "Refunds" as its test suite
    And "Refunds" holds exactly that scenario

  @integration
  Scenario: Moving a scenario between test suites updates both test suites
    Given test suites "Refunds" and "Checkout", with one scenario in "Refunds"
    When the scenario is moved to "Checkout"
    Then the scenario names "Checkout" as its test suite
    And "Checkout" holds the scenario
    And "Refunds" holds no scenario

  @integration
  Scenario: Taking a scenario out of its test suite files it into Default
    Given a scenario in the test suite "Refunds"
    When the scenario is taken out of "Refunds"
    Then the scenario names the Default suite as its test suite
    And "Refunds" holds no scenario
    And the Default suite holds the scenario

  @integration
  Scenario: Archiving one scenario drops it from its test suite
    Given a test suite "Refunds" holding two scenarios
    When one of the scenarios is archived
    Then "Refunds" holds only the remaining scenario

  @integration
  Scenario: Archiving many scenarios at once drops all of them from their test suites
    Given a test suite "Refunds" holding four scenarios
    When three of them are archived in one action
    Then "Refunds" holds only the remaining scenario
    And the count is right after a single recompute, not after three

  @integration
  Scenario: Restoring an archived scenario puts it back in its test suite
    Given an archived scenario that named "Refunds" as its test suite
    And the test suite "Refunds" is active
    When the scenario is restored
    Then "Refunds" holds the scenario again

  # --- Transactional ---

  @integration
  Scenario: A move that fails leaves both sides untouched
    Given a scenario in the test suite "Refunds"
    When a move is attempted and the write fails part way
    Then the scenario still names "Refunds" as its test suite
    And "Refunds" still holds the scenario

  @unit
  Scenario: Recomputing membership counts only active scenarios
    Given a test suite whose scenarios include archived ones
    When membership is recomputed
    Then only the active scenarios are held on the test suite

  # --- The archived snapshot ---

  @integration
  Scenario: An archived test suite keeps the membership it had
    Given a test suite "Refunds" holding three active scenarios
    When the test suite is archived
    Then the archived test suite still names those three scenarios
    And each of those scenarios is archived as well

  # --- The invariant walk ---

  @integration
  Scenario: The two sides agree after a full create, move, archive and batch-archive walk
    Given two test suites and five scenarios
    When the scenarios are created, moved, archived and batch-archived in turn
    Then after each step every active scenario names at most one test suite
    And every test suite holds exactly the active scenarios that name it

  # --- Two writers at once ---

  @integration
  Scenario: Two scenarios filed into one test suite at the same time both land in it
    Given a test suite "Refunds" and two scenarios in the Default suite
    When both scenarios are filed into "Refunds" at the same time
    Then "Refunds" holds both of them
    And neither scenario is left naming a test suite that does not hold it
