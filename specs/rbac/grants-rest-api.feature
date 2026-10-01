Feature: Roles and grants REST API, and the role bindings API it supersedes

  As an operator provisioning LangWatch from code
  I want to define roles and grant them to people, groups and API keys at a scope
  So that who can do what is written in the words the product uses, while
  integrations built on role bindings keep working and are told to move

  Background:
    Given an organization on an Enterprise plan
    And I am authenticated with an organization-scoped API key

  # A role is what you may do; a grant is who holds a role, and where. Grants
  # carry no uniqueness: each create is its own grant with its own id. Built-in
  # roles are addressed as "admin", "member" and "viewer"; custom roles by id.

  # ============================================================================
  # Grants
  # ============================================================================

  @integration
  Scenario: Granting a built-in role to a user on a team
    Given a member of the organization and a team
    When I grant role "member" to that user on the team
    Then the response status is 201
    And the grant names the user, the role "member" as built in, and the team
    And the grant's status is "active" and it has no end date

  @integration
  Scenario: Granting a custom role to a group on a project
    Given a group and a custom role exist in the organization
    When I grant that custom role to the group on a project
    Then the response status is 201
    And fetching the grant by id returns the custom role by id and name, not built in

  @integration
  Scenario: Granting a role to an API key
    Given a service API key exists in the organization
    When I grant role "viewer" to that key on a project
    Then the response status is 201
    And the grant names the key as its principal

  @integration
  Scenario: Listing grants filters by principal, role, scope and status, one page at a time
    Given grants exist for a user, a group and an API key across two teams
    When I list grants for that user with a limit of 1
    Then the response status is 200
    And only that user's grants are returned, one per page
    And each page but the last carries a nextCursor, and the last carries null
    And filtering by role "viewer" or by one team narrows the list the same way
    And filtering by status "expired" returns only grants past their end date

  @integration
  Scenario: Listing grants newest first, with oldest first as the default
    Given three grants created one after another
    When I list grants without an order, with order "oldest", and with order "newest"
    Then the first two lists return the oldest grant first and the last returns the newest first
    And paging with order "newest" continues from the cursor in the same order
    And an order other than "newest" or "oldest" is refused with 422

  @integration
  Scenario: Changing a grant's role keeps its principal and scope
    Given a user holds role "viewer" on a project
    When I change that grant's role to "member"
    Then the response status is 200
    And the grant keeps its id, its principal and its scope

  @integration
  Scenario: A grant's principal and scope cannot be changed
    Given a user holds role "viewer" on a project
    When I update that grant with a different scope
    Then the request is refused as invalid
    And the grant is unchanged

  @integration
  Scenario: Revoking a grant
    Given a user holds role "member" on a team
    When I delete that grant
    Then the response status is 200 and names the revoked grant's id

  @integration
  Scenario: The same grant can be made twice
    Given a user holds role "member" on a team
    When I grant the same role to the same user on the same team again
    Then the response status is 201
    And the new grant has a different id from the first

  @unit
  Scenario: A grant beyond the organization's limit is refused
    Given the organization already holds as many grants as the limit allows
    When I create one more grant
    Then the request is refused with code grant_limit_reached and status 409
    And the refusal reports the limit
    And no grant is created

  @integration
  Scenario: A retried create with the same Idempotency-Key makes one grant
    When I grant role "viewer" to a user on a project with an Idempotency-Key
    And the same request is sent again with that key
    Then both answers carry the same grant id
    And the second answer is marked as a replay
    And exactly one grant was created

  @integration
  Scenario: Reusing an Idempotency-Key with a different body is refused
    Given a grant was created with an Idempotency-Key
    When I send a different grant with the same key
    Then the request is refused with code idempotency_error and status 409
    And no second grant is created

  # ============================================================================
  # Grant errors
  # ============================================================================

  @unit
  Scenario Outline: A grant naming something outside the organization is refused
    Given <thing> exists in another organization
    When I create a grant naming it
    Then the request is refused with code <code> and status 422
    And no grant is created

    Examples:
      | thing         | code                      |
      | a user        | grant_principal_not_found |
      | a group       | grant_principal_not_found |
      | an API key    | grant_principal_not_found |
      | a custom role | grant_role_not_found      |
      | a team        | grant_scope_not_found     |

  @unit
  Scenario: A role with an organization-only permission cannot be granted below the organization
    Given a custom role carrying a permission that only applies at organization scope
    When I grant it to a user on a team
    Then the request is refused with code grant_scope_not_allowed and status 422

  @unit
  Scenario: A grant into a personal workspace is refused
    Given a member has a personal workspace in the organization
    When I grant another user a role on that personal workspace
    Then the request is refused with code grant_scope_personal_workspace and status 403

  @unit
  Scenario: A grant ending in the past is refused
    When I grant role "viewer" to a user on a project ending yesterday
    Then the request is refused with code grant_expiry_in_past and status 422

  @integration
  Scenario: A malformed or oversized grant is refused before anything is written
    When I create a grant whose principal type is "robot", or whose ids are longer than 128 characters
    Then the request is refused as invalid
    And no grant is created

  @integration
  Scenario: A tampered page cursor is refused
    When I list grants with a cursor I did not receive
    Then the request is refused as invalid

  @integration
  Scenario: An unknown or foreign grant id is not found
    Given a grant exists in another organization
    When I fetch, change or delete that grant by id
    Then each request is refused with code grant_not_found and status 404

  # ============================================================================
  # Nobody can grant more than they hold
  # ============================================================================

  @unit
  Scenario: Granting a role at the caller's own level is allowed
    Given I hold every permission of role "member" on a team
    When I grant role "member" to another user on that team
    Then the grant is created

  @unit
  Scenario Outline: Granting beyond the caller's own permissions is refused
    Given I do not hold every permission of the role at that scope
    When I grant that role to <principal>
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And the refusal names the permissions I lack
    And no grant is created

    Examples:
      | principal                  |
      | myself                     |
      | a group I belong to        |
      | an API key                 |
      | another member             |

  @unit
  Scenario: Changing a grant to a role above the caller's own is refused
    Given I hold role "member" on a team through a grant
    When I change my own grant to role "admin"
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And the grant is unchanged

  @unit
  Scenario: An API key cannot grant beyond its own permissions and scope
    Given I am authenticated with a key that holds permissions on one project only
    When I grant role "viewer" on the organization
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  @unit
  Scenario: An expired grant does not count towards what the caller holds
    Given my grant of role "admin" on a team has expired
    When I grant role "admin" on that team to myself again
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  @unit
  Scenario: The role bindings door and the grants door refuse escalation alike
    Given I do not hold every permission of role "admin" on a team
    When I bind role "admin" through /api/role-bindings, or change a binding to it
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  # Every door that grants refuses escalation alike: authz runs the rule on the grant write
  # itself, and a door that writes something of its own first asks the same rule before it.
  # Each refusal is code grant_exceeds_caller_permissions, status 403, with meta.missingPermissions.

  @unit
  Scenario: Creating a group with a grant above the caller is refused
    Given I hold "organization:manage" but not every permission of role "admin" on a team
    When I create a group that holds role "admin" on that team
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And no group is created

  @unit
  Scenario: Adding a grant to a group above the caller is refused
    Given I do not hold every permission of role "admin" on a team
    When I add a grant of role "admin" on that team to a group
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  @unit
  Scenario: Editing a group to add a grant above the caller is refused before any edit
    Given I do not hold every permission of role "admin" on a team
    When I save a group edit that renames the group and adds role "admin" on that team
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And the group is neither renamed nor stripped of any grant

  @unit
  Scenario: Adding a member to a group whose grants exceed the caller is refused
    Given a group holds role "admin" on a team
    And I do not hold every permission of role "admin" on that team
    When I add myself or anyone else to that group
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  @unit
  Scenario: Adding a team member with a role above the caller is refused
    Given I do not hold every permission of role "admin" on a team
    When I add a member to that team with role "admin"
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  @unit
  Scenario: Saving a team's members with a role above the caller is refused
    Given I do not hold every permission of role "admin" on a team
    When I save the team's members with a member changed to role "admin"
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  @unit
  Scenario: Changing a member's organization role above the caller is refused before the seat changes
    Given I hold "organization:manage" but not every permission of the organization admin role
    When I change a member's organization role to admin
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And the member's seat is unchanged

  @unit
  Scenario: Changing a member's team role above the caller is refused before anything is written
    Given I do not hold every permission of role "admin" on a team
    When I change a member's role on that team to "admin"
    Then the request is refused with code grant_exceeds_caller_permissions and status 403

  @unit
  Scenario: Inviting someone to a role above the inviter is refused and stores no invitation
    Given I hold "organization:manage" but not every permission of the organization admin role
    When I invite someone as an organization admin
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And no invitation is stored

  @unit
  Scenario: Inviting by legacy team ids is bounded by the inviter's own team access
    Given I hold "organization:manage" but no access to a team
    When I invite someone as a member naming that team in the legacy team id list
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And no invitation is stored

  @unit
  Scenario: Inviting through a seat checkout is bounded by the inviter
    Given I hold "organization:manage" but not every permission of the organization admin role
    When I buy seats for an invitation as an organization admin
    Then the invitation is refused with code grant_exceeds_caller_permissions
    And no invitation is held for payment

  @unit
  Scenario: A service key grants through the organization doors, bounded by its own grants
    Given a service organization key that acts as no person
    When it adds a group grant, a team member, a member role or an invitation
    Then the write answers as the key, and is refused only beyond what the key itself holds

  @unit
  Scenario: A personal key is bounded by the key, not by its owner
    Given a personal organization key narrower than the member who owns it
    When it grants through an organization door
    Then the write is bounded by what the key holds, not by its owner

  @unit
  Scenario: A custom role the organization does not have is refused before anything is written
    When a door is asked to grant a custom role the organization does not have
    Then it is refused with code custom_role_not_assignable before anything is written

  @unit
  Scenario: Creating a staffed team is bounded by its creator, who still becomes its admin
    Given I may create teams but hold no team role at the organization
    When I create a team naming myself as its admin and someone else as a member
    Then I become the team's admin
    And the other member is written only if I hold what their role confers

  @unit
  Scenario: Minting a SCIM token requires a full organization admin
    Given I hold "organization:manage" but not every permission of the organization admin role
    When I mint a SCIM token
    Then the request is refused with code grant_exceeds_caller_permissions and status 403
    And no token is minted

  @unit
  Scenario: An expired organization admin is not an admin for API key management
    Given my organization admin grant has passed its end moment
    When I manage the organization's service API keys
    Then I am not treated as an organization admin

  @unit
  Scenario: A service key's grants are bounded by the person who creates it
    When a member creates or edits a service API key
    Then its built-in role grants are written answering as that member, never as the system

  @unit
  Scenario: A grant write nobody answers for is refused
    Given a grant write arrives with no person or API key to answer for it
    When it grants any role
    Then it is refused with code grant_exceeds_caller_permissions

  @unit
  Scenario: Granting at or below the caller's own level still succeeds
    Given I hold every permission of role "admin" on a team
    When I add a member to that team with role "admin"
    Then the grant is written

  @unit
  Scenario: A write that follows from an act already authorized is not bounded by a caller
    Given an invitation was created by someone who held what it grants
    When the invitee accepts it
    Then its grants are written without asking what the invitee holds

  @unit
  Scenario: The last administrator grant of an organization cannot be revoked
    Given exactly one user holds role "admin" on the organization
    When I revoke that grant
    Then the request is refused with code cannot_remove_last_admin

  @unit
  Scenario: The last administrator grant of an organization cannot be lowered
    Given exactly one user holds role "admin" on the organization
    When I change that grant to role "member"
    Then the request is refused with code cannot_demote_last_admin

  @unit
  Scenario: A custom role cannot be given a permission the caller lacks
    Given I do not hold "secrets:manage" on the organization
    When I create a role carrying "secrets:manage", or add it to a role I hold
    Then the request is refused with code role_exceeds_caller_permissions and status 403
    And the role is unchanged

  @unit
  Scenario: A custom role may keep permissions the caller lacks when they are not added
    Given a role carries "secrets:manage", which I do not hold
    When I rename that role
    Then the role is renamed

  # ============================================================================
  # Roles: built-in ids
  # ============================================================================

  @integration
  Scenario: The role list includes the built-in roles unless filtered
    When I list roles without a builtIn filter
    Then "admin", "member" and "viewer" are listed and marked built in
    And the custom roles are listed after them, not built in

  @integration
  Scenario: The role list filters to the built-in roles
    Given the organization defines the custom role "Auditor"
    When I list roles with builtIn "true"
    Then only "admin", "member" and "viewer" are listed

  @integration
  Scenario: The role list filters to the custom roles
    Given the organization defines the custom role "Auditor"
    When I list roles with builtIn "false"
    Then only "Auditor" is listed, not built in

  @integration
  Scenario: A builtIn filter that is not true or false is refused
    When I list roles with builtIn "yes"
    Then the response status is 422 with code validation_error

  @integration
  Scenario: Built-in roles are addressable by stable ids
    When I fetch the role "admin"
    Then the response status is 200
    And the role is marked built in and lists its permissions

  @integration
  Scenario: A built-in role cannot be changed or deleted
    When I update or delete the role "viewer"
    Then each request is refused with code role_is_built_in and status 409

  # ============================================================================
  # The role bindings door: deprecated, not removed
  # ============================================================================

  @integration
  Scenario: Every role bindings operation answers as before and carries the deprecation headers
    Given a user is bound as a member of a team
    When I list, create, change or delete a binding through /api/role-bindings
    Then the response status and body are as before
    And the response carries the header Deprecation "true"
    And a Link header naming "/api/grants" as the successor version

  @integration
  Scenario: The published document marks the role bindings operations deprecated
    When the OpenAPI document is generated
    Then every role bindings operation is marked deprecated
    And its operation id and path are unchanged
    And every grants operation is published and not deprecated

  @integration
  Scenario: The first call to a deprecated operation is logged once
    When I list bindings through /api/role-bindings twice
    Then one warning is logged naming the role-bindings family, the operation and "/api/grants"
