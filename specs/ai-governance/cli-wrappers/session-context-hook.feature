# The coding-agent session context hook, git identity reported by the CLI
#
# Implementation:
#   sdks/typescript/src/cli/commands/ingestion/hook.ts                 (the hook command, shared by every agent)
#   sdks/typescript/src/cli/commands/ingestion/hook-input.ts           (the payload the agent writes to its stdin)
#   sdks/typescript/src/cli/commands/ingestion/git-context.ts          (what git says about the session's directory)
#   sdks/typescript/src/cli/commands/ingestion/hook-state.ts           (the per-session fingerprint store)
#   sdks/typescript/src/cli/commands/ingestion/install.ts              (each tool's seam wired at install)
#   sdks/typescript/src/cli/utils/governance/session-context-hooks.ts  (the Claude Code and Codex hook files)
#   sdks/typescript/src/cli/utils/governance/opencode-plugin.ts        (the opencode plugin file)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts      (logout removal)
#
# Related specs:
#   specs/coding-agent/session-git-context.feature , what the pipeline does with the event
#   specs/ai-governance/cli-wrappers/shell-rc-persistence.feature , the persist flow that also installs the hooks
#
# Motivation: coding agents compute repository identity internally and export
# none of it over telemetry (verified at the raw wire for Claude Code, Codex and
# opencode alike). Each tool has exactly one sanctioned slot for running our
# code inside a session, and all three hand that slot the same session id the
# tool reports in its own telemetry, which is what lets the event join:
#
#   - Claude Code: settings hooks. SessionStart and Stop, session id and working
#     directory on stdin, and on Stop the live trace context in the environment.
#   - Codex: config hooks, the same wire shape (session_id, cwd and
#     hook_event_name on stdin). The id it hands the hook is the thread id its
#     spans carry. Codex asks the user to review a newly declared hook before it
#     runs, so installing writes the declaration and the user grants it once.
#   - opencode: a plugin module. It has no command hooks at all, so the plugin
#     subscribes to the session event bus and runs the same command with the
#     same payload the other two produce.
#
# One command serves all three: the git work, the fingerprint, the payload and
# the endpoint resolution are tool-agnostic and only the seam differs. It must
# never write to stdout (a Claude Code SessionStart hook's stdout is injected
# into the user's session context) and must never fail the session (always exit
# zero).

Feature: Coding agent session context hook

Rule: Installing wires each tool's seam without touching the user's own

  @unit
  Scenario: Installing claude_code merges the SessionStart and Stop hooks idempotently
    Given a settings file without the LangWatch hooks
    When the claude_code ingestion install runs twice
    Then the settings carry exactly one LangWatch entry per hook event

  @unit
  Scenario: User-authored hooks survive the merge untouched
    Given a settings file with the user's own SessionStart hook
    When the claude_code ingestion install runs
    Then the user's hook entry is unchanged
    And the LangWatch entry sits alongside it

  @unit
  Scenario: Installing codex merges the same hooks into the codex hooks file
    Given a codex hooks file without the LangWatch hooks
    When the codex ingestion install runs twice
    Then the hooks file carries exactly one LangWatch entry per hook event
    And the entry runs the hook command for codex

  @unit
  Scenario: The codex install tells the user Codex asks for review once
    Given a codex ingestion install that wired the hooks
    When the report is printed
    Then it says Codex asks the user to review the hook before it runs

  @unit
  Scenario: Installing opencode writes the session context plugin
    Given an opencode plugin directory without the LangWatch plugin
    When the opencode ingestion install runs twice
    Then exactly one LangWatch plugin file is present
    And it runs the hook command for opencode

  @unit
  Scenario: A device whose exports are already current still gets the hooks
    Given telemetry exports persisted before the session hooks existed
    When the wrapper re-asserts that device's telemetry wiring
    Then the session hooks are installed and the exports are left as they were

  @unit
  Scenario: A settings file LangWatch cannot parse is never overwritten
    Given a settings file that is not valid JSON
    When the session hooks are installed into it
    Then the file is left exactly as it was
    And the install reports that it could not merge into it

  @unit
  Scenario: Logout removes exactly the LangWatch hook entries
    Given a settings file with LangWatch hooks and a user-authored hook
    When logout removes the telemetry targets
    Then the LangWatch hook entries are gone
    And the user's hook entry remains

  @unit
  Scenario: Logout removes the codex hooks and the opencode plugin
    Given a codex hooks file and an opencode plugin written by LangWatch
    When logout removes the telemetry targets
    Then both are gone

  @unit
  Scenario: A plugin file LangWatch did not write is never removed
    Given an opencode plugin file with the same name written by somebody else
    When logout removes the telemetry targets
    Then the file is left alone

