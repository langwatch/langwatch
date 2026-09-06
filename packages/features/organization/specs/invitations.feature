Feature: Invitation acceptance and role recomputation

  Accepting an invitation must grant exactly the role it named, repair
  rather than duplicate on a retry, and never grant access from an
  invitation that expired or was revoked. Lowering a member's organization
  role must recompute their team roles to match.

  # invite-acceptance.service.ts, invite-lifecycle.service.ts,
  # invite-team-assignment.service.ts, invite-send-throttle.service.ts,
  # organization-member-role.service.ts, organization-group.service.ts,
  # organization-group-binding.service.ts, personal-team-scope.service.ts,
  # compute-effective-team-role-updates.service.ts

  @integration @unimplemented
  Scenario: Accepting an invitation grants exactly the role the invitation named
    Given an invitation for the member role on one team
    When the invited user accepts it
    Then they hold the member role on that team and nothing wider

  @integration @unimplemented
  Scenario: Accepting the same invitation twice does not duplicate the membership
    Given an invitation the user has already accepted
    When they follow the link again
    Then their membership and grants are unchanged

  @unit @unimplemented
  Scenario: An expired invitation cannot be accepted
    Given an invitation past its expiry
    When the user accepts it
    Then acceptance fails as not ready and no membership is created

  @unit @unimplemented
  Scenario: An invitation revoked before acceptance grants nothing
    Given an invitation that was revoked
    When the user follows the link
    Then acceptance fails as not found

  @integration @unimplemented
  Scenario: A retried acceptance whose grant tail failed repairs the missing grants
    Given an acceptance that created the membership but not its role binding
    When acceptance runs again
    Then the missing binding is created and no duplicate membership appears

  @unit @unimplemented
  Scenario: Repeated invitation sends to one address are throttled
    Given an invitation already sent to an address moments ago
    When it is sent again
    Then the second send is throttled and the recipient receives one mail

  @unit @unimplemented
  Scenario: Lowering a member's organization role narrows their team roles with it
    Given a member holding an admin team role under an admin organization role
    When their organization role is lowered to member
    Then their team roles are recomputed to what the lower role permits
