# The Claude Code session context hook, git identity reported by the CLI
#
# Implementation:
#   sdks/typescript/src/cli/commands/ingestion/hook.ts          (the hook command)
#   sdks/typescript/src/cli/commands/ingestion/install.ts       (hooks merged at install)
#   sdks/typescript/src/cli/utils/governance/claude-hooks.ts    (settings.json merge/has/remove)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts (logout removal)
#
# Related specs:
#   specs/coding-agent/session-git-context.feature , what the pipeline does with the event
#   specs/ai-governance/cli-wrappers/shell-rc-persistence.feature , the persist flow that also installs the hooks
#
# Motivation: Claude Code computes repository identity internally but exports
# none of it over telemetry (verified at the raw wire). Hooks are the sanctioned
# slot: they fire in every mode including print and SDK sessions, they receive
# the session id and working directory, the Stop hook additionally receives the
# live trace context, and hook entries are additive so user-authored hooks are
# never touched. The hook runs git itself, fingerprints what it last sent, and
# posts one small OTLP log record to the endpoint Claude is already exporting
# to. It must never write to stdout (SessionStart stdout is injected into the
# user's session context) and must never fail the session (always exit zero).

Feature: Claude Code session context hook

Rule: Installing wires the hooks without touching the user's own

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
  Scenario: Logout removes exactly the LangWatch hook entries
    Given a settings file with LangWatch hooks and a user-authored hook
    When logout removes the telemetry targets
    Then the LangWatch hook entries are gone
    And the user's hook entry remains

Rule: The hook reports the git identity of the session

  @unit
  Scenario: The hook posts repo, branch and worktree for the session
    Given a hook invocation inside a git worktree with an origin remote
    When the hook runs
    Then one log record is posted carrying the session id
    And it carries the repository host, owner and name from the origin remote
    And it carries the current branch and the worktree name

  @unit
  Scenario: The Stop hook attaches the live trace context when present
    Given a Stop invocation whose environment carries a traceparent
    When the hook runs
    Then the posted record carries that trace and span id

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

Rule: The hook never disturbs the session

  @unit
  Scenario: Outside a git repository the hook sends nothing and exits zero
    Given a hook invocation in a directory that is not a git repository
    When the hook runs
    Then nothing is posted and the exit code is zero

  @unit
  Scenario: Without telemetry configuration the hook sends nothing and exits zero
    Given a hook invocation without an OTLP endpoint in the environment
    When the hook runs
    Then nothing is posted and the exit code is zero

  @unit
  Scenario: The hook never writes to stdout even when the post fails
    Given a hook invocation whose telemetry endpoint is unreachable
    When the hook runs
    Then stdout stays empty and the exit code is zero
