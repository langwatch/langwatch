Feature: Organization members and invites REST API

  As an operator provisioning LangWatch from code
  I want to manage members and invites over REST
  So that onboarding and offboarding people is automatable end to end

  Background:
    Given an organization on an Enterprise plan with several members
    And I am authenticated with an organization-scoped API key
    And my credential acts on behalf of one of those members

  # Accepting an invite stays a browser flow, so this API covers the half a
  # machine can do: create, list and revoke. Listing returns the invite link
  # because a provisioning run that never sends an email still has to hand the
  # person something to click.
  #
  # Two refusals exist to stop a credential locking its own organization out of
  # its administrators: the member a credential acts as can neither disable nor
  # remove themselves.

  # ============================================================================
  # Members
  # ============================================================================

  @integration
  Scenario: Listing members returns roles and status
    When I list members
    Then the response status is 200
    And each member carries their user id, name, email, organization role and whether they are disabled
    And disabled members appear only when I ask for them

  @integration
  Scenario: Fetching a member includes their team bindings
    Given a member belongs to two teams
    When I fetch that member
    Then the response status is 200
    And it lists both teams with the role they hold on each

  @integration
  Scenario: Changing a member's organization role takes effect
    Given a member holds the member role
    When I change their organization role to admin
    Then the response status is 200
    And fetching them returns the admin role

  @integration
  Scenario: Disabling a member blocks their access
    Given an active member of the organization
    When I disable that member
    Then the response status is 200
    And the member is reported as disabled
    And their access to the organization is refused

  @integration
  Scenario: Re-enabling a member checks the seat limit
    Given a disabled member and no seats left on the plan
    When I re-enable that member
    Then the request is refused with code member_seat_limit_reached and status 403
    And the member stays disabled

  @integration
  Scenario: A member cannot disable themselves
    When I disable the member my credential acts on behalf of
    Then the request is refused with code cannot_disable_self and status 400
    And that member is still active

  @integration
  Scenario: Removing a member deletes the membership
    Given a member of the organization
    When I remove that member
    Then the response status is 200
    And fetching them afterwards is refused with code member_not_found and status 404

  @integration
  Scenario: A member cannot remove themselves
    When I remove the member my credential acts on behalf of
    Then the request is refused with code cannot_remove_self and status 400
    And that member is still in the organization

  @integration
  Scenario: Removing the last active admin is refused
    Given the organization has one active admin
    When I remove that admin
    Then the request is refused with code cannot_remove_last_admin and status 400
    And that admin is still in the organization

  # Two provisioning runs offboarding in parallel is the ordinary case, not an
  # exotic one, and an organization with no administrator cannot be recovered
  # from inside the product.
  @integration
  Scenario: Two admins removed at the same time cannot both succeed
    Given the organization has exactly two active admins
    When both of them are removed at the same time
    Then one removal is refused with code cannot_remove_last_admin
    And the organization still has an active admin

  @integration
  Scenario: A member's access breakdown spans teams and projects
    Given a member with an organization role, a team binding and a project binding
    When I fetch that member's access breakdown
    Then the response status is 200
    And it lists the access they hold on the organization, on each team and on each project
    And each entry says where that access comes from

  # ============================================================================
  # Invites
  # ============================================================================

  @integration
  Scenario: Listing invites includes the invite link
    Given the organization has a pending invite
    When I list invites
    Then the response status is 200
    And the invite carries its email, role, invite code and invite link

  @integration
  Scenario: Creating invites assigns teams including a custom role
    Given a team and a custom role exist in the organization
    When I invite two people with a team assignment carrying that custom role
    Then the response status is 201
    And both invites are created with that team assignment
    And the response says whether the invite emails were sent

  @integration
  Scenario: Inviting an existing member is refused
    Given a member of the organization
    When I invite that member's email address
    Then the request is refused with code already_organization_member and status 409
    And no invite is created

  @integration
  Scenario: A duplicate pending invite is refused
    Given a pending invite for an email address
    When I invite the same address again
    Then the request is refused with code duplicate_invite and status 409
    And the organization still has one invite for that address

  @integration
  Scenario: Invites beyond the seat limit are refused
    Given the plan has one seat left
    When I invite three people at once
    Then the request is refused with code member_seat_limit_reached and status 403
    And no invite is created

  @integration
  Scenario: An invite cannot assign a personal workspace team
    Given a member has a personal workspace in the organization
    When I invite someone with a team assignment on that personal workspace
    Then the request is refused with code personal_workspace_not_managed_here and status 403
    And no invite is created

  @integration
  # Revocation is a state, not a delete (D11 — see
  # specs/identity/resilient-invitations.feature): the row stays so an admin
  # can still see what they revoked, and the code on it stops opening
  # anything.
  Scenario: Revoking a pending invite marks it REVOKED
    Given the organization has a pending invite
    When I revoke that invite
    Then the response status is 200
    And it still appears in the invite list with status REVOKED
    And revoking it again is refused with code invite_not_found and status 404
