Feature: Experiment pages stay responsive on large runs and many experiments

  Runs with long outputs, runs with many rows and projects with many saved
  experiments stay light in the browser. The results page draws only the rows
  in view and a short preview of each cell, and the experiments list carries
  only what its table draws.

  @integration
  Scenario: The results page of a large run draws only the rows in view
    Given a finished run of 2,000 dataset rows scored by three evaluators
    When its results page opens inside the app shell
    Then the results table draws fewer than 100 rows
    And scrolling the table draws the rows that come into view

  @integration
  Scenario: A collapsed results cell draws only the start of a long output
    Given a target output and a dataset value of several pages each
    When the results table renders them collapsed
    Then each cell draws at most a short preview of its value
    And expanding the cell draws the first 10,000 characters, with a "(truncated)" indicator when there are more
    And copying the cell copies the full value

  @integration
  Scenario: A results cell draws its actions only once it is pointed at
    Given a target output with a cost, a latency and a trace
    When the results table renders it and nothing has pointed at it
    Then the cell draws no cost, latency, trace or copy action
    And pointing at the cell draws them
    And moving keyboard focus to the cell draws them too, and Enter expands it

  @unit
  Scenario: A collapsed preview stops at the line or character budget of its row height
    Given a value with many short lines or one long line
    When its collapsed preview is taken for a row height
    Then the preview stops at that row height's line budget or character budget, whichever comes first

  @unit
  Scenario: The experiments list carries only what its table draws
    Given an experiment whose saved workbench holds a large inline dataset
    And a workflow experiment whose saved workflow version holds a large DSL
    When the evaluations list is read
    Then each row carries its name, type, task, run summary and dates
    And no row carries the workbench's saved state or the workflow behind it

  @unit
  Scenario: The experiments list reads workflows only for the experiments on its page
    Given a project with 30 workflow experiments
    When the first page of 25 is listed
    Then the workflows of only those 25 experiments are read
