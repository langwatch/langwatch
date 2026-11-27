Feature: People ops functions
  A staff session reads an organization's invitations and members, the account behind one exact
  email, and which organizations hold more seats than their plan sells. Answers carry ids, roles,
  states, counts and times; never a name, an email address, an invitation code or a link.
  ADR-202, amendment 2026-11-25.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey
    And the organization "ACME" exists beside "Globex"

  @integration
  Scenario: org.invites answers every invitation's state, role and teams
    Given ACME holds a pending, an expired and a checkout-held invitation
    And a redeemed "org:metadata" session on ACME naming "org.invites"
    When the agent calls "org.invites"
    Then each invitation carries its id, role, state, teams, inviter id and times
    And the checkout-held one says it waits on a checkout
    And no answer carries an email address, an invitation code or a link

  @integration
  Scenario: org.invites narrows to one state and pages
    Given a redeemed "org:metadata" session on ACME naming "org.invites"
    When the agent calls "org.invites" for the state "expired"
    Then it answers only the expired invitation
    When the agent calls "org.invites" with a limit of 1
    Then it gets 1 item, a total of 3, truncated true and a next cursor that reads on

  @integration
  Scenario: org.invites refuses a state it does not know
    Given a redeemed "org:metadata" session on ACME naming "org.invites"
    When the agent calls "org.invites" for the state "lost"
    Then it is refused 422 with "staff_function_bad_input"

  @integration
  Scenario: users.find answers the account behind one exact email and its organizations
    Given a redeemed "ops:read" session naming "users.find"
    When the agent asks for "olivia@acme.test"
    Then it answers the account id, when it was created, the organizations it is an active member of and those whose membership is switched off
    And no name or email address

  @integration
  Scenario: users.find answers an empty page for an email with no account
    Given a redeemed "ops:read" session naming "users.find"
    When the agent asks for an email with no account
    Then it answers no accounts, a total of 0 and truncated false

  @integration
  Scenario: users.find is not reachable from an organization session
    Given Olivia enrolled "laptop agent"
    When the agent asks for "org:metadata" on ACME naming "users.find"
    Then it is refused 422 with "staff_function_scope_mismatch"

  @integration
  Scenario: org.members answers role, how they joined, last sign-in and switched-off state
    Given ACME has an administrator, a member an invitation brought who is switched off, and a retired account
    And a redeemed "org:metadata" session on ACME naming "org.members"
    When the agent calls "org.members"
    Then each member carries its user id, role, whether an invitation brought it, when it joined, its last sign-in and whether it is switched off or retired
    And a role the read does not know answers "other"
    And no name or email address

  @integration
  Scenario: orgs.seat_overage lists only the organizations over their seat cap
    Given ACME holds 12 full seats on a plan selling 10 and 3 Lite seats on a plan selling 2
    And Globex holds 2 full seats on a plan selling 2 and unlimited Lite seats
    And a redeemed "ops:read" session naming "orgs.seat_overage"
    When the agent calls "orgs.seat_overage"
    Then it answers ACME only, with its plan code, caps, seats used, over by 3 and when it went over plan
    And no organization name

  @integration
  Scenario: orgs.seat_overage is not reachable from an organization session
    Given Olivia enrolled "laptop agent"
    When the agent asks for "org:metadata" on ACME naming "orgs.seat_overage"
    Then it is refused 422 with "staff_function_scope_mismatch"
