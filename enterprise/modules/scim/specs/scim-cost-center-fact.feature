Feature: SCIM records a member's cost center as a fact

  SCIM no longer asks governance to assign a department while it answers a
  directory push. It records lw.scim.cost_center_changed and governance lands
  the department from its own side, so the assignment lags the push (R7).

  # scim-cost-center.service.ts, scim-cost-center-facts.service.ts,
  # eventing/scim-cost-center.pipeline.ts

  @unit
  Scenario: A pushed cost center is recorded trimmed for governance to assign
    Given a directory provisions a member whose enterprise costCenter is " Engineering "
    When SCIM answers the push
    Then a cost-center fact for that member names "Engineering"

  @unit
  Scenario: A removed cost center is recorded as cleared
    Given a member SCIM provisioned with a cost center
    When the directory removes the enterprise costCenter attribute
    Then a cost-center fact for that member names no cost center

  @unit
  Scenario: A push that names no cost center records nothing
    When the directory provisions a member with no enterprise extension
    Then no cost-center fact is recorded
