Feature: Public REST API — /api/gateway/v1/*

  # The public REST surface for the AI Gateway control plane: virtual key
  # CRUD + spend, budget CRUD across every scope dimension, cache rules.
  # Bound scenarios run in
  # langwatch/src/app/api/gateway-platform/__tests__/ against the real
  # Hono app, real Postgres, and real ClickHouse.

  As a LangWatch customer integrating with the AI Gateway programmatically
  I want a stable REST API that behaves exactly like the tRPC routers the UI uses
  So that a backend can mint a key per customer, cap it, and read its spend back
  without a browser session anywhere in the loop.

  The API is exposed by Hono under /api/gateway/v1/*, authenticated by a
  legacy project API key or a scoped API key (Bearer + X-Project-Id).
  There is exactly one implementation of every write rule: REST handlers
  route through the SAME service-layer methods and pre-flight asserts as
  the tRPC mutations (VirtualKeyService, GatewayBudgetService,
  virtualKey.authz), so the two doors cannot drift apart. Handlers
  translate wire casing and map errors; they add no business rules.

  Background:
    Given a project "acme-prod" with a team and an organization above it
    And the organization has a governance project for org-scoped keys' traces
    And the deployment has the ClickHouse spend ledgers configured

  # ============================================================================
  # Auth + permission ceiling
  # ============================================================================

  @integration @rest
  Scenario: Reject unauthenticated gateway REST calls
    When I send `GET /api/gateway/v1/virtual-keys` with no credentials
    Then the response status is 401

  @integration @rest @pat
  Scenario: A viewer-scoped API key can list but not create virtual keys
    Given a scoped API key whose bindings grant VIEWER at the project
    When they send `GET /api/gateway/v1/virtual-keys`
    Then the response status is 200
    When they send `POST /api/gateway/v1/virtual-keys`
    Then the response status is 403
    # The ceiling: effective = key bindings ∩ owning user's current bindings.

  @integration @rest @pat @unimplemented
  Scenario: A scoped API key fails closed when a linked custom-role row has malformed permissions (583f27ff6)
    Given an API key "lwp_broken" linked to a custom role whose `permissions` column is NOT a JSON array
    When they send `GET /api/gateway/v1/virtual-keys` with API key "lwp_broken"
    Then the response status is 403
    # Parity with role-binding-resolver.ts: malformed permissions → no grants → deny.

  # ============================================================================
  # Virtual keys: create
  # ============================================================================

  @integration @rest
  Scenario: Create a virtual key with the SDK's current shape
    When I send `POST /api/gateway/v1/virtual-keys` with body `{ "name": "ci-key" }`
    Then the response status is 201
    And the body has a `secret` starting with "vk-lw-", returned exactly once
    And `virtual_key.scopes` defaults to the caller's project
    And `virtual_key.routing_mode` is "NONE" and `virtual_key.purpose` is "user"
    And the response carries no `provider_credential_ids` field
    And a subsequent GET returns the key without the secret

  @integration @rest
  Scenario: Ghost provider_credential_ids no longer gates creation
    # The old schema required min(1) ids of an entity deleted in iter 110,
    # so the SDK's own requests failed validation (#6260). Unknown fields
    # are stripped, never demanded.
    When I send a create body that still carries `provider_credential_ids`
    Then the response status is 201

  @integration @rest
  Scenario: Explicit project scopes are accepted with config
    When I create a key with explicit PROJECT scopes, routing_mode FALLBACK_ALL, and a config
    Then the response status is 201
    And the config round-trips on the returned DTO

  @integration @rest @rbac
  Scenario: A legacy project key cannot mint keys beyond its own project
    # Legacy project keys keep their historical power: full access to their
    # own project, nothing above it. Broader provisioning requires a scoped
    # API key that can prove the grants.
    When a legacy project key requests an ORGANIZATION-scoped key
    Then the response status is 403
    And the error names the missing `virtualKeys:manage` grant

  @integration @rest @rbac
  Scenario: An org-admin API key provisions an org-scoped key
    Given a scoped API key whose bindings grant ADMIN at the organization
    When they create a key with scopes `[{"scope_type": "ORGANIZATION", "scope_id": <org>}]`
    Then the response status is 201
    And the key is reachable org-wide

  @integration @rest @rbac
  Scenario: A member API key passes the route gate but not per-scope manage
    # MEMBER holds virtualKeys:create (the route ceiling) but not
    # virtualKeys:manage — the per-scope gate the tRPC create enforces.
    # If REST ever stops running the shared per-scope assert, this
    # returns 201 and the suite fails: the drift guard for #6260.
    Given a scoped API key whose bindings grant MEMBER at the project
    When they send `POST /api/gateway/v1/virtual-keys`
    Then the response status is 403
    And the error names `virtualKeys:manage`

  @integration @rest
  Scenario: Org-scoped key creation without a governance project is refused
    # The trace_project_required invariant lives in VirtualKeyService.create
    # and nowhere else — REST refusing here proves it runs the service.
    Given an organization with no governance project
    When an org-admin API key creates an ORGANIZATION-scoped key there
    Then the response status is 400
    And error.code is "trace_project_required"

  @integration @rest @rbac
  Scenario: An explicit trace destination gives an org-scoped key a home for its spend
    Given the same organization with no governance project
    When the org-admin creates the ORGANIZATION-scoped key with `trace_project_id` naming a project there
    Then the response status is 201 and the DTO echoes `trace_project_id`
    # The destination routes traces AND budget debits into that project,
    # so choosing it needs `virtualKeys:manage` on the target project:
    When a legacy project key names a sibling team's project as the destination
    Then the response status is 403

  @integration @rest @rbac
  Scenario: Cross-org scopes are rejected
    When an org-admin API key requests a scope belonging to another organization
    Then the response status is 400
    And error.code is "gateway_scope_org_mismatch"

  @integration @rest
  Scenario: routing_mode POLICY requires a routing policy id
    When I create a key with routing_mode "POLICY" and no routing_policy_id
    Then the response status is 400
    And error.code is "routing_policy_required"

  @integration @rest
  Scenario: The product-managed purpose cannot be minted over REST
    # A product-managed key is hidden from reads and refuses mutations —
    # nothing a customer can ever want to mint against themselves.
    When I create a key with purpose "langy"
    Then the response status is 400 with error.code "validation_error"

  @integration @rest @budgets
  Scenario: A key and its cap are created atomically over REST
    When I create a key with `budget: { "limit_usd": "12.50", "window": "MONTH" }`
    Then the response status is 201
    And a VIRTUAL_KEY-scoped GatewayBudget targeting the new key exists in the same transaction

  @integration @rest @budgets
  Scenario: A malformed cap is refused with the shared validation
    # The budget wire parses through the SAME zod schema the tRPC create
    # uses, so a cap tRPC would refuse cannot arrive via REST.
    When I create a key with `budget: { "limit_usd": "10abs", "window": "MONTH" }`
    Then the response status is 400
    And the message names `limit_usd`

  # ============================================================================
  # Virtual keys: lifecycle + visibility + audit
  # ============================================================================

  @integration @audit
  Scenario: Writes from a scoped API key are attributed to its user
    When a scoped API key creates a key
    Then the AuditLog row for `gateway.virtual_key.created` carries the key's owning user id

  @integration @audit
  Scenario: Writes from a legacy project key are attributed to the machine principal
    When a legacy project key creates a key
    Then the AuditLog row carries the synthetic actor `svc_<projectId>`

  @integration @rest @rbac
  Scenario: A sibling team's keys are invisible to the project credential
    Given a key scoped to a sibling team's project in the same organization
    When I list keys and GET that key by id with my project credential
    Then the list omits it and the GET is a 404
    # Same membership-shaped visibility as the tRPC list: org-scoped keys,
    # own team, own project — never a sibling team's.

  @integration @rest
  Scenario: Update renames and re-caps a key through the shared service
    When I PATCH name and budget on an existing key
    Then the response status is 200
    And unspecified fields (description) are left untouched
    And the key's own budget row reflects the new window

  @integration @rest @rbac
  Scenario: Re-scoping over REST demands manage at the new scope
    When a legacy project key PATCHes a key's scopes to ORGANIZATION
    Then the response status is 403

  @integration @rest
  Scenario: Rotate returns a fresh secret exactly once
    When I POST /virtual-keys/:id/rotate
    Then the response status is 200 with a new `secret` different from the old one

  @integration @rest
  Scenario: Revoke is idempotent and archives the key's cap
    When I POST /virtual-keys/:id/revoke twice
    Then both responses are 200 with `virtual_key.status` "revoked"
    And every VIRTUAL_KEY-scoped budget targeting the key is archived, not deleted

  @integration @rest
  Scenario: Product-managed keys refuse customer-facing reads and mutations
    Given a purpose-LANGY key scoped to the caller's project
    Then GET by id is a 404 and rotate is a 404
    # Absent, not forbidden: a distinct error would confirm the id exists.

  # ============================================================================
  # Budgets
  # ============================================================================

  @integration @rest @budgets
  Scenario: A VK-scoped budget created over REST is visible in the REST list
    # Create-then-list must round-trip. Before #6261 the list filtered to
    # ORGANIZATION/TEAM/PROJECT and hid the very rows POST /budgets minted.
    When I create a VIRTUAL_KEY-scoped and a PRINCIPAL-scoped budget over REST
    Then `GET /api/gateway/v1/budgets` returns both, with `spend_available: true`
    And `?scope_type=VIRTUAL_KEY` filters to VIRTUAL_KEY rows only
    And `?scope_type=ORGANIZATION,TEAM` excludes them

  @integration @rest @budgets
  Scenario: An invalid scope_type filter is refused
    When I send `GET /api/gateway/v1/budgets?scope_type=BANANA`
    Then the response status is 400

  @integration @rest @budgets
  Scenario: A PRINCIPAL budget must target a member of the org
    When I create a PRINCIPAL budget for a user outside the organization
    Then the response status is 400
    # Otherwise the budget would be a silent no-op that never matches traffic.

  @integration @rest @budgets
  Scenario: A TEAM budget cannot target another org's team
    When I create a TEAM budget naming a foreign organization's team id
    Then the response status is 400

  @integration @rest @budgets @groups
  Scenario: A GROUP budget over REST carries the per-member semantics
    Given a group with 2 members
    When I create a GROUP-scoped budget with limit_usd "40"
    Then the response status is 201 with scope_type "GROUP" and member_count 2
    And the list row says limit_usd "40" (the PER-MEMBER allowance) while spent_usd sums the whole group's ledger buckets

  @integration @rest @budgets @groups
  Scenario: A GROUP budget cannot target another org's group
    When a foreign tenant's key names my group id
    Then the response status is 400

  @integration @rest @budgets
  Scenario: An ATTRIBUTED_USER budget over REST carries the per-person standing
    Given an attributed-user template anchored on a virtual key, with limit_usd "1"
    And 2 end users have spent against it, 1 of them at or over the cap
    When I list budgets
    Then the row says limit_usd "1" (the PER-PERSON cap) with end_users_seen 2 and end_users_over 1
    And budgets on every other scope carry neither field

  @integration @rest @budgets
  Scenario: A provider-filtered budget round-trips provider_key
    When I create a budget with `provider_key` naming my org's model provider
    Then the response status is 201 and the DTO echoes `provider_key`
    When a foreign tenant names the same provider id
    Then the response status is 400 with error "gateway_scope_org_mismatch" naming the model provider

  @integration @rest @budgets @clickhouse
  Scenario: REST budget spend is the live ClickHouse ledger, not the stale PG column
    # The #6248 wiring proof: the PG `spentUsd` column has had no writer
    # since the ledger cutover. A REST service constructed without the
    # ClickHouse repository reports the stale "0" here and fails.
    Given a VK-scoped budget whose ledger carries a 1.25 USD debit
    And the PG spentUsd column still reads "0"
    When I list budgets over REST
    Then the row's spent_usd is "1.25"

  @integration @rest @budgets
  Scenario: Budget update and archive over REST
    When I PATCH limit_usd and on_breach, then DELETE the budget
    Then the update echoes the new values and the delete returns archived_at non-null
    And historical ledger entries are retained

  # ============================================================================
  # Per-key spend read
  # ============================================================================

  @integration @rest @spend
  Scenario: A fresh key reports zero spend for the current month
    When I send `GET /api/gateway/v1/virtual-keys/:id/spend` with no window params
    Then the response status is 200
    And spent_usd is "0" with requests 0
    And the echoed window starts at the first of the current UTC month
    # Zero is only honest because the spend source is present; without it
    # the endpoint answers 412 spend_source_unavailable instead.

  @integration @rest @spend @clickhouse
  Scenario: Key spend over REST reads the same trace_summaries the UI reads
    Given two traces for the key in trace_summaries costing 0.75 and 0.50
    When I read the key's spend over REST
    Then spent_usd is "1.25" and requests is 2
    # Same repository as the dashboard's spend column and the Usage tab,
    # so the REST number and the UI agree by construction.

  @integration @rest @spend
  Scenario: The spend read validates its window
    When I send `from` after `to`
    Then the response status is 400

  @integration @rest @spend
  Scenario: Spend for an unknown key is a 404, not a zero
    When I read spend for a key id that does not exist
    Then the response status is 404

  # ============================================================================
  # Provider bindings (folded away in iter 110)
  # ============================================================================

  @integration @rest
  Scenario: Provider binding routes are gone since the ModelProvider fold
    When I send `GET /api/gateway/v1/providers`
    Then the response status is 410
    And the message points at /api/gateway-platform/v1/model-providers

  # ============================================================================
  # Cache rules (Lane B iter 41 — 547f96bdd)
  # ============================================================================

  @integration @rest @cache-rules @unimplemented
  Scenario: List cache rules returns priority DESC and excludes archived
    Given cache rules in the org:
      | name      | priority | enabled | archived |
      | high-pri  | 200      | true    | false    |
      | low-pri   | 100      | true    | false    |
      | archived  | 150      | true    | true     |
    When I send `GET /api/gateway/v1/cache-rules`
    Then the response status is 200
    And the body.data array has length 2 (archived excluded)
    And the rows are ordered by priority DESC: high-pri, low-pri

  @integration @rest @cache-rules @unimplemented
  Scenario: Create a cache rule returns 201 with created row (matches budgets pattern)
    When I send `POST /api/gateway/v1/cache-rules` with body:
      """
      {
        "name": "prod-force-cache",
        "priority": 500,
        "matchers": { "vk_tags": ["env=prod"], "model": "gpt-5-mini" },
        "action":   { "mode": "force", "ttl": 300 }
      }
      """
    Then the response status is 201
    And body.id is a 21-character nanoid (no prefix — `GatewayCacheRule.id @default(nanoid())`)
    And body.mode_enum = "FORCE"
    And body.archived_at is null
    And a GatewayChangeEvent (CACHE_RULE_CREATED) was emitted

  @integration @rest @cache-rules @unimplemented
  Scenario: PATCH replaces matchers/action when provided (NOT field-merged)
    Given an existing rule with matchers {vk_tags: ["env=prod"], model: "gpt-5-mini"}
    When I send `PATCH /api/gateway/v1/cache-rules/:id` with body:
      """
      { "matchers": { "model": "claude-haiku-*" } }
      """
    Then the response status is 200
    And body.matchers equals exactly {"model": "claude-haiku-*"}

  @integration @rest @cache-rules @unimplemented
  Scenario: DELETE is a soft archive and returns the archived row (not 204)
    Given an existing rule "rule_xxx"
    When I send `DELETE /api/gateway/v1/cache-rules/rule_xxx`
    Then the response status is 200
    And body.archived_at is a non-null ISO-8601 timestamp
    And a GatewayChangeEvent (CACHE_RULE_DELETED) was emitted

  @integration @rest @cache-rules @unimplemented
  Scenario: GET /:id returns 404 for archived rules
    Given rule "rule_archived" was deleted 1 hour ago
    When I send `GET /api/gateway/v1/cache-rules/rule_archived`
    Then the response status is 404
    And error.type = "not_found"

  @integration @rest @cache-rules @unimplemented
  Scenario: A scoped API key without gatewayCacheRules:create cannot POST
    Given a scoped API key "lwp_ro" with only gatewayCacheRules:view
    When they send `POST /api/gateway/v1/cache-rules` with API key "lwp_ro"
    Then the response status is 403 permission_denied
    And error.code references "gatewayCacheRules:create"

  # ============================================================================
  # DTO shape (snake_case vs camelCase)
  # ============================================================================

  @unit @contract @unimplemented
  Scenario: REST responses are snake_case
    When I inspect any /api/gateway/v1/* response
    Then every field name is snake_case (organization_id, created_at, limit_usd, ...)
    And there are no camelCase fields

  # ============================================================================
  # OpenAPI
  # ============================================================================

  @unit @contract @roadmap @unimplemented
  Scenario: Generated SDK types cover every request/response body shape used by the CLI
    When hono-openapi's `describeRoute` output is generated for this app
    Then the schema matches the DTOs the handlers actually return
    And the CLI's VirtualKeysApiService can be migrated from direct-fetch to the typed openapi client with zero behavioural change
