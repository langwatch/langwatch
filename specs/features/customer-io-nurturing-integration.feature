Feature: Customer.io nurturing integration
  As a LangWatch product team member
  I want LangWatch to push user traits and events to Customer.io in real-time
  So that customer nurturing workflows trigger automatically as users progress through the platform

  # All scenarios bound to existing tests in:
  #   packages/enterprise/features/billing/server/src/__tests__/nurturing.service.unit.test.ts
  #   packages/enterprise/features/billing/server/src/__tests__/nurturing.service.wiring.unit.test.ts
  #   [gone] ee/billing/nurturing/hooks/signupIdentification.unit.test.ts
  #   [gone] ee/billing/nurturing/hooks/featureAdoption.unit.test.ts
  #   [gone] ee/billing/nurturing/hooks/activityTracking.unit.test.ts
  #   [gone] ee/billing/nurturing/hooks/productInterest.unit.test.ts
  #   [gone] ee/billing/nurturing/hooks/promptCreation.unit.test.ts
  #   [gone] ee/billing/nurturing/hooks/promptCreation.integration.test.ts
  #   [gone] src/hooks/__tests__/useAttributionCapture.unit.test.ts

  All scheduling, sequencing, and email delivery is owned by Customer.io.
  LangWatch nurturing hooks fire-and-forget data through the Pipelines API.
  The application wires NurturingService only when it is configured.

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

  # Implementation diverges from "null service" pattern: when no API key
  # is configured, getApp().nurturing is undefined rather than a null
  # NurturingService. This is enforced via the wiring tests below.
  # See "Service is undefined when CUSTOMER_IO_API_KEY is absent".

  # ---------------------------------------------------------------------------
  # R9: Environment configuration and graceful degradation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Service is active when CUSTOMER_IO_API_KEY is configured
    Given the app config includes a customerIoApiKey
    When the app is initialized
    Then getApp().nurturing is an active NurturingService instance

  @unit
  Scenario: Service is undefined when CUSTOMER_IO_API_KEY is absent
    Given the app config has no customerIoApiKey
    When NurturingService.create is conditionally called
    Then nurturing is undefined

  @unit
  Scenario: Region defaults to EU when CUSTOMER_IO_REGION is not set
    Given a NurturingService created with no customerIoRegion
    When identifyUser is called
    Then the request is sent to the EU regional endpoint

  @unit
  Scenario: Test app passes no NurturingService
    Given createTestApp is called
    Then nurturing is undefined

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

  # ---------------------------------------------------------------------------
  # Journey traits and hooks
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # R10: Capture product_interest from onboarding "Pick your flavour"
  #
  # initializeOrganization() fires BEFORE the flavour screen, so
  # product_interest cannot be part of signupData. Instead, the flavour
  # selection fires a separate identifyUser call via a tRPC/API endpoint
  # that calls getApp().nurturing.identifyUser().
  # ---------------------------------------------------------------------------

  # The "Pick your flavour" wording was a planning-stage label. The shipped
  # onboarding asks "How do you want to integrate?" and the trait sent is
  # `integration_method`, not `product_interest`. The mapping is enforced by
  # mapProductSelectionToIntegrationMethod() (see ee/billing/nurturing/hooks/
  # productInterest.unit.test.ts).

  @unit
  Scenario Outline: Integration-method selection maps to canonical trait value
    Given a user reaches the integration-method onboarding screen
    When the user selects "<selection>"
    Then the integration_method trait sent to Customer.io is "<trait_value>"

    Examples:
      | selection            | trait_value    |
      | via-claude-code      | coding_agent   |
      | via-platform         | platform       |
      | via-claude-desktop   | mcp            |
      | manually             | manual_sdk     |

  @integration
  Scenario: Integration-method identify call is fire-and-forget
    Given a user reaches the "How do you want to integrate?" onboarding screen
    When the user selects "Observability"
    Then the integration_method identify call is dispatched without awaiting a response
    And the caller receives control back immediately

  @integration
  Scenario: Integration-method identify failure does not break onboarding navigation
    Given a user reaches the "How do you want to integrate?" onboarding screen
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

  # ---------------------------------------------------------------------------
  # R14: Attribution capture — URL -> Customer.io
  #
  # Captures first-touch URL parameters (ref, utm_*) and document.referrer
  # on the first pageview after hydration, persists them in sessionStorage,
  # and forwards them through the onboarding signUpData so they land in
  # Customer.io as identify traits AND signed_up event properties.
  #
  # First-touch semantics: once captured, subsequent navigations do not
  # overwrite the value. This prevents internal link clicks from clobbering
  # the original acquisition source.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Attribution hook captures ref param in sessionStorage on first touch
    Given no existing attribution in sessionStorage
    And the URL contains "?ref=website"
    When the attribution capture hook mounts
    Then sessionStorage key "lw_attrib.leadSource" equals "website"

  @unit
  Scenario: Attribution hook does not overwrite existing first-touch values
    Given sessionStorage "lw_attrib.leadSource" is already "original"
    And the URL contains "?ref=later"
    When the attribution capture hook mounts
    Then sessionStorage key "lw_attrib.leadSource" remains "original"

  @unit
  Scenario: Attribution hook captures full utm tuple when present in URL
    Given no existing attribution in sessionStorage
    And the URL contains utm_source, utm_medium, utm_campaign, utm_term, utm_content
    When the attribution capture hook mounts
    Then sessionStorage contains all five lw_attrib.utm_* keys with the URL values

  @unit
  Scenario: Attribution hook captures document.referrer when present
    Given no existing attribution in sessionStorage
    And document.referrer is "https://www.langwatch.ai/"
    When the attribution capture hook mounts
    Then sessionStorage key "lw_attrib.referrer" equals "https://www.langwatch.ai/"

  @integration
  Scenario: Signup with ref in URL sends lead_source trait and event property to Customer.io
    Given a user lands on the app with "?ref=website" in the URL
    And completes onboarding
    When the onboarding flow completes
    Then the user traits sent to Customer.io include lead_source "website"
    And the "signed_up" event properties include leadSource "website"

  @integration
  Scenario: Signup forwards utm tuple to Customer.io
    Given a user lands on the app with utm_source, utm_medium, utm_campaign, utm_term, utm_content in the URL
    And completes onboarding
    When the onboarding flow completes
    Then the user traits sent to Customer.io include utm_source, utm_medium, utm_campaign, utm_term, utm_content

  @integration
  Scenario: Signup without attribution omits those fields from Customer.io traits
    Given a user completes onboarding with no attribution data
    When the onboarding flow completes
    Then the user traits sent to Customer.io do not include lead_source, utm_source, utm_medium, utm_campaign, utm_term, utm_content, or referrer keys
