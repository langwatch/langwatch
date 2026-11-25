Feature: LangWatchQL works on a default install with no LangWatchQL settings

  Dashboards, the LangWatchQL workbench and Instant Evals query through a
  restricted ClickHouse identity and a PostgreSQL reader role. Their two
  passwords used to come only from LWQL_CLICKHOUSE_PASSWORD and
  LWQL_POSTGRES_READER_PASSWORD, which only the Helm chart, haven and the
  hosted deployment set. A contributor running `pnpm dev` or a self-hoster on
  docker compose got every chart refused with "no restricted identity is
  provisioned".

  When neither password is set, the app derives both from its key pepper (the
  first of API_KEY_PEPPER, CREDENTIALS_SECRET and NEXTAUTH_SECRET that is set),
  one HMAC-SHA256 per password, so the upgrade task and every app and worker
  process arrive at the same values with nothing stored. Nothing renders
  ClickHouse config files on those installs, so the derived path provisions the
  access model with SQL DDL unless LWQL_ACCESS_MODEL_MODE says otherwise. A
  Helm install keeps the chart as the only source: the chart hands both
  passwords when `lwql.enabled` is on, and leaving them out is how an operator
  turns LangWatchQL off.

  @unit
  Scenario: With no LangWatchQL passwords set, both are derived from the key pepper in SQL mode
    Given LWQL_CLICKHOUSE_PASSWORD and LWQL_POSTGRES_READER_PASSWORD are unset
    And CREDENTIALS_SECRET is set
    When the LangWatchQL credentials are resolved
    Then both passwords are derived from CREDENTIALS_SECRET and differ from each other
    And the access model mode is "sql"

  @unit
  Scenario: The derived passwords are the same in every process
    Given two processes with the same key pepper and no LangWatchQL passwords
    When each resolves the LangWatchQL credentials
    Then both resolve the same two passwords
    And a different key pepper resolves different passwords

  @unit
  Scenario: The key pepper is the first of API_KEY_PEPPER, CREDENTIALS_SECRET and NEXTAUTH_SECRET that is set
    Given API_KEY_PEPPER is empty, CREDENTIALS_SECRET is unset and NEXTAUTH_SECRET is set
    When the LangWatchQL credentials are resolved
    Then the passwords are derived from NEXTAUTH_SECRET

  @unit
  Scenario: A derived install signs in as one restricted user per ClickHouse database
    Given no LangWatchQL password is set and CLICKHOUSE_URL names the database "langwatch_dev"
    When the LangWatchQL credentials are resolved
    Then the restricted user is "langwatch_dev_lwql"
    And CLICKHOUSE_URL naming "langwatch" gives "langwatch_lwql"
    And an explicit LWQL_CLICKHOUSE_USER is kept

  @unit
  Scenario: Explicit LangWatchQL passwords are used as given
    Given LWQL_CLICKHOUSE_PASSWORD and LWQL_POSTGRES_READER_PASSWORD are set
    When the LangWatchQL credentials are resolved
    Then the explicit passwords are used
    And the access model mode is whatever LWQL_ACCESS_MODEL_MODE says

  @unit
  Scenario: One explicit password and one missing stays partially configured
    Given only LWQL_CLICKHOUSE_PASSWORD is set
    When the LangWatchQL credentials are resolved
    Then nothing is derived and the reader password stays missing

  @unit
  Scenario: A Helm install derives nothing
    Given INSTALL_METHOD is "helm" and no LangWatchQL password is set
    When the LangWatchQL credentials are resolved
    Then no password is derived and LangWatchQL stays off

  @unit
  Scenario: An explicit access model mode wins over the derived default
    Given no LangWatchQL password is set and LWQL_ACCESS_MODEL_MODE is "rendered"
    When the LangWatchQL credentials are resolved
    Then the passwords are derived and the access model mode is "rendered"

  @unit
  Scenario: With no key pepper at all, nothing is derived
    Given no LangWatchQL password and no key pepper is set
    When the LangWatchQL credentials are resolved
    Then no password is derived and LangWatchQL stays off

  @integration
  Scenario: The upgrade task provisions a queryable restricted identity from CLICKHOUSE_URL, DATABASE_URL and the key pepper alone
    Given a ClickHouse database and a PostgreSQL database with no LangWatchQL objects
    And an environment with only CLICKHOUSE_URL, DATABASE_URL and CREDENTIALS_SECRET
    When the LangWatchQL provisioning task runs
    Then the restricted identity signs in with the derived password
    And it can read a LangWatchQL view

  @integration
  Scenario: The upgrade task derives from the key pepper the secrets chain resolves
    Given an environment that sets CREDENTIALS_SECRET
    And a secrets chain that also answers API_KEY_PEPPER from another source, such as a .env file
    When the LangWatchQL provisioning task runs
    Then the passwords are derived from API_KEY_PEPPER, as the api and worker derive them
    And a password derived from CREDENTIALS_SECRET is refused
