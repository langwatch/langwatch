# The LangWatch pi extension, a first-party file the CLI owns by its marker
#
# Implementation:
#   sdks/typescript/src/cli/utils/governance/pi-plugin.ts         (ownership: install, scan, removal)
#   sdks/typescript/src/cli/utils/governance/pi-extension-source.ts (the extension text pi loads)
#   sdks/typescript/src/cli/utils/governance/opencode-plugin.ts   (the marker-and-contents model this follows)
#   sdks/typescript/src/cli/utils/governance/claude-plugin.ts     (the versioned model this deliberately does not follow)
#   sdks/typescript/src/cli/utils/governance/otel-env-block.ts    (the env the extension reads)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts (logout removal)
#   sdks/typescript/src/cli/utils/governance/session-context-agents.ts (the registry pi joins, with a plugin hook target)
#   sdks/typescript/src/cli/commands/ingestion/install.ts            (the command that writes the seam)
#   sdks/typescript/src/cli/commands/ingestion/context-session.ts (what refuses an unregistered agent id today)
#   modules/coding-agent/contract/src/telemetry/coding-agent-definition.ts (where signal aliases are declared)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/claude-plugin-install.feature, the versioned install, for contrast
#   specs/ai-governance/cli-wrappers/pi-env-injection.feature     , the env block this emits over
#   specs/ai-governance/cli-wrappers/session-context-hook.feature , the plugin row pi joins there
#   specs/ai-governance/cli-wrappers/logout.feature               , the full teardown this plugs into
#   specs/coding-agent/pi-sessions.feature                        , the sessions these spans fold into
#   modules/coding-agent/specs/session-git-context.feature        , the terms the context record joins the fold on
#   specs/ai-governance/ingestion-sources/pi-cli-otlp.feature     , where the spans land
#
# Motivation: pi declares its whole span tree in `@earendil-works/pi-telemetry`
# and `@earendil-works/pi-agent-core`, then binds that contract to a no-op
# backend in the CLI. The extension we install is the missing backend and
# nothing more: it emits pi's declared names and attribute keys, so when pi
# wires its own TelemetryContext into the CLI the file is deleted and no server
# code changes.
#
# We install our own file, never a third-party package. A community extension
# would export log records rather than pi's span tree, and installing someone
# else's code in-process beside a developer's live credentials is not something
# the wrapper does on a user's behalf. Customers already running a community
# extension are met with signal aliases in pi's definition instead, which is
# data, not an install.
#
# `langwatch ingest install pi_cli` is what writes the file, not the `langwatch pi`
# wrapper: the wrapper installs no session-context seam for any agent, and the
# install command is where every other agent's seam is written. pi therefore
# has to be an accepted tool of that command and take the plugin arm of it,
# or the install writes hook entries into a file pi never reads and says
# nothing.
#
# Ownership is by a first-line marker and a contents comparison, as for the
# opencode plugin, not by a version stamp. A single file written into a
# directory has nowhere to record a version, and the CLI already knows exactly
# what it would write: if the file differs, rewrite it; if it carries no marker,
# it is the user's and we leave it alone.
#
# Three scenarios stay @unimplemented, each for a reason outside this file:
#   1. The minimum-version refusal: ADR-188's Constants table records the
#      minimum pi version as UNVERIFIED, and a refusal below an unknown floor
#      would be a guess.
#   2. The declared-vocabulary check: pi's schema package is not a dependency
#      of the SDK, and the extension also emits gen_ai.* mirrors and the
#      langwatch.attributes.estimated marker, which pi does not declare.
#   3. The community aliases: they live in pi's definition under
#      modules/coding-agent/, not in the CLI.

