Feature: Chart-managed ClickHouse renders no LangWatchQL access model

  As a LangWatch operator
  I want a chart-managed ClickHouse to render none of the LangWatchQL access model
  So that the application owns it on every distribution, SQL access management
  stays enabled for the boot-time convergence, and no keeper-backed access store
  is needed

  # Issue #8258 / ADR-141: the application owns the LangWatchQL access model on
  # every distribution and converges it at boot over SQL. The chart-managed
  # server therefore renders none of it — no restricted user, profile, grants,
  # tenant row filters or lwql_postgres named collection — and instead keeps SQL
  # access management and named_collection_control enabled so the app's
  # convergence can create those entities, with no keeper-backed access
  # directory. The chart's only LangWatchQL job is to wire the password Secret.

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

  @e2e
  Scenario: No replica carries a keeper-backed access or named-collection store
    Given a clustered chart-managed ClickHouse with three replicas
    Then every replica reports ready
    And no replica's merged server configuration carries a replace-mode user directory, the keeper access path, or a keeper-backed named-collections store

  # The password the app queries as langwatch_lwql with must be read from the
  # very Secret the ClickHouse pod mounts to CREATE that user — the parent's
  # langwatch.clickhouse.lwqlSecretName and the subchart's
  # clickhouse-serverless.lwqlSecretName must resolve to one name. These are
  # verified by rendering the chart in charts/langwatch/tests/lwql-connection-env.sh.
  @e2e
  Scenario: The app reads the LangWatchQL password from the Secret the ClickHouse pod mounts
    Given a chart-managed ClickHouse install
    When the chart is rendered
    Then the Secret the app reads the LangWatchQL password from is the Secret the ClickHouse pod mounts to create the langwatch_lwql user

  @e2e
  Scenario: The two LWQL Secret names stay identical on a release name longer than 36 characters
    Given a chart-managed ClickHouse install whose release name is longer than 36 characters
    When the chart is rendered
    Then the app and the ClickHouse pod still name the same LangWatchQL Secret
    And emptying the ClickHouse credentials Secret name never yields two disagreeing names without failing the render

  # The chart default is autogen.enabled=false: the operator owns the ClickHouse
  # credentials Secret, so the chart materialises none, yet the app must still
  # point at the operator's Secret by name.
  @e2e
  Scenario: With autogen off the chart renders no ClickHouse credentials Secret but the app still names the operator Secret
    Given a chart-managed ClickHouse install with automatic secret generation disabled
    And the operator supplies the ClickHouse credentials Secret name
    When the chart is rendered
    Then no chart-managed ClickHouse credentials Secret is rendered
    And the app reads its LangWatchQL password from the operator-provided Secret
