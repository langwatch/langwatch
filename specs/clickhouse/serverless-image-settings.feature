Feature: The clickhouse-serverless image renders every server setting from env
  The image's config renderer is the only writer of the files it names in
  config.d and users.d. Each tunable setting has one env var with a default,
  so a deployment runs the public image by setting env and mounting extra
  files, never by patching the image. Every default keeps the behaviour of the
  image before these settings existed; new behaviour is opt-in. The upgrade
  pins are not tunables: they hold 25.10 behaviour until a release lifts them.

  @unit
  Scenario: ClickHouse 26.8 keeps the 25.10 behaviour and on-disk formats
    Given the image runs ClickHouse 26.8
    When the renderer writes the server configuration
    Then the default profile sets compatibility to 25.10 and keeps backward-compatible insert deduplication
    And a bare JSON integer into DateTime64 is read as its raw value, not as seconds
    And parts, indexes and statistics are written in formats 25.10 can read
    And the metric names and the static memory hard limit stay as they were on 25.10

  @unit
  Scenario: A deployment that still sets CACHE_MAX_SIZE is told it is no longer read
    Given CACHE_MAX_SIZE is set
    When the renderer writes the server configuration
    Then the renderer logs a warning naming CACHE_MAX_SIZE
    And without CACHE_MAX_SIZE it logs no such warning

  @unit
  Scenario: Server and profile settings render their defaults
    Given no env var sets them
    When the renderer writes the server configuration
    Then the default profile sets no network compression method or level, leaving the ClickHouse default
    And the default profile does not set read-only HTTP query cancellation, leaving the ClickHouse default
    And SELECT queries get no admission cap of their own
    And no byte cap is set on a merge block

  @unit
  Scenario: Each server and profile setting follows its env var
    Given env vars set the merge block byte cap, the SELECT admission cap, the network compression method and level, and HTTP read cancellation
    When the renderer writes the server configuration
    Then each setting carries the value its env var gave

  @unit
  Scenario: Pool-entry thresholds follow an overridden background pool size
    Given BACKGROUND_POOL_SIZE overrides the pool size computed from CPU
    When the renderer writes the server configuration
    Then each free-entry threshold not set by its own env var is derived from the overridden pool size
    And a threshold set by its own env var keeps that value

  @unit
  Scenario: Interserver credentials are rendered only from a password file
    Given CLICKHOUSE_INTERSERVER_PASSWORD_FILE names a mounted secret
    When the renderer writes the server configuration
    Then replicas authenticate part fetches with CLICKHOUSE_INTERSERVER_USER and that password
    And a later run without the password file removes the credentials it wrote

  @unit
  Scenario: The server keeps its log files unless console-only logging is asked for
    Given LOG_TO_FILE is not set
    When the renderer writes the server configuration
    Then the image's file and error-file loggers are kept
    And with LOG_TO_FILE=false they are removed, so the server logs to the console only

  @unit
  Scenario: The cluster secret is applied only when asked for
    Given a replicated server with CLICKHOUSE_CLUSTER_SECRET_FILE set
    And CLICKHOUSE_CLUSTER_SECRET_ENABLED is not set
    When the configuration is loaded and rendered
    Then the secret file is not read, so an empty or missing one fails nothing
    And remote_servers renders the secret as it did before, which ClickHouse ignores
    And the renderer logs a warning naming CLICKHOUSE_CLUSTER_SECRET_ENABLED
    And with CLICKHOUSE_CLUSTER_SECRET_ENABLED=true remote_servers carries the secret's value

  @unit
  Scenario: The cluster secret opt-in needs a secret file
    Given CLICKHOUSE_CLUSTER_SECRET_ENABLED is true
    And CLICKHOUSE_CLUSTER_SECRET_FILE is not set
    When the configuration is validated
    Then validation fails naming CLICKHOUSE_CLUSTER_SECRET_FILE

  @unit
  Scenario: The default user can be left without access management
    Given DEFAULT_USER_ACCESS_MANAGEMENT is false
    When the renderer writes the server configuration
    Then no file it writes grants the default user access_management or named_collection_control

  @unit
  Scenario: Files a deployment mounts next to the rendered ones are left alone
    Given a deployment has mounted its own files into config.d and users.d
    When the renderer writes the server configuration, with optional files on and then off
    Then every mounted file is still there, unchanged

  @unit
  Scenario: Initialisation scripts and CLICKHOUSE_DB still log in as default
    Given the default user's password comes from CLICKHOUSE_PASSWORD or CLICKHOUSE_PASSWORD_FILE
    And /docker-entrypoint-initdb.d holds a script or CLICKHOUSE_DB is set
    When the entrypoint hands over to the official ClickHouse entrypoint
    Then that entrypoint skips its own default-user setup, so the renderer's default user stands
    And it receives the password in CLICKHOUSE_PASSWORD, so its initialisation client can log in
    And CLICKHOUSE_PASSWORD_FILE is unset
    And with neither initialisation input present CLICKHOUSE_PASSWORD is unset too
