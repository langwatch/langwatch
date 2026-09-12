Feature: LangWatchQL query door is self-describing and scoped safely for coding-agent callers

  As a coding agent (or any API client) calling the LangWatchQL query door
  I want unambiguous scoping errors, a stable error code, and the allowed
  functions and row cap published in both the docs and the schema response
  So that I can recover from a refusal without guessing, and never accidentally
  query the wrong project or exceed a limit nobody told me about

  Issue: #8085.

  Background:
    Given the LangWatchQL query endpoints POST /api/v1/query and GET /api/v1/query/schema

  # ---------------------------------------------------------------------------
  # Project scoping (AC1, AC3, AC4)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An organization-scoped key with no project hint is refused with a self-describing error
    Given an API key that verifies but binds to no single project
    When it calls the query endpoint with no X-Project-Id header and no Basic-auth project id
    Then the response is HTTP 401 with code "project_scope_required"
    And the message tells the caller to send X-Project-Id or Basic auth with the project id
    And meta.required is "project_scope" and meta.accepted lists "X-Project-Id" and "basic_auth_project_id"

  @integration
  Scenario: The schema endpoint applies the same project scoping refusal
    Given an API key that verifies but binds to no single project
    When it calls the schema discovery endpoint with no X-Project-Id header and no Basic-auth project id
    Then the response is HTTP 401 with code "project_scope_required"
    And the message tells the caller to send X-Project-Id or Basic auth with the project id
    And meta.required is "project_scope" and meta.accepted lists "X-Project-Id" and "basic_auth_project_id"

  @integration
  Scenario: An organization key with X-Project-Id answers for that project unchanged
    Given an organization-scoped API key
    When it calls the query endpoint with X-Project-Id set to a project of that organization
    Then the response is HTTP 200 scoped to that project

  @integration
  Scenario: An organization key with Basic auth project id answers for that project unchanged
    Given an organization-scoped API key
    When it calls the query endpoint using Basic auth with the project id and the key as the token
    Then the response is HTTP 200 scoped to that project

  @integration
  Scenario: A key bound to exactly one project self-scopes with no header
    Given an API key bound to exactly one project
    When it calls the query endpoint with no X-Project-Id header and no Basic-auth project id
    Then the response is HTTP 200 scoped to that one project

  @integration
  Scenario: A legacy project key ignores an X-Project-Id header naming another project
    Given a legacy project key (pkey_) bound to its own project
    When it calls the query endpoint with X-Project-Id set to a different project
    Then the response is HTTP 200 scoped to the legacy key's own project, and the header is ignored

  # ---------------------------------------------------------------------------
  # Credential refusal shape (AC2)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An unknown, revoked, and wrong-secret key all get one identical, vague refusal
    Given three API keys: one unknown, one revoked, and one with the wrong secret
    When each calls a project-scoped endpoint
    Then all three responses are HTTP 401 with code "invalid_credentials"
    And all three response bodies are identical to each other and to a fixed expected value
    And none of the three bodies equals the project_scope_required body

  # ---------------------------------------------------------------------------
  # Error code registry and cross-app parity (AC5)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: project_scope_required is registered as an application error code with customer-facing copy
    Given the application error code registry
    Then "project_scope_required" is listed in sorted position
    And it has a customer-facing presentation entry
    And the codes unit test and pnpm typecheck both pass

  @integration
  Scenario: Every project-scoped REST app emits project_scope_required for the same condition
    Given a project-scoped REST app other than the query door, such as the Langy health-check door
    When it is called by a key that verifies but binds to no single project, with no scoping hint
    Then it answers 401 with code "project_scope_required", matching the query door's behavior

  # ---------------------------------------------------------------------------
  # Documentation of authentication (AC6)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The query docs describe every credential form and the project header rule
    Given docs/api-reference/query/overview.mdx
    Then its Authentication section documents X-Auth-Token, Authorization Bearer, and Authorization Basic base64(projectId:token)
    And it documents the X-Project-Id header
    And it states that an organization key must send X-Project-Id or Basic auth with a project id
    And it states that a project key ignores the X-Project-Id header
    And its error table lists "project_scope_required"

  @unit
  Scenario: The OpenAPI descriptions for both query routes name the project header rule
    Given the OpenAPI description of POST /api/v1/query and of GET /api/v1/query/schema
    Then each description names X-Project-Id and the rule that an organization key must supply it or Basic auth

  # ---------------------------------------------------------------------------
  # Allowed functions surfaced to the caller (AC7, AC8, AC9)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A FUNCTION_NOT_ALLOWED violation carries the complete allowlist
    Given the LangWatchQL function allowlist the validator enforces
    When a query calling a disallowed function is refused
    Then the violation's allowedFunctions is the complete, sorted, deduplicated allowlist
    And allowedFunctions equals the validator's own enforced set
    And the violation's message names GET /api/v1/query/schema as where the list lives

  @integration
  Scenario: The REST caller receives allowedFunctions on a function violation
    Given an authenticated API client
    When it submits a query calling a disallowed function
    Then the response's meta.violations entry for the refusal includes allowedFunctions

  @integration
  Scenario: The schema endpoint publishes the allowed function names
    Given an authenticated API client
    When it calls the schema discovery endpoint
    Then the response includes functions as a sorted array
    And that array equals the function allowlist the validator enforces

  @unit
  Scenario: The published OpenAPI schema for the schema endpoint declares the functions field
    Given the OpenAPI schema for GET /api/v1/query/schema
    Then it declares a functions field typed as an array of strings

  @unit
  Scenario: The docs list every allowed function name, kept equal to the validator's allowlist
    Given docs/api-reference/query/overview.mdx
    Then it has a Supported functions section stating the list is served by GET /api/v1/query/schema
    And it lists every function name the validator allows
    And a diff test asserts the documented names equal the validator's allowlist

  # ---------------------------------------------------------------------------
  # Row and byte ceilings documented (AC10, AC11)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The query docs and OpenAPI description state the response ceilings
    Given docs/api-reference/query/overview.mdx and the OpenAPI description of POST /api/v1/query
    Then both state the 10,000 row cap and the 8,000,000 byte cap
    And both describe the top-level truncated field
    And both describe the RESULT_TRUNCATED diagnostic and its meta.maxRows

  @integration
  Scenario: A result over the row cap is still truncated with a diagnostic
    Given an authenticated API client
    When it submits a query whose result exceeds the row cap
    Then the response has truncated set to true
    And the response carries a RESULT_TRUNCATED diagnostic

