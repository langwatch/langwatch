Feature: Persist the OTLP telemetry exports to the user's shell rc file
  `langwatch login` is auth-only: it never prompts to edit the shell rc,
  because the device session is already authoritative in config.json.

  The shell-rc persist offer instead fires from the `langwatch <tool>`
  wrapper, and ONLY when the tool resolves to Path B (ingestion / direct
  OTLP). At that point the wrapper has computed the tool's OTEL_EXPORTER_*
  env, and offers to install it into the shell rc so a plain `<tool>`
  invocation (without the `langwatch` prefix) inherits the exporter env and
  captures telemetry automatically on every subsequent session.

  As a developer running `langwatch claude` over a subscription (Path B),
  I want to optionally install the telemetry exports once, idempotently,
  with an explicit prompt so I can decline (or decline permanently).

  Background:
    Given the langwatch CLI is installed
    And the user has signed in with `langwatch login`

  Rule: login itself never prompts to persist the shell rc

    Scenario: `langwatch login` is auth-only
      When `langwatch login` completes
      Then the CLI does NOT prompt to persist a shell rc block
      And no edit is made to ~/.zshrc / ~/.bashrc / fish config

  Rule: the offer fires from the wrapper only in ingestion mode

    Scenario: Gateway mode does not offer to persist telemetry exports
      Given `langwatch claude` resolves to gateway mode (Path A)
      When the wrapper finishes setting up
      Then the CLI does NOT prompt to persist a shell rc block

    Scenario: Ingestion mode offers to install the telemetry exports
      Given `langwatch claude` resolves to ingestion mode (Path B)
      And the shell does not already export OTEL_EXPORTER_OTLP_ENDPOINT
      When the wrapper finishes setting up
      Then the CLI offers to install the telemetry exports into the shell rc
      And the prompt is framed as installing telemetry so a plain `claude`
        captures automatically next time

  Rule: The prompt only fires when the shell isn't already configured

    Scenario: Skip the prompt when the OTLP exporter env is already set
      Given the user's current shell already exports OTEL_EXPORTER_OTLP_ENDPOINT
      When `langwatch claude` resolves to ingestion mode
      Then the CLI does NOT prompt to persist the shell rc block

    Scenario: Skip the prompt when the user previously chose "never"
      Given the langwatch config carries `shell_rc_preference: "skip"`
      When `langwatch claude` resolves to ingestion mode
      Then the CLI does NOT prompt

  Rule: The prompt is Y / n / never

    Scenario: Accept Y — install the exports once
      Given the user is on zsh
      And ~/.zshrc does not yet contain the langwatch block
      When `langwatch claude` resolves to ingestion mode
      And the user types "y" at the persistence prompt
      Then ~/.zshrc gains a block bracketed by
        "# >>> langwatch begin >>>" and "# <<< langwatch end <<<"
      And the block exports the OTEL_EXPORTER_OTLP_* telemetry env vars
      And opening a fresh shell sources these vars so a plain `claude`
        captures without re-running `langwatch claude`

    Scenario: Decline "n" — re-prompt next run
      Given ~/.zshrc does not contain the langwatch block
      When `langwatch claude` resolves to ingestion mode
      And the user types "n" at the persistence prompt
      Then ~/.zshrc is unchanged
      And `shell_rc_preference` remains unset
      When the user runs `langwatch claude` in ingestion mode again later
      Then the persistence prompt re-appears

    Scenario: Decline "never" — silence the prompt forever on this machine
      Given ~/.zshrc does not contain the langwatch block
      When `langwatch claude` resolves to ingestion mode
      And the user types "never" at the persistence prompt
      Then the langwatch config persists `shell_rc_preference: "skip"`
      And ~/.zshrc is unchanged
      When the user runs `langwatch claude` in ingestion mode again later
      Then the persistence prompt does NOT re-appear

  Rule: Re-running persistence is idempotent

    Scenario: Second persist run replaces the existing block, no duplicates
      Given ~/.zshrc already contains one langwatch block from a
        previous run
      When the user types "y" at the persistence prompt again
      Then ~/.zshrc still contains exactly one block bracketed by
        the begin/end markers
      And the block reflects the latest telemetry exports

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
      When `langwatch claude` resolves to ingestion mode
      Then the persistence flow is skipped entirely with no error
