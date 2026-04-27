Feature: CLI ingest debug commands

  As an org admin or platform engineer integrating an upstream AI
  platform with LangWatch's IngestionSource layer, I want to inspect
  IngestionSources and tail recent events from my terminal so I can
  diagnose "is my OTel actually landing?" without leaving the CLI.

  These commands are read-only debug helpers. Create / rotate /
  archive intentionally stay browser-only until the setup flow is
  stable end-to-end.

  All commands are gated behind LANGWATCH_GOVERNANCE_PREVIEW=1, like
  the rest of the governance CLI surface. Without the env var, the
  commands aren't registered and `langwatch --help` doesn't show
  them.

  All commands authenticate via the device-flow access token in
  ~/.langwatch/config.json (Bearer lw_at_*). They reuse the same
  IngestionSourceService and ActivityMonitorService backends the
  web admin UI uses; CLI and UI are guaranteed to see the same
  data because they query through the same service layer with the
  same multi-tenancy guard.

  Background:
    Given I have a valid device-flow session in ~/.langwatch/config.json
    And LANGWATCH_GOVERNANCE_PREVIEW is set to "1"

  Scenario: langwatch ingest list shows my org's IngestionSources
    Given my org has 2 active IngestionSources and 1 archived source
    When I run `langwatch ingest list`
    Then I see a table with one row per active source
    And the table columns are: name, sourceType, status, lastEventAt
    And the archived source is hidden by default
    And the exit code is 0

  Scenario: langwatch ingest list --all includes archived sources
    Given my org has 2 active and 1 archived IngestionSource
    When I run `langwatch ingest list --all`
    Then I see all 3 sources in the table
    And archived sources are visually marked

  Scenario: langwatch ingest list --json emits machine-readable output
    When I run `langwatch ingest list --json`
    Then stdout is valid JSON
    And the JSON shape matches the api.ingestionSources.list contract
    And the secret hash field is omitted from the JSON

  Scenario: langwatch ingest tail <sourceId> shows recent events
    Given an IngestionSource with id "src_abc" has 100 persisted events
    When I run `langwatch ingest tail src_abc --limit 10`
    Then I see the 10 most recent events newest-first
    And each row shows: eventTimestamp, eventType, actor, action, target, costUsd, tokensInput, tokensOutput
    And the exit code is 0

  Scenario: langwatch ingest tail <sourceId> with no events
    Given an IngestionSource with id "src_empty" has 0 events
    When I run `langwatch ingest tail src_empty`
    Then I see "No events for this source yet."
    And the message links to the upstream-platform setup docs
    And the exit code is 0

  Scenario: langwatch ingest tail <sourceId> --follow polls for new events
    Given an IngestionSource with id "src_live" has 5 events
    When I run `langwatch ingest tail src_live --follow`
    And a 6th event arrives upstream after 3 seconds
    Then within 5 seconds the new event is rendered to stdout
    And the process keeps running until SIGINT

  Scenario: langwatch ingest tail <unknown> returns clean error
    When I run `langwatch ingest tail src_does_not_exist`
    Then stderr says "IngestionSource not found"
    And the exit code is 1

  Scenario: langwatch ingest health <sourceId> shows event-rate metrics
    Given an IngestionSource "src_x" with 12 events in the last 24h, 88 in the last 7d, 220 in the last 30d
    When I run `langwatch ingest health src_x`
    Then I see "Events (24h): 12", "Events (7d): 88", "Events (30d): 220"
    And the lastSuccessAt timestamp is shown in human-readable form
    And the exit code is 0

  Scenario: langwatch governance status surfaces the setup-state OR-of-flags
    Given my org has 1 personal VK, 1 RoutingPolicy, 0 IngestionSources, 0 AnomalyRules, recent activity
    When I run `langwatch governance status`
    Then I see a checklist with each component checked or unchecked
    And the line "Governance active: yes" appears
    And a one-line summary of recent spend is rendered
    And the exit code is 0

  Scenario: governance commands without LANGWATCH_GOVERNANCE_PREVIEW
    Given LANGWATCH_GOVERNANCE_PREVIEW is unset
    When I run `langwatch ingest list`
    Then commander emits "unknown command 'ingest'"
    And the exit code is non-zero

  Scenario: governance commands without a device-flow session
    Given ~/.langwatch/config.json does not exist
    When I run `langwatch ingest list` with LANGWATCH_GOVERNANCE_PREVIEW=1
    Then stderr says "Not logged in — run `langwatch login --device` first"
    And the exit code is 1
