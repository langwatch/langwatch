Feature: `langwatch instrument <tool>` writes telemetry wiring without launching the tool

  A VPS full of coding agents (claude, codex, opencode) needs telemetry
  wired once, headlessly, and to a TEAM project rather than the personal
  workspace of whoever set the machine up. The wrappers only wire a tool
  when they launch it; `langwatch instrument <tool>` writes the same
  persistent wiring targets and exits, so a plain `<tool>` run captures
  afterwards:

    - claude  -> the `env` block in ~/.claude/settings.json
    - codex   -> the [otel] marker block in ~/.codex/config.toml,
                 Authorization header inline (0600 file)
    - gemini / opencode / copilot / code -> a scoped `<tool>()` function
                 in the shell rc, zsh or bash or fish, with a platform
                 fallback when $SHELL is unrecognized

  Scope selection, exactly one of:
    (none)                 the personal workspace; needs `langwatch login`.
    --project <id-or-slug> a team project; mints a project ingest key
                           (one per device, create-only server-side) and
                           pins the tool to it via `tool_project_keys`.
                           Needs login and traces:create on the project.
    --key <ingest-key>     a pasted ingest key; no login needed. Also read
                           from $LANGWATCH_INGEST_KEY. Combine with
                           --endpoint <url> for self-hosted instances.
    --personal             clear a project pin and rewire the personal path.

  The wrapper flags `langwatch <tool> --project <p>` / `--personal` reuse
  the same pinning before launching the tool.

  Background:
    Given the langwatch CLI is installed

  Rule: scope flags pick where the telemetry goes

    @unit @cli-wrappers @instrument
    Scenario: A pasted key instruments a machine that never logs in
      Given a machine with no `langwatch login` session
      When the user runs `langwatch instrument codex --key <ingest-key> --endpoint https://lw.acme.dev`
      Then the tool is pinned to the pasted key with the endpoint override
      And the wiring is written with that key against that instance
      And no login is required and no server call is made

    @unit @cli-wrappers @instrument
    Scenario: --project mints a device-scoped project key and pins the tool
      Given a signed-in session with traces:create on project "acme-app"
      When the user runs `langwatch instrument codex --project acme-app`
      Then a project ingest key is minted for this device
      And the tool is pinned to it in `tool_project_keys`
      And the output names the project the telemetry will go to

    @unit @cli-wrappers @instrument
    Scenario: --personal returns the tool to the personal workspace
      Given codex is pinned to a team project
      When the user runs `langwatch instrument codex --personal`
      Then the project pin is cleared
      And the wiring is rewritten with the personal ingest key

    @unit @cli-wrappers @instrument
    Scenario: Two scope flags at once are refused rather than one winning silently
      Given a signed-in session
      When the user runs `langwatch instrument codex --project acme-app --key <ingest-key>`
      Then the command fails naming both flags
      And nothing is pinned and no wiring is written
      # A leftover $LANGWATCH_INGEST_KEY in the shell is a default, not a
      # flag, so it never counts as one of the two.

    @unit @cli-wrappers @instrument
    Scenario: Instrumenting without login and without a key fails with guidance
      Given a machine with no `langwatch login` session and no pin
      When the user runs `langwatch instrument codex`
      Then the command fails
      And the message names both ways forward: `langwatch login --device`
        for the personal scope, or --key with a project ingest key

  Rule: the per-tool direct-OTLP policy governs this command too

    Every target this command writes is the direct-OTLP path, so the same
    `allowOtelDirect` policy the wrapper gates on applies here. The CLI
    checks first for the message, and the mint route enforces it, so an
    old CLI, a stale cached policy, or a hand-written request cannot wire
    a tool the organization turned off.

    @unit @cli-wrappers @instrument
    Scenario: A tool whose organization forbids direct OTLP is not instrumented
      Given the organization turned direct OTLP off for codex
      When the user runs `langwatch instrument codex --project acme-app`
      Then the command fails naming the gateway path as the way forward
      And no key is minted, no pin is written, and no wiring file is touched

    @integration @cli-wrappers @instrument
    Scenario: A tool whose organization forbids direct OTLP mints no ingestion key
      Given the organization turned direct OTLP off for claude
      When a CLI asks the control plane for a claude ingestion key
      Then the request is refused
      And the project gains no ingestion key

  Rule: logout removes everything this command wrote

    @unit @cli-wrappers @instrument
    Scenario: Logout removes the wiring and the project pin together
      Given claude, codex and gemini are instrumented, codex against a team
        project
      When the user runs `langwatch logout`
      Then every wiring target this command wrote is removed
      And the project pin goes with the config file, so no device keeps
        shipping telemetry to the team project under the pasted credential

  Rule: the wiring targets are shared with the wrappers

    @unit @cli-wrappers @instrument
    Scenario: The wiring targets are the same files a wrapped run manages
      Given a fresh machine with none of the wiring present
      When the user instruments claude, codex, and gemini
      Then claude's OTel env lands in ~/.claude/settings.json
      And codex's [otel] block lands in ~/.codex/config.toml with the
        Authorization header inline
      And gemini's scoped function lands in the shell rc
      And a later `langwatch <tool>` run recognizes and refreshes the
        same targets instead of duplicating them
