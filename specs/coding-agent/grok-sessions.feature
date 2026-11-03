# Grok sessions, one row per Grok session id, folded from log events
#
# Implementation:
#   modules/coding-agent/contract/src/telemetry/grok.ts                   (the agent definition)
#   modules/coding-agent/contract/src/telemetry/index.ts                  (the registry, LOGS_ONLY and LOGS_REQUIRE_SESSION_KEY)
#   modules/coding-agent/contract/src/telemetry/coding-agent-definition.ts (the codingAgentSchema enum)
#   modules/coding-agent/process/src/eventing/coding-agent-session-log.projection.ts (the log fold)
#   modules/coding-agent/process/src/eventing/coding-agent-session-state.projection.ts (withIdentity, the lineage)
#   modules/coding-agent/browser/src/model/assistant-presets.ts           (and the governance and user copies)
#   modules/trace/browser/src/model/coding-agent/trace/terminal-session-banner.ts
#   modules/trace/browser/src/model/terminal-origin.ts
#
# Related specs:
#   specs/coding-agent/session-aggregate.feature         , the generic fold Grok joins
#   specs/coding-agent/grok-model-calls.feature          , per-call tokens and cost
#   specs/coding-agent/sessions-screen.feature           , the row a Grok session becomes
#   specs/coding-agent/terminal-view.feature             , how a Grok session reads back
#   specs/ai-governance/cli-wrappers/grok-hook-install.feature, what posts the context record
#   specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
#
# Motivation: Grok is a logs-only agent with Claude Code's event vocabulary, so
# it joins the registry the way Claude Cowork does (logsOnly) and the way
# opencode's ambient records are handled (logsRequireSessionKey). No Grok-
# shaped branch is added to the fold.
#
# Event names observed on the wire, after the `grok_code.` prefix is stripped:
#   user_prompt, assistant_response, api_request, tool_decision, tool_result,
#   mcp_server_connection, session_start, session_end, turn_completed,
#   subagent, model_switched.
# The first six are already in the shared vocabulary. The rest map onto
# nothing in v1, which costs one lookup each and folds nothing.
#
# Subagents differ from Claude Code. Claude keeps a subagent's events on the
# parent's session id; Grok gives the subagent a NEW session id and its
# telemetry names no parent. The row model already has lineage
# (ParentSessionId, stamped from `parent_session_id`), so the child is its own
# row and the link comes from Grok's SubagentStart hook, which fires in the
# parent with the child's id as `subagentId`.

Feature: Grok sessions

Rule: Only Grok's records join a Grok session

  @unit
  Scenario: Grok's turn events are admitted to a Grok session
    Given the user_prompt, api_request, tool_result and assistant_response records of one Grok session
    When the session log gate decides on each
    Then each is admitted under the grok agent

  @unit
  Scenario: A Grok record without a session id is ambient, not a session
    Given a grok_code.mcp_server_connection record with no session.id
    When the session log gate decides on it
    Then it is skipped
    And no session row is created for it

  @unit
  Scenario: Grok's lifecycle events fold nothing and break nothing
    Given a Grok session whose records include session_start, turn_completed, model_switched and session_end
    When the session is folded
    Then the row is the same as the one folded without them

Rule: One row per Grok session id

  @unit
  Scenario: A Grok session becomes one row keyed by its session id
    Given the records of one Grok session
    When they are folded
    Then exactly one session row exists, keyed by Grok's session.id
    And the row's agent is grok
    And the row shows the model and the token totals

  @unit
  Scenario: A resumed Grok session keeps folding onto the same row
    Given a Grok session of one turn
    And a second process that resumes it with `grok -c` and runs a second turn
    When both processes' records are folded
    Then one row exists for the session
    And its turn count is two

  @unit
  Scenario: Two concurrent Grok sessions fold into two rows
    Given the records of two Grok sessions interleaved in arrival order
    When they are folded
    Then two session rows exist, one per session id

  @unit
  Scenario: Tool runs are counted under Grok's own tool names
    Given a Grok session whose tool_result records name "read_file" twice and "run_terminal_command" once
    When the session is folded
    Then the row's tool counts are "read_file" twice and "run_terminal_command" once

  @unit
  Scenario: A failed Grok tool run is counted as failed
    Given a Grok session whose tool_result record says success "False"
    When the session is folded
    Then the row counts one failed tool run

  # Grok decides with allow, deny, followup or cancelled; Claude says accept or reject.
  @unit
  Scenario: Grok's tool decisions are counted in its own words
    Given a Grok session whose tool_decision records say "allow", "deny", "followup" and "cancelled"
    When the session is folded
    Then the row counts two denied tool runs and one aborted tool run

  # Grok names the server apart, as mcp_server_name, and the tool "<server>__<tool>".
  @unit
  Scenario: A Grok MCP tool run names its server and tool on the row
    Given a Grok session whose tool_result names "github__search_repositories" with mcp_server_name "github"
    When the session is folded
    Then the row's MCP servers are "github" and its MCP tools are "search_repositories"

  @unit
  Scenario: Grok's version and entrypoint reach the row
    Given Grok records whose resource carries service.version and app.entrypoint "headless"
    When the session is folded
    Then the row carries that agent version and the entrypoint "headless"

  @unit
  Scenario: The row's opaque user id is Grok's, the email never is
    Given Grok records carrying user.id and user.email
    When the session is folded
    Then the row's user id is the user.id value
    And no field of the row holds the email

