# The LangWatch pi extension, a first-party file the CLI owns by its marker
#
# Implementation:
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
# `langwatch ingest install pi` is what writes the file, not the `langwatch pi`
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
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds.
# ADR-188 is accepted; none of what it describes is built. Tagging these @unit
# or @integration now would report a binding that does not exist. Each scenario
# names the tag it becomes in a comment above it, and the commit that makes one
# pass swaps that tag and adds the `@scenario "<title>"` annotation in the same
# change. A scenario still carrying @unimplemented when ADR-188 is called done
# is work that was not done.
#
# WHAT BLOCKS THESE, AS OF 2026-10-30:
#   1. THE EXTENSION DOES NOT EXIST. There is no pi-plugin file beside
#      opencode-plugin.ts and claude-plugin.ts, nothing registers it as a
#      telemetry target for logout, and `pi` is not a wrapped tool in
#      otel-env-block.ts, so no run reaches any of this.
#   2. THE INSTALL COMMAND DOES NOT ACCEPT pi, AND WOULD TAKE THE WRONG ARM
#      IF IT DID. `pi_cli` is not in SUPPORTED_TOOLS in
#      sdks/typescript/src/cli/commands/ingestion/install.ts, and the seam
#      installer branches on a hard-coded id where only `opencode` takes the
#      plugin path, so a pi row without an arm there writes hook entries into a
#      file pi never reads. Both edits are hand edits, not generated.
#   3. pi HAS NO ROW IN SESSION_CONTEXT_AGENTS. Until it does,
#      isSessionContextAgentId rejects the slug, so `langwatch ingest hook pi`
#      resolves no agent and posts nothing.
#   4. THE MINIMUM pi VERSION IS UNVERIFIED. ADR-188's Constants table says so
#      outright, and one scenario here asserts the refusal below it.
#
# The file yields no enforced scenario while that holds, so it is listed in
# LEGACY_INERT in packages/architecture-enforcer/src/tools/check-feature-parity.ts.
# The commit that binds the first scenario here deletes that line with it.

Feature: `langwatch ingest install pi` writes a first-party extension that speaks pi's own telemetry

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: The extension is the CLI's own file, recognised by its marker

    # becomes @unit
    @unimplemented
    Scenario: The first install writes the extension into pi's extension directory
      Given pi's extension directory holds no LangWatch extension
      When the user runs `langwatch ingest install pi`
      Then the LangWatch extension is written into pi's extension directory
      And its first line carries LangWatch's own marker
      And it is registered as a telemetry target for logout

    # becomes @unit
    @unimplemented
    Scenario: Installing for pi takes the plugin arm, never the hook-entries fallback
      When the user runs `langwatch ingest install pi`
      Then the extension is written into pi's extension directory
      And no hook entries are written into any file pi does not read

    # becomes @unit
    @unimplemented
    Scenario: A second install leaves an unchanged extension alone
      Given the file at pi's extension path is byte for byte what this CLI writes
      When the user runs `langwatch ingest install pi`
      Then the extension file is left as it is
      And exactly one set of pi event handlers is registered

    # becomes @unit
    @unimplemented
    Scenario: An extension left by an older CLI is rewritten
      Given the file at pi's extension path carries LangWatch's marker
      And its contents differ from what this CLI writes
      When the user runs `langwatch ingest install pi`
      Then the file is rewritten with this CLI's extension

    # becomes @unit
    @unimplemented
    Scenario: A file at that path without our marker is never overwritten
      Given a file at pi's extension path that carries no LangWatch marker
      When the user runs `langwatch ingest install pi`
      Then the file is left exactly as it is
      And nothing of ours is installed over it

    # becomes @unit
    @unimplemented
    Scenario: Logout removes the extension by its marker
      Given the LangWatch extension is installed
      When the user runs `langwatch logout`
      Then the extension file is removed from pi's extension directory
      And a file at that path without our marker is left in place

    # becomes @unit
    @unimplemented
    Scenario: An installed pi below the minimum version is left uninstrumented
      Given the installed pi reports a version below the minimum the extension was written against
      When the user runs `langwatch ingest install pi`
      Then no extension is written into pi's extension directory
      And one notice names the pi version the extension needs

  Rule: The extension emits pi's declared vocabulary, never names of our own

    # becomes @unit
    @unimplemented
    Scenario: An agent run becomes one pi.harness.run span carrying pi's session id
      Given a pi agent start and agent end for session "s-1"
      When the extension handles them
      Then one span named "pi.harness.run" is emitted carrying:
        | attribute     | value |
        | pi.session.id | s-1   |
      And its end carries pi's own operation outcome

    # becomes @unit
    @unimplemented
    Scenario: Each turn becomes a pi.harness.turn span under the run
      Given a pi run with two turns
      When the extension handles them
      Then two spans named "pi.harness.turn" are emitted
      And each is a child of the run span
      And each carries pi.turn.id

    # becomes @unit
    @unimplemented
    Scenario: Each tool execution becomes a pi.harness.tool span under its turn
      Given a turn that executes the tools "read" and "bash"
      When the extension handles them
      Then two spans named "pi.harness.tool" are emitted under that turn
      And each carries pi.tool.name and pi.tool.call_id

    # becomes @unit
    @unimplemented
    Scenario: A failed tool execution ends its span as an error
      Given a tool execution that ends in failure
      When the extension handles it
      Then the tool span carries:
        | attribute        | value |
        | pi.tool.is_error | true  |
      And the span status is error

    # becomes @unit
    @unimplemented
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

    # becomes @unit
    @unimplemented
    Scenario: A non-interactive run flushes its spans at agent end
      Given a one-shot `pi -p` run whose spans all close inside one batch window
      When the agent ends
      Then the span processor is flushed before pi exits

    # becomes @unit
    @unimplemented
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

    # becomes @unit
    @unimplemented
    Scenario: The extension runs the hook command at agent start
      Given a pi agent start for session "s-1" in a git repository on a branch
      When the extension handles it
      Then it runs `langwatch ingest hook pi` with that session id and working directory
      And the command posts a session-context record carrying that repository and head branch

    # becomes @unit
    @unimplemented
    Scenario: The session id it hands over is the same string pi puts on its spans
      Given a pi agent start for session "s-1"
      When the extension runs the hook command
      Then the session id it passes is byte for byte the pi.session.id on the run span

    # becomes @unit
    @unimplemented
    Scenario: A pi run outside a git repository posts no context rather than an empty one
      Given a pi agent start in a directory that is not a git repository
      When the extension runs the hook command
      Then no session-context record is posted
      And the agent run is not interrupted

    # becomes @unit
    @unimplemented
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
