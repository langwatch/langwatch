Feature: Project ids page by cursor
  Fleet-wide scans read every project id a page at a time, so no scan holds the
  whole install in one result. Ids come ordered by id, archived projects
  included; a page names the cursor that continues it.

  @unit
  Scenario: Reads every project id when no limit is given
    Given an install with three projects, one of them archived
    When a peer reads the project ids without a limit
    Then all three ids arrive in id order and the next cursor is null

  @unit
  Scenario: Reads a page of project ids and the cursor that continues it
    Given an install with three projects
    When a peer reads the project ids with a limit of two
    Then the first two ids arrive and the next cursor is the second id

  @unit
  Scenario: Continues the project ids after a cursor
    Given an install with three projects
    When a peer reads the project ids after the second id with a limit of two
    Then the third id arrives and the next cursor is null

  @unit
  Scenario: An install with no projects yields an empty page of ids
    Given an install with no projects
    When a peer reads the project ids
    Then no ids arrive and the next cursor is null
