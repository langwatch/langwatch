# Spec: BYO HTTP-polling source admin UI flow.
#
# Pairs with:
#   - ee/governance/dashboard/pages/ingestion-sources.tsx (sourceType "http_custom")
#   - ee/governance/services/pullers/httpPollingPullerAdapter.ts (validateConfig)
#   - specs/ai-governance/puller-framework/http-polling.feature
#
# Backstory: the locked-shape reference pullers (copilot_studio /
# openai_compliance / claude_compliance) cover the three audit-log
# providers that ship with the platform. For every other paginated REST
# audit-log endpoint a customer might run (homegrown agent systems,
# vertical-SaaS exposing an undocumented API, internal tools), an admin
# needs a way to declare URL + auth + JSON-path field mappings without
# us shipping new puller code per platform. This is that flow.

Feature: http_custom — BYO HTTP-polling ingestion source admin UI
  As an admin of an organization on an Enterprise plan
  I want to create an ingestion source against an arbitrary paginated
  REST audit-log endpoint by declaring URL + auth + cursor + field
  mappings in the admin UI
  So that the universal HttpPollingPullerAdapter pulls and OCSF-folds
  events from any third-party AI platform we haven't shipped a locked
  reference puller for

  Background:
    Given an admin authenticated with permission `governance.manage`
    And the organization is on an Enterprise plan
    And the `release_ui_ai_governance_enabled` feature flag is on

  Scenario: http_custom appears in the source-type dropdown
    When the admin opens "Add ingestion source" drawer at /settings/governance/ingestion-sources
    Then the source-type dropdown lists "Custom HTTP audit-log API"
    And selecting it shows the BYO field-set:
      | Audit-log endpoint URL              |
      | Auth header name                    |
      | Auth header value (template)        |
      | Bearer token / API key              |
      | Events array JSONPath               |
      | Next-cursor JSONPath                |
      | Cursor query parameter name         |
      | Event mapping (key=jsonpath per line)|

  Scenario: Form submit builds a full HttpPollingConfig pullConfig
    Given the admin has filled the form with:
      | url             | https://api.acme.com/v1/audit-log              |
      | authHeaderName  | Authorization                                   |
      | authHeaderValue | Bearer ${{credentials.token}}                   |
      | credentialsToken| sk-acme-redacted                                |
      | eventsJsonPath  | $.events                                        |
      | cursorJsonPath  | $.next_cursor                                   |
      | cursorQueryParam| cursor                                          |
      | eventMappingDsl | source_event_id=$.id\nevent_timestamp=$.created_at\nactor=$.user.email\naction=$.event_type\ntarget=$.model |
      | pullSchedule    | (blank, adapter default)                        |
    When the admin clicks "Create source"
    Then `api.ingestionSources.create` is called with `pullConfig` shaped as:
      """
      {
        "adapter": "http_polling",
        "url": "https://api.acme.com/v1/audit-log",
        "method": "GET",
        "headers": { "Authorization": "Bearer ${{credentials.token}}" },
        "authMode": "header_template",
        "cursorJsonPath": "$.next_cursor",
        "cursorQueryParam": "cursor",
        "eventsJsonPath": "$.events",
        "schedule": "*/15 * * * *",
        "eventMapping": {
          "source_event_id": "$.id",
          "event_timestamp": "$.created_at",
          "actor": "$.user.email",
          "action": "$.event_type",
          "target": "$.model"
        },
        "credentials": { "token": "sk-acme-redacted" }
      }
      """
    And `pullSchedule` is sent as `*/15 * * * *`
    And the IngestionSource row persists with `sourceType=http_custom`

  Scenario: Required-field validation surfaces before dispatch
    Given the admin has selected http_custom
    But the "Bearer token / API key" field is empty
    When the admin clicks "Create source"
    Then no `api.ingestionSources.create` call fires
    And the user sees a toaster error naming the missing fields
    And the drawer stays open with the partially-filled form intact

  Scenario: Default cursorQueryParam falls back to "cursor"
    Given the admin leaves "Cursor query parameter name" blank
    And every other required field is filled
    When the admin clicks "Create source"
    Then the persisted pullConfig has `cursorQueryParam: "cursor"`

  Scenario: Comments and blank lines in the mapping DSL are tolerated
    Given the eventMappingDsl contains:
      """
      # Required keys
      source_event_id=$.id
      event_timestamp=$.created_at

      # Actor / action / target
      actor=$.user.email
      action=$.event_type
      target=$.model
      """
    When the admin submits
    Then the persisted eventMapping is:
      """
      {
        "source_event_id": "$.id",
        "event_timestamp": "$.created_at",
        "actor": "$.user.email",
        "action": "$.event_type",
        "target": "$.model"
      }
      """

  Scenario: End-to-end — created source dispatches against a fixture endpoint
    Given a fixture HTTP endpoint at https://fixture.local/audit-log returning:
      """
      {
        "events": [
          { "id": "evt-1", "created_at": "2026-05-04T19:00:00Z", "user": { "email": "alex@acme.com" }, "event_type": "completion", "model": "gpt-5-mini" }
        ],
        "next_cursor": null
      }
      """
    And the admin has saved an http_custom source pointing at it (with the standard mapping)
    And the source has been seeded as an event-sourcing scheduled job
    When the puller worker fires the next tick
    Then `HttpPollingPullerAdapter.runOnce` calls the fixture endpoint
    And one normalized event lands in `governance_ocsf_events` with `class_uid=6003` and `actor.user.email_addr="alex@acme.com"`

  Scenario: Plan gating — http_custom is hidden on non-Enterprise plans
    Given the organization is NOT on an Enterprise plan
    When the admin opens "Add ingestion source"
    Then the source-type dropdown only contains "Generic OTel"
    And http_custom is NOT selectable

  Scenario: Token storage — the bearer token never appears in admin list responses
    Given an http_custom source has been created with a non-empty credentialsToken
    When the admin views the ingestion-sources list
    Then no field returned by `api.ingestionSources.list` contains the raw token value
    And the admin must use Rotate-secret to mint a new token (the old one is unrecoverable through the UI)
