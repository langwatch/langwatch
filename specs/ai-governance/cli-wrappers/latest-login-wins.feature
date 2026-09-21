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

  A login alone takes the wiring over only when it is this machine's login
  against a deployment: a login kept in its own config file
  (LANGWATCH_CLI_CONFIG) never does, and a login against localhost leaves
  wiring that reports to a deployment elsewhere until the user runs
  `langwatch <tool>` on it, which is the wrapper-run half of the rule.

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

    @unit @cli-wrappers @latest-login-wins @project-pin
    Scenario: A project-pinned tool is not re-pointed by a new login
      Given codex is pinned to a team project (`tool_project_keys.codex`)
      And codex's persisted wiring points at the pinned instance,
        which differs from the instance being logged into
      When the user completes `langwatch login --device`
      Then codex's wiring is left exactly as it was
      And no personal ingest key is minted for codex
      And the unpinned tools are still refreshed
      # The pin is deliberate scope, not stale personal wiring: latest
      # login wins applies to the personal path only.

    Scenario: a wiring refresh failure never fails the login
      Given persisted wiring points at a previous instance
      And the new instance cannot mint an ingest key for the user yet
      When the user completes `langwatch login --device`
      Then the login still succeeds
      And the stale wiring is left for the next wrapper run to handle

  Rule: a login that is not this machine's login leaves the wiring alone
    # The wiring under the home (the claude settings env block, the codex
    # [otel] and gateway blocks, the scoped shell functions) belongs to the
    # login in the home's default config file. Two logins never take it over.

    @unit @cli-wrappers @latest-login-wins @isolated-config
    Scenario: A login kept in its own config file never touches the home's wiring
      Given LANGWATCH_CLI_CONFIG names a config file other than the home's default one
      And persisted wiring for claude and codex points at another instance
      When the user completes `langwatch login --device`
      Then no ingest key is minted for the refresh
      And the claude settings file and the codex config file are byte for byte what they were
      And the refresh reports claude and codex as left alone because the login lives in its own config file

    @unit @cli-wrappers @latest-login-wins @isolated-config
    Scenario: LANGWATCH_CLI_CONFIG naming the home's default file is the machine's login
      Given LANGWATCH_CLI_CONFIG names the home's default config file
      And persisted wiring for claude points at a previous instance
      When the user completes `langwatch login --device` against a new instance
      Then claude's wiring is rewritten with the new instance's endpoint

    @unit @cli-wrappers @latest-login-wins @loopback-login
    Scenario: A login on this machine does not take over wiring that reports elsewhere
      # Decision: a localhost login never takes the wiring over on its own. A
      # local stack comes and goes, and once it stops every plain tool run
      # would report to nothing. Running `langwatch <tool>` on that login is
      # the explicit way to move one tool over.
      Given persisted wiring for claude and codex points at a deployment that is not on this machine
      When the user completes `langwatch login --device` against a localhost instance
      Then no ingest key is minted for the refresh
      And the claude settings file and the codex config file are byte for byte what they were
      And the refresh reports claude and codex as left alone because the login is on this machine

    @unit @cli-wrappers @latest-login-wins @loopback-login
    Scenario: A login on this machine still refreshes wiring that already reports to this machine
      Given persisted wiring for claude points at a localhost instance on another port
      When the user completes `langwatch login --device` against a localhost instance
      Then claude's wiring is rewritten with the new instance's endpoint and a live ingest key

    @unit @cli-wrappers @latest-login-wins @loopback-login
    Scenario: A host that only starts with localhost is not this machine
      # The address is parsed and judged by its host. `localhost.acme.test` is
      # a deployment elsewhere, however its name starts.
      Given a tool's shell function reports to "https://localhost.acme.test/api/otel"
      When the user completes `langwatch login --device` against a localhost instance
      Then the shell function is left exactly as it was
      And the refresh reports the tool as left alone because the login is on this machine

    @unit @cli-wrappers @latest-login-wins @loopback-login
    Scenario: A shell function that reports to this machine is refreshed by a login on this machine
      Given a tool's shell function reports to a localhost instance on another port
      When the user completes `langwatch login --device` against a localhost instance
      Then the shell function is rewritten with the new instance's endpoint

    @unit @cli-wrappers @latest-login-wins @loopback-login
    Scenario: A login on this machine leaves a codex gateway block that routes elsewhere
      Given the codex config file carries a langwatch gateway block whose base_url is not on this machine
      When the user completes `langwatch login --device` against a localhost instance
      Then the gateway block is left exactly as it was

    @unit @cli-wrappers @latest-login-wins @isolated-config
    Scenario: The login names the config file it writes
      Given LANGWATCH_CLI_CONFIG names a config file other than the home's default one
      When the user starts `langwatch login --device`
      Then the login says it will write that file, not `~/.langwatch/config.json`

    @unit @cli-wrappers @latest-login-wins
    Scenario: The login says which wiring it left alone and how to move it
      Given a login left the wiring of claude alone because the login is on this machine
      When the login prints its summary
      Then a line says claude's wiring was left as it is because it reports to another LangWatch
      And a line names `langwatch claude` as the way to report to this one instead
