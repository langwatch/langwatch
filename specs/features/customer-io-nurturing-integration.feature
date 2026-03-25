Feature: Customer.io nurturing integration
  As a LangWatch product team member
  I want LangWatch to push user traits and events to Customer.io in real-time
  So that customer nurturing workflows trigger automatically as users progress through the platform

  All scheduling, sequencing, and email delivery is owned by Customer.io.
  LangWatch reactors and hooks fire-and-forget data to Customer.io via the
  Pipelines API. The NurturingService follows the NotificationService pattern
  (private constructor, static create/createNull, wired through App).

  # ---------------------------------------------------------------------------
  # R1: NurturingService — Customer.io API client
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Identify call authenticates with Basic Auth using the configured API key
    Given a NurturingService created with an API key and region "us"
    When identifyUser is called with a user ID and traits
    Then an HTTP request is sent to "cdp.customer.io/v1/identify" with Basic Auth using the API key
    And the request body contains the user ID and traits

  @unit
  Scenario: Identify call routes to EU endpoint when region is eu
    Given a NurturingService created with an API key and region "eu"
    When identifyUser is called with a user ID and traits
    Then the request is sent to "cdp-eu.customer.io/v1/identify"

  @unit
  Scenario: Track call sends event payload to Customer.io
    Given a NurturingService created with an API key
    When trackEvent is called with a user ID, event name, and properties
    Then an HTTP request is sent to the track endpoint with the event payload

  @unit
  Scenario: Group call sends organization traits to Customer.io
    Given a NurturingService created with an API key
    When groupUser is called with a user ID, group ID, and org traits
    Then an HTTP request is sent to the group endpoint with the org traits

  @unit
  Scenario: Batch call combines multiple operations into a single request
    Given a NurturingService created with an API key
    When batch is called with multiple identify and track calls
    Then a single HTTP request is sent to the batch endpoint containing all calls

  @unit
  Scenario: NurturingService enforces a 10-second request timeout
    Given a NurturingService created with an API key
    And the Customer.io API does not respond within 10 seconds
    When identifyUser is called
    Then the request is aborted
    And the timeout error is captured for observability

  @unit
  Scenario: NurturingService swallows API errors without throwing
    Given a NurturingService created with an API key
    And the Customer.io API returns a 500 error
    When identifyUser is called
    Then the method resolves without throwing
    And the error is logged and captured for observability

  @unit
  Scenario: Null service resolves all methods without making HTTP requests
    Given a NurturingService created via createNull
    When identifyUser is called
    Then no HTTP request is made
    And the method resolves without throwing

  # ---------------------------------------------------------------------------
  # R9: Environment configuration and graceful degradation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Service is active when CUSTOMER_IO_API_KEY is configured
    Given the app config includes a customerIoApiKey
    When the app is initialized
    Then getApp().nurturing is an active NurturingService instance

  @integration
  Scenario: Service is a no-op when CUSTOMER_IO_API_KEY is absent
    Given the app config has no customerIoApiKey
    When the app is initialized
    Then getApp().nurturing is a null NurturingService that silently no-ops

  @integration
  Scenario: Region defaults to US when CUSTOMER_IO_REGION is not set
    Given the app config has no customerIoRegion
    When the app is initialized
    Then the NurturingService uses the US regional endpoint

  @integration
  Scenario: Test app uses null NurturingService
    Given createTestApp is called
    Then getApp().nurturing is a null NurturingService that silently no-ops

  # ---------------------------------------------------------------------------
  # R2: Signup identification — onboarding hook
  # ---------------------------------------------------------------------------

  @integration
  Scenario: New signup identifies user with traits in Customer.io
    Given a user completes onboarding with name "Jane Doe" and email "jane@example.com"
    And the signup data includes role "engineer" and company size "11-50"
    When the onboarding flow completes
    Then the user is identified in Customer.io with email, name, role, and company_size
    And the user traits include has_traces false and has_evaluations false

  @integration
  Scenario: New signup associates user with organization via group call
    Given a user completes onboarding
    And the organization is named "Acme Corp"
    When the onboarding flow completes
    Then the user is associated with the organization via a group call

  @integration
  Scenario: New signup tracks signed_up event
    Given a user completes onboarding
    And the signup data includes role "engineer" and company size "11-50"
    When the onboarding flow completes
    Then a "signed_up" event is tracked for the user with the signup metadata

  @integration
  Scenario: Signup identification includes optional marketing fields when present
    Given a user completes onboarding with utm_campaign "launch-week"
    And the signup data includes how_heard "twitter"
    When the onboarding flow completes
    Then the user traits sent to Customer.io include utm_campaign and how_heard

  @integration
  Scenario: Customer.io failure during signup does not block onboarding
    Given a user completes onboarding
    And the Customer.io API is unavailable
    When the onboarding flow completes
    Then the organization is created successfully
    And the Customer.io error is captured for observability

  @integration
  Scenario: Signup with no Customer.io key configured completes without errors
    Given a user completes onboarding
    And no Customer.io API key is configured
    When the onboarding flow completes
    Then the organization is created successfully
    And no Customer.io requests are made

  # ---------------------------------------------------------------------------
  # R3: Trace integration reactor — customerIoTraceSync
  # ---------------------------------------------------------------------------

  @integration
  Scenario: First trace identifies user with trace milestones
    Given a project that has never received a trace
    When the first trace is processed with sdk_language "python" and sdk_framework "openai"
    Then the user is identified in Customer.io with has_traces true
    And the user traits include sdk_language, sdk_framework, and first_trace_at

  @integration
  Scenario: First trace fires first_trace_integrated event
    Given a project that has never received a trace
    When the first trace is processed with sdk_language "python" and sdk_framework "openai"
    Then a "first_trace_integrated" event is tracked with sdk_language, sdk_framework, and project_id

  @integration
  Scenario: First trace fires immediately without debouncing
    Given a project that has never received a trace
    When the first trace is processed
    Then the Customer.io calls are made immediately without delay

  @integration
  Scenario: Subsequent traces update count and timestamp with debouncing
    Given a project that already has traces
    When a new trace is processed
    Then the user is identified in Customer.io with updated trace_count and last_trace_at
    And the update is debounced so at most one call per project per 5 minutes

  @unit
  Scenario: Trace sync reactor uses project-scoped job ID for debouncing
    Given the customerIoTraceSync reactor
    When makeJobId is called for a project
    Then the returned ID is "cio-trace-sync-{projectId}"

  @unit
  Scenario: Trace sync does not duplicate first-trace detection logic
    Given the projectMetadata reactor already tracks first trace via Project.firstMessage
    When the customerIoTraceSync reactor processes a trace
    Then it reads the existing first-trace flag rather than re-detecting it

  # ---------------------------------------------------------------------------
  # R4: Evaluation sync reactor — customerIoEvaluationSync
  # ---------------------------------------------------------------------------

  @integration
  Scenario: First evaluation identifies user with evaluation milestones
    Given an organization with no prior evaluations
    When the first evaluation is processed with type "llm_judge"
    Then the user is identified in Customer.io with has_evaluations true and evaluation_count 1
    And the user traits include first_evaluation_at

  @integration
  Scenario: First evaluation fires first_evaluation_created event
    Given an organization with no prior evaluations
    When the first evaluation is processed with type "llm_judge"
    Then a "first_evaluation_created" event is tracked with evaluation_type and project_id

  @integration
  Scenario: Subsequent evaluations update identify with evaluation count
    Given an organization that already has evaluations
    When a new evaluation is processed with score 0.85 and passed true
    Then the user is identified with updated evaluation_count and last_evaluation_at

  @integration
  Scenario: Subsequent evaluations fire evaluation_ran event
    Given an organization that already has evaluations
    When a new evaluation is processed with score 0.85 and passed true
    Then an "evaluation_ran" event is tracked with evaluation_id, score, and passed

  @integration
  Scenario: Subsequent evaluation updates are debounced per project
    Given an organization that already has evaluations
    When a new evaluation is processed with score 0.85 and passed true
    Then the update is debounced per project

  @unit
  Scenario: Evaluation sync reactor uses project-scoped job ID for debouncing
    Given the customerIoEvaluationSync reactor
    When makeJobId is called for a project
    Then the returned ID is "cio-eval-sync-{projectId}"

  # ---------------------------------------------------------------------------
  # R5: Daily usage sync reactor — customerIoDailyUsageSync
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Daily usage fold pushes aggregated metrics to Customer.io
    Given the projectDailySdkUsage fold has completed for a project
    When the daily usage sync reactor runs
    Then the user is identified in Customer.io with trace_count, daily_trace_count, and trace_count_updated_at

  @unit
  Scenario: Daily usage sync sends cumulative totals not reset counters
    Given accumulated usage data for a project
    When the daily usage sync reactor builds the trait payload
    Then trace_count is the cumulative total
    And trace_count_updated_at is an ISO 8601 timestamp of the fold completion

  # ---------------------------------------------------------------------------
  # R6: Team and feature adoption hooks
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Team member invite updates member count and fires event
    Given a user invites a team member with email "bob@example.com" and role "member"
    When the invite is sent
    Then the user is identified in Customer.io with updated team_member_count
    And a "team_member_invited" event is tracked with invited_email and role

  @integration
  Scenario: Workflow creation updates workflow count and fires event
    Given a user creates a workflow in a project
    When the workflow is saved
    Then the user is identified in Customer.io with updated workflow_count
    And a "workflow_created" event is tracked with workflow_id and project_id

  @integration
  Scenario: Scenario creation updates scenario count and fires event
    Given a user creates a scenario in a project
    When the scenario is saved
    Then the user is identified in Customer.io with updated scenario_count
    And a "scenario_created" event is tracked with scenario_id and project_id

  @integration
  Scenario: Experiment run fires event
    Given a user runs an experiment in a project
    When the experiment completes
    Then an "experiment_ran" event is tracked with experiment_id and project_id

  @integration
  Scenario: Feature adoption hook failure does not break the originating action
    Given a user creates a workflow
    And the Customer.io API is unavailable
    When the workflow is saved
    Then the workflow is created successfully
    And the Customer.io error is captured for observability

  # ---------------------------------------------------------------------------
  # R7: Activity tracking — inactivity detection
  # ---------------------------------------------------------------------------

  @integration
  Scenario: User login pushes last_active_at to Customer.io
    Given a user logs in or refreshes their session
    When the auth session callback fires
    Then the user is identified in Customer.io with last_active_at set to the current time

  @integration
  Scenario: Activity tracking is debounced to avoid excessive API calls
    Given a user refreshes their session multiple times within one hour
    When the auth session callback fires each time
    Then at most one Customer.io identify call is made per hour

  @integration
  Scenario: Activity tracking failure does not break the login flow
    Given a user logs in
    And the Customer.io API is unavailable
    When the auth session callback fires
    Then the user session is established successfully
    And the Customer.io error is captured for observability

  # ===========================================================================
  # Iteration 2 — Journey Alignment (R10–R13)
  #
  # Aligns LangWatch nurturing data with the Customer.io onboarding Journey.
  # Adds product_interest capture, has_prompts tracking, has_simulations
  # tracking via the simulation pipeline reactor, and updated trait schema.
  #
  # Challenge findings incorporated:
  # 1. product_interest is captured via a separate identify call AFTER the
  #    "Pick your flavour" screen, not in signupData (initializeOrganization
  #    fires before the flavour screen).
  # 2. Simulation sync debounce key is project-scoped (tenantId), not
  #    run-scoped (tenantId-aggregateId), matching the trace sync pattern.
  # 3. Prompt and simulation counts are org-wide (aggregated across all
  #    projects in the org), following the createEvaluationCountFn pattern.
  # ===========================================================================

  # ---------------------------------------------------------------------------
  # R10: Capture product_interest from onboarding "Pick your flavour"
  #
  # initializeOrganization() fires BEFORE the flavour screen, so
  # product_interest cannot be part of signupData. Instead, the flavour
  # selection fires a separate identifyUser call via a tRPC/API endpoint
  # that calls getApp().nurturing.identifyUser().
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Product selection fires a separate identify call after flavour is picked
    Given a user has completed organization setup
    And the user reaches the "Pick your flavour" onboarding screen
    When the user selects "Observability"
    Then a separate identifyUser call is made to Customer.io with product_interest "observability"
    And this call is independent of the initial signup identification

  @integration
  Scenario: Product interest is updated independently of signup flow
    Given a user completed onboarding without selecting a product interest
    When the user later selects a product interest from the flavour screen
    Then the user is identified in Customer.io with the selected product_interest
    And no other signup traits are re-sent

  @unit
  Scenario Outline: Flavour selection maps to correct product_interest trait value
    Given a user reaches the "Pick your flavour" onboarding screen
    When the user selects "<selection>"
    Then the product_interest trait sent to Customer.io is "<trait_value>"

    Examples:
      | selection          | trait_value        |
      | Observability      | observability      |
      | Evaluations        | evaluations        |
      | Prompt Management  | prompt_management  |
      | Agent Simulations  | agent_simulations  |

  @integration
  Scenario: Product interest identify call is fire-and-forget
    Given a user reaches the "Pick your flavour" onboarding screen
    When the user selects "Observability"
    Then the product_interest identify call is dispatched without awaiting a response
    And the caller receives control back immediately

  @integration
  Scenario: Product interest identify failure does not break onboarding navigation
    Given a user reaches the "Pick your flavour" onboarding screen
    And the Customer.io API is unavailable
    When the user selects "Evaluations"
    Then the user navigates to the evaluations onboarding screens
    And the Customer.io error is captured for observability

  # ---------------------------------------------------------------------------
  # R11: has_prompts trait + prompt creation hook
  #
  # Prompts can be created via the platform UI (tRPC) or the REST API
  # (/api/prompts). The hook must fire regardless of origin. prompt_count
  # is org-wide (aggregated across all projects in the organization).
  # ---------------------------------------------------------------------------

  @integration
  Scenario: First prompt creation identifies user with has_prompts true
    Given an organization with no prompts across any project
    When a user creates their first prompt
    Then the user is identified in Customer.io with has_prompts true and org-wide prompt_count 1

  @integration
  Scenario: First prompt creation fires first_prompt_created event
    Given an organization with no prompts across any project
    When a user creates their first prompt
    Then a "first_prompt_created" event is tracked with project_id

  @integration
  Scenario: Subsequent prompt creation updates org-wide prompt_count without firing first event
    Given an organization that already has prompts
    When a user creates another prompt in any project
    Then the user is identified in Customer.io with updated org-wide prompt_count
    And no "first_prompt_created" event is tracked

  @integration
  Scenario: Prompt creation tracked regardless of whether created via platform UI or API
    Given an organization with no prompts across any project
    When a prompt is created via the REST API
    Then the user is identified in Customer.io with has_prompts true
    And a "first_prompt_created" event is tracked

  @integration
  Scenario: Prompt creation hook failure does not break the prompt mutation
    Given a user creates a prompt
    And the Customer.io API is unavailable
    When the prompt is saved
    Then the prompt is created successfully
    And the Customer.io error is captured for observability

  # ---------------------------------------------------------------------------
  # R12: has_simulations trait + reactor on simulation_processing pipeline
  #
  # simulation_count is org-wide (aggregated across all projects in the
  # organization), following the createEvaluationCountFn pattern.
  # Debounce key is project-scoped (tenantId only), matching trace sync.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: First simulation run identifies user with has_simulations true
    Given an organization with no prior simulation runs across any project
    When the first simulation is processed in the simulation_processing pipeline
    Then the user is identified in Customer.io with has_simulations true and org-wide simulation_count 1
    And the user traits include first_simulation_at

  @integration
  Scenario: First simulation run fires first_simulation_ran event
    Given an organization with no prior simulation runs across any project
    When the first simulation is processed in the simulation_processing pipeline
    Then a "first_simulation_ran" event is tracked with project_id

  @integration
  Scenario: First simulation fires immediately without debouncing
    Given an organization with no prior simulation runs
    When the first simulation is processed
    Then the Customer.io calls are made immediately without delay

  @integration
  Scenario: Subsequent simulation runs update org-wide count and timestamp with debouncing
    Given an organization that already has simulation runs
    When a new simulation is processed
    Then the user is identified in Customer.io with updated org-wide simulation_count and last_simulation_at
    And the update is debounced so at most one call per project per debounce window

  @unit
  Scenario: Simulation sync reactor uses project-scoped job ID for debouncing
    Given the customerIoSimulationSync reactor
    When makeJobId is called for a project
    Then the returned ID is "cio-sim-sync-{tenantId}"

  @integration
  Scenario: Simulation tracking is independent of scenario template creation
    Given a user creates a scenario template
    When the scenario is saved
    Then no simulation-related traits are updated in Customer.io

  # ---------------------------------------------------------------------------
  # R13: Trait schema + signup defaults
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Signup defaults include has_prompts and has_simulations as false
    Given a user completes onboarding
    When the onboarding flow completes
    Then the user traits sent to Customer.io include has_prompts false
    And the user traits sent to Customer.io include has_simulations false
    And the user traits sent to Customer.io include has_traces false
    And the user traits sent to Customer.io include has_evaluations false
