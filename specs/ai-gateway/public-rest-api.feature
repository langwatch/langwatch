Feature: Public REST API — /api/gateway/v1/*
  As a LangWatch customer integrating with the AI Gateway programmatically
  I want a stable REST API that mirrors the tRPC routers used by the UI
  So that CLI/scripts/CI/SDKs can manage VKs, budgets, and provider bindings
  without having to shell out to the dashboard.

  The public REST API is exposed by Hono under /api/gateway/v1/* in the
  LangWatch control plane, authenticated via standard project API tokens
  (the same tokens used for /api/traces, /api/prompts, etc.). It shares a
  service layer with the tRPC routers — there is zero duplicate business
  logic; only DTO mappers differ (snake_case REST vs camelCase tRPC).

  Background:
    Given a project "acme-prod" exists with 1 team and 1 organization above it
    And that project has an API token "sess_abc" with scopes:
      | scope                   |
      | virtualKeys:manage      |
      | gatewayBudgets:manage   |
      | gatewayProviders:manage |
    And a model-provider "openai" is configured on the project

  # ============================================================================
  # Auth
  # ============================================================================

  @integration @rest
  Scenario: Reject unauthenticated calls
    When I send `GET /api/gateway/v1/virtual-keys` with no Authorization header
    Then the response status is 401
    And the body has error.type = "unauthenticated"

  @integration @rest
  Scenario: Reject tokens missing the required scope
    Given API token "sess_readonly" has only scope "virtualKeys:view"
    When I send `POST /api/gateway/v1/virtual-keys` with token "sess_readonly"
    Then the response status is 403
    And the body has error.type = "permission_denied"
    And error.code references "virtualKeys:create"

  # ============================================================================
  # Personal Access Token permission ceiling (b8fb945b3 — PAT rebase follow-up)
  # ============================================================================

  @integration @rest @pat
  Scenario: PATs exercise routes only within their scoped role (permission ceiling)
    Given a user "alice" has role-bindings at project scope:
      | permission               |
      | virtualKeys:view         |
      | virtualKeys:rotate       |
    And that user issues a PAT "lwp_alice_ro" scoped to the SAME bindings
    When they send `GET /api/gateway/v1/virtual-keys` with PAT "lwp_alice_ro"
    Then the response status is 200
    When they send `POST /api/gateway/v1/virtual-keys` with PAT "lwp_alice_ro"
    Then the response status is 403 permission_denied
    And error.code references "virtualKeys:create" as the missing permission
    When they send `POST /api/gateway/v1/virtual-keys/vk_xxx/rotate` with PAT "lwp_alice_ro"
    Then the response status is 200

  @integration @rest @pat
  Scenario: PAT effective access = PAT bindings ∩ user's current bindings
    Given a PAT "lwp_bob_admin" originally scoped to "virtualKeys:manage" when user "bob" had that role
    And user "bob"'s role has since been demoted to MEMBER (no :create, :update, :rotate, :delete)
    When they send `POST /api/gateway/v1/virtual-keys` with PAT "lwp_bob_admin"
    Then the response status is 403 permission_denied
    # Demoting the user immediately neutralises outstanding PATs without rotation.

  @integration @rest @pat
  Scenario: Legacy project API tokens bypass PAT ceiling (full access)
    Given a legacy project API token "sess_legacy" tied to project "acme-prod"
    When they send `POST /api/gateway/v1/virtual-keys` with token "sess_legacy"
    Then the response status is 201
    # Project tokens predate PATs and keep full access for backcompat —
    # same behavior the PAT PR (#3213) established for every other unified-auth route.

  Scenario Outline: PAT ceiling mapping for every gateway REST route (b8fb945b3)
    Given a PAT with only "<permission>"
    When they send `<method> <path>`
    Then the response is allowed (200/201) on a matching permission and 403 on a mismatch

    Examples:
      | method | path                                          | permission                 |
      | GET    | /api/gateway/v1/virtual-keys                  | virtualKeys:view           |
      | POST   | /api/gateway/v1/virtual-keys                  | virtualKeys:create         |
      | GET    | /api/gateway/v1/virtual-keys/:id              | virtualKeys:view           |
      | PATCH  | /api/gateway/v1/virtual-keys/:id              | virtualKeys:update         |
      | POST   | /api/gateway/v1/virtual-keys/:id/rotate       | virtualKeys:rotate         |
      | POST   | /api/gateway/v1/virtual-keys/:id/revoke       | virtualKeys:delete         |
      | GET    | /api/gateway/v1/providers                     | gatewayProviders:view      |
      | POST   | /api/gateway/v1/providers                     | gatewayProviders:manage    |
      | PATCH  | /api/gateway/v1/providers/:id                 | gatewayProviders:update    |
      | DELETE | /api/gateway/v1/providers/:id                 | gatewayProviders:manage    |
      | GET    | /api/gateway/v1/budgets                       | gatewayBudgets:view        |
      | POST   | /api/gateway/v1/budgets                       | gatewayBudgets:create      |
      | PATCH  | /api/gateway/v1/budgets/:id                   | gatewayBudgets:update      |
      | DELETE | /api/gateway/v1/budgets/:id                   | gatewayBudgets:delete      |

  # ============================================================================
  # Virtual keys
  # ============================================================================

  @integration @rest
  Scenario: Create a virtual key
    Given a gateway-provider-credential "gpc_openai_primary" is bound on project "acme-prod"
    When I send `POST /api/gateway/v1/virtual-keys` with token "sess_abc" and body:
      """
      {
        "name": "ci-key",
        "environment": "live",
        "provider_credential_ids": ["gpc_openai_primary"]
      }
      """
    Then the response status is 201
    And the body has a non-empty `secret` field starting with "lw_vk_live_"
    And the body's `virtual_key.name` is "ci-key"
    And the body's `virtual_key.prefix` + "..." + `virtual_key.last_four` reconstructs the secret-visible portion
    And subsequent GET of the same key returns the virtual_key but NOT the secret

  @integration @rest
  Scenario: Reject VK creation without at least one provider
    When I send `POST /api/gateway/v1/virtual-keys` with body:
      """
      { "name": "no-providers", "provider_credential_ids": [] }
      """
    Then the response status is 400
    And error.type = "bad_request"
    And error.code = "validation_error"

  @integration @rest
  Scenario: Rotate a virtual key
    Given a virtual key "vk_1" exists on project "acme-prod"
    When I send `POST /api/gateway/v1/virtual-keys/vk_1/rotate`
    Then the response status is 200
    And the body has a new `secret` (different from the previous one)
    And the previous secret no longer validates against /resolve-key

  @integration @rest
  Scenario: Revoke a virtual key is idempotent
    Given a virtual key "vk_1" exists with status "ACTIVE"
    When I send `POST /api/gateway/v1/virtual-keys/vk_1/revoke`
    Then the response status is 200 and `virtual_key.status` is "REVOKED"
    When I send the same revoke call again
    Then the response status is 200 and `virtual_key.status` is still "REVOKED"
    And a GatewayAuditLog entry exists for each of the two revoke calls

  # ============================================================================
  # Budgets
  # ============================================================================

  @integration @rest
  Scenario: Create a hierarchical budget
    When I send `POST /api/gateway/v1/budgets` with body:
      """
      {
        "scope": { "kind": "TEAM", "team_id": "team_acme" },
        "name": "acme team monthly",
        "window": "MONTH",
        "limit_usd": 5000,
        "on_breach": "WARN"
      }
      """
    Then the response status is 201
    And the body has `budget.scope_type` = "TEAM"
    And `budget.spent_usd` = "0"
    And `budget.resets_at` is approximately 30 days from now

  @integration @rest
  Scenario: Archive a budget (soft-delete preserves history)
    Given a budget "bgt_1" exists with 5 debited rows in the ledger
    When I send `DELETE /api/gateway/v1/budgets/bgt_1`
    Then the response status is 200
    And `budget.archived_at` is non-null
    And the 5 ledger rows still exist in the database
    And subsequent `/budget/check` calls for the same scope do NOT count the archived budget

  # ============================================================================
  # Provider bindings
  # ============================================================================

  @integration @rest
  Scenario: Bind a ModelProvider to the gateway
    When I send `POST /api/gateway/v1/providers` with body:
      """
      {
        "model_provider_id": "mp_openai",
        "slot": "primary",
        "rate_limit_rpm": 10000,
        "rate_limit_tpm": 1000000,
        "rotation_policy": "manual"
      }
      """
    Then the response status is 201
    And the body has `provider_credential.id` starting with "gpc_"
    And subsequent `GET /providers` lists the new binding with `health_status` = "healthy"

  @integration @rest
  Scenario: Disable a provider binding stops it from being used on new VKs
    Given a gateway-provider-credential "gpc_1" is bound and used by 2 VKs
    When I send `DELETE /api/gateway/v1/providers/gpc_1`
    Then the response status is 200
    And `provider_credential.disabled_at` is non-null
    And existing VKs bound to gpc_1 still resolve successfully
    But new `POST /virtual-keys` with `provider_credential_ids: ["gpc_1"]` returns 400 with error.code = "provider_disabled"

  # ============================================================================
  # DTO shape (snake_case vs camelCase)
  # ============================================================================

  @unit @contract
  Scenario: REST responses are snake_case
    When I inspect any /api/gateway/v1/* response
    Then every field name is snake_case (organization_id, created_at, limit_usd, ...)
    And there are no camelCase fields

  @unit @contract
  Scenario: tRPC and REST return equivalent data for the same resource
    Given a virtual key "vk_1" is fetched via tRPC `virtualKeys.getById`
    And the same key is fetched via REST `GET /api/gateway/v1/virtual-keys/vk_1`
    When the two DTOs are compared after normalising key casing
    Then they describe the same data (same id, same name, same providers, same config, same timestamps)
    And they were produced by the SAME `VirtualKeyService.getById` call in the service layer
    And no business logic lives in either mapper

  # ============================================================================
  # Machine actor + audit
  # ============================================================================

  @integration @audit
  Scenario: Writes from REST are attributed to the project API token, not a user
    Given API token "sess_abc" was issued without an associated user (service token)
    When I send `POST /api/gateway/v1/virtual-keys` to create a key
    Then a GatewayAuditLog entry is written with `actorUserId` = null
    And `actor` = "svc_<projectId>"
    And `action` = "virtualKey.created"
    And the audit entry is visible in the organisation admin activity log

  # ============================================================================
  # OpenAPI future
  # ============================================================================

  @unit @contract @roadmap
  Scenario: REST routes will be annotated with hono-openapi (iter 6+)
    When hono-openapi's `describeRoute` is wired on every handler
    Then `GET /api/openapi/gateway-platform.json` returns a valid OpenAPI 3.1 schema
    And the generated SDK types cover every request/response body shape used by the CLI
    And the CLI's VirtualKeysApiService can be migrated from direct-fetch to the typed openapi client with zero behavioural change
