Feature: The ClickHouse client sends reads as the app reader and everything else as the system

  As the LangWatch platform reading and writing tenant rows in ClickHouse
  I want each read sent as the app reader with its tenant set, and every other statement as the system
  So that the reader's row policies bound every application read, and only a process holding the
  system credential can write, mutate or skip the tenant check

  ADR-202 slice 2 (Decided 1, 2, 3, 6, 8, 12). The reader's users, profile and row policies are
  slice 1 (specs/clickhouse/app-reader-row-policies.feature). A process that holds no reader
  credential sends every statement on its one credential, as before, and sends no tenant setting;
  the cutover of the api to reader-only follows the move of its inserts to the worker (Decided 12).

  # ---------------------------------------------------------------------------
  # The tenant setting
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A read sent as the app reader carries its declared tenant set as a request setting
    Given a client holding the app reader and the system identity
    When a read declares the tenant set "project_a" and "project_b"
    Then it is sent on the app reader with "SQL_langwatch_tenant_ids" set to "project_a,project_b"
    And the statement text it sends is the caller's, unchanged

  @unit
  Scenario: A read with one tenant carries that tenant alone
    Given a client holding the app reader and the system identity
    When a read for tenant "project_a" declares no tenant set
    Then it is sent on the app reader with "SQL_langwatch_tenant_ids" set to "project_a"

  @unit
  Scenario: A read with no tenant set is refused before it is sent
    Given a client holding the app reader and the system identity
    When a read names an empty tenant, or declares an empty tenant set or one with an empty id
    Then it is refused with a tenant setting error of kind "missing-tenant-set"
    And no driver receives it

  @unit
  Scenario: A tenant id carrying the setting's separator is refused
    Given a client holding the app reader and the system identity
    When a read declares a tenant id containing a comma
    Then it is refused with a tenant setting error of kind "tenant-id-separator"
    And no driver receives it

  @unit
  Scenario: Statement text naming the setting prefix is refused on every identity
    Given a client holding the app reader and the system identity
    When a read, a skip-check read or a command names "SQL_langwatch_" in its text, in any case
    Then it is refused with a tenant setting error of kind "setting-in-text"
    And no driver receives it

  @unit
  Scenario: A caller's own tenant setting is refused unless it is the client's
    Given a client holding the app reader and the system identity
    When a read carries a "SQL_langwatch_" request setting other than its own tenant set
    Then it is refused with a tenant setting error of kind "setting-supplied"
    But a read carrying exactly the tenant set the client computes is sent on the app reader

  # ---------------------------------------------------------------------------
  # Which identity sends what
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Skip-check statements, commands and inserts are sent as the system
    Given a client holding the app reader and the system identity
    When it runs a "SKIP_TENANT_CHECK" read, a skip-check stream, a command and an insert
    Then each is sent on the system identity
    And none carries "SQL_langwatch_tenant_ids"

  @unit
  Scenario: A reader-only process refuses inserts, commands and skip-check statements by name
    Given a client holding only the app reader
    When it is asked for an insert, a command or a "SKIP_TENANT_CHECK" read
    Then each is refused with "SystemIdentityAbsentError" naming the operation and the table
    And no driver receives it
    But a tenant read is still sent on the app reader

  @unit
  Scenario: A process holding only its one credential reads as before
    Given a client holding only the system identity
    When a tenant read runs
    Then it is sent on that identity without "SQL_langwatch_tenant_ids"
    But a read with no tenant set is still refused before it is sent

  @unit
  Scenario: A client with no identity at all is refused at construction
    Given no driver for either identity
    Then building the client fails, naming both identities

  # ---------------------------------------------------------------------------
  # Statements the typed builder built
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A built reader statement is sent on the reader with its own settings
    Given a client holding the app reader and the system identity
    When it reads a statement the typed builder built for the tenant set "project_a" and "project_b"
    Then it is sent on the app reader with the statement's settings as built
    And it is routed by the statement's route tenant and declares the statement's tenant set

  @unit
  Scenario: A built statement whose tenant setting is not its tenant set is refused
    Given a client holding the app reader and the system identity
    When a built reader statement carries no tenant setting, or one other than its tenant set
    Then it is refused with a tenant setting error of kind "setting-mismatch"
    And no driver receives it

  @unit
  Scenario: A braided built read is cut to its proof's expiry
    Given a built reader statement whose proof expires in thirty seconds
    When the client reads it
    Then its "max_execution_time" is at most the proof's remaining whole seconds
    But once the proof has expired it is refused before it is sent

  @unit
  Scenario: A built all-tenants statement is sent as the system
    Given a statement built under an all-tenants scope
    When the client reads it
    Then it is sent on the system identity with its settings and no tenant setting
    But a reader-only process refuses it with "SystemIdentityAbsentError"

  @unit
  Scenario: A built system-table read is sent as the system, routed by tenant or organisation
    Given an all-tenants read of system.mutations, whose commands name other tenants
    When the worker's client reads it with a tenant route, or for an organisation's server
    Then it is sent on the system identity with that route and no tenant setting
    But the api's client, holding no system credential, refuses it with "clickhouse_system_identity_absent" and sends nothing

  @unit
  Scenario: A server-metadata statement naming system.mutations is refused before it is sent
    Given a metadata statement whose text names system.mutations
    When the client reads it
    Then it is refused with "clickhouse_metadata_table_refused" and neither identity receives it

  @unit
  Scenario: A server-metadata read routes by organisation
    Given a server-metadata read and an organisation id
    When the client reads it
    Then the reader receives it routed to that organisation, with no tenant setting

  # ---------------------------------------------------------------------------
  # Shadow sampling (ADR-202 rollout step 3)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A sampled reader read is re-run as a count under the enforcing identity
    Given a client holding the app reader and a shadow sampler over the enforcing reader
    When a reader read is sampled
    Then "SELECT count()" over the same statement is sent on the enforcing reader with its params and tenant setting
    And when that count differs from the rows returned, the divergence is reported with the table
    But when the counts agree nothing is reported

  @unit
  Scenario: The shadow sampler is off by default and never touches the read it samples
    Given a shadow sample rate of 0, or a statement sent as the system
    When the client reads
    Then nothing is re-run
    And a re-run that fails is reported by table while the sampled read still answers its rows

  @unit
  Scenario: A shadow sample rate outside 0 to 1 is refused at construction
    Given a shadow sample rate below 0, above 1 or not a number
    When the sampler is constructed
    Then it is refused with a range error

  @unit
  Scenario: The stores re-run sampled reads on the enforcing reader and count a divergence by table
    Given "CLICKHOUSE_SHADOW_SAMPLE_RATE" above 0 and "CLICKHOUSE_ENFORCING_READER_URL" set
    When a tenant read answers on the reader with more rows than the enforcing count
    Then the count re-run is sent on the enforcing reader with the read's tenant setting
    And "clickhouse_shadow_divergence_total" counts it by table
    And the system identity receives nothing

  @unit
  Scenario: The shadow sampler is off unless a rate and the enforcing reader are configured
    Given "CLICKHOUSE_SHADOW_SAMPLE_RATE" unset, which reads as 0, or no "CLICKHOUSE_ENFORCING_READER_URL"
    When a tenant read answers on the reader
    Then nothing is sent to the enforcing reader

  @unit
  Scenario: A shadow sample rate outside 0 to 1 is refused at boot
    Given "CLICKHOUSE_SHADOW_SAMPLE_RATE" set to 5
    When the stores' configuration is parsed
    Then it is refused naming "CLICKHOUSE_SHADOW_SAMPLE_RATE"

  @unit
  Scenario: The shadow sampler never re-runs a private organisation's read on the shared server
    Given the shadow sampler on and an organisation routed to its own server
    When that organisation's read answers on its reader route
    Then nothing is sent to the enforcing reader on the shared server
    And no re-run failure is counted for it

  # ---------------------------------------------------------------------------
  # Configuration
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The reader's credentials are their own variables beside the system's
    Given "CLICKHOUSE_READER_URL" and "CLICKHOUSE_READER_URL__<label>__<orgId>" variables
    When the stores read their configuration
    Then the shared reader URL and each organisation's reader route are parsed from them
    And "CLICKHOUSE_URL" and its private routes keep their meaning

  @unit
  Scenario: A private route with no reader credential refuses its organisation's reads by name
    Given a process holding a reader credential
    And an organisation routed to its own server with a system route and no reader route
    When a read for one of its tenants is sent
    Then it is refused as "private_dataplane_unavailable" naming the missing reader variable
    And it never falls back to the shared server or the system identity

  @unit
  Scenario: A private route with no system credential refuses its organisation's system statements by name
    Given a process holding both identities
    And an organisation routed to its own server with a reader route and no system route
    When a skip-check statement naming that organisation is sent
    Then it is refused as "private_dataplane_unavailable" naming the missing system variable
    And it never falls back to the shared server

  @unit
  Scenario: A statement naming an organisation whose route is unusable is refused, never shared
    Given an organisation whose route variable is malformed, or present for the other identity only
    When a read or an insert names that organisation explicitly
    Then it is refused naming the variable and whether it is "malformed" or "missing"
    And the shared server receives nothing

  @unit
  Scenario: A process configured with only reader credentials builds a reader-only client
    Given "CLICKHOUSE_READER_URL" set and no "CLICKHOUSE_URL"
    When the stores build the ClickHouse client
    Then tenant reads are sent on the reader
    And inserts are refused with the handled error "clickhouse_system_identity_absent", a platform fault

  @unit
  Scenario: The api's eventing checks no event-log index, so it sends no skip-check statement
    Given the api's producer eventing over a client holding only the reader
    When its stores build the eventing member
    Then it sends no statement that skips the tenant check
    And a draining role over the same client checks the index, which the api no longer sends

  # Distribution (ADR-202 slice 4, Decided 4 and 6): the upgrade walks every server the router knows.

  @unit
  Scenario: An install that sets no reader credential provisions no reader and upgrades as before
    Given no "CLICKHOUSE_READER_URL" and no "CLICKHOUSE_READER_URL__<label>__<orgId>" variable
    When "pnpm task upgrade lwql-provision" runs
    Then it opens no ClickHouse connection for the reader
    And the upgrade completes as it did before the reader existed

  @unit
  Scenario: The upgrade provisions the app reader in shadow on the shared server
    Given "CLICKHOUSE_URL" and "CLICKHOUSE_READER_URL" set, in sql mode
    When "pnpm task upgrade lwql-provision" runs
    Then "langwatch_app_reader" is created with the hash of the password its reader URL carries
    And its profile pins "SQL_langwatch_tenancy_enforce" to 0
    And with "CLICKHOUSE_ENFORCING_READER_URL" set, "langwatch_app_reader_enforcing" is created with it pinned to 1

  @unit
  Scenario: The upgrade provisions the app reader on every routed server, as goose reaches them
    Given a "CLICKHOUSE_URL__<label>__<orgId>" route with its "CLICKHOUSE_READER_URL__<label>__<orgId>" route
    When "pnpm task upgrade lwql-provision" runs
    Then the reader is created on that server in sql mode, on the database its route names
    And the shared server in rendered mode is left to its rendered access config
    And the enforcing reader is created on the shared server only

  @unit
  Scenario: A routed server without the reader is named, and the client refuses its reader reads by that name
    Given a process holding the reader and a "CLICKHOUSE_URL__<label>__<orgId>" route with no reader route
    When "pnpm task upgrade lwql-provision" runs
    Then nothing is provisioned on that server
    And the upgrade warns naming "CLICKHOUSE_READER_URL__<label>__<orgId>", the variable the client refuses its reads by

  @unit
  Scenario: A server the upgrade cannot reach is named by the variable to set
    Given a reader route with no system route, or two organisations on one server with different reader passwords
    When the upgrade plans its walk
    Then each server it cannot provision is named with the variable that would let it
    And no reader login on a shared server is replaced by another organisation's

  @unit
  Scenario: A routed server the reader cannot be provisioned on fails the upgrade by name
    Given a routed server on a cluster without replicated access storage
    When the upgrade's reconciler runs "lwql-provision"
    Then no reader statement runs on that server and the other servers are still provisioned
    And the run fails naming the organisation

  # The enforce switch (ADR-202 Rollout 4, Decided 4): off by default, read per server.

  @unit
  Scenario: The upgrade enforces the reader's tenant set where its server's switch is on
    Given "CLICKHOUSE_TENANCY_ENFORCE", or a route's "CLICKHOUSE_TENANCY_ENFORCE__<label>__<orgId>", set to true
    When "pnpm task upgrade lwql-provision" runs
    Then the reader on that server pins "SQL_langwatch_tenancy_enforce" to 1
    And every server whose switch is unset keeps it pinned to 0

  @unit
  Scenario: An enforce switch the upgrade cannot read is named, and its server is not provisioned
    Given an enforce switch set to neither true nor false, or two organisations on one server with different switches
    When the upgrade plans its walk
    Then that server is named with the switch's variable
    And no reader is created or replaced there

  @unit
  Scenario: The rendered access config carries the app reader beside LangWatchQL
    Given the LangWatchQL inputs and "CLICKHOUSE_READER_URL" set
    When "lwql-render-access-config" renders the users.d file
    Then it carries "langwatch_app_reader" with its password's hash, never the password
    And its profile pins "SQL_langwatch_tenancy_enforce" to what "CLICKHOUSE_TENANCY_ENFORCE" names, 0 when unset
    And with "CLICKHOUSE_ENFORCING_READER_URL" set, it carries "langwatch_app_reader_enforcing" too

  @unit
  Scenario: The rendered access config refuses an unreadable enforce switch by name
    Given "CLICKHOUSE_READER_URL" set and "CLICKHOUSE_TENANCY_ENFORCE" set to neither true nor false
    When "lwql-render-access-config" runs
    Then it fails naming "CLICKHOUSE_TENANCY_ENFORCE" and writes no file

  # The chart (ADR-202 Decided 4): the reader stays off until the clickhouse-serverless image declares SQL_.

  @integration
  Scenario: A chart install that sets no reader value renders as before
    Given the chart's default values
    When the chart renders
    Then no workload carries "CLICKHOUSE_READER_URL", "CLICKHOUSE_ENFORCING_READER_URL" or "CLICKHOUSE_TENANCY_ENFORCE"
    And no app reader Secret is rendered

  @integration
  Scenario: The chart provisions and wires the app reader when it is enabled
    Given "clickhouse.appReader.enabled" set on chart-managed ClickHouse
    When the chart renders
    Then a hook Secret holds the reader's password before the access-render Job runs
    And the app, the workers and the access-render Job read "CLICKHOUSE_READER_URL" built from it
    And "clickhouse.appReader.shadowSampleRate" above 0 adds the enforcing reader's URL and the sample rate
    And "clickhouse.appReader.enforce" sets "CLICKHOUSE_TENANCY_ENFORCE"

  @integration
  Scenario: The app reader reads the three server-metadata tables on 26.8 and no other system table
    Given ClickHouse 26.8 with the app reader provisioned
    When the reader reads system.columns, system.replicas and system.server_settings with no tenant setting
    Then each answers
    And system.query_log, system.processes and system.mutations are refused as access denied

  # The readers without LangWatchQL (ADR-202 Decided 6): the render Job delivers them on their own.

  @unit
  Scenario: The rendered access config carries the app reader while LangWatchQL is off
    Given "CLICKHOUSE_READER_URL" set and no LangWatchQL password
    When "lwql-render-access-config" renders
    Then users.d carries "langwatch_app_reader" and no LangWatchQL user
    And config.d is an empty document

  # The cross-tenant ops credential (ADR-202 Decided 14): Ops reads run in the worker, so only it holds the URL.

  @integration
  Scenario: The chart gives CLICKHOUSE_OPS_URL to the worker and never to the api
    Given "CLICKHOUSE_OPS_URL" set in "app.extraEnvs"
    When the chart renders
    Then the workers container carries it, and so does the worker sidecar with "workers.enabled" off
    And the api container does not, while keeping its other extraEnvs
