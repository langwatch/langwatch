Feature: Coding agent session summary
  As someone whose team runs coding agents
  I want each session summarised as it is ingested
  So that the app, the CLI and the MCP server all describe it the same way,
  without any of them re-deriving it from thousands of spans

  # A coding agent's trace IS the session: one real Claude Code session measured
  # 796 spans, 34 model calls and 192 tool runs. The facts are split across
  # signals — structure in the spans, content and half the story in the logs —
  # and a tool the user DENIED produces no span at all.
  #
  # The summary is agent-generic. What is agent-specific is only where we read
  # each fact from, which lives in an adapter.

  Background:
    Given a coding agent session is being ingested

  Scenario: The session records the work it did
    Given the agent made 34 model calls
    And it ran 192 tools
    And it spawned 2 sub-agents
    When the session is summarised
    Then the summary reports 34 model calls, 192 tool runs and 2 sub-agents
    And it reports which tools ran and how often

  Scenario: The steps are recorded in the order they happened
    Given the agent read two files, ran the tests, edited one file, then re-ran the tests
    When the session is summarised
    Then the steps read "Read, Bash, Edit, Bash" in that order
    # A tally would say "Bash twice, Read twice, Edit once" and lose the story:
    # it checked, ran, fixed, and checked again.

  Scenario: A run of the same tool is batched
    Given the agent read eight files one after another
    When the session is summarised
    Then the eight reads appear as a single step that ran eight times

  Scenario: A failed step is recorded where it happened
    Given the agent ran a command that failed, and then edited a file
    When the session is summarised
    Then the failed command is marked as failed, still in its place in the sequence
    # A command that failed BEFORE an edit means something different from one
    # that failed after, so failures are never hoisted out of sequence.

  Scenario: A sub-agent's work does not flatten into the session's steps
    Given the agent spawned a sub-agent that read twenty files of its own
    When the session is summarised
    Then the sub-agent's reads do not appear among the session's own steps
    And the session records that a sub-agent ran, and of what type

  Scenario: Spans that arrive out of order are still sequenced correctly
    Given the agent's spans arrive in a different order than they ran
    When the session is summarised
    Then the steps are still in the order they actually ran
    # Spans are exported in batches, so a slow tool's span can land after a later
    # one's. A plausible-looking but wrong sequence is worse than none.

  Scenario: A reply cut off by the token limit is not reported as an answer
    Given the agent's final model call stopped because it hit the token limit
    When the session is summarised
    Then the session is marked as cut off
    # Rendered as the session's output, a truncated reply reads exactly like a
    # finished one. Nothing else in the trace says otherwise.

  Scenario: The finish reason comes from the last model call, not the loop
    Given the agent made several model calls that each stopped to use a tool
    And its final model call finished its answer
    When the session is summarised
    Then the session is reported as finished, not as still using a tool

  Scenario: A tool the user denied is recorded, though it never ran
    Given the user denied a tool the agent asked to run
    When the session is summarised
    Then the session records that a tool was denied
    # A denied tool produces no span at all. Read only the spans and the moment
    # is invisible: the agent appears to have simply changed its mind.

  Scenario: A tool the user aborted is recorded separately from one that failed
    Given the user aborted a running tool
    When the session is summarised
    Then the session records the abort, and does not count it as a tool failure

  Scenario: Failed model calls and their retries are recorded
    Given two model calls failed and were retried
    When the session is summarised
    Then the session records two API errors
    # A failed call has no successful span, so it exists only in the logs.

  Scenario: Rate limiting is called out from other errors
    Given a model call was rejected because the agent was rate limited
    When the session is summarised
    Then the session records that it was rate limited

  Scenario: A mid-session context compaction is recorded with what it cost
    Given the agent's context was compacted from 180000 tokens to 42000
    When the session is summarised
    Then the session records the compaction, and the token count before and after
    # A compacted session answered from a summary rather than the real history.
    # It is the usual answer to "why did it forget?".

  Scenario: Cache creation is distinguished from cache reads
    Given the session read 900000 tokens from cache and re-created 200000
    When the session is summarised
    Then the session reports the cache reads and the cache creation separately
    # For a coding agent the expensive mistake is cache invalidation, not raw
    # tokens: a re-created cache is billed well above a cache read.

  Scenario: MCP servers and skills used are recorded
    Given the agent called a tool from an MCP server
    And it activated a skill
    When the session is summarised
    Then the session records which MCP server and which skill were used

  Scenario: The session records who ran it, when the agent says so
    Given the agent stamps a user identity on its events
    When the session is summarised
    Then the session records that user
    # Claude Code sends a user id on every event; agents that send none keep
    # the field empty rather than guessing.

  Scenario: The summary stays bounded no matter how long the session runs
    Given a runaway session with 20000 spans
    When the session is summarised
    Then the summary does not grow with the number of spans
    # This is what makes it safe to summarise an unbounded session at all.

  # The columns are agent-generic, but Claude Code is the only adapter written:
  # the span-name gate, the metric application, and the log fold all read
  # Claude's names today. Other recognised agents (Codex, opencode, Gemini CLI,
  # Copilot) pass the vocabulary layer but produce no session row until their
  # adapters exist.
  @unimplemented
  Scenario: A session from a different coding agent is summarised the same way
    Given the session came from a coding agent other than Claude Code
    When the session is summarised
    Then it reports the same facts, in the same columns
    # The facts are not Claude-specific. Only where we read them from is.

  Scenario: A trace that is not a coding agent is not summarised
    Given an ordinary LLM trace
    When it is ingested
    Then no coding agent session is written for it
