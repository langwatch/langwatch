@integration
Feature: Billing-only invite
  As an organization admin
  I want to invite the person who pays as Billing only
  So that they can pay and manage the plan without taking a seat

  Billing only is an invite that grants the Billing role at the organization
  and no seat. It is counted in no seat pool and capped by none, on any plan.

  Scenario: An admin invites a Billing-only member on a full Free plan
    Given an organization on Free with both member seats used and no Lite seat
    When an admin invites someone as Billing only
    Then the invite is created
    And the member, Lite and Developer seat counts are unchanged

  Scenario: A Billing-only member pays the upgrade on Free
    Given a Billing-only member of an organization on Free
    When they start the Growth checkout and it completes
    Then the organization's active plan is Growth
    And they still hold Billing

  Scenario: A Billing-only member reaches billing and nothing else
    Given a Billing-only member
    When they ask for traces:view, project:view or organization:manage
    Then each is refused with permission_denied
    And subscription:manage, seatRequests:manage and members:view are allowed

  Scenario: A Billing-only member lands on the plan page and can open it
    Given a Billing-only invite
    When the person accepts it
    Then they land on the plan page
    And the plan page opens for them although they are on no team

  Scenario: A Billing-only member who opens the app lands on the plan page
    Given a Billing-only member on no team
    When they open the app root or their spent invite link
    Then they land on the plan page
    And they are not shown "Waiting for team access"

  Scenario: The home page sends someone who only pays to the plan page
    Given a Billing-only member
    When the home page decides where they go, with the coding-agents page on or off, an organization intent set, a home pinned elsewhere, or other members using coding agents
    Then they go to the plan page: Plan and billing on Cloud, the licence page when self-hosted
    And a page they opened before on this device does not take them elsewhere
    And everyone who is not Billing only keeps their usual home

  Scenario: Billing cannot be taken from a Billing-only member
    Given a Billing-only member
    When an admin turns their Billing off
    Then it is refused with billing_only_keeps_billing
    And they still hold Billing
    And the person drawer shows Billing on and locked, and says to remove them or move them to a seat

  Scenario: A Billing-only member whose Billing grant is missing can be repaired
    Given a Billing-only member whose Billing grant is missing
    When an admin opens their person drawer
    Then the Billing switch is off and live, and turning it on gives Billing back
    And turning their Billing off is not refused, as there is nothing to take

  Scenario: A Billing-only member is given no team, project or personal workspace
    Given a Billing-only member
    When their invite is accepted, an admin grants them a team or project, or a system write does
    Then no personal workspace or project is created for them
    And the grant is refused with billing_only_no_team_access

  Scenario: A Billing-only invite that names a team is refused
    Given an admin inviting someone as Billing only
    When the invite names a team
    Then it is refused with billing_only_no_team_access

  Scenario: A role change clears Billing only and the new role is metered
    Given a Billing-only member
    When an admin moves them to the Member role
    Then they are no longer Billing only
    And they count in the member seats

  Scenario: Using a spent invitation link again writes nothing
    Given a Billing-only invite already accepted, whose Billing grant has since gone
    When the person uses the link again
    Then it is refused with invite_already_accepted
    And Billing stays off

  Scenario: A delayed second accept writes no grant
    Given a person's two accept requests read the same pending invite
    And the first one wins and an admin then removes a grant it wrote
    When the delayed request finds the invite already claimed
    Then it answers without writing any grant

  Scenario: Billing only is not granted through a group or an API key
    Given the Billing grant held through a group or on an API key
    When it asks for subscription:manage or seatRequests:manage
    Then each is refused

  Scenario: Accepting a Billing-only invite takes no seat
    Given an organization with every seat used
    When a Billing-only invite is accepted
    Then the person joins and no seat limit refuses them

  Scenario: The limit message offers an admin a way to let someone pay
    Given an admin who reaches a seat limit
    When the limit message shows
    Then it offers Upgrade and Invite someone to pay
    And it does not tell them to ask an organization admin

  Scenario: A non-admin at a limit is still pointed to an admin
    Given a member who is not an admin reaches a seat limit
    When the limit message shows
    Then it tells them to ask an organization admin

  Scenario: On Free the invite seat list says what each seat costs there
    Given an admin of an organization on Free with 2 of 2 member seats used
    When they open the seat list in the invite drawer
    Then Member reads "2 of 2 used on Free"
    And Lite Member reads "Not on Free"
    And Billing only reads "Pays for LangWatch: plan, invoices, upgrade"

  Scenario: Picking Lite on Free offers Billing only in place
    Given an admin of an organization on Free inviting lena@acme.com
    When they pick Lite Member
    Then the drawer says Free has no Lite seats and that lena@acme.com can be invited as Billing only to upgrade the organization
    And it offers "Invite as Billing only" and "Upgrade to Growth"
    And it says Growth has unlimited Lite members, from the Growth seat price per full seat
    And Send invites is held, and no limit dialog opens

  Scenario: Invite as Billing only sends the invite from the Free notice
    Given the Free notice for lena@acme.com
    When the admin presses "Invite as Billing only"
    Then lena@acme.com is invited as Billing only, on no team
    And the toast says "lena@acme.com was invited as Billing only"

  Scenario: Upgrade to Growth from the Free notice opens the plan page
    Given the Free notice in the invite drawer
    When the admin presses "Upgrade to Growth"
    Then the drawer closes and the plan page opens

  @unit
  Scenario: The Growth line leaves the price out when it is not known
    Given no Growth seat price in this deployment's catalogue
    When the Free notice shows
    Then it says Growth has unlimited Lite members, with no price

  Scenario: An admin at the Free Lite limit is pointed to Billing only and Growth
    Given an admin on Free reaches the Lite member limit
    When the limit message shows
    Then it says Free has no Lite seats and to invite whoever pays as Billing only
    And it says Growth has unlimited Lite members
    And it does not tell them to ask an organization admin

  Scenario: An organization admin reads as an admin wherever the active project is
    Given an organization admin whose active project does not grant organization:manage
    When the limit message decides who is asking
    Then they are treated as an organization admin

  Scenario: The admin check falls back when the organization cannot answer
    Given a session that cannot answer at the organization
    When the limit message decides who is asking
    Then it uses the session's scope-wide answer

  Scenario: Staff are warned that limits on a PENDING row do nothing
    Given a subscription row whose status is PENDING
    When staff set seat or resource limits on it
    Then the form warns that limits apply only once the row is ACTIVE

  @regression
  Scenario: A new checkout keeps invites made outside a checkout
    Given a pending invite that no checkout created
    When someone starts a new checkout
    Then the invite is still pending
