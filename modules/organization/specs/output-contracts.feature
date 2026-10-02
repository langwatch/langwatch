Feature: The organization tRPC outputs declare exactly what they send
  The member list and the audit log answer with the keys their contract
  declares and main served, so output validation has nothing to log.

  @unit
  Scenario: The member list carries the user's declared columns and no others
    Given an organization member whose stored user has columns the wire does not declare
    When the members are read for the administrators' list
    Then each user carries only the declared columns
    And the stored passkey signup claim hash is never among them

  @unit
  Scenario: An audit log entry declares the before and after states main served
    Given an audit log entry carrying a gateway before and after state
    When the entry is checked against the audit log page contract
    Then the entry is accepted with its before and after states

  @unit
  Scenario: The organization members read returns only the fields the directory shows
    Given an organization whose stored row carries settings, billing and licence fields the directory does not show
    And a member whose stored user carries a personal hash key and tour dates
    When the organization members are read for the directory
    Then the organization carries only its id, its name and its members
    And each member's user carries only its id, name, email, image and deactivation date
    And no member carries team memberships

  @unit
  Scenario: The team reads return only the fields the pickers show
    Given a team whose projects carry more fields than a picker shows
    When the teams are read with their projects
    Then each project carries only its id, name and slug

  @unit
  Scenario: The flat organization members read returns only the fields the pickers show
    Given a stored user carrying a personal hash key, tour dates and a login history
    When the organization's members are read for a picker
    Then each user carries only its id, name, email and deactivation date

  @unit
  Scenario: Accepting an invitation returns only what the accepting browser uses
    Given an accepted invitation whose stored organization carries settings, billing and licence fields
    When the acceptance is answered
    Then it carries the organization's id and name, and the project to land on
    And it carries no other organization field and no invitation field

  @unit
  Scenario: One member's read returns the seat and the fields the person drawer shows
    Given a member whose stored user carries a personal hash key and team memberships
    When the member is read for the person drawer
    Then the user carries only its id, name, email, image, verification flag and deactivation date
    And the member carries no team memberships
