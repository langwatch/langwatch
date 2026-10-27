Feature: Organization ids page by cursor
  Fleet-wide scans read every organization id a page at a time, so no scan holds
  the whole fleet in one result. Ids come ordered by id; a page names the cursor
  that continues it.

  @unit
  Scenario: Reads every id when no limit is given
    Given an install with three organizations
    When a peer reads the organization ids without a limit
    Then all three ids arrive in id order and the next cursor is null

  @unit
  Scenario: Reads a page and the cursor that continues it
    Given an install with three organizations
    When a peer reads the organization ids with a limit of two
    Then the first two ids arrive and the next cursor is the second id

  @unit
  Scenario: Continues after a cursor
    Given an install with three organizations
    When a peer reads the organization ids after the second id with a limit of two
    Then the third id arrives and the next cursor is null

  @unit
  Scenario: An install with no organizations yields an empty page
    Given an install with no organizations
    When a peer reads the organization ids
    Then no ids arrive and the next cursor is null

  @unit
  Scenario: A fleet scan visits every organization across pages
    Given a fleet scan and an install with five organizations
    When the scan runs with a page limit of two
    Then it visits all five organizations once each
