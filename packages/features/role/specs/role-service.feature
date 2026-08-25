Feature: Custom role service
  Custom-role definitions and assignment policy are implemented once.

  Scenario: A caller defines a custom role
    Given the name is not reserved
    And every permission is valid
    When the caller creates the role for an organization
    Then the Role service writes the role through AuthZ
    And returns the organization-scoped role

  Scenario: A role is requested from another organization
    When a caller gets, updates, or removes it through an organization-scoped operation
    Then the Role service throws the same not-found error as for an absent role

  Scenario: A caller assigns a role below organization scope
    Given the role contains an organization-exclusive permission
    When the caller assigns it to a team or project scope
    Then the Role service refuses before writing a grant

  Scenario: A role still has holders
    Given a user assignment or AuthZ binding references the role
    When the caller removes it
    Then the Role service refuses with the role-in-use error

  Scenario: A role deletion races with a new holder
    Given the initial holder check sees no holder
    When a binding appears before the guarded delete
    Then the guarded delete loses
    And the Role service reports that the role is in use

  Scenario: Another feature needs custom-role behaviour
    When API Key, Organization, or Invite validates a custom role
    Then it calls the process-owned Role service
    And it does not import Role or AuthZ persistence
