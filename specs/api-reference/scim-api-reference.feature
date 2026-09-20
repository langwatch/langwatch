Feature: SCIM 2.0 is published in the API reference

  As an identity administrator wiring a directory to LangWatch
  I want the SCIM endpoints documented like every other resource
  So that I can configure provisioning without reading LangWatch source

  # SCIM is the one family the route-coverage gate carried as a written gap:
  # the endpoints worked, the identity providers called them, and the reference
  # said nothing. Documenting them closes the last exclusion entry, so the gate
  # goes from "these are the routes we chose not to publish" to "everything
  # public is published".
  #
  # Three of the fifteen operations are discovery: service provider config,
  # resource types and schemas. They are served without authentication, so a
  # provider can negotiate capabilities before a token exists, which the
  # declared policy has to say out loud, because a policy claiming an internal
  # secret guards them is a claim nobody enforces.

  @unit
  Scenario: Every SCIM route is documented in the API reference
    When I read the generated OpenAPI document
    Then the discovery, Users and Groups operations are all present
    And each carries an operation id chosen for it rather than derived
    And every provisioning operation declares the SCIM bearer credential it authenticates with
    And the discovery operations declare no credential at all
    And no SCIM path is listed as a deliberately unpublished route

  @integration
  Scenario: SCIM discovery endpoints declare an honest public policy
    When a discovery endpoint is called with no credentials
    Then the response status is 200
    And its declared policy says discovery metadata is public per the SCIM standard

  @integration
  Scenario: The SCIM schema describes groups as access groups
    When I read the SCIM group schema
    Then it describes a group as a LangWatch access group
    And it does not describe a group as a team

  # A directory refusal used to be a plain Error: the family's own error
  # handler rendered it, but nothing ever mounted that handler, so every
  # refusal reached the process boundary as an unattributed 500. Measured
  # against main on 2026-09-21: 401 there, 500 here, on all four
  # /api/scim/v2 provisioning routes.
  @unit
  Scenario: A directory refusal answers its own status, never an unattributed 500
    Given a provisioning route mounted on the process's own error boundary
    When it is called with no bearer token
    Then the response status is 401
    And the body carries the refusal's stable code
