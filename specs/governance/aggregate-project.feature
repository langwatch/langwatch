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
    Then none of their query text filters on the tenant column
    And a repository that filters on it fails the lint gate
    # Naming the column as a projected value or a dedup tuple member is
    # fine; only a predicate picks tenants, and only the client writes one.

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
  Scenario: A member who is not an admin is refused when creating an aggregate project
    When sam asks to create a project of kind aggregate on a team sam belongs to
    Then the request is refused as forbidden, saying only organization admins can open an aggregate project
    And no project is written

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
  Scenario: An admin creates an aggregate from the new project drawer by picking projects
    When ana opens "Create New Project" and checks "Governance"
    Then she sees the organisation's projects in two sections, "Personal projects" and "LLMOps projects"
    When she picks two projects and creates the project
    Then the new project is an aggregate whose explicit rule names exactly those two projects

  @integration
  Scenario: The admin sees every member's personal workspace under Personal projects
    Given two members who each have a personal workspace
    When ana lists the projects she may pick for an aggregate
    Then both personal workspaces are listed as personal, each naming the member who owns it
    And a project on a shared team is listed as not personal
    And a member who is not an admin is refused the list

  @integration
  Scenario: The project picker leaves out aggregates and the governance project
    Given an aggregate project and the hidden governance project
    When ana lists the projects she may pick for an aggregate
    Then neither of them is listed

  @integration
  Scenario: Create stays disabled until a project is picked
    When ana checks "Governance" and has picked no project
    Then the "Create" button is disabled
    When she picks one project
    Then the "Create" button is enabled

  @integration
  Scenario: A member who is not an admin sees no Governance checkbox
    When sam opens "Create New Project"
    Then there is no "Governance" checkbox

  @integration
  Scenario: Without Governance the drawer creates an ordinary project
    When ana creates a project from "Create New Project" without checking "Governance"
    Then the request names no project kind and no rule, as before

  @integration
  Scenario: A project list that fails to load never shows the server's own words
    Given listing the projects ana may pick fails for a reason we cannot name
    When ana checks "Governance"
    Then she reads that the projects could not be listed and to try again
    And she can copy the error ID
    And the server's own message, which names the request it made, is not shown

  @integration
  Scenario: A project list refused to a non-admin says who can pick projects
    Given listing the projects sam may pick is refused because sam is not an organisation admin
    When the picker shows the refusal
    Then sam reads that only organisation admins can do this

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
    Then the navigation shows Traces
    And Analytics, Prompts, Experiments and Online Evaluations are absent
    # Analytics leaves the navigation until analytics across members ships.
    And Quick Search offers the same pages as the navigation and no action that creates data
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
    And each row names the member project that owns it

  @integration
  Scenario: A member trace opens in detail under the aggregate
    Given an aggregate project with a member holding one trace
    When ana opens that trace from the aggregate's list
    Then the detail page shows the trace's spans
    And the owning project is shown as the member, not the aggregate
    And the detail read uses the proof, not the shown project id, to pick its tenants

  @integration
  Scenario: A trace id held by two members opens the member it was listed under
    Given an aggregate project whose two members each hold a trace with the same id
    When ana opens that trace from the first member's row
    Then the header, the spans and the evaluations all come from the first member
    And opening it with no member named picks the same member on every read
    # One trace can cross project lines, so the id alone does not say whose
    # half it is. The proof is narrowed to one of its own tenants; a tenant
    # outside the proof is refused rather than read.

  @integration
  Scenario: Two members with the same trace id each list their own events
    Given an aggregate project whose two members each hold a trace with the same id
    And each member's trace recorded a different event
    When ana reads the aggregate's trace list with the Events column shown
    Then each member's row shows only the events its own trace recorded

  @integration
  Scenario: Paging an aggregate list hands out each member's row of a shared trace id exactly once
    Given an aggregate project whose two members each hold a trace with the same id
    And both traces were recorded at the same moment
    When ana pages through the aggregate's trace list one row at a time
    Then each member's row of that trace appears on exactly one page
    And no row is skipped or repeated across the pages

  @integration
  Scenario: A member span opens in the playground under the aggregate
    Given an aggregate project with a member holding a trace with an LLM span
    When ana opens that span in the prompt playground from the aggregate's trace drawer
    Then the playground loads the span's messages and model from the member
    And a link naming a member the aggregate does not read is answered as not found

  @integration
  Scenario: A playground link on a plain project opens as before
    Given a plain project holding a trace with an LLM span
    When ana opens that span in the prompt playground, with or without the link naming its trace
    Then the playground loads the span's messages and model either way

  # Unimplemented: analytics read through raw clients and the rollup windows
  # on BucketStart, a time column the fence does not admit yet; the fifth
  # time column awaits a decision (ADR-144 open questions).
  @integration @unimplemented
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
    And an evaluation of another member's trace with the same id is not shown

  @unit
  Scenario: A trace route without a proof fails the build
    When a trace route reaches a trace service without minting a proof
    Then the lint gate fails
    # Twenty call sites in the trace router today pass the project id by
    # hand. After this block none do, and the gate keeps it so. A route left
    # behind the baseline is listed by name with its owner and reason.

  @integration
  Scenario: Neither an aggregate nor the governance project is ever the project the app lands on
    Given ana belongs to an aggregate project and an ordinary project
    And her organisation has its internal governance project
    When the app picks a project for ana because none was chosen
    Then it picks the ordinary project
    # An admin opens the aggregate on purpose, from the project switcher.
    # The governance project is never shown to anyone, so it is never landed
    # on either, even when it is the oldest project on her team.

  # ── G. Privacy and audit ─────────────────────────────────────────────────

  @integration
  Scenario: The strictest member privacy policy applies
    Given an aggregate project with one member on a loose privacy policy
    And another member on a strict privacy policy
    When ana reads the aggregate's trace list
    Then the strict policy's redaction applies to every row

  @integration
  Scenario: A member trace whose content was dropped says so under the aggregate
    Given an aggregate project with a member whose privacy policy drops input and output
    And that member holds a trace recorded under that policy
    When ana opens that trace from the aggregate
    Then the trace header says its input and output were dropped, as it does on the member
    # The dropped notice reads the policy of the member the trace belongs to,
    # the same project its redaction follows, never the aggregate's own.

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

  @integration
  Scenario: Every write under the aggregate's tenant is refused on the server
    Given an aggregate project and one of its members
    When ana creates an experiment, a dataset, an annotation or a prompt on the aggregate, or edits one of its traces
    Then each is refused as read only and nothing is written
    And the same calls on the member are not refused
    And ana can still edit the aggregate's rule, rename it and archive it

  @unit
  Scenario: Langy refuses to start on an aggregate with the read-only refusal
    Given an aggregate project, which has no Langy model and accepts no key
    When ana starts a Langy turn on it, from the panel, the API or a connected folder
    Then it is refused as read only, titled "Data can't be added to this project"
    And the refusal card offers no "Try again", since the same turn is refused the same way
    And no conversation is written, no model is resolved and no key is minted
    And opening the Langy panel on it starts no worker and writes nothing

  @integration
  Scenario: Opening an aggregate page never writes a default row under it
    Given an aggregate project and one of its members
    When ana opens the aggregate's reports and its trace list for the first time
    Then she sees no dashboard and no saved views, and no error
    And no dashboard or saved view row exists under the aggregate
    And opening the member the same way still creates its first dashboard and default views

  @unit
  Scenario: A read that seeds defaults must be told whether the project takes writes
    Given the services that seed a first dashboard or default views on read
    When a caller reads without saying whether the project takes writes
    Then the call does not compile, so no default is ever seeded by omission
    And a project that takes no writes gets what exists and nothing is seeded

  @integration
  Scenario: Saving, renaming, reordering or deleting a view is refused on the aggregate
    Given an aggregate project and one of its members
    When ana saves a view of the aggregate's trace list, or renames, reorders or deletes one
    Then each is refused as read only and no saved view row is written
    And saving a view on the member still writes one

  @integration
  Scenario: The aggregate's trace list offers no control to save a view
    Given an aggregate project
    When ana opens its trace list
    Then it offers no button to create a lens and no "Save current filtered view"
    And a lens tab's menu offers no save as new lens, rename, duplicate or delete
    And a lens with unsaved changes offers to discard them but not to save them as a new lens
    And the Ask AI tips never suggest saving the result as a lens, while an ordinary project's still do

  @integration
  Scenario: No path creates a lens on the aggregate
    Given an aggregate project
    When an AI search, or any other part of the trace list, asks to create a lens
    Then no lens is added to the strip and nothing is sent to save one
    And on an ordinary project the same request still creates the lens and saves it

  @integration
  Scenario: An AI search asking for a lens on the aggregate is told it is read only
    Given an aggregate project
    When ana asks the AI search for something it answers with a new lens
    Then the search still applies its query to the trace list
    And no lens is created and the search stays open
    And it shows the read-only refusal, titled "Data can't be added to this project"
    And on an ordinary project the same answer creates the lens and closes the search

  @integration
  Scenario: A lens the server refuses to save says so and leaves no phantom
    Given any project whose server refuses to save, rename or delete a lens
    When ana makes that change in the trace list
    Then she sees an error toast explaining the refusal
    And its title is the registered one for a known cause, such as "Data can't be added to this project", or one naming the lens change otherwise
    And the lens strip reloads from the server, so no unsaved lens lingers
    And a refused new lens leaves the strip even when the project has no saved lens yet
    And she is back on the lens she was on before, not sent to "All traces"

  # ── H. The aggregate in the app ──────────────────────────────────────────
  # The server refuses every write; these keep the app from inviting one, and
  # from waiting on ingestion an aggregate never receives.

  @integration
  Scenario: Aggregate Trace Explorer shows member rows without onboarding
    Given an aggregate project whose members hold traces
    And no trace was ever sent to the aggregate itself
    When ana opens the aggregate's Trace Explorer
    Then the aggregate counts as a project with traces
    And no "instrument your agents" onboarding is shown
    And the page never polls for the aggregate's first trace

  @integration
  Scenario: Aggregate onboarding mints no credential
    When ana asks for an access token bound to the aggregate project
    Then she is refused because the aggregate accepts no credential
    And no key bound to the aggregate exists
    And the aggregate's setup page and onboarding say "Data can't be added to this project"
    And they show no key, no wait for a first trace and no button to mint one

  @integration
  Scenario: Landing never resolves to an aggregate from a remembered selection
    Given ana opened the aggregate project earlier in the same browser
    When she opens the app root, now or after signing in again
    Then the app lands on her first project that is not an aggregate
    And opening the aggregate by its address or from the switcher still opens it
    And opening the aggregate never makes it the remembered selection

  @unit
  Scenario: A refused annotation on the aggregate says why
    When ana's annotation on an aggregate trace is refused as read only
    Then the message she sees is "Data can't be added to this project"
    And not a generic "Could not save annotation"

  @unit
  Scenario: Each aggregate row names its member project
    Given an aggregate project listing rows from two members
    When ana reads its trace list
    Then a Project column names each row's member project
    And the trace drawer names the member project of the open trace
    And a member whose name ana's project list lacks is shown by its id
    And a plain project's trace list has no Project column

  @integration
  Scenario: The app marks the aggregate and offers no way to add data to it
    When ana opens the project switcher
    Then the aggregate shows a stacked avatar named "Aggregate project", in the list and on the current project
    And a plain project shows a single avatar
    When ana opens the aggregate project
    Then no control offers to comment, suggest an edit, edit a trace, automate or add a dashboard
    And its analytics overview offers no card to build a dashboard
    And its datasets, automations and prompts pages say "Data can't be added to this project" instead of offering to create one
    And its prompt playground shows that notice in place of the chat and sends no message
    And a prompt playground tab carried over to it offers neither Save nor Deploy
    And managing the aggregate itself stays available

  @integration
  Scenario: A direct link to the aggregate's analytics says it is not available yet
    Given an aggregate project
    When ana opens a link to its analytics, LLM metrics, topics, users, online evaluations, reports or custom graph page
    Then the page shows its heading and says "Analytics across member projects is not available yet. Open Trace Explorer to see member traces."
    And it draws no chart and runs no analytics query
    And it shows no saved views bar, so no view can be edited, renamed or deleted from it, and reads no saved views
    And an ordinary project's analytics still show the saved views bar

  @integration
  Scenario: The aggregate's reports offer no chart to add
    Given an aggregate project
    When ana opens a link to its reports or to the chart editor
    Then neither offers "Add chart" nor a Save button
    And the reports title cannot be renamed
    And no empty state invites ana to add a chart

  @integration
  Scenario: A member who cannot add charts still sees the empty reports
    Given an ordinary project with no charts
    And a member who may view analytics but not add charts
    When the member opens the project's reports
    Then the empty state says there are no custom graphs yet
    And it offers no "Add chart" button and no invitation to click one

  @integration
  Scenario: A chart save the server refuses says why
    Given a project whose server refuses a new chart, as an aggregate does
    When ana saves the chart from the chart editor
    Then an error toast shows the server's reason
    And the editor stays open

  @unit
  Scenario: The aggregate's home points at its traces instead of saying no data
    When ana opens the aggregate project's home
    Then its traces overview says "Analytics across member projects is not available yet. Open Trace Explorer to see member traces."
    And it links to the aggregate's Trace Explorer
    And the home shows no "Nothing here yet", no quick starts and no setup steps
