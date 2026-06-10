@bdd @gateway @virtual-keys @rbac @integration
Feature: AI Gateway — Virtual Key RBAC (Path B, scope-aware perms)

  Locks the permission contract for VirtualKey CRUD across the new
  multi-scope schema. All gates use the existing `virtualKeys:*` perm
  vocabulary in `rbac.ts:160-165` (no new `virtualKeys:manage` enum
  entry — the perm already exists, this feature wires it to scope-aware
  checks). One genuinely-new permission is added: `virtualKeys:viewOtherPersonal`,
  for org admins doing off-boarding sweeps over other users' personal VKs.

  ## Industry parity

  Stripe / OpenAI / Anthropic gate workspace-keys on workspace-admin role.
  AWS IAM gates via `iam:CreateUser`-style explicit action perms. We
  follow AWS — granular perm strings per resource family — so SecOps-style
  audit-only roles can grant `virtualKeys:view` without modify-anything.

  ## Hard invariant — locked for THIS PR

  No new code in this PR may rely on the `rbac.ts:715` / `:1099`
  `binding.role === TeamUserRole.ADMIN` short-circuit. Every new VK
  route guard is an explicit `checkUserPermissionForScope(scope, 'virtualKeys:*')`
  call so the eventual legacy-role-removal PR drops the short-circuit
  in one line without a sweep.

  Background:
    Given organization "acme"
    And organization "acme" has team "platform" with project "demo"
    And organization "acme" has team "data-sci" with project "ml-prod"

  # ============================================================================
  # Create — by scope
  # ============================================================================

  Scenario: Creating an ORG-scoped VK requires virtualKeys:manage at ORGANIZATION scope
    Given user "alice@acme.test" has a custom RoleBinding granting "virtualKeys:manage" at ORGANIZATION "acme"
    And user "alice@acme.test" has NO legacy TeamUserRole.ADMIN binding
    When "alice@acme.test" calls `api.virtualKeys.create` with scope ORGANIZATION "acme"
    Then the call succeeds with a 201
    And the new VK has VirtualKeyScope rows: [{ORGANIZATION, "acme"}]

  Scenario: Creating an ORG-scoped VK without org:manage on virtualKeys is rejected
    Given user "bob@acme.test" has only `virtualKeys:manage` at TEAM "platform"
    When "bob@acme.test" calls `api.virtualKeys.create` with scope ORGANIZATION "acme"
    Then the call returns 403 FORBIDDEN
    And the error code is "permission_denied"
    And the message names the missing perm: "virtualKeys:manage at ORGANIZATION:acme"

  Scenario: Creating a TEAM-scoped VK requires virtualKeys:manage at that team
    Given user "carol@acme.test" has `virtualKeys:manage` at TEAM "platform"
    When "carol@acme.test" calls `api.virtualKeys.create` with scope TEAM "platform"
    Then the call succeeds with a 201

  Scenario: User with TEAM "platform" perm cannot create a VK in TEAM "data-sci"
    Given user "carol@acme.test" has `virtualKeys:manage` at TEAM "platform" only
    When "carol@acme.test" calls `api.virtualKeys.create` with scope TEAM "data-sci"
    Then the call returns 403 FORBIDDEN

  Scenario: Creating a PROJECT-scoped VK requires virtualKeys:manage at that project (or upward)
    Given user "dave@acme.test" has `virtualKeys:manage` at PROJECT "demo"
    When "dave@acme.test" calls `api.virtualKeys.create` with scope PROJECT "demo"
    Then the call succeeds with a 201

  # ============================================================================
  # Upward cascade — broader scope grants narrower
  # ============================================================================

  Scenario: virtualKeys:manage at ORGANIZATION scope allows creating VKs at any narrower scope
    Given user "eve@acme.test" has `virtualKeys:manage` at ORGANIZATION "acme"
    When "eve@acme.test" calls `api.virtualKeys.create` with scope TEAM "platform"
    Then the call succeeds
    When "eve@acme.test" calls `api.virtualKeys.create` with scope PROJECT "demo"
    Then the call succeeds
    When "eve@acme.test" calls `api.virtualKeys.create` with scope ORGANIZATION "acme"
    Then the call succeeds

  Scenario: virtualKeys:manage at TEAM scope allows creating VKs at projects within that team
    Given user "frank@acme.test" has `virtualKeys:manage` at TEAM "platform"
    And project "demo" belongs to team "platform"
    When "frank@acme.test" calls `api.virtualKeys.create` with scope PROJECT "demo"
    Then the call succeeds
    When "frank@acme.test" calls `api.virtualKeys.create` with scope PROJECT "ml-prod"
    Then the call returns 403 FORBIDDEN

  # ============================================================================
  # Multi-scope create — all scopes must be authorised
  # ============================================================================

  Scenario: Creating a VK with multiple scopes requires manage on EACH scope (intersection of grants)
    Given user "grace@acme.test" has `virtualKeys:manage` at TEAM "platform" only
    When "grace@acme.test" calls `api.virtualKeys.create` with scopes [TEAM "platform", TEAM "data-sci"]
    Then the call returns 403 FORBIDDEN
    And the message names the unauthorised scope: "virtualKeys:manage at TEAM:data-sci"

  Scenario: User with manage at both teams can create the cross-team VK
    Given user "henry@acme.test" has `virtualKeys:manage` at TEAM "platform" AND TEAM "data-sci"
    When "henry@acme.test" calls `api.virtualKeys.create` with scopes [TEAM "platform", TEAM "data-sci"]
    Then the call succeeds

  # ============================================================================
  # Update / delete / rotate — same scope-aware check
  # ============================================================================

  Scenario: Updating a VK requires virtualKeys:update at one of the VK's scopes
    Given a VirtualKey "vk_demo" scoped to PROJECT "demo"
    And user "ian@acme.test" has `virtualKeys:update` at PROJECT "demo"
    When "ian@acme.test" calls `api.virtualKeys.update` with id="vk_demo" and new name="renamed"
    Then the call succeeds
    And the audit log records actor="ian@acme.test", action="virtualKey.update", target="vk_demo"

  Scenario: Rotating a VK requires virtualKeys:rotate
    Given a VirtualKey "vk_demo" scoped to TEAM "platform"
    And user "jane@acme.test" has `virtualKeys:rotate` at TEAM "platform"
    When "jane@acme.test" calls `api.virtualKeys.rotate` with id="vk_demo"
    Then a new secret is minted
    And `VirtualKey.revision` increments

  Scenario: Deleting a VK requires virtualKeys:delete at one of the VK's scopes
    Given a VirtualKey "vk_doomed" scoped to TEAM "platform"
    And user "karen@acme.test" has only `virtualKeys:view` at TEAM "platform"
    When "karen@acme.test" calls `api.virtualKeys.delete` with id="vk_doomed"
    Then the call returns 403 FORBIDDEN

  # ============================================================================
  # Personal VK — orthogonal lazy-mint path
  # ============================================================================

  Scenario: Any authenticated user can lazy-mint their own personal VK via CLI device-flow
    Given user "leo@acme.test" is a member of organization "acme"
    And "leo@acme.test" has NO explicit `virtualKeys:manage` grant
    When "leo@acme.test" runs `langwatch login --device` and completes the device flow
    Then a personal VK is minted with `principalUserId="leo@acme.test"` and scope ORGANIZATION "acme"
    And the user receives the secret in the CLI bootstrap response

  Scenario: A user can view their own personal VK without any explicit grant
    Given user "leo@acme.test" has a personal VK "vk_leo"
    When "leo@acme.test" calls `api.personalVirtualKeys.list`
    Then the response contains "vk_leo"
    And the personalUserId-match path bypasses the standard `virtualKeys:view` check

  Scenario: A user cannot view another user's personal VK without virtualKeys:viewOtherPersonal
    Given user "leo@acme.test" has a personal VK "vk_leo"
    And user "maya@acme.test" has only `virtualKeys:view` at ORGANIZATION "acme" (no viewOtherPersonal)
    When "maya@acme.test" calls `api.personalVirtualKeys.list` with `targetUserId="leo@acme.test"`
    Then the call returns 403 FORBIDDEN
    And the message names the missing perm: "virtualKeys:viewOtherPersonal"

  Scenario: Org admin with viewOtherPersonal can audit other users' personal VKs (offboarding sweep)
    Given user "admin@acme.test" has `virtualKeys:viewOtherPersonal` at ORGANIZATION "acme"
    And users "leo@acme.test" and "maya@acme.test" each have personal VKs
    When "admin@acme.test" calls `api.personalVirtualKeys.list` with no targetUserId filter
    Then the response includes personal VKs for "leo@acme.test" and "maya@acme.test"

  # ============================================================================
  # Default role-template seeds (new perm reaches existing customers automatically)
  # ============================================================================

  Scenario: Existing org admins automatically gain virtualKeys:viewOtherPersonal on migrate
    Given the LegacyRoles migration adds `virtualKeys:viewOtherPersonal` to OrganizationUserRole.ADMIN + TeamUserRole.ADMIN templates
    And an existing customer org has user "old-admin@acme.test" with OrganizationUserRole.ADMIN binding
    When the migration applies
    Then "old-admin@acme.test" can call `api.personalVirtualKeys.list` for other users immediately on next request
    And no per-org backfill is required
    And the RoleBinding rows themselves are untouched (template lookup is at runtime)

  Scenario: Org member roles do NOT gain virtualKeys:viewOtherPersonal
    Given a user with OrganizationUserRole.MEMBER binding
    When the migration applies
    Then calling `api.personalVirtualKeys.list` for another user still returns 403

  # ============================================================================
  # No-short-circuit regression contract
  # ============================================================================

  Scenario: New VK routes work for a non-ADMIN user with explicit perm grants
    Given user "no-shortcut@acme.test" has zero legacy ADMIN role bindings
    And "no-shortcut@acme.test" has only a custom RoleBinding granting `virtualKeys:manage` at PROJECT "demo"
    When "no-shortcut@acme.test" calls `api.virtualKeys.create` with scope PROJECT "demo"
    Then the call succeeds
    And the success path does NOT traverse the `rbac.ts:715` ADMIN short-circuit
    # Integration test asserts this by mocking or removing the short-circuit and proving the test still passes.
    # When the legacy-role-removal PR ships, this test is the regression gate.

  # ============================================================================
  # Listing — visibility intersection with membership
  # ============================================================================

  Scenario: A user sees VKs whose scopes intersect their membership set
    Given a VirtualKey "vk_org" scoped to ORGANIZATION "acme"
    And a VirtualKey "vk_team_platform" scoped to TEAM "platform"
    And a VirtualKey "vk_team_data_sci" scoped to TEAM "data-sci"
    And user "olive@acme.test" is a member of TEAM "platform" (not data-sci)
    When "olive@acme.test" calls `api.virtualKeys.list`
    Then the response includes "vk_org" (org membership)
    And the response includes "vk_team_platform"
    And the response does NOT include "vk_team_data_sci"

  # ============================================================================
  # Scope ownership — every scope must belong to the key's own organization
  # ============================================================================

  Scenario: A create cannot bind a scope from a different org than its organizationId
    Given user "mallory@acme.test" has `virtualKeys:manage` at TEAM "platform" in organization "acme"
    When "mallory@acme.test" calls `api.virtualKeys.create` for organization "evilcorp" with a scope referencing TEAM "platform" (which belongs to "acme")
    Then the call is rejected with a validation error
    And no virtual key is created under "evilcorp"
    # The per-scope manage check passes (mallory does control TEAM "platform"),
    # so org ownership is the only thing standing between this and a
    # cross-org virtual key row.

  Scenario: An ORGANIZATION scope must equal the organizationId
    Given user "mallory@acme.test" has `virtualKeys:manage` at ORGANIZATION "acme"
    When "mallory@acme.test" calls `api.virtualKeys.create` for organization "evilcorp" with an ORGANIZATION scope of "acme"
    Then the call is rejected with a validation error
