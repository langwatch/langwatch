@unit
Feature: The /api/projects door is served by the application the composition builds
  As an integrator holding an organization API token
  I want the projects endpoints to answer about my organization's projects
  So that I can list, read, provision, rename and archive them over HTTP

  # Every route in this family once answered
  #   500 {"error":{"type":"internal_error","code":"internal_error"}}
  # while its own unit suite stayed green, because the door was declared
  # against a witness interface nothing in the composition implements and the
  # suite supplied that witness by hand. The application is handed to a door
  # through an operations-only proxy, so a member the door names and the
  # application does not serve is not caught at the seam — it throws a
  # TypeError on the first request, which the boundary correctly degrades to a
  # generic "unknown" answer.
  #
  # These scenarios are therefore bound to tests that mount the REAL
  # ProjectApp, over its own repository interface, through that same proxy.

  Scenario: the management door reaches the application the composition built
    Given an organization credential that reaches every project
    When I list the organization's projects
    Then the listing answers with that organization's projects
    And no route answers with an unknown error

  Scenario: the management door writes at the organization the credential resolved
    Given an organization credential
    When I rename one of that organization's projects
    Then the write is carried out against the organization the credential resolved
    And never against the organization the project itself belongs to

  Scenario: the management door refuses to write outside its organization
    Given an organization credential
    When I rename a project belonging to a different organization
    Then the request is refused as not found
    And that project is left unchanged

  Scenario: archiving answers with the row that was archived
    Given an organization credential
    When I archive one of that organization's projects
    Then the answer carries the project's id, name and the time it was archived
    And the project is recorded as archived

  Scenario: provisioning answers with a service key and never the base key
    Given an organization credential
    When I provision a project in one of the organization's teams
    Then the answer carries a freshly minted service key and its id
    And the answer carries neither the project's base key nor its query key