Rule: A subagent is its own row, linked to the session that spawned it

  @unit
  Scenario: A Grok subagent's records fold into a row of its own
    Given a Grok session that spawned one subagent
    And the subagent's records carry a session id different from the parent's
    When all the records are folded
    Then two rows exist, one for the parent and one for the subagent
    And the subagent's model calls and cost are on the subagent's row only

  @unit
  Scenario: The SubagentStart hook links the child row to its parent
    Given the parent's SubagentStart hook ran with the child's id as subagentId
    When the context record it posted is folded
    Then the child row's parent session id is the parent's session id

  @unit
  Scenario: Grok's subagent launch and completion events are not counted as sessions
    Given grok_code.subagent records carrying no session.id
    When they are received
    Then no session row is created for them

Rule: The session reads back as Grok's

  @unit
  Scenario: The session list names the agent Grok
    Given a folded Grok session
    When the sessions list is read
    Then its row's assistant is shown as Grok

  # The banner reads its model off model-call spans and Grok sends none, so a
  # Grok banner carries no model, as Cowork's does without its beta spans.
  @unit
  Scenario: The terminal banner names Grok and its version
    Given a Grok session whose resource carries service.name "grok-cli" and service.version "1.0.70 (f50904eaee6c)"
    When the terminal view opens it
    Then the banner names Grok and that version

  # Grok wraps every top-level prompt in <user_query> tags; a subagent's prompt
  # is bare. deriveSessionTitleFromPrompt returns null for any prompt opening
  # with "<", so without unwrapping every top-level Grok session is untitled.
  @unit
  Scenario: A Grok session is titled from its first prompt without the query wrapper
    Given a Grok session whose first prompt arrived as "<user_query>\nAdd a subtract function.\n</user_query>"
    When the session is folded
    Then its title is "Add a subtract function."

  @unit
  Scenario: A Grok session's git context comes from the hook record
    Given a Grok session and the session context record its SessionStart hook posted
    When the session is folded
    Then the row carries the repository, branch and worktree from the record

Rule: A Grok turn reads back in the Trace Explorer

  # Grok sends no spans: each turn is a log-only trace, its prompt and reply lifted from events.
  @unit
  Scenario: A Grok turn's trace shows the prompt as input and the reply as output
    Given a Grok user_prompt record whose prompt is "<user_query>\nAdd a subtract function.\n</user_query>"
    And a Grok assistant_response record whose response is "Added subtract()."
    When the trace's input and output are read from the records
    Then the input is "Add a subtract function." and the output is "Added subtract()."

  @unit
  Scenario: A Grok turn's transcript lists each tool run with its input and output
    Given a Grok tool_result record for "read_file" with tool_input and tool_output
    When the trace's transcript is built
    Then it holds a tool entry "read_file" with that input and output

  @unit
  Scenario: A Grok tool run's output is withheld behind the output gate
    Given a Grok tool_result record carrying tool_input and tool_output
    When the project withholds tool content
    Then tool_output is withheld as output and tool_input as input

  @unit
  Scenario: An allowed Grok tool call is not shown as rejected
    Given Grok tool_decision records for "read_file" saying "allow" and for "run_terminal_command" saying "deny"
    When the trace's transcript is built
    Then it holds one rejected entry, for "run_terminal_command"

  @unit
  Scenario: A Grok MCP tool run in the transcript names its server
    Given a Grok tool_result record for "github__search_repositories" with mcp_server_name "github"
    When the trace's transcript is built
    Then its tool entry names the MCP server "github"
