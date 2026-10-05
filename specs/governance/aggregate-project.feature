@governance @authz
Feature: An aggregate project reads its member projects
  Leadership wants one view over every trace the company writes, starting
  with the personal projects coding agents write into. An aggregate project
  is a real project that owns no traces of its own. A stored scope rule says
  which projects it reads, a reconciler turns that rule into one
  project-reader grant per member, and the trace list, trace detail and
  analytics read every member at once. Only organisation admins may open it,
  every read is audit-logged, and the strictest member privacy policy wins.
  Decision: ADR-144.

  Background:
    Given an organization with several personal projects
    And an organisation admin named ana
    And a member named sam who is not an admin

  # ── Creating ──────────────────────────────────────────────────────────────

  @integration
  Scenario: An admin creates an aggregate project from the new-project flow
    When ana creates a project of kind aggregate from the LLM ops new-project flow
    Then the project exists with the rule "all personal projects" preselected
    And it is attached to a team like any other project

  @integration
  Scenario: The rule may be narrowed to one department
    When ana creates an aggregate project with the rule "personal projects in department Engineering"
    Then only personal projects whose owner is in Engineering today are members
    # Department comes from the owner's current membership. Past moves are
    # ignored in this version.

  @integration
  Scenario: The rule may name an explicit list of any projects
    When ana creates an aggregate project with an explicit list of two projects
    Then exactly those two projects are members
    And the list may include projects that are not personal

  @integration
  Scenario: The hidden governance project is never a member
    When ana creates an aggregate project with the rule "all personal projects"
    Then the organisation's hidden governance project is not a member

  @unit
  Scenario: A rule that names a project in another organisation is refused
    When a rule names a project that belongs to a different organisation
    Then the rule is refused
    And no grant is written

  # ── Keeping members current ───────────────────────────────────────────────

  @integration
  Scenario: A new personal project joins an all-personal aggregate on creation
    Given an aggregate project with the rule "all personal projects"
    When a new member accepts an invite and their personal project is created
    Then the new personal project is a member of the aggregate

  @integration
  Scenario: Removing a project from an explicit rule revokes its read
    Given an aggregate project with an explicit list of two projects
    When ana edits the rule to drop one project
    Then that project's traces no longer appear in the aggregate
    And the revoked grant keeps its row marked revoked rather than deleted

  @integration
  Scenario: Reconciling twice changes nothing
    Given an aggregate project whose members are current
    When the reconciler runs again
    Then the ledger holds the same grant rows with the same ids
    And no duplicate row exists

  @integration
  Scenario: A nightly sweep catches a missed trigger
    Given an aggregate project with the rule "all personal projects"
    And a personal project that was created while the reconciler was unavailable
    When the nightly sweep runs for the organisation
    Then that personal project is a member

  # ── Who may open it ───────────────────────────────────────────────────────

  @integration
  Scenario: An organisation admin opens the aggregate project
    Given an aggregate project with three members
    When ana opens its trace list
    Then traces from all three members are listed as first-class rows

  @integration
  Scenario: A non-admin on the aggregate's team is refused
    Given an aggregate project whose team includes sam
    When sam opens the aggregate project
    Then the request is refused
    # Being on the team is not enough. Team membership must never become a
    # silent read grant over other people's personal data.

  @integration
  Scenario: A Developer seat never sees the aggregate project
    Given a member holding only a Developer seat
    When they list the projects they can open
    Then the aggregate project is absent

  @unit
  Scenario: A project-reader grant never escalates
    Given a project-reader grant from an aggregate to a member project
    When the grant is asked for traces manage, project manage or prompts view
    Then each is denied
    And traces view and analytics view are allowed

  @unit
  Scenario: Only the project-reader shape lifts the foreign-project refusal
    When a project principal is placed on a foreign project with any role key other than project-reader
    Then the grant is refused
    And a project principal placed on a team or an organisation is refused
    And a project-reader placement across two organisations is refused

  # ── Reading ───────────────────────────────────────────────────────────────

  @integration
  Scenario: A member trace opens in detail under the aggregate
    Given an aggregate project with a member holding one trace
    When ana opens that trace from the aggregate's list
    Then the detail page shows the trace's spans
    And the owning project is the member, not the aggregate

  @integration
  Scenario: A project outside the live member set contributes nothing
    Given an aggregate project with one member
    And another project in the organisation that is not a member
    When ana reads the aggregate's trace list, trace summary, spans and analytics
    Then no row from the non-member appears in any of them

  @integration
  Scenario: Analytics aggregate across members
    Given an aggregate project with two members each holding traces
    When ana opens the aggregate's analytics
    Then the counts cover both members' traces

  @integration
  Scenario: The owner's existing evaluation results show on a member trace
    Given a member trace that an online evaluation already scored
    When ana opens that trace from the aggregate
    Then the evaluation result is shown
    And no evaluation runs from the aggregate

  # ── Owning nothing ────────────────────────────────────────────────────────

  @integration
  Scenario: The aggregate project cannot receive traces
    Given an aggregate project
    When a trace is sent to the aggregate project's API key
    Then the request is refused
    And the aggregate holds zero spans

  @integration
  Scenario: The aggregate project is absent from every send-traces-here picker
    Given an aggregate project
    When a user lists projects to send traces to in the CLI, the ingest-key mint and the virtual-key destination picker
    Then the aggregate project is absent from each

  @integration
  Scenario: Billing stays with the owning project
    Given an aggregate project with a member holding traces
    When usage is counted
    Then the member's count is unchanged
    And the aggregate's count is zero

  @integration
  Scenario: Test, Build and Online Evals are hidden on the aggregate
    When ana opens the aggregate project
    Then the navigation shows Traces and Analytics
    And Prompts, Experiments and Online Evaluations are absent
    And no monitor can be created on the aggregate

  # ── Privacy and audit ─────────────────────────────────────────────────────

  @integration
  Scenario: The strictest member privacy policy applies
    Given an aggregate project with one member on a loose privacy policy
    And another member on a strict privacy policy
    When ana reads the aggregate's trace list
    Then the strict policy's redaction applies to every row

  @integration
  Scenario: Every admin read of the aggregate is audit-logged
    Given an aggregate project
    When ana opens its trace list and then a trace detail within five minutes
    Then one audit row of kind aggregate exists for ana and that project
    And a read ten minutes later writes a second row
