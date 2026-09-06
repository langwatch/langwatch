Feature: The internal run set of a project
  As a person who starts a scenario run through the API or the command line
  I want that run filed somewhere that belongs to the project
  So that a run started outside a run plan is not lost

  Background: who still writes here.
    A scenario run started without naming a run set is filed in an internal run
    set that belongs to the project. That set already exists, it already reads
    with a friendly name instead of its raw address on the v1 simulations page,
    and each of its batches already carries the name of the scenario that ran.

    The rules that decide whether an address is internal are in
    specs/scenarios/internal-set-namespace.feature and are not repeated here.

    Only callers that name no run set land here: the scenario runner API, the
    command line, the SDK and the v1 pages. The Agent Testing interface never
    does. Every run it starts, a run of one scenario included, goes out under a
    run plan name, so the run lands in that plan's own run set. See
    specs/suites/run-plan-identity-by-name.feature.

    The Results tab therefore draws no bucket row for this set. A bucket row
    states one scenario name in its Scope column while its Targets column
    merges the targets of several separate runs, which is not true of any one
    of them.

  # --- What already works ---

  @unit
  Scenario: A scenario run that names no run set goes to the internal run set
    Given a scenario and a target
    When a run is started without naming a run set
    Then the run is filed in the internal run set of the project
    And no run plan record is created for it

  @unit
  Scenario: A batch of the internal run set carries the name of the scenario that ran
    Given a run of the scenario "Angry refund request" that names no run set
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
