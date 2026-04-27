Feature: IngestionSource — admin configuration of cross-platform feeds
  An IngestionSource is the configuration unit that connects a closed
  SaaS platform's audit / OTel / S3 stream to LangWatch's Activity
  Monitor. One source = one platform fleet (e.g. "Miro Cowork" or
  "Acme Workato production"). The admin configures the connection
  once per platform; the runtime then ingests events on whatever
  cadence the source supports (push for OTel/webhook/S3, pull for
  poll-based admin APIs).

  This spec covers the user-facing CRUD + the per-source-type setup
  forms. The protocol-level contract (event schema, auth) lives in
  activity-monitor.feature and architecture.md.

  Background:
    Given the org admin is signed in as a member of "acme-corp"
    And the governance preview flag is enabled for acme-corp
    And the admin has organization:manage permission

  Scenario: Admin lands on the IngestionSources index
    When the admin navigates to "/settings/ingestion-sources"
    Then a list shows every configured source with: name, source type,
      ingestion mode (push/pull/s3), last event timestamp, status
    And each row links to a per-source detail page with health metrics
    And the page has an "Add source" button surfacing all supported types

  Scenario Outline: Admin adds a source by type
    When the admin clicks "Add source"
    And they pick "<source_type>"
    Then a setup form prompts them for "<required_fields>"
    And the form explains where each field comes from (with deep links
      to the upstream platform's admin docs)
    And on save the source goes to status="awaiting first event"
    And the form generates the secrets / URLs the admin must paste
      into the upstream platform (e.g. an OTLP URL + bearer token)

    Examples:
      | source_type        | required_fields                                              |
      | otel_generic       | display name, ingestSecret (auto-generated), expected SourceType label |
      | claude_cowork      | display name, OTLP URL hint (read-only), bearer token (auto-generated) |
      | workato            | display name, webhook receiver URL (auto-generated), shared secret    |
      | copilot_studio     | display name, Azure tenant id, app client id, app client secret, polling cadence |
      | openai_compliance  | display name, S3 bucket / prefix, AWS role ARN, polling cadence              |
      | claude_compliance  | display name, workspace API key, polling cadence                              |
      | s3_custom          | display name, bucket / prefix, role ARN, parser DSL                           |

  Scenario: Generic OTel passthrough is the simplest setup
    Given the admin picks "Generic OTel" as the source type
    When they enter "Cowork desktop fleet" as the display name
    And submit the form
    Then LangWatch generates an `ingestSecret` token + an OTLP URL like
      `https://<host>/api/ingest/otel/<sourceId>`
    And the admin sees a one-step instruction: "paste these into
      Anthropic Admin Console → Cowork → Telemetry"
    And once the upstream platform begins pushing, events appear in the
      Activity Monitor within 30 seconds

  Scenario: S3 audit log source with custom parser DSL
    Given a customer's homegrown agent system writes audit logs to S3
    When the admin picks "S3 audit (custom)"
    And they configure: bucket, prefix, role ARN, polling cadence
    And they paste a parser DSL describing how to map log lines to OCSF
      ActivityEvent fields (actor, action, target, timestamp, …)
    Then LangWatch validates the DSL against a sample line they upload
    And the source goes live on the admin's selected cadence
    And errors during parse are surfaced in the source's health page
    And no parse errors silently drop events — they're queued for retry

  Scenario: Per-source detail page shows health
    When the admin clicks an IngestionSource in the index
    Then they see:
      | metric                                                |
      | events ingested in last 24h / 7d / 30d                |
      | parse error rate                                      |
      | last successful poll/push timestamp                   |
      | upstream connection status                            |
      | "Send test event" button (push/webhook sources)       |
      | "Run poll now" button (pull sources)                  |
      | last 50 events ingested with raw + normalised side-by-side |
    And from this page the admin can rotate the ingestSecret atomically

  Scenario: ingestSecret rotation
    When the admin clicks "Rotate secret"
    Then LangWatch generates a new secret without invalidating the old one
    And both secrets are accepted for a 24h grace window
    And after 24h the old secret is auto-invalidated
    And the upstream operator gets a clear paste-this-in instruction for the new value

  Scenario: Disabled source stops ingesting but preserves history
    When the admin clicks "Disable" on a source
    Then no new events are ingested from that source
    And historical events are NOT deleted
    And re-enabling resumes ingestion seamlessly
    And the source can be permanently deleted via a separate destroy action

  Scenario: Tenant isolation — sources are scoped to one org
    Given two orgs (acme-corp, beta-co) both have configured sources
    When acme-corp's admin lists ingestion sources
    Then only acme-corp's sources are visible
    And the per-source `ingestSecret` only authenticates against acme-corp's
      ingestion endpoint
    And cross-org event delivery is rejected with 403

  Scenario: Source deletion cascades correctly
    Given an IngestionSource has produced 50,000 historical events
    When the admin destroys the source
    Then a confirmation modal warns: "this deletes the source config but
      keeps 50,000 historical events readable in the Activity Monitor"
    And on confirm only the source row is deleted
    And historical events stay readable (TenantId-scoped) until manual purge
    And new events from the upstream operator's old config are rejected with 401
