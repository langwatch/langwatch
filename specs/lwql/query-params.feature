Feature: Every query door takes the same parameters and says what it ran with

  As a coding agent, a dashboard card or a person calling the LangWatchQL query door
  I want sources and projects to be parameters of the run, and every input the run used in the answer
  So that I can see which traces and projects a result counted, without a filter I cannot see

  Issue: langwatch/tasks#1025, langwatch/tasks#1028.

  # Where: the doors are tRPC `analytics.lwql.query` (card runs), REST `POST /api/v1/query`, the MCP
  # `run_query` tool and the CLI `langwatch query run`. They share one resolution step in Analytics.
  # What: a run's parameters are the period and grain (dashboard_context_*), `sources` and
  # `projects`. The answer returns them as `params`, one flat map of every placeholder the
  # statement declares by its SQL name, plus `period` (owner, 2026-10-29: "yes"). What a run
  # ignored or coarsened comes back as the diagnostics SOURCES_IGNORED and GRANULARITY_COARSENED
  # (owner, 2026-10-29: "ok"), not as params keys.
  # What is not a parameter: the row policy, the share windows and the redaction of captured
  # content come from the credential and its grants, never from the request.
  # Decided by the owner (2026-10-29): no hidden filter, so QP05 and QP06 stand ("why have a hidden
  # filter?"). QP03b, decided later the same day: "That's an API thing on the query. we can require
  # project(s) to be specified when creating a query, that seems fine". A key for an organization,
  # a team or a person must name `projects` at REST, MCP and the CLI, or the run is refused with a
  # 422 that names the field and no project id. A project key keeps its own project. Cards and
  # widgets keep the board's project. This breaks existing organization-key scripts.
  # Evidence: the repo marks proof with `# Evidence:` lines under a scenario (dashboards-v2.feature);
  # each scenario here ends with one.

  Rule: The same defaults at every door

    @unit @integration
    Scenario: QP01 A run that names no sources is bound to application
      When a run at any door, naming its projects where the key is not a project key, names no sources
      Then {dashboard_context_sources:Array(String)} is bound to ["application"]
      And params.dashboard_context_sources is ["application"] where the statement reads it
      # Evidence: the four answers (tRPC, REST, MCP, CLI) quoted for one statement

    @unit @integration
    Scenario: QP02 A card run reads the board's project
      Given a board open in project "A"
      When a widget storing no projects runs through analytics.lwql.query
      Then {dashboard_context_projects:Array(String)} is bound to ["A"] and params.dashboard_context_projects is ["A"] where the statement reads it
      # Evidence: the tRPC answer quoted, and a haven browser screenshot of the card

    @unit @integration
    Scenario: QP03 A project key reads its own project by default
      # Changed in phase 2 (owner: "default to the current project"): any key whose scope is exactly one
      # project reads that project by default, an organization key restricted to one project included.
      Given a project API key for project "A", or a key of any kind that can read project "A" alone
      When it runs a statement with no projects at REST, MCP or the CLI
      Then params.dashboard_context_projects is ["A"] where the statement reads it
      # Evidence: three answers quoted

    @unit @integration
    Scenario: QP03b An organization, team or personal key that names no project is refused with a 422 naming the field
      Given an organization key that reads projects "A" and "B"
      When it runs a statement with no `projects` and no `projectId`, at REST, MCP or the CLI
      Then it is refused with the status 422 and the code "projects_required"
      # Changed in phase 2 (owner: "1 sure"): the message and the tip name "all" as the way out.
      And the message is "Name the projects to query: send `projects`, a list of project ids, or "all""
      And the body holds no project id, and no statement reaches the store
      And the same key naming ["A"] reads "A", and params.dashboard_context_projects is ["A"]
      # Evidence: a real curl answer for an organization key without projects, and one with ["A"]

    @unit @integration
    Scenario: QP03f projects accepts the word all for every project the caller can read
      # Owner (2026-10-29), on the proposal that a key naming no project may send "all": "1 sure".
      Given an organization key that holds analytics:view on projects "B" and "A", and not on "C" of the same organization
      When it runs a statement with `projects` set to the string "all", at REST, tRPC, the CLI as `--projects all` or MCP
      Then the statement runs over "A" and "B" only
      And params.dashboard_context_projects is ["A","B"], the tenant set the statement ran over, in id order
      And "all" inside a list is a project id like any other, and `projectId` with "all" is refused as both named

    @unit @integration
    Scenario: QP03g The word all never reaches a project the caller cannot read, or another organization
      Given a project "C" of the key's organization without analytics:view for it, and a project "X" of another organization
      When the key sends `projects` "all"
      Then neither "C" nor "X" is read, named in the answer or echoed in params

    @unit
    Scenario: QP03h The word all that resolves to no project, or to more than the cap, is refused
      # Decided: none is the 404 "project_not_found" with no id (as a name the caller cannot read);
      # more than the cap is a 422 "validation_error" asking the caller to name the projects.
      When "all" resolves to no project the caller can read
      Then it is refused with the status 404 and the code "project_not_found", with no id
      When "all" resolves to more than the cap: 10,000 for a key, LWQL_MAX_MEMBER_PROJECTS (100) for a member
      Then it is refused with the status 422 and no statement reaches the store

    @unit
    Scenario: QP03j A key that reads no project is told so, not asked to name one
      # Own call (batch 8): a bare not found does not help; the 422 "projects_required" says why.
      Given an organization, team or personal key that holds analytics:view on no project
      When it runs a statement that names no project
      Then it is refused with the status 422 and the code "projects_required"
      And the message says the key reads no project and that an admin can grant one

    @unit
    Scenario: QP03i A widget write refuses the word all
      # Own call: widgets do not store "all" in this change; stored definitions stay explicit.
      When a widget query is saved with `projects` "all", over REST, tRPC, the CLI or MCP
      Then it is refused naming the field, with the message that "all" is not stored in a widget

    @unit @integration
    Scenario: QP03e The CLI and the MCP tool tell the user to pass the projects
      When `langwatch query run` is run with an organization key and no `--projects`, and run_query is called with no `projects`
      Then the CLI prints "Name the projects to query: pass --projects <id,id>, or --projects all" and exits non-zero
      And the MCP tool result is an error reading "Name the projects to query: pass `projects`, a list of project ids, or "all""
      And neither message holds a project id
      # Evidence: the CLI output and the MCP tool result, quoted

    @unit @integration
    Scenario: QP03c A key for a group project reads the group's members by default
      Given a key for group project "G" sharing "A" from the beginning and "B" from a date
      When it runs a statement with no projects through REST
      Then it reads "A" and "B", "B" from its date only, and params.dashboard_context_projects is ["A", "B"]
      # Evidence: the REST answer quoted, with the rows either side of the date

    @unit @integration
    Scenario: QP03d A project key naming another project is refused
      Given a project API key for project "A"
      When it runs with projects ["B"], "B" being a project of its own organization
      Then it is refused with the code "project_not_found" and the status 404
      # Evidence: the REST answer quoted

  Rule: Origins are scoped only where the SQL reads the sources parameter

    @unit @integration
    Scenario: QP04 A statement reading the sources parameter counts the origins it is bound to
      Given a statement with "WHERE Origin IN {dashboard_context_sources:Array(String)}"
      When it runs with sources ["application", "langy"]
      Then it returns the rows of those origins only
      And params.dashboard_context_sources is ["application", "langy"] and no SOURCES_IGNORED diagnostic is returned
      # Evidence: the REST answer quoted with seeded traces of each origin

    @unit @integration
    Scenario: QP05 A statement that does not read the parameter counts every origin, and a diagnostic says so
      Given a statement that does not contain {dashboard_context_sources:Array(String)}
      When it runs with sources ["application"]
      Then it returns the rows of every origin
      And params has no dashboard_context_sources key
      And diagnostics holds SOURCES_IGNORED with the message "This query doesn't read {dashboard_context_sources}, so it counts every origin."
      # Evidence: the REST answer quoted with seeded traces of each origin

    @unit
    Scenario: QP05b SOURCES_IGNORED comes from the parsed statement, not from its text
      Given a statement that names {dashboard_context_sources:Array(String)} only in a comment or in a string literal
      When it runs
      Then diagnostics holds SOURCES_IGNORED
      And a statement that reads the placeholder in an expression, in any clause or CTE, returns no SOURCES_IGNORED
      # Evidence: three REST answers quoted

    @unit @integration
    Scenario: QP06 The server adds no origin filter beneath the statement
      Given a statement that does not read the parameter, run with sources ["application"]
      When the statement reaches ClickHouse
      Then its text is the statement as written, with no view wrapped in an Origin predicate
      # Evidence: the ClickHouse query log row for the run, quoted

    @unit @integration
    Scenario: QP07 An empty list of sources binds an empty array and counts nothing where the SQL reads it
      Given a statement reading {dashboard_context_sources:Array(String)}
      When it runs with sources []
      Then it returns no row, and params.dashboard_context_sources is []
      # Evidence: the REST answer quoted

    @unit @integration
    Scenario: QP07b The Source column keeps the meaning of other and of the unstamped origin, and params keeps the request's order
      Given traces whose origin is missing, empty, NULL, unlisted, or each listed one
      When a statement filtering Source with the parameter runs with ["application"], ["other"] and each listed origin
      Then missing, empty and NULL count under "application" and an unlisted origin under "other" only
      And params.dashboard_context_sources is the list sent, in the order sent, a repeated source kept at its first place
      # Evidence: three REST answers quoted with their row counts over seeded traces

    @unit @integration
    Scenario: QP08 An unknown source is refused at every door
      When a run names a source outside the eleven, over tRPC, REST, MCP or the CLI
      Then it is refused with the code "validation_error" and a message that lists the eleven sources
      # Evidence: the four refusals quoted

  Rule: A project the credential cannot read is refused whole, and the refusal names nothing

    @unit @integration
    Scenario: QP09 One unreadable project in the list refuses the run
      Given an API key that reads "A" and not "C"
      When it runs with projects ["A", "C"]
      Then it is refused with the code "project_not_found" and the status 404
      And no statement reaches the store and no row of "A" is returned
      # Evidence: the REST answer quoted, and the ClickHouse query log showing no statement for the run

    @unit @integration
    Scenario: QP09b The refusal for an unreadable project is byte-identical to the one for a missing project
      Given an API key that reads "A", a project "C" it cannot read and an id "Z" that does not exist
      When it runs with ["A", "C"] and with ["A", "Z"]
      Then the two response bodies, and all headers except Date and the request id, are equal byte for byte
      And neither body contains "C" or "Z", in its message or in its meta
      # Why: today NotFoundError adds the id to message and meta (packages/handled-error/src/handled-error.ts:318),
      # and langwatch-ql-query-scope.service.ts:162 passes it; both are changed here
      # Evidence: two real curl answers saved and diffed

    @unit @integration
    Scenario: QP09c Every door gives the same refusal body for the same missing project
      When tRPC, REST and MCP refuse the same unreadable project
      # Changed in phase 2: the tRPC wire message is the error's code for every handled error
      # (packages/api/src/trpc/policy.ts, #5984), so tRPC carries "project_not_found" as its message.
      Then the three bodies carry the code "project_not_found"
      And REST and MCP carry the message "Project not found", and tRPC carries the code as its message
      # Evidence: the three answers quoted

    @integration
    Scenario: QP10 A hand-made request naming another organization's project is refused
      Given a member of organization "X" and a project "Z" of organization "Y"
      When a hand-made tRPC request to analytics.lwql.query, a REST call and a run_query call name "Z"
      Then each is refused with the code "project_not_found" and the status 404, with the body of QP09b
      # Evidence: three real curl answers

    @unit @integration
    Scenario: QP10b A deleted or archived project is refused like a missing one
      Given a widget storing project "D" that was deleted after it was saved, and another storing archived project "E"
      When each runs
      Then both are refused with the code "project_not_found" and the body of QP09b
      # Evidence: two answers quoted

    @integration
    Scenario: QP11 params.dashboard_context_projects is always a subset of the readable set
      Given a widget saved when its owner read "A" and "C", and read access to "C" revoked since
      When the card, the dashboard API's widget run, an alert owner's run and the insight gate's run each execute it
      Then each is refused with the code "project_not_found" while "C" is named, and none returns params.dashboard_context_projects holding "C"
      And a run naming ["A"] returns params.dashboard_context_projects ["A"]
      # Evidence: the four answers quoted

    @unit @integration
    Scenario: QP11b A group project narrows to its members and keeps their share windows
      Given a group project "G" sharing "A" from the beginning and "B" from a date
      When a run in "G" names projects ["B"]
      Then it reads "B" from its date only
      And naming a project that is not a member of "G" is refused with the code "project_not_found"
      # Evidence: the answers quoted with the rows either side of the date

    @unit @integration
    Scenario: QP12 A list that names one project twice reads it once, and params keeps the first place
      When a run names projects ["B", "A", "B"]
      Then params.dashboard_context_projects is ["B", "A"] and each project is read once
      # Evidence: the REST answer quoted

    @unit
    Scenario: QP12b A list longer than the tenant capability is refused
      When a run names 10,001 projects, one more than LWQL_TENANT_CAPABILITY_MAX_PROJECTS (10,000)
      Then it is refused with the code "validation_error" and the message names 10,000
      And if the request body limit answers 413 first, the 413 body is what the evidence quotes
      # Evidence: the REST answer quoted with the request's size

    @unit @integration
    Scenario: QP12c An empty list of projects is refused
      When a run sends "projects": []
      Then it is refused with the code "validation_error" and the message "projects must hold at least one id"
      # Evidence: the REST answer quoted

    @unit @integration
    Scenario: QP12d A run that names both projectId and projects is refused
      When a run sends `projectId` and `projects` together
      Then it is refused with the code "validation_error" and the message "send projectId or projects, not both"
      # Evidence: the REST answer quoted

    @unit @integration
    Scenario: QP13 The share windows and the redaction hold when projects are named
      Given a group project with a member shared from a date, and a member with costs redacted
      When a run names those members
      Then rows before the date are not read and the redacted columns stay redacted
      And params holds project ids only, never a window, a protection or a key
      # Evidence: the answer quoted

  Rule: A statement cannot assign, alias or widen a reserved parameter

    @unit @integration
    Scenario: QP14 A statement widening its reach with TenantId still reads nothing it may not
      Given an API key that reads "A" and not "C"
      When a statement run with projects ["A"] compares TenantId with "C"
      Then it returns no row of "C", by the row policy
      # The unit test proves the capability sent holds the readable project's key only; the row
      # policy itself is proved by tenant-column-isolation.integration.test.ts (needs a container).
      # Evidence: the REST answer quoted

    @unit @integration
    Scenario: QP15 A caller cannot supply a reserved parameter in its own parameters
      When a run's parameters name dashboard_context_sources or dashboard_context_projects
      Then it is refused with the code "lwql_reserved_parameter_supplied" and the message names the typed field `sources` or `projects`
      # Evidence: the four refusals quoted

    @unit @integration
    Scenario: QP15b SQL that assigns or aliases a reserved name is refused at every door
      When a statement has "SET param_dashboard_context_projects = 'C'", "WITH 'C' AS dashboard_context_projects", or a CTE named dashboard_context_sources
      Then it is refused with the code "lwql_reserved_parameter_supplied" at tRPC, REST, MCP and the CLI
      And a statement that declares {dashboard_context_projects:Array(String)} and reads it is accepted
      # Evidence: the four refusals quoted for each of the three shapes

    @unit
    Scenario: QP16 A statement declaring a reserved parameter with another type is refused
      When a statement declares {dashboard_context_projects:String}
      Then it is refused with the code "lwql_reserved_parameter_type" and the message names "Array(String)"
      # Evidence: the REST answer quoted

  Rule: params names every placeholder the statement declares, by its SQL name

    @unit
    Scenario: QP17 The params map holds the declared placeholders and the period, nothing else
      When a run succeeds
      Then params holds each placeholder the statement declares, by its SQL name, with the value it ran with, defaults included
      And it holds period when the statement follows the period, and no key for a placeholder the statement does not declare
      And it holds no nested parameters key and no short sources, projects or granularitySeconds key
      # Evidence: the schema snapshot and one answer quoted

    @unit @integration
    Scenario: QP17b A coarsened grain is reported as a diagnostic
      Given a card run with onBudgetOverflow "coarsen" over a period whose 1-second buckets exceed the ceiling
      When the run succeeds
      Then params.dashboard_context_granularity_seconds is the step it ran at
      And diagnostics holds GRANULARITY_COARSENED with meta requestedSeconds (the step asked) and granularitySeconds (the step run)
      And a run that was not coarsened carries no GRANULARITY_COARSENED
      # Evidence: the tRPC answer quoted for a 30-day period at one-second grain

    @unit @integration
    Scenario: QP18 tRPC, REST and MCP return equal params for the same run
      Given the same statement, sources and projects sent to analytics.lwql.query, POST /api/v1/query and run_query
      Then each success answer carries a `params` object and the three are equal
      # Evidence: the three answers diffed

    @unit @integration
    Scenario: QP19 The CLI sends the parameters and returns the params in the result
      # Changed (owner, 2026-10-29: "they get the params back as part of the success or final state
      # object in the response so agents can understand"): the earlier text put params on stderr
      # and kept `-o json` to a bare array of rows.
      When `langwatch query run --sources application,langy --projects A,B` succeeds
      Then the request carries sources and projects
      And `-o json` and `--format json` print one object holding rows, params and diagnostics
      And CSV and JSON lines hold the rows only, with `params` as one JSON line on stderr
      And with the table format a line under the table says what the run was bound to
      And a blank --projects or --sources is refused, never read as unset
      # Evidence: the command's output quoted

    @unit @integration
    Scenario: QP20 The MCP tool takes the parameters and shows params to the agent
      When run_query is called with sources and projects
      Then the tool result holds `params`
      # Evidence: the tool result quoted

    @unit
    Scenario: QP21 The insight gate validates a stored statement with the same binder, and refuses what the card refuses
      Given a finding whose statement reads {dashboard_context_sources:Array(String)}, and findings whose statements assign a reserved name or declare it as String
      When the insight gate checks them for the run's person
      Then the first is kept as written
      And the others are dropped, and their findings are filed without a statement
      # The gate only validates; the replay is the card's own run, so rows and params are the card's
      # Evidence: the gate's kept and dropped findings, quoted

  Rule: A run the server limited says so, without naming what it hid

    # Decided by the owner's question (2026-10-29): "is there an easy way for us to send back from
    # the query permission limitations? like 'this is a subset of data based on your permissions?'"
    # Each diagnostic is non-fatal and appears only when it applies to this run. SOURCES_IGNORED
    # applies only when the run names its sources: a run that names none gets no note (coordinator,
    # 2026-10-29).
    # PROJECTS_NOT_READABLE is not a code: a named project the caller cannot read refuses the whole
    # run with the 404 of QP09, so nothing is dropped and nothing is left to report.

    # Changed from the first spec: no FIELDS_REDACTED code exists. A column a protection hides is
    # refused at validation, so no successful run ever read a hidden field to report.
    @unit @integration
    Scenario: QP25 A statement reading a column a data protection hides is refused, with no FIELDS_REDACTED
      Given a project whose data protection hides captured output and a statement that selects Comment from annotations
      When the statement runs
      Then it is refused with the code "lwql_not_permitted" (400) and a GATED_COLUMN violation that names the field
      And the violation names no project and no count of projects
      # Evidence: the REST refusal quoted

    @unit @integration
    Scenario: QP26 SHARE_WINDOW_LIMITED appears when a dated member's rows were cut by its window
      Given a group project sharing "B" from a date and a statement that reads rows older than that date
      When the statement runs
      Then diagnostics holds one SHARE_WINDOW_LIMITED entry whose message reads "Some projects share data only from a date, so earlier rows are not included"
      And its message and meta name no project and count none
      # Evidence: a real REST answer quoted, and a haven browser screenshot of the card's (i) line

    @unit @integration
    Scenario: QP27 A run the server did not limit carries neither diagnostic
      Given a statement over a project with no protection that touches it and no dated member
      When the statement runs
      Then diagnostics holds no SHARE_WINDOW_LIMITED entry
      # Evidence: a real REST answer quoted, and a haven browser screenshot of a card with no (i) line

    @unit @integration
    Scenario: QP28 No limiting diagnostic names or counts a project the caller cannot read
      Given a run limited by a share window
      Then no message, meta or detail of SHARE_WINDOW_LIMITED holds a project id, a project name or a number of projects
      # Evidence: the answer's diagnostics quoted

    @unit @integration
    Scenario: QP29 Every door returns the limiting diagnostics
      Given one limited run sent through analytics.lwql.query, POST /api/v1/query, run_query and the CLI
      Then each answer carries the same diagnostics
      And run_query and the CLI print them under the rows
      # Evidence: the four answers quoted

    @unit @integration
    Scenario: QP30 A named project the caller cannot read is refused whole, with no PROJECTS_NOT_READABLE diagnostic
      When a run names a project the caller cannot read
      Then it is refused with the 404 of QP09 and no diagnostics list exists to carry a dropped project
      # Evidence: the REST answer quoted

  Rule: A client or a release that does not know the new fields keeps working or refuses visibly

    @unit @integration
    Scenario: QP22 A request from SDK 2.0.0 runs with the same rows
      Given a request body holding `query`, `parameters` and `projectId`, as SDK 2.0.0 sends it
      When it runs
      Then the rows, columns and statistics equal those the same body returned on the release before this one
      And `projectId` still narrows the run to that project
      # Evidence: both answers diffed

    @unit
    Scenario: QP22b A reader written before params parses a result that carries them
      # Changed in phase 2 (2026-10-29): the scenario named published packages, which a unit test cannot install.
      # Bound to a reader that knows only the 2.0.0 fields. The published langwatch@2.0.0 CLI was also run once
      # by hand against a stub answering with params and diagnostics: it printed [{"n":3}] and no params.
      # The MCP 2.2.0 package was not run.
      Given a reader that knows only the fields the published clients read
      When it parses a result carrying params and diagnostics
      Then it returns the same rows and ignores params
      # Evidence: the CLI 2.0.0 output quoted

    @integration
    Scenario: QP23 A rollback is not supported for this feature
      When the previous release reads a widget this release saved
      Then it shows multi-project widgets for the board's project only, and the release notes say so
      # Evidence: the release-notes line, as in dashboards-v2.feature AC210d

    @unit
    Scenario: QP24 The OpenAPI document lists the added fields as optional
      When the REST document is generated
      Then the query body lists `sources` and `projects` as optional
      And the success answer lists `params` with the keys of QP17
      # Evidence: the generated document's schema quoted
