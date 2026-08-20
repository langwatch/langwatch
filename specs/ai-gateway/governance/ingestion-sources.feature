Feature: IngestionSource — admin configuration of cross-platform feeds
  An IngestionSource is the configuration unit that connects a closed
  SaaS platform's audit / OTel / S3 stream to LangWatch's Activity
  Monitor. One source = one platform fleet (e.g. "Acme Cowork" or
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
    And the admin has governance:view permission
    And the admin has ingestionSources:manage permission

  Scenario: Admin lands on the IngestionSources index
    When the admin navigates to "/governance/catalog"
    Then a list shows every configured source with: name, source type,
      last event timestamp, status
    And each row links to a per-source detail page with health metrics
    And the page has an "Add source" button surfacing all supported types

  @integration
  Scenario: Add source menu lists every type by vendor, grouped in plain language
    When the admin clicks "Add source"
    Then a menu opens listing every supported source type with its vendor logo
    And the types sit under exactly two group headings: "Real-time streams"
      for sources that send events to LangWatch as they happen, and
      "Synced on a schedule" for sources LangWatch fetches on a cadence,
      including cloud-storage audit drops
    And no group heading shows the internal mode words push, pull, or s3
    And menu items no longer carry a technical mode suffix such as "· push"
      (a service name inside a type's own label, like "Custom S3 audit log",
      is not a mode word)

  @integration
  Scenario: Non-enterprise plans see locked source types they cannot pick
    Given the org is on a non-enterprise plan
    When the admin opens the "Add source" menu
    Then every source type beyond Generic OpenTelemetry is visible but locked
    And each locked entry says it needs an Enterprise plan
    And picking a locked entry does not open the composer

  @unit
  Scenario: The composer and the menu share one plan gate
    Given the org is on a non-enterprise plan
    Then the only source type the gate allows is Generic OpenTelemetry
    And the gate never locks Generic OpenTelemetry on any plan
    And both the Add source menu and the composer derive from that one gate,
      so a locked type is unreachable through either

  @integration
  Scenario: Picking a type opens the composer committed to it
    When the admin picks "Databricks AI/BI Genie" from the Add source menu
    Then the composer opens showing the Databricks logo and name as a fixed header
    And the composer offers no source-type dropdown
    And the composer starts from a blank configuration for the picked type,
      even when a different type was being composed moments before

  Rule: The Genie composer leads with the credential that survives a schedule

    Databricks expires pasted workspace tokens about an hour after issuing
    them, so a token-backed scheduled source dies by the next morning. The
    service principal (client id + secret) signs itself in at the start of
    every run. The form therefore presents client id + secret as the way
    in, and demotes the token — together with the tuning fields most
    admins never touch — into a collapsed "Advanced" group.

    @integration
    Scenario: Genie setup asks for the service principal first
      When the admin picks "Databricks AI/BI Genie" from the Add source menu
      Then the form asks for the workspace URL, the service principal
        client ID, and the service principal secret, in that order
      And the workspace token, Genie space IDs, and SQL warehouse ID
        are not visible until the admin expands "Advanced"

    @integration
    Scenario: Advanced options stay collapsed and never block create
      When the admin fills a display name, the workspace URL, client ID,
        and secret, leaving "Advanced" closed
      Then the source can be created
      And the create request carries an empty space list, which the
        space IDs hint explains covers every space the credential can see

    @unit
    Scenario: Field hints name their fields instead of pointing at them
      Then every Genie field hint that mentions another field names it,
        and none locates one as "above" or "below"

  Rule: Every scheduled source states its cadence in plain language

    The raw five-field cron input assumed the admin speaks cron. The
    composer instead offers a "Cadence" section with a friendly picker;
    cron editing remains behind an explicit toggle for the admins who
    want it.

    @integration
    Scenario: The Cadence section opens on a friendly picker, prefilled
      When the admin composes any pull-mode source
      Then a section titled "Cadence" shows a frequency picker, not a
        cron text box
      And the picker arrives prefilled with that source's recommended
        schedule (for example "every 15 minutes")
      And a sentence below states the chosen schedule in plain words

    @unit
    Scenario: The picker speaks every recommended schedule
      Then each pull source's recommended schedule round-trips through
        the friendly picker without falling back to cron editing

    @integration
    Scenario: Leaving the cadence untouched keeps the recommended schedule
      When the admin creates a pull-mode source without touching Cadence
      Then the create request carries that source's recommended schedule
        (a saved schedule of "none" would mean the source never runs)

    @integration
    Scenario: Picking a cadence saves exactly that schedule
      When the admin changes the cadence to hourly
      Then the create request carries the matching schedule everywhere
        the schedule travels, including inside the source's pull settings
      And the summary sentence updates to say so

    @integration
    Scenario: Cron editing is still there for schedules the picker cannot say
      When the admin turns on "Edit as a cron expression"
      And types a cron the friendly picker cannot express
      Then the value is kept as typed, not clobbered by picker defaults
      And a cron that can never run shows a plain-language message next
        to the input, and the create button refuses until it is fixed

  @unit
  Scenario: The configured-source list groups under the same two headings
    Given configured sources of push, pull, and s3 modes exist
    When the admin views the list
    Then push-mode sources appear under "Real-time streams"
    And pull-mode and s3-mode sources appear together under "Synced on a schedule"

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
      | a paginated table of ingested events, newest first    |
    And from this page the admin can rotate the ingestSecret atomically

  Rule: The events table pages through everything the source ever ingested

    Every event the source ever ingested is reachable, not just the
    newest batch. The admin walks pages newest-first; nothing is known
    about how many events exist in total, so the pager promises only
    what it can honour: pages already visited plus the next one, and no
    grand-total line. Order is fixed at newest-first, and there are no
    sort headers and no search box — either would only act on the page
    in hand and quietly lie about the rest.

    Two honesty boundaries the scenarios below pin down: events stamped
    on the same millisecond are never lost to a page cut, up to one
    fetch's worth per millisecond, past which the walk moves on rather
    than looping; and pages once seen do not change — walking back
    shows exactly the rows the admin came from, even while new events
    keep arriving.

    @integration
    Scenario: Events render as a table, newest first
      Given a source has ingested events
      When the admin opens the source's detail page
      Then the events appear as table rows, newest first
      And each row shows when it happened, its type, who acted,
        the action, its target, its cost and its token usage
      And the time reads relatively, with the exact timestamp on hover

    @integration
    Scenario: The table pages through more events than fit at once
      Given a source has ingested more events than one page holds
      When the admin moves to the next page
      Then the following, older events are listed
      And moving back returns to the exact rows they came from,
        re-read from what was already loaded, not from the server

    @integration
    Scenario: Changing rows-per-page starts over from the first page
      Given the admin is a few pages into the events table
      When they pick a different rows-per-page size
      Then the table returns to the first page at the new size

    @integration
    Scenario: A row opens into raw + normalised detail
      When the admin clicks an event row
      Then the row expands to show the normalised event
      And for a pulled event, the raw payload as ingested sits beside it
      And for a pushed event, whose raw body is never stored, the raw
        panel says so instead of sitting silently empty
      And clicking again folds the detail away

    @integration
    Scenario: Events sharing a timestamp are not lost at a page boundary
      Given several events were stamped with the same millisecond
      And fewer of them than the server's single-fetch maximum
      And they straddle a page boundary
      When the admin walks from one page to the next
      Then every one of the tied events appears on exactly one page

    @integration
    Scenario: A failed load is an error, never an empty list
      Given the events request fails
      When the admin views the events section
      Then they see an error message
      And they do NOT see the "no events yet" setup walkthrough

    @integration
    Scenario: The pager offers no control it cannot honour
      When the admin looks at the events table
      Then there are no sortable column headers and no search box
      And the pager shows no grand total of events
      And only visited pages and the immediate next page can be opened

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
