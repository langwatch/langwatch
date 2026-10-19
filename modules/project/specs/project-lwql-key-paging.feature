Feature: Projects page by cursor with their LangWatchQL key
  The LangWatchQL key-map backfill reads every project on the install with its
  key, a page at a time, through the project module rather than the Project
  table. Projects come ordered by id, archived ones included; a page names the
  cursor that continues it.

  @unit
  Scenario: Reads every project with its LangWatchQL key when no limit is given
    Given an install with three projects, one of them archived
    When a peer reads the projects with their LangWatchQL key without a limit
    Then all three arrive in id order, each with its key, and the next cursor is null

  @unit
  Scenario: Reads a page of projects with their LangWatchQL key and the cursor that continues it
    Given an install with three projects
    When a peer reads the projects with their LangWatchQL key after the first id with a limit of one
    Then the second arrives and the next cursor is the second id
