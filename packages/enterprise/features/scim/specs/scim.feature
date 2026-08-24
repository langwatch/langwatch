Feature: Enterprise SCIM package boundary
  SCIM contracts and token verification are reusable outside the application.

  @unit
  Scenario: Token values are stored only as hashes
    When an organization generates a SCIM token
    Then the repository receives a SHA-256 hash rather than the token value

  @unit
  Scenario: Entitlement is checked whenever a token is exercised
    Given a valid SCIM token for an organization without an Enterprise plan
    When an identity provider exercises the token
    Then verification reports plan_not_entitled without recording token use

  @unit
  Scenario: Revocation is organization scoped
    Given a token owned by another organization
    When an organization tries to revoke it
    Then the service reports scim_token_not_found
