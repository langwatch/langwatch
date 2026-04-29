Feature: Unified Audit Log
  As an admin or compliance reviewer
  I want a single, project-and-org-scoped audit log surfacing every governance event
  So that I can investigate any change — gateway-driven or platform-driven — without hopping between pages

  Background:
    Gateway resources (Virtual Keys, Budgets, Provider Bindings, Cache Rules) and
    platform resources (project settings, evaluator runs, role bindings, …) all
    write to a single `AuditLog` table and surface in `/settings/audit-log`.
    There is no separate `GatewayAuditLog` table.

    Each row carries:
      * `userId`            — actor user (nullable for system actions)
      * `organizationId`    — for org-scoped queries / RBAC fence
      * `projectId`         — for project-scoped queries (nullable for org-level events)
      * `action`            — dotted-lowercase string code, e.g. "gateway.virtual_key.created" (gateway shape) or "project.invitation.sent" / "organization.member.add" (platform shape). Gateway codes share the `gateway.` prefix so a single `LIKE 'gateway.%'` clause filters the full gateway surface.
      * `targetKind`        — string, e.g. "virtual_key" / "budget" / "cache_rule" / "provider_binding" / null
      * `targetId`          — string, the affected resource id (nullable)
      * `before` / `after`  — JSON snapshots for governance diffs (nullable for non-governance events)
      * `args`              — legacy free-form JSON kept for non-governance call sites
      * `metadata`          — legacy free-form JSON kept for non-governance call sites
      * `createdAt`         — write-time timestamp

  # ──────────────────────────────────────────────────────────────────────────
  # Gateway-side write path — all 4 gateway services route to AuditLog
  # ──────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Virtual Key creation writes a unified AuditLog row
    Given organization "acme" exists with project "demo"
    And user "alice" has "virtualKeys:create" permission on project "demo"
    When alice creates a Virtual Key named "prod-key" via the platform UI
    Then exactly one AuditLog row is written
    And the row has:
      | field          | value                          |
      | action         | gateway.virtual_key.created    |
      | targetKind     | virtual_key                    |
      | userId         | <alice id>                     |
      | organizationId | <acme org id>                  |
      | projectId      | <demo project id>              |
      | before         | null                           |
    And the `after` JSON includes the VK display prefix, scope, status
    And no row is written to `GatewayAuditLog` (table no longer exists)

  @integration @unimplemented
  Scenario: Virtual Key update captures before/after diff
    Given Virtual Key "prod-key" with status "active" and rate-limit "100/m"
    When alice changes the rate-limit to "500/m"
    Then a single AuditLog row is written with action "gateway.virtual_key.updated"
    And `before.rateLimit` equals "100/m"
    And `after.rateLimit` equals "500/m"

  @integration @unimplemented
  Scenario: Budget mutation writes targetKind=budget
    Given budget "demo-month" of $500/MONTH on project "demo"
    When alice updates the limit to $1000
    Then an AuditLog row is written with action "gateway.budget.updated" and targetKind "budget"
    And `before.limitUsd` is "500" and `after.limitUsd` is "1000"

  @integration @unimplemented
  Scenario: Provider binding mutation writes targetKind=provider_binding
    When alice attaches an OpenAI provider binding to Virtual Key "prod-key"
    Then an AuditLog row is written with action "gateway.provider_binding.created" and targetKind "provider_binding"

  @integration @unimplemented
  Scenario: Cache rule mutation writes targetKind=cache_rule
    When alice creates a cache rule "long-context-anthropic" matching anthropic models
    Then an AuditLog row is written with action "gateway.cache_rule.created" and targetKind "cache_rule"

  # ──────────────────────────────────────────────────────────────────────────
  # Read path — /settings/audit-log shows merged stream
  # ──────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Settings audit page lists gateway and platform events together
    Given organization "acme" has these audit rows in order:
      | created_at  | action                       | targetKind   | source   |
      | 09:00       | project.invitation.sent      | null         | platform |
      | 09:30       | gateway.virtual_key.created  | virtual_key  | gateway  |
      | 10:00       | gateway.budget.updated       | budget       | gateway  |
    When alice visits `/settings/audit-log`
    Then the table renders all 3 rows in DESC order by created_at
    And each row shows a Source badge: gateway = purple, platform = grey
    And the gateway rows show a Target column with the targetKind + truncated targetId
    And the platform row shows an em-dash in the Target column

  @integration @unimplemented
  Scenario: Filter by target kind narrows to gateway events only
    Given a mixed audit history of platform + gateway rows
    When alice selects "Target = virtual_key" in the filter
    Then only rows with targetKind = "virtual_key" are returned
    And no platform rows appear (platform rows have null targetKind)

  @integration @unimplemented
  Scenario: Deep-link from VK detail page lands pre-filtered
    Given Virtual Key "prod-key" has 4 audit entries (created/updated/rotated/revoked)
    When alice opens the VK detail page and clicks "Audit history"
    Then she navigates to `/settings/audit-log?targetKind=virtual_key&targetId=<vk_id>`
    And the page shows only the 4 entries for that VK
    And a clearable chip "target = vk_…" appears at the top
    And clicking × on the chip clears the filter and shows the full history

  @integration @unimplemented
  Scenario: Deep-link from Budget detail page lands pre-filtered
    Given budget "demo-month" has 2 audit entries (created/updated)
    When alice opens the budget detail page and clicks "Audit history"
    Then she navigates to `/settings/audit-log?targetKind=budget&targetId=<budget_id>`
    And the page shows only those 2 entries

  @integration @unimplemented
  Scenario: Audit history button stays reachable for revoked VKs
    Given Virtual Key "prod-key" has status "revoked"
    When alice opens the VK detail page
    Then Edit / Rotate / Revoke buttons are hidden
    But the "Audit history" button is still visible and links to `/settings/audit-log?targetKind=virtual_key&targetId=<vk_id>`

  # ──────────────────────────────────────────────────────────────────────────
  # Sunset of /[project]/gateway/audit
  # ──────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Old /[project]/gateway/audit route no longer exists
    When alice navigates to `/<project-slug>/gateway/audit`
    Then she sees the platform's 404 page (route is unregistered)

  @integration @unimplemented
  Scenario: AI Gateway sub-nav has no "Audit log" entry
    When alice expands the AI Gateway menu group
    Then the entries are: Virtual Keys, Providers, Budgets, Cache rules, Usage
    And there is no "Audit log" entry under the gateway menu

  @integration @unimplemented
  Scenario: Settings → Audit log surfaces all gateway events
    Given the gateway code has been migrated to write `AuditLog` directly
    When alice visits `/settings/audit-log` after creating, updating, and revoking VKs
    Then all VK events appear with Source badge = "gateway"
    And the Source filter chip can isolate gateway-only or platform-only views

  # ──────────────────────────────────────────────────────────────────────────
  # Schema migration
  # ──────────────────────────────────────────────────────────────────────────

  @migration
  Scenario: Migration drops GatewayAuditLog cleanly
    Given the previous schema had `GatewayAuditLog` and `GatewayAuditAction` enum
    When the migration runs against a database with rows in `GatewayAuditLog`
    Then `GatewayAuditLog` table no longer exists
    And `GatewayAuditAction` enum no longer exists in postgres
    And rchaves greenlit "no records to preserve, no beta users yet"

  @migration
  Scenario: AuditLog gains target + diff columns
    When the migration runs
    Then `AuditLog` has new columns: `targetKind String?`, `targetId String?`, `before Jsonb?`, `after Jsonb?`
    And `userId` is changed to `String?` (nullable) so system actions can write rows without a user
    And new index `(organizationId, createdAt)` exists for org-scoped tail queries
    And new index `(targetKind, targetId)` exists for resource-history queries

  # ──────────────────────────────────────────────────────────────────────────
  # Multitenancy & RBAC
  # ──────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Audit log respects org/project boundaries
    Given alice is in organization "acme" only
    When she queries `/settings/audit-log` while another org "bravo" has audit rows
    Then she only sees rows where organizationId = "acme"
    And no "bravo" rows leak into the response

  @integration @unimplemented
  Scenario: Project-scoped audit rows respect project access
    Given alice has access to project "demo" but not "secret-project" within the same org
    When she queries `/settings/audit-log` filtered by project
    Then she sees only "demo" rows (gateway and platform)
    And no rows from "secret-project" appear
