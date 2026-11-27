Feature: The clickhouse-serverless image renders every server setting from env
  The image's config renderer is the only writer of the files it names in
  config.d and users.d. Each tunable setting has one env var with a default,
  so a deployment runs the public image by setting env and mounting extra
  files, never by patching the image. Every default keeps the behaviour of the
  image before these settings existed; new behaviour is opt-in. The pins that
  hold 25.10 behaviour on 26.8 are not tunables: they are fixed in the image
  until a later image lifts them.

  @unit
  Scenario: The image holds 25.10 behaviour on ClickHouse 26.8
    Given the image runs ClickHouse 26.8
    When the renderer writes the server configuration
    Then the on-disk format settings keep the formats 25.10 reads, so a rollback to the previous image still reads every part
    And per-disk asynchronous metrics keep their 25.10 names
    And the hard memory limit stays at the server memory cap
    And the default profile sets compatibility to 25.10 and keeps insert deduplication as 25.10 had it
    And a bare integer into DateTime64 still reads as epoch milliseconds

  @unit
  Scenario: The chart's Keeper writes snapshots that 25.10 reads
    Given a replicated chart whose Keeper runs this image on ClickHouse 26.8
    When the Keeper configuration is rendered
    Then it holds write_snapshot_version at 6, so a rollback to 25.10 still loads its snapshots

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
    Then the default user's access_management and named_collection_control are set to 0
    And the stock users.xml grant of both no longer applies

  @unit
  Scenario: Rendered mode keeps the default user to the LangWatchQL collections
    Given LWQL_ACCESS_DIR names a mounted LangWatchQL access model
    When the renderer writes the server configuration
    Then the default user cannot create users, roles or row policies
    And it cannot create, alter or drop a named collection
    And it can use and list only the collections named lwql_postgres or lwql_postgres_<database>

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
    And it receives the password file in CLICKHOUSE_PASSWORD_FILE, which it reads without exporting
    And only a file padded with whitespace, which the renderer trims, goes in CLICKHOUSE_PASSWORD instead
    And with neither initialisation input present CLICKHOUSE_PASSWORD is unset too

  @unit
  Scenario: An install that names its own CLICKHOUSE_USER keeps that login
    Given CLICKHOUSE_USER names a user other than default and the server is not dynamic-only
    And its password comes from CLICKHOUSE_PASSWORD_FILE
    When the entrypoint hands over to the official ClickHouse entrypoint
    Then that entrypoint runs its own user setup and creates that user, as before this image
    And it reads the password from the file, so the server's environment never holds it

  @unit
  Scenario: The LangWatchQL access model is linked from a directory mount
    Given LWQL_ACCESS_DIR names a directory holding lwql-access.yaml and lwql-named-collection.yaml
    When the renderer writes the server configuration
    Then users.d/lwql-access.yaml and config.d/lwql-named-collection.yaml are links into that directory
    And a file updated in that directory is read through its link with nothing rendered again

  @unit
  Scenario: A missing LangWatchQL access file stops the server starting
    Given LWQL_ACCESS_DIR names a directory missing one of the two files
    When the renderer writes the server configuration
    Then rendering fails naming LWQL_ACCESS_DIR

  @unit
  Scenario: Without LWQL_ACCESS_DIR a mounted access file is left alone
    Given LWQL_ACCESS_DIR is not set and nothing is mounted at /etc/clickhouse-server/lwql
    And users.d holds a mounted lwql-access.yaml and config.d a link an earlier boot made
    When the renderer writes the server configuration
    Then the mounted file is unchanged and the stale link is removed

  @unit
  Scenario: The image finds the access model at the conventional directory with no env
    Given LWQL_ACCESS_DIR is not set
    And the access model is mounted at /etc/clickhouse-server/lwql
    When the renderer loads its configuration
    Then it links the access model from that directory, as if LWQL_ACCESS_DIR named it

  @unit
  Scenario: The image reads the replica and shard names an older image read
    Given CH_REPLICA and CH_SHARD are not set
    And REPLICA_NAME and SHARD_NAME are
    When the renderer loads its configuration
    Then the replica and shard take the older names' values
    And CH_REPLICA and CH_SHARD win over the older names when both are set

  @unit
  Scenario: Every default system log can be given the system log TTL
    Given SYSTEM_LOG_TTL_ALL is true
    When the renderer writes the server configuration
    Then error_log, crash_log and the query detail logs it keeps expire after SYSTEM_LOG_TTL_DAYS
    And backup_log gets no TTL, because the backup sidecar finds a backup's base there
    And without SYSTEM_LOG_TTL_ALL none of them gets a TTL

  @integration
  Scenario: A real ClickHouse gives the default user access DDL only in sql mode
    Given the image runs once with a mounted LangWatchQL model, once without, and once opted out
    When the default user creates engine tables, users and named collections
    Then with the model mounted it uses only the lwql_postgres collections and every access DDL is refused
    And without the model it creates users and named collections
    And opted out it can create neither, though the stock users.xml grants both

  @unit
  Scenario: An explicit opt-in keeps the default user's access DDL in rendered mode
    Given LWQL_ACCESS_DIR names a mounted LangWatchQL access model
    And DEFAULT_USER_ACCESS_MANAGEMENT is true
    When the renderer writes the server configuration
    Then the default user keeps access_management and named_collection_control

  @unit
  Scenario: The default user's networks fail closed
    Given CLICKHOUSE_DEFAULT_NETWORKS lists networks
    When the renderer writes the server configuration
    Then the default user may log in only from loopback and those networks
    And a CLICKHOUSE_DEFAULT_NETWORKS that is set but names no network stops the server starting

  @unit @e2e
  Scenario: A masked setting's value never reaches a log
    Given CLICKHOUSE_MASKED_SETTINGS is unset, so the LangWatchQL capability setting is masked
    And a user whose profile turns log_query_settings off, on a server with query-log auditing on
    When the user sends the capability in a SETTINGS clause, spelt plainly, with a quoted name, a comment, an escaped quote or a heredoc, and as an HTTP URL parameter
    Then neither the server log file, system.text_log, nor system.query_log's query or Settings holds its value
    And an unmasked setting in the same query does appear in each of those logs
    And a sha256-shaped value folded into a filter, as the query condition cache logs it at Debug, is hidden too
    And a list in CLICKHOUSE_MASKED_SETTINGS replaces the default, an empty one masks nothing, and CLICKHOUSE_MASK_SHA256_HEX=false drops the sha256 rule

  @unit
  Scenario: Query-log auditing and a per-user query share are opt-in
    Given CLICKHOUSE_AUDIT_QUERY_LOG is true and CLICKHOUSE_MAX_CONCURRENT_QUERIES_FOR_USER is set
    When the renderer writes the server configuration
    Then the default profile pins the six query-log settings that decide whether a query is logged, as const
    And log_query_settings is left to each user's profile
    And every user gets that share of the server's admission limit, which a session may lower but never raise or set to 0
    And without either, the profile carries neither
