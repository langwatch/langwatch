Feature: Every query door takes the same parameters and says what it ran with

  As a coding agent, a dashboard card or a person calling the LangWatchQL query door
  I want sources and projects to be parameters of the run, and the resolved values in the answer
  So that I can see which traces and projects a result counted, without guessing the defaults

  Issue: langwatch/tasks#1025, langwatch/tasks#1028.

  # Where: the doors are tRPC `analytics.lwql.query` (card runs), REST `POST /api/v1/query`, the MCP
  # `run_query` tool and the CLI `langwatch query run`. They share one resolution step in Analytics.
  # What: a run's parameters are the period and grain (dashboard_context_*), `sources` and
  # `projects`. The answer returns them as `params`, defaults filled in.
  # What is not a parameter: the row policy, the share windows and the redaction of captured
  # content come from the credential and its grants, never from the request.

  Rule: A run names its sources and projects, or takes the defaults

    @unit @integration
    Scenario: A run that names neither counts every origin over every project the credential reads
      Given an API key that reads projects "A" and "B"
      When it runs a statement with no sources and no projects
      Then the run counts every origin, as it does today
      And the answer's params.sources lists all nine sources
      And the answer's params.projects is ["A", "B"]

    @unit @integration
    Scenario: A card run is kept to the widget query's sources and to the board's project
      Given a widget query storing no sources and no projects, on a board open in project "A"
      When the card runs through analytics.lwql.query
      Then the run counts application traces over project "A"
      And the answer's params.sources is ["application"] and params.projects is ["A"]

    @unit @integration
    Scenario: A run names its sources and the answer echoes them
      When a run names sources ["application", "langy"] at any door
      Then it counts those origins only
      And the answer's params.sources is ["application", "langy"], in the order the sources are listed

    @unit @integration
    Scenario: A run that names no source counts nothing and says so
      When a run names sources []
      Then it reads no row and the answer's params.sources is []
      And the answer does not fall back to the default list

    @unit @integration
    Scenario: A run names one project or a list, and the answer echoes the ids
      Given an API key that reads projects "A", "B" and "C"
      When a run names projects ["A", "B"], or the single project "A" in `projectId`
      Then it reads those projects only, each redacted by its own protections
      And the answer's params.projects is the list it read

    @unit @integration
    Scenario: A run that names both projectId and projects is refused
      When a run sends `projectId` and `projects` together
      Then it is refused with a validation error that says to send one of them
      And nothing is read

    @unit @integration
    Scenario: A run that names an empty list of projects is refused
      When a run sends "projects": []
      Then it is refused with a validation error, since an empty list would read nothing without saying why
      # A key that reads no project is still a valid empty scope, as before

  Rule: A project the credential cannot read is refused, whole

    @unit @integration
    Scenario: One unreadable project in the list refuses the run
      Given an API key that reads "A" and not "C"
      When it runs with projects ["A", "C"]
      Then the run is refused with project_not_found (404), as for a project that does not exist
      And no row of "A" is returned and no statement reaches the store

    @unit @integration
    Scenario: A project of another organization is refused like a missing one
      When a run names a project that lies in another organization
      Then the answer is the same project_not_found, with the same message as for an id that does not exist

    @integration
    Scenario: The refusal comes from the server whatever the browser offers
      Given a browser whose picker was changed to offer a project the member cannot read
      When a card runs with that project
      Then the server refuses it and the card says it cannot read a project this widget uses

    @unit @integration
    Scenario: A group project narrows to its members and keeps their share windows
      Given a group project "G" sharing "A" from the beginning and "B" from a date
      When a run in "G" names projects ["B"]
      Then it reads "B" from its date only
      And naming a project that is not a member of "G" is refused with project_not_found

  Rule: The parameters reach the statement, and only as the typed values

    @unit @integration
    Scenario: A statement reads the resolved sources and projects
      Given a statement using {dashboard_context_sources:Array(String)} and {dashboard_context_projects:Array(String)}
      When it runs with sources ["application"] and projects ["A"]
      Then the first is bound to ["application"] and the second to ["A"]
      And `WHERE TenantId IN {dashboard_context_projects:Array(String)}` returns project "A" rows only

    @unit @integration
    Scenario: A statement cannot widen its reach with the project parameter
      Given an API key that reads "A" and not "C"
      When a statement compares TenantId with "C", or with a parameter supplied for "C"
      Then it returns no row of "C", by the row policy
      And the parameter is bound to the resolved projects, never to a value from the caller's bag

    @unit
    Scenario: A caller cannot supply a reserved parameter in its own parameters
      When a run's parameters name dashboard_context_sources or dashboard_context_projects
      Then it is refused as a reserved parameter supplied, as the period names are
      And the refusal names the typed field to use: `sources` or `projects`

    @unit
    Scenario: A statement declaring a reserved parameter with another type is refused
      When a statement declares {dashboard_context_projects:String}
      Then the run is refused with the type the parameter takes

    @unit @integration
    Scenario: A statement that never reads the parameters is still kept to them
      Given a run with sources ["application"] and projects ["A"]
      And a statement that reads neither parameter
      Then it counts application traces over project "A" only
      # The server filter is the floor; the parameter is for a statement that needs the value

    @integration
    Scenario: The share windows and the redaction hold when projects are named
      Given a group project with a member shared from a date, and a member with costs redacted
      When a run names those members
      Then rows before the date are not read and the redacted columns stay redacted
      And the params carry the project ids only, never the windows or the protections

  Rule: Every door takes the same parameters and returns them

    @unit @integration
    Scenario: tRPC, REST and MCP return the same params for the same run
      Given the same statement, sources and projects sent to analytics.lwql.query, POST /api/v1/query and run_query
      Then each success answer carries a `params` object
      And the three objects are equal

    @unit
    Scenario: The params object holds every resolved value, defaults filled
      When a run succeeds
      Then `params` holds sources, projects, and, when the statement follows them, the period start and end and the granularity in seconds
      And `params.parameters` holds the caller's own named values, as sent

    @unit @integration
    Scenario: The CLI sends the parameters and prints the params
      When `langwatch query run --sources application,langy --projects A,B` succeeds
      Then the request carries sources and projects
      And the JSON the command prints holds `params` beside the rows

    @unit @integration
    Scenario: The MCP tool takes the parameters and shows the params to the agent
      When run_query is called with sources and projects
      Then the tool result holds `params`, so the agent can state which traces and projects it counted

    @unit @integration
    Scenario: A refused run names the parameters it could not resolve
      When a run is refused for an unknown source, an unreadable project or an empty list
      Then the refusal names the field and what the door takes
      And no result is returned

    @unit @integration
    Scenario: An unknown source is refused at every door
      When a run names a source outside the nine, over tRPC, REST, MCP or the CLI
      Then it is refused with a validation error that names the sources it takes

  Rule: Older clients keep working

    @unit @integration
    Scenario: A request from SDK 2.0.0 runs unchanged
      Given a request body with only `query`, `parameters` and `projectId`, as SDK 2.0.0 sends it
      When it runs
      Then the rows, columns and statistics equal those of the run before this change
      And `projectId` still narrows the run to that project

    @unit
    Scenario: An older client parsing the answer ignores the added field
      Given the response schema SDK 2.0.0 and MCP 2.2.0 parse with
      When the answer carries `params`
      Then they parse it without error and do not show the field

    @unit @integration
    Scenario: A stored widget query without projects or per-widget sources runs as it did
      Given a widget query saved before projects existed
      When it runs from a card or through the dashboard API
      Then it reads its board's project with the sources it stored or the default

    @unit
    Scenario: The OpenAPI document lists the added fields and marks them optional
      When the REST document is generated
      Then the query body lists `sources` and `projects` as optional
      And the success answer lists `params`
