Feature: The haven hub — one place to see and act on every stack
  Juggling several worktrees means asking "what is running, how much is it
  costing my machine, and how do I get rid of the one I'm done with?" without
  hunting terminals. The hub TUI answers that in one screen: every stack with
  its health and footprint, and actions on the selected one — open its git
  view, shut it down, or destroy the worktree entirely.

  # Behavior lives in tools/thuishaven: `cmd/hub.go` + `app/hub.go`
  # (DownStack, DestroyWorktree and their guards), `domain/footprint.go`
  # (the memory partitioner) and `adapters/hubtui/` (the TUI itself).
  # Scenarios are bound by Go tests (`go test ./...` in tools/thuishaven):
  # `adapters/hubtui/hubtui_test.go` (TestHubModel: enter/g opens git,
  # d+confirm downs, x+type-the-name destroys) and `app/hub_test.go`
  # (TestDownStack, TestDestroyWorktree with the primary-checkout and
  # running-from refusals). The parity checker
  # (`platform/app/scripts/check-feature-parity.ts`) scans tools/thuishaven's
  # Go tests: @unit scenarios are bound by `// @scenario` annotations above
  # those test funcs; the live-terminal flows remain `@unimplemented`.

  Background:
    Given several worktrees managed by haven, some with running stacks

  @integration @unimplemented
  Scenario: Opening the hub
    When I run bare "haven" in a terminal
    Then I see every registered stack with its liveness, branch, and services
    And the view refreshes itself while it is open

  @integration @unimplemented
  Scenario: Agents get the plain list instead of a TUI
    When an agent runs bare "haven"
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
    Then the stack stops and disappears from the hub and "haven status"
    And its hostnames stop serving it
    And its databases are kept for the next start

  # Boundary with the never-delete-uncommitted-work guardrail: automated
  # cleanup (`haven clean`) never touches a dirty worktree. Destroying one
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

  # --- The whole machine, not just the launchers ---
  # The old footprint was each stack's launcher process group and nothing
  # else — and supervised children lead their OWN groups so it saw only the
  # ~20MB launcher, while the shared database servers, the container VM, the
  # coding agents and the dev tooling never appeared at all. The partitioner
  # reads ONE process listing and attributes every process exactly once:
  # shared servers by what they are, then stack lineage (descendants of a
  # launcher), then agents and tooling, and everything else as its own slice.

  @unit
  Scenario: The hub shows the machine's whole memory picture
    Given stacks, shared database servers, coding agents and dev tooling are all running
    When the hub computes the footprint
    Then each stack is charged its whole process tree
    And the shared servers, agents, tooling and everything else are attributed by what they are
    And no process is ever counted in two buckets

  @unit
  Scenario: A stack is charged its whole process tree, not just its launcher
    Given a stack whose supervised services each lead their own process group
    When the hub computes the footprint
    Then the stack's number includes every descendant of its launcher
    And its own processes are never misfiled as tooling or agents

  @unit
  Scenario: What is not dev work still shows on the chart
    Given the machine also runs browsers and other non-dev processes
    When the hub renders the memory chart
    Then dev work and everything else appear as separate colours against the machine total

  # --- Every worktree, not just the running ones ---
  @unit
  Scenario: Worktrees without a running stack are listed too
    Given a worktree with no registered stack
    When the hub assembles its rows
    Then the worktree appears with its branch, marked as having nothing running
    And the primary checkout and the current worktree are marked protected

  @unit
  Scenario: Idle worktrees stay out of the way while stacks run
    Given stacks are running and idle worktrees exist
    When the hub opens
    Then the worktree list stays hidden behind a one-key toggle
    And with nothing running the worktrees show by default

  @unit
  Scenario: Refreshing the hub is silent
    Given a worktree whose slug cache disagrees with the registry
    When the hub refreshes its rows
    Then nothing is logged over the terminal
    And the destroy path still surfaces the disagreement

  # --- Actions: cleanup, the web view, and the reaping monitor ---
  @unit
  Scenario: Cleanup is one key away
    Given the hub is open in a terminal
    When I press "c"
    Then the hub hands the terminal to the interactive cleanup picker
    And closing the picker returns me to the hub

  @unit
  Scenario: The machine dashboard is one key away
    Given the hub is open in a terminal
    When I press "w"
    Then the machine's web dashboard opens in the browser

  @unit
  Scenario: The daemon's reaping is visible from the hub
    Given the daemon has reaped stacks, containers or processes recently
    When I press "m"
    Then the hub shows the most recent reap events, newest first, with what was reaped and why

  @unit
  Scenario: Reaping is recorded as it happens
    Given the daemon reaps a stack, a test container, or a governed process
    When the reap happens
    Then an event with the kind, target and reason is appended to the record
    And the record keeps only the most recent events, dropping the oldest past its cap

  # --- The web dashboard shows the same machine ---
  @unit
  Scenario: The web dashboard shows the same machine picture
    Given the daemon serves the web dashboard
    When the page renders
    Then the memory chart, the idle worktrees and the recent reaping appear
    And the shared servers are stated once instead of repeating on every stack card
