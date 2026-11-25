Feature: A licence replaced by a lower plan or fewer seats refuses what it no longer sells and deletes nothing

  # Downgrade is a change of the stored licence: a replacement for fewer seats,
  # a lower plan, or no licence at all. What the old licence paid for stays
  # stored, so restoring it brings everything back. Neighbouring rules live
  # elsewhere: inviting while over the seats (seat-reconciliation.feature), a
  # SCIM token after the plan lapses (management-apis-enterprise-gate.feature).

  Background:
    Given an organization on a signed Enterprise licence
    And the organization has an admin, two full members, a custom role, a group and a SCIM token

  Rule: a licence for fewer seats removes nobody

    @integration
    Scenario: A licence for fewer seats than are in use keeps every member
      When the licence is replaced by an Enterprise licence for 1 full member seat
      Then all three members remain members with the role they had
      And the organization API still answers the organization

  Rule: a lower plan refuses the Enterprise surfaces by name

    @integration
    Scenario: A lower plan refuses the Enterprise management APIs with the feature asked for
      When the licence is replaced by a Pro licence
      Then the roles, role bindings, SCIM tokens and group APIs answer that an Enterprise plan is required

    @integration
    Scenario: Removing the licence refuses the same APIs
      When the licence is removed from the organization
      Then the roles, role bindings, SCIM tokens and group APIs answer that an Enterprise plan is required

  Rule: nothing is deleted, so restoring the licence restores the organization

    @integration
    Scenario: A lower plan deletes no member, custom role, group or SCIM token
      When the licence is replaced by a Pro licence
      Then every member, the custom role, the group and the SCIM token are still stored

    @integration
    Scenario: Restoring the Enterprise licence answers the custom role again
      Given the licence was replaced by a Pro licence
      When the Enterprise licence is restored
      Then the roles API answers and lists the custom role

  Rule: members keep signing in after a downgrade

    @integration @unimplemented
    Scenario: A member holding a custom role keeps signing in after a lower plan
      Given a member whose only organization role is the custom role
      When the licence is replaced by a Pro licence
      Then the member can still sign in and open the organization
