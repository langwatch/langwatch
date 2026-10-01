Feature: A new project can query LangWatchQL as soon as it exists

  As a user who just created a project, on SaaS or on a fresh self-hosted install
  I want LangWatchQL, custom chart widgets and Instant Evals to see my traces right away
  So that I do not read zero rows until the next deploy restarts the pods

  Every LangWatchQL view carries a row policy that resolves the tenant through the
  key map (`lwql_api_key_tenant_map`). A project with no key-map row reads zero rows.
  The deploy-time provisioning task backfills every missing row, but it runs only at
  boot, so a project created after boot needs its row written when it is created.

  # Ruling (ARCHITECTURE.md section 9, no peer cycle): project records a created event on its
  # own `project_lifecycle` pipeline, and analytics' peer subscriber writes the row from its own
  # side, idempotently, retried until it lands. The row lands within seconds; a query in that gap
  # reads zero rows, as main answers for an empty project, never an error. Each path below is
  # proven up to project's event; the analytics scenario proves the event becomes the row.

  Background:
    Given LangWatchQL is configured for this deployment

  @unit
  Scenario: A new project is recorded on project's own pipeline
    When a project is created
    Then project records a created event carrying the project and organization ids

  @unit
  Scenario: A failure to record the new project does not block its creation
    Given recording the created event fails
    When a project is created
    Then the project is still created
    And the failure is logged so the next deploy's backfill writes the row

  @unit
  Scenario: Analytics writes the key-map row when a project is created
    Given a project was recorded as created
    When analytics handles the event
    Then the key map holds a row mapping the project's key hash to the project
    And handling the same event again leaves one mapping for that key hash

  @unit
  Scenario: A project created from the projects screen is recorded as created
    When a user creates a project through the project router
    Then project records a created event for it

  @unit
  Scenario: The first project created during onboarding is recorded as created
    When a user finishes onboarding and the organization and first project are created
    Then project records a created event for the first project

  @unit
  Scenario: A project created through the REST API is recorded as created
    When an organization API key creates a project through the REST API
    Then project records a created event for it

  # Organization writes the personal project row itself: it records the new workspace on its own
  # pipeline, and project records the project as created from its own side.
  @unit
  Scenario: A personal workspace records its new project
    When a user's personal workspace is created
    Then organization records the new workspace with its project
    And an existing workspace records nothing

  @unit
  Scenario: A personal workspace project is recorded as created
    Given organization recorded a new personal workspace
    When project handles the event
    Then project records a created event for the personal project
