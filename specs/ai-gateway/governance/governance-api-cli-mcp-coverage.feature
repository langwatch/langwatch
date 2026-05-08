Feature: AI Gateway Governance — API + CLI + MCP coverage (agentic-first parity)
  As an org admin who wants to set up LangWatch governance via an agent
  (Claude Code, Codex, Cursor) instead of clicking through the dashboard
  I want every governance feature to expose CRUD via three uniform surfaces:
    1. a Hono REST/JSON API at /api/governance/<resource> with OpenAPI spec
    2. a CLI command at `langwatch governance <resource> <verb>`
    3. an MCP tool exposed under the `governance` namespace
  All three surfaces must share the same service-layer code (no tRPC
  duplication), enforce the same RBAC permissions, and be auto-documented
  via the OpenAPI spec consumed by TypeScript + Python SDK regeneration

  Per gateway.md "agentic-first coverage":
    Reference precedent — PR #3168 (six-pillar agentic coverage) and
    PR #3210 (CLI/MCP namespace pattern). This spec extends the same
    pattern to every governance feature, namespaced under `governance`.

  Per architecture-invariants.feature:
    TenantId = projectId (or organizationId for org-scoped resources).
    The new API/CLI/MCP surfaces are NOT a tenancy rewrite — they're
    additional surfaces over the existing tenant-bound services.

  Background:
    Given organization "acme" exists
    And admin "carol@acme.com" has an apiKey with scope `governance:*`
    And user "ben@acme.com" has an apiKey with scope `governance:read`
    And the Hono server is running with /api/governance/* routes mounted

  # ---------------------------------------------------------------------------
  # Resource coverage matrix
  # ---------------------------------------------------------------------------

  @bdd @governance-api @resource-coverage
  Scenario Outline: Every governance resource has the full CRUD triple-surface
    Given the resource "<resource>" is in the governance feature set
    Then there is a Hono route group at "/api/governance/<resource>" with verbs:
      | verb     | http  | rbac scope          |
      | list     | GET   | <resource>:view     |
      | get      | GET /:id | <resource>:view  |
      | create   | POST  | <resource>:manage   |
      | update   | PATCH /:id | <resource>:manage |
      | delete   | DELETE /:id | <resource>:manage |
    And there is a CLI command "langwatch governance <resource> <verb>" mirroring each
    And there is an MCP tool "governance_<resource>_<verb>" mirroring each
    And ALL THREE surfaces dispatch through the same service-layer function
        (no copy-pasted business logic between Hono / CLI / MCP / tRPC)

    Examples:
      | resource              |
      | virtual-keys          |
      | gateway-budgets       |
      | anomaly-rules         |
      | ingestion-sources     |
      | ingestion-templates   |
      | user-ingestion-bindings |
      | role-bindings         |
      | ai-tool-entries       |
      | members               |
      | invites               |
      | audit-log             |
      | sessions              |

  # ---------------------------------------------------------------------------
  # Service-layer contract — single source of truth
  # ---------------------------------------------------------------------------

  @bdd @governance-api @service-layer @no-duplication
  Scenario: Each surface delegates to a shared service-layer function
    When the Hono route POST /api/governance/anomaly-rules is invoked
    And the CLI command `langwatch governance anomaly-rules create` is invoked
    And the MCP tool `governance_anomaly_rules_create` is invoked
    Then ALL THREE invocations call the SAME `AnomalyRulesService.create({ ... })`
        function with the same input shape
    And the service-layer is the only place that holds business logic + DB writes
    And the existing tRPC procedure (if any) ALSO delegates to the same service
        (no business logic duplicated between Hono and tRPC)

  @bdd @governance-api @service-layer @repository-pattern
  Scenario: Service layer uses repositories for persistence
    Given an `AnomalyRulesService.create({ name, ruleSpec, organizationId })`
    Then the service calls `AnomalyRulesRepository.insert({ ... })` for the DB write
    And the repository is the only layer that touches `prisma.anomalyRule.*`
    And the service NEVER directly imports `prisma`
    # Mirrors the existing pattern in IngestionTemplate / UserIngestionBinding
    # services from this PR (Lane-S 60ae9847a + 3f7f25104).

  # ---------------------------------------------------------------------------
  # OpenAPI spec generation + SDK regen
  # ---------------------------------------------------------------------------

  @bdd @governance-api @openapi
  Scenario: Hono routes auto-emit an OpenAPI spec consumed by SDK regen
    Given the Hono governance routes are mounted
    Then a build step generates `openapi/governance.json` from the route
        definitions (request/response Zod schemas, RBAC scopes, examples)
    And the spec includes every governance resource × verb combination
    And the spec is checked into the repo so reviewers can diff it across PRs

  @bdd @governance-api @openapi @sdk-regen
  Scenario Outline: Both <language> SDKs regenerate from the OpenAPI spec
    When the build runs `pnpm sdk:regen --target <language>`
    Then the SDK's governance namespace gains methods for every resource × verb
    And type signatures match the OpenAPI Zod-derived schemas exactly
    And the regen is idempotent (no churn when nothing changed)

    Examples:
      | language    |
      | typescript  |
      | python      |

  # ---------------------------------------------------------------------------
  # CLI namespace shape
  # ---------------------------------------------------------------------------

  @bdd @governance-cli @prefix
  Scenario: Every governance CLI verb sits under `langwatch governance`
    When the user runs `langwatch governance --help`
    Then the help output lists every governance resource as a sub-command
        (anomaly-rules, gateway-budgets, ingestion-sources, …)
    And each sub-command's `--help` lists the CRUD verbs
    And there is NO `langwatch <resource>` shortcut at the top level for governance
        resources (everything is namespaced under `governance`)

  @bdd @governance-cli @output-format
  Scenario: CLI commands support both human + JSON output
    When the user runs `langwatch governance anomaly-rules list`
    Then the default output is a human-readable table
    But `--output json` produces newline-delimited JSON suitable for piping
        through `jq` (one row per record on `list`, single object on `get`)

  @bdd @governance-cli @auth
  Scenario: CLI uses the same apiKey resolution as other commands
    Given the user has signed in via `langwatch login` and has a session at
        ~/.langwatch/sessions/<endpoint>.json
    When they run `langwatch governance virtual-keys list`
    Then the command authenticates with the session's apiKey
        (same path as `langwatch projects list`)
    And the apiKey's RBAC scopes determine which records are returned
        (per-record filter at the service layer, not at the CLI layer)

  # ---------------------------------------------------------------------------
  # MCP tool surface
  # ---------------------------------------------------------------------------

  @bdd @governance-mcp @namespace
  Scenario: MCP tools live under the `governance` namespace
    When the MCP client lists tools
    Then every governance tool's name starts with "governance_"
        (e.g. `governance_anomaly_rules_create`,
              `governance_ingestion_sources_list`)
    And the tool description summarizes the verb + resource + RBAC scope
    And the tool input schema is the same Zod schema used by the Hono route

  @bdd @governance-mcp @rbac
  Scenario: MCP tool calls enforce the apiKey's RBAC scope
    Given the MCP client connects with ben's apiKey (scope `governance:read` only)
    When the agent calls `governance_anomaly_rules_create`
    Then the tool returns an error
        `{ code: "FORBIDDEN", message: "apiKey scope governance:read does not include anomaly-rules:manage" }`
    And no record is created
    And no audit row is emitted (failed calls are not state-changes)

  @bdd @governance-mcp @agent-end-to-end @dogfood-gate
  Scenario: An agent can fully set up governance via MCP (admin happy path)
    Given an agent connects with carol's apiKey (scope `governance:*`)
    When the agent calls a sequence of MCP tools to:
      1. governance_ingestion_templates_list (read existing platform templates)
      2. governance_ingestion_templates_create (fork claude_code into org)
      3. governance_anomaly_rules_create (rule on org spend > $100/day)
      4. governance_role_bindings_assign_to_user (give ben governance:view)
      5. governance_audit_log_query (verify steps 2-4 emitted audit rows)
    Then every step succeeds with the appropriate side-effect
    And every state-change step emits the matching audit row visible in step 5
    # Real-user dogfood gate — the test that proves the MCP surface is
    # genuinely agentic-usable. Mirrors the dogfood discipline from
    # IngestionTemplate v1 (langwatch/ee/governance/ingestion-templates/<slug>/dogfood.md).

  # ---------------------------------------------------------------------------
  # RBAC enforcement uniformity
  # ---------------------------------------------------------------------------

  @bdd @governance-api @rbac-uniform
  Scenario Outline: All three surfaces enforce the same RBAC scopes
    Given a user with apiKey scope "<scope>"
    When they invoke "<verb>" on resource "<resource>" via "<surface>"
    Then the response is "<outcome>"

    Examples:
      | scope                    | verb   | resource         | surface | outcome      |
      | anomaly-rules:view       | list   | anomaly-rules    | hono    | 200 + records |
      | anomaly-rules:view       | list   | anomaly-rules    | cli     | 0 + table     |
      | anomaly-rules:view       | list   | anomaly-rules    | mcp     | success       |
      | anomaly-rules:view       | create | anomaly-rules    | hono    | 403 FORBIDDEN |
      | anomaly-rules:view       | create | anomaly-rules    | cli     | non-zero exit |
      | anomaly-rules:view       | create | anomaly-rules    | mcp     | FORBIDDEN error |

  # ---------------------------------------------------------------------------
  # Audit emission uniformity
  # ---------------------------------------------------------------------------

  @bdd @governance-api @audit-uniform
  Scenario: State-changing calls emit audit rows regardless of surface
    Given carol creates an AnomalyRule via Hono POST /api/governance/anomaly-rules
    Then an audit row `gateway.anomaly_rule.created` is emitted with
        `actorUserId=carol.id`, `apiKeyId=carol.apiKey.id`, `surface="hono"`
    When she creates another via `langwatch governance anomaly-rules create`
    Then another audit row is emitted with `surface="cli"`
    When an agent creates a third via MCP `governance_anomaly_rules_create`
    Then another audit row is emitted with `surface="mcp"`
    And ALL THREE rows have IDENTICAL payload shapes apart from the `surface` field
    # Surface attribution helps incident response (which automation made
    # this change?) without changing the audit-row event-kind taxonomy.

  # ---------------------------------------------------------------------------
  # Cross-path uniformity invariants
  # ---------------------------------------------------------------------------

  @bdd @governance-api @no-bypass
  Scenario: There is NO governance state-change path that bypasses the service layer
    When the codebase is grepped for direct prisma calls on governance models
    Then no UI page, route handler, CLI command, or MCP tool calls
        `prisma.anomalyRule.*` / `prisma.virtualKey.*` / `prisma.ingestionTemplate.*`
        / etc directly
    And every write goes through the corresponding service-layer function
    # Locks the architectural invariant — no future "quick fix" can re-
    # introduce duplication or skip RBAC by going around the service layer.

  @bdd @governance-api @tenancy-preserved
  Scenario: TenantId boundaries are preserved across all three surfaces
    When any verb is invoked on any surface
    Then the service-layer function receives `{ ...input, organizationId, ...projectId? }`
        from the surface
    And the repository's WHERE clause includes `organizationId` (or `projectId`)
    And the database multitenancy middleware (dbOrganizationIdProtection +
        dbMultiTenancyProtection) blocks any query that omits the tenant key
    # The new surfaces do NOT relax the tenant boundary; they call the
    # same services, which call the same repositories, which honor the
    # same middleware. Per architecture-invariants.feature.
