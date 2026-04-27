Feature: AI Gateway — RBAC legacy ADMIN fallback for org-scoped checks
  As a legacy LangWatch organization ADMIN who pre-dates the role-binding system
  I want gateway org-scoped pages to stay accessible when I have OrganizationUser+TeamUser ADMIN but zero RoleBinding rows
  So that upgrading to the AI Gateway doesn't silently revoke my access the day v1 ships

  # Regression coverage for finding #28 (sergey 1fdf9b160). The bug was that
  # `hasOrganizationPermission` in src/server/api/rbac.ts only consulted ORG-scoped
  # RoleBinding rows; legacy admins whose permissions come from OrganizationUser /
  # TeamUser ADMIN rows (the pre-RBAC world) got 401 on /gateway/audit (since
  # consolidated into /settings/audit-log), /gateway/budgets org-list,
  # /gateway/cache-rules. Fix: union TeamUser ADMIN roles in the org as a
  # fallback when ORG-scoped bindings are empty, but keep the strict org-admin
  # check for `organization:manage` (no escalation risk).

  Background:
    Given organization "acme" exists with team "platform" and project "gateway-demo"
    And a legacy user "alice@acme.test" has OrganizationUser role ADMIN on "acme"
    And "alice@acme.test" has TeamUser role ADMIN on "platform"
    And "alice@acme.test" has ZERO RoleBinding rows (legacy pre-RBAC migration state)

  # ============================================================================
  # Gateway org-scoped surfaces must work for legacy admins
  # ============================================================================

  @integration @unimplemented
  Scenario: Audit log listing page renders populated for legacy org ADMIN
    # Post-consolidation: gateway audit rows are visible at /settings/audit-log
    # alongside platform rows. Legacy org ADMINs reach the page via the same
    # TeamUser fallback path tested for /gateway/budgets and /gateway/cache-rules.
    When "alice@acme.test" visits "/settings/audit-log"
    Then the response status is 200
    And the audit-log table shows at least 1 row
    And the response does NOT redirect to "/auth/signin"

  @integration @unimplemented
  Scenario: Budget org-list includes the legacy admin's org budgets
    When "alice@acme.test" visits "/acme-demo-b4UwtJ/gateway/budgets"
    Then the response status is 200
    And the budget table includes rows scoped to organization "acme"
    And the user sees NO "unauthorized" empty-state

  @integration @unimplemented
  Scenario: Cache rule list is accessible from gateway nav
    When "alice@acme.test" visits "/acme-demo-b4UwtJ/gateway/cache-rules"
    Then the response status is 200
    And the cache-rule table renders all 3 seeded rules (force / respect / disable)

  # ============================================================================
  # organization:manage stays strictly org-admin-only (no escalation)
  # ============================================================================

  @unit @unimplemented
  Scenario: Legacy admin CANNOT perform organization:manage via TeamUser fallback
    When "alice@acme.test" attempts "organization:manage" on org "acme"
    Then the RBAC check returns false
    And the authorization decision log records "legacy fallback: skipped — organization:manage requires ORG-scoped binding"

  @unit @unimplemented
  Scenario: OrganizationUser ADMIN passes (legacy path for organization:manage)
    When "alice@acme.test" attempts "organization:manage" on org "acme" via OrganizationUser ADMIN
    Then the RBAC check returns true

  # ============================================================================
  # Non-gateway org-scoped permissions continue to use existing paths
  # ============================================================================

  @integration @unimplemented
  Scenario: auditLog:view still falls back to TeamUser where gateway permissions do
    Given "alice@acme.test" has TeamUser role MEMBER (not ADMIN) on "platform"
    And the org has a RoleBinding granting "auditLog:view" to the "platform" team
    When "alice@acme.test" attempts "auditLog:view" on org "acme"
    Then the RBAC check returns true via the explicit RoleBinding (not the TeamUser fallback)

  # ============================================================================
  # Observability — legacy-fallback uses should be trackable
  # ============================================================================

  @unit @unimplemented
  Scenario: Legacy-fallback usage emits a log line so operators can measure the tail
    When a legacy admin accesses a gateway org-scoped surface via the TeamUser fallback
    Then a structured log "rbac.legacy_teamuser_fallback_used" is written
    And the log includes organizationId, userId, permission, and requestId
    And the log is rate-limited to at most once per user per hour

  # ============================================================================
  # Migration plan (v1.1) — backfill RoleBindings for legacy admins
  # ============================================================================

  @out_of_scope @v1.1
  Scenario: Backfill job populates RoleBinding rows for all legacy ADMINs
    # v1.1 follow-up: a one-off migration walks OrganizationUser+TeamUser ADMIN
    # rows and emits equivalent RoleBinding rows, then the TeamUser fallback can
    # be deprecated (log-only) and eventually removed. Finding #28's fix is the
    # 'unblock v1 GA' remedy; this is the 'tidy up the legacy tail' remedy.
