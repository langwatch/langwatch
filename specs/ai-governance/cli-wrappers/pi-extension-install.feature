Feature: `langwatch pi` installs a first-party extension that speaks pi's own telemetry
  ADR-188 Decisions 4, 5, 9, 11, 12. pi declares its whole span tree in
  `@earendil-works/pi-telemetry` and `@earendil-works/pi-agent-core`, then binds
  that contract to a no-op backend in the CLI. The extension we install is the
  missing backend and nothing more: it emits pi's declared names and attribute
  keys over the env block that pi-env-injection.feature sets.

  We install our own file, never a third-party package. A community extension
  would export log records rather than pi's span tree, and installing someone
  else's code in-process beside a developer's live credentials is not something
  the wrapper does on a user's behalf. Customers already running a community
  extension are met with signal aliases in pi's definition instead, which is
  data, not an install.

  The extension is a shim with a death date. When pi wires its native
  TelemetryContext into the CLI the file is deleted and no server code changes,
  because the only names in it are pi's own.

  Pairs with:
    - specs/ai-governance/cli-wrappers/claude-plugin-install.feature
    - specs/ai-governance/cli-wrappers/logout.feature
    - specs/coding-agent/pi-sessions.feature

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: The extension is installed, idempotent, and removable

    @unit
    Scenario: The first pi run writes the extension into pi's extension directory
      Given pi's extension directory holds no LangWatch extension
      When the user runs `langwatch pi`
      Then the LangWatch extension is written into pi's extension directory
      And it is registered as a telemetry target for logout

    @unit
    Scenario: A second run neither duplicates the file nor double-registers handlers
      Given the LangWatch extension is already installed at the current version
      When the user runs `langwatch pi`
      Then the extension file is left as it is
      And exactly one set of pi event handlers is registered

    @unit
    Scenario: A stale extension from an older CLI is replaced
      Given the LangWatch extension is installed at an older version
      When the user runs `langwatch pi`
      Then the extension is rewritten at the current version

    @unit
    Scenario: Logout removes the extension
      Given the LangWatch extension is installed
      When the user runs `langwatch logout`
      Then the extension file is removed from pi's extension directory
      And a user's own extensions are left untouched

    @unit
    Scenario: A pi version below the warned minimum runs anyway with one notice
      Given the installed pi reports a version below the warned minimum
      When the user runs `langwatch pi`
      Then the wrapper prints one upgrade notice
      And pi still runs

  Rule: The extension emits pi's declared vocabulary, never names of our own

    @unit
    Scenario: An agent run becomes one pi.harness.run span carrying pi's session id
      Given a pi agent start and agent end for session "s-1"
      When the extension handles them
      Then one span named "pi.harness.run" is emitted
      And it carries pi.session.id "s-1"
      And its end carries pi's own operation outcome

    @unit
    Scenario: Each turn becomes a pi.harness.turn span under the run
      Given a pi run with two turns
      When the extension handles them
      Then two spans named "pi.harness.turn" are emitted
      And each is a child of the run span
      And each carries pi.turn.id

    @unit
    Scenario: Each tool execution becomes a pi.harness.tool span under its turn
      Given a turn that executes the tools "read" and "bash"
      When the extension handles them
      Then two spans named "pi.harness.tool" are emitted under that turn
      And each carries pi.tool.name and pi.tool.call_id

    @unit
    Scenario: A failed tool execution ends its span as an error
      Given a tool execution that ends in failure
      When the extension handles it
      Then the tool span carries pi.tool.is_error true
      And the span status is error

    @unit
    Scenario: An aborted turn is recorded with pi's own outcome, not a status of our invention
      Given a turn that the user aborts
      When the extension handles the turn end
      Then the turn span's outcome is pi's "aborted" value

    @unit
    Scenario: Every emitted name and attribute key is one pi declares
      Given the span names and attribute keys the extension can emit
      When they are checked against pi's declared telemetry schema
      Then every one of them is declared by pi

  Rule: A one-shot run exports before pi exits

    @unit
    Scenario: A non-interactive run flushes its spans at agent end
      Given a one-shot `pi -p` run whose spans all close inside one batch window
      When the agent ends
      Then the span processor is flushed before pi exits

    @unit
    Scenario: An unreachable endpoint does not hold pi's exit open
      Given the OTLP endpoint does not answer
      When the agent ends
      Then the flush gives up within its bounded timeout
      And pi exits without waiting further

  Rule: Community extensions are met with aliases, never an install

    @unit
    Scenario: A session captured by a community OTel extension still lands in the explorer
      Given a signal emitted by a maintained community pi OTel extension
      When pi's definition resolves its aliases
      Then the signal is recognised as pi's
      And nothing was installed on the user's machine to achieve it
