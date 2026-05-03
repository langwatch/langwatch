Feature: AI Gateway — Enterprise license gate on governance backend
  As an Apache-2.0-floor product with Enterprise-tier governance features
  I want every governance read + write procedure to 403 on a non-enterprise plan
  So that the upsell card the UI renders (`<EnterpriseLockedSurface>`) is
  matched by an authoritative server-side denial — a non-enterprise org
  cannot read or write governance data even via direct tRPC calls / scripts

  Layered enforcement:
   1. **UI**: `<EnterpriseLockedSurface>` wraps the page, shows upsell.
   2. **tRPC router middleware**: `requireEnterprisePlan` 403s every
      anomaly-rules / activity-monitor / ingestion-sources / ocsf-export
      procedure regardless of how the call was initiated.
   3. **Service layer (defense-in-depth)**: `IngestionSourceService.createSource`
      asserts the plan up-front so non-tRPC callers (background workers,
      future webhook adapters, scripts) can't end-run the router.

  Apache-2.0 floor — these are intentionally NOT gated and must keep
  working for non-enterprise orgs:
   - `aiTools.*` (Phase 7 portal — works for everyone)
   - `governance.setupState` + `governance.resolveHome` (per-user nav helpers)
   - `routingPolicies.*` (gateway-side, Apache-2.0)

  Background:
    Given organization "acme" exists on a non-enterprise plan
    And alice is an org ADMIN of "acme" with every governance permission

  # ============================================================================
  # tRPC router gate — every gated procedure
  # ============================================================================

  @bdd @phase-4b @license-gate @router
  Scenario Outline: Non-enterprise org gets FORBIDDEN on every gated read
    When alice calls `<router>.<procedure>({ organizationId: "acme", ... })`
    Then the response is FORBIDDEN
    And the message includes the feature name from `ENTERPRISE_FEATURE_ERRORS`

    Examples:
      | router          | procedure              |
      | anomalyRules    | list                   |
      | anomalyRules    | get                    |
      | activityMonitor | summary                |
      | activityMonitor | spendByUser            |
      | activityMonitor | ingestionSourcesHealth |
      | activityMonitor | recentAnomalies        |
      | activityMonitor | eventsForSource        |
      | activityMonitor | sourceHealthMetrics    |
      | ingestionSources| list                   |
      | ingestionSources| get                    |
      | governance      | ocsfExport             |

  @bdd @phase-4b @license-gate @router
  Scenario Outline: Non-enterprise org gets FORBIDDEN on every gated write
    When alice calls `<router>.<procedure>({ organizationId: "acme", ... })`
    Then the response is FORBIDDEN
    And no row is created or modified

    Examples:
      | router          | procedure       |
      | anomalyRules    | create          |
      | anomalyRules    | update          |
      | anomalyRules    | archive         |
      | ingestionSources| create          |
      | ingestionSources| update          |
      | ingestionSources| rotateSecret    |
      | ingestionSources| archive         |

  # ============================================================================
  # Order of denial — RBAC (UNAUTHORIZED) trumps license (FORBIDDEN)
  # ============================================================================

  @bdd @phase-4b @license-gate @order
  Scenario: A MEMBER on a non-enterprise org gets UNAUTHORIZED, not FORBIDDEN
    Given bob is an org MEMBER of "acme" (no governance:* permission)
    When bob calls `anomalyRules.list({ organizationId: "acme" })`
    Then the response is UNAUTHORIZED
    And the message mentions the missing permission, not the missing plan
    # The middleware order in router files is checkOrganizationPermission
    # FIRST, requireEnterprisePlan SECOND. So RBAC denial fires first;
    # license check never runs for unauthorised callers.

  @bdd @phase-4b @license-gate @order
  Scenario: An ADMIN on an enterprise org passes both gates
    Given carol is an org ADMIN of "carol-enterprise-org" on the Enterprise plan
    When carol calls `anomalyRules.list({ organizationId: "carol-enterprise-org" })`
    Then the response is OK
    And the result contains the org's anomaly rules (possibly empty)

  # ============================================================================
  # Service-layer defense-in-depth (IngestionSourceService.createSource)
  # ============================================================================

  @bdd @phase-4b @license-gate @service-layer
  Scenario: Non-tRPC caller of IngestionSourceService.createSource is rejected
    Given a non-tRPC caller (background worker, script, or follow-up webhook
      adapter) attempts `IngestionSourceService.create(prisma).createSource({
        organizationId: "acme", sourceType: "otel_generic", name: "x", actorUserId: "alice" })`
    When the org is on a non-enterprise plan
    Then the call throws TRPCError FORBIDDEN
    And no IngestionSource row is created
    And no hidden Governance Project is created either
    # Because the gate fires BEFORE ensureHiddenGovernanceProject.

  @bdd @phase-4b @license-gate @service-layer
  Scenario: Service-layer gate doesn't double-fail tRPC callers
    Given the tRPC `ingestionSources.create` procedure is called on an
      enterprise org (passes router middleware)
    When the procedure body calls `IngestionSourceService.createSource`
    Then the service-layer assertEnterprisePlan call also passes
    And the IngestionSource is created normally
    # The double-check is cheap (one planProvider.getActivePlan call) and
    # the Apache-2.0 floor stays clear: the planProvider is the single
    # source of truth.
