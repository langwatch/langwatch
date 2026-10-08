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
