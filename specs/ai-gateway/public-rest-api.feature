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
    And `virtual_key.routing_mode` is "none" and `virtual_key.purpose` is "user"
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
    When I create a key with explicit project scopes, routing_mode fallback_all, and a config
    Then the response status is 201
    And the config round-trips on the returned DTO

  @integration @rest @rbac
  Scenario: A legacy project key cannot mint keys beyond its own project
    # Legacy project keys keep their historical power: full access to their
    # own project, nothing above it. Broader provisioning requires a scoped
    # API key that can prove the grants.
    When a legacy project key requests an organization-scoped key
    Then the response status is 403
    And the error names the missing `virtualKeys:manage` grant

  @integration @rest @rbac
  Scenario: An org-admin API key provisions an org-scoped key
    Given a scoped API key whose bindings grant ADMIN at the organization
    When they create a key with scopes `[{"scope_type": "organization", "scope_id": <org>}]`
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
    When an org-admin API key creates an organization-scoped key there
    Then the response status is 400
    And error.code is "trace_project_required"

  @integration @rest @rbac
  Scenario: An explicit trace destination gives an org-scoped key a home for its spend
    Given the same organization with no governance project
    When the org-admin creates the organization-scoped key with `trace_project_id` naming a project there
    Then the response status is 201 and the DTO echoes `trace_project_id`
    # The destination routes traces AND budget debits into that project,
    # so choosing it needs `virtualKeys:manage` on the target project:
    When a legacy project key names a sibling team's project as the destination
    Then the response status is 403

  @integration @rest
  Scenario: An unauthenticated request answers the canonical error envelope
    When a request arrives with no API key
    Then the response status is 401
    And the body is the canonical error envelope with type "unauthenticated"
    And error.code is "missing_credentials"

  @integration @rest
  Scenario: A request-validation failure answers the canonical error envelope at 400
    When a request fails its schema
    Then the response status is 400
    And the body is the canonical error envelope with code "validation_error"
    And error.meta names the target and the offending fields
    And error.meta.reasons carries one entry per violation
    # One status for one code: the surface used to answer 422 here while the
    # platform routes answered 400 for the same refusal.

  @integration @rest
  Scenario: An unexpected server failure answers the canonical error envelope naming nothing internal
    When a handler fails with an unexpected error
    Then the response status is 500
    And the body is the canonical error envelope with code "internal_error"
    And the message names no table, host, or stack fragment

  @integration @rest
  Scenario: Every gateway platform refusal is the canonical envelope
    When the API key ceiling refuses a create
    Then the response status is 403
    And the body is the canonical error envelope with type "permission_denied"
    And error.code is "api_key_permission_denied"
    # The ceiling refuses BENEATH the family's error handler, so it is the
    # layer that most easily drifts back to a flat body.

  @integration @rest @rbac
  Scenario: Cross-org scopes are rejected
    When an org-admin API key requests a scope belonging to another organization
    Then the response status is 400
    And error.code is "gateway_scope_org_mismatch"

  @integration @rest
  Scenario: routing_mode POLICY requires a routing policy id
    When I create a key with routing_mode "policy" and no routing_policy_id
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
    When I create a key with `budget: { "limit_usd": "12.50", "window": "month" }`
    Then the response status is 201
    And a VIRTUAL_KEY-scoped GatewayBudget targeting the new key exists in the same transaction

  @integration @rest @budgets
  Scenario: A malformed cap is refused with the shared validation
    # The budget wire parses through the SAME zod schema the tRPC create
    # uses, so a cap tRPC would refuse cannot arrive via REST.
    When I create a key with `budget: { "limit_usd": "10abs", "window": "month" }`
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
    When a legacy project key PATCHes a key's scopes to organization
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
    When I create a virtual_key-scoped and a principal-scoped budget over REST
    Then `GET /api/gateway/v1/budgets` returns both, with `spend_available: true`
    And `?scope_type=virtual_key` filters to virtual_key rows only
    And `?scope_type=organization,team` excludes them

  @integration @rest @budgets
  Scenario: The wire enums are lowercase only, with no casing tolerance
    # The surface used to accept `scope_type=Group` on the list filter, which
    # uppercased whatever arrived, while the create body's `kind` refused the
    # same spelling. One casing, both directions.
    When I send the stored casing on `?scope_type`, on a budget `kind`, or on a
    virtual key `scope_type`
    Then each answers 400 with code "validation_error"

  @integration @rest @budgets
  Scenario: Every enum a budget read returns is lowercase
    When I create a budget and read it back
    Then `scope_type`, `window` and `on_breach` are all lower_snake_case
    # The database stores these SCREAMING_SNAKE, which is Prisma's convention
    # and not a contract; the gateway config payload and the governance
    # webhooks already published lowercase, and this surface was the outlier.

  @integration @rest
  Scenario: An unbounded list is walked by cursor without loss or repeats
    # /budgets, /virtual-keys and /cache-rules returned every row, so a big
    # organization's first call was its slowest, and nothing bounded it.
    Given more budgets than fit in one page
    When I follow `next_cursor` two rows at a time until it comes back null
    Then the ids I collected are exactly the single-page list, in the same order
    And no id appears twice

  @integration @rest
  Scenario: A filtered list pages on rows returned, not rows examined
    When I page `?scope_type=project`
    Then `limit` counts the rows served, because the filter is in the query
    # Filtering a page after reading it would make a request for 50 group
    # budgets come back with a handful and no way to tell that from the end.

  @integration @rest
  Scenario: Every unbounded list takes the same page controls
    Then /virtual-keys and /cache-rules page by the same `limit` and `cursor`
    And a walk of each reconstructs its single-page list exactly

  @integration @rest
  Scenario: A cursor this surface did not issue is refused
    When I send a `cursor` this endpoint never minted
    Then the response status is 400 with code "invalid_cursor"
    # Silently restarting the walk would re-serve everything the caller has.

  @integration @rest
  Scenario: The page size is capped
    When I send `?limit=500`
    Then the response status is 400

  @integration @rest
  Scenario: The spend window is epoch milliseconds, like every spend endpoint
    # This route took ISO-8601 while every other spend endpoint took epoch-ms,
    # so one reconciliation script had to hold two time formats for the same
    # concept.
    When I send `GET /virtual-keys/{id}/spend?from={epochMs}&to={epochMs}`
    Then the response status is 200
    And the echoed `window` is in the same unit, so it can be sent straight back
    When I send the ISO-8601 form this route used to take
    Then the response status is 400

  @integration @rest @budgets
  Scenario: One budget can be read on its own
    # The surface could list budgets and mutate one, but never read one. An
    # integrator holding an id had to page the whole list to find it.
    When I send `GET /api/gateway/v1/budgets/{id}`
    Then the response status is 200 with `spend_available`
    And `budget` is field-for-field the row `GET /budgets` serves for that id

  @integration @rest @budgets
  Scenario: An absent budget answers a canonical 404
    When I send `GET /api/gateway/v1/budgets/{unknown}`
    Then the response status is 404
    And the body is the canonical error envelope with code "budget_not_found"

  @unit @budgets
  Scenario: A budget amount converts to nano-USD without float drift
    Given a budget limit stored as `Decimal(18,6)`
    Then `limit_nano_usd` is the exactly-scaled integer of the decimal string
    # Scaling the string, not `toNumber() * 1e9`, which lands fractions of a
    # cent off for amounts a budget actually holds.

  @unit @budgets
  Scenario: An amount past the safe integer range reports no nano figure
    Given an amount above `Number.MAX_SAFE_INTEGER` nano-USD
    Then the `_nano_usd` field is null
    # A JSON number past that has already lost its low digits, and a wrong
    # money figure is worse than an absent one.
    # The display string has no such ceiling: it is digits, so it keeps
    # reading for amounts whose integer cannot be published.

  @unit @spend @budgets
  Scenario: A `_usd` string is rendered from the integer, never from a float
    Given a nano-USD amount
    Then the `_usd` string carries up to nine fractional digits
    And trailing zeros are trimmed, so 1 USD reads "1" and not "1.000000"
    And it is never exponent notation, so 1 nano-USD reads "0.000000001"
    # `nano / 1e9` puts back the drift the integer exists to avoid, and the
    # `.toFixed(6)` that hid it also dropped the three digits the nano unit is
    # named for, rendering a one-nano charge as "0.000000".

  @unit @spend @budgets
  Scenario: A Float64 spend sum publishes the amount, not its measurement drift
    Given ClickHouse sums 45 micro-USD of spend and stringifies the Float64
    Then the wire reads "0.000045", not "0.000044999999999999996"
    And `_usd` and `_nano_usd` are derived from one integer, so the pair agrees
    # Per-key spend is a Float64 `sum(TraceCost)` over `trace_summaries`, so
    # the drift is in the input. The wire promise is a decimal string, so it
    # is normalised at the seam that makes the promise.

  @unit @budgets
  Scenario: Spend that could not be totalled is null, never a stale figure
    Given `spend_available` is false
    Then `spent_usd` and `spent_nano_usd` are both null
    And `limit_usd` still reads, because a limit is a setting, not a measurement
    # The row used to carry the stale `spentUsd` column alongside the false
    # flag, so a caller that ignored the flag read it as real money.

  @unit @budgets
  Scenario: Per-person and per-member fields appear only on their scopes
    Then `member_count` is present only for a group budget
    And `end_users_seen` / `end_users_over` only for an attributed-user template

  @integration @rest @budgets
  Scenario: An invalid scope_type filter is refused
    When I send `GET /api/gateway/v1/budgets?scope_type=BANANA`
    Then the response status is 400

  @integration @rest @budgets
  Scenario: A PRINCIPAL budget must target a member of the org
    When I create a principal budget for a user outside the organization
    Then the response status is 400
    # Otherwise the budget would be a silent no-op that never matches traffic.

  @integration @rest @budgets
  Scenario: A TEAM budget cannot target another org's team
    When I create a team budget naming a foreign organization's team id
    Then the response status is 400

  @integration @rest @budgets @groups
  Scenario: A GROUP budget over REST carries the per-member semantics
    Given a group with 2 members
    When I create a group-scoped budget with limit_usd "40"
    Then the response status is 201 with scope_type "group" and member_count 2
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
  Scenario: Per-key spend publishes a clean decimal string, whatever the sum drifted to
    Given 24 traces for the key costing 0.000001875 each
    When I read the key's spend over REST
    Then spent_usd is "0.000045"
    # `sum(TraceCost)` is a Float64 sum, so its stringified total lands one ULP
    # low at "0.000044999999999999996". The wire promise is a decimal string,
    # so the read boundary normalises it whatever order the sum ran in.

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
    And the body is the canonical error envelope with type "gone"
    And error.code is "gateway_provider_bindings_gone"
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
    And body.mode_enum = "force"
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

  # ============================================================================
  # external_id and metadata
  # ============================================================================
  #
  # The two customer-owned fields on the governed resources. `external_id` is
  # the id the caller's own system knows the row by; `metadata` is a string map
  # this platform stores and echoes and never interprets. Neither participates
  # in routing, authorization or spend attribution.

  @integration @rest @virtual-keys
  Scenario: A virtual key carries the caller's own id and bookkeeping
    When I send `POST /api/gateway/v1/virtual-keys` with `external_id` and `metadata`
    Then the response status is 201
    And `virtual_key.external_id` and `virtual_key.metadata` echo what was sent
    And a subsequent GET-by-id returns both
    And `GET /api/gateway/v1/virtual-keys?external_id=` returns exactly that key

  @integration @rest @virtual-keys
  Scenario: A key with no external id reads as null, not as an empty string
    When I create a virtual key naming neither field
    Then `virtual_key.external_id` is null
    And `virtual_key.metadata` is an empty object

  @integration @rest @virtual-keys
  Scenario: Patching metadata replaces the stored map rather than merging
    Given a virtual key whose metadata holds two keys
    When I send `PATCH /api/gateway/v1/virtual-keys/:id` with a one-key `metadata`
    Then the stored map holds only that one key
    And sending `external_id: null` clears the id
    And another key may then claim the cleared id

  @integration @rest @virtual-keys
  Scenario: A second resource cannot claim an external id already in use
    Given a virtual key already carrying external id "vk-dupe"
    When I create another virtual key with the same external id
    Then the response status is 409
    And error.code = "external_id_conflict"
    And error.meta names the resource and the id the caller sent

  @integration @rest @budgets
  Scenario: A budget carries the caller's own id and bookkeeping
    When I create a budget with `external_id` and `metadata`
    Then both are returned on create, on GET-by-id, and on the list row
    And `GET /api/gateway/v1/budgets?external_id=` returns exactly that budget
    And a second budget claiming the same id is refused with 409 external_id_conflict

  @integration @rest
  Scenario: Metadata beyond the documented caps is refused, naming the key
    When I send a `metadata` value longer than 500 characters
    Then the response status is 400 with error.code = "validation_error"
    And error.meta.fields names the offending key
    And a map of more than 40 keys is refused the same way

  @integration @rest @virtual-keys
  Scenario: Two keys may both carry no external id
    When I create two virtual keys naming no external id
    Then both are created
