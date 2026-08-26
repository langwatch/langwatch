Feature: One-off runs are a run plan of their own
  As a person who runs a single test case now and then
  I want those runs collected in one place
  So that a quick run is not lost and does not pollute the suite run plans

  Background: what already works.
    Running one test case from the platform puts the run in an internal run set
    that belongs to the project. That set already exists, it already reads with
    a friendly name instead of its raw address, and each of its batches already
    carries the name of the test case that ran.

    This file pins that behaviour so the v2 rename cannot break it. The rules
    that decide whether an address is internal are in
    specs/scenarios/internal-set-namespace.feature and are not repeated here.

    In v2 the set reads as "One-off runs". In v1 it keeps the name it has
    today, so v1 copy does not change.

  # --- What already works ---

  @unit
  Scenario: A single test case run goes to the project internal run set
    Given a test case and a target
    When the case is run on its own
    Then the run is filed in the internal run set of the project
    And no run plan record is created for it

  @unit
  Scenario: A one-off batch carries the name of the test case that ran
    Given a one-off run of the test case "Angry refund request"
    When the batch is read back
    Then the batch holds exactly one entry
    And the entry is named "Angry refund request"

  @integration
  Scenario: The internal run set reads with a friendly name, never its raw address
    Given the internal run set of a project
    When it is listed
    Then a readable name is shown
    And the raw address is not shown

  @integration
  Scenario: The internal run set is pinned in the run set list
    Given a project with the internal run set and two external sets
    When the run sets are listed
    Then the internal run set holds a fixed place in the list

  # --- What v2 adds ---

  @integration
  Scenario: The v2 Test Runs list names the internal set "One-off runs"
    Given a project with one test suite and some one-off runs
    When the v2 Test Runs list is opened
    Then a row named "One-off runs" is listed
    And it carries a badge that marks it as the place single runs land

  @integration
  Scenario: One-off runs is listed last, after every test suite and custom run plan
    Given a project with two test suites and one custom run plan
    When the v2 Test Runs list is opened
    Then "One-off runs" is the last row

  @integration
  Scenario: One-off runs has no Edit and no Run of its own
    Given the v2 Test Runs list is open
    When the row menu of "One-off runs" is opened
    Then no Edit action is offered
    And no Run action is offered
    And Open last run is offered

  @integration
  Scenario: Each run under One-off runs is named for the test case that ran
    Given one-off runs of the cases "Angry refund request" and "Edge: empty cart"
    When "One-off runs" is opened
    Then the runs sidebar names the two runs after those cases
    And choosing one shows its results

  @integration
  Scenario: The v1 pages keep the name they show today
    Given the v2 interface is switched off
    When the internal run set is listed on the v1 simulations page
    Then it reads with the name v1 shows today
    And nothing on the v1 page changes
