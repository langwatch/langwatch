Feature: boxd Makefile orchestrates per-PR / per-branch / per-issue VM forks
  As a developer working on LangWatch
  I want a single command surface for spinning up testable VMs from PRs, branches, or issues
  So that secrets transit, ports map, and Claude is wired in without manual steps

  # Behavior is in `boxd.mk` and `scripts/boxd-fork.sh`. Tests are bats files
  # at `scripts/__tests__/boxd-fork.unit.bats` (slug, naming, env discovery,
  # hostname rewrite) and `scripts/__tests__/boxd-fork.integration.bats`
  # (mocked boxd / gh / git, asserts the fork → cp → proxy → tmux call
  # sequence). The TS-only parity checker can't bind bash test files, so
  # scenarios stay `@unimplemented` for parity tracking. See specs/setup/
  # docker-dev-worktree-isolation.feature for the same pattern.

  Background:
    Given the boxd CLI is installed and authenticated on the developer's machine
    And gh CLI is authenticated for the langwatch/langwatch repo
    And the canonical "langwatch-golden" VM exists

  # --- Slug rules (#3891 AC#13) ---

  @unit @unimplemented
  Scenario: Slugifier lowercases and strips punctuation
    Given the input "feat/Foo Bar!"
    When boxd_slug runs
    Then the result is "feat-foo-bar"

  @unit @unimplemented
  Scenario: Slugifier truncates to 40 characters with no trailing hyphen
    Given an input longer than 40 characters
    When boxd_slug runs
    Then the result is at most 40 characters
    And the result does not end with a hyphen

  # --- VM naming + collision rule (AC#14) ---

  @unit @unimplemented
  Scenario: fork-issue uses the literal langwatch-issue<N> form
    Given an issue number 42
    When boxd_vm_name runs for the issue source
    Then the VM name is "langwatch-issue42"

  @unit @unimplemented
  Scenario: fork-branch with issue-shaped slug warns and uses langwatch-issue<N>-<rest>
    Given a branch name "issue42/foo-bar"
    When boxd_fork_branch runs
    Then the VM name is "langwatch-issue42-foo-bar"
    And a warning suggests "make boxd-fork-issue ISSUE=42" instead

  # --- Hostname rewrite allowlist (AC#26) ---

  @unit @unimplemented
  Scenario: Stale localhost NEXTAUTH_URL is rewritten to the fork's proxy URL
    Given a .env line "NEXTAUTH_URL=http://localhost:5560"
    When boxd_rewrite_env runs for VM "langwatch-issue42"
    Then the line becomes 'NEXTAUTH_URL="https://langwatch-issue42.boxd.sh"'

  @unit @unimplemented
  Scenario: LW_GATEWAY_BASE_URL routes to the aigw subdomain
    Given a .env line "LW_GATEWAY_BASE_URL=http://localhost:5563"
    When boxd_rewrite_env runs for VM "langwatch-issue42"
    Then the line becomes 'LW_GATEWAY_BASE_URL="https://aigw.langwatch-issue42.boxd.sh"'

  @unit @unimplemented
  Scenario: A real boxd-proxy URL is left untouched
    Given a .env line "NEXTAUTH_URL=https://langwatch-other.boxd.sh"
    When boxd_rewrite_env runs for VM "langwatch-issue42"
    Then the line is unchanged

  # --- Env file discovery (AC#24) ---

  @unit @unimplemented
  Scenario: .env discovery excludes node_modules, .next, dist, build, vendor, coverage, .git
    Given the monorepo has .env files in node_modules/, dist/, vendor/
    When boxd_env_files runs
    Then the result contains no path under those directories

  @unit @unimplemented
  Scenario: .env discovery excludes example/template/sample/local suffixes
    Given the monorepo has .env, .env.example, .env.template, .env.sample, .env.local files
    When boxd_env_files runs
    Then the result contains only ".env" files (no suffix)

  # --- Fork orchestration (AC#10, AC#15) ---

  @integration @unimplemented
  Scenario: fork-issue creates a fork with branch checked out, env uploaded, and tmux running
    Given issue 4242 has a title
    When I run "make boxd-fork-issue ISSUE=4242"
    Then the VM "langwatch-issue4242" is forked from "langwatch-golden"
    And every .env file is uploaded with stale-localhost URLs rewritten
    And ports are mapped (default proxy + aigw + bullboard + ai-server + next)
    And a tmux session "claude-issue4242" is started inside the VM running claude

  @integration @unimplemented
  Scenario: fork-issue errors when the VM already exists
    Given the VM "langwatch-issue4242" already exists
    When I run "make boxd-fork-issue ISSUE=4242"
    Then the target exits non-zero
    And the message points at "boxd destroy" or "make boxd-connect-issue"

  @integration @unimplemented
  Scenario: fork-pr resolves the PR head ref via gh and forks for that branch
    Given a PR 1234 with head ref "feat/from-fork"
    When I run "make boxd-fork-pr PR=1234"
    Then the VM "langwatch-feat-from-fork" is forked from "langwatch-golden"

  # --- Connect targets (AC#18, AC#19, AC#20, AC#21) ---

  @integration @unimplemented
  Scenario: connect-issue errors clearly when the VM does not exist
    Given the VM "langwatch-issue4242" does not exist
    When I run "make boxd-connect-issue ISSUE=4242"
    Then the target exits non-zero
    And the message suggests "make boxd-fork-issue ISSUE=4242"

  @integration @unimplemented
  Scenario: connect-issue errors when the tmux session is missing
    Given the VM "langwatch-issue4242" exists
    And no "claude-issue4242" tmux session is running inside it
    When I run "make boxd-connect-issue ISSUE=4242"
    Then the target exits non-zero
    And the message contains "no claude session"

  @integration @unimplemented
  Scenario: connect-issue wakes a suspended VM before attaching
    Given the VM "langwatch-issue4242" exists and is in standby
    And a "claude-issue4242" tmux session is running inside it
    When I run "make boxd-connect-issue ISSUE=4242"
    Then the VM is resumed
    And SSH + tmux attach proceeds

  # --- Golden lifecycle (AC#5, AC#6) ---

  @integration @unimplemented
  Scenario: golden-reset refuses without explicit confirmation
    When I run "make boxd-golden-reset"
    Then the target exits non-zero
    And the message points at BOXD_FORK_YES=1

  @integration @unimplemented
  Scenario: golden-reset destroys + recreates with confirmation
    Given the VM "langwatch-golden" exists
    When I run "make boxd-golden-reset BOXD_FORK_YES=1"
    Then the existing VM is destroyed
    And a new VM is created with the same name
