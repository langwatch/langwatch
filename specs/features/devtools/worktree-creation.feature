Feature: Streamlined worktree creation
  As a developer working on LangWatch
  I want a single command to create git worktrees from issue numbers or feature names
  So that I get consistent branch naming and directory layout without manual steps

  # --- Slug generation (pure logic) ---

  @unit
  Scenario: Derives slug from issue title
    Given an issue title "Pre-suite scenario runs missing from all-runs"
    When the slug is generated
    Then the slug is "pre-suite-scenario-runs-missing-from-all-runs"

  @unit
  Scenario: Truncates slug to 40 characters at word boundary
    Given an issue title "This is a very long issue title that exceeds the maximum allowed slug length"
    When the slug is generated
    Then the slug is at most 40 characters
    And the slug does not end with a hyphen

  @unit
  Scenario: Strips special characters from slug
    Given an issue title "Fix: user's data (broken) #123"
    When the slug is generated
    Then the slug contains only lowercase letters, numbers, and hyphens

  @unit
  Scenario: Builds branch name from issue number
    Given issue number 1663 with slug "pre-suite-scenario-runs-missing-from-all-runs"
    When the branch name is built
    Then the branch name is "issue1663/pre-suite-scenario-runs-missing-from-all-runs"

  @unit
  Scenario: Builds branch name from feature name
    Given feature name "add-dark-mode"
    When the branch name is built
    Then the branch name is "feat/add-dark-mode"

  @unit
  Scenario: Derives directory name from issue branch
    Given branch "issue1663/pre-suite-scenario-runs-missing-from-all-runs"
    When the directory name is derived
    Then the directory is ".worktrees/issue1663-pre-suite-scenario-runs-missing-from-all-runs"

  @unit
  Scenario: Derives directory name from feature branch
    Given branch "feat/add-dark-mode"
    When the directory name is derived
    Then the directory is ".worktrees/feat-add-dark-mode"

  # --- Worktree creation flow (module boundaries, gh/git mocked) ---

  @integration
  Scenario: Creates worktree from issue number
    Given issue 1663 exists with title "Pre-suite scenario runs missing from all-runs"
    And no branch "issue1663/pre-suite-scenario-runs-missing-from-all-runs" exists remotely
    When I run the worktree script with argument "1663"
    Then a worktree is created at ".worktrees/issue1663-pre-suite-scenario-runs-missing-from-all-runs"
    And the worktree branch is "issue1663/pre-suite-scenario-runs-missing-from-all-runs"
    And the branch is based on "origin/main"

  @integration
  Scenario: Creates worktree from feature name
    Given no branch "feat/add-dark-mode" exists remotely
    When I run the worktree script with argument "add-dark-mode"
    Then a worktree is created at ".worktrees/feat-add-dark-mode"
    And the worktree branch is "feat/add-dark-mode"

  @integration
  Scenario: Checks out existing remote branch
    Given branch "issue1663/pre-suite-scenario-runs-missing-from-all-runs" exists remotely
    And issue 1663 exists with title "Pre-suite scenario runs missing from all-runs"
    When I run the worktree script with argument "1663"
    Then the worktree tracks the existing remote branch

  @integration
  Scenario: Copies all .env files to new worktree
    Given .env and .env.local files exist in the current working tree
    When I run the worktree script with argument "add-dark-mode"
    Then all .env* files are copied to the new worktree

  @integration
  Scenario: Warns when .env files are missing from main checkout
    Given no .env files exist in the current working tree
    And .env.example files exist in langwatch/ and langwatch_nlp/
    When I run the worktree script with argument "add-dark-mode"
    Then the worktree is created successfully
    And a warning is printed for each missing .env file
    And the warning suggests copying from .env.example

  @integration
  Scenario: Exits when worktree directory already exists
    Given a worktree already exists at ".worktrees/feat-add-dark-mode"
    When I run the worktree script with argument "add-dark-mode"
    Then the script exits with a non-zero status
    And the error message mentions the existing worktree path

  @integration
  Scenario: Installs dependencies and prints summary with issue URL
    Given issue 1663 exists with title "Pre-suite scenario runs missing from all-runs"
    When I run the worktree script with argument "1663"
    Then "pnpm install" is run in the new worktree
    And the output includes the branch name
    And the output includes the absolute path to the worktree
    And the output includes the issue URL "https://github.com/langwatch/langwatch/issues/1663"

  @integration
  Scenario: Prints summary without issue URL for feature worktrees
    When I run the worktree script with argument "add-dark-mode"
    Then the output includes the branch name
    And the output includes the absolute path to the worktree
    And the output does not include an issue URL

  @integration
  Scenario: Fails gracefully when gh CLI is not available for issue input
    Given the gh CLI is not installed
    When I run the worktree script with argument "1663"
    Then the script exits with a non-zero status
    And the error message mentions the gh CLI requirement

  @integration
  Scenario: Fails when no argument is provided
    When I run the worktree script with no arguments
    Then the script exits with a non-zero status
    And the error message includes usage instructions

  @integration
  Scenario: Fetches from origin before creating worktree
    When I run the worktree script with argument "add-dark-mode"
    Then "git fetch origin" is executed before the worktree is created
