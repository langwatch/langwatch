Feature: Legacy project keys are ingestion-only
  A legacy project key is the key stored on the project itself (`Project.apiKey`),
  not an API key. It can send traces, logs, metrics and tracked events, which ask
  `traces:create`. Beyond that it passes only the routes that name a scope flag listing
  its project, one flag per usage (`LEGACY_PROJECT_KEY_SCOPE_FLAGS` in the api-key
  contract; a route names its flags with `withLegacyKeyScope`): prompts read, prompts
  write, traces read, scenarios, evaluations, experiments and connected agents. A flag
  opens routes, not permissions: a route that asks the same permission without naming
  the flag still refuses the key. A project on the `legacy_project_key_full_access` flag
  keeps the old full access while its owners move to an API key. Operators list the
  projects of each flag in one `{ projectId: [ids] }` rule. Every other request is
  refused with the handled error "legacy_project_key_ingestion_only" at status 403.

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

  Rule: everything else is refused

    @integration
    Scenario: A legacy project key is refused prompts, traces, evaluations and datasets
      Given a project whose legacy key is not on the full-access flag
      When it calls project routes that ask "prompts:view", "traces:view", "evaluations:view" or "datasets:view"
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"
      And the refusal names the permission it asked
      And no handler runs

    @integration
    Scenario: A legacy project key is refused a project route that asks no permission
      Given a project whose legacy key is not on the full-access flag
      When it calls a project route that only identifies the caller
      Then it answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: A legacy project key is refused on the key door
      Given a project whose legacy key is not on the full-access flag
      When it calls a key-door route, with or without a permission
      Then it answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The hosted MCP refuses a legacy project key
      Given a project whose legacy key is not on the full-access flag
      When an MCP client opens a session with that key as its bearer
      Then the MCP endpoint answers 403 with the handled error "legacy_project_key_ingestion_only"
      And no session is opened

    @integration
    Scenario: A legacy project key may run only the collector health probe
      Given a project whose legacy key is not on the full-access flag
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

  Rule: a scope flag opens only the routes that name it

    @integration
    Scenario: A project on the prompts-read flag fetches prompts and nothing else
      Given a project whose legacy key is on "legacy_project_key_prompts_read" only
      When it calls a route that names that flag
      Then the route answers 200
      When it calls a route that names "legacy_project_key_traces_read" or "legacy_project_key_prompts_write"
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: A project on two scope flags holds both
      Given a project whose legacy key is on "legacy_project_key_prompts_read" and "legacy_project_key_traces_read"
      When it calls routes that name each flag
      Then each answers 200
      And a route that names "legacy_project_key_evaluations" answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The connected-agents flag opens the connect routes and the model providers read only
      Given a project whose legacy key is on "legacy_project_key_connected_agents" only
      When it calls a route that asks "scenarios:manage" and names that flag, as connected-agent register, poll and frames do
      And a route that asks "project:view" and names that flag, as the model providers read does
      Then each answers 200
      When it calls a route that asks "scenarios:manage" without naming the flag, as test suite archive does
      Or a route that asks "project:view" without naming it, as the agents list does
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The connect socket's door admits a legacy key on the connected-agents flag
      Given a project whose legacy key is on "legacy_project_key_connected_agents" only
      When the project door is asked "scenarios:manage" with the scope the connect socket names
      Then it admits the key
      And asked the same permission with no scope, it refuses with "legacy_project_key_ingestion_only"

    @integration
    Scenario: A scope flag does not open a route that asks no permission
      Given a project whose legacy key is on every scope flag but not on the full-access flag
      When it calls a project route that only identifies the caller, or the key door
      Then each answers 403 with the handled error "legacy_project_key_ingestion_only"

    @integration
    Scenario: The hosted MCP refuses a legacy project key on scope flags only
      Given a project whose legacy key is on every scope flag but not on the full-access flag
      When an MCP client opens a session with that key as its bearer
      Then the MCP endpoint answers 403 with the handled error "legacy_project_key_ingestion_only"

    @unit
    Scenario: Only the scope flags the route names are read
      Given a legacy project key
      When the door asks it a permission on a route that names "legacy_project_key_prompts_read"
      Then "legacy_project_key_prompts_read" is read for the key's project and organization
      And then "legacy_project_key_full_access", and no other scope flag
      And when the prompts-read flag is on, the full-access flag is never read

    @unit
    Scenario: A route that names no scope flag reads only the full-access flag
      Given a legacy project key whose project is on every scope flag
      When the door asks it a permission on a route that names no scope flag
      Then it does not hold the permission
      And only "legacy_project_key_full_access" is read

    @unit
    Scenario: Full access holds every permission
      Given a legacy project key whose project is on the full-access flag only
      When the door asks it any permission on any route
      Then it holds the permission

    @unit
    Scenario: A route naming an unknown scope flag is refused
      Given a route that names a scope flag that is not in LEGACY_PROJECT_KEY_SCOPE_FLAGS
      When the runtime mounts it behind the real project door
      Then the mount fails naming the unknown flag

    @unit
    Scenario: Every scope flag is a registered feature flag
      Given the scope flag list in the api-key contract
      Then every flag in it is a registered product flag, off by default

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
