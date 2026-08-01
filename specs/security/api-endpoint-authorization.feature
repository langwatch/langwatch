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
      requires(permission) | apiKeyPermission(permission) | anyAuthenticated() | publicEndpoint(reason) | internalSecret(reason) | handlerManagedAuth(reason)
    Omitting it is a TypeScript error. Bypassing the builder is caught by a CI test
    that introspects the fully composed router against the route registry. Every
    family is migrated, so there is no allowlist: every concrete endpoint must
    declare a policy.

    @unit
    Scenario: Registering a route without an access policy is a type error
      Given the secured app builder
      When a developer tries to register a verb route without calling access(policy) first
      Then the verb method does not exist on the bare app and the code fails to compile

    @integration
    Scenario: The composed router has no route without a registered policy
      Given the fully composed API router from createApiRouter
      When every mounted concrete-method endpoint is enumerated
      Then each one is registered through SecuredApp with a declared policy
      And any route that bypassed the builder fails this assertion

    @integration
    Scenario: A public or internal route declares a documented reason
      Given the route registry
      When a route's policy is publicEndpoint, internalSecret, or handlerManagedAuth
      Then it carries a non-empty human-readable reason

    @unit
    Scenario: An API-key-ceiling route records its real required permission
      Given a public REST route guarded by the API-key ceiling
      When it is registered with apiKeyPermission instead of anyAuthenticated
      Then the route registry records the real permission, not "any authenticated"

    @unit
    Scenario: An any-method route enforces its policy on every method
      Given a route registered with .all and an internalSecret policy
      When the route is called with GET, POST, or DELETE
      Then the policy chain runs before the handler for each method

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
  Rule: A route asks for the grain of the action it performs

    The permission hierarchy resolves create, update and delete out of manage,
    but never the other way round. A write route that asked for manage therefore
    refused every credential the product issues at a finer grain: a key scoped to
    "read and write scenarios" was declined a create it plainly held, and an
    assistant that could read everything could write nothing.

    So a write route asks for what it does. A create asks to create. An update
    asks to update. A RUN asks to create, because it produces a run and leaves
    the definition it ran untouched — running a suite is not administering it.
    Destruction stays at manage, the only grain that carries it, so a
    read-and-write credential never inherits the power to delete.

    Nobody loses access when a route moves to a finer grain: manage still implies
    it. Nobody gains access either, except a principal an administrator
    deliberately granted that finer permission.

    @integration
    Scenario: Every route still admits the roles that could already reach it
      Given the declared permission of every registered route
      When a principal holding that resource's manage permission is checked against each
      Then every route admits them

    @integration
    Scenario: A read-only role gains no write from a finer grain
      Given the declared permission of every registered route that is not a read
      When a project viewer is checked against each
      Then none of them admit the viewer

    @integration
    Scenario: Every declared permission is reachable by a built-in role
      Given the declared permission of every registered route
      When each is checked against the built-in administrator roles
      Then one of them grants it, so no route is unreachable by design

    @integration
    Scenario: Running a scenario suite does not require administering it
      Given a credential that may read and write scenarios but not administer them
      When it is checked against the suite run route
      Then it is admitted
      And it is still refused the route that archives the suite

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

    @integration
    Scenario: A model-defaults config with no scope attachments is treated as not found
      Given a model-defaults config id that resolves to no scope attachments
      When an authenticated caller tries to update or delete it
      Then the response status is 404 and the per-scope write check never runs

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
      When the old-lambdas-cleanup cron route is called with no Authorization header
      Then the response status is 401

  # ============================================================================
  Rule: A budget cannot be scoped to another organization's resource

    @unit
    Scenario: A team or project budget scoped to another organization is rejected
      Given a budget create request scoped to a team or project outside the caller's organization
      When the budget service processes it
      Then it rejects the request with a clear error and creates no budget

  # ============================================================================
  Rule: Experiments are authorized by their own permission, not workflows

    Experiments historically inherited workflows:view because they lived under
    the optimization studio. They now have a dedicated experiments:view /
    experiments:manage permission so a role can read or run experiments on
    prompts and agents without holding any workflow permission.

    @unit
    Scenario: Experiments use a dedicated permission decoupled from workflows
      Given the built-in team roles
      Then every role that can view workflows also has experiments:view
      And only roles that can manage workflows have experiments:manage

  # ============================================================================
  Rule: Product-managed credentials are not the customer's to read or change

    Some credentials are provisioned and retired by the product rather than by
    a human: the Langy virtual key, its stored secret, and the ephemeral
    per-chat Langy session API key. The settings UI badged and locked them, but
    that is presentation — the API is the boundary. Rotating a Langy virtual
    key was the sharp edge: it returns a fresh plaintext secret AND breaks
    Langy, because the gateway keeps authenticating against the secret Langy
    still holds. Denials report not-found rather than forbidden, so a response
    never confirms the credential exists.

    @unit
    Scenario: Product-managed virtual keys are absent from customer listings
      Given a project whose organization has an auto-provisioned Langy virtual key
      When a member lists the organization's virtual keys
      Then the Langy virtual key is not among them

    @unit
    Scenario Outline: Product-managed virtual keys refuse customer mutations
      Given a member holding the id of the auto-provisioned Langy virtual key
      When they call <operation> on it
      Then the request is rejected as not found
      And the key is left untouched

      Examples:
        | operation |
        | update    |
        | rotate    |
        | revoke    |

    @unit
    Scenario: The ephemeral Langy session key cannot be renamed or revoked
      Given a member holding the id of a live Langy session API key
      When they try to rename or revoke it
      Then the request is rejected as not found
      And the turn authenticating with that key keeps working

    @unit
    Scenario: The stored Langy virtual-key secret is hidden and immutable
      Given a project with an auto-provisioned Langy virtual key
      When a member lists the project's secrets
      Then the Langy virtual-key secret is not among them
      And deleting or overwriting it by id is rejected as not found

  # ============================================================================
  Rule: Running Langy is a write, not a read

    Langy used to hang off `evaluations:view`, so a read-only viewer could
    start a turn — which provisions credentials, spawns an OpenCode worker and
    spends the project's model budget. It now has its own permission family:
    view to read conversations, create to start or continue a turn, update to
    rename, delete to archive. Manage is org-tier as well, where it gates the
    GitHub App connection that grants Langy repository access for every project
    underneath.

    Granted from MEMBER upward and to org admins; below that, nothing. The
    permission grain is not what keeps Langy scarce — the rollout flag is — so
    it draws the line at "can this person act on the project at all".

    @unit
    Scenario: Below member, Langy is not granted at all
      Given a project VIEWER
      Then they hold no Langy permission
      And the Langy panel does not render for them

    @unit
    Scenario: A member can run Langy but cannot administer it
      Given a project MEMBER
      Then they may start a turn, rename, and archive
      But they may not administer Langy

    @unit
    Scenario: Connecting the organization's GitHub App is admin-only
      Given an organization member who is not an admin
      When they try to read or change the organization's Langy GitHub connection
      Then the request is refused
      And the Langy rollout flag is never evaluated for that organization

    @unit
    Scenario: The demo project refuses Langy on every surface
      Given any authenticated user on the demo project
      When they read the Langy egress allow-list or open the panel
      Then the request is refused
