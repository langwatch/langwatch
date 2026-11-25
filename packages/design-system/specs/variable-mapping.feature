Feature: Variable mapping section
  As someone wiring a target's inputs to its data
  I want each input mapped to a source field picked from a list
  So that every module maps inputs the same way

  @integration
  Scenario: A variable is mapped to a source field picked from the list
    Given a variables section with an input "question" and a dataset source offering "question"
    When the user picks the dataset's "question" field for that input
    Then the section reports a source mapping for "question" with the path ["question"]
