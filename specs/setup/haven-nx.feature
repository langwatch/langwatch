@setup @unit
Feature: haven works with Nx
  Nx caches task results in one per-user cache every worktree shares (ADR-150).
  haven keeps untrusted checkouts out of it, runs the typecheck under a check
  slot, and keeps Nx daemons from outliving their worktree.

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
    Given an agent runs haven machine typecheck --affected, or with no scope flag
    Then it runs the root pnpm typecheck, one incremental tsc -b, under one check slot
    And it sets no NX_PARALLEL, because no per-project Nx typecheck runs

  Scenario: down stops the worktree's Nx daemon and nobody else's
    Given Nx daemons run for this worktree and another
    When haven down runs here
    Then only this worktree's daemon is asked to stop, and a failure to stop it is logged, not fatal

  Scenario: An Nx daemon whose worktree is gone is reaped
    Given an Nx daemon serves a worktree that has been deleted
    When the haven daemon ticks
    Then that Nx daemon is stopped and the reap is recorded
    And a daemon whose worktree still exists is left alone

  Scenario: Every task in an Nx run carries the run id and worktree
    Given the haven Nx plugin is registered in nx.json
    When an Nx run starts its tasks
    Then each task's environment has HAVEN_NX_RUN, a time-first id that sorts by start
    And HAVEN_NX_WORKTREE names the worktree the run is in

  Scenario: An Nx run leaves one history row per task
    Given an Nx run finished with a built task and a cache hit
    When the run ends
    Then haven's nx-history.jsonl gains one row per task with project, target, status, duration in ms, cache hit, run id and worktree
    And a task restored from the cache is marked as a cache hit
    And run-history.jsonl and the gate's wait estimates are untouched
    And nx-history.jsonl keeps only its newest 5000 rows

  Scenario: An Nx run never fails because haven is missing
    Given haven is not on PATH, or its history command fails
    When an Nx run ends
    Then the run keeps its own exit status
    And a missing haven prints nothing, a failing one prints one line
