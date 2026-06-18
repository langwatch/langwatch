Feature: Fixed result fields on the evaluator End node
  As a user building a custom evaluator workflow
  I want the End node to present exactly the four evaluator result fields
  So that it is obvious what an evaluator can return

  # Customer context: users renamed/retyped free-form end fields by hand
  # ("rename this to score, make it a number") without knowing the
  # evaluator contract. When the workflow behaves as an evaluator, the
  # End node's results are a fixed vocabulary: passed (bool), score
  # (float), label (str), details (str). Every result is optional, so any
  # combination can be connected; unconnected results stay omitted. The
  # drawer explains each field rather than offering editable rows.

  Background:
    Given I am logged in
    And I have a custom evaluator workflow open in the optimization studio

  @integration
  Scenario: Evaluator End node lists exactly the four fixed result fields
    When I open the End node drawer
    Then the results are exactly "passed", "score", "label" and "details"
    And each field shows its fixed type (bool, float, str, str)

  @integration
  Scenario: Evaluator End node lists details first
    When I open the End node drawer
    Then the result fields appear in the order "details", "passed", "score", "label"

  @integration
  Scenario: Evaluator End node results cannot be added or removed
    When I open the End node drawer
    Then each result field is explained with what it returns
    And there is no affordance to add, remove or rename the fixed fields

  @unit
  Scenario: All evaluator results are optional
    Then "passed", "score", "label" and "details" are each optional
    So that an evaluator can return any combination of them

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

  @integration
  Scenario: Evaluator workflows normalize the end node even without the node flag
    Given an older evaluator workflow whose End node has hand-made "score" and "reasoning" fields
    And the End node does not carry the evaluator flag
    When I open the End node drawer
    Then the results normalize to the fixed "passed", "score", "label" and "details" vocabulary
    And the evaluator flag is stamped onto the node
