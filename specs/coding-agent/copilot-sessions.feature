Feature: Copilot sessions
  Copilot sessions and the pull requests they feed. Decision:
  dev/docs/adr/039-copilot-cli-as-tracked-coding-assistant.md, §Extension #3.
  Tracked by #8589; the facts come from the #8803 captures (Copilot CLI 1.0.100,
  VS Code Copilot Chat 0.67), redacted in
  modules/trace/process/src/services/__tests__/fixtures/copilot-*.json.

  Copilot names its spans `{operation} {target}` (`chat gpt-6-luna`,
  `execute_tool rg`, `invoke_agent`). Its definition declares which operation
  plays which role, and the generic fold reads the declaration. Repository and
  branch arrive through the session context hook, see
  specs/ai-governance/cli-wrappers/session-context-hook.feature.

  Out of scope: the Copilot app, which has not been captured.

Rule: Only Copilot's declared operations join a Copilot session

  @unit
  Scenario: A chat span from another coding agent is not admitted as a Copilot session span
    Given a span named "chat" from the Gemini CLI scope
    And a span named "chat gpt-6-luna" from the opencode scope
    When the session span gate decides on each
    Then neither is admitted

  @unit
  Scenario: Copilot Studio spans never join a coding-agent session
    Given the conversation, turn and tool spans of a Copilot Studio audit feed
    When the session span gate decides on each
    Then none is admitted

  @unit @unimplemented @issue:8803
  Scenario: Copilot's model call, session root and tool run spans are admitted
    Given the captured chat, invoke_agent and execute_tool spans from the Copilot CLI and from VS Code
    When the session span gate decides on each
    Then each is admitted

  @unit @unimplemented @issue:8803
  Scenario: A Copilot span of an undeclared operation is not admitted
    Given a captured execute_hook span from VS Code Copilot Chat
    When the session span gate decides on it
    Then it is not admitted

Rule: One row per conversation, every number from the model calls

  @unit @unimplemented @issue:8803
  Scenario: A Copilot CLI session becomes one row with model, tokens and AI units
    Given the captured spans of one Copilot CLI conversation
    When they are folded
    Then exactly one session row exists, keyed by the conversation id
    And it shows the model, the input and output tokens and the AI units

  @unit @unimplemented @issue:8803
  Scenario: Tokens and AI units are counted from model calls, never again from the session root
    Given a session root whose usage is the rollup of its two model calls
    When the session is folded
    Then the row's tokens and AI units equal the sum of the two model calls

  @unit @unimplemented @issue:8803
  Scenario: The session root sets the row's start, end and duration
    Given a session root span and the model calls inside it
    When the session is folded
    Then the row starts and ends with the session root

  @unit @unimplemented @issue:8803
  Scenario: Tool runs are counted with their names
    Given a Copilot session with three execute_tool spans
    When the session is folded
    Then the row shows three tool runs, each with its tool name
    And the number of rows does not change

  @unit @unimplemented @issue:8803
  Scenario: A Copilot span without a conversation id mints no row
    Given a captured VS Code title model call, which carries no conversation id
    When it is folded
    Then no session row is created for it

  @unit @unimplemented @issue:8803
  Scenario: Copilot model calls are model calls everywhere
    Given a captured Copilot chat span
    When the span is stamped, folded and shown in the trace browser
    Then all three treat it as a model call

  @unit @unimplemented @issue:8803
  Scenario: The row shows the surface it ran in
    Given one Copilot session from the CLI and one from VS Code
    When the rows are listed
    Then both rows have the agent "copilot"
    And one shows the CLI surface and the other the VS Code surface

  @unit @unimplemented @issue:8803
  Scenario: Claude Code and Codex rows are unchanged by the Copilot declarations
    Given Claude Code and Codex sessions folded before the Copilot declarations
    When the same sessions are folded after them
    Then every row is identical

Rule: The session context links a Copilot session to its pull request

  @integration @unimplemented @issue:8803
  Scenario: A Copilot session context sets the row's repository and branch
    Given a Copilot session row keyed by its conversation id
    When a session context record for the same id declares the agent "copilot"
    Then the row shows the repository host, owner, name and branch

  @integration @unimplemented @issue:8803
  Scenario: A Copilot session on a branch with an open pull request is listed on it
    Given a Copilot session whose branch has an open pull request
    When the session maps to pull requests
    Then the pull request lists the session

  @integration @unimplemented @issue:8803
  Scenario: A repository switch during a Copilot session follows the Claude Code rule
    Given a Copilot session that reports one repository and then another
    When both session context records are folded
    Then the row shows the repository host, owner and name from the later record
    And the result matches the same records folded for a Claude Code session

Rule: Pull-request cost keeps AI units apart from dollars

  @unit @unimplemented @issue:8803
  Scenario: Each Copilot model on a pull request has known tokens
    Given a pull request fed by one Copilot session that used two models
    When its usage is read
    Then each model shows its own known token counts

  @unit @unimplemented @issue:8803
  Scenario: AI units are their own count and never enter the dollar total
    Given a Copilot session that consumed AI units
    When the pull request cost is shown
    Then the AI units appear as a count
    And the dollar total excludes them

  @unit @unimplemented @issue:8803
  Scenario: A model with no price shows its tokens and an unknown cost
    Given a Copilot model call on a model with no price
    When the pull request cost is shown
    Then its tokens appear and its cost reads as unknown, not zero
