Feature: Platform operators are a grant

  As the people who run a LangWatch installation
  We want operator access to be a grant held by named users at the platform tier
  So that who operates the installation is recorded, audited and changed in the product

  # A built-in role, platform-operator, carries ops:view and ops:manage. It is granted
  # at the PLATFORM tier, to users only, and asked with `can` at the platform scope.
  # ops permissions count only from that grant: no organization, team or project grant
  # confers them, whatever role it names. See dev/docs/ARCHITECTURE.md, "Platform
  # operators are a grant".

  # ============================================================================
  # Asking at the platform
  # ============================================================================

  @unit
  Scenario: A platform operator holds ops permissions at the platform
    Given a user holds the platform-operator grant
    When authz is asked whether they hold "ops:view" or "ops:manage" at the platform
    Then both answers are yes

  @unit
  Scenario: The platform grant confers nothing but ops permissions
    Given a user holds the platform-operator grant
    When authz is asked whether they hold "project:view" at the platform
    Then the answer is no

  @unit
  Scenario: A user without the platform grant holds nothing at the platform
    Given a user holds no platform-operator grant
    When authz is asked whether they hold "ops:view" at the platform
    Then the answer is no

  @unit
  Scenario: A platform operator's session carries ops permissions
    Given a user holds the platform-operator grant
    When their session asks for its permissions at an organization or project
    Then the answer includes "ops:view" and "ops:manage"
    And a user without the grant gets neither

  @unit
  Scenario: A deactivated user's platform grant confers nothing
    Given a user holds the platform-operator grant
    And their account is deactivated
    When the platform tier is read
    Then their grant answers nothing, for `can` and for the holder list alike

  @unit
  Scenario: Only users are asked at the platform
    When authz is asked whether an API key or an anonymous caller holds "ops:view" at the platform
    Then the answer is no

  # ============================================================================
  # The fence: ops permissions come only from the platform tier
  # ============================================================================

  @unit
  Scenario: A custom role carrying ops permissions confers nothing
    Given an organization admin also holds a custom role listing "ops:view" and "ops:manage"
    When authz is asked whether they hold "ops:view" at the organization or at the platform
    Then both answers are no
    And neither permission is among their effective permissions at the organization

  @unit
  Scenario: A custom role cannot gain ops permissions
    When a custom role is defined or changed to add "ops:view"
    Then the write is refused with code platform_permission_not_assignable
    And meta.permissions names the ops permissions it added
    And an API key's own role may still list them, conferring nothing

  @unit
  Scenario: A legacy custom role listing ops permissions can still be renamed
    Given a custom role already lists "ops:view" from before the platform tier
    When it is renamed with its permissions unchanged
    Then the change is written and the stored "ops:view" still confers nothing

  @unit
  Scenario: An organization's filtered revoke never reaches a platform grant
    When an organization revokes the grants matching a filter
    Then the revoke never matches a PLATFORM-tier grant
    And a revoke naming the platform tenant as its organization is refused
    And the refusal has code grant_validation_failed

  # ============================================================================
  # Granting
  # ============================================================================

  @unit
  Scenario: A platform operator grants the role to another user
    Given I hold the platform-operator grant
    When I grant the platform-operator role to another user
    Then that user holds a platform-operator grant

  @unit
  Scenario: Granting the role to a current holder writes nothing
    Given another user already holds the platform-operator grant, active or deactivated
    When I grant them the role again
    Then their existing grant is answered and nothing new is written

  @unit
  Scenario: Nobody grants the platform-operator role to themselves
    When I grant the platform-operator role to myself
    Then the write is refused with code platform_operator_self_grant
    And meta.userId names me

  @unit
  Scenario: Only a holder of ops:manage grants or revokes the role
    Given I do not hold the platform-operator grant
    When I or an API key grant the platform-operator role to someone
    Then the write is refused with code grant_exceeds_caller_permissions
    And meta.missingPermissions is "ops:manage"

  @unit
  Scenario: The platform-operator role is granted to users only
    When the platform-operator role is granted to a group, a team, an organization or an API key
    Then the write is refused with code grant_validation_failed
    And meta.principalType names what was refused

  @unit
  Scenario: The system grants the role without a holder
    Given nobody holds the platform-operator grant
    When the installation's one-time seed grants the role to a user
    Then that user holds a platform-operator grant under the id the seed chose

  # ============================================================================
  # Revoking
  # ============================================================================

  @unit
  Scenario: A platform operator revokes another holder
    Given two users hold the platform-operator grant
    When one of them revokes the other's grant
    Then that grant is revoked
    And revoking a grant that is not a live platform grant is refused with code grant_not_found

  @unit
  Scenario: The last platform operator cannot be revoked
    Given exactly one user holds the platform-operator grant
    When anyone revokes it other than by erasing the user
    Then the revoke is refused with code platform_operator_last_holder
    And meta names the grant and its holder

  @unit
  Scenario: Erasing the last platform operator revokes their grant
    Given exactly one user holds the platform-operator grant
    And that user is no longer active, erased or deactivated
    When erasure revokes their grant as the system with reason "user-erased"
    Then their grant is revoked, leaving the installation with no platform operator
    And the same revoke is refused while the holder is still active
    And no person can claim the erasure exception
