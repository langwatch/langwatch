Feature: Shared project service
  Project behaviour is implemented once and shared with product features.

  @unit
  Scenario: A peer lists full project paths for copied entities
    Given copied entities reference projects with organization and team names
    When the peer lists paths for those project identifiers
    Then one batch returns organization, team and project names separated by " / "
    And only the requested projects are returned
    And archived related rows are not silently hidden

  @unit
  Scenario: A feature ensures an internal project
    Given the process has one project service
    When a feature ensures an internal project for an organization and kind
    Then the project service applies the creation policy
    And it gets the oldest team through the organization service
    And concurrent calls resolve to the same project

  @unit
  Scenario: A feature reads an internal project
    Given an internal project exists for an organization and kind
    When a feature asks the project service for it
    Then the portable project value is returned

  @integration
  Scenario: A feature needs project behaviour
    When the feature is composed
    Then it receives the process-owned project service
    And it does not construct a project repository or service

  @unit
  Scenario: A feature resolves a project's organization
    When Managed Provider needs a project's organization
    Then it asks the process-owned project service
    And it does not query Project persistence directly

  @unit
  Scenario: A compatibility transport resolves a project's organization
    When the Gateway spend-event transport needs to scope virtual-key names
    Then it asks the process-owned project service for the organization
    And unknown or orphaned projects resolve no virtual-key names

  @unit
  Scenario: A compatibility caller resolves a project tenant target
    When it asks for a project's owning organization
    Then the project service returns the tenant for an active or archived project
    And it returns absence for a missing or orphaned project

  @unit
  Scenario: A project is created in an existing shared team
    When the project service creates a project for that team and organization
    Then it verifies the team is active and belongs to the organization
    And it rejects a personal workspace as a destination
    And it returns the portable project value

  @unit
  Scenario: Two projects with the same name get different addresses
    Given two project ids minted back to back
    When each mints a slug from the same project name
    Then the two slugs differ

  @unit
  Scenario: A project is created with a new team
    When the project service creates a project with a new team name
    Then it asks Organization to create the team
    And it grants the requesting user team administration
    And it creates the project in that team

  @unit
  Scenario: Project settings cross an organization boundary
    When a project is updated with a team from another organization
    Then the service throws a destination-team error
    And it does not write the project

  @unit
  Scenario: A personal workspace project is protected
    When a caller moves, archives, or creates an additional project in a personal workspace
    Then the service throws a personal-workspace boundary error
    And it does not write the forbidden change

  # Gap: no test yet proves the tRPC door and the provided ProjectApi share one service over one store.
  @unimplemented
  Scenario: Project compatibility transports share one runtime service
    When tRPC or the project REST API handles a project operation
    Then it reads ProjectService from the process application context
    And it does not construct Prisma or a Project repository per request

  @unit
  Scenario: A project is born with packaged credentials
    Given a process composes the project service
    When the service creates a project
    Then the feature package mints the project identifier
    And the legacy key column holds a value that never authenticates
    And no composition root describes either format

  @unit
  Scenario: Project listings leave out the organization's governance project
    Given an organization holds an application project and its hidden governance project in one team
    When a caller lists the organization's or the team's projects without asking for the governance project
    Then only the application project is listed
    And the page total counts only the application project

  @unit
  Scenario: A caller that covers every tenant asks for the governance project
    Given an organization holds an application project and its hidden governance project in one team
    When a caller lists the organization's or the team's projects with includeGovernance
    Then both projects are listed

  @unit
  Scenario: A new project's created event names the organization's admin
    Given an organization whose oldest ADMIN member is a known user
    When a new project in it is recorded as created
    Then project's created event carries that admin's user id
    And it is not marked as backfilled

  @unit
  Scenario: Existing projects are recorded as created by the backfill, idempotently
    Given an organization with two projects that existed before project recorded its creations
    When the backfill-project-created task runs twice
    Then each run records both projects as created, marked backfilled, with the organization's admin
    And the second run records the same facts as the first, keyed alike, so peers treat it as a repeat

  @unit
  Scenario: A changed project presence setting is recorded as project's fact
    Given a project whose presence setting is on
    When a member saves the project settings with presence off
    Then project records a presence-setting-changed fact with presence off and the project's organization
    And the fact carries the id of the member who changed it
    And it is not marked as backfilled

  @unit
  Scenario: Switching trace sharing off is recorded as project's fact
    Given a project whose trace sharing is on
    When a member saves the project settings with trace sharing off
    Then project records a trace-sharing-disabled fact with the project's organization
    And the fact carries the id of the member who switched it off

  @unit
  Scenario: Saving project settings with trace sharing already off records no sharing fact
    Given a project whose trace sharing is off
    When a member saves the project settings with trace sharing off
    Then no trace-sharing-disabled fact is recorded

  @unit
  Scenario: Saving project settings without changing presence records no presence fact
    Given a project whose presence setting is on
    When a member saves the project settings with presence on, or without the presence field
    Then no presence-setting-changed fact is recorded

  @unit
  Scenario: A project moved to another team is recorded as project's fact
    Given a project in team "alpha" of its organization
    When it is moved to team "beta" of the same organization
    Then project records a project-moved fact naming both teams and the project's organization

  @unit
  Scenario: Saving a project without changing its team records no moved fact
    Given a project in team "alpha" of its organization
    When its settings are saved naming team "alpha", or without naming a team
    Then no project-moved fact is recorded

  @unit
  Scenario: An archived project is recorded as project's fact
    Given a project in an organization
    When it is archived
    Then project records a project-archived fact with the project's organization

  @unit
  Scenario: A move or archive whose fact cannot be recorded still stands
    Given project's lifecycle record fails
    When a project is moved to another team, or archived
    Then the move or archive is saved and answered as usual
    And the failed record is logged with the project's id

  @unit
  Scenario: Existing projects' presence settings are recorded by the backfill, idempotently
    Given an organization with two projects whose presence settings were stored before project recorded them
    When the backfill-project-presence-setting task runs twice
    Then each run records each project's stored presence setting once, marked backfilled, with no changer
    And each project's fact is keyed alike on both runs, so the second run records nothing new

  @unit
  Scenario: A new project's created fact carries its team and whether it is personal
    Given an organization with a shared team
    When a member creates a project in that team
    Then project's created fact names the project's team and that it is not personal

  @unit
  Scenario: A project's department assignment is recorded as project's fact
    Given a project in team "alpha" of its organization
    When a department is assigned to it
    Then project records a department-assigned fact naming the department, team "alpha" and that it is not personal
    And it is not marked as backfilled

  @unit
  Scenario: Assigning a department to a project outside the organization records no fact
    Given a project the assignment does not reach in the named organization
    When a department is assigned to it
    Then no department-assigned fact is recorded

  @unit
  Scenario: Existing projects' departments and teams are recorded by the backfill, idempotently
    Given an organization with two projects stored before project recorded their departments
    When the backfill-project-department-assigned task runs twice
    Then each run records each project's department, team and personal flag once, marked backfilled
    And each project's fact is keyed alike on both runs, so the second run records nothing new

  @unit
  Scenario: A project fact step records every organization's projects a page at a time
    Given three organizations, served two to a page
    When a project fact upgrade step runs
    Then each organization's projects are recorded once
    And the step saves its checkpoint after each page, naming the page's last organization

  @unit
  Scenario: A project fact step resumes after the last page of organizations it saved
    Given a project fact upgrade step whose checkpoint names the second organization
    When the step runs again
    Then only the organizations after the second are recorded

  @unit
  Scenario: A dry run of a project fact step records nothing and saves no checkpoint
    Given three organizations with projects
    When a project fact upgrade step runs as a dry run
    Then no fact is recorded and no checkpoint is saved
    And the report counts the projects it would record where the fact can preview them

  @unit
  Scenario: A project fact step stops between organizations when the worker stops it
    Given a project fact upgrade step whose run has been aborted
    When the step runs
    Then no organization is recorded and no checkpoint is saved

  @integration
  Scenario: The project fact steps are background steps that wait for old writers to go
    When the worker's installed modules list their upgrade steps
    Then project:record-created-facts, project:record-department-assignments and project:record-presence-settings are background data steps
    And each runs only once no older image serves

  @integration
  Scenario: The project created step runs after the judge spend catch-up
    When the worker's installed modules list their upgrade steps
    Then project:record-created-facts runs after instant-eval:copy-judge-spend

  @unit
  Scenario: The model-defaults scope picker offers an archived project
    Given an organization with a live project, an archived project and the hidden governance project
    When the live non-governance project ids are read including archived projects
    Then the live and the archived project are listed
    And the governance project is not listed
    And a read that does not ask for archived projects still leaves the archived one out
