Feature: Role binding audit
  As an organization administrator
  I need to see every role binding in my organization on one page
  So that I can answer "who can do what, and where" without querying the database

  The Role Bindings settings page reads every binding in an organization and
  groups them by the principal that holds them: a person with four bindings is
  one row to a reader, even though it is four rows on the wire.

  The payload names every user, every group and every scope in the organization,
  which is why the address is behind organization:manage, and why the page is an
  Enterprise feature rather than one every plan carries.

  Background:
    Given an organization on the Enterprise plan
    And a reader who may manage the organization

  @integration
  Scenario: The bindings audit is an Enterprise feature
    Given an organization that is not on the Enterprise plan
    When the role bindings page renders
    Then it offers a way to contact sales
    And no binding is read at all

  @integration
  Scenario: The audit reads every binding in the organization
    When the role bindings page renders
    Then the bindings are read for the organization in scope

  @unit @integration
  Scenario: Every binding a principal holds reads as one row
    Given a member with bindings at more than one scope
    When the audit is rendered
    Then the member appears once
    And every binding they hold is shown beside them

  @unit
  Scenario: A binding with no principal still appears on the audit
    Given a binding held by an API key rather than a person or a group
    When the audit is rendered
    Then the binding still appears

  @unit @integration
  Scenario: The scope filter narrows the audit to one tier
    Given bindings at the organization, team and project tiers
    When the reader picks one tier
    Then only bindings at that tier are shown
    And picking All shows them again
