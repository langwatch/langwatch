Feature: Persist the OTLP telemetry exports so `<tool>` captures automatically
  `langwatch login` is auth-only: it never prompts to persist telemetry
  env, because the device session is already authoritative in config.json.

  The persist offer instead fires from the `langwatch <tool>` wrapper, and
  ONLY when the tool resolves to Path B (ingestion / direct OTLP). At that
  point the wrapper has computed the tool's OTEL_EXPORTER_* env, and offers
  to install it so a plain `<tool>` invocation (without the `langwatch`
  prefix) inherits the exporter env and captures telemetry automatically
  on every subsequent session.

  For tools with a native app-scoped env block (currently: `claude` →
  `~/.claude/settings.json`'s `env` object) the wrapper writes there rather
  than the profile-root shell rc — Claude Code reads the block on every
  invocation, so a plain `claude` picks it up without editing `.zshrc` and
  leaking the vars into every other shell child. For tools with no such
  block (codex, cursor, gemini, opencode) the offer falls back to the
  detected shell rc file.

  As a developer running `langwatch claude` over a subscription (Path B),
  I want to optionally install the telemetry exports once, idempotently,
  with an explicit prompt so I can decline (or decline permanently).

  Background:
    Given the langwatch CLI is installed
    And the user has signed in with `langwatch login`

  Rule: login itself never prompts to persist telemetry env

    Scenario: `langwatch login` is auth-only
      When `langwatch login` completes
      Then the CLI does NOT prompt to persist a telemetry env block
      And no edit is made to ~/.claude/settings.json, ~/.zshrc, ~/.bashrc,
        or the fish config

  Rule: the offer fires from the wrapper only in ingestion mode

    Scenario: Gateway mode does not offer to persist telemetry exports
      Given `langwatch claude` resolves to gateway mode (Path A)
      When the wrapper finishes setting up
      Then the CLI does NOT prompt to persist a telemetry env block

    Scenario: Ingestion mode offers to install the telemetry exports
      Given `langwatch claude` resolves to ingestion mode (Path B)
      And the shell does not already export OTEL_EXPORTER_OTLP_ENDPOINT
      When the wrapper finishes setting up
      Then the CLI offers to install the telemetry exports
      And the prompt is framed as installing telemetry so a plain `claude`
        captures automatically next time

  Rule: The prompt only fires when the target isn't already configured

    Scenario: Skip the prompt when the OTLP exporter env is already set
      Given the user's current shell already exports OTEL_EXPORTER_OTLP_ENDPOINT
      When `langwatch claude` resolves to ingestion mode
      Then the CLI does NOT prompt to persist the telemetry env block

    Scenario: Skip the prompt when the user previously chose "never"
      Given the langwatch config carries `shell_rc_preference: "skip"`
      When `langwatch claude` resolves to ingestion mode
      Then the CLI does NOT prompt

  Rule: `langwatch claude` persists to ~/.claude/settings.json (native env block)

    Scenario: Persist target for claude is the Claude Code settings file
      Given `langwatch claude` resolves to ingestion mode
      And ~/.claude/settings.json does not yet carry the OTLP exporter env
      When the wrapper offers to persist telemetry exports
      Then the prompt names "~/.claude/settings.json" as the target
      And the prompt does NOT name ~/.zshrc, ~/.bashrc, or the fish config
      # Rationale: dumping LANGWATCH env into the shell rc leaks the vars into
      # every other shell child. Claude Code reads the `env` block on every
      # invocation, so writing there scopes the telemetry to `claude` runs
      # only and leaves the profile root clean.

    Scenario: Accept Y — merge the OTEL keys into settings.json's env block
      Given ~/.claude/settings.json already contains user-authored settings
      When the user types "y" at the persistence prompt
      Then the file's top-level `env` object gains every OTEL_EXPORTER_OTLP_*
        key with the run's computed values
      And every other top-level key the user had (permissions, hooks, model,
        …) is preserved verbatim
      And opening a plain `claude` picks up the merged env on next run

    Scenario: Create ~/.claude/settings.json when it doesn't exist yet
      Given ~/.claude does not exist
      When the user types "y" at the persistence prompt
      Then ~/.claude is created
      And ~/.claude/settings.json is written with exactly the OTEL keys
        under an `env` object and no other user content invented

    Scenario: Skip the prompt when settings.json already carries every OTEL key
      Given ~/.claude/settings.json's `env` object already contains every
        OTEL_EXPORTER_OTLP_* key with the current values
      When `langwatch claude` resolves to ingestion mode
      Then the CLI does NOT prompt to persist

    Scenario: A stale env block from a previous run is refreshed, not duplicated
      Given ~/.claude/settings.json's `env` object holds a subset of the
        current OTEL keys (or old endpoint URLs)
      When the user types "y" at the persistence prompt
      Then the file's `env` object reflects the LATEST OTEL values verbatim
      And no duplicate keys or stale entries survive

  Rule: Other wrappers still fall back to the shell rc

    Scenario Outline: Tools without an app-scoped env block use the shell rc
      Given the user runs `langwatch <tool>` and it resolves to ingestion mode
      When the wrapper offers to persist telemetry exports
      Then the prompt names the detected shell rc file as the target

      Examples:
        | tool      |
        | codex     |
        | cursor    |
        | gemini    |
        | opencode  |

  Rule: The prompt is Y / n / never

    Scenario: Decline "n" — re-prompt next run
      Given the persist target does not yet carry the langwatch env
      When `langwatch claude` resolves to ingestion mode
      And the user types "n" at the persistence prompt
      Then the persist target is unchanged
      And `shell_rc_preference` remains unset
      When the user runs `langwatch claude` in ingestion mode again later
      Then the persistence prompt re-appears

    Scenario: Decline "never" — silence the prompt forever on this machine
      Given the persist target does not yet carry the langwatch env
      When `langwatch claude` resolves to ingestion mode
      And the user types "never" at the persistence prompt
      Then the langwatch config persists `shell_rc_preference: "skip"`
      And the persist target is unchanged
      When the user runs `langwatch claude` in ingestion mode again later
      Then the persistence prompt does NOT re-appear

  Rule: Shell-rc fallback covers zsh, bash, and fish

    Scenario Outline: Pick the right rc file per detected shell (fallback tools)
      Given the user's $SHELL is "<shell>"
      And the user runs `langwatch codex` in ingestion mode
      When the user types "y" at the persistence prompt
      Then the langwatch block is written to "<rc_path>"

      Examples:
        | shell         | rc_path                        |
        | /bin/zsh      | ~/.zshrc                       |
        | /bin/bash     | ~/.bashrc                      |
        | /usr/bin/fish | ~/.config/fish/config.fish     |

    Scenario: Second shell-rc persist run replaces the existing block
      Given ~/.zshrc already contains one langwatch block from a previous run
      When the user types "y" at the persistence prompt again
      Then ~/.zshrc still contains exactly one block bracketed by
        the begin/end markers
      And the block reflects the latest telemetry exports

    Scenario: Unsupported shells skip silently (for shell-rc fallback tools)
      Given the user's $SHELL points at an unsupported shell
        (cmd, powershell, nushell, etc.)
      And the user runs `langwatch codex` in ingestion mode
      Then the persistence flow is skipped entirely with no error
