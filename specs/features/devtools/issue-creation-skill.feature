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

  @integration
  Scenario: Confirms detected type before creating issue
    Given the user runs /create-issue "Refactor the auth module and add OAuth support"
    When the skill detects a type from the description
    Then it displays the detected type and asks the user to confirm or change it
    And waits for user confirmation before creating the issue

  @integration
  Scenario: Creates bug issue with template body sections
    Given the user runs /create-issue "Login page throws 500 error"
    And the user confirms type BUG
    When the skill creates the issue
    Then the created issue has title containing the bug description
    And the issue body contains Describe the bug, To reproduce, and Expected behavior sections
    And the issue is labeled "bug"

  @integration
  Scenario: Creates feature request with template body sections
    Given the user runs /create-issue "Add CSV export for evaluation results"
    And the user confirms type FEAT
    When the skill creates the issue
    Then the issue body contains Problem, Proposed solution, and Alternatives considered sections
    And the issue is labeled "feature"

  @integration
  Scenario: Creates chore with template body sections
    Given the user runs /create-issue "Upgrade Prisma to v6"
    And the user confirms type CHORE
    When the skill creates the issue
    Then the issue body contains Description and Scope sections
    And the issue is labeled "chore"

  @integration
  Scenario: Assigns issue to current GitHub user
    Given the user runs /create-issue "Fix pagination in traces view"
    And the user confirms the detected type
    When the skill creates the issue
    Then the created issue is assigned to the current GitHub user

  @integration
  Scenario: Adds issue to LangWatch Kanban project with default status
    Given the user runs /create-issue "Add dark mode support"
    And the user confirms the detected type
    When the skill creates the issue
    Then the issue appears in project number 5 with Status set to "Backlog"

  @integration
  Scenario: Sets optional project fields when user specifies them
    Given the user runs /create-issue "Add dark mode support" with priority P1 and size M
    And the user confirms the detected type
    When the skill creates the issue
    Then the project Priority field is "P1" and Size field is "M"

  @integration
  Scenario: Sets Epic project field when user specifies an epic category
    Given the user runs /create-issue "Fix trace filtering" with epic "Traces UI/UX Extreme Makeover"
    And the user confirms the detected type
    When the skill creates the issue
    Then the project Epic field is set to "Traces UI/UX Extreme Makeover"

  # --- Sub-issue linking ---

  @integration
  Scenario: Links issue as sub-issue of parent epic
    Given the user runs /create-issue "Fix trace date picker" with parent epic issue 500
    And the user confirms the detected type
    When the skill creates the issue
    Then the new issue appears as a sub-issue of issue 500

  @integration
  Scenario: Skips sub-issue linking when no parent epic specified
    Given the user runs /create-issue "Update README" without specifying a parent epic
    And the user confirms the detected type
    When the skill creates the issue
    Then no sub-issue relationship is created

  # --- Implementation handoff ---

  @integration
  Scenario: Offers to launch implementation after creation
    Given the user runs /create-issue "Add webhook support"
    And the user confirms the detected type
    When the skill finishes creating the issue
    Then it asks the user if they want to run /implement for the new issue

  # --- Error handling ---

  @integration
  Scenario: Shows usage instructions when invoked with no arguments
    When the skill is invoked with no arguments
    Then it shows usage instructions with examples of valid invocations

  @integration
  Scenario: Shows authentication error when not logged in
    Given the gh CLI is not authenticated
    When the skill attempts to create an issue
    Then it shows an error about authentication and does not create an issue

  @integration
  Scenario: Shows access error when project is unreachable
    Given the gh CLI is authenticated but cannot access project 5
    When the skill attempts to create an issue
    Then it shows an error about project access and does not create an issue
