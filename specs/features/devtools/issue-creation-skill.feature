Feature: Standardized GitHub issue creation via /create-issue skill
  As a developer working on LangWatch
  I want a single command to create well-structured GitHub issues
  So that issues follow templates, get proper labels and project fields, and link to epics consistently

  Background:
    Given a SKILL.md file exists at .claude/skills/create-issue/SKILL.md
    And the skill is user-invocable via /create-issue

  # This is a Claude Code skill (markdown instructions), not application code.
  # The skill instructs Claude to use `gh` CLI commands.
  # Testing is manual/behavioral — scenarios document expected behavior.

  # --- Design documentation (not executable tests) ---
  # The skill defines five issue types: BUG, FEAT, PROPOSAL, EPIC, CHORE
  # Type → Template: BUG→bug-report.md, FEAT→feature-request.md, PROPOSAL→feature-request.md, EPIC→feature-request.md, CHORE→chore.md
  # Type → Label: BUG→bug, FEAT→feature, PROPOSAL→proposal, EPIC→epic, CHORE→chore

  # --- Issue creation workflow ---

  @integration @unimplemented
  Scenario: Assigns issue to current GitHub user
    Given the user runs /create-issue "Fix pagination in traces view"
    And the user confirms the detected type
    When the skill creates the issue
    Then the created issue is assigned to the current GitHub user

  @integration @unimplemented
  Scenario: Adds issue to LangWatch Kanban project with default status
    Given the user runs /create-issue "Add dark mode support"
    And the user confirms the detected type
    When the skill creates the issue
    Then the issue appears in project number 5 with Status set to "Backlog"

  @integration @unimplemented
  Scenario: Offers to launch implementation after creation
    Given the user runs /create-issue "Add webhook support"
    And the user confirms the detected type
    When the skill finishes creating the issue
    Then it asks the user if they want to run /implement for the new issue

  # --- Error handling ---

  @integration @unimplemented
  Scenario: Shows usage instructions when invoked with no arguments
    When the skill is invoked with no arguments
    Then it shows usage instructions with examples of valid invocations

  @integration @unimplemented
  Scenario: Shows authentication error when not logged in
    Given the gh CLI is not authenticated
    When the skill attempts to create an issue
    Then it shows an error about authentication and does not create an issue

  @integration @unimplemented
  Scenario: Shows access error when project is unreachable
    Given the gh CLI is authenticated but cannot access project 5
    When the skill attempts to create an issue
    Then it shows an error about project access and does not create an issue
