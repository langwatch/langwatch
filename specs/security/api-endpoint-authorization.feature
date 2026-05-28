Feature: Hono API endpoint authorization and tenant isolation
  As the LangWatch platform
  I need every HTTP API endpoint (the Hono routes used by SDKs, the CLI, the MCP
  server, and our own frontend) to declare and enforce an explicit access policy
  So that no caller can reach a resource without the right RBAC permission, and no
  caller can ever read or mutate data belonging to another organization or project.

  Background:
    The Hono API is the external/HTTP surface (distinct from tRPC, which the
    frontend uses with compile-time-checked permission middleware). Historically a
    Hono route enforced RBAC only if a developer remembered to chain
    requirePermission("resource:action") into the handler list — a positional,
    forgettable middleware with no compile-time or CI guarantee. This feature makes
    the access decision a mandatory, declared property of every route (the
    SecuredApp builder) and proves it with tests.

    Three credential families reach these endpoints:
      - project API keys / legacy project keys (SDKs, MCP) — project scope
      - organization API keys (admin tooling, project provisioning) — org scope
      - browser session cookies (our own frontend, e.g. experiment execution) — user scope
    Service-to-service routes (collector, otel, cron, gateway-internal, webhooks)
    authenticate with a shared secret or signature rather than RBAC.

  # ============================================================================
  Rule: Every mounted route declares an explicit access policy

    A route is registered through the secured app builder, whose verb methods are
    only reachable via `.access(policy)`. The policy is one of:
      requires(permission) | anyAuthenticated() | publicEndpoint(reason) | internalSecret(reason)
    Omitting it is a TypeScript error. Bypassing the builder is caught by a CI test
    that introspects the fully composed router against the route registry plus an
    explicit, documented legacy allowlist.

    @unit
    Scenario: Registering a route without an access policy is a type error
      Given the secured app builder
      When a developer tries to register a verb route without calling access(policy) first
      Then the verb method does not exist on the bare app and the code fails to compile

    @integration
    Scenario: The composed router has no route without a registered policy
      Given the fully composed API router from createApiRouter
      When every mounted method and path is enumerated
      Then each one is registered through SecuredApp or listed in the documented legacy allowlist
      And any route that bypassed the builder fails this assertion

    @integration
    Scenario: A public or internal route declares a documented reason
      Given the route registry
      When a route's policy is publicEndpoint or internalSecret
      Then it carries a non-empty human-readable reason

  # ============================================================================
  Rule: A caller without the route's permission is forbidden

    @integration
    Scenario: A project API key lacking the required permission is forbidden
      Given a project API key whose role grants only "traces:view"
      When I call a route that requires a different permission
      Then the response status is 403

    @integration
    Scenario: A read-only key cannot perform a write action
      Given a project API key restricted to read-only permissions
      When I call a mutating endpoint that requires a write permission
      Then the response status is 403

    @integration
    Scenario: An authorized key passes the permission gate
      Given a project API key whose role grants the required permission
      When I call the route
      Then the request is not rejected with 401 or 403

  # ============================================================================
  Rule: A credential for one tenant cannot reach another tenant's data

    @integration
    Scenario: A key for one organization cannot resolve another organization's project
      Given a project API key issued for organization B
      When I use it with the project id of organization A
      Then the response status is 401 and no data is returned

    @integration
    Scenario: A resource id from the body is verified against the authenticated tenant
      Given an endpoint that accepts a run id in its JSON body
      When the run belongs to a different project than the caller's credential
      Then the request is rejected with 404 before the run is acted upon

  # ============================================================================
  Rule: Internal/service routes authenticate with a shared secret, fail-closed

    @unit
    Scenario: An unset internal secret denies all callers
      Given the internal shared secret is not configured
      When a credential-less request hits an internal route
      Then the request is denied

    @integration
    Scenario: A destructive cron route rejects callers without the secret
      Given the internal shared secret is configured
      When the retention-cleanup cron route is called with no Authorization header
      Then the response status is 401

    @integration
    Scenario: Worker and ops trigger endpoints reject callers without the secret
      Given the internal shared secret is configured
      When the worker/ops trigger endpoints are called with no Authorization header
      Then the response status is 401

  # ============================================================================
  Rule: A budget cannot be scoped to another organization's resource

    @unit
    Scenario: A team or project budget scoped to another organization is rejected
      Given a budget create request scoped to a team or project outside the caller's organization
      When the budget service processes it
      Then it rejects the request with a clear error and creates no budget
