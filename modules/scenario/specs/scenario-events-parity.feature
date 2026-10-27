Feature: Scenario events refuse past the plan limit and link to the interface the project reads
  The scenario library posts every run event to /api/scenario-events and prints
  the address it is answered with. Main refused those writes once the
  organization spent its monthly allowance, and addressed Agent Testing for a
  project on the release flag; this module keeps both.

  @unit
  Scenario: A scenario event past the monthly usage limit is refused
    Given an organization that spent its monthly allowance
    When the scenario library posts a scenario event for one of its projects
    Then the event is refused with ERR_PLAN_LIMIT and status 402
    And nothing is dispatched for the run

  @unit
  Scenario: Archiving scenario runs past the monthly usage limit is refused
    Given an organization that spent its monthly allowance
    When a caller archives a scenario run of one of its projects
    Then the archive is refused with status 402
    And no run is deleted

  @unit
  Scenario: A reported event links to its run set in the interface the project reads
    Given a project on the Agent Testing release flag
    When the scenario library posts a scenario event for a code-run set
    Then the answered address is the set's plan under /agent-testing/results

  @unit
  Scenario: A browser-tab handoff links to its batch in the interface the project reads
    Given a project on the Agent Testing release flag
    When the scenario library offers a batch to an open tab
    Then the answered address is the batch under /agent-testing/results

  @unit
  Scenario: A simulation run links to its run drawer in the interface the project reads
    Given a project on the Agent Testing release flag
    When the project's simulation runs are listed
    Then every run links to its detail drawer under /agent-testing/results
    And the flag is read once for the page

  @unit
  Scenario: A flag read that fails links to the Simulations pages
    Given the release flag cannot be read
    When the scenario library posts a scenario event
    Then the answered address is under /simulations
