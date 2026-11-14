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

  # The shipped views carry no SQL SECURITY clause, so on 26.8 a view's push checks the inserter's
  # SELECT on the columns it reads. Until that is decided (ADR-202 Decided 12), the writer's insert
  # into a table that feeds a view is refused after its source row is stored.
  @integration
  Scenario: A view that checks the inserter refuses the writer's push by name
    Given ClickHouse 26.8 with the shipped migrations and the writer provisioned
    When the writer inserts into "gateway_budget_ledger_events" or "dspy_steps"
    Then ClickHouse refuses each with ACCESS_DENIED while pushing to a view
    And the source row is stored while every view it feeds misses it

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
