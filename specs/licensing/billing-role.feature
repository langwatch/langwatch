@unit
Feature: Billing role
  As an organization that pays for LangWatch
  I want the person who pays to change the plan and approve seat requests
  So that billing does not need an administrator seat

  Billing is a built-in role held at the organization scope, beside any other
  role. Its bag is organization:view, subscription:upgrade, subscription:manage,
  seatRequests:view, seatRequests:manage and members:view. It takes no seat:
  a Lite Member who holds it keeps a Lite seat.

  Scenario: A Billing member approves seat requests but cannot invite
    Given a member who holds the Billing role on the organization
    When they ask for seatRequests:manage and subscription:manage
    Then both are allowed
    And organization:manage is refused with permission_denied

  Scenario: Billing is not a seat
    Given a Lite Member who holds the Billing role on the organization
    When they ask for subscription:manage
    Then it is allowed and the Lite seat cap does not withhold it

  Scenario: Billing confers nothing outside a direct organization grant
    Given a Billing grant reached through a group, held at a team, or held by an API key
    When the grant is asked for seatRequests:manage
    Then it is refused

  Scenario: A Billing grant below the organization is rejected
    Given a grant event naming the Billing role at a team scope
    When the event is validated
    Then it is rejected

  Scenario: Checkout completer becomes Billing
    Given a member who is not an administrator started a checkout
    When the checkout completes
    Then they hold the Billing role

  Scenario: A checkout starter who left the organization is not given Billing
    Given a member started a checkout and was then removed from the organization
    When the checkout completes
    Then no Billing grant is written and the checkout still completes
    And any other failure to grant Billing fails the webhook so Stripe retries it

  Scenario: An administrator who completes checkout is not given Billing
    Given an administrator started a checkout
    When the checkout completes
    Then no Billing grant is written

  Scenario: Admin grants and revokes Billing
    Given an administrator and a member without Billing
    When the administrator grants Billing to the member
    Then the member is listed as a Billing holder
    And granting it again leaves one grant
    When the administrator revokes Billing
    Then the member is no longer listed

  Scenario: A disabled member is not listed as a Billing holder
    Given a member who holds Billing and whose seat is disabled
    When the Billing holders are listed
    Then the member is not listed

  Scenario: Granting or revoking Billing never reaches beyond the caller
    Given a caller who holds organization:manage but not subscription:manage
    When they grant or revoke Billing for a member
    Then it is refused with the missing permissions named
    And no Billing grant is written or revoked

  Scenario: Only an administrator can change Billing
    Given the procedure that grants or revokes Billing
    Then it declares organization:manage
    And the Billing holders list declares members:view
