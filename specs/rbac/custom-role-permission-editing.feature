Feature: Custom role permission editing
  As an organization administrator
  I need to define custom roles from a permission matrix
  So that I can delegate exactly the authority a job needs and nothing more

  The Roles & Permissions settings page lists the three built-in roles beside
  the custom ones an organization has defined, and opens an editor over the
  permission vocabulary the authorization engine grants from.

  Two things about it are load-bearing and easy to get wrong. The permission
  matrix has IMPLICATION RULES — manage covers a resource, and a write needs the
  read beside it — so a click changes more than one box, and a rule that stopped
  firing would produce roles that grant a write nobody can see the result of.
  And the page is an ADMINISTRATION surface: a role definition tells a reader
  which permissions are worth acquiring, so the address is behind
  organization:manage rather than the organization:view every member inherits.

  Background:
    Given an organization on the Enterprise plan
    And a reader who may manage the organization

  # ============================================================================
  # Reaching the page at all
  # ============================================================================

  @integration
  Scenario: Only an organization manager reaches the RBAC pages
    When the reader opens the roles page
    Then the page opens
    And it is framed in the settings chrome

  @integration
  Scenario: A member is refused the RBAC pages
    Given a reader who may only view the organization
    When the reader opens the roles page
    Then the page is refused
    And the refusal names the grant the page needs
    And the refusal is still framed in the settings chrome

  @integration
  Scenario: A reader without the grant cannot create a role
    Given a reader who may only view the organization
    When the roles page renders
    Then the control that creates a role is not offered

  # ============================================================================
  # The Enterprise gate
  # ============================================================================

  @integration
  Scenario: Custom roles are an Enterprise feature
    Given an organization that is not on the Enterprise plan
    When the roles page renders
    Then the page explains that custom roles are an Enterprise feature
    And it offers a way to contact sales
    And no custom role management is shown

  @integration
  Scenario: A plan still arriving shows neither the feature nor the pitch
    Given an organization whose plan has not answered yet
    When the roles page renders
    Then neither the management surface nor the sales block is shown

  @unit
  Scenario: A plan still arriving is neither Enterprise nor refused
    When the application answers the plan question
    Then still-arriving is reported separately from not-Enterprise

  # ============================================================================
  # The built-in roles
  # ============================================================================

  @integration
  Scenario: The three built-in roles are listed beside the custom ones
    When the roles page renders
    Then Admin, Member and Viewer are each shown as a built-in role

  @integration
  Scenario: A built-in role's permissions come from the authorization contract
    When the reader opens a built-in role's permissions
    Then the permissions listed are the ones the authorization engine grants that role

  @unit
  Scenario: A built-in role's permissions dialog under-reports nothing
    Given a built-in role
    Then every offered permission the engine grants it is shown, itself or through manage

  @unit
  Scenario: A built-in role's permissions dialog over-reports nothing
    Given a built-in role
    Then no permission is shown that the engine would refuse it

  @unit
  Scenario: The built-in roles are ordered widest first
    Then everything a Viewer may do a Member may do
    And everything a Member may do an Admin may do

  # ============================================================================
  # The permission matrix
  # ============================================================================

  @unit
  Scenario: Ticking manage grants every action on its resource
    Given an empty permission list
    When the administrator ticks manage on a resource
    Then every action the editor offers on that resource is granted

  @unit
  Scenario: Ticking a write action grants view with it
    Given an empty permission list
    When the administrator ticks create, update or delete on a resource
    Then view on that resource is granted too

  @unit
  Scenario: Unticking view withdraws the writes that depend on it
    Given a role that may view, create, update and delete a resource
    When the administrator unticks view
    Then create, update and delete are withdrawn with it

  @unit
  Scenario: Unticking a write leaves the view it pulled in
    Given a role that was granted a write, and the view that came with it
    When the administrator unticks the write
    Then the view stays

  @unit
  Scenario: Unticking manage withdraws everything it granted
    Given a role that may manage a resource
    When the administrator unticks manage
    Then nothing on that resource is granted

  @unit
  Scenario: A row ticked only because manage is sends its click to manage
    Given a role that may manage a resource
    When the administrator clicks an action that manage already covers
    Then manage is withdrawn, and the resource with it

  @unit
  Scenario: The editor never offers a permission the engine cannot grant
    Then a read-only resource offers only view
    And no offered permission is outside the authorization registry

  # ============================================================================
  # Writing a role
  # ============================================================================

  @integration
  Scenario: An administrator defines a custom role
    When the administrator names a role and picks its permissions
    Then the role is filed against the organization in scope
    And it carries exactly the permissions that were picked

  @integration
  Scenario: Deleting a custom role is confirmed first
    Given a custom role
    When the administrator asks to delete it
    Then the role is named back to them before anything is deleted
    And nothing is deleted until they confirm

  @integration
  Scenario: A refused write is reported to the reader, not swallowed
    When a role cannot be created
    Then the reader is told, and told what they were doing

  @unit
  Scenario: A refusal reaches the reader as the error the server sent
    When a screen reports a failure to the application
    Then the raw error travels, never a sentence the screen composed

  @integration
  Scenario: A role whose details cannot be read reports the failure
    Given a custom role whose details cannot be read
    When the administrator opens its editor
    Then the failure is reported and no empty editor is opened
