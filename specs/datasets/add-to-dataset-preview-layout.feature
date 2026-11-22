Feature: Dataset previews stay readable and reachable at any width
  As a user checking dataset rows outside the dataset editor
  I want every column of a preview readable and reachable
  So that I can check and edit the whole row before it is used

  # The same preview table renders in the Add to Dataset drawer, the
  # workflow's "Run until here" row picker and a prompt's demonstrations.

  @integration
  Scenario: The Add to Dataset preview scrolls sideways inside its card
    Given the Add to Dataset drawer with more columns than the preview card can show
    Then the preview card stays inside the drawer
    And the preview scrolls sideways inside its card
    And scrolling to the end brings the last column fully into view

  @integration
  Scenario: Every dataset preview keeps its columns at a readable width
    Given a dataset preview with more columns than its card can show
    Then no column is narrower than its minimum width
    And the preview scrolls sideways inside its card

  @integration
  Scenario: A column name too long for a preview header is cut short, not overlapped
    Given a dataset preview with a column named "gold_skill_reason_for_the_thread_analysis"
    Then its header shows the name on one line ending in an ellipsis
    And hovering the header shows the full name
