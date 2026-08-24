# The agent-declared working context, `langwatch ingest context`
#
# Implementation:
#   sdks/typescript/src/cli/commands/ingestion/context.ts               (the declare command)
#   sdks/typescript/src/cli/utils/governance/codex-live-session.ts      (which codex session is live on this machine)
#   sdks/typescript/src/cli/utils/governance/codex-agents-md.ts         (the guidance block in ~/.codex/AGENTS.md)
#   sdks/typescript/src/cli/utils/governance/session-guidance.ts        (the one guidance text every channel carries)
#   sdks/typescript/src/cli/plugin/session-guidance-entry.ts            (the plugin hook that injects the guidance)
#   sdks/typescript/src/cli/utils/governance/session-context-hooks.ts   (the raw-hooks guidance entry)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts       (logout removal)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/session-context-hook.feature , the hooks that report context automatically
#   specs/coding-agent/session-git-context.feature , what the pipeline does with the record
#   specs/coding-agent/pull-request-linkage.feature , how branches become pull requests
#
# Motivation: the hooks report the directory the agent process runs in. That is
# correct until the agent works somewhere else: a claude session that only `cd`s
# inside its shell tool, or a codex agent that lives for weeks in a scratch
# directory and reviews one checkout after another. Codex records its directory
# once at session start and nothing moves it, so a standing agent reports no
# repository, no branch and no pull request, no matter how much it works.
#
# The command lets the agent declare its context itself: run from inside a
# checkout, it posts the same session-context record the hooks post, for the
# session the agent is running in. The guidance channels tell every session to
# run it when it switches repository or branch, so the agent does not need to
# be taught per machine.
#
# The record folds like any other session-context record: the platform appends
# each branch it sees, keeps the latest as the session's branch, and matches
# pull requests against all of them. The repository owner and name on the
# session row keep the first repository the session reported; a declaration for
# a second repository still lands its branch. After a declaration, the next
# automatic hook may re-post the process's own directory once before going
# quiet again; the fold appends, so this is expected and harmless.

Feature: Agent-declared session context

