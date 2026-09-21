Feature: Managing teams and projects from the SDKs

  As an integrator provisioning LangWatch for each of my own customers
  I want to create teams and projects from the SDK I already use
  So that onboarding a customer needs no console visit and no hand-written HTTP

  Background:
    Given an organization exists
    And I hold an organization-scoped API key

  # ============================================================================
  # Reachability
  # ============================================================================

  @unit
  Scenario: Teams and projects are reachable from the SDK entry point
    Given a LangWatch client built with an organization API key
    Then the client exposes a teams service and a projects service
    And both are also importable on their own from the package entry point

  # ============================================================================
  # Teams
  # ============================================================================

  @integration
  Scenario: Creating a team from the SDK returns the team with its slug
    When I create a team named "ACME Platform" through the SDK
    Then the created team comes back with its id, name and slug

  @integration
  Scenario: Listing teams from the SDK follows pagination past the first page
    Given the organization holds more teams than fit on one page
    When I list teams through the SDK
    Then every team is returned, not only the first page

  # ============================================================================
  # Projects
  # ============================================================================

  @integration
  Scenario: Creating a project from the SDK returns the service API key minted with it
    When I create a project in an existing team through the SDK
    Then the created project comes back with its own service API key
    And that key is the credential the new project sends its traces with

  @integration
  Scenario: Creating a project from the SDK can open its team at the same time
    When I create a project through the SDK naming a team that does not exist yet
    Then the team is created alongside the project

  @integration
  Scenario: Archiving a project from the SDK reports when it was archived
    When I archive a project through the SDK
    Then the archived project comes back with the time it was archived

  @integration
  Scenario: A refused project call raises the typed error for its status
    Given the platform answers a project call with not found
    When I archive a project that does not exist through the SDK
    Then the SDK raises the not-found error rather than a generic failure
