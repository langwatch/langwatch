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

  # ── Connection scoping (D08) ────────────────────────────────────────────

  # A token is the whole write authority a directory holds, so "which
  # organization" was never a fine enough answer once an organization can
  # have more than one connection: a contractor directory and the staff
  # directory should not be able to edit each other's people. Creating a
  # token therefore names the connection it is for, and that naming is what
  # makes a cross-connection write impossible rather than merely discouraged.
  # What such a token may then do is
  # specs/identity/scim-connection-sync.feature's; what this API says about
  # it is here. The two anchors above are untouched by any of it: the secret
  # is still shown exactly once, and listing still hands out no secrets.

  @integration @unimplemented
  Scenario: Creating a SCIM token names the connection it is for
    Given the organization has an SSO connection
    When I create a SCIM token described as "Okta production" for that connection
    Then the response status is 201
    And the response carries the token value and names the connection
    And listing tokens afterwards shows the connection and still no value

  @integration @unimplemented
  Scenario: Creating a SCIM token without a connection is refused
    When I create a SCIM token without naming a connection
    Then the request is refused with code scim_connection_required and status 422
    And no token is created

  @integration @unimplemented
  Scenario: Creating a SCIM token for another organization's connection is refused
    Given a connection belonging to a different organization
    When I create a SCIM token for it
    Then the request is refused with code scim_connection_not_found and status 404
    And nothing about the other organization appears in the response

  @integration @unimplemented
  Scenario: Tearing down a connection revokes the tokens issued for it
    Given the organization has SCIM tokens for two different connections
    When one of those connections is torn down
    Then a SCIM request authenticated with that connection's token is refused
    And the other connection's token still works
    And listing tokens no longer offers the revoked one
