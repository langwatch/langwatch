Feature: Shared project service
  Project behaviour is implemented once and shared with product features.

  Scenario: A feature ensures an internal project
    Given the process has one project service
    When a feature ensures an internal project for an organization and kind
    Then the project service applies the creation policy
    And it gets the oldest team through the organization service
    And concurrent calls resolve to the same project

  Scenario: A feature reads an internal project
    Given an internal project exists for an organization and kind
    When a feature asks the project service for it
    Then the portable project value is returned

  Scenario: A feature needs project behaviour
    When the feature is composed
    Then it receives the process-owned project service
    And it does not construct a project repository or service

  Scenario: A feature resolves a project's organization
    When Managed Provider needs a project's organization
    Then it asks the process-owned project service
    And it does not query Project persistence directly

  Scenario: A compatibility transport resolves a project's organization
    When the Gateway spend-event transport needs to scope virtual-key names
    Then it asks the process-owned project service for the organization
    And unknown or orphaned projects resolve no virtual-key names

  Scenario: A compatibility caller resolves a project tenant target
    When it asks for a project's owning organization
    Then the project service returns the tenant for an active or archived project
    And it returns absence for a missing or orphaned project

  Scenario: A project is created in an existing shared team
    When the project service creates a project for that team and organization
    Then it verifies the team is active and belongs to the organization
    And it rejects a personal workspace as a destination
    And it returns the portable project value

  Scenario: A project is created with a new team
    When the project service creates a project with a new team name
    Then it asks Organization to create the team
    And it grants the requesting user team administration
    And it creates the project in that team

  Scenario: Project settings cross an organization boundary
    When a project is updated with a team from another organization
    Then the service throws a destination-team error
    And it does not write the project

  Scenario: A personal workspace project is protected
    When a caller moves, archives, or creates an additional project in a personal workspace
    Then the service throws a personal-workspace boundary error
    And it does not write the forbidden change

  Scenario: Project compatibility transports share one runtime service
    When tRPC or the project REST API handles a project operation
    Then it reads ProjectService from the process application context
    And it does not construct Prisma or a Project repository per request

  @unit
  Scenario: A deployment without a clustering scheduler refuses by name
    Given a process composes the project surface with no topic-clustering scheduler
    When a caller asks for a manual clustering run
    Then the caller is told this deployment does not offer that service
    And the refusal reaches the caller by name rather than as an unknown failure

  @unit
  Scenario: A clustering run that fails inside the platform degrades to an unknown failure
    Given a process composes the project surface with a clustering scheduler
    When the scheduler fails for a reason no caller can act on
    Then the process records the failure
    And the caller is told only that the request failed, with a trace id to quote

  @unit
  Scenario: A project is born with packaged credentials
    Given a process composes the project service
    When the service creates a project
    Then the feature package mints the project identifier and the ingestion key
    And the ingestion key keeps the prefixed 54-byte alphanumeric shape the onboarding snippets are sized against
    And no composition root describes either format
