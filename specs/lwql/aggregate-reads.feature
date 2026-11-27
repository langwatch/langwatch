@lwql @governance @authz
Feature: LangWatchQL on an aggregate project reads its members inside their grants

  As an organisation admin on an aggregate project
  I want the Workbench and Dashboards to run over every member project
  So that one chart answers for the whole company, from the members' own rows

  An aggregate owns no rows, so a statement run under its own key reads nothing.
  The route already mints an `analytics:view` proof listing the aggregate and one
  shared grant per member with the date the grant opens (ADR-177 decision 6).
  The aggregate's statement runs under the members' keys, so the row policy bounds
  the tenants, and every view it reads is narrowed to each member's window, so a
  department member's past stays out. The strictest member protections apply,
  limits are charged to the aggregate once, and every run is audited.
  Decisions: ADR-177 v4.14, analytics ADR-003 (every widget is LangWatchQL).

  Background:
    Given an organisation admin named ana
    And an aggregate project whose members are project A and project B
    And another project C in the organisation that is not a member and holds rows

  # ── Who is read ─────────────────────────────────────────────────────────

  @unit
  Scenario: The aggregate's statement runs under its members' keys
    When ana runs a statement on the aggregate
    Then it runs under the keys of project A and project B
    And never under project C's key nor the aggregate's own

  @unit
  Scenario: A plain project still runs under its own key alone
    Given a plain project with no shared grants
    When a member runs a statement on it
    Then it runs under that project's key alone, as before

  @unit
  Scenario: A member whose key cannot be read is refused by name
    Given project B has no LangWatchQL key
    When ana runs a statement on the aggregate
    Then the run is refused naming project B
    And no statement reaches the store

  @unit
  Scenario: A member shared up to a date is refused by name
    Given project B is shared with the aggregate up to a date
    When ana runs a statement on the aggregate
    Then the run is refused naming project B
    And no statement reaches the store

  @unit
  Scenario: The members come from the proof, never from the request
    Given a request that names project C
    When ana runs a statement on the aggregate
    Then project C is not read

  # ── When each member is read from ───────────────────────────────────────

  @unit
  Scenario: Every view the statement reads is narrowed to each member's window
    Given project B is shared from a point in time
    When ana runs a statement reading a view with a time column
    Then each reference to that view keeps only rows of project A, and rows of project B on or after its start

  @unit
  Scenario: A view joined to itself is narrowed on both sides
    When ana runs a statement that reads the same view twice
    Then both references are narrowed to the members' windows

  # tasks#1212: a fanned-out PostgreSQL view keeps one copy of a team- or organization-level
  # row, the lowest in-scope project's. That copy's window alone must not decide the row.
  @unit @integration
  Scenario: A member window on the kept copy does not hide a row a sibling's window admits
    Given two sibling projects of one organization and an organization-level row
    And the project whose copy the view keeps is shared only from after the row was created
    And its sibling is shared for its whole history
    When ana runs a statement reading that row's view over both
    Then the row is read once

  @unit
  Scenario: A member window for a project the caller cannot read is dropped
    Given ana reads projects A and B
    And the member windows also name a project C outside them
    When the statement is scoped
    Then C's window is dropped before any predicate is built from it

  @unit
  Scenario: A read where every project has its own whole-history window is left as written
    Given ana reads projects A and B
    And the member windows name each of them once, shared for its whole history
    When the statement is scoped
    Then the statement is left as written, since the row policy bounds it exactly

  @unit
  Scenario: A project with no member window reads nothing once windows are given
    Given ana reads projects A and B
    And the member windows name only project A, shared for its whole history
    When the statement is scoped
    Then each view it reads keeps rows of project A only

  @unit
  Scenario: A read whose every member window is dropped reads nothing
    Given ana reads projects A and B
    And the member windows name only a project C outside them
    When the statement is scoped
    Then every view it reads admits no row

  # Below that filter: proves the engine table's row policy alone also keeps C's copy out.
  @integration
  Scenario: A member window cannot admit a row through a project the caller cannot read
    Given an organization with an organization-level row and three projects
    And the caller's key set holds only two of them, each shared only from after the row was created
    And the window predicate names the third project as shared for its whole history
    When ana's session reads that row's view through the predicate
    Then the row is not read

  @unit
  Scenario: A view with no time column reads only members shared for their whole history
    Given project B is shared from a point in time
    When ana runs a statement reading a view with no time column
    Then that view keeps rows of project A only

  @unit
  Scenario: FINAL or SAMPLE on a narrowed view is refused with a clear message
    Given project B is shared from a point in time
    When ana runs a statement that reads a view with FINAL or SAMPLE
    Then the run is refused saying FINAL and SAMPLE cannot be used on this read
    And no statement reaches the store

  @unit @integration
  Scenario: A WITH name spelt like a narrowed view is refused
    Given project B is shared from a point in time
    When ana runs a statement whose WITH, in any subquery, is named like a view it reads
    Then the run is refused saying a WITH name cannot repeat a view's name
    And project B's rows from before its start are not read
    And a plain project's statement with the same WITH runs as written

  @unit
  Scenario: App functions read text only from members shared for their whole history
    Given project B is shared from a point in time
    When ana runs a statement on the aggregate that reads trace text through an app function
    Then text is read from project A
    And no text is read from project B, so its values stay unresolved

  @unit
  Scenario: A plain project's statement is left as written
    Given a plain project with no shared grants
    When a member runs a statement on it
    Then the statement reaches the store unchanged

  # ── What is shown ──────────────────────────────────────────────────────

  @unit
  Scenario: The strictest member privacy policy applies
    Given project A lets ana see captured input
    And project B hides captured input
    When ana runs a statement on the aggregate or opens its Workbench schema
    Then captured input is hidden

  # ── Guards ─────────────────────────────────────────────────────────────

  @unit
  Scenario: Limits are charged to the aggregate once
    When ana runs a statement on the aggregate
    Then one query is counted against the aggregate's window
    And none against project A's or project B's

  @unit
  Scenario: Too many members is refused before any read
    Given an aggregate with more members than the LangWatchQL member cap
    When ana runs a statement on it
    Then the run is refused saying the aggregate has too many members to query at once
    And no statement reaches the store

  @unit
  Scenario: Every run on the aggregate is audited
    When ana runs a statement on the aggregate
    Then one admin view audit row of kind aggregate is written for ana
    And a second run within five minutes writes none

  # ── No leak ────────────────────────────────────────────────────────────

  @integration
  Scenario: Nothing outside the members' windows is read
    Given project A holds rows
    And project B holds rows before and after its start
    When ana counts trace rows on the aggregate through LangWatchQL
    Then the count is project A's rows plus project B's rows on or after its start
    And project C's rows and project B's earlier rows are not counted

  @integration
  Scenario: The aggregate counts a member's evaluations by when their trace occurred
    Given project B holds a trace from before its start and one after it
    And both traces were evaluated after its start
    When ana counts evaluations on the aggregate through LangWatchQL
    Then only the evaluation of the trace after its start is counted
    And the per-minute evaluation rollup, which names no trace, reads no member shared from a date
