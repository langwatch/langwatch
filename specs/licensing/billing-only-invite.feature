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

  Scenario: Billing only is not granted through a group or an API key
    Given a Billing-only invite
    Then it names a user and the organization scope
    And a group or an API key cannot be invited as Billing only

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

  Scenario: Staff are warned that limits on a PENDING row do nothing
    Given a subscription row whose status is PENDING
    When staff set seat or resource limits on it
    Then the form warns that limits apply only once the row is ACTIVE

  @regression
  Scenario: A new checkout keeps invites made outside a checkout
    Given a pending invite that no checkout created
    When someone starts a new checkout
    Then the invite is still pending
