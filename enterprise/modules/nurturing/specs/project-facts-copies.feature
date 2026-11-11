Feature: Nurturing keeps its own copy of personal owners and traced projects, from owners' facts

  Nurturing answers "who owns this personal project" and "has this organization ever traced"
  from rows it owns, written by its peer subscribers from the owners' facts: organization's
  personal-workspace facts and project's listed owners name an owner; trace's traced fact and
  project's listed first messages name a traced project. These copies change no read yet: the
  traits a person is sent are still read where they were. Writing a copy calls no sink, so no
  Customer.io or PostHog request comes from these facts.

  @unit @integration
  Scenario: A new personal workspace leaves one owner row naming its member
    When organization records a personal team for member user-1, delivered twice
    Then nurturing holds one owner row for its project naming user-1
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: A second personal team fact leaves the first owner row unchanged
    Given nurturing holds an owner row for a personal project
    When organization records the same team again with a new project id
    Then the first row is unchanged
    And the new id gets a row of its own, which no project uses

  @unit
  Scenario: Project's listed owners fill the owner rows, and a live row stays as it was
    Given nurturing holds an owner row from a live personal workspace fact
    When project lists that project and another personal project with their owners
    Then the live row keeps its owner
    And the other project gets a row naming its listed owner
    And neither Customer.io nor PostHog receives a request

  @unit @integration
  Scenario: Trace's traced fact leaves one traced row for its organization
    When trace records a project of an organization with no admin as traced, delivered twice
    Then nurturing holds one traced row for that project and answers its organization traced
    And neither Customer.io nor PostHog receives a request

  @unit
  Scenario: A traced fact with no organization writes no row
    When trace records a project whose team is gone as traced
    Then nurturing writes no traced row
    And one line naming the project is logged

  @unit
  Scenario: Project's listed first messages fill the traced rows, and a live row stays as it was
    Given nurturing holds a traced row from trace's live fact
    When project lists that project and another one as having received their first message
    Then each project has exactly one traced row
    And neither Customer.io nor PostHog receives a request