Feature: `langwatch ingest install pi_cli` writes a first-party extension that speaks pi's own telemetry

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: The extension is the CLI's own file, recognised by its marker

    @unit
    Scenario: The first install writes the extension into pi's extension directory
      Given pi's extension directory holds no LangWatch extension
      When the user runs `langwatch ingest install pi_cli`
      Then the LangWatch extension is written into pi's extension directory
      And its first line carries LangWatch's own marker
      And it is registered as a telemetry target for logout

    @unit
    Scenario: Installing for pi takes the plugin arm, never the hook-entries fallback
      When the user runs `langwatch ingest install pi_cli`
      Then the extension is written into pi's extension directory
      And no hook entries are written into any file pi does not read

    @unit
    Scenario: A second install leaves an unchanged extension alone
      Given the file at pi's extension path is byte for byte what this CLI writes
      When the user runs `langwatch ingest install pi_cli`
      Then the extension file is left as it is
      And exactly one set of pi event handlers is registered

    @unit
    Scenario: An extension left by an older CLI is rewritten
      Given the file at pi's extension path carries LangWatch's marker
      And its contents differ from what this CLI writes
      When the user runs `langwatch ingest install pi_cli`
      Then the file is rewritten with this CLI's extension

    @unit
    Scenario: A file at that path without our marker is never overwritten
      Given a file at pi's extension path that carries no LangWatch marker
      When the user runs `langwatch ingest install pi_cli`
      Then the file is left exactly as it is
      And nothing of ours is installed over it

    @unit
    Scenario: Logout removes the extension by its marker
      Given the LangWatch extension is installed
      When the user runs `langwatch logout`
      Then the extension file is removed from pi's extension directory
      And a file at that path without our marker is left in place

    # becomes @unit
    @unimplemented
    Scenario: An installed pi below the minimum version is left uninstrumented
      Given the installed pi reports a version below the minimum the extension was written against
      When the user runs `langwatch ingest install pi_cli`
      Then no extension is written into pi's extension directory
      And one notice names the pi version the extension needs

  Rule: The extension emits pi's declared vocabulary, never names of our own

    @unit
    Scenario: An agent run becomes one pi.harness.run span carrying pi's session id
      Given a pi agent start and agent end for session "s-1"
      When the extension handles them
      Then one span named "pi.harness.run" is emitted carrying:
        | attribute     | value |
        | pi.session.id | s-1   |
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
      Then the tool span carries:
        | attribute        | value |
        | pi.tool.is_error | true  |
      And the span status is error

    @unit
    Scenario: An aborted run is recorded with pi's own outcome, not a status of our invention
      Given a run the user aborts part way through a turn
      When the extension handles the turn end and then the agent end
      Then the turn span carries no outcome attribute, only its timing and status
      And the run span carries pi.operation.outcome with pi's "aborted" value

    # becomes @unit
    @unimplemented
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

  Rule: The extension runs the session-context hook, it never writes the record

    Every other agent runs that hook from a file the CLI installs into the
    agent's own hook table. pi has no hook table, so the extension is the seam:
    it is the only code of ours inside a pi run that holds `pi.session.id`
    while the working directory is still the user's. It shells out to
    `langwatch ingest hook pi`, fire and forget, exactly as the opencode plugin
    does, and the command owns the git discovery, the spool, the deduplication
    and the key heal. Authoring the record in the extension would duplicate all
    four in a file we want deletable.

    pi's row in the session-context registry carries a plugin hook target
    naming that file. Without the row the command resolves no agent and posts
    nothing, so a pi session folds with no repository and maps no pull request.

    @unit
    Scenario: The extension runs the hook command at agent start
      Given a pi agent start for session "s-1" in a git repository on a branch
      When the extension handles it
      Then it runs `langwatch ingest hook pi` with that session id and working directory
      And the command posts a session-context record carrying that repository and head branch

    @unit
    Scenario: The session id it hands over is the same string pi puts on its spans
      Given a pi agent start for session "s-1"
      When the extension runs the hook command
      Then the session id it passes is byte for byte the pi.session.id on the run span

    @unit
    Scenario: A pi run outside a git repository posts no context rather than an empty one
      Given a pi agent start in a directory that is not a git repository
      When the extension runs the hook command
      Then no session-context record is posted
      And the agent run is not interrupted

    @unit
    Scenario: A hook command that fails never takes the pi run with it
      Given the session-context endpoint does not answer
      When the extension handles an agent start
      Then the extension does not wait on the command it spawned
      And pi continues the run

  Rule: Community extensions are met with aliases, never an install

    # becomes @unit
    @unimplemented
    Scenario: A session captured by a community OTel extension still lands in the explorer
      Given a signal emitted by a maintained community pi OTel extension
      When pi's definition resolves its aliases
      Then the signal is recognised as pi's
      And nothing was installed on the user's machine to achieve it
