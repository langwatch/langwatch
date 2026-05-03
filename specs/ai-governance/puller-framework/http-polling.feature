Feature: HttpPollingPullerAdapter (universal HTTP-polling adapter)
  As a customer with a third-party AI platform that exposes a paginated
  audit-log REST API (Workato, Microsoft Power Platform, Anthropic's
  compliance API, etc.)
  I want a generic HTTP-polling adapter where I declare the URL + auth +
  pagination shape + JSON-path mappings
  So that I don't have to write custom adapter code per platform

  Mirrors Airbyte's HTTP-source connector + Singer Tap's REST extractor.
  Spec maps to Phase 10 backend (Sergey: P10-http-adapter).

  Background:
    Given an IngestionSource of type `pull` with adapter `http_polling`
    And valid pullConfig matching the http_polling Zod schema

  Scenario: Config shape
    Given the pullConfig is:
      """
      {
        "adapter": "http_polling",
        "url": "https://api.acme.com/v1/audit-log",
        "method": "GET",
        "headers": { "Authorization": "Bearer ${{credentials.token}}" },
        "authMode": "bearer",
        "credentialRef": "acme_audit_log_creds",
        "cursorJsonPath": "$.next_cursor",
        "eventsJsonPath": "$.events",
        "schedule": "*/5 * * * *",
        "eventMapping": {
          "source_event_id": "$.id",
          "event_timestamp": "$.created_at",
          "actor": "$.user.email",
          "action": "$.event_type",
          "target": "$.model",
          "cost_usd": "$.usage.cost",
          "tokens_input": "$.usage.input_tokens",
          "tokens_output": "$.usage.output_tokens"
        }
      }
      """
    When `validateConfig(pullConfig)` runs
    Then no error is thrown

  Scenario: Happy-path single-page pull
    Given the upstream API returns `{ events: [event1, event2], next_cursor: null }`
    When the worker calls `runOnce({ cursor: null })`
    Then the adapter POSTs/GETs the configured URL with substituted Authorization header
    And maps event1 + event2 via the configured JSON-paths
    And returns `{ events: [normalized1, normalized2], cursor: null, errorCount: 0 }`
    And the BullMQ job marks the IngestionSource as fully drained

  Scenario: Multi-page pull respects cursor
    Given the upstream returns `{ events: […20 events…], next_cursor: "abc123" }` on first call
    And `{ events: […20 events…], next_cursor: "def456" }` on second call (with cursor=abc123)
    And `{ events: [], next_cursor: null }` on third call
    When the worker calls `runOnce({ cursor: null })`
    Then the adapter chains 3 HTTP calls within the same runOnce invocation
    And returns 40 events total
    And the final returned cursor is `null` (drained)

  Scenario: Authorization header template substitution
    Given pullConfig.headers = `{ "Authorization": "Bearer ${{credentials.token}}", "X-Org": "${{ingestionSource.organizationId}}" }`
    And the credentialRef "acme_audit_log_creds" resolves to `{ token: "secret-xyz" }`
    When the adapter executes a request
    Then the actual outgoing headers are `{ "Authorization": "Bearer secret-xyz", "X-Org": "<orgId>" }`
    And the credential is fetched server-side (never logged)

  Scenario: 5xx triggers retry-with-backoff
    Given the upstream returns 503 on the first call
    When the worker handles the response
    Then the adapter retries up to 2x with exponential backoff (250 → 500ms)
    And if all retries fail, the run aborts with `errorCount = 1` + cursor unchanged

  Scenario: 4xx fails fast
    Given the upstream returns 401 (auth misconfigured)
    Then the adapter does NOT retry
    And the run aborts with `errorCount = 1` + cursor unchanged
    And the IngestionSource UI shows "Authentication failed — check credentials"

  Scenario: Cursor extraction handles missing field
    Given the upstream returns `{ events: [...], next_cursor: undefined }` (field absent)
    Then the adapter treats this as "drained" — returns cursor: null
    And the BullMQ job schedules the next pull per the cron schedule, not immediately
