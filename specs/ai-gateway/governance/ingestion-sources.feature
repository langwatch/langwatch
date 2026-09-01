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
    When the admin navigates to "/governance/inventory?tab=sources"
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

  Rule: A conversation source names the project its conversations land in

    Some sources pull conversations, not counts. Those conversations can
    be read in the trace explorer, but only once an admin says which
    project they land in — the source ships with no destination and
    routes nothing until then.

    The choice carries three consequences the admin cannot discover any
    other way, so the drawer states all three where the choice is made:
    the destination project's own redaction policy governs what is
    stored; only conversations from the last 31 days arrive, so a thread
    that started earlier shows only its recent turns; and a destination
    that is later archived or deleted stops receiving conversations
    instead of failing the source or landing them elsewhere.

    Sources that pull counts rather than conversations are offered no
    destination at all — a control that changed nothing would be worse
    than its absence.

    @integration
    Scenario: The composer of a conversation source offers a destination
      When the admin picks "Databricks AI/BI Genie" from the Add source menu
      Then the composer offers a picker for the project its conversations
        land in, listing only projects of this organization
      And the picker starts empty, because where another team's
        conversations become readable is never a default

    @integration
    Scenario: The destination states its three consequences where it is picked
      Given the admin is composing a "Databricks AI/BI Genie" source
      When they pick a destination project
      Then the drawer says the destination project's data-privacy policy
        governs what is stored
      And it says conversations from the last 31 days arrive, and that a
        conversation that started earlier shows only its recent turns
      And it says a destination that is archived or deleted stops
        receiving conversations

    @integration
    Scenario: A source created without a destination routes nothing
      When the admin creates a "Databricks AI/BI Genie" source without
        picking a destination
      Then the source is created
      And the drawer said, before saving, that its conversations would
        not be readable in the explorer until a destination is set

    @integration
    Scenario: The edit drawer changes a destination and says history stays
      Given a "Databricks AI/BI Genie" source already lands in "Analytics"
      When the admin opens the source for editing
      Then the destination picker shows "Analytics"
      And the drawer says conversations already routed stay where they are
      When they change it to "Support" and save
      Then the update carries "Support" as the destination

    @integration
    Scenario: A source that pulls counts is offered no destination
      When the admin composes an "Anthropic Admin API (usage & cost)" source,
        which pulls usage totals rather than conversations
      Then no destination picker appears in the drawer
      And the same is true when editing it

    @integration
    Scenario: An archived destination is named as archived, not as absent
      Given a "Databricks AI/BI Genie" source lands in a project that has
        since been archived
      When the admin opens the source for editing
      Then the drawer says that destination is archived and that
        conversations are no longer being routed there
      And it still offers the picker, so the admin can repoint the source
        rather than being told routing stopped and given no way to restart it
      And the picker being empty does not read as "never configured",
        because the archived destination is named right above it
      When they pick "Support" as the replacement destination
      Then the picker shows "Support"
      And the archived warning is gone, because it described the destination
        they have just replaced rather than the one now on screen

    @integration
    Scenario: A destination the admin cannot see is not called archived
      Given a "Databricks AI/BI Genie" source lands in a live project that
        belongs to a team this admin is not on
      When the admin opens the source for editing
      Then the drawer does not say that destination is archived, so nobody
        is sent to restore a project that was never gone

    @unit
    Scenario: The picker cannot offer a project of another organization
      When the admin opens the destination picker
      Then it lists only live projects of this organization
      And a destination outside it, reaching the API by any other route,
        is refused at write time with the destination named as the reason

  Rule: A source routes only the events it recognises as its own conversations

    The destination picker is offered only to sources that carry
    conversations, but the destination itself is an ordinary stored
    setting, and nothing at the moment it is written checks what kind of
    source it was written on. So the run cannot treat the picker as the
    only way a destination arrives. It decides for itself, per source,
    which of that source's events are conversations, and routes nothing
    else.

    This is what keeps a source that pulls counts from turning billing
    rows into readable conversations if a destination reaches it by some
    other route. Such a source has no conversation events at all, so the
    honest outcome is that nothing is routed — not that its totals are
    rendered as though someone had said them.

    Each source also names the agent that answered, and states which
    source the conversation came from. Both travel with the conversation
    rather than being assumed, because a second source reusing the first
    one's labels would file its conversations under a product the
    customer does not have.

    The agent name is an identity, not a model anyone is billed for, and
    a source may only name an agent from the set the platform knows. It
    cannot supply the name of a real model, because a name that matched
    a price would put a charge on a conversation nobody was charged for.

    @unit
    Scenario: A counts-pulling source with a destination still routes nothing
      Given an "Anthropic Admin API (usage & cost)" source has a
        destination project stored on it, which its own drawer never
        offered and nothing on the way in refused
      When a run pulls its usage and cost totals
      Then nothing is routed to that project, because none of those
        totals is a conversation

    @unit
    Scenario: A run routes only the events belonging to its own source
      Given a "Databricks AI/BI Genie" source lands in "Analytics"
      When a run hands over both its questions and events belonging to
        another kind of source
      Then only the Genie questions reach "Analytics"

    The shape a source routes by — which of its events are conversations,
    the agent that answered, where they came from, and the name of the batch
    they arrive in — is supplied per source rather than being Genie's
    constants. Genie is the only source that supplies one today, so no other
    source routes anything in production; what the scenario below fixes is
    that the shape is the source's own and is never inherited, which is what
    a second source will rely on when it arrives.

    Not everything is per-source yet: the individual conversation spans still
    carry Genie's own names and labels whatever the source. That is invisible
    while Genie is the only source routing, and it is what the second source
    has to finish before its conversations can be told apart from Genie's.

    @unit
    Scenario: The conversation shape travels with the source, not with Genie
      Given a second source that supplies its own conversation shape: which
        of its events are conversations, the agent that answered, and where
        they came from
      When a batch is routed by that shape
      Then each conversation names that source as where it came from, and
        that source's agent as what answered — neither of them Genie's
      And a Genie question handed to that shape is not one of its
        conversations, so nothing is routed for it

    @unit
    Scenario: A source cannot name a real model as its agent
      When a source is set up to route conversations
      Then the agent it names must be one the platform already knows
      And a real model's name cannot be used as an agent name, so no
        routed conversation can be given a price by naming one

  @unit
  Scenario: The configured-source list groups under the same two headings
    Given configured sources of push, pull, and s3 modes exist
    When the admin views the list
    Then push-mode sources appear under "Real-time streams"
    And pull-mode and s3-mode sources appear together under "Synced on a schedule"

  # ---------------------------------------------------------------------------
  # Source list — table layout, icons, and protocol column — #7617
  # ---------------------------------------------------------------------------

  @integration @source-list
  Scenario: Each source row shows the vendor icon next to the name
    Given configured sources of different types exist
    When the admin views the source list
    Then each row displays the SourceTypeIconGlyph for its source type
    And the icon sits to the left of the source name

  @integration @source-list
  Scenario: Each source row shows its delivery protocol
    Given configured sources of push, pull, and s3 modes exist
    When the admin views the source list
    Then push sources show the protocol label "OTel push"
    And pull sources show the protocol label "API pull"
    And s3 sources show the protocol label "S3 pull"

  @integration @source-list @pull-source
  Scenario: The rotate-secret button is hidden for non-push sources on the list
    Given a pull-mode source exists
    And a push-mode source exists
    When the admin views the source list
    Then the push source row shows a "Rotate secret" action
    And the pull source row does not show a "Rotate secret" action

  @integration @source-detail @pull-source
  Scenario: The rotate-secret button is hidden for non-push sources on the detail page
    Given a pull-mode source exists
    When the admin opens that source's detail page
    Then the page does not show a "Rotate secret" action
    And the Edit and Archive actions remain available

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
