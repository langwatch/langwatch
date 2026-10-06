# Plan: dev/docs/plans/scope-knot-2026-10-06.md
# Ruling: dev/docs/ARCHITECTURE.md section 10.1, the knot paragraph (Alex, 2026-10-05)
# A scenario stays @unimplemented until the batch named in the plan lands and binds it.

Feature: Permission reads come from the session, and a public page holds none
  As a reader of any LangWatch page
  I want "may I do this?" answered by who I am, not by where I am standing
  So that session and scope stop depending on each other, and a public share link
  never shows a control its viewer may not use.

  The session capability (auth) answers hasPermission and hasOrganizationPermission.
  The scope capability (organization) answers which organization, team and project
  this page is about, and answers no permission. A public page (the shared trace)
  mounts an explicit no-session answer: every permission reads as not held there,
  for a signed-out visitor and a signed-in member alike, as on main.

  Background:
    Given the browser application mounts the shell and every installed module host around every routed page

  # ---------------------------------------------------------------------------
  # The session answers permissions (plan batch 1)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The session answers an organization permission on its own
    Given the reader can manage a project but cannot manage its organization
    When a screen asks the session whether the reader may manage the organization
    Then the answer is no
    And asking the session whether the reader may manage the project answers yes

  @integration
  Scenario: An organization permission is still unanswered while the organization's grants load
    Given the organization's grant read has not answered
    When a screen asks the session for an organization permission
    Then the answer is no
    And the session does not report itself settled

  # ---------------------------------------------------------------------------
  # No module host shadows the shell's scope (plan batch 3)
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: An organization permission reads the same under every module host
    Given the reader can manage a project but cannot manage its organization
    And the trace and scenario module hosts are mounted around the page
    When a screen inside them asks whether the reader may manage the organization
    Then the answer is no

  @integration @unimplemented
  Scenario: The demo project is recognised under every module host
    Given the address names the deployment's demo project
    And the trace and scenario module hosts are mounted around the page
    When a screen inside them reads whether it is standing in the demo project
    Then it reads yes

  # ---------------------------------------------------------------------------
  # A public page holds no permission (plan batch 2)
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: A signed-out visitor on a shared trace holds no permission
    Given nobody is signed in
    When the visitor opens a valid shared trace link
    Then the shared trace renders
    And every permission any screen on the page asks reads as not held
    And no grant read is sent

  @integration
  Scenario: A signed-in member on a shared trace holds no permission there either
    Given a signed-in reader who may update traces in the shared trace's project
    When they open the shared trace link
    Then asking whether they may update traces reads as not held
    And no grant read is sent for the shared trace's project

  @integration @unimplemented
  Scenario Outline: Every module host on a shared trace answers no permission
    Given a signed-in reader who holds every permission in the shared trace's project
    When the shared trace page asks the <module> host whether the reader may <permission>
    Then the answer is no

    Examples:
      | module   | permission       |
      | trace    | update traces    |
      | trace    | manage datasets  |
      | scenario | view scenarios   |

  @integration @unimplemented
  Scenario: A shared trace offers no control that changes the trace
    Given a signed-in reader who may update and annotate traces in the shared trace's project
    When they open the shared trace link
    Then the page offers no annotate, edit or add-to-dataset control

  @integration
  Scenario: A shared trace renders while the session read has not answered
    Given the session read has not answered yet
    When a visitor opens a valid shared trace link
    Then the visitor is not sent to sign in
    And every permission reads as not held

  @integration @unimplemented
  Scenario: An unknown or revoked share link holds no permission
    Given a share link whose token names no shared trace
    When a visitor opens it
    Then the page says the link no longer works
    And no grant read is sent

  @integration
  Scenario: Leaving a shared trace for a project page reads the reader's own grants again
    Given a signed-in reader who may update traces in their own project
    And they are on a shared trace page
    When they navigate to their own project's traces page
    Then the grant read for their own project is sent
    And asking whether they may update traces there reads as held

  # ---------------------------------------------------------------------------
  # Call sites move onto the session (plan batch 4)
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Agent Testing asks the session rather than sending its own grant read
    Given the session has answered the reader's grants in the active project
    When the Agent Testing page decides which actions to offer
    Then no second grant read is sent for that project
    And the actions it offers match the session's answer

  @integration @unimplemented
  Scenario: A migrated screen answers a signed-in reader the same as before
    Given a signed-in reader whose role grants some permissions and not others in the active project
    When a screen that read a permission through the legacy scope hook reads it from its module host instead
    Then every permission it asks reads as it did through the legacy scope hook

  # ---------------------------------------------------------------------------
  # The scope capability carries no permission (plan batch 5)
  # ---------------------------------------------------------------------------

  @unit @unimplemented
  Scenario: The scope capability resolves without the session's grants
    Given the session's grant reads have not answered
    When the scope capability resolves the organization, team and project from the address
    Then the scope reads ready with that project
    And the scope reading carries no permission answer of its own

  @unit @unimplemented
  Scenario: The legacy scope hook offers no permission answer
    Given the legacy organization, team and project hook
    When a screen reads it
    Then the reading names the organization, team, project, role and demo flag
    And it offers no permission answer
