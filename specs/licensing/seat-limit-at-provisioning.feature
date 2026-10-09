Feature: A directory or a first single sign-on never takes a full seat the licence did not sell

  # Ruling (2026-10-09): past the licence's full member seats, an SSO first sign-in
  # or a SCIM create admits the person as a Lite Member; past the Lite Member seats
  # too, the person is held pending (no access, shown to admins). Invitations are
  # refused at the limit (enforcement-members.feature); provisioning is not, because
  # the person already exists in the customer's directory and a refusal loses them.

  Background:
    Given an organization on a signed Enterprise licence
    And a single sign-on connection on that organization with a SCIM token

  Rule: within the seats, provisioning admits a full member

    @integration
    Scenario: A SCIM create within the seats admits a full member
      Given the licence covers more full member seats than are in use
      When the directory creates "within@acme.example"
      Then the directory is answered that the user was created
      And "within@acme.example" is a full member of the organization

  Rule: past the full member seats, the person is admitted as a Lite Member

    @integration
    Scenario: A SCIM create past the seats is admitted, not refused
      Given every full member seat the licence covers is in use
      When the directory creates "over@acme.example"
      Then the directory is answered that the user was created
      And "over@acme.example" is a member of the organization without a full seat

    @integration
    Scenario: A SCIM create past the full seats is admitted as a Lite Member
      Given every full member seat the licence covers is in use
      And a Lite Member seat is free
      When the directory creates "lite@acme.example"
      Then "lite@acme.example" is a Lite Member of the organization
      And "lite@acme.example" can sign in with Lite Member permissions

    @integration @unimplemented
    Scenario: A first single sign-on past the seats is admitted as a Lite Member
      Given every full member seat the licence covers is in use
      And a Lite Member seat is free
      And the connection admits new arrivals automatically
      When "arrival@acme.example" signs in through the connection for the first time
      Then the sign-in succeeds
      And "arrival@acme.example" is a Lite Member of the organization

    @integration @unimplemented
    Scenario: A directory asserting the admin role past the seats takes no full seat
      Given every full member seat the licence covers is in use
      And the directory maps "over-admin@acme.example" to a group holding the admin role
      When the directory creates "over-admin@acme.example"
      Then "over-admin@acme.example" is a Lite Member of the organization
      And "over-admin@acme.example" holds no admin permission

    @integration @unimplemented
    Scenario: Open invitations count toward the seats provisioning may fill
      Given the organization's members and open full seat invitations use every full member seat
      When the directory creates "invited-full@acme.example"
      Then "invited-full@acme.example" is a Lite Member of the organization

  Rule: directory group grants never exceed the seat the person holds

    # Ruling (2026-10-09, R2): with directory group grants on, a person on a Lite or pending row
    # holds group grants capped to what a Lite Member may do, until a full seat is free.

    @unit
    Scenario: A directory group granting admin past the seats is capped to Lite Member permissions
      Given directory group grants are on
      And "capped@acme.example" holds a Lite Member seat because every full member seat is in use
      When the directory maps "capped@acme.example" to a group holding the admin role
      Then "capped@acme.example" holds only Lite Member permissions

    @integration @unimplemented
    Scenario: Admins see that a group grant is capped for want of a full seat
      Given directory group grants are on
      And "capped@acme.example" holds a group grant capped for want of a full seat
      When an admin views the organization's members
      Then admins see that the group grant is capped because no full seat is free

    @unit
    Scenario: A capped group grant lifts once a full seat frees
      Given directory group grants are on
      And "capped@acme.example" holds a group grant capped for want of a full seat
      When a full member seat frees and "capped@acme.example" is given it
      Then "capped@acme.example" holds the group grant's admin permissions

  Rule: past every full and Lite Member seat, the person is held pending

    @integration
    Scenario: A SCIM create past every full and Lite Member seat is held pending
      Given every full member seat and every Lite Member seat the licence covers is in use
      When the directory creates "overflow@acme.example"
      Then the directory is answered that the user was created
      And "overflow@acme.example" is held pending with no access to the organization
      And admins see "overflow@acme.example" among the organization's members

    @integration @unimplemented
    Scenario: A first single sign-on past every seat is held pending
      Given every full member seat and every Lite Member seat the licence covers is in use
      And the connection admits new arrivals automatically
      When "late@acme.example" signs in through the connection for the first time
      Then "late@acme.example" is held pending with no access to the organization

  Rule: error paths never refuse the person and never overfill the seats

    @integration @unimplemented
    Scenario: Two creates racing for the last seat do not both take it
      Given exactly one full member seat is free
      When the directory creates "first@acme.example" and "second@acme.example" at the same moment
      Then exactly one of them is a full member
      And the other is a Lite Member of the organization

    @integration
    Scenario: A retried create past the seats does not promote the person
      Given every full member seat the licence covers is in use
      And the directory created "retry@acme.example" as a Lite Member
      When the directory sends the same create again
      Then "retry@acme.example" is still a Lite Member of the organization