Rule: The agent can declare its working context itself

  @unit
  Scenario: Declaring inside a checkout posts repo, branch and worktree
    Given a resolvable coding-agent session
    When the declare command runs inside a git worktree with an origin remote
    Then one log record is posted carrying the session id
    And it carries the repository host, owner and name from the origin remote
    And it carries the current branch and the worktree name
    And the command prints one line naming what it declared

  @unit
  Scenario: A claude session is resolved from its own environment
    Given an environment where CLAUDECODE is set and CLAUDE_CODE_SESSION_ID names a session
    When the declare command runs with no flags
    Then the record declares claude_code with that session id

  @unit
  Scenario: A codex session is resolved from the one active rollout
    Given no claude environment and a codex rollout active within the last fifteen minutes
    When the declare command runs with no flags
    Then the record declares codex with the session id of that rollout

  @unit
  Scenario: A codex launched inside a claude session declares for the claude session
    Given an environment where CLAUDECODE is set
    And a codex rollout active within the last fifteen minutes
    When the declare command runs with no flags
    Then the record declares claude_code, not codex

  @unit
  Scenario: Explicit flags override every resolution
    Given an environment where CLAUDECODE is set
    When the declare command runs with an explicit agent and session id
    Then the record declares exactly that agent and session id

  # Codex holds its rollout transcript open for the whole session and spawns
  # the shell that runs the command, so the session asking is identifiable by
  # construction. The first ancestor process holding a rollout open is it.
  # The identifying property is the open rollout, not the process name.
  @unit
  Scenario: The invoking codex session is resolved from the ancestor process that holds the rollout open
    Given the command runs under a codex process that holds its rollout open
    And another codex session wrote its rollout more recently
    When the declare command runs with no flags
    Then the record declares codex with the session id of the ancestor's rollout

  # The process tree cannot always be read: a restrictive sandbox, a platform
  # without the tools, or a command run outside any codex process at all.
  @unit
  Scenario: Ancestor resolution unavailable falls back to recent-rollout inference
    Given no ancestor process holds a codex rollout open
    When the declare command runs with no flags
    Then the session is inferred from the recently written rollouts instead

  # Nothing on disk says which of two simultaneously active sessions spawned
  # the process running the command, so it names neither. A session mid-turn
  # wrote its rollout seconds ago, which is what tells a second running
  # session apart from a session that ended when codex was restarted.
  @unit
  Scenario: Two simultaneously active codex sessions declare nothing
    Given two codex rollouts each written within the last minute
    When the declare command runs with no flags
    Then nothing is posted
    And the command prints one line saying to name the session with the flags
    And the exit code is zero

  @unit
  Scenario: The session in the middle of a turn wins over an idle one
    Given one codex rollout written within the last minute
    And other codex rollouts written earlier inside the fifteen minute window
    When the declare command runs with no flags
    Then the record declares codex with the session id of the rollout written within the last minute

  @unit
  Scenario: A codex restart still resolves without flags
    Given the rollout of a session that ended on restart, still inside the window
    And the rollout of the running session, written within the last minute
    When the declare command runs with no flags
    Then the record declares codex with the session id of the running session

  @unit
  Scenario: Explicit flags name a session while two are active
    Given two codex rollouts each written within the last minute
    When the declare command runs with an explicit agent and session id
    Then the record declares exactly that agent and session id

  @unit
  Scenario: A stale rollout does not resolve
    Given only a codex rollout last written before the window
    When the declare command runs with no flags
    Then nothing is posted
    And the command prints one line saying no live session was found and how to pass one
    And the exit code is zero

  @unit
  Scenario: Outside a git repository nothing is posted
    Given a resolvable coding-agent session
    When the declare command runs in a directory that is not a git repository
    Then nothing is posted
    And the command prints one line saying there is no repository here
    And the exit code is zero

  @unit
  Scenario: A detached HEAD declares the repository without a branch
    Given a resolvable coding-agent session
    When the declare command runs inside a checkout with a detached HEAD
    Then the record carries the repository identity and no branch

  @unit
  Scenario: Without telemetry configuration nothing is posted
    Given a resolvable coding-agent session and a CLI that is not signed in
    When the declare command runs without an OTLP endpoint in the environment
    Then nothing is posted
    And the command prints one line saying telemetry is not configured
    And the exit code is zero

  @unit
  Scenario: A declaration and a hook for the same context post once between them
    Given a session whose context the hook already posted
    When the declare command runs in the same checkout for the same session
    Then nothing is posted
    And the command says the context was already declared

  @unit
  Scenario: A live traceparent rides the record
    Given an environment carrying a traceparent
    When the declare command posts a record
    Then the record carries that trace and span id

  @unit
  Scenario: A failed post does not record the fingerprint
    Given a collector that refuses the post
    When the declare command runs
    Then the fingerprint is not written
    And the exit code is zero

Rule: The agent is told when to declare

  The guidance is one short text with one source in the code, injected through
  each agent's own always-loaded channel: the claude plugin's SessionStart
  hook, the raw settings hooks for a claude without plugin support, and the
  global AGENTS.md for codex, which has no plugin system.

  @unit
  Scenario: Instrumenting codex installs the guidance block idempotently
    Given a codex home whose AGENTS.md has no LangWatch block
    When the codex guidance is asserted twice
    Then AGENTS.md carries exactly one LangWatch block
    And the block names the declare command

  @unit
  Scenario: User content in AGENTS.md survives install and removal untouched
    Given an AGENTS.md with the user's own instructions
    When the guidance is installed and then removed
    Then the user's content is byte for byte what it was

  @unit
  Scenario: Logout removes exactly the LangWatch AGENTS.md block
    Given an AGENTS.md carrying the LangWatch block and user content
    When logout removes the telemetry targets
    Then the block is gone and the user's content remains

  @unit
  Scenario: An AGENTS.md we created and emptied is removed entirely
    Given an AGENTS.md that holds only the LangWatch block
    When the guidance is removed
    Then the file is gone

  @unit
  Scenario: The plugin's guidance hook emits the guidance as session context
    When the plugin's session guidance entry runs
    Then stdout is one JSON object whose additionalContext carries the guidance
    And the exit code is zero

  @unit
  Scenario: The raw claude hooks carry the guidance entry
    Given a settings file without the LangWatch hooks
    When the claude_code session hooks are installed
    Then a SessionStart entry runs the guidance command
    And logout removes it with the other LangWatch entries
