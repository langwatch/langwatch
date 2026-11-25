Feature: The dataset content migration scans projects through their owner
  The one-off move of postgres-layout dataset content into object-storage chunks
  walks every project on the install. It reads the project ids from the project
  module a page at a time rather than querying the project table itself.

  @unit
  Scenario: The content migration visits every project across id pages
    Given an install whose project ids span three pages
    When the dataset content migration runs
    Then it reads each page after the cursor the previous page named
    And it looks for postgres-layout datasets in every project once

  @unit
  Scenario: A failed project-id read fails the content migration run
    Given the project module refuses to read the project ids
    When the dataset content migration runs
    Then the run fails with that error rather than reporting a completed summary

  Rule: The content move runs as a background upgrade step

    @unit
    Scenario: The content move resumes after the last project it finished
      Given the content move saved a checkpoint after a project
      When the step runs again
      Then it moves only the datasets of the projects after the saved one

    @unit
    Scenario: An aborted content move keeps the last finished project as its cursor
      Given the content move is aborted part way through a project
      When it stops
      Then that project is not reported finished, so a resumed run moves it again

    @unit
    Scenario: A dry run of the content move writes nothing
      When the content move runs as a dry run
      Then it counts the datasets that would move
      And no chunk is written and no dataset is committed

    @unit
    Scenario: A dataset that fails to move keeps the content move unfinished
      Given a dataset in one project fails to move
      When the content move runs as an upgrade step
      Then the step fails instead of being recorded done
      And its checkpoint stays before that project

    @unit
    Scenario: A retry of an unfinished content move completes it
      Given the content move failed on a dataset and kept its checkpoint before it
      When the step runs again from that checkpoint
      Then it moves the dataset it left behind and is recorded done

    @unit
    Scenario: A dataset skipped for a concurrent write keeps the content move unfinished
      Given a dataset's records change while the content move copies them
      When the content move runs
      Then the run reports itself incomplete
      And its checkpoint stays before that project

