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

  @unit
  Scenario: Accepting an invitation grants exactly the role the invitation named
    Given an invitation for the member role on one team
    When the invited user accepts it
    Then they hold the member role on that team and nothing wider

  @unit
  Scenario: Accepting the same invitation twice does not duplicate the membership
    Given an invitation the user has already accepted
    When they follow the link again
    Then their membership and grants are unchanged

  @unit
  Scenario: An expired invitation cannot be accepted
    Given an invitation past its expiry
    When the user accepts it
    Then acceptance fails as not ready and no membership is created

  @unit
  Scenario: An invitation revoked before acceptance grants nothing
    Given an invitation that was revoked
    When the user follows the link
    Then acceptance fails as not found

  @unit
  Scenario: A retried acceptance whose grant tail failed repairs the missing grants
    Given an acceptance that created the membership but not its role binding
    When acceptance runs again
    Then the missing binding is created and no duplicate membership appears

  @unit
  Scenario: Repeated invitation sends to one address are throttled
    Given an invitation already sent to an address moments ago
    When it is sent again
    Then the second send is throttled and the recipient receives one mail

  # invite-creation.service.ts, ses.organization-invite-mail.channel.ts; main's
  # invite.service.ts sends through the same template on the configured gateway.
  @unit
  Scenario: An invitation is emailed through notification with its accept link
    Given a deployment that names an email gateway
    When an administrator invites a teammate
    Then notification sends one mail to the invited address carrying the accept link

  @unit
  Scenario: An invitation reports it was not emailed when no gateway is named
    Given a deployment that names no email gateway
    When an administrator invites a teammate
    Then the invitation is created and reports that its email was not sent

  @unit
  Scenario: An invitee's request for a fresh invitation emails each administrator
    Given an organization with two administrators
    When the invitee asks for a fresh invitation
    Then notification sends one mail to each administrator naming the invited address

  @unit @unimplemented
  Scenario: Lowering a member's organization role narrows their team roles with it
    Given a member holding an admin team role under an admin organization role
    When their organization role is lowered to member
    Then their team roles are recomputed to what the lower role permits

  @unit
  Scenario: Creating an invitation for an organization that no longer exists is refused
    Given an organization id naming no organization
    When an admin invite is created against it
    Then it is refused as organization not found and no invite is written

  @unit
  Scenario: The plan check for a batch of invitations is resolved for the inviting administrator
    Given an administrator inviting a batch to an organization
    When the batch is created
    Then the organization's plan is resolved for that administrator, so their plan overrides apply to the seat check

  @unit
  Scenario: An invitation with no recorded sender attributes its grants to the service, not the invitee
    Given an invitation that carries no requesting admin
    When it is accepted
    Then its grants are attributed to the invite service, not to the person accepting

  @unit
  Scenario: Approving payment-pending invitations turns each into a fresh pending invite and sends its mail
    Given payment-pending invitations bought on one subscription
    When that subscription's checkout is approved
    Then each becomes a pending invitation with a fresh expiry and its invitation email is sent

  # main's organization.ts:699-730: a Lite Member's team-role change costs a
  # Lite Member seat when it takes away a custom role granting more than viewing.
  @unit
  Scenario: A Lite Member's team-role change is weighed against the seat their custom role held
    Given a Lite Member holding a custom role that grants more than viewing on a team
    When their team role is changed to a built-in role
    Then the change is weighed as a move to a Lite Member seat

  @unit
  Scenario: A Lite Member's team-role change is refused when no Lite Member seat is left
    Given a Lite Member holding a custom role that grants more than viewing on a team
    And the organization has no Lite Member seat left
    When their team role is changed to a built-in role
    Then it is refused as a resource limit exceeded

  @unit
  Scenario: Looking up an unknown invite code answers absent, not a crash
    Given an invite code that names no invitation
    When it is looked up
    Then the answer is absent
    And nothing is thrown


  # Identity closes open join requests from this fact (specs/identity/join-requests.feature).
  @unit
  Scenario: An invitation batch names the invitees who already hold an account
    Given an administrator invites "sam", who has an account, and "kim", who has none
    When the batch is created
    Then the batch's fact names "sam" with the invitation sent to him
    And it does not name "kim"

  @unit
  Scenario: A failed invitee lookup still records the batch
    Given the accounts behind the invited addresses cannot be read
    When the batch is created
    Then the invitations are created and the batch's fact names no invitees
    And the failure is reported

  # The signed-out invite landing (auth.inviteLanding) reads the invitation through
  # OrganizationApi.getInviteLanding; the code is the authorization (WEB-860).
  @unit
  Scenario: A pending invitation's link names the organization and who asked
    Given a pending invitation to "Acme" sent by "Ana"
    When its link is opened
    Then the landing names "Acme" and "Ana" and says it is not yet accepted

  @unit
  Scenario: A revoked or unknown invitation link reads as not found
    Given an invitation that was revoked, and a code that names none
    When either link is opened
    Then both are refused as not found, naming no organization

  @unit
  Scenario: An expired invitation link is refused as expired and can ask for a fresh one
    Given a pending invitation whose expiry has passed
    When its link is opened
    Then it is refused as expired
    And asking for a fresh one tells the organization's admins with a link to the members settings

  # Main renders the invite landing for a visitor with no session; the shell must not
  # send that visitor to sign-in first (WEB-860).
  @unit
  Scenario: The invite landing renders for a visitor with no session
    Given a visitor with no session
    When they open the invitation link at "/invite/accept"
    Then the address is one that renders without a session

  # Typing in Directory's inline invite box opens Add members; main focuses its email field
  # so the rest of the address lands there (WEB-8700).
  @integration
  Scenario: The invite drawer opened from the inline box takes the typing over
    Given an administrator typed the first letter of an address in the inline invite box
    When the Add members drawer opens with that letter
    Then its email field holds the letter and has the focus
