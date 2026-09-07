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
      lives beside the endpoint in one 0600 file. codex never enters the
      offer flow below: the wrapper writes this block, header included,
      on every ingestion run (see its Rule).
  Tools with no config-file env target (`gemini`, `opencode`, `copilot`) instead get a
  shell function installed in the rc that sets the telemetry env ONLY for that
  tool's invocations, since their OTEL vars use generic names a global
  `export` would otherwise leak into every shell child. `cursor` is
  gateway-only (`allow_otel_direct=false`), so Path B ingestion never resolves
  for it and it never persists a telemetry env block.

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

  Rule: `langwatch codex` persists automatically (no prompt)

    config.toml is the only wiring a plain `codex` reads, and the wrapper
    already rewrites the langwatch [otel] marker block there on every
    ingestion run. Withholding the Authorization header behind a consent
    prompt made codex the one tool where a plain run silently produced
    nothing until the user noticed the question and answered it. The
    block lives in a single 0600 marker-managed file and `langwatch
    logout` removes it, so the header is written inline unconditionally,
    the same way claude's settings files are.

    @unit @cli-wrappers @shell-rc @codex
    Scenario: codex wiring persists the Authorization header inline
      Given `langwatch codex` resolves to ingestion mode (Path B)
      When the wrapper writes the [otel] block to ~/.codex/config.toml
      Then the [otel.trace_exporter.otlp-http] block carries a `headers`
        entry with `Authorization = "Bearer <ingest-token>"`
      And running a plain `codex` captures telemetry with no shell edits

    @unit @cli-wrappers @shell-rc @codex
    Scenario: The wrapper's [otel] write carries the Authorization header, so codex needs no persist prompt
      Given `langwatch codex` resolves to ingestion mode (Path B)
      When the wrapper finishes setting up
      Then the CLI does NOT ask a codex persistence question
      And the turn-completion harvest hook is installed quietly
      And config the user authored outside the langwatch marker pair
        is preserved verbatim

    @unit @cli-wrappers @shell-rc @codex
    Scenario: Every seam that persists the codex exporters wires the turn harvest
      Given codex telemetry wiring is persisted or refreshed, by the wrapper,
        by `langwatch instrument codex`, or by a login refresh
      When the [otel] block is written
      Then the turn-completion harvest is asserted beside it
      And a device whose wiring predates the harvest gains it on the next refresh

    # Naming the seams one by one is what let two of them ship with exporters
    # and no harvest. The check reads the source, so a seam added later fails
    # it instead of quietly capturing nothing.
    @unit @cli-wrappers @shell-rc @codex
    Scenario: A new seam that writes the exporters cannot ship without the harvest
      Given the places in the CLI that write the codex [otel] block
      When the persist seams are checked
      Then each of them wires the turn harvest beside the write

    @unit @cli-wrappers @shell-rc @codex
    Scenario: A harvest that cannot be wired is reported, never silent
      Given a codex config the harvest install cannot write
      When the wiring is persisted
      Then the failure is printed, naming what stays missing
      And the exporters stay in place

  Rule: Tools without a config-file env target install a scoped shell function

    Scenario Outline: Accept Y — write a scoped `<tool>` wrapper function
      Given `langwatch <tool>` resolves to ingestion mode
      When the user types "y" at the persistence prompt
      Then the shell rc gains a marker-bracketed `<tool>()` function (or a
        fish `function <tool>`) that sets the OTEL_EXPORTER_OTLP_* env and
        then runs `command <tool>`
      And the OTEL vars are NOT written as bare top-level `export`s
      And running a plain `<tool>` captures telemetry, while other shell
        children do not inherit the OTEL env
      # Rationale: these tools' OTEL vars are generic OpenTelemetry names, so a
      # global export would capture telemetry from every OTEL-aware process in
      # the shell. The wrapper scopes them to `<tool>` runs only.

      Examples:
        | tool     |
        | gemini   |
        | opencode |
        | copilot  |

    @unit
    Scenario: The copilot wrapper function carries the tool-specific telemetry vars
      Given `langwatch copilot` resolves to ingestion mode
      When the user types "y" at the persistence prompt
      Then the scoped `copilot()` function sets COPILOT_OTEL_ENABLED alongside
        the OTEL_EXPORTER_OTLP_* env
      And a plain `copilot` run exports telemetry to LangWatch

    Scenario: Each tool's scoped wrapper lands under its own marker pair
      Given ~/.zshrc already carries a scoped `gemini` wrapper from a prior run
      When the user types "y" at the `opencode` persistence prompt
      Then the `opencode` wrapper lands under its own marker pair
      And the prior `gemini` wrapper is left intact

    Scenario: Skip the prompt when the scoped wrapper already targets this endpoint
      Given ~/.zshrc already carries the `<tool>` wrapper for the current
        OTLP endpoint
      When `langwatch <tool>` resolves to ingestion mode
      Then the CLI does NOT prompt to persist

  Rule: cursor never persists telemetry env (gateway-only)

    Scenario: cursor resolves to the gateway path, so no persist prompt fires
      Given cursor's policy has `allow_otel_direct=false`
      When the user runs `langwatch cursor`
      Then it resolves to the gateway path (Path A)
      And the CLI does NOT prompt to persist a telemetry env block

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
