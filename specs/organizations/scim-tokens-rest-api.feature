Feature: SCIM tokens REST API

  As an operator wiring an identity provider to LangWatch
  I want to mint and revoke SCIM bearer tokens over REST
  So that directory sync can be set up without a browser session

  Background:
    Given an organization on an Enterprise plan
    And I am authenticated with an organization-scoped API key

  # The token is the credential an identity provider will hold, so it is shown
  # once at creation and never again: listing describes tokens, it does not
  # hand them out. Revoking is immediate, because the reason to revoke is
  # usually that someone else has the token.

  @integration
  Scenario: Listing SCIM tokens never returns secrets
    Given the organization has a SCIM token
    When I list SCIM tokens
    Then the response status is 200
    And each token carries its id, description, creation time and last use
    And no token value or hash appears anywhere in the response

  @integration
  Scenario: Creating a SCIM token returns the secret exactly once
    When I create a SCIM token described as "Okta production"
    Then the response status is 201
    And the response carries the token value
    And a SCIM request authenticated with it is accepted
    And listing tokens afterwards does not repeat the value

  @integration
  Scenario: Revoking a SCIM token stops it verifying
    Given the organization has a SCIM token that currently works
    When I revoke that token
    Then the response status is 200
    And a SCIM request authenticated with it is refused
    And revoking it again is refused with code scim_token_not_found and status 404
