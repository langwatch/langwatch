Feature: Every query door takes the same parameters and says what it ran with

  As a coding agent, a dashboard card or a person calling the LangWatchQL query door
  I want sources and projects to be parameters of the run, and every input the run used in the answer
  So that I can see which traces and projects a result counted, without a filter I cannot see

  Issue: langwatch/tasks#1025, langwatch/tasks#1028.

  # Where: the doors are tRPC `analytics.lwql.query` (card runs), REST `POST /api/v1/query`, the MCP
  # `run_query` tool and the CLI `langwatch query run`. They share one resolution step in Analytics.
  # What: a run's parameters are the period and grain (dashboard_context_*), `sources` and
  # `projects`. The answer returns them as `params`.
  # What is not a parameter: the row policy, the share windows and the redaction of captured
  # content come from the credential and its grants, never from the request.
  # Decided by the owner (2026-10-29): no hidden filter, so QP05 and QP06 stand ("why have a hidden
  # filter?"). QP03b: a key for an organization, a team or a person reads every project it can
  # read, echoed in params.projects. An organization key has no current project, and a 422 would
  # break existing scripts.
  # Evidence: the repo marks proof with `# Evidence:` lines under a scenario (dashboards-v2.feature);
  # each scenario here ends with one.

  Rule: The same defaults at every door

    @unit @integration
    Scenario: QP01 A run that names no sources is bound to application
      When a run at any door names no sources
      Then {dashboard_context_sources:Array(String)} is bound to ["application"]
      And params.sources is ["application"]
      # Evidence: the four answers (tRPC, REST, MCP, CLI) quoted for one statement

    @unit @integration
    Scenario: QP02 A card run reads the board's project
      Given a board open in project "A"
      When a widget storing no projects runs through analytics.lwql.query
      Then {dashboard_context_projects:Array(String)} is bound to ["A"] and params.projects is ["A"]
      # Evidence: the tRPC answer quoted, and a haven browser screenshot of the card

    @unit @integration
    Scenario: QP03 A project key reads its own project by default
      Given a project API key for project "A"
      When it runs a statement with no projects at REST, MCP or the CLI
      Then params.projects is ["A"]
      # Evidence: three answers quoted

    @unit @integration
    Scenario: QP03b An organization, team or personal key reads every project it can read, and params lists them
      Given an organization key that reads projects "A" and "B" and not "C"
      When it runs a statement with no projects
      Then it reads "A" and "B" and params.projects is ["A", "B"], in the order of the project ids sorted ascending
      # Evidence: the REST answer quoted for an organization key and for a personal key

    @unit @integration
    Scenario: QP03c A key for a group project reads the group's members by default
      Given a key for group project "G" sharing "A" from the beginning and "B" from a date
      When it runs a statement with no projects through REST
      Then it reads "A" and "B", "B" from its date only, and params.projects is ["A", "B"]
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
      And params.sources is ["application", "langy"] and params.followsSources is true
      # Evidence: the REST answer quoted with seeded traces of each origin

    @unit @integration
    Scenario: QP05 A statement that does not read the parameter counts every origin, and params says so
      Given a statement that does not contain {dashboard_context_sources:Array(String)}
      When it runs with sources ["application"]
      Then it returns the rows of every origin
      And params.sources is ["application"] and params.followsSources is false
      # Evidence: the REST answer quoted with seeded traces of each origin

    @unit
    Scenario: QP05b followsSources comes from the parsed statement, not from its text
      Given a statement that names {dashboard_context_sources:Array(String)} only in a comment or in a string literal
      When it runs
      Then params.followsSources is false
      And a statement that reads the placeholder in an expression, in any clause or CTE, answers true
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
      Then it returns no row, and params.sources is []
      # Evidence: the REST answer quoted

    @unit @integration
    Scenario: QP07b The Source column keeps the meaning of other and of the unstamped origin, and params keeps the request's order
      Given traces whose origin is missing, empty, NULL, unlisted, or each listed one
      When a statement filtering Source with the parameter runs with ["application"], ["other"] and each listed origin
      Then missing, empty and NULL count under "application" and an unlisted origin under "other" only
      And params.sources is the list sent, in the order sent, a repeated source kept at its first place
      # Evidence: three REST answers quoted with their row counts over seeded traces

    @unit @integration
    Scenario: QP08 An unknown source is refused at every door
      When a run names a source outside the nine, over tRPC, REST, MCP or the CLI
      Then it is refused with the code "validation_error" and a message that lists the nine sources
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
      Then the three bodies carry the code "project_not_found" and the message "Project not found"
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
    Scenario: QP11 params.projects is always a subset of the readable set
      Given a widget saved when its owner read "A" and "C", and read access to "C" revoked since
      When the card, the dashboard API's widget run, an alert owner's run and the insight gate's run each execute it
      Then each is refused with the code "project_not_found" while "C" is named, and none returns params.projects holding "C"
      And a run naming ["A"] returns params.projects ["A"]
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
      Then params.projects is ["B", "A"] and each project is read once
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
      When a statement compares TenantId with "C"
      Then it returns no row of "C", by the row policy
      # Evidence: the REST answer quoted

    @unit @integration
    Scenario: QP15 A caller cannot supply a reserved parameter in its own parameters
      When a run's parameters name dashboard_context_sources or dashboard_context_projects
      Then it is refused with the code "reserved_parameter_supplied" and the message names the typed field `sources` or `projects`
      # Evidence: the four refusals quoted

    @unit @integration
    Scenario: QP15b SQL that assigns or aliases a reserved name is refused at every door
      When a statement has "SET param_dashboard_context_projects = 'C'", "WITH 'C' AS dashboard_context_projects", or a CTE named dashboard_context_sources
      Then it is refused with the code "reserved_parameter_supplied" at tRPC, REST, MCP and the CLI
      And a statement that declares {dashboard_context_projects:Array(String)} and reads it is accepted
      # Evidence: the four refusals quoted for each of the three shapes

    @unit
    Scenario: QP16 A statement declaring a reserved parameter with another type is refused
      When a statement declares {dashboard_context_projects:String}
      Then it is refused with the code "reserved_parameter_type" and the message names "Array(String)"
      # Evidence: the REST answer quoted

  Rule: params names every input the run depended on, and no other key

    @unit
    Scenario: QP17 The params object holds exactly these keys
      When a run succeeds
      Then params holds sources, followsSources, projects, parameters, and, when the statement follows the period, period and granularitySeconds
      And it holds coarsenedFromSeconds only when the grain was coarsened
      And it holds no other key, in a snapshot test of the schema
      # Evidence: the schema snapshot and one answer quoted

    @unit @integration
    Scenario: QP17b A coarsened grain is reported
      Given a card run with onBudgetOverflow "coarsen" over a period whose 1-second buckets exceed the ceiling
      When the run succeeds
      Then params.granularitySeconds is the step it ran at and params.coarsenedFromSeconds is the step asked for
      And a run that was not coarsened carries no coarsenedFromSeconds
      # Evidence: the tRPC answer quoted for a 30-day period at one-second grain

    @unit @integration
    Scenario: QP18 tRPC, REST and MCP return equal params for the same run
      Given the same statement, sources and projects sent to analytics.lwql.query, POST /api/v1/query and run_query
      Then each success answer carries a `params` object and the three are equal
      # Evidence: the three answers diffed

    @unit @integration
    Scenario: QP19 The CLI sends the parameters and prints the params
      When `langwatch query run --sources application,langy --projects A,B` succeeds
      Then the request carries sources and projects
      And the JSON the command prints holds `params` beside the rows
      # Evidence: the command's output quoted

    @unit @integration
    Scenario: QP20 The MCP tool takes the parameters and shows params to the agent
      When run_query is called with sources and projects
      Then the tool result holds `params`
      # Evidence: the tool result quoted

    @integration
    Scenario: QP21 The insight gate's run equals the card run
      Given a widget query run by its card and by the insight gate for the same board, period and project
      Then the two return the same rows and the same params
      # Evidence: the insight run's stored result and the card's tRPC answer for the same query, quoted and diffed

  Rule: A client or a release that does not know the new fields keeps working or refuses visibly

    @unit @integration
    Scenario: QP22 A request from SDK 2.0.0 runs with the same rows
      Given a request body holding `query`, `parameters` and `projectId`, as SDK 2.0.0 sends it
      When it runs
      Then the rows, columns and statistics equal those the same body returned on the release before this one
      And `projectId` still narrows the run to that project
      # Evidence: both answers diffed

    @integration
    Scenario: QP22b The published CLI 2.0.0 and MCP 2.2.0 run against this server and ignore params
      Given the published langwatch@2.0.0 CLI and the published MCP 2.2.0 installed from npm
      When each runs a query against this server
      Then each succeeds, prints its rows as before and shows no `params`
      # Evidence: both commands' output quoted, with the installed versions

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
