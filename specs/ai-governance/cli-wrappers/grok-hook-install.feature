# Grok's session context hook, one hook file LangWatch owns
#
# Implementation:
#   sdks/typescript/src/cli/utils/governance/session-context-agents.ts (SESSION_CONTEXT_AGENTS, Grok's row)
#   sdks/typescript/src/cli/utils/governance/session-context-hooks.ts  (the owned hook file writer)
#   sdks/typescript/src/cli/commands/ingestion/hook.ts                 (the hook command)
#   sdks/typescript/src/cli/commands/ingestion/hook-input.ts           (the payload read)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts      (logout removal)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/session-context-hook.feature, the shared hook and Copilot's owned file
#   specs/coding-agent/grok-sessions.feature                    , what the record folds into
#
# Motivation: Grok's telemetry, like every agent's, carries no repository or
# branch. Grok runs Claude Code-style hooks: matcher groups under the event
# name, the same snake_case payload (session_id, cwd, hook_event_name
# "SessionStart"), and GROK_SESSION_ID in the hook's environment. Captured:
# the hook's session_id is the same value Grok puts on session.id.
#
# Grok loads every `*.json` in `~/.grok/hooks` (or `$GROK_HOME/hooks`), so
# LangWatch writes its own `langwatch.json` there, Copilot's owned-file shape.
#
# Grok ALSO loads `~/.claude/settings.json` hooks and the Claude plugins by
# default (`compat.claude.hooks`). The LangWatch Claude hook therefore already
# runs inside every Grok session today, declaring the claude_code agent for a
# Grok session id. That record would make a phantom Claude row, so the Claude
# hook steps aside when Grok is the one running it.
#
# Grok runs global hooks only once the folder is trusted (its startup prompt
# or `/hooks-trust`; there is no flag), as Claude Code asks for workspace
# trust; the install says so.

Feature: Grok session context hook

Rule: Installing writes one hook file LangWatch owns

  @unit
  Scenario: Installing grok writes LangWatch's own hook file
    Given a Grok hooks folder without the LangWatch file
    When the grok ingestion install runs twice
    Then exactly one LangWatch hook file is present at ~/.grok/hooks/langwatch.json
    And it runs the hook command for grok on SessionStart, Stop and SubagentStart

  # The proof run on 1.0.70 found `langwatch grok` alone left no hook file:
  # only the install, instrument or the shell rc prompt wrote it.
  @unit
  Scenario: Launching through langwatch grok writes LangWatch's own hook file
    Given a Grok hooks folder without the LangWatch file
    When the wrapper prepares a grok launch
    Then the LangWatch hook file is present in the Grok hooks folder
    And it runs the hook command for grok

  @unit
  Scenario: The Grok hook file follows GROK_HOME
    Given GROK_HOME points at another folder
    When the grok ingestion install runs
    Then the LangWatch hook file is written under that folder's hooks directory

  @unit
  Scenario: The user's own Grok hook files are never touched
    Given a Grok hooks folder holding a hook file the user wrote
    When the grok ingestion install runs and logout then removes the telemetry targets
    Then the user's hook file is unchanged throughout
    And the LangWatch hook file is gone after logout

  @unit
  Scenario: A langwatch.json LangWatch did not write is never rewritten
    Given a Grok langwatch.json that LangWatch did not write
    When the grok ingestion install runs
    Then the file is left exactly as it was
    And the user is told Grok sessions will not report their repository or branch

  @unit
  Scenario: The install says Grok runs the hook only in a trusted folder
    When the grok ingestion install report is printed
    Then it says Grok runs the hook once the folder is trusted

Rule: The hook reports Grok's session

  @unit
  Scenario: A Grok hook payload yields its session id and directory
    Given the SessionStart payload captured from grok 1.0.70
    When the payload is read
    Then it yields the session id, the directory and the event name SessionStart

  @unit
  Scenario: The Grok hook posts a context record for the grok agent
    When `langwatch ingest hook grok` runs for session "s-1" in a git repository
    Then the record declares the agent "grok"
    And it carries the session id "s-1", the same value Grok puts on session.id
    And it posts with the personal ingest key for grok_cli

  @unit
  Scenario: A SubagentStart payload posts the child's record with its parent
    Given a SubagentStart payload whose session_id is "parent-1" and subagentId is "child-1"
    When `langwatch ingest hook grok` runs on it
    Then the record is for session "child-1"
    And it carries parent_session_id "parent-1"
    And it carries the same repository and branch as the parent's

  @unit
  Scenario: The Grok hook never fails the session
    Given the LangWatch endpoint is unreachable
    When `langwatch ingest hook grok` runs
    Then it exits zero and prints nothing

Rule: The Claude hook steps aside inside Grok

  @unit
  Scenario: The Claude Code hook run by Grok posts nothing
    Given Grok runs the LangWatch Claude Code hook from ~/.claude/settings.json
    And the hook's environment carries GROK_HOOK_EVENT
    When `langwatch ingest hook claude-code` runs
    Then no record is posted
    And it exits zero and prints nothing

  @unit
  Scenario: The Claude plugin's hook run by Grok posts nothing
    Given Grok runs the hook bundled in the LangWatch Claude plugin
    And the hook's environment carries GROK_HOOK_EVENT
    When the hook command runs
    Then no record is posted

  @unit
  Scenario: The Claude Code hook outside Grok still reports
    Given the hook's environment carries no GROK_HOOK_EVENT
    When `langwatch ingest hook claude-code` runs for a Claude Code session
    Then the record is posted for the claude_code agent
