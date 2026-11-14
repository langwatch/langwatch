Feature: Dataset previews keep every column readable
  As a user picking or checking dataset rows outside the dataset editor
  I want each preview column wide enough to read
  So that a dataset with many columns is not squeezed to one letter per line

  # The same preview table renders in three places: the Add to Dataset drawer,
  # the workflow's "Run until here" row picker and a prompt's demonstrations.

  @integration
  Scenario: A dataset preview with more columns than fit scrolls sideways instead of squeezing them
    Given a dataset preview showing eight columns in a narrow card
    Then no column is narrower than its minimum width
    And the preview scrolls sideways to reach the last column

  @integration
  Scenario: A column name too long for a preview header is cut short, not overlapped
    Given a dataset preview with a column named "gold_skill_reason_for_the_thread_analysis"
    Then its header shows the name on one line ending in an ellipsis
    And hovering the header shows the full name
