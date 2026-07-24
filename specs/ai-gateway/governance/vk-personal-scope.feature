Feature: AI Gateway — Personal Virtual Keys (principalUserId orthogonality)

  A "personal VK" is a regular `VirtualKey` row with `principalUserId`
  set. The `principalUserId` column is orthogonal to scope — a personal
  VK has the same multi-scope semantics as any other VK (see
  vk-scope-inheritance.feature). The principal column is a "who owns
  this" / "who is billed" / "who is audited" marker, not a routing
  scope.

  Why orthogonal: the storage model collapses the legacy "personal
  project" hack. Previously a personal VK was bound to a synthetic
  personal Project. Now there is no personal Project — the VK lives at
  whatever scope it makes sense for (typically ORGANIZATION for the
  device-flow lazy-mint path) and the principalUserId attribution is
  carried as a separate column.

  Background:
    Given organization "acme"
    And organization "acme" has team "platform" with project "demo"
    And user "leo@acme.test" is a member of organization "acme"

  # ============================================================================
  # Lazy-mint via CLI device-flow
  # ============================================================================

  Scenario: First-time `langwatch login --device` mints a personal VK at ORG scope
    Given "leo@acme.test" has no existing personal VK
    When "leo@acme.test" completes the device-flow login on the CLI
    Then a VirtualKey row is created with:
      | field            | value                          |
      | principalUserId  | leo@acme.test                  |
      | organizationId   | acme                           |
      | VirtualKeyScope  | [{ORGANIZATION, "acme"}]       |
      | name             | "Personal — leo@acme.test"     |
    And the secret is returned to the CLI in the bootstrap response
    And the secret is shown exactly once; subsequent calls return only the displayPrefix

  Scenario: A user can have at most one active personal VK at any given moment
    Given "leo@acme.test" already has a personal VK "vk_leo_v1"
    When "leo@acme.test" completes a second device-flow login
    Then the existing "vk_leo_v1" is returned (revision and secret unchanged) — no second VK is minted
    And the CLI's local config writes "vk_leo_v1" 's secret as `default_personal_vk.secret`

  # ============================================================================
  # Personal VK with non-ORG scope (admin-created or upgraded)
  # ============================================================================

  Scenario: An admin can create a personal VK at TEAM scope for a contractor's bounded access
    Given user "admin@acme.test" has `virtualKeys:manage` at TEAM "platform"
    And user "contractor@acme.test" exists as an ORGANIZATION member
    When "admin@acme.test" calls `api.virtualKeys.create` with:
      | field           | value                                          |
      | name            | "Personal — contractor@acme.test"              |
      | principalUserId | contractor@acme.test                           |
      | scopes          | [{TEAM, "platform"}]                           |
    Then a VK is created with `principalUserId="contractor@acme.test"` and scope TEAM:platform
    And the contractor sees this VK in their `api.personalVirtualKeys.list`
    And the contractor's eligible-model set follows TEAM:platform inheritance, NOT ORG:acme

  # ============================================================================
  # Visibility
  # ============================================================================

  Scenario: A user sees their own personal VK regardless of scope
    Given "leo@acme.test" has a personal VK "vk_leo" scoped to ORGANIZATION "acme"
    When "leo@acme.test" calls `api.personalVirtualKeys.list`
    Then the response contains "vk_leo"
    And the response is returned without consulting `virtualKeys:view` (principalUserId match short-circuits)

  Scenario: A peer cannot see another user's personal VK without virtualKeys:viewOtherPersonal
    Given "leo@acme.test" has a personal VK "vk_leo"
    And "maya@acme.test" is a member of ORGANIZATION "acme" with `virtualKeys:view` only
    When "maya@acme.test" calls `api.personalVirtualKeys.list` with `targetUserId="leo@acme.test"`
    Then the call returns 403 FORBIDDEN
    And the error code is "permission_denied"
    And the error names the missing perm: "virtualKeys:viewOtherPersonal"

  Scenario: Org admins with virtualKeys:viewOtherPersonal can audit all personal VKs
    Given "admin@acme.test" has `virtualKeys:viewOtherPersonal` at ORGANIZATION "acme"
    And users "leo@acme.test", "maya@acme.test", "contractor@acme.test" each have personal VKs
    When "admin@acme.test" calls `api.personalVirtualKeys.list` without a targetUserId filter
    Then the response includes personal VKs for all three users
    And each row exposes principalUserId so the auditor sees who owns it

  # ============================================================================
  # Budget cascade is principal-driven, not scope-driven
  # ============================================================================

  Scenario: Personal-VK spend cascades into a PRINCIPAL budget on the principalUserId, not the scope
    Given a PRINCIPAL budget assigned to "leo@acme.test" with limit $50/month
    And "leo@acme.test" has a personal VK "vk_leo" scoped to ORGANIZATION "acme"
    When "vk_leo" makes a $0.10 chat-completion call
    Then the PRINCIPAL budget's spent_usd increments by $0.10
    And the org-level cascade is also checked (budget walk: principal → org → null)
    And the principal budget pivot is independent of the VK's scope rows

  Scenario: A personal VK with TEAM scope still cascades budgets through the principal first
    Given a PRINCIPAL budget for "contractor@acme.test" with limit $20/month
    And a TEAM budget for "platform" with limit $1000/month
    And "contractor@acme.test" has a personal VK scoped to TEAM "platform"
    When the contractor's VK makes a $0.50 call
    Then the PRINCIPAL budget increments first
    And the TEAM budget also increments (cascading budget engine, see budgets-principal-cascade.feature)
    And the order of cascade is: PRINCIPAL → TEAM (from VK scope) → ORG (from VK organizationId)

  # ============================================================================
  # Audit attribution
  # ============================================================================

  Scenario: Activity ledger rows for personal-VK requests attribute the principalUserId
    When "vk_leo" makes a chat-completion call
    Then the resulting Activity Monitor row has:
      | column           | value         |
      | actor            | leo@acme.test |
      | virtualKeyId     | vk_leo        |
      | principalUserId  | leo@acme.test |
    And the principalUserId attribution is independent of any team/project context

  # ============================================================================
  # Off-boarding
  # ============================================================================

  Scenario: Revoking a user revokes their personal VKs
    Given "leo@acme.test" has a personal VK "vk_leo"
    When the org admin off-boards "leo@acme.test" via `api.organizationMembers.remove`
    Then "vk_leo" is automatically set to `status=REVOKED`
    And subsequent /resolve-key calls for "vk_leo" return 403 with code "virtual_key_revoked"
    And the audit log records actor=admin, action="virtualKey.revoke", reason="principal_offboarded"
