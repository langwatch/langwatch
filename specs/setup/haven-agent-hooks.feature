@setup @unit
Feature: Optional Haven hooks for coding agents
  Haven installs a gate only for the agent client and worktree explicitly selected.

  Scenario: Codex installs its gate hook in the current worktree
    When I run haven setup codex-gate-hook in a worktree
    Then the gate is registered in that worktree's .codex/hooks.json
    And installing it again adds no duplicate hook
    And other worktrees and Claude settings remain unchanged

  Scenario: Codex setup preserves existing hooks and settings
    Given the worktree already has Codex hooks and feature settings
    When I install the Codex gate hook
    Then existing hooks remain registered
    And existing feature settings are unchanged
    And Codex retains control of hook review and trust

  Scenario: Codex heavy commands use the existing Haven gate
    Given a Codex session already permits its shell command
    When a typecheck needs admission to Haven's heavy-command slot
    Then only the command is rewritten through haven run
    And the hook adds no compiler memory or worker caps
    And an ordinary or undecided command keeps Codex's normal permission flow

  Scenario: Manual checks and agent hooks share admission
    Given a manual Haven check holds the machine's last shared check slot
    When an agent hook starts a heavy command
    Then the agent command waits for that same slot
    And an active agent command also blocks a manual check
    And completion releases the slot for the next caller
