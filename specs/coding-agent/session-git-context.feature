# Session git context, repo/branch/worktree identity and the session title
#
# Implementation:
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-normalization.ts   (admission gate, contribution keys, aliases)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/subscribers/codingAgentLogFactsDispatch.subscriber.ts (declared-agent labeling, title stamp)
#   platform/app/src/server/app-layer/traces/canonicalisation/extractors/claudeCode.ts                                (title extraction from the response body)
#   platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-session.derivation.ts (fold semantics)
#   platform/app/src/server/clickhouse/migrations/00072_coding_agent_sessions_git_context.sql                          (session columns)
#
# Related specs:
#   specs/coding-agent/session-aggregate.feature                     , the session fold this enriches
#   specs/coding-agent/pull-request-linkage.feature                  , what the branch identity is for
#   specs/ai-governance/cli-wrappers/claude-session-context-hook.feature , the hook that emits the event
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
# Degradation, stated: agents without a companion emitter (Codex, Gemini CLI
# today) simply have no git context and no title; the vocabulary and the
# declared-agent seam are tool-agnostic so they can join without schema changes.

Feature: Session git context

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
