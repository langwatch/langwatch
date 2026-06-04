Feature: Persist the langwatch export block to the user's shell rc file
  After `langwatch login` succeeds, the CLI offers to persist the
  union export block (one block covering claude, codex, cursor,
  gemini, opencode) to the user's shell rc file so a brand new shell
  auto-picks up the gateway + OTLP env vars and the developer can
  invoke `claude`, `codex`, `cursor`, `gemini`, or `opencode`
  directly — without the `langwatch <tool>` wrapper prefix — on
  every subsequent session.

  As a developer who just signed into LangWatch through the device
  flow, I want the export block written to my shell rc once,
  idempotently, with an explicit prompt so I can decline (or decline
  permanently) when I don't want it.

  Background:
    Given the langwatch CLI is installed
    And the user has just completed `langwatch login --device`

  Rule: The prompt only fires when the shell isn't already configured

    Scenario: Skip the prompt when the export block is already sourced
      Given the user's current shell has both ANTHROPIC_BASE_URL
        and ANTHROPIC_AUTH_TOKEN exported
      When `langwatch login` completes
      Then the CLI does NOT prompt to persist the shell rc block
      And no edit is made to ~/.zshrc / ~/.bashrc / fish config

    Scenario: Skip the prompt when the user previously chose "never"
      Given the langwatch config carries `shell_rc_preference: "skip"`
      When `langwatch login` completes
      Then the CLI does NOT prompt
      And no edit is made to ~/.zshrc / ~/.bashrc / fish config

  Rule: The prompt is Y / n / never

    Scenario: Accept Y — write the block once
      Given the user is on zsh
      And ~/.zshrc does not yet contain the langwatch block
      When `langwatch login` completes
      And the user types "y" at the persistence prompt
      Then ~/.zshrc gains a block bracketed by
        "# >>> langwatch begin >>>" and "# <<< langwatch end <<<"
      And the block exports ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN,
        OPENAI_BASE_URL, OPENAI_API_KEY, GOOGLE_GEMINI_BASE_URL,
        GEMINI_API_KEY, and the OTLP env vars
      And opening a fresh shell sources these vars without re-running
        `langwatch <tool>`

    Scenario: Decline "n" — re-prompt next login
      Given ~/.zshrc does not contain the langwatch block
      When `langwatch login` completes
      And the user types "n" at the persistence prompt
      Then ~/.zshrc is unchanged
      And `shell_rc_preference` remains unset
      When the user runs `langwatch login` again later
      Then the persistence prompt re-appears

    Scenario: Decline "never" — silence the prompt forever on this machine
      Given ~/.zshrc does not contain the langwatch block
      When `langwatch login` completes
      And the user types "never" at the persistence prompt
      Then the langwatch config persists `shell_rc_preference: "skip"`
      And ~/.zshrc is unchanged
      When the user runs `langwatch login` again later
      Then the persistence prompt does NOT re-appear

  Rule: Re-running persistence is idempotent

    Scenario: Second persist run replaces the existing block, no duplicates
      Given ~/.zshrc already contains one langwatch block from a
        previous run
      When `langwatch login` completes and the user types "y" again
      Then ~/.zshrc still contains exactly one block bracketed by
        the begin/end markers
      And the block reflects the latest set of wrapped tools

  Rule: Shell detection covers zsh, bash, and fish

    Scenario Outline: Pick the right rc file per detected shell
      Given the user's $SHELL is "<shell>"
      When the user types "y" at the persistence prompt
      Then the langwatch block is written to "<rc_path>"

      Examples:
        | shell    | rc_path                          |
        | /bin/zsh | ~/.zshrc                         |
        | /bin/bash| ~/.bashrc                        |
        | /usr/bin/fish | ~/.config/fish/config.fish  |

    Scenario: Unsupported shells skip silently
      Given the user's $SHELL points at an unsupported shell
        (cmd, powershell, nushell, etc.)
      When `langwatch login` completes
      Then the persistence flow is skipped entirely with no error
