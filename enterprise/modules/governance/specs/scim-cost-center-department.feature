Feature: Governance lands SCIM's cost-center fact as a department

  Governance peer-subscribes to lw.scim.cost_center_changed and resolves or
  creates the named department, then assigns the member. Delivery is
  at-least-once, so handling a fact twice must change nothing.

  # eventing/scim-cost-center.subscriber.ts,
  # eventing/governance-activity-monitor.pipeline.ts

  @unit
  Scenario: A redelivered cost-center fact lands the member in one department
    Given a cost-center fact naming "Engineering" for a member
    When governance handles that fact twice
    Then one department "Engineering" exists
    And the member is assigned to it

  @unit
  Scenario: A cleared cost-center fact unassigns without resolving a department
    When governance handles a cost-center fact naming no cost center
    Then no department is resolved
    And the member carries no department
