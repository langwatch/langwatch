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
  Scenario: A created role is readable as soon as its creation answers
    When the caller creates a role
    Then the role application waits for the role to be projected before answering
    And a read straight after the answer finds the role

  @unit
  Scenario: A role creation the projection cannot confirm in time is refused
    Given the role projection does not land the role within the wait
    When the caller creates a role
    Then the creation fails with the handled grant-not-confirmed error
    And no created role is answered

  @unit
  Scenario: A second role with a name already taken is refused with a conflict
    Given a role creation has answered for a name
    When the caller creates another role with the same name
    Then the role application refuses with the name-taken conflict

  @unit
  Scenario: A role definition whose name another live role holds cannot stall the fold
    Given another live role in the organization holds the name
    When the fold projects a definition carrying that name
    Then the definition is skipped rather than failing on the unique name
    And no compatibility role row is written for it

  @unit
  Scenario: A deleted role's name can be taken by a new role
    Given a role in the organization was deleted
    When a new role is defined with the deleted role's name
    Then the name is free, because a role name is unique among live roles only

  @unit
  Scenario: A redelivered role definition does not bring back a deleted role
    Given the role head is deleted
    When an older definition of the role is delivered again
    Then no compatibility role row is written for it

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

  @unit
  Scenario: A custom role is not assigned or removed on a personal workspace
    Given the team is a member's personal workspace
    When the caller assigns a custom role on it, or takes one away
    Then the role application refuses with the personal-workspace error naming the workspace
    And no grant is written
