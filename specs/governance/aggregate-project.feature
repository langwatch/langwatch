@governance @authz
Feature: An aggregate project reads its member projects
  Leadership wants one view over every trace the company writes, starting
  with the personal projects coding agents write into. An aggregate project
  is a real project that owns no traces of its own. A stored scope rule says
  which projects it reads, a reconciler turns that rule into one shared
  project-reader grant per member, and every trace read carries a sealed
  authorization proof that the store client turns into the tenant set. Only
  organisation admins may open it, every visit is audit-logged the way admin
  workspace views are today, and the strictest member privacy policy wins.
  Decisions: ADR-144 (this feature), ADR-166 (the proof and the store client).

  The sections below follow the seven building blocks of ADR-144 v3.

  Background:
    Given an organisation with several personal projects
    And an organisation admin named ana
    And a member named sam who is not an admin

  # ── A. A grant may be shared from one project to another ─────────────────

  @unit
  Scenario: A project-reader grant from one project to another is accepted
    When a project-reader grant is placed with a project principal on a different project in the same organisation
    And the grant carries a condition of type trace with a from date and no where clause
    Then the grant is accepted

  @unit
  Scenario: Only the project-reader shape lifts the foreign-project refusal
    When a project principal is placed on a foreign project with any role key other than project-reader
    Then the grant is refused
    And a project principal placed on a team or an organisation is refused
    And a project-reader placement across two organisations is refused
    And a project-reader placement without a condition is refused

  @unit
  Scenario: A where clause is refused until the filter compiler exists
    When a project-reader grant carries a condition with a non-empty where clause
    Then the grant is refused
    # The slot is kept for the OTTL compiler. Nothing is compiled in v1.

  @unit
  Scenario: A project-reader grant never escalates
    Given a project-reader grant from an aggregate to a member project
    When the grant is asked for traces manage, project manage or prompts view
    Then each is denied
    And traces view and analytics view are allowed

  @integration
  Scenario: Revoking a shared grant keeps its row
    Given a live project-reader grant
    When the grant is revoked
    Then the row is marked revoked with a reason rather than deleted
    And the organisation's authorization epoch moves forward

  # ── B. A proof is minted at the door ─────────────────────────────────────

  @unit
  Scenario: Opening an aggregate mints one proof listing own and shared grants
    Given an aggregate project with two members
    When ana's request for traces view on the aggregate reaches the route
    Then one authorization proof is minted
    And it lists the aggregate as an own grant with ana's full permissions
    And it lists each member as a shared grant with only traces view, the grant id it came through and its condition
    And its expiry is the earliest expiry among those grants
    And its purpose is route

  @unit
  Scenario: A proof built outside the authorizer is refused
    When a proof is assembled by hand and handed to the store client
    Then the client refuses it as forged
    And no query runs

  @unit
  Scenario: An expired proof is refused
    Given a proof whose expiry has passed
    When it is handed to the store client
    Then the client refuses it as expired
    And no query runs

  @integration
  Scenario: A revoked grant is absent from the next proof
    Given an aggregate project with one member
    And a proof minted for ana
    When the member's grant is revoked
    And a new proof is minted for ana
    Then the new proof lists no shared grant for that member

  @unit
  Scenario: The proof travels as a named parameter
    When a service or repository that reads traces is called without the authorization parameter
    Then the call fails to type-check
    # ADR-166: never ambient, never async context. A missing proof is a
    # compile error, not a runtime surprise.

  # ── C. The store client applies the proof ────────────────────────────────

  @integration
  Scenario: The client adds the tenant set from the proof
    Given a proof with own grant on the aggregate and shared grants on members A and B
    When the trace list repository queries through the client with that proof
    Then the query is restricted to tenants aggregate, A and B
    And rows from A and B are restricted to the window of their grant

  @integration
  Scenario: A project outside the proof contributes nothing
    Given an aggregate project with one member
    And another project in the organisation that is not a member and holds traces
    When ana reads the aggregate's trace list, trace summary, spans and analytics
    Then no row from the non-member appears in any of them

  @integration
  Scenario: A trace written before the grant's from date is not shared
    Given a member whose grant starts today
    And a trace in that member written yesterday
    When ana reads the aggregate's trace list
    Then yesterday's trace is absent
    And a trace written today is present

  @unit
  Scenario: Trace repositories write no tenant of their own
    When the trace list, summary, span and analytics repositories are checked
    Then none of their query text names the tenant column
    And a repository that names it fails the lint gate

  @integration
  Scenario: A plain project reads the same rows as before
    Given an ordinary project with traces
    When its trace list is read through the proof path
    Then the rows match the rows read before the change

  @unit
  Scenario: A proof declared for one resource is refused for another
    Given a proof minted for traces view
    When the client is asked to read a resource the proof does not cover
    Then the client refuses it as not granted

  # ── D. The aggregate project itself ──────────────────────────────────────

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

  @unit
  Scenario: A rule that names a project in another organisation is refused
    When a rule names a project that belongs to a different organisation
    Then the rule is refused
    And no grant is written

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

  # ── E. The reconciler keeps members current ──────────────────────────────

  @integration
  Scenario: The hidden governance project is never a member
    When ana creates an aggregate project with the rule "all personal projects"
    Then the organisation's hidden governance project is not a member

  @integration
  Scenario: A new personal project joins an all-personal aggregate on creation
    Given an aggregate project with the rule "all personal projects"
    When a new member accepts an invite and their personal project is created
    Then the new personal project is a member of the aggregate

  @integration
  Scenario: A department move updates a by-department aggregate
    Given an aggregate project with the rule "personal projects in department Engineering"
    And a member in Engineering whose personal project is a member
    When that member is moved to department Sales
    Then their personal project is no longer a member

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

  # ── F. Trace routes carry the proof ──────────────────────────────────────

  @integration
  Scenario: An organisation admin opens the aggregate project
    Given an aggregate project with three members
    When ana opens its trace list
    Then traces from all three members are listed as first-class rows

  @integration
  Scenario: A member trace opens in detail under the aggregate
    Given an aggregate project with a member holding one trace
    When ana opens that trace from the aggregate's list
    Then the detail page shows the trace's spans
    And the owning project is shown as the member, not the aggregate
    And the detail read uses the proof, not the shown project id, to pick its tenants

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

  @unit
  Scenario: A trace route without a proof fails the build
    When a trace route reaches a trace service without minting a proof
    Then the lint gate fails
    # Twenty call sites in the trace router today pass the project id by
    # hand. After this block none do, and the gate keeps it so.

  # ── G. Privacy and audit ─────────────────────────────────────────────────

  @integration
  Scenario: The strictest member privacy policy applies
    Given an aggregate project with one member on a loose privacy policy
    And another member on a strict privacy policy
    When ana reads the aggregate's trace list
    Then the strict policy's redaction applies to every row

  @integration
  Scenario: Any read of the aggregate writes the admin view audit row
    Given an aggregate project with one member holding one trace
    When ana opens the aggregate's trace list and then that trace within five minutes
    Then one audit row of kind aggregate exists for ana and that project
    And no row names the trace or the member

  @integration
  Scenario: The audit row repeats after the five-minute window
    Given an aggregate project
    When ana opens its trace list twice within five minutes
    Then one audit row of kind aggregate exists for ana and that project
    And a list read ten minutes later writes a second row

  @integration
  Scenario: Audit rows for personal and team workspace views are unchanged
    Given ana opens sam's personal workspace
    Then one audit row of kind personal exists, as before
    And no row of kind aggregate exists
