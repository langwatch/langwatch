Feature: The haven hub — one place to see and act on every stack
  Juggling several worktrees means asking "what is running, how much is it
  costing my machine, and how do I get rid of the one I'm done with?" without
  hunting terminals. The hub TUI answers that in one screen: every stack with
  its health and footprint, and actions on the selected one — open its git
  view, shut it down, or destroy the worktree entirely.

  # Behavior lives in tools/thuishaven: `cmd/hub.go` + `app/hub.go`
  # (DownStack, DestroyWorktree and their guards) and `adapters/hubtui/`
  # (the TUI itself). Scenarios are bound by Go tests (`go test ./...` in
  # tools/thuishaven): `adapters/hubtui/hubtui_test.go` (TestHubModel:
  # enter/g opens git, d+confirm downs, x+type-the-name destroys) and
  # `app/hub_test.go` (TestDownStack, TestDestroyWorktree with the
  # primary-checkout and running-from refusals). The parity checker
  # (`langwatch/scripts/check-feature-parity.ts`) scans tools/thuishaven's
  # Go tests: @unit scenarios are bound by `// @scenario` annotations above
  # those test funcs; the live-terminal flows remain `@unimplemented`.

  Background:
    Given several worktrees managed by haven, some with running stacks

  @integration @unimplemented
  Scenario: Opening the hub
    When I run "haven hub" (or bare "haven") in a terminal
    Then I see every registered stack with its liveness, branch, and services
    And the view refreshes itself while it is open

  @integration @unimplemented
  Scenario: Agents get the plain list instead of a TUI
    When an agent runs "haven hub"
    Then the plain stack list is printed
    And no interactive UI is started

  @unit
  Scenario: Jumping into a stack's git view from the hub
    Given a stack is selected in the hub
    When I press enter (or "g")
    Then the git TUI opens for that stack's worktree
    And quitting the git TUI returns me to the hub

  @unit
  Scenario: Shutting a stack down from the hub
    Given a running stack is selected in the hub
    When I press "d" and confirm
    Then the stack stops and disappears from the hub and "haven list"
    And its hostnames stop serving it
    And its databases are kept for the next start

  # Boundary with the never-delete-uncommitted-work guardrail: automated
  # cleanup (`haven prune`) never touches a dirty worktree. Destroying one
  # is only possible here, where a person deliberately types the stack's
  # exact name to confirm — that explicit confirmation is the sanctioned
  # exception, not a loophole in the guardrail.
  @unit
  Scenario: Destroying a worktree from the hub
    Given a stack is selected in the hub
    When I press "x" and type the stack's name to confirm
    Then the stack is shut down
    And its ClickHouse and Postgres databases are dropped
    And the worktree directory is deleted even if it had uncommitted changes

  @unit
  Scenario: Destruction requires typing the name
    Given a stack is selected in the hub
    When I press "x" and type anything other than the stack's name
    Then nothing is destroyed

  @unit
  Scenario: The primary checkout can never be destroyed
    Given the selected entry is the repository's primary checkout
    When I try to destroy it
    Then the hub refuses and explains why

  @unit
  Scenario: The worktree the hub runs from can never be destroyed
    Given the selected entry is the worktree I launched haven from
    When I try to destroy it
    Then the hub refuses and explains why
