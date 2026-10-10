Feature: The experiments list shows each experiment's result and opens it inline
  As a person looking after experiments
  I want each row to say how the latest run did and what changed
  So that I can see what moved without opening every experiment

  # Today's endpoints only: the list page; an experiment's runs and one run's items only once its row is opened.
  # The chosen primary metric lives in this browser, not on the server.

  @integration
  Scenario: A closed row shows the list's own result and asks for nothing more
    Given a page of 25 experiments, each with a pass rate in the list response
    When I open the experiments list
    Then every row shows its pass rate and the evaluator's name
    And no experiment's runs have been requested

  @integration
  Scenario: A row has one headline, open or closed
    Given an experiment whose two runs scored a pass rate of 70% and 80%
    When I click the row
    Then only that experiment's runs are requested
    And the row still shows "80.0%" and the same evaluator name
    And the panel shows "10.0 pt better than run #1" and the run history with costs
    And the list has no cost column

  @integration
  Scenario: Closing a row never leaves a stale headline
    Given I opened a row and closed it again
    When the list refetches and now reports 95%
    Then the closed row shows "95.0%"

  @integration
  Scenario: An open panel refetches when the list has moved past its runs
    Given an open row whose cached runs number 2
    When the list reports 3 runs
    Then the panel's runs are requested again, once

  @unit
  Scenario: A change reads as a sentence about an earlier run
    Given a pass rate that moved 1.3 points, a score that rose 0.12, and a metric that did not move
    Then they read "1.3 pt better than run #2", "0.120 higher than run #2" and "no change from run #2"

  @integration
  Scenario: A failed runs request is an error, not an empty result
    Given the runs of an experiment fail to load
    When I open its row
    Then the panel says it could not load the runs and offers to try again
    And it does not say there are no scored runs

  @integration
  Scenario: Clicking the name or the menu does not open the row
    When I click an experiment's name, its dataset or its actions menu
    Then the row stays closed and no runs are requested

  @integration
  Scenario: The experiment's name leads to its page in the same tab
    Given an SDK experiment and a workbench experiment
    When I open the experiments list
    Then the SDK experiment's name links to its results page
    And the workbench experiment's name links to its workbench

  @integration
  Scenario: A row shows its dataset only when one is recorded
    Given an experiment that records the dataset "tickets-v2" and one that records none
    When I open the experiments list
    Then the first row names "tickets-v2"
    And the second row has no dataset line

  @integration
  Scenario: Clicking a row opens it inline without leaving the list
    Given an experiment whose latest run has two targets
    When I click the row
    Then the row opens with every target of the latest run and the run history
    And the page does not navigate

  @integration
  Scenario: The primary metric defaults by rule and can be changed per experiment
    Given an experiment whose runs report a pass/fail evaluator and a score evaluator
    When I open the row
    Then it leads with the evaluator the list leads with and says why that is the default
    When I pick the score evaluator
    Then the row, open or closed, leads with its average score
    And the pick is saved in this browser only

  @integration
  Scenario: Bad browser storage never breaks the page
    Given the saved picks are null, a number, an array, broken JSON or hold non-text values
    Then the page loads with no picks
    When storage refuses a write
    Then the pick still holds for the session

  @unit
  Scenario: A tie with the leader is never crowned
    Given two targets whose pass rates differ by less than their 95% interval
    When the targets are ranked
    Then both share rank 1

  @unit
  Scenario: Equal rates at 0% or 100% are a tie
    Given two targets that both pass every item
    Then they are tied and the gap reads "tied"

  @unit
  Scenario: Too few items are never crowned
    Given pass rates of 5/5 against 0/5, and 1/1 against 0/1
    Then the targets are tied and the panel says there are too few items to call a winner

  @unit
  Scenario: A real score is not mistaken for a measurement
    Given evaluators named "token_overlap" and "cost_efficiency"
    Then either may lead by default
    But names such as "latency", "Latency (ms)", "response_time", "duration", "tokens" and "cost" are skipped

  @integration
  Scenario: Categories-only evaluators say so
    Given runs whose evaluators report categories and no number
    When I open the row
    Then the panel says "No numeric results" and not "No scored runs yet."

  @unit
  Scenario: A score is never ranked
    Given a score evaluator with no stored better direction
    When the targets are ranked
    Then no target is ranked or named best

  @integration
  Scenario: Every row action keeps working
    Given I may edit, replicate and delete experiments
    When I open a row's menu
    Then it offers Edit, View results, Replicate and Delete
    And without the replicate and delete permissions those two are not offered
    And Delete asks for confirmation first
    And clicking the menu's padding does not open the row

  @integration
  Scenario: The chevron button is the keyboard path
    When I focus the labelled chevron and press Enter
    Then the row opens, and the row itself is not a tab stop

  @integration
  Scenario: An empty project and a failed load say so
    Given a project with no experiments
    Then the empty state offers to create one
    When the list fails to load
    Then the page says "Couldn't load experiments"
