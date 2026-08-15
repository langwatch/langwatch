Feature: Read-only REST discovery of routing policies
  As an automation client holding a project API key
  I want to list and read the routing policies selectable at my project's scope
  So that I can discover valid routing_policy_id values for virtual-key provisioning

  Background:
    Given an organization "org-x" with a team "team-a" containing project "project-a"
    And a project API key for "project-a" with the standard pre-existing read permissions

  @unimplemented
  Scenario: List returns exactly the policies selectable at the project's scope
    Given a policy "p-project" scoped to project "project-a"
    And a policy "p-team" scoped to team "team-a"
    And a policy "p-org" scoped to organization "org-x" with isDefault false
    And a policy "p-sibling" scoped only to sibling project "project-b" in "org-x"
    When the client calls GET /routing-policies with the project API key
    Then the response status is 200
    And the returned id set is exactly {"p-project", "p-team", "p-org"}

  @unimplemented
  Scenario: Policy objects expose exactly the five-field summary subset
    Given at least one policy selectable at "project-a"
    When the client calls GET /routing-policies with the project API key
    Then each returned policy object has key set exactly {id, name, description, strategy, isDefault}
    And no returned object contains policyRules, modelAliases, modelAllowlist, modelProviderIds, organizationId, or scope assignments

  @unimplemented
  Scenario: Get by id returns the same five-field subset
    Given a policy "p-project" scoped to project "project-a"
    When the client calls GET /routing-policies/p-project with the project API key
    Then the response status is 200
    And the response body has key set exactly {id, name, description, strategy, isDefault}

  @unimplemented
  Scenario: A listed id round-trips through virtual-key create
    Given a policy "p-project" scoped to project "project-a"
    And the client obtained "p-project" from GET /routing-policies
    When the client creates a virtual key with routing_policy_id "p-project"
    Then the create response status is 201
    And reading that virtual key back reports routing_policy_id "p-project"
    # Skip-note: rejection of non-selectable ids on the virtual-key payload is
    # pre-existing validation, unchanged by this work.

  @unimplemented
  Scenario: The regenerated OpenAPI spec documents both paths completely
    Given the regenerated OpenAPI spec artifact from this change
    Then the spec contains a path object for GET /routing-policies and GET /routing-policies/{id}
    And each path declares a 200 response schema with exactly the five-field subset
    And each path declares a security scheme and documented 403 and 404 responses
    And the spec diff for this change touches no path outside /routing-policies*

  @unimplemented
  Scenario: Invisible ids are byte-identical 404s with no existence oracle
    Given a policy "p-other-org" belonging to a different organization "org-y"
    And a policy "p-sibling" scoped only to sibling project "project-b" in "org-x"
    When the client calls GET /routing-policies/{id} with the project API key for each of:
      | id kind                                    |
      | a valid-format id that does not exist      |
      | p-other-org                                |
      | p-sibling                                  |
      | a malformed id                             |
    Then every response is HTTP 404 with the routing-policy not-found error body
    And all four response bodies are byte-identical
    And no request returns a 500

  @unimplemented
  Scenario: The list never returns another organization's policies
    Given an organization "org-y" with a default policy "p-y-default" and a non-default policy "p-y-other"
    When the client calls GET /routing-policies with the "project-a" API key
    Then neither "p-y-default" nor "p-y-other" appears in the response

  @unimplemented
  Scenario: The list never returns a same-org sibling project's private policies
    Given a policy "p-sibling" whose only scope assignment is sibling project "project-b" in "org-x"
    And a policy "p-org" scoped to organization "org-x"
    And a policy "p-team" scoped to team "team-a"
    When the client calls GET /routing-policies with the "project-a" API key
    Then "p-sibling" is absent from the response
    And "p-org" and "p-team" are present in the response

  @unimplemented
  Scenario: A key lacking the required permission is denied with the literal 403 body
    Given a project API key for "project-a" that lacks the permission gating these routes
    When the client calls GET /routing-policies and GET /routing-policies/{id}
    Then each response is HTTP 403 with the api_key_permission_denied error body

  @unimplemented
  Scenario: Missing and invalid credentials receive the sibling routes' literal statuses
    When the client calls GET /routing-policies with no auth header
    And the client calls GET /routing-policies with a malformed or revoked key
    Then each response status equals the literal status the sibling gateway-platform
      routes return for that case, asserted as a literal in the test

  @unimplemented
  Scenario: An org without the enterprise plan entitlement is gated with 402
    Given an organization without the enterprise plan entitlement
    When its project API key calls GET /routing-policies and GET /routing-policies/{id}
    Then each response is HTTP 402 with the enterprise_plan_required error body

  @unimplemented
  Scenario: The change introduces no new EE-module-absence surface
    Given the route file diff for this change
    Then every EE-module import it relies on is a pre-existing static import of the REST app,
      or the routes sit behind a named presence guard with a documented response

  @unimplemented
  Scenario: The tenancy-unaware by-id lookup is never the sole authorization
    Given a policy "p-sibling" scoped only to sibling project "project-b" in "org-x"
    When the client calls GET /routing-policies/p-sibling with the "project-a" API key
    Then the response is the byte-identical 404 not-found response
    And the route file shows the by-id lookup absent or immediately followed by an explicit scope assertion

  @unimplemented
  Scenario: Existing suites pass with additions-only diffs
    Given the pre-existing gateway-platform integration suites and routing-policy dashboard-API tests
    Then all of them pass in CI
    And the diff on every pre-existing test file contains additions only

  @unimplemented
  Scenario: A key issued before this change can read the list
    Given a project API key created before this change, holding only pre-existing standard read permissions
    When the client calls GET /routing-policies
    Then the response status is 200

  @unimplemented
  Scenario: An empty result is a 200 with the sibling routes' envelope
    Given "project-a" has zero selectable policies
    When the client calls GET /routing-policies with the project API key
    Then the response status is 200
    And the body is an empty collection, not null and not a 404
    And the response envelope matches the sibling gateway-platform list routes' envelope


# --- AC Coverage Map ---
# AC1  (list visibility)          -> "List returns exactly the policies selectable at the project's scope"
# AC2  (field subset)             -> "Policy objects expose exactly the five-field summary subset"; "Get by id returns the same five-field subset"
# AC3  (round-trip)               -> "A listed id round-trips through virtual-key create"
# AC4  (OpenAPI)                  -> "The regenerated OpenAPI spec documents both paths completely"
# AC5  (no existence oracle)      -> "Invisible ids are byte-identical 404s with no existence oracle"
# AC6  (cross-org isolation)      -> "The list never returns another organization's policies"
# AC6b (same-org isolation)       -> "The list never returns a same-org sibling project's private policies"
# AC7  (authorization literals)   -> "A key lacking the required permission is denied with the literal 403 body"; "Missing and invalid credentials receive the sibling routes' literal statuses"
# AC8a (plan gate)                -> "An org without the enterprise plan entitlement is gated with 402"
# AC8b (module absence)           -> "The change introduces no new EE-module-absence surface" (decision-record half is PR-body evidence)
# AC9  (scope filter is authz)    -> "The tenancy-unaware by-id lookup is never the sole authorization"
# AC10 (regression)               -> "Existing suites pass with additions-only diffs"
# AC11 (permission continuity)    -> "A key issued before this change can read the list"
# AC12 (empty result / envelope)  -> "An empty result is a 200 with the sibling routes' envelope"
# ACs: 14 / Scenarios: 16 — every AC covered by >=1 scenario; counts reconcile.
