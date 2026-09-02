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

  # The cacheRule.service unit test mocks auditLog.create but does
  # not assert action="gateway.cache_rule.created" on the call args
  # (unlike the provider-binding test). Cheap to add but currently
  # unbound — leaving @unimplemented.
  @integration @unimplemented
  Scenario: Cache rule mutation writes targetKind=cache_rule
    When alice creates a cache rule "long-context-anthropic" matching anthropic models
    Then an AuditLog row is written with action "gateway.cache_rule.created" and targetKind "cache_rule"

  # ──────────────────────────────────────────────────────────────────────────
  # Read path — /settings/audit-log shows merged stream
  # ──────────────────────────────────────────────────────────────────────────
  #
  # The page is `@langwatch/organization-web`'s `audit-log.screen.tsx`, and
  # since the settings S7 move it has a render suite: the scenarios below
  # without `@unimplemented` are bound there. The ones that keep the tag need a
  # seeded multi-row history the screen suite does not build.

  @integration
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

  @integration
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

  # VK detail page revoked-state rendering — covered by the source
  # but not by a JSDOM render test yet.
  @integration @unimplemented
  Scenario: Audit history button stays reachable for revoked VKs
    Given Virtual Key "prod-key" has status "revoked"
    When alice opens the VK detail page
    Then Edit / Rotate / Revoke buttons are hidden
    But the "Audit history" button is still visible and links to `/settings/audit-log?targetKind=virtual_key&targetId=<vk_id>`

  @integration
  Scenario: A deep-linked reader is offered the way back to the resource
    Given alice opened `/settings/audit-log?targetKind=virtual_key&targetId=<vk_id>`
    Then a link back to that virtual key appears above the heading
    But a target kind with no detail route of its own offers no link at all,
      because a link that 404s reads as the resource having been deleted

  @integration
  Scenario: A row written by a system actor says so rather than naming nobody
    Given a row whose userId is null, written by a background job
    Then the User column reads "User not found" rather than rendering empty

  @integration
  Scenario: An empty audit history says so
    Given the organization has no audit rows in the selected window
    Then the page says no audit logs were found, rather than showing a headerless table

  @integration
  Scenario: A deployment below the plan is told what the audit trail would show
    Given the organization is not on an Enterprise plan
    When alice opens `/settings/audit-log`
    Then she is told what organisation-wide audit logs cover and how to obtain them
    And no table is rendered at all

  @integration
  Scenario: Only an organization administrator may open the audit trail
    Given bob holds "organization:view" and not "organization:manage"
    When he opens `/settings/audit-log`
    Then he is refused, and told which grant the page needs
    And the refusal is framed in the settings chrome he navigated into

  # ──────────────────────────────────────────────────────────────────────────
  # Filtering and paging — all of it in the address, because a compliance
  # reviewer's workflow is sending somebody else the view they are looking at
  # ──────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: The audit table opens on the last thirty days
    Given the address carries no window
    Then the table reads the last thirty days
    And an unrecognised `?period=` falls back to the same window rather than
      asking for one nobody defined

  @unit
  Scenario: A picked range is carried in the address
    When alice picks a range from the date control
    Then the address names it and returns the table to its first page
    And any absolute start/end pair already in the address is dropped, because
      the reading prefers the pair and the picker would look like it did nothing

  @unit
  Scenario: The range control names the window it is applying
    Given the window matches one of the offered ranges
    Then the control names that range rather than two dates

  @unit
  Scenario: The audit table pages by offsets carried in the address
    Given the address carries no paging
    Then the table shows the first page of twenty-five
    And a hand-edited negative offset lands on the first page rather than failing

  @unit
  Scenario: Changing a filter returns the table to its first page
    When alice changes any filter, or the page size
    Then the offset returns to zero, because page four of the old filter is not
      page four of the new one

  @integration
  Scenario: The user search resolves a typed name or address to one actor
    Given alice types part of a member's name or email address
    Then the read is filtered by that member's user id, not by the typed string
    And a search matching nobody applies no user filter rather than filtering to nobody

  # ──────────────────────────────────────────────────────────────────────────
  # Export — a report taken over anything wider than the view on screen is a
  # disclosure dressed up as a convenience
  # ──────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: An export is taken over exactly the filters on screen
    Given alice is looking at a view pre-filtered by a deep-link
    When she exports it
    Then the export asks for the same filters the table is reading with

  @unit
  Scenario: An export walks the whole filtered history, not just the first batch
    Given the filtered history is longer than one batch
    When alice exports it
    Then every batch after the first is asked for
    And a history of exactly one batch asks for no second, empty one

  @integration
  Scenario: An exported report carries the same columns the table shows
    Then the report carries Source, Target and the before/after diffs alongside
      the actor, the action and the project
    And the file is named for the day it was taken

  @unit
  Scenario: An exported report names a system-written row without inventing an actor
    Given a row with no user
    Then the actor columns are empty rather than filled with a placeholder
    And a row whose project could not be resolved falls back to the project id

  @unit
  Scenario: An exported report caps its JSON columns and says when it did
    Given a diff longer than the per-cell cap
    Then the cell is clipped and carries an explicit truncation marker
    And a clipped cell is therefore distinguishable from an empty one

  @integration
  Scenario: An exported report reaches the reader as a named file
    When the report is ready
    Then the browser saves it under the name the page chose
    And the object URL it was built from is released afterwards, never before

  @integration
  Scenario: An export that fails tells the reader rather than the console
    Given the export request fails
    Then alice is told the audit log could not be exported
    And no file is handed over

  # ──────────────────────────────────────────────────────────────────────────
  # Sunset of /[project]/gateway/audit
  # ──────────────────────────────────────────────────────────────────────────
  #
  # The two scenarios below describe navigation/routing assertions
  # (404 for the old route + nav menu absence). The route is gone
  # from the codebase and the menu entry is removed, but no
  # automated nav/routing test exists for either today.

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
  #
  # The two cross-org / cross-project boundary scenarios below
  # would need a multi-org seed inside the `auditLog.consolidation`
  # integration test (or a dedicated multitenancy test). The
  # underlying enforcement is in `getAuditLogs()` (org fence + project
  # filter) and lives behind the existing RBAC tests
  # (`rbac.auditLog.test.ts`, `rbac-integration.test.ts`), but the
  # specific "no leakage" assertion is unbound today.

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
