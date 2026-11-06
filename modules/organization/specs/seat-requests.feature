Feature: Seat requests when an organization is over its seat limit
  A person who arrives asking for a full seat the organization has no room for opens a seat
  request. Administrators and Billing members are told, in the product and by mail, and approve
  it in the way the organization pays. Rulings R1, R2, R4, R5 and R6 of the seat-requests design.

  Background:
    Given an organization with an administrator "Ada Admin" and a Billing member "Bill Payer"

  Rule: an interactive arrival that wanted a full seat and did not get one opens a request
    A directory (SCIM) create and an accepted invitation never pass through admission, so they open none.

    @unit
    Scenario: An arrival held pending opens a seat request
      Given every full member seat and every Lite Member seat is in use
      When "late@acme.example" arrives by single sign-on asking for a full seat
      Then "late@acme.example" is held pending with no access
      And an open seat request names "late@acme.example"

    @unit
    Scenario: An arrival admitted as a Lite Member for want of a full seat opens a seat request
      Given every full member seat is in use
      And a Lite Member seat is free
      When "lite@acme.example" arrives by single sign-on asking for a full seat
      Then "lite@acme.example" is a Lite Member with access
      And an open seat request names "lite@acme.example"

    @unit
    Scenario: An arrival given the full seat it asked for opens no request
      Given a full member seat is free
      When "fits@acme.example" arrives by single sign-on asking for a full seat
      Then no seat request names "fits@acme.example"

    @unit
    Scenario: A Developer arrival never opens a seat request
      Given every full member seat and every Lite Member seat is in use
      When "dev@acme.example" arrives asking for a Developer seat
      Then no seat request names "dev@acme.example"

    @unit
    Scenario: A second arrival of the same person does not open a second request
      Given every full member seat and every Lite Member seat is in use
      And "late@acme.example" has an open seat request
      When "late@acme.example" signs in again
      Then exactly one seat request names "late@acme.example"

  Rule: a sign-in the identity provider refused is answered without naming anyone

    @unit
    Scenario: A refused sign-in that would be held pending opens a seat request flagged as refused
      Given every full member seat and every Lite Member seat is in use
      When the identity provider "okta" refuses "late@acme.example"
      Then the refusal is answered "seat_limit"
      And an open seat request names "late@acme.example" as refused by "okta"

    @unit
    Scenario: A refused sign-in with a seat free records an identity provider notice
      Given a full member seat is free
      When the identity provider "okta" refuses "nobody@acme.example"
      Then the refusal is answered "refused"
      And no seat request names "nobody@acme.example"
      And an identity provider refusal notice names "nobody@acme.example"

  Rule: approving gives the full seat the person asked for

    @unit
    Scenario: Approving a held person on a free seat enables them as a full member
      Given "late@acme.example" is held pending with an open seat request
      And a full member seat is free
      When an administrator approves the seat request
      Then "late@acme.example" is a full member with access
      And the seat request is approved

    @unit
    Scenario: Approving a Lite Member changes their seat to a full member
      Given "lite@acme.example" is a Lite Member with an open seat request
      And a full member seat is free
      When an administrator approves the seat request
      Then "lite@acme.example" is a full member with access

    @unit
    Scenario: Approving a refused sign-in with no membership invites the address as a full member
      Given "late@acme.example" has an open seat request from a refused sign-in and no membership
      And a full member seat is free
      When an administrator approves the seat request
      Then a full member invitation is created for "late@acme.example"

    @unit
    Scenario: Approving with no full member seat free is refused with the seat-limit code
      Given "late@acme.example" is held pending with an open seat request
      And every full member seat is in use
      When an administrator approves the seat request
      Then the approval refuses with member_seat_limit_reached
      And the seat request stays open

    @unit
    Scenario: Approving a seat request that is not open is refused
      When an administrator approves a seat request that does not exist
      Then the approval refuses with seat_request_not_found

    @unit
    Scenario: Declining closes the request and leaves the membership as it is
      Given "late@acme.example" is held pending with an open seat request
      When an administrator declines the seat request
      Then the seat request is declined
      And "late@acme.example" is still held pending with no access

    @unit
    Scenario: A person without the seat request permission cannot approve
      Given a member who holds no seatRequests:manage permission
      When they approve a seat request
      Then the approval refuses with permission_denied

  Rule: the approval path follows how the organization pays

    @unit
    Scenario: A live Stripe seat subscription approves through the seats upgrade
      Given the organization pays per seat through a live Stripe subscription
      When an administrator lists the open seat requests
      Then the approval path is "stripe_seats" from the current seats to one more

    @unit
    Scenario: A free or non-seat self-serve plan approves by upgrading the plan
      Given the organization is on the free plan
      When an administrator lists the open seat requests
      Then the approval path is "upgrade_plan" to the subscription settings

    @unit
    Scenario: An account-managed cloud plan approves by contacting LangWatch
      Given the organization is on a negotiated licence on LangWatch Cloud
      When an administrator lists the open seat requests
      Then the approval path is "contact_sales" naming the organization and one more seat

    @unit
    Scenario: A self-hosted Growth licence approves by buying more licence seats
      Given a self-hosted deployment on a Growth licence
      When an administrator lists the open seat requests
      Then the approval path is "upgrade_licence"

    @unit
    Scenario: Any other self-hosted licence approves by contacting LangWatch
      Given a self-hosted deployment on an Enterprise licence
      When an administrator lists the open seat requests
      Then the approval path is "contact_sales"

    @unit
    Scenario: An organization with a full seat already free approves directly
      Given a full member seat is free
      When an administrator lists the open seat requests
      Then the approval path says a seat is free

    @unit
    Scenario: Sales hear about a seat request from an account-managed organization once
      Given the organization is on a negotiated licence on LangWatch Cloud
      When "late@acme.example" opens a seat request twice
      Then the sales channel is told about the seat request once

  Rule: administrators and Billing members are told, and the mail is bounded

    @unit
    Scenario: The first notice of the day is mailed at once to administrators and Billing members
      When "late@acme.example" opens a seat request
      Then "Ada Admin" and "Bill Payer" are mailed about "late@acme.example" at once

    @unit
    Scenario: Later notices in the same window are held for one digest
      Given a seat request mail went out an hour ago
      When "second@acme.example" and "third@acme.example" open seat requests
      Then nobody is mailed at once
      And when the window closes one digest names both people

    @unit
    Scenario: The same person is noticed at most once a day per kind
      When "late@acme.example" is refused by the identity provider three times in a day
      Then one identity provider refusal notice names "late@acme.example"

    @unit
    Scenario: A digest names at most twenty people
      Given twenty-five notices are held for the digest
      When the window closes
      Then the digest names twenty people and says "and 5 more"

    @unit
    Scenario: The seat request mail says when the identity provider also refused the person
      When "late@acme.example" opens a seat request from a sign-in "okta" refused
      Then the mail says to assign them to the LangWatch app in Okta

  Rule: a person with a membership but no access is told why instead of being onboarded

    @unit
    Scenario: A held person reads the administrators and Billing members to contact
      Given "late@acme.example" is held pending with an open seat request
      When "late@acme.example" reads their held memberships
      Then the organization is answered as over its seat limit
      And the contacts are "Ada Admin" then "Bill Payer"

    @unit
    Scenario: A person whose request was declined is told an administrator turned off their access
      Given "late@acme.example" had their seat request declined
      When "late@acme.example" reads their held memberships
      Then the organization is answered as access turned off

    @integration
    Scenario: The waiting screen names who to contact instead of onboarding
      Given "late@acme.example" is held pending with an open seat request
      When "late@acme.example" lands with no active organization
      Then they see that the organization is over its seat limit and who to contact

    @integration
    Scenario: Administrators see seat requests beside join requests
      Given "late@acme.example" has an open seat request
      When an administrator opens the Directory requests
      Then the seat request is listed with Approve and Decline
