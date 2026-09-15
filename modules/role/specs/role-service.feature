Feature: Custom role service
  Custom-role definitions and assignment policy are implemented once.

  @unit
  Scenario: A caller defines a custom role
    Given the name is not reserved
    And every permission is valid
    When the caller creates the role for an organization
    Then the role application writes the role through AuthZ
    And returns the organization-scoped role

  @unit
  Scenario: A role name is already taken in the organization
    Given another role in the organization holds the name
    When the caller creates a role with it
    Then the role application refuses before anything is written

  @unit
  Scenario: A role is requested from another organization
    When a caller gets, updates, or removes it through an organization-scoped operation
    Then the role application throws the same not-found error as for an absent role

  @unit
  Scenario: A caller assigns a role below organization scope
    Given the role contains an organization-exclusive permission
    When the caller assigns it to a team or project scope
    Then the role application refuses before writing a grant

  @unit
  Scenario: A transport authorizes a team assignment
    When it resolves the assignment organization from the team identifier
    Then it reads the organization directory instead of querying persistence
    And an absent team produces the role-owned team-not-found error

  @unit
  Scenario: A role still has holders
    Given a user assignment or AuthZ binding references the role
    When the caller removes it
    Then the role application refuses with the role-in-use error

  @unit
  Scenario: A role deletion races with a new holder
    Given the initial holder check sees no holder
    When a binding appears before the guarded delete
    Then the guarded delete loses
    And the role application reports that the role is in use

  @unit
  Scenario: The role transport moves without changing who may call it
    Given the role and role-binding procedures are declared by the Role package
    When the process mounts them on its own tRPC root
    Then the browser calls the same procedure names as before
    And every procedure declares the same access decision it declared before

  @unit
  Scenario: A caller the organization decision refuses reaches no role data
    Given the caller may not manage the organization
    When they read a role the organization owns
    Then the refusal is forbidden and carries the permission-denied code
    And no role data is answered

  @unit
  Scenario: Another feature needs custom-role behaviour
    When API Key, Organization, or Invite validates a custom role
    Then it calls the process-owned role application
    And it does not import Role or AuthZ persistence
