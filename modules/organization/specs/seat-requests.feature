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

    @unit
    Scenario: A held person whose seat request failed to open gets one when they arrive again
      Given every full member seat and every Lite Member seat is in use
      And "late@acme.example" was held pending but their seat request could not be opened
      When "late@acme.example" signs in again
      Then an open seat request names "late@acme.example"

    @unit
    Scenario: A member an admin moved to Lite is not turned into a seat request
      Given "lite@acme.example" holds a Lite Member seat with no seat request on file
      When "lite@acme.example" signs in again
      Then no seat request is opened for them and no administrator is mailed

    @unit
    Scenario: Arriving again never reopens a seat request that was answered
      Given every full member seat and every Lite Member seat is in use
      And "late@acme.example" is held pending and their seat request was declined
      When "late@acme.example" signs in again
      Then no open seat request names "late@acme.example"

  Rule: a sign-in the identity provider refused is answered without naming anyone

    @unit
    Scenario: A refused sign-in that would be held pending opens a seat request flagged as refused
      Given arrivals join on a full Member seat and every full member seat is in use
      And whether or not a Lite Member seat is free, since the arrival would be held or left Lite
      When the identity provider "okta" refuses "late@acme.example"
      Then the refusal is answered "seat_limit"
      And an open seat request names "late@acme.example" as refused by "okta"

    @unit
    Scenario: A refused sign-in with a seat free records an identity provider notice
      Given a full member seat is free, or arrivals join on a Developer seat, which is its own
      When the identity provider "okta" refuses "nobody@acme.example"
      Then the refusal is answered "refused"
      And no seat request names "nobody@acme.example"
      And an identity provider refusal notice names "nobody@acme.example"

    @unit
    Scenario: Refused sign-ins stop opening requests and mailing past a daily cap
      Given every full member seat and every Lite Member seat is in use
      And 20 different addresses were refused by the identity provider today
      When the identity provider refuses one more address
      Then the refusal is still answered "seat_limit"
      But no seat request opens for it and no administrator is mailed about it

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
    Scenario: A seat change that waits too long for the seat lock asks to try again
      Given another seat change holds the organization's seat lock for the whole wait
      When a seat change gives up waiting for it
      Then it refuses with seat_change_busy, a retryable 409
      And the message says "Another seat change is in progress. Try again in a moment."

    @integration
    Scenario: Two approvals for the last free full seat at once: exactly one wins
      Given "first@acme.example" and "second@acme.example" are each held pending with an open seat request
      And exactly one full member seat is free
      When two administrators approve the two requests at the same moment
      Then exactly one of them becomes a full member with access
      And the other approval refuses with member_seat_limit_reached
      And that other seat request stays open

    @integration
    Scenario: Seat changes on many organizations at once never starve the connection pool
      Given eight organizations each start a seat change at the same moment
      And the server has only two database connections
      When each seat change counts its seats and writes in its own transaction
      Then every seat change completes

    @integration
    Scenario: A seat lease taken through the organization Api holds off the organization's own seat writes
      Given a directory admission took the organization's seat lease through the organization Api
      When an organization seat change starts while that lease is held
      Then the seat change waits until the directory admission releases the lease

    @integration
    Scenario: Renewing a seat lease extends only the holder's own lease
      Given a directory admission holds the organization's seat lease
      When a different holder renews the lease
      Then the lease's expiry does not move
      When the directory admission renews the lease
      Then the lease's expiry moves out by the lease time

    @integration
    Scenario: A seat change whose lease was taken over writes nothing
      Given a seat change holds the organization's seat lease
      And its lease expires while it is still counting seats
      And a second seat change takes the lease and writes
      When the first seat change is about to write its seat
      Then it is refused with "seat_change_busy"
      And only the second seat change's write landed

    @unit
    Scenario: An approval whose seat never landed is reopened
      Given an administrator approved a held person's seat request an hour ago
      And the approval stopped before the seat was given
      When an administrator lists the open seat requests
      Then the request is open again
      And the person is still held

    @unit
    Scenario: An approval still giving its seat is left alone
      Given an administrator approved a held person's seat request a minute ago
      And the seat is not given yet
      When an administrator lists the open seat requests
      Then the request is not on the list

    @unit
    Scenario: An approval whose seat landed but was never marked is settled, not reopened
      Given an administrator approved a held person's seat request
      And the person was enabled as a full member
      But the approval could not mark the seat as given
      When an administrator lists the open seat requests an hour later
      Then the request stays approved and is marked as given

    @unit
    Scenario: An approval whose invitation went out but was never marked is settled, not reopened
      Given an administrator approved the seat request of a refused sign-in with no membership
      And the approval invited the address as a full member
      But the approval could not mark the seat as given
      When an administrator lists the open seat requests an hour later
      Then the request stays approved and is marked as given

    @unit
    Scenario: A directory admission whose lease was taken over writes no membership
      Given a directory admission holds the organization's seat lease through the organization Api
      And the lease went to another seat change before the membership write
      When the admission is about to write the membership
      Then it is refused with "seat_change_busy"
      And the admission still releases its own lease

    @integration
    Scenario: Two single sign-on arrivals for the last free full seat at once: exactly one gets it
      Given exactly one full member seat is free
      When "first@acme.example" and "second@acme.example" arrive by single sign-on at the same moment asking for a full seat
      Then exactly one of them is a full member
      And the other is a Lite Member

    @unit
    Scenario: An approval that cannot hand its claim back retries, then fails as an infrastructure error
      Given "late@acme.example" is held pending with an open seat request
      And every full member seat is in use
      When an administrator approves the seat request and reopening the request fails once
      Then the approval refuses with member_seat_limit_reached
      And the seat request stays open
      But when reopening keeps failing, the approval fails with an infrastructure error naming both failures

    @unit
    Scenario: Approving a seat request that is not open is refused
      When an administrator approves a seat request that does not exist
      Then the approval refuses with seat_request_not_found

    @unit
    Scenario: An approval and a decline of the same request never both act
      Given "late@acme.example" is held pending with an open seat request
      When one administrator declines it while another approves it
      Then only the first to close the request acts
      And the other is refused with seat_request_not_found

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
    Scenario: An Enterprise subscription billed outside Stripe approves by contacting LangWatch
      Given the organization holds an Enterprise subscription with no Stripe seat billing
      When an administrator lists the open seat requests
      Then the approval path is "contact_sales"

    @unit
    Scenario: A self-hosted Growth licence approves by buying more licence seats
      Given a self-hosted deployment on a Growth licence
      When an administrator lists the open seat requests
      Then the approval path is "upgrade_licence"
      And it links to the licence settings page, where the licence buys more seats

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

    @integration
    Scenario: Approve with a seat free approves at once
      Given a full member seat is free
      When an administrator presses Approve on a seat request
      Then the request is approved without opening the seats upgrade

    @integration
    Scenario: Approve on a live Stripe seat subscription adds the seat, then approves
      Given the approval path is "stripe_seats" from 5 seats to 6
      When an administrator presses Approve and confirms the seats upgrade
      Then the subscription is raised to 6 seats
      And then the request is approved

    @integration
    Scenario: A failed seat expansion approves nothing
      Given the approval path is "stripe_seats"
      When the administrator confirms the seats upgrade and adding the seat fails
      Then an error says the seat could not be added
      And the request is not approved

    @unit
    Scenario: Sales hear about a seat request from an account-managed organization once
      Given the organization is on a negotiated licence on LangWatch Cloud
      When "late@acme.example" opens a seat request twice
      Then the sales channel is told about the seat request once

    @unit
    Scenario: Sales still hear about a seat request whose notice could not be recorded
      Given the organization is on a negotiated licence on LangWatch Cloud
      And the access notice log is unavailable
      When "late@acme.example" opens a seat request
      Then the seat request is open
      And the sales channel is told about the seat request

  Rule: administrators and Billing members are mailed about each person at once
    Organizations see few of these a day, and each one says an employee wants LangWatch, so there
    is no digest; the only limit is one notice per person, kind and day.

    @unit
    Scenario: The first notice of the day is mailed at once to administrators and Billing members
      When "late@acme.example" opens a seat request
      Then "Ada Admin" and "Bill Payer" are mailed about "late@acme.example" at once

    @unit
    Scenario: Each person's notice is mailed at once
      Given a seat request mail about "first@acme.example" went out an hour ago
      When "second@acme.example" opens a seat request
      Then "Ada Admin" and "Bill Payer" are each mailed about "second@acme.example" at once
      And no mail groups the two people together

    @unit
    Scenario: A seat request mail goes out without a link when no public origin is set
      Given the deployment has no public origin configured
      When a seat request mail is sent
      Then it still goes out, without the "Review the request" button

    @unit
    Scenario: A notice whose mail reached nobody is retried by the next arrival that day
      Given "late@acme.example" opened a seat request and no mail about it could be sent
      And the same holds when there was no administrator or Billing member with an address to mail
      When "late@acme.example" arrives again the same day
      Then "Ada Admin" and "Bill Payer" are mailed about "late@acme.example"

    @unit
    Scenario: A notice that reached one recipient is not mailed again that day
      Given a seat request mail about "late@acme.example" reached "Bill Payer" but bounced for "Ada Admin"
      When "late@acme.example" arrives again the same day
      Then no second mail goes out about "late@acme.example"

    @unit
    Scenario: A Lite joiner waiting for a full seat is mailed about once
      Given "lena@acme.example" joined through the company domain as a Lite Member
      And she holds an open seat request for a full seat
      When the administrators are told she joined
      Then they get the seat request mail about her
      And no "joined automatically" mail goes out about her

    @unit
    Scenario: A joiner with a full seat still gets the joined automatically mail
      Given "mel@acme.example" joined through the company domain on a full seat
      When the administrators are told she joined
      Then the "joined automatically" mail goes out about her

    @unit
    Scenario: The same person is noticed at most once a day per kind
      When "late@acme.example" is refused by the identity provider three times in a day
      Then one identity provider refusal notice names "late@acme.example"

    @unit
    Scenario: The seat request mail says when the identity provider also refused the person
      When "late@acme.example" opens a seat request from a sign-in "okta" refused
      Then the mail says to assign them to the LangWatch app in Okta

    @unit
    Scenario: Each mail names the person in its heading and subject
      When "Gus Growth" opens a seat request
      Then the mail's heading says "Gus Growth is waiting for a seat" and its subject starts with it
      When "gus@acme.example" without a name is refused by Okta
      Then the mail's heading and subject say "gus@acme.example tried to sign in to LangWatch"

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
      Then they read "Your organization is over its seat limits. Please contact an administrator to approve your access:"
      And they see each contact's name and email address

    @integration
    Scenario: Administrators see seat requests beside join requests
      Given "late@acme.example" has an open seat request
      When an administrator opens the requests on the Users page
      Then the seat request is listed with Approve and Decline
