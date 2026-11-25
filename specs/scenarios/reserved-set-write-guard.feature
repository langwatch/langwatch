Feature: A run cannot be written into a reserved set address
  As a person who reads a run plan's results
  I want a one-off run to stay out of a plan's address
  So that a plan's pass rate, cost and trend report only the runs it started

  Background: what a set address is, and which ones are reserved.
    Every scenario run is recorded under a set id. Three kinds exist:

      - an EXTERNAL set: any name the customer's own code chooses. It is not in
        the internal namespace and it stays free.
      - the project's ONE-OFF bucket, `__internal__<projectId>__on-platform-
        scenarios`. This is where a run with no set named goes.
      - a RUN PLAN's address, `__internal__<suiteId>__suite`. The Results tab
        reads every run stored there as one plan's history.

    The last two are the platform's own, so a caller may not name them. A
    one-off run written into a plan's address is counted by every read of that
    plan, which silently moves its pass rate, its cost and its trend. This is
    not a tenancy rule: tenancy is enforced separately, and a caller entitled to
    read a plan is still refused the right to write into it.

  @unit
  Scenario: A run naming a run plan's set address is refused
    Given a run plan of this project
    When a scenario run is started naming that plan's set address
    Then the run is refused with scenario_reserved_set_id
    And no run is recorded under that plan

  @unit
  Scenario: A run naming another project's one-off set is refused
    Given another project
    When a scenario run is started naming that project's one-off set
    Then the run is refused with scenario_reserved_set_id

  @unit
  Scenario: A run naming this project's own one-off set is allowed
    When a scenario run is started naming this project's one-off set
    Then the run is scheduled

  @unit
  Scenario: A run naming an external set is allowed
    When a scenario run is started naming the set "nightly-regression"
    Then the run is scheduled
    And the run is recorded under "nightly-regression"

  @unit
  Scenario: A run naming no set goes to this project's one-off bucket
    When a scenario run is started with no set named
    Then the run is scheduled
    And the run is recorded under this project's one-off set
