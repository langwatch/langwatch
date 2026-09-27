Feature: Seeded local-dev access tokens
  The local-dev and CI seed writes its admin and token grants to the grants
  head the authorization engine reads, so the fixed tokens are accepted and
  refused exactly where main accepts and refuses them.

  @unit
  Scenario: The seeded private access token administers its organization
    Given the seed's grants for the admin user and the private access token
    When the private access token asks for organization, team, project and webhook permissions at organization scope
    Then every one is allowed within its owner's ceiling

  @unit
  Scenario: The seeded public ingestion token stays restricted to trace ingestion
    Given the seed's grant and role for the public ingestion token
    When it asks to view the organization
    Then it is refused
    And it may still create traces in its project
