Feature: Persist the OTLP telemetry exports so `<tool>` captures automatically
  `langwatch login` is auth-only: it never prompts to persist telemetry
  env, because the device session is already authoritative in config.json.

  The persist offer instead fires from the `langwatch <tool>` wrapper, and
  ONLY when the tool resolves to Path B (ingestion / direct OTLP). At that
  point the wrapper has computed the tool's OTEL_EXPORTER_* env, and offers
  to install it so a plain `<tool>` invocation (without the `langwatch`
  prefix) inherits the exporter env and captures telemetry automatically
  on every subsequent session.

  For tools with a native app-scoped telemetry target the wrapper writes
  there rather than the profile-root shell rc, so a plain `<tool>` picks it
  up without editing `.zshrc` and leaking the vars into every other shell
  child:
    - `claude` → `~/.claude/settings.json`'s `env` object (read on every
      invocation).
    - `codex` → `~/.codex/config.toml`'s `[otel.trace_exporter.otlp-http]`
      block, which takes an inline `headers` field, so the ingest token
      lives beside the endpoint in one 0600 file.
  `opencode` has no config-file env block, and its OTEL vars use generic
  names, so instead of a global `export` (which would leak into every shell
  child) the wrapper installs a shell function in the rc that sets the
  telemetry env ONLY for `opencode` invocations. The remaining tools
  (cursor, gemini) fall back to a plain export block in the detected shell
  rc file.

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

  Rule: `langwatch codex` persists to ~/.codex/config.toml (native [otel] block)

    Scenario: Persist target for codex is the Codex config file
      Given `langwatch codex` resolves to ingestion mode
      And ~/.codex/config.toml does not yet carry the OTLP Authorization header
      When the wrapper offers to persist telemetry exports
      Then the prompt names "~/.codex/config.toml" as the target
      And the prompt does NOT name ~/.zshrc, ~/.bashrc, or the fish config
      # Rationale: codex reads its [otel] block from config.toml on every run,
      # and the otlp-http trace exporter takes an inline `headers` field, so
      # the ingest token scopes to `codex` runs only instead of leaking into
      # every shell child via the profile rc.

    Scenario: Accept Y — write the Authorization header into the [otel] block
      Given ~/.codex/config.toml already carries the langwatch [otel] endpoint
        block written when the wrapper set up (endpoint + protocol, no header)
      When the user types "y" at the persistence prompt
      Then the [otel.trace_exporter.otlp-http] block gains a `headers` entry
        carrying `Authorization = "Bearer <ingest-token>"`
      And any config the user authored outside the langwatch marker pair
        is preserved verbatim
      And running a plain `codex` captures telemetry with no shell edits

    Scenario: The wrapper's unconditional [otel] write preserves a persisted header
      Given a previous run persisted the Authorization header into config.toml
      When `langwatch codex` sets up again and rewrites the [otel] block
      Then the persisted `headers` entry survives the rewrite
      And the persistence prompt does NOT re-appear

    Scenario: Skip the prompt when config.toml already carries the header
      Given ~/.codex/config.toml's [otel.trace_exporter.otlp-http] block
        already carries the Authorization header
      When `langwatch codex` resolves to ingestion mode
      Then the CLI does NOT prompt to persist

  Rule: `langwatch opencode` installs a scoped shell function, not a global export

    Scenario: Accept Y — write a scoped `opencode` wrapper function
      Given `langwatch opencode` resolves to ingestion mode
      When the user types "y" at the persistence prompt
      Then the shell rc gains a marker-bracketed `opencode()` function (or a
        fish `function opencode`) that sets the OTEL_EXPORTER_OTLP_* env and
        then runs `command opencode`
      And the OTEL vars are NOT written as bare top-level `export`s
      And running a plain `opencode` captures telemetry, while other shell
        children do not inherit the OTEL env
      # Rationale: opencode's OTEL vars are generic OpenTelemetry names, so a
      # global export would capture telemetry from every OTEL-aware process
      # in the shell. The wrapper scopes them to `opencode` runs only.

    Scenario: The scoped wrapper coexists with the export block for other tools
      Given ~/.zshrc already carries a langwatch export block from a prior
        `langwatch gemini` run
      When the user types "y" at the opencode persistence prompt
      Then the `opencode` wrapper lands under its own marker pair
      And the prior export block is left intact

    Scenario: Skip the prompt when the scoped wrapper already targets this endpoint
      Given ~/.zshrc already carries the `opencode` wrapper for the current
        OTLP endpoint
      When `langwatch opencode` resolves to ingestion mode
      Then the CLI does NOT prompt to persist

  Rule: Other wrappers still fall back to a shell-rc export block

    Scenario Outline: Tools without an app-scoped env block use the shell rc
      Given the user runs `langwatch <tool>` and it resolves to ingestion mode
      When the wrapper offers to persist telemetry exports
      Then the prompt names the detected shell rc file as the target

      Examples:
        | tool      |
        | cursor    |
        | gemini    |

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
      And the user runs `langwatch gemini` in ingestion mode
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
      And the user runs `langwatch gemini` in ingestion mode
      Then the persistence flow is skipped entirely with no error
