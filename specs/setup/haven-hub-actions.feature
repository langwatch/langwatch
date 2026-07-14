Feature: The haven hub — one place to see and act on every stack
  Juggling several worktrees means asking "what is running, how much is it
  costing my machine, and how do I get rid of the one I'm done with?" without
  hunting terminals. The hub TUI answers that in one screen: every stack with
  its health and footprint, and actions on the selected one — open its git
  view, shut it down, or destroy the worktree entirely.

  Background:
    Given several worktrees managed by haven, some with running stacks

  Scenario: Opening the hub
    When I run "haven hub" (or bare "haven") in a terminal
    Then I see every registered stack with its liveness, branch, and services
    And the view refreshes itself while it is open

  Scenario: Agents get the plain list instead of a TUI
    When an agent runs "haven hub"
    Then the plain stack list is printed
    And no interactive UI is started

  Scenario: Jumping into a stack's git view from the hub
    Given a stack is selected in the hub
    When I press enter (or "g")
    Then the git TUI opens for that stack's worktree
    And quitting the git TUI returns me to the hub

  Scenario: Shutting a stack down from the hub
    Given a running stack is selected in the hub
    When I press "d" and confirm
    Then its launcher is stopped and its routes and registry entry are removed
    And its databases are kept for the next start

  Scenario: Destroying a worktree from the hub
    Given a stack is selected in the hub
    When I press "x" and type the stack's name to confirm
    Then the stack is shut down
    And its ClickHouse and Postgres databases are dropped
    And the worktree directory is deleted even if it had uncommitted changes

  Scenario: Destruction requires typing the name
    Given a stack is selected in the hub
    When I press "x" and type anything other than the stack's name
    Then nothing is destroyed

  Scenario: The primary checkout can never be destroyed
    Given the selected entry is the repository's primary checkout
    When I try to destroy it
    Then the hub refuses and explains why

  Scenario: The worktree the hub runs from can never be destroyed
    Given the selected entry is the worktree I launched haven from
    When I try to destroy it
    Then the hub refuses and explains why