Rule: The hook reports the git identity of the session

  @unit
  Scenario: The hook posts repo, branch and worktree for the session
    Given a hook invocation inside a git worktree with an origin remote
    When the hook runs
    Then one log record is posted carrying the session id
    And it carries the repository host, owner and name from the origin remote
    And it carries the current branch and the worktree name

  @unit
  Scenario: The record declares the agent whose seam invoked it
    Given a hook invocation for codex and one for opencode
    When each runs
    Then each record declares its own agent

  @unit
  Scenario: The opencode plugin runs the hook for each session event
    Given an opencode session that has just been created
    When the plugin receives the event
    Then it runs the hook command with the session id and the session's directory

  @unit
  Scenario: The Stop hook attaches the live trace context when present
    Given a Stop invocation whose environment carries a traceparent
    When the hook runs
    Then the posted record carries that trace and span id

  @unit
  Scenario: A traceparent that names no live context leaves the record unlinked
    Given a Stop invocation whose traceparent carries the all-zero ids
    When the hook runs
    Then the posted record carries no trace id

  @unit
  Scenario: An unchanged context does not re-post
    Given a session whose context was already reported
    When a Stop invocation sees the same repo, branch and worktree
    Then nothing is posted

  @unit
  Scenario: A changed branch re-posts
    Given a session whose context was already reported
    When a Stop invocation sees a different branch
    Then a new record is posted with the new branch

  @unit
  Scenario: Two agents reporting the same session id keep separate fingerprints
    Given a session id already reported for one agent
    When another agent reports the same session id
    Then the second agent posts rather than reading the first one's fingerprint

Rule: The hook never disturbs the session

  @unit
  Scenario: Outside a git repository the hook sends nothing and exits zero
    Given a hook invocation in a directory that is not a git repository
    When the hook runs
    Then nothing is posted and the exit code is zero

  @unit
  Scenario: A seam that fires with no session id sends nothing and exits zero
    Given a hook invocation whose payload carries no session id
    When the hook runs
    Then nothing is posted and the exit code is zero

  @unit
  Scenario: Without telemetry configuration the hook sends nothing and exits zero
    Given a hook invocation without an OTLP endpoint in the environment
    And a CLI that is not signed in
    When the hook runs
    Then nothing is posted and the exit code is zero

  @unit
  Scenario: An agent that strips the exporter variables still reports
    Given a hook invocation whose environment carries no OTLP variables
    And a CLI signed in to a control plane with an ingest key for this agent
    When the hook runs
    Then the record is posted to that control plane
    And it is authorized with that ingest key

  @unit
  Scenario: A signed-in CLI with no key for this agent sends nothing
    Given a hook invocation whose environment carries no OTLP variables
    And a CLI signed in with an ingest key for a different agent
    When the hook runs
    Then nothing is posted and the exit code is zero

  @unit
  Scenario: The hook never writes to stdout even when the post fails
    Given a hook invocation whose telemetry endpoint is unreachable
    When the hook runs
    Then stdout stays empty and the exit code is zero

  @unit
  Scenario: A payload that never arrives does not outlive the session
    Given a seam that spawns the hook with a pipe it never closes
    When the hook reads its payload
    Then it stops waiting at the deadline and releases the pipe

  @unit
  Scenario: A write too large to be a payload is not buffered
    Given a seam that writes far more to the hook's stdin than a payload holds
    When the hook reads its payload
    Then it stops at the cap, releases the pipe and reads the input as empty

  @unit
  Scenario: The opencode plugin never fails the session it runs in
    Given an opencode plugin whose hook command cannot be spawned
    When a session event reaches it
    Then the event handler resolves and nothing is thrown
