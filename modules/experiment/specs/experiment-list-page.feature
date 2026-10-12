Feature: The experiments list shows each experiment's result and opens it inline
  As a person looking after experiments
  I want each row to say how the latest run did and what changed
  So that I can see what moved without opening every experiment

  # Today's endpoints only: the list page; one runs call per visible row (a few at a time, cached five
  # minutes) to complete the row; one run's items once its row is opened.
  # The chosen primary metric lives in this browser, not on the server.

  @integration
  Scenario: A closed row draws from the list first and is completed by its runs
    Given a page of 25 experiments, each with a pass rate in the list response
    When I open the experiments list
    Then every row shows its pass rate and the evaluator's name at once
    And each row's runs are then requested once
    And a row with several runs shows its cost, the change against the run before and "Primary metric"

  @integration
  Scenario: A row has one headline, open or closed
    Given an experiment whose two runs scored a pass rate of 70% and 80%
    When I click the row
    Then the row still shows "80.0%" and the same evaluator name
    And the row says "10.0 pt better" than run #1
    And the panel shows the run history with costs

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
  Scenario: A change reads as a short chip about an earlier run
    Given a pass rate that moved 1.3 points, a score that rose 0.12, and a metric that did not move
    Then the chips read "1.3 pt better", "up 0.120" and "no change"
    And each names the run it is compared with

  @integration
  Scenario: A failed runs request is an error, not an empty result
    Given the runs of an experiment fail to load
    When I open its row
    Then the panel says it could not load the runs and offers to try again
    And it does not say there are no scored runs

  @integration
  Scenario: Clicking the name or the menu does not open the row
    When I click an experiment's name, its dataset or its actions menu
    Then the row stays closed

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
    Then the row opens with what it was tested on, every target of the latest run and the run history
    And the panel has a Close button
    And the page does not navigate

  @integration
  Scenario: The primary metric defaults by rule and can be changed per experiment
    Given an experiment whose runs report a pass/fail evaluator and a score evaluator
    Then its row leads with the evaluator the list leads with
    When I open the metric menu
    Then it says in one line what picking does, and the reason for the default is in the (i) tip
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
    And they are not offered as an average score unless nothing else exists

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


  @integration
  Scenario: At most four rows' runs are requested at once
    Given a page of 25 experiments whose runs have not answered yet
    When I open the experiments list
    Then only four rows' runs are in flight
    And the next row's runs are requested when one answers

  @integration
  Scenario: A failed runs call leaves the row as the list drew it
    Given the runs of one experiment fail to load
    When I open the experiments list
    Then that row keeps its list result and says no more than it knew
    And the other rows are completed

  @integration
  Scenario: Searching loads every experiment once and filters here
    Given a project with experiments of several kinds
    When I type in the search box
    Then the list is requested once with a page size large enough for every experiment
    And only the experiments whose name, dataset or kind match are shown
    And Reset brings every row back

  @unit
  Scenario: Filters read the experiment's kind and its latest run's state
    Given experiments run by the SDK and the workbench, one of them running
    When I filter by "Ran via" and by "Status"
    Then only experiments of that kind and whose latest run is in that state remain
    And no runs call is needed to decide

  @integration
  Scenario: Rows can be grouped by how they ran
    Given experiments run by the SDK and the workbench
    When I group by "How it ran"
    Then each kind has a heading with its count, and a heading collapses its rows

  @integration
  Scenario: An opened row says what the run was tested on
    Given an opened row whose latest run has 1,000 items with fields
    Then it reads "Tested on", the item count and the field names
    And shows three example inputs, one line each

  @unit
  Scenario: Tested-on examples are spread across the set
    Given a run with ten distinct items, each run by two targets
    Then the items are counted once and three examples come from across the set

  @integration
  Scenario: A target is compared with the top target in words
    Given a run where one target is clearly behind the top one and another is within noise
    Then the first reads "pt behind" and the other has no chip
    And a target with errors reads "N errors" and its first error in quotes

  @unit
  Scenario: A tie is said once above the target table
    Given three targets whose pass rates are inside each other's interval
    Then the table is preceded by "No clear winner: all 3 within noise (gaps inside the 95% interval)."

  @integration
  Scenario: A running row shows how far it is
    Given a workbench experiment whose latest run is running with 1,024 of 1,600 cells done
    Then its status reads Running with "1,024 of 1,600 cells"

  @integration
  Scenario: The table keeps its header while loading
    Given the list is loading
    Then the column headers and placeholder rows are shown

  @integration
  Scenario: A row shows its last run's day in short form
    Given an experiment whose latest run started on 25 September
    Then the row reads "Sep 25"
    And an experiment that never ran reads the day it was last updated

  @integration
  Scenario: A remounted row with an old cached answer keeps its slot while it refetches
    Given ten rows whose cached runs are older than five minutes
    When the rows ask for their runs
    Then at most four calls are in flight, and the next row's starts as each one ends

  @integration
  Scenario: A row gives its slot back when its call fails or the row goes away
    Given four rows with a call in flight and a fifth waiting
    When one call fails, or one row leaves the list
    Then the waiting row's call starts

  @integration
  Scenario: A closed row whose runs fell behind goes back through the slots
    Given a closed row whose cached runs the list has moved past
    When the list reports a newer run
    Then the row is queued for a fresh runs call instead of refetching at once
    And an open row still refetches at once

  @unit
  Scenario: A finished run replaces the partial numbers of a running one
    Given runs cached while the newest was running
    When the list reports that run as finished
    Then the cached runs are out of date and the row says Finished with the list's numbers

  @unit
  Scenario: A running run shows no change chip
    Given a row whose latest run is still running
    Then the row shows no change chip

  @integration
  Scenario: A row waiting for its runs shows a placeholder
    Given a row whose runs call has not started and whose list result has no headline
    Then the result and the cost show placeholders, not "No result yet"

  @unit
  Scenario: An unfinished run left alone reads Stopped
    Given an unfinished latest run not touched for over five minutes
    Then its status reads Stopped, not Finished

  @integration
  Scenario: Closing the panel returns focus to the row's button
    Given an open row
    When I close its panel
    Then focus is back on the row's button, which keeps one name and says whether it is expanded

  @integration
  Scenario: The run history sparkline names what it draws
    Given a row with three scored runs
    Then its sparkline is hidden from assistive technology and "pass rate across 3 scored runs" is read in its place

  @integration
  Scenario: The Status filter narrows the list through the toolbar
    Given experiments that are running, finished, stopped and never run
    When I pick Running and then Stopped in the Status menu
    Then only those experiments are shown, and Reset brings every row back

  @integration
  Scenario: Paging a search happens here and starts over with each new search
    Given a search with 26 matches
    Then the first 25 are shown and the count reads 26
    When I go to page 2 and then search again
    Then the new search starts at page 1
    And resetting the search returns to the server's paging

  @integration
  Scenario: Deleting the last row of a filtered page does not leave a blank table
    Given a search with 26 matches, shown on page 2
    When that page's only row is deleted
    Then the last remaining page is shown

  @integration
  Scenario: A search keeps the page size the person chose
    Given the page size is 10
    When I search
    Then 10 matches are shown per page, and changing the size changes the list's own page size

  @integration
  Scenario: A failed search load keeps the toolbar so Reset works
    Given a search is active
    When loading every experiment fails
    Then the error is shown with the toolbar, and Reset returns to the server's page

  @unit
  Scenario: A gap is judged over the items that were decided
    Given two targets with many rows but few decided items
    Then the interval of their gap is sized by the decided items
