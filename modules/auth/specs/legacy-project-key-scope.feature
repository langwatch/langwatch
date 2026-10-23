Feature: Legacy project keys are ingestion-only, enforced per project
  A legacy project key is the key stored on the project itself (`Project.apiKey`),
  not an API key. It can send traces, logs, metrics and tracked events, which ask
  `traces:create`. Beyond that it passes the routes that name a scope flag listing
  its project, one flag per usage (`LEGACY_PROJECT_KEY_SCOPE_FLAGS` in the api-key
  contract; a route names its flags with `withLegacyKeyScope`): prompts read, prompts
  write, traces read, annotations read, scenarios, evaluations, experiments and connected
  agents. A flag
  opens routes, not permissions: a route that asks the same permission without naming
  the flag is outside the key's scopes. A project on the `legacy_project_key_full_access`
  flag keeps full access and writes no legacy key log line.

  Outside its scopes, a legacy key is report-only by default: the request is answered as
  before, and the line "legacy project key outside its scopes" is logged with
  `enforced: false`. For a project on `legacy_project_key_scope_enforced` the same request
  is refused with the handled error "legacy_project_key_ingestion_only" at status 403 and
  logged with `enforced: true`. Every answered request beyond ingestion also writes the
  census line "legacy project key request". Both lines go to the logger
  `langwatch:legacy-project-key`, name the route as its method and path template, and are
  written at most once a minute per project, route and permission in a process.
  Operators list the projects of each flag in one `{ projectId: [ids] }` rule.

  Rule: a legacy project key on an unenforced project is answered and logged

    @integration
    Scenario: A legacy key on an unenforced project reaches a prompts route
      Given a project whose legacy key is on no flag
      When it calls a project route that asks "prompts:view" and names no flag listing the project
      Then the route answers 200
      And the line "legacy project key outside its scopes" is logged with enforced false, the project, the permission and the route template
      And a census line is logged with granted by "report_only"

    @integration
    Scenario: An unenforced project's legacy key on no flag still reads and writes annotations
      Given a project whose legacy key is on no flag
      When it calls routes that ask "annotations:view", "annotations:create" and "annotations:manage"
      Then each answers 200
      And each is logged outside its scopes with enforced false

    @integration
    Scenario: An unenforced project's legacy key passes identify-only routes and the key door
      Given a project whose legacy key is on no flag
      When it calls a project route that only identifies the caller, or a key-door route with or without a permission
      Then each answers 200
      And each is logged outside its scopes with enforced false

    @integration
    Scenario: The census line carries the route template and no token
      Given a project whose legacy key is on no flag
      When it calls a project route whose path carries an id and a query
      Then the census line names the route as its method and path template
      And no log line carries the concrete path, the query or the token

    @integration
    Scenario: The hosted MCP admits an unenforced project's legacy key and logs it
      Given a project whose legacy key is on no flag
      When an MCP client opens a session with that key as its bearer
      Then the session is opened
      And the line "legacy project key outside its scopes" is logged with enforced false

    @integration
    Scenario: The health probes run for an unenforced project's legacy key and log it
      Given a project whose legacy key is on no flag
      When it calls a project-keyed health probe other than the collector
      Then the probe runs
      And the line "legacy project key outside its scopes" is logged with enforced false

    @unit
    Scenario: A census line is written once a minute per project, route and permission
      Given a legacy project key on an unenforced project
      When it asks the same permission on the same route twice within a minute
      Then one census line is logged
      And the next line after the minute counts the request it held back

    @unit
    Scenario: A scope grant writes a census line naming its flag
      Given a legacy project key whose project is on "legacy_project_key_prompts_read"
      When the door asks it a permission on a route that names that flag
      Then a census line is logged with granted by "legacy_project_key_prompts_read"
      And no outside-scope line is logged

    @unit
    Scenario: The request's span records the use and its decision
      Given a legacy project key request beyond ingestion
      When it is allowed or refused outside the key's scopes, or granted by a scope flag
      Then the span carries the project, route, permission and the route's scope flags
      And it carries whether the request was enforced, or the flag that granted it
      And a route that asks no permission is recorded with permission "none"

    @unit
    Scenario: Ingestion and full access write no line
      Given a legacy project key
      When the door asks it "traces:create", or asks anything with its project on the full-access flag
      Then no legacy key line is logged
      And the enforced flag is never read

  Rule: a legacy project key still sends data

    @integration
    Scenario: A legacy project key passes a route that asks traces:create
      Given a project whose legacy key is not on the full-access flag
      When it calls a project route that asks "traces:create", as tracked events do
      Then the route answers 200
      And the full-access flag is never read

    @unit
    Scenario: The ingestion permission never reads the full-access flag
      Given a legacy project key
      When the door asks it "traces:create"
      Then it holds the permission
      And the full-access flag is never read

  Rule: an enforced project is refused outside its scopes

    @integration
    Scenario: A legacy project key on an enforced project is refused prompts, traces, evaluations and datasets
      Given a project on the enforced flag whose legacy key is not on the full-access flag
      When it calls project routes that ask "prompts:view", "traces:view", "evaluations:view" or "datasets:view"
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"
      And the refusal names the permission it asked
      And no handler runs
      And the line "legacy project key outside its scopes" is logged with enforced true

    @integration
    Scenario: A legacy project key on an enforced project is refused a route that asks no permission
      Given a project on the enforced flag whose legacy key is not on the full-access flag
      When it calls a project route that only identifies the caller
      Then it answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: A legacy project key on an enforced project is refused on the key door
      Given a project on the enforced flag whose legacy key is not on the full-access flag
      When it calls a key-door route, with or without a permission
      Then it answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The hosted MCP refuses a legacy project key on an enforced project
      Given a project on the enforced flag whose legacy key is not on the full-access flag
      When an MCP client opens a session with that key as its bearer
      Then the MCP endpoint answers 403 with the handled error "legacy_project_key_ingestion_only"
      And no session is opened

    @integration
    Scenario: A legacy project key on an enforced project may run only the collector health probe
      Given a project on the enforced flag whose legacy key is not on the full-access flag
      When it calls the project-keyed health probes
      Then the collector probe runs
      And every other probe answers 403 with the code "legacy_project_key_ingestion_only"

  Rule: a project on the full-access flag keeps full access

    @integration
    Scenario: A legacy project key on the full-access flag keeps full access
      Given a project whose legacy key is on the full-access flag
      When it calls routes that ask "prompts:view", routes that ask no permission and key-door routes
      Then each answers 200

    @integration
    Scenario: The hosted MCP admits a legacy project key on the full-access flag
      Given a project whose legacy key is on the full-access flag
      When an MCP client opens a session with that key as its bearer
      Then the session is opened

    @integration
    Scenario: The health probes run for a legacy project key on the full-access flag
      Given a project whose legacy key is on the full-access flag
      When it calls a project-keyed health probe other than the collector
      Then the probe runs

    @unit
    Scenario: The full-access flag is read for the key's own project
      Given a legacy project key
      When the door asks it a permission beyond ingestion
      Then the flag "legacy_project_key_full_access" is read for the key's project and organization

  Rule: on an enforced project, a scope flag opens only the routes that name it

    @integration
    Scenario: An enforced project on the prompts-read flag reads prompts and nothing else
      Given an enforced project whose legacy key is on "legacy_project_key_prompts_read" only
      When it calls a route that names that flag
      Then the route answers 200
      When it calls a route that names "legacy_project_key_traces_read" or "legacy_project_key_prompts_write"
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: A project on two scope flags holds both
      Given an enforced project whose legacy key is on "legacy_project_key_prompts_read" and "legacy_project_key_traces_read"
      When it calls routes that name each flag
      Then each answers 200
      And a route that names "legacy_project_key_evaluations" answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The annotations-read flag opens annotation reads and no annotation writes
      Given an enforced project whose legacy key is on "legacy_project_key_annotations_read" only
      When it calls a route that asks "annotations:view" and names that flag, as the annotation list, get and trace list do
      Then the route answers 200
      When it calls a route that asks "annotations:create" or "annotations:manage", as annotation create, update and delete do
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The connected-agents flag opens the connect routes and the model providers read only
      Given an enforced project whose legacy key is on "legacy_project_key_connected_agents" only
      When it calls a route that asks "scenarios:manage" and names that flag, as connected-agent register, poll and frames do
      And a route that asks "project:view" and names that flag, as the model providers read does
      Then each answers 200
      When it calls a route that asks "scenarios:manage" without naming the flag, as test suite archive does
      Or a route that asks "project:view" without naming it, as the agents list does
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The connect socket's door admits a legacy key on the connected-agents flag
      Given an enforced project whose legacy key is on "legacy_project_key_connected_agents" only
      When the project door is asked "scenarios:manage" with the scope the connect socket names
      Then it admits the key
      And asked the same permission with no scope, it refuses with "legacy_project_key_ingestion_only"

    @integration
    Scenario: A scope flag does not open a route that asks no permission
      Given an enforced project whose legacy key is on every scope flag but not on the full-access flag
      When it calls a project route that only identifies the caller, or the key door
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The hosted MCP refuses a legacy project key on scope flags only
      Given an enforced project whose legacy key is on every scope flag but not on the full-access flag
      When an MCP client opens a session with that key as its bearer
      Then the MCP endpoint answers 403 with the handled error "legacy_project_key_ingestion_only"

    @unit
    Scenario: Only the scope flags the route names are read
      Given a legacy project key
      When the door asks it a permission on a route that names "legacy_project_key_prompts_read"
      Then "legacy_project_key_prompts_read" is read for the key's project and organization
      And then "legacy_project_key_full_access" and "legacy_project_key_scope_enforced", and no other scope flag
      And when the prompts-read flag is on, the full-access flag is never read

    @unit
    Scenario: A route that names no scope flag reads only the full-access and enforced flags
      Given a legacy project key whose enforced project is on every scope flag
      When the door asks it a permission on a route that names no scope flag
      Then it does not hold the permission
      And only "legacy_project_key_full_access" and then "legacy_project_key_scope_enforced" are read

    @unit
    Scenario: Full access holds every permission
      Given a legacy project key whose project is on the full-access flag only
      When the door asks it any permission on any route
      Then it holds the permission

    @integration
    Scenario: A route naming an unknown scope flag is refused
      Given a route that names a scope flag that is not in LEGACY_PROJECT_KEY_SCOPE_FLAGS
      When the runtime mounts it behind the real project door
      Then the mount fails naming the unknown flag

    @integration
    Scenario: A socket naming an unknown scope flag is refused at mount
      Given a websocket protocol behind the project door that names a scope flag the door does not list
      When the host mounts it
      Then the mount fails naming the unknown flag

    @unit
    Scenario: Every scope flag is a registered feature flag
      Given the scope flag list in the api-key contract
      Then every flag in it is a registered product flag, off by default
      And "legacy_project_key_scope_enforced" is a registered product flag, off by default

  Rule: other credentials are unaffected

    @integration
    Scenario: An unknown key is still refused as invalid credentials
      Given a token that resolves to no key
      When it calls a project route
      Then it answers 401 with the handled error "invalid_credentials", not "legacy_project_key_ingestion_only"

    @integration
    Scenario: An API key is still asked its own ceiling
      Given an API key whose ceiling holds "prompts:view"
      When it calls a project route that asks "prompts:view"
      Then the route answers 200 without reading the full-access flag
