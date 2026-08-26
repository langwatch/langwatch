# The portable telemetry vocabulary lives in the Coding Agent contract. The app
# event pipeline dispatches and folds its facts, and the package repositories
# persist the resulting session identity and branch history.

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

  @unit
  Scenario: The session's name lifts from the session context record
    Given a session context event carrying the session's name attribute
    When the coding-agent log facts are dispatched
    Then the session name fact carries it
    And the fold ranks it above the derived titles

  @unit
  Scenario: A context record with no repository still folds its titles
    Given a session context event carrying titles and no repository attributes
    When the contribution folds
    Then the session keeps no repository identity
    And the titles fold as they would with one

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
