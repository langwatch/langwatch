Feature: The internal run set of a project
  As a person who runs a single test case now and then
  I want that run filed somewhere that belongs to the project
  So that a quick run is not lost and does not pollute the suite run plans

  Background: what already works.
    Running one test case from the platform puts the run in an internal run set
    that belongs to the project. That set already exists, it already reads with
    a friendly name instead of its raw address on the v1 simulations page, and
    each of its batches already carries the name of the test case that ran.

    The rules that decide whether an address is internal are in
    specs/scenarios/internal-set-namespace.feature and are not repeated here.

    The v2 Results tab lists run plans only. It draws no bucket row for this
    set: a bucket row states one scenario name in its Scope column while its
    Targets column merges the targets of several separate runs, which is not
    true of any one of them. A single scenario run gets a run plan of its own
    instead, named after the scenario and the agent it ran against.

  # --- What already works ---

  @unit
  Scenario: A single scenario run goes to the project internal run set
    Given a test case and a target
    When the case is run on its own
    Then the run is filed in the internal run set of the project
    And no run plan record is created for it

  @unit
  Scenario: A one-off batch carries the name of the scenario that ran
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

  # --- v1 ---

  @integration
  Scenario: The v1 pages keep the name they show today
    Given the v2 interface is switched off
    When the internal run set is listed on the v1 simulations page
    Then it reads with the name v1 shows today
    And nothing on the v1 page changes
