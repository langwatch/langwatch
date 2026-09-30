@setup @unit
Feature: haven works with Nx
  Nx caches task results in one per-user cache every worktree shares (ADR-150).
  haven keeps untrusted checkouts out of it, runs the affected typecheck under
  the check slots, and keeps Nx daemons from outliving their worktree.

  Scenario: A trusted worktree leaves the Nx cache location to Nx
    Given a stack from the developer's own worktree
    When its overlay environment is built
    Then it sets none of NX_CACHE_DIRECTORY, NX_WORKSPACE_DATA_DIRECTORY or NX_PROJECT_GRAPH_CACHE_DIRECTORY

  Scenario: An untrusted checkout gets a private Nx cache and no daemon
    Given a stack from a fork under haven pr, or a play sandbox
    When its overlay environment is built
    Then NX_CACHE_DIRECTORY and NX_WORKSPACE_DATA_DIRECTORY point under haven's home for that stack
    And NX_DAEMON is false
    And the install, codegen, prepare and service lanes all carry it

  Scenario: An agent's typecheck is the affected one
    Given an agent runs haven typecheck with no scope flag
    Then it runs nx affected -t typecheck from the merge-base with the branch's upstream, or origin/main
    And --all runs the whole-tree typecheck instead

  Scenario: The affected typecheck holds one slot per parallel task
    Given two check slots are free besides the one it waits for
    When haven typecheck --affected runs
    Then it holds three slots and sets NX_PARALLEL=3
    And with no other slot free it still runs, with NX_PARALLEL=1

  Scenario: down stops the worktree's Nx daemon and nobody else's
    Given Nx daemons run for this worktree and another
    When haven down runs here
    Then only this worktree's daemon is asked to stop, and a failure to stop it is logged, not fatal

  Scenario: An Nx daemon whose worktree is gone is reaped
    Given an Nx daemon serves a worktree that has been deleted
    When the haven daemon ticks
    Then that Nx daemon is stopped and the reap is recorded
    And a daemon whose worktree still exists is left alone
