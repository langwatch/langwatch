Feature: A new project can query LangWatchQL as soon as it exists

  As a user who just created a project, on SaaS or on a fresh self-hosted install
  I want LangWatchQL, custom chart widgets and Instant Evals to see my traces right away
  So that I do not read zero rows until the next deploy restarts the pods

  Every LangWatchQL view carries a row policy that resolves the tenant through the
  key map (`lwql_api_key_tenant_map`). A project with no key-map row reads zero rows.
  The deploy-time provisioning task backfills every missing row, but it runs only at
  boot, so each path that creates a project writes the row itself, best effort.

  Background:
    Given LangWatchQL is configured for this deployment

  @integration
  Scenario: A project created from the projects screen gets its key-map row
    When a user creates a project through the project router
    Then the key map holds a row mapping the project's key hash to the project

  @integration
  Scenario: The first project created during onboarding gets its key-map row
    When a user finishes onboarding and the organization and first project are created
    Then the key map holds a row mapping the first project's key hash to that project

  @integration
  Scenario: A project created through the REST API gets its key-map row
    When an organization API key creates a project through the REST API
    Then the key map holds a row mapping the project's key hash to the project

  @integration
  Scenario: A personal workspace project gets its key-map row
    When a user's personal workspace is provisioned
    Then the key map holds a row mapping the personal project's key hash to it

  @unit
  Scenario: A personal workspace whose owner grant fails still gets its key-map row
    Given the owner's admin grant on a new personal workspace fails
    When the personal workspace is provisioned
    Then the key map still holds a row for the personal project

  @unit
  Scenario: A key-map write failure does not block project creation
    Given the key-map write fails
    When a project is created
    Then the project is still created
    And the failure is logged so the next deploy's backfill writes the row