# --- AC Coverage Map ---
# AC1  "project_scope_required refusal" → Scenario: An organization-scoped key with no project hint is refused with a self-describing error
#                                        → Scenario: The schema endpoint applies the same project scoping refusal
# AC2  "unchanged vague invalid_credentials for unknown/revoked/wrong-secret" → Scenario: An unknown, revoked, and wrong-secret key all get one identical, vague refusal
# AC3  "three still-working scoping cases" → Scenario: An organization key with X-Project-Id answers for that project unchanged
#                                           → Scenario: An organization key with Basic auth project id answers for that project unchanged
#                                           → Scenario: A key bound to exactly one project self-scopes with no header
# AC4  "legacy project key ignores the header" → Scenario: A legacy project key ignores an X-Project-Id header naming another project
# AC5  "code registered and emitted by every project app" → Scenario: project_scope_required is registered as an application error code with customer-facing copy
#                                                           → Scenario: Every project-scoped REST app emits project_scope_required for the same condition
# AC6  "docs auth section and OpenAPI descriptions" → Scenario: The query docs describe every credential form and the project header rule
#                                                    → Scenario: The OpenAPI descriptions for both query routes name the project header rule
# AC7  "allowedFunctions on the violation" → Scenario: A FUNCTION_NOT_ALLOWED violation carries the complete allowlist
#                                           → Scenario: The REST caller receives allowedFunctions on a function violation
# AC8  "functions on the schema endpoint" → Scenario: The schema endpoint publishes the allowed function names
#                                          → Scenario: The published OpenAPI schema for the schema endpoint declares the functions field
# AC9  "docs function list pinned to the allowlist" → Scenario: The docs list every allowed function name, kept equal to the validator's allowlist
# AC10 "row cap documented in docs and OpenAPI description" → Scenario: The query docs and OpenAPI description state the response ceilings
# AC11 "truncation unchanged" → Scenario: A result over the row cap is still truncated with a diagnostic
