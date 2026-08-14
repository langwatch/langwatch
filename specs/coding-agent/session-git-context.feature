# Session git context, repo/branch/worktree identity and the session title
#
# Implementation:
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-normalization.ts   (admission gate, contribution keys, aliases)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/subscribers/codingAgentLogFactsDispatch.subscriber.ts (declared-agent labeling, title stamp)
#   platform/app/src/server/app-layer/traces/canonicalisation/extractors/claudeCode.ts                                (title extraction from the response body)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-session.derivation.ts (fold semantics)
#   platform/app/src/server/clickhouse/migrations/00075_coding_agent_sessions_git_context.sql                          (session columns)
#   platform/app/src/server/clickhouse/migrations/00077_coding_agent_sessions_git_branches.sql                         (every branch the session drove)
#
# Related specs:
#   specs/coding-agent/session-aggregate.feature                     , the session fold this enriches
#   specs/coding-agent/pull-request-linkage.feature                  , what the branch identity is for
#   specs/ai-governance/cli-wrappers/session-context-hook.feature , the hook that emits the event
#
# Motivation: coding agents export no repository, branch or working-directory
# identity over telemetry (verified at the raw OTLP wire). A LangWatch-installed
# hook emits one small companion log event, `langwatch.session_context`, carrying
# the session id plus vcs identity attributes. The pipeline admits it through an
# explicit event-name gate (never by imitating a vendor's instrumentation scope),
# labels it with the agent the event declares, and folds the git identity onto
# the session. Claude Code also generates a conversation title; it arrives as a
# response-body log event today and is folded onto the session as its Title,
# treated as conversation-derived content for visibility purposes.
#
# Nothing here is per-agent: the admission gate is one event-name equality, the
# label is whatever the event declares (validated against the agent registry),
# and the fold reads the same attributes whoever sent them. Claude Code, Codex
# and opencode all emit the companion event today. An agent with no seam of its
# own (Gemini CLI, Copilot) simply has no git context and no title, and can join
# later without a schema change.

Feature: Session git context

Rule: Every agent that can emit the event joins on the same terms

  @unit
  Scenario: A session context event from Codex folds its git identity
    Given an admitted session context event declaring the codex agent
    When the session fold runs
    Then the session carries the repository, branch and worktree from the event

  @unit
  Scenario: A session context event from opencode folds its git identity
    Given an admitted session context event declaring the opencode agent
    When the session fold runs
    Then the session carries the repository, branch and worktree from the event

Rule: The session context event joins the fold honestly

  @unit
  Scenario: A langwatch session context event passes the log lift without a vendor scope
    Given a log record named langwatch.session_context under the langwatch hook scope
    When the coding-agent log facts are lifted
    Then the record is admitted and its vcs attributes are lifted
    And no vendor instrumentation scope was required

  @unit
  Scenario: A session context contribution is labeled with its declared agent
    Given an admitted session context event declaring the claude_code agent
    When the contribution is dispatched
    Then the contribution carries the claude_code agent label

  @unit
  Scenario: A declared agent outside the registry contributes nothing
    Given an admitted session context event declaring an agent LangWatch does not know
    When the contribution is dispatched
    Then no contribution reaches the session fold

  @unit
  Scenario: A session context event with no declared agent contributes nothing
    Given an admitted session context event that declares no agent
    When the contribution is dispatched
    Then no contribution reaches the session fold

Rule: Git identity folds with honest semantics

  @unit
  Scenario: Repository identity and worktree set once and do not move
    Given a session whose first context event names a repository and worktree
    When a later context event names a different repository
    Then the session keeps the first repository identity and worktree

  @unit
  Scenario: The branch follows the latest session context event
    Given a session that started on the default branch
    When a later context event reports a newly created feature branch
    Then the session's branch is the feature branch

  @unit
  Scenario: A session context event contributes no session-events row
    Given an admitted session context event
    When the session events fact table is projected
    Then no row is written for the context event

Rule: A session remembers every branch it drove

  # The branch a session ENDS on is the one it is working in, and that is what
  # `GitBranch` answers. It is not the only branch the session drove: an agent
  # that lands one change, moves on and opens a second pull request is one
  # session behind two of them, and remembering only the last branch drops the
  # first pull request from everything read off the session. The set is the
  # session's whole history of branches; the scalar stays the present tense.

  @unit
  Scenario: Every branch a session reports joins its branch set, first seen first
    Given a session that reports one branch and later another
    When the session fold runs
    Then the branch set names both, in the order they were reported
    And the session's current branch is the later one

  @unit
  Scenario: A branch reported twice joins the set once
    Given a session that returns to a branch it already reported
    When the session fold runs
    Then the branch set names that branch once

  @unit
  Scenario: The branch set stops growing at its bound
    Given a session that reports more branches than the set will hold
    When the session fold runs
    Then the set holds the first branches it saw and no more

Rule: The session title lifts from the generated conversation title

  @unit
  Scenario: The title lifts from a generate_session_title response body, capped
    Given a response body event whose query source is the session title generator
    When the coding-agent log facts are dispatched
    Then the session title fact carries the generated title, capped in length

  @unit
  Scenario: A conversational response body sets no title
    Given a response body event from the conversational thread
    When the coding-agent log facts are dispatched
    Then no session title fact is stamped

  @unit
  Scenario: An unparseable title body sets no title
    Given a title-generator response body that does not parse
    When the coding-agent log facts are dispatched
    Then no session title fact is stamped
    And the contribution otherwise proceeds

Rule: The session row stores and reads back the git context

  @integration
  Scenario: A session folds repo, branch, worktree and title into its row and reads back
    Given a session receiving a context event and a generated title
    When the session fold writes and the row is read back
    Then the row carries the repository host, owner and name
    And the row carries the branch, worktree and title

  @integration
  Scenario: A session row from before the git context columns decodes with empty context
    Given a session row written before the git context columns existed
    When the row is read back
    Then the session decodes with no repository, branch, worktree or title
    And the rest of the session is intact

  @integration
  Scenario: The branch set round-trips through the session row
    Given a session that drove several branches
    When the session fold writes and the row is read back
    Then the row carries every branch it drove, in the order they were reported

  @unit
  Scenario: A session row from before the branch set column falls back to its one branch
    Given a session row written before the branch set column existed
    When a reader asks which branches the session drove
    Then it answers with the branch the session ended on
