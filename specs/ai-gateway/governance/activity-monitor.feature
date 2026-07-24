Feature: Activity Monitor — cross-platform AI activity ingestion + oversight
  Enterprises run AI through many platforms simultaneously: tools whose
  API key the org owns (proxyable via Gateway) AND closed SaaS where
  the platform vendor owns the runtime (Cowork, Copilot Studio,
  Workato, ChatGPT Enterprise, Claude Cowork, …). Activity Monitor is
  the LangWatch surface that ingests audit / OTel / S3-delivered logs
  from those closed platforms, normalises them into a single OCSF-shaped
  trace stream, and powers the admin oversight dashboard with
  cross-source spend, per-user breakdown, and anomaly alerts.

  This spec captures the user-facing contract. Implementation lives
  under `langwatch/src/server/governance/activity-monitor/` and
  `langwatch/src/server/routes/ingest/`. UI is gated behind
  `release_ui_ai_governance_enabled`.

  Spec scope: the cross-platform monitoring pillar from gateway.md
  (Direction 2 in the strategy doc). Per-platform adapters and the
  full anomaly-detection ML are sub-features tracked in their own
  specs as they ship.

  Background:
    Given the org admin is signed into LangWatch as a member of "acme-corp"
    And the governance preview flag is enabled for acme-corp
    And at least one IngestionSource has been configured (see
      ingestion-sources.feature)

  Scenario: Admin lands on the Activity Monitor and sees one timeline
    When the admin navigates to "/settings/activity-monitor"
    Then a single timeline lists every AI event in their org
    And events are tagged by SourceType (gateway / personal / claude_cowork /
      copilot_studio / openai_compliance / workato / otel_generic / s3_custom)
    And every event row carries: actor (user), timestamp, action, model
      (when applicable), cost (when applicable), source platform name
    And the timeline supports filtering by SourceType, user, time window,
      and "show only anomalies"
    And the timeline pages cleanly across millions of events

  Scenario: Cross-source spend rollup
    Given the org has events from at least 3 SourceTypes in the last 30 days
    When the admin opens the Activity Monitor "Cost" tab
    Then a stacked bar chart breaks down spend by SourceType per day
    And a per-user breakdown lists the top spenders across all sources
    And clicking a SourceType drills down to platform-specific detail
    And the rollup query honours TenantId scoping (no cross-org leakage)

  Scenario: Anomaly alerts surface in real time
    Given a rule is active: "any user performing >1000 actions outside business hours"
    When a Cowork session at 3:42 AM logs 1247 actions in a 90-second window
    Then within 60 seconds the Activity Monitor surfaces an anomaly card
    And the card shows: actor, source, action count, time, suggested action
    And the card offers "Revoke this user's session" (one-click)
    And the action invokes the platform-specific admin API (Anthropic,
      Microsoft, OpenAI, Workato — whichever applies)

  Scenario: Anomaly alerts route to existing security tools
    Given the org admin has configured a Slack channel destination + a SIEM endpoint
    When an anomaly fires
    Then the same OCSF event is delivered to:
      | destination | format                 |
      | Slack       | slack-formatted card   |
      | SIEM        | OCSF JSON over HTTP    |
      | webhook     | OCSF JSON              |
      | PagerDuty   | events-v2 payload      |
    And the destination set is configurable per anomaly severity
    And LangWatch never becomes the system of record — it forwards to
      the customer's existing security tooling

  Scenario: Admin one-click revoke when an anomaly fires on a closed platform
    Given an anomaly fires on a Cowork agent's session
    When the admin clicks "Revoke session"
    Then LangWatch calls Anthropic's Admin API (Compliance Platform)
    And the workspace key for that user is revoked synchronously
    And subsequent gateway calls from that key return 401 vk_revoked
    And the action is recorded in the admin audit log with outcome
    And per gateway.md, this is the "near-real-time kill" tier — not
      mid-flight blocking (which only applies to LangWatch-proxied keys)

  Scenario: Backend keeps ingesting even when UI is gated off
    Given a customer org doesn't have the governance preview flag enabled
    When their IngestionSources still receive events (OTel pushes / S3 drops / pulled audits)
    Then events are normalized + persisted as usual
    And the org's data is preserved for the moment they flip the flag
    And no client-visible Activity Monitor surface renders
    And this matches @rchaves's gating contract: backend stays open

  Scenario: Tenant isolation — admin sees only their own org's activity
    Given two orgs (acme-corp, beta-co) both ingest events
    When acme-corp's admin queries the Activity Monitor
    Then they see only events with TenantId resolving to an
      acme-corp-owned project
    And beta-co's events are invisible (multi-tenancy guard at the
      ClickHouse query layer)

  Scenario: Self-host deployment retains the same UX
    Given a self-hoster running LangWatch via the umbrella helm chart
    When their admin navigates to /settings/activity-monitor
    Then the UI renders identically to cloud
    And they can configure IngestionSources locally
    And the Activity Monitor scales with their existing CH cluster
    And no extra infrastructure is required beyond the umbrella chart
