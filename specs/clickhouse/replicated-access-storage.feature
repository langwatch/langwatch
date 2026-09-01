Feature: Chart-managed ClickHouse owns the LangWatchQL access model

  As a LangWatch operator
  I want a chart-managed ClickHouse to render the LangWatchQL access model as config
  So that no SQL-created access entities exist, no keeper-backed access store is
  needed, and the AC8 dual-directory defect class cannot occur

  # Design C, issue langwatch-saas#1168: whoever owns the ClickHouse server owns
  # the access model. A chart-managed server renders the restricted user, its
  # profile, grants, tenant row filters and the lwql_postgres named collection as
  # config re-read at every boot — never as SQL-created entities in a
  # keeper-backed directory. The app self-provisions only for external ClickHouse.

  Background:
    Given the ClickHouse config renderer is initialized

  @unit
  Scenario Outline: Access management stays enabled in <mode> mode
    Given the ClickHouse config renderer runs in <mode> mode
    When it writes the server configuration
    Then the admin user can create access entities and named collections through SQL
    And the custom settings prefix is declared

    Examples:
      | mode       |
      | standalone |
      | replicated |

  @unit
  Scenario: Standalone mode writes no keeper-backed storage configuration
    Given the ClickHouse config renderer runs in standalone mode
    When it writes the server configuration
    Then neither the user-directories file nor the named-collections-storage file is written

  @unit
  Scenario: No keeper-backed access or named-collection store is written in any mode
    Given the ClickHouse config renderer runs in standalone mode and in replicated mode
    When it writes the server configuration
    Then no user-directories file is written in either mode
    And no named-collections-storage file is written in either mode

  @unit
  Scenario: No LangWatchQL config is written without a mounted password
    Given the ClickHouse config renderer runs with no LangWatchQL password mounted
    When it writes the server configuration
    Then no LangWatchQL user or profile config is written

  @unit
  Scenario: A chart-managed server renders the LangWatchQL access model as config
    Given the ClickHouse config renderer runs with the LangWatchQL password mounted
    When it writes the server configuration
    Then the langwatch_lwql user and lwql_restricted profile are rendered as config
    And each source table carries the tenant row filter and each view carries a SELECT grant
    And only the hashed LangWatchQL password is written, never the plaintext

  @unit
  Scenario: The lwql_postgres bridge is omitted without its PostgreSQL password
    Given the ClickHouse config renderer runs with the LangWatchQL password but no PostgreSQL reader password
    When it writes the server configuration
    Then the lwql_postgres named collection is omitted

  @e2e
  Scenario: No replica carries a keeper-backed access or named-collection store
    Given a clustered chart-managed ClickHouse with three replicas
    Then every replica reports ready
    And no replica's merged server configuration carries a replace-mode user directory, the keeper access path, or a keeper-backed named-collections store
