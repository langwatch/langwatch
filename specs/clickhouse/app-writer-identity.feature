Feature: The api sends its three ClickHouse inserts as an insert-only writer

  As the LangWatch platform serving api requests that write a few rows to ClickHouse
  I want those inserts sent as langwatch_app_writer, a user that may insert into three tables only
  So that the api boots with the reader and the writer credentials and never holds one that can
  read every tenant, write any other table or skip the tenant check

  ADR-202 Decided 12 (rewritten 2026-11-14) and 14. The api keeps three inserts: the governance OTLP
  spend debit (gateway_budget_ledger_events), `POST /api/dspy/log_steps` (dspy_steps) and the
  instant-eval run create (instant_eval_runs). A process holding the system credential (the worker,
  the tasks app) keeps inserting as the system; the writer is used only where the system is absent.
  The reader is specs/clickhouse/app-reader-identity.feature.

  # ---------------------------------------------------------------------------
  # Which identity an insert leaves on
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An insert in a process holding the reader and the writer is sent as the writer
    Given a client holding the app reader and the writer, and no system identity
    When an insert into "dspy_steps" is sent
    Then it is sent on the writer
    And no statement is sent on the reader

  @unit
  Scenario: A process holding the system identity keeps sending its inserts as the system
    Given a client holding the system identity, the app reader and the writer
    When an insert into "dspy_steps" is sent
    Then it is sent on the system identity
    And no statement is sent on the writer

  @unit
  Scenario: The writer never sends a read, a command or a statement that skips the tenant check
    Given a client holding the app reader and the writer, and no system identity
    When a read that skips the tenant check, a command and a tenant read are sent
    Then the skip-check read and the command are refused as "clickhouse_system_identity_absent"
    And the tenant read is sent on the app reader
    And no statement is sent on the writer

  @unit
  Scenario: An insert in a process holding neither the system nor the writer is refused by name
    Given a client holding the app reader alone
    When an insert into "dspy_steps" is sent
    Then it is refused as "clickhouse_system_identity_absent", naming the insert and the table
    And nothing is sent

  # ---------------------------------------------------------------------------
  # The credential, and routed organisations
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The writer's credential is read from CLICKHOUSE_WRITER_URL and its route family
    Given CLICKHOUSE_WRITER_URL and "CLICKHOUSE_WRITER_URL__eu__org_1" are set
    When the stores resolve their ClickHouse identities
    Then the writer holds the shared server and the route for "org_1"

  @unit
  Scenario: An organisation routed for the system or the reader but not the writer refuses its inserts
    Given a process holding CLICKHOUSE_WRITER_URL and "CLICKHOUSE_READER_URL__eu__org_1", with no writer route for "org_1"
    When the stores resolve the writer
    Then an insert for "org_1" is refused by the variable "CLICKHOUSE_WRITER_URL__eu__org_1"
    And it is never sent to the shared server's writer

  @unit
  Scenario: A process holding the system identity connects no writer
    Given CLICKHOUSE_URL, CLICKHOUSE_READER_URL and CLICKHOUSE_WRITER_URL are set
    When the stores build the ClickHouse client
    Then the client is given no writer, so every insert goes as the system

  @unit
  Scenario: The api's stores boot with the reader and the writer credentials alone
    Given a role's stores over a client holding the reader and the writer, and no system identity
    When the api's producer eventing is built and an insert is sent
    Then no statement skips the tenant check
    And the insert is sent on the writer

  # ---------------------------------------------------------------------------
  # The writer's users, grants and policies
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The writer holds INSERT on the three api tables and no SELECT grant
    Given the access model is built with the writer's credential hash
    When the writer identity is rendered as SQL
    Then it grants INSERT on "gateway_budget_ledger_events", "dspy_steps" and "instant_eval_runs" alone
    And it grants SELECT on nothing
    And it hides system.user_query_log from the writer with a policy admitting no row

  @unit
  Scenario: Both emitters render the same writer
    Given the access model is built with the writer's credential hash
    When it is rendered as SQL and as users.d
    Then both name the user "langwatch_app_writer", its profile and the same three INSERT grants

  @unit
  Scenario: Provisioning walks the writer to every server the reader is provisioned on
    Given CLICKHOUSE_WRITER_URL and a writer route for "org_1" beside the reader's
    When the upgrade plans the app identities' walk
    Then the shared server and "org_1" are provisioned with the writer's credential hash

  @unit
  Scenario: A routed server without the writer's credential is named, and its reader still provisioned
    Given CLICKHOUSE_WRITER_URL is set and "org_1" has a reader route but no writer route
    When the upgrade plans the app identities' walk
    Then "org_1" is provisioned with the reader alone
    And the walk names "org_1" as unprovisioned by "CLICKHOUSE_WRITER_URL__eu__org_1"

  @unit
  Scenario: A writer credential with no reader credential is named, never provisioned alone
    Given CLICKHOUSE_WRITER_URL is set and CLICKHOUSE_READER_URL is not
    When the upgrade plans the app identities' walk
    Then the shared server is named as unprovisioned by "CLICKHOUSE_READER_URL"

  # ---------------------------------------------------------------------------
  # On ClickHouse 26.8
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The writer's insert into a table that feeds no view is stored
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    When the writer inserts one row into "instant_eval_runs", as one statement and as an async insert
    Then each row is stored

  # ADR-202 Decided 16: a view with no SQL SECURITY checks the inserter's SELECT on the columns it
  # reads, and refuses the push with ACCESS_DENIED after the source row is stored. Migrations 00132
  # and 00133 set the three views the writer's tables feed to SQL SECURITY DEFINER, the definer being
  # the user the migration ran as.
  @integration
  Scenario: The writer's insert fills every view its table feeds
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    When the writer inserts into "gateway_budget_ledger_events" or "dspy_steps", as one statement and as an async insert
    Then the source row is stored
    And every view that table feeds holds the row
    And each such view runs as SQL SECURITY DEFINER with the migrating user as its definer

  # The definer is a dependency of every insert into those tables: the operator note is the chart
  # README's "bring your own ClickHouse" rows (keep the user that runs the upgrade).
  @integration
  Scenario: ClickHouse refuses to drop a user a view runs as
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    And "dspy_steps_id_index_mv" runs as a user of its own
    When an operator drops that user
    Then ClickHouse refuses it with HAVE_DEPENDENT_OBJECTS, naming the view

  @integration
  Scenario: A definer without the grants fails the writer's insert by code
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    And "dspy_steps_id_index_mv" runs as a user holding no grant
    When the writer inserts into "dspy_steps"
    Then ClickHouse refuses it with ACCESS_DENIED
    And no row is stored

  @integration
  Scenario: A definer renamed away fails the writer's insert by code
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    And the user "dspy_steps_id_index_mv" runs as has been renamed
    When the writer inserts into "dspy_steps"
    Then ClickHouse refuses it with UNKNOWN_USER
    And no row is stored

  @unit
  Scenario: Every view a writer table feeds runs as its definer
    Given the shipped ClickHouse migrations replayed in order
    When a materialised view reads from one of the writer's tables
    Then its last definition carries SQL SECURITY DEFINER, or a later migration sets it
    And a view created again without it fails the guard by name

  @integration
  Scenario: The writer may not read, even the tables it inserts into
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    When the writer selects from "dspy_steps" or from system.query_log
    Then ClickHouse refuses each with ACCESS_DENIED

  @integration
  Scenario: The writer may not insert into any other table
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    When the writer inserts into "stored_spans"
    Then ClickHouse refuses it with ACCESS_DENIED

  # ---------------------------------------------------------------------------
  # The chart
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A chart install that sets no writer value renders as before
    Given the LangWatch chart with the app reader on and clickhouse.appWriter unset
    When it renders
    Then no workload carries CLICKHOUSE_WRITER_URL
    And no app writer Secret is rendered

  @unit
  Scenario: The chart provisions and wires the app writer when it is enabled
    Given the LangWatch chart with clickhouse.appReader.enabled and clickhouse.appWriter.enabled
    When it renders, with LangWatchQL on or off
    Then a pre-install, pre-upgrade and pre-rollback hook Secret holds langwatch_app_writer's URL on the chart's ClickHouse
    And the app, the workers and the access-render Job read CLICKHOUSE_WRITER_URL from it
    And with secrets.existingSecret set they read it from that Secret, and the chart generates none

  @unit
  Scenario: The chart refuses the app writer without the app reader
    Given the LangWatch chart with clickhouse.appWriter.enabled and the app reader off
    When it renders
    Then the render fails naming clickhouse.appReader.enabled
