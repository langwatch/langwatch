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

  # A per-worktree hook only guards the checkouts it was installed in, and an
  # agent's shell in any other worktree ran unguarded: on 2026-09-09 three lanes
  # ran vitest at once and put thirty forks on the machine. The hook stays
  # worktree-local (a machine-wide Claude hook would fire in every repository,
  # haven or not); what is machine-wide is the queue, which already is, and the
  # worker cap, one environment knob like the typecheck slot count. Every
  # worktree haven starts gets the local hook, so "every worktree" no longer
  # depends on remembering setup.

  Scenario: An ungated command gets no decision at all
    Given the gate is registered in a worktree
    When an agent runs a command the gate does not class as heavy
    Then the hook's answer carries no permission decision, so the agent's normal flow proceeds
    And a background agent with nobody to ask is never stopped by it

  Scenario: haven up registers the Claude gate in the worktree it starts
    Given a worktree with no gate registered
    When the developer runs "haven up"
    Then the gate is registered in that worktree's .claude/settings.local.json
    And a later "haven up" adds no duplicate hook
    And a worktree whose registration was removed by hand with "haven setup gate-hook --off" is left alone

  Scenario: The unit test worker cap is one machine-wide setting
    Given HAVEN_TEST_WORKERS is set in the shell, the way HAVEN_TYPECHECK_SLOTS is
    When the gate narrows a vitest or test:unit command in any worktree
    Then the full width it divides among the runs in flight is that setting
    And unset, the full width is derived from the machine's memory and cores
    And "haven slot explain" prints the width and where it came from

  @unit
  Scenario: A command that only mentions a heavy tool is not gated
    Given the gate classifies commands by what they actually invoke, not by substring
    When a command only reads, searches or prints text that happens to name a heavy tool
    Then it is not classed heavy, even when the words vitest, tsc, golangci-lint or typecheck appear in it
    But a command that genuinely runs a heavy tool, however it is wrapped in cd, env, npx, pnpm or make, is still classed heavy

  # A rewrite used to mask the real command from Claude Code's own permission
  # rules: a prefix rule matches "haven run", so an allow rule over-admits and a
  # deny rule never gets to see the command it was written to refuse. It also
  # hid the real command from every log line and prompt. Gating now lives in
  # the heavy tools themselves - the compiler/lint/format/test bin shims and
  # package scripts, which already take a slot through `haven slot run` on
  # their own - so the command the model asked for is exactly the command that
  # runs.
  @unit
  Scenario: The gate never changes the command it admits
    Given a heavy command and a command that is not heavy
    When Claude Code's gate answers either one
    Then the reply carries no updatedInput at all
    And the command that reaches the tool is exactly the command the model asked for
    And a heavy command still gets a system message describing what haven expects to happen
    But only red memory pressure with no slot free produces an explicit deny
