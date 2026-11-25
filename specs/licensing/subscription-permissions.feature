Feature: Who may upgrade the organization's subscription
  The person who holds the company card is often not an organization admin,
  so any member of the organization may start a paid subscription on the
  cloud. Changing, shrinking or cancelling a subscription that is already live,
  and inviting people, stay with organization administrators.

  Rule: Any organization member may start a paid subscription

    @unit
    Scenario: A Member may upgrade the organization
      Given a person who is a Member of the organization
      When the organization asks whether they may upgrade the subscription
      Then the answer is yes

    @unit
    Scenario: A Lite Member may upgrade the organization
      Given a person who is a Lite Member of the organization
      When the organization asks whether they may upgrade the subscription
      Then the answer is yes

    @unit
    Scenario: A Member starts a checkout for an organization without a subscription
      Given a caller who holds the upgrade permission but cannot manage the organization
      When they start a checkout for a seat plan
      Then a checkout page is returned

    @integration
    Scenario: A member who may not invite buys the planned seats without sending invitations
      Given a caller who cannot invite people
      And they planned seats with email addresses on the subscription page
      When they press upgrade
      Then the checkout is started for the planned seat count
      And no invitation is sent with it

    @unit
    Scenario: A Lite Member finds the subscription page in the settings menu on the cloud
      Given a Lite Member on the cloud
      When the settings menu is built
      Then it lists the Subscription page

  Rule: Changing or cancelling a live subscription stays with administrators

    @unit
    Scenario: A Member cannot open the billing portal
      Given a caller who holds the upgrade permission but cannot manage the organization
      When they open the billing portal
      Then the request is refused with permission_denied

    @unit
    Scenario: A Member cannot change the seats of a live subscription
      Given a caller who holds the upgrade permission but cannot manage the organization
      When they change the seat count of the live subscription
      Then the request is refused with permission_denied

    @unit
    Scenario: A checkout is refused while a subscription is live
      Given an organization with a live subscription on a non-seat plan
      When a checkout is started for another plan
      Then it is refused with subscription_already_active
      And the live subscription is neither changed nor cancelled
