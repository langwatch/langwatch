Feature: Projects page by cursor with their organisation
  The storage migration inventory reads every project on the install with the
  organisation that owns it, a page at a time, so it can leave out projects
  whose organisation keeps its own private S3. Projects come ordered by id,
  archived ones included; a page names the cursor that continues it.

  @unit
  Scenario: Reads every project with its organisation when no limit is given
    Given an install with three projects in two organisations, one of them archived
    When a peer reads the projects with their organisation without a limit
    Then all three arrive in id order, each with its organisation, and the next cursor is null

  @unit
  Scenario: Reads a page of projects with their organisation and the cursor that continues it
    Given an install with three projects in two organisations
    When a peer reads the projects with their organisation with a limit of two
    Then the first two arrive and the next cursor is the second id

  @unit
  Scenario: Continues the projects with their organisation after a cursor
    Given an install with three projects in two organisations
    When a peer reads the projects with their organisation after the second id with a limit of two
    Then the third arrives and the next cursor is null

  @unit
  Scenario: An install with no projects yields an empty page of projects
    Given an install with no projects
    When a peer reads the projects with their organisation
    Then no projects arrive and the next cursor is null
