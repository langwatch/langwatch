Feature: Inviting a teammate through a drawer
  As an organization admin
  I want to invite teammates from wherever I am
  So that adding a member is one reachable action, not a buried dialog

  # ---------------------------------------------------------------------------
  # The "Add members" flow is a URL-routed drawer (drawers.md), not a dialog.
  # It is reachable from the members settings page, the command bar (Cmd+K), and
  # an inline email box that opens the drawer already carrying what was typed.
  # Organization + team scoping is preserved end-to-end.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The members page opens the invite drawer
    Given an admin is on the organization members page
    When they choose "Add members"
    Then the invite-member drawer opens

  @integration
  Scenario: The command bar opens the invite drawer
    Given the command bar is open
    When the user runs the "Invite teammate" command
    Then the command bar closes
    And the invite-member drawer opens

  @integration
  Scenario: Typing an email inline opens the drawer carrying that email
    Given an admin is on the organization members page
    When they start typing an email address into the inline invite box
    Then the invite-member drawer opens
    And the drawer's email field is pre-filled with what they typed

  @integration
  Scenario: Inviting through the drawer preserves organization and team scope
    Given the invite-member drawer is open for an organization
    When the admin submits an email with a team assignment
    Then the invite is created against that organization and team
    And the drawer closes on success
