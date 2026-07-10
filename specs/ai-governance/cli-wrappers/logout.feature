Feature: `langwatch logout` clears credentials AND the telemetry wiring
  `langwatch <tool>` (Path B) persists telemetry exports into several
  places so a plain `<tool>` keeps capturing: claude's env block in
  `~/.claude/settings.json`, codex's `[otel]` block in
  `~/.codex/config.toml`, and scoped shell functions in the profile rc
  for gemini / opencode. `langwatch login --device` separately writes
  the device session to `~/.langwatch/config.json`.

  Logging out must undo BOTH halves. Revoking the token while leaving
  the exporters wired is worse than doing nothing: every subsequent
  `claude` / `codex` / `gemini` / `opencode` run keeps firing OTLP at
  LangWatch with a now-revoked token, failing silently on every call.

  So `langwatch logout` server-revokes + clears the device session AND
  discovers every langwatch-authored telemetry block and removes it. It
  only ever touches regions it wrote itself: the marker-bracketed blocks
  (`# >>> langwatch ... begin >>>`) and the known OTEL key set in
  settings.json. User-authored config around them is preserved verbatim.

  As a developer who set up several coding assistants through LangWatch,
  I want one command to fully unwire my machine, so I can hand it back or
  switch accounts without stale exporters or leftover credentials.

  Background:
    Given the langwatch CLI is installed

  Rule: logout revokes and clears the device session

    Scenario: A logged-in session is revoked and the local config cleared
      Given the user signed in with `langwatch login --device`
      When the user runs `langwatch logout`
      Then the device refresh token is server-revoked
      And ~/.langwatch/config.json no longer carries the session

    Scenario: logout is idempotent when not logged in
      Given there is no device session on disk
      When the user runs `langwatch logout`
      Then the command exits successfully without error
      And it still scans for and removes any telemetry wiring present

    Scenario: a failed server revoke still clears local state
      Given the user has a device session
      And the control plane is unreachable
      When the user runs `langwatch logout`
      Then a warning is printed that the server revoke failed
      And the local session is cleared anyway

  Rule: logout removes every langwatch-authored telemetry block it finds

    Scenario: claude OTEL keys are stripped from settings.json, user keys kept
      Given ~/.claude/settings.json has an `env` object with the
        langwatch OTEL keys alongside a user-authored key
      When the user runs `langwatch logout`
      Then the OTEL_EXPORTER_OTLP_* and CLAUDE_CODE_ENABLE_TELEMETRY keys
        are removed from the `env` object
      And the user-authored key is preserved verbatim
      And every other top-level settings key is preserved verbatim

    Scenario: an env object left empty after stripping is removed, not left as `{}`
      Given ~/.claude/settings.json's `env` object holds ONLY the
        langwatch OTEL keys
      When the user runs `langwatch logout`
      Then the `env` key is removed entirely
      And no empty `env: {}` is left behind

    Scenario: the codex [otel] and gateway marker blocks are removed
      Given ~/.codex/config.toml carries the langwatch `[otel]` marker
        block and a user-authored `model = "gpt-5"` line
      When the user runs `langwatch logout`
      Then the langwatch marker-bracketed blocks are removed
      And the user-authored `model` line is preserved verbatim

    Scenario: the codex langwatch profile file is removed
      Given a langwatch codex gateway profile file was written
      When the user runs `langwatch logout`
      Then that profile file is deleted

    Scenario Outline: the scoped shell function is removed from the rc
      Given ~/.zshrc carries a scoped `<tool>` wrapper under the
        `# >>> langwatch <tool> begin >>>` marker pair
      And the rc has user-authored lines above and below it
      When the user runs `langwatch logout`
      Then the `<tool>` marker block is removed
      And the user-authored lines are preserved verbatim

      Examples:
        | tool     |
        | gemini   |
        | opencode |
        | copilot  |

    Scenario: the global gateway shell-rc block is removed
      Given ~/.zshrc carries the `# >>> langwatch begin >>>` gateway block
      When the user runs `langwatch logout`
      Then the gateway block is removed from the rc

  Rule: logout only touches langwatch-authored regions

    Scenario: a settings.json with no langwatch keys is left untouched
      Given ~/.claude/settings.json has only user-authored keys
      When the user runs `langwatch logout`
      Then the file is left byte-for-byte unchanged

    Scenario: an rc file with no langwatch markers is left untouched
      Given ~/.zshrc has no langwatch marker blocks
      When the user runs `langwatch logout`
      Then the file is left byte-for-byte unchanged

  Rule: the user sees what will be removed and can confirm

    Scenario: logout lists the targets it found and asks to proceed
      Given telemetry wiring exists for claude and codex
      When the user runs `langwatch logout` in an interactive terminal
      Then the CLI prints each target it found
      And prompts to proceed before removing anything

    Scenario: `--yes` skips the confirmation
      Given telemetry wiring exists
      When the user runs `langwatch logout --yes`
      Then the wiring is removed without a prompt

    Scenario: a summary of what was removed is printed
      When `langwatch logout` finishes
      Then it prints one line per target that was removed

  Rule: flags narrow what logout touches

    Scenario: `--keep-credentials` removes wiring but leaves the session
      Given the user has a device session and telemetry wiring
      When the user runs `langwatch logout --keep-credentials`
      Then the telemetry wiring is removed
      And the device session on disk is left intact

  Rule: logout is a single command, symmetric to login

    Scenario: there is exactly one logout command
      Given the CLI exposes `langwatch login` for signing in
      Then `langwatch logout` is the only logout command
      And there is no separate `langwatch logout-device` command
      # Rationale: one `logout`, mirroring one `login`. The old
      # credentials-only `logout-device` is folded into `logout`
      # (full teardown by default; `--keep-credentials` for wiring-only).

    Scenario: logout never touches the project SDK key in .env
      Given the user has both a device session AND a project API key in
        `$CWD/.env` (`LANGWATCH_API_KEY`)
      When the user runs `langwatch logout`
      Then the device session in `~/.langwatch/config.json` is cleared
      And `$CWD/.env`'s `LANGWATCH_API_KEY` is NOT touched
      # The project SDK key is a separate, user-managed store; removing it
      # is a manual `.env` edit, not part of logout.
