Feature: The latest login wins over stale persisted telemetry wiring
  `langwatch <tool>` persists telemetry wiring so a plain `<tool>` keeps
  capturing: claude's env block in `~/.claude/settings.json`, codex's
  `[otel]` block in `~/.codex/config.toml`, scoped shell functions for
  gemini / opencode. Each block hard-codes the endpoint and ingest key of
  the login that wrote it.

  Claude Code applies the settings.json `env` block ON TOP of the child
  process environment, and the scoped shell functions shadow the tool
  binary inside the login shell the wrapper spawns through. So after
  logging into a DIFFERENT LangWatch instance (e.g. a local
  `npx @langwatch/server`), a stale block silently reroutes telemetry to
  the previous instance even though the wrapper computed the correct env
  for the new one. Declining the persist prompt does not help: nothing
  counteracts the stale block.

  The rule: the latest login wins. Langwatch-authored wiring is refreshed
  in place to the current login's endpoint and key, on login and on every
  wrapper run. Wiring langwatch did not author is never touched.

  As a developer who switches between LangWatch instances,
  I want every `langwatch <tool>` session to land on the instance I am
  logged into right now, so telemetry never silently goes to a previous
  install.

  Background:
    Given the langwatch CLI is installed

  Rule: an ingestion-mode wrapper run re-syncs the tool's persisted wiring

    Scenario: a stale claude settings env block is refreshed before the run
      Given ~/.claude/settings.json's `env` block carries langwatch OTLP
        wiring pointing at a previous instance
      And the user has since logged into a different instance
      When the user runs `langwatch claude` and it resolves to ingestion mode
      Then the settings.json `env` block is rewritten in place with the
        current login's endpoint and ingest key
      And the user sees a line naming the refreshed target
      And user-authored keys elsewhere in settings.json are preserved verbatim

    Scenario: a stale scoped shell function is refreshed before the run
      Given ~/.zshrc carries the langwatch `gemini` marker block pointing at
        a previous instance
      When the user runs `langwatch gemini` and it resolves to ingestion mode
      Then the marker block is rewritten with the current login's endpoint
        and ingest key
      And user-authored rc lines outside the markers are preserved verbatim

    Scenario: codex wiring is rewritten on every ingestion run
      Given ~/.codex/config.toml carries the langwatch [otel] marker block
        pointing at a previous instance
      When the user runs `langwatch codex` and it resolves to ingestion mode
      Then the [otel] block carries the current login's endpoint
      And a persisted Authorization header carries the current ingest key

    Scenario: wiring that already matches the current login is left alone
      Given every persisted block already carries the current login's values
      When the user runs `langwatch claude` in ingestion mode
      Then no persisted file is rewritten
      And no refresh line is printed

  Rule: langwatch never touches wiring it did not author

    Scenario: a user's own OTLP wiring in claude settings is preserved
      Given ~/.claude/settings.json's `env` block points OTLP at a
        third-party collector the user configured themselves
      When the user runs `langwatch claude` in ingestion mode
      Then the user's env block is left byte-for-byte unchanged
      # Authorship: marker-bracketed regions are explicitly ours; the
      # unmarked claude env block only counts as langwatch-authored when
      # its values are langwatch-shaped (an ik-lw-/sk-lw- bearer or an
      # /api/otel endpoint).

  Rule: the wrapped claude run cannot be rerouted by user-level settings

    Scenario: the wrapper pins telemetry at project level for the run
      When the user runs `langwatch claude` in ingestion mode
      Then the working directory's .claude/settings.local.json carries the
        run's telemetry env under the langwatch key set
      And Claude Code's documented precedence makes that pin outrank
        ~/.claude/settings.json
      And the pin is kept out of the repository history via the local git
        exclude file

    Scenario: the pin is refreshed when a different login runs next
      Given .claude/settings.local.json carries a pin from a previous login
      When the user runs `langwatch claude` under a new login
      Then the pin carries the new login's endpoint and ingest key

    Scenario: a gateway-mode run removes the pin instead
      Given .claude/settings.local.json carries a langwatch telemetry pin
      When the user runs `langwatch claude` and it resolves to gateway mode
      Then the langwatch keys are removed from the pin
      And the gateway captures the session server-side without a second
        OTLP emission

    Scenario: a project file the user authored is respected
      Given .claude/settings.local.json carries OTLP wiring that is not
        langwatch-shaped
      When the user runs `langwatch claude` in ingestion mode
      Then the file is left unchanged

  Rule: login re-points persisted wiring at the new instance

    Scenario: logging into a different instance refreshes stale blocks
      Given persisted wiring for claude, codex, and gemini points at a
        previous instance
      When the user completes `langwatch login --device` against a new
        instance
      Then each langwatch-authored block is rewritten with the new
        instance's endpoint and a live ingest key minted there
      And the login output lists each target that was updated

    Scenario: wiring already pointing at this instance is not re-minted
      Given the persisted wiring already targets the instance being logged
        into
      When the user completes `langwatch login --device`
      Then no ingest key is minted for the refresh
      And no wiring file is rewritten

    Scenario: a wiring refresh failure never fails the login
      Given persisted wiring points at a previous instance
      And the new instance cannot mint an ingest key for the user yet
      When the user completes `langwatch login --device`
      Then the login still succeeds
      And the stale wiring is left for the next wrapper run to handle
