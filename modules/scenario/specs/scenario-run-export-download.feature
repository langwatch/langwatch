Feature: Scenario run export download

  @unit
  Scenario: The scenario-runs download is attributed and compressed
    Given a user exports a project's scenario runs
    When the download application prepares the CSV response
    Then it records the viewer and project in the audit log
    And it emits gzip-compressed canonical CSV
    And it publishes export progress for that project

  @unit
  Scenario: Cancelling an export prevents the CSV sweep from starting
    Given the export request was cancelled before the download application starts
    When it prepares the download
    Then it reads neither the export count nor an export page

  @unit
  Scenario: Cancelling an in-flight export stops additional CSV pages
    Given the first CSV page is waiting on its source
    When the viewer cancels the download
    Then no further export page is requested
