Feature: Fixed result fields on the evaluator End node
  As a user building a custom evaluator workflow
  I want the End node to present exactly the four evaluator result fields
  So that it is obvious what an evaluator can return

  # Customer context: users renamed/retyped free-form end fields by hand
  # ("rename this to score, make it a number") without knowing the
  # evaluator contract. When the workflow behaves as an evaluator, the
  # End node's results are a fixed vocabulary: passed (bool),
  # score (float), details (str), label (str). Unused fields simply stay
  # unconnected.

  Background:
    Given I am logged in
    And I have a custom evaluator workflow open in the optimization studio

  @integration
  Scenario: Evaluator End node lists exactly the four fixed result fields
    When I open the End node drawer
    Then the results are exactly "passed", "score", "details" and "label"
    And each field shows its fixed type (bool, float, str, str)

  @integration
  Scenario: Evaluator End node results cannot be added or removed
    When I open the End node drawer
    Then there is no affordance to add another result field
    And there is no affordance to remove or rename the fixed fields

  @integration
  Scenario: Unconnected fixed fields are allowed
    Given only "score" is connected on the End node
    When the workflow publishes as an evaluator
    Then the evaluator returns score without requiring the other fields

  @integration
  Scenario: Non-evaluator workflows keep free-form end results
    Given a regular (non-evaluator) workflow
    When I open the End node drawer
    Then I can add and remove result fields freely
