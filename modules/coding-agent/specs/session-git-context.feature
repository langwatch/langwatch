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

Rule: Git identity folds as the present tense, last write wins

  # The session row answers where the session is NOW. A resumed session moves
  # between branches, worktrees and even repositories, and per-branch history
  # lives on the fact rows, so nothing is lost by letting the scalars move —
  # while a row frozen on its first repository can never be found by the
  # repository the session works in today.

  @unit
  Scenario: Repository identity and worktree follow the latest context event
    Given a session whose first context event names a repository and worktree
    When a later context event names a different repository and worktree
    Then the session carries the later repository identity and worktree

  @unit
  Scenario: A context event that omits a field keeps the previous value
    Given a session that declared a repository and worktree
    When a later context event names only a branch
    Then the session keeps the repository identity and worktree it had

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

Rule: Fact rows are stamped with the context declared before them

  # The declaration itself becomes no row; instead it becomes the stamp on
  # every row that follows it, which is what lets a session's cost split
  # across the pull requests it drove. The stamp is applied where the
  # pipeline already guarantees per-session ordering (the contribution
  # command lane), so there is no re-fold and no read-time time matching.

  @unit
  Scenario: A model call after a declaration carries the declared context
    Given a session that declared a repository and branch
    When a model call is contributed after it
    Then the stored fact row carries that repository and branch

  @unit
  Scenario: A model call before any declaration is stored unstamped
    Given a session that has not declared a working context
    When a model call is contributed
    Then the stored fact row carries no repository and no branch

  @unit
  Scenario: A new declaration moves the stamp for the rows that follow
    Given a session that declared one branch and then declared another
    When model calls are contributed after each declaration
    Then each fact row carries the branch declared before it

  @unit
  Scenario: A declaration with no branch stamps nothing
    Given a session whose declaration names a repository but no branch
    When a model call is contributed after it
    Then the stored fact row carries no stamped context

  # The stamp is a refinement of the record, never part of it, so a memo
  # outage costs later rows their stamp and nothing else. Those rows fall
  # back to the legacy whole-session rule.

  @unit
  Scenario: A record whose memo cannot be read is contributed unstamped
    Given a memo that fails every read
    When a model call is contributed
    Then the record is still contributed, carrying no stamped context

  @unit
  Scenario: A declaration whose memo cannot be written is still contributed
    Given a memo that fails every write
    When a session declares its working context
    Then the declaration is still contributed

Rule: The memo that carries the stamp forgets on its own

  # The memo holds one entry per live session. Redis expires them; the
  # no-Redis fallback has to do it itself, or a long-running process grows
  # one entry per session it ever saw.

  @unit
  Scenario: A memo entry is forgotten once its lifetime passes
    Given a context written to the no-Redis memo
    When its lifetime has passed
    Then the memo answers nothing for that session

  @unit
  Scenario: The no-Redis memo stops growing at its bound
    Given more sessions written to the no-Redis memo than it holds
    When the oldest session's context is read
    Then it has been evicted, and the newest sessions are still remembered

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
