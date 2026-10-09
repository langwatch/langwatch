Feature: LangWatchQL access model — one typed definition, two emitters, two delivery modes

  As a LangWatch operator running SaaS on many ClickHouse replicas, the self-hosted
  chart, or a bring-your-own ClickHouse
  I want the LangWatchQL access model defined once in the app and delivered either as
  rendered per-pod config or as SQL DDL
  So that every replica carries the same user, profile, grants and row policies, no
  second copy of the model can drift, and no secret or statement text ever leaks.

  Issue: #8258 (langwatch/tasks#889). The app owns the model; #8261 replaces the
  hand-vendored SaaS catalog and the deleted Go renderer (infra/clickhouse-serverless
  render/lwql*). This feature covers the app half: the shared definition, the DDL and
  users.d emitters, the render task, the mode switch, the sql-mode cluster guard, and
  the logging rule.

  # ---------------------------------------------------------------------------
  # AC6 — single source of truth: one definition, both emitters agree
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The DDL emitter and the users.d emitter name the same user, profile, settings and constraints
    Given the shared LangWatchQL access-model definition for a deployment
    When the SQL DDL emitter and the users.d YAML emitter both render it
    Then both name the same restricted user with the same sha256 password hash
    And both declare the same settings profile with the same settings and constraints

  @unit
  Scenario: The DDL emitter and the users.d emitter grant the same objects
    Given the shared LangWatchQL access-model definition for a deployment
    When the SQL DDL emitter and the users.d YAML emitter both render it
    Then the set of granted objects and their columns is identical between the two

  @unit
  Scenario: The DDL emitter and the users.d emitter carry the same row policies and predicates
    Given the shared LangWatchQL access-model definition for a deployment
    When the SQL DDL emitter and the users.d YAML emitter both render it
    Then both bind the key-map self filter and a per-source-table tenant predicate to the same tables with the same expressions

  @unit
  Scenario: The named collection fields are identical between the two emitters
    Given the shared LangWatchQL access-model definition for a deployment
    When the SQL DDL emitter and the config.d YAML emitter both render the named collection
    Then both name the same collection with the same host, port, database, user and password fields

  @unit
  Scenario: The DDL emitter renders the whole access model from the shared definition
    Given the shared access-model definition for fixed inputs
    When the SQL DDL emitter renders the access model and named collection from it
    Then it is the single source of the access DDL, identifies the user by sha256 hash never the plaintext, and orders every row policy before every grant

  # ---------------------------------------------------------------------------
  # DoD line 4 — the render task
  # ---------------------------------------------------------------------------

  @unit
  Scenario: renderLwqlAccessConfig writes exactly the users.d and config.d files
    Given the LangWatchQL environment is fully configured
    When the renderLwqlAccessConfig task runs with an output directory
    Then it writes users.d/lwql-access.yaml and config.d/lwql-named-collection.yaml under that directory and nothing else

  @unit
  Scenario: renderLwqlAccessConfig fails with a named error when an input is missing
    Given the LangWatchQL environment is missing a required input
    When the renderLwqlAccessConfig task runs
    Then it exits non-zero with a named error and writes no files

  @unit
  Scenario: renderLwqlAccessConfig never prints file contents or secrets
    Given the LangWatchQL environment is fully configured
    When the renderLwqlAccessConfig task runs
    Then no log line or output contains the password, the sha256 hash, or the rendered file contents

  # ---------------------------------------------------------------------------
  # AC5 — safe, secure, minimal: the logging rule
  # ---------------------------------------------------------------------------

  @unit
  Scenario: No provisioning log line or thrown error contains SQL statement text
    Given a provisioning step logs progress or fails
    When its log line or thrown error is inspected
    Then it names the statement kind, the ClickHouse error code, and the secret length only, never the statement text, a password, or a rendered file

  # ---------------------------------------------------------------------------
  # DoD line 4 — LWQL_ACCESS_MODEL_MODE=rendered|sql, default rendered
  # ---------------------------------------------------------------------------

  @unit
  Scenario: In rendered mode the converge skips every access statement
    Given LWQL_ACCESS_MODEL_MODE is unset or "rendered"
    When the ClickHouse converge runs
    Then it still provisions the database, key-map table, app functions, views and postgres-engine tables
    But it skips the restricted user, the settings profile, every grant, both row policies and the named collection

  @unit
  Scenario: In rendered mode the server does not arm the reconvergence watch
    Given LWQL_ACCESS_MODEL_MODE is unset or "rendered"
    When the app server starts
    Then it does not arm the LangWatchQL reconvergence watch

  @unit
  Scenario: In sql mode the converge runs the full DDL access path
    Given LWQL_ACCESS_MODEL_MODE is "sql"
    When the ClickHouse converge runs
    Then it runs the restricted user, settings profile, grants, row policies and named-collection statements

  # ---------------------------------------------------------------------------
  # AC9 — sql mode is fail-closed on clusters
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A single-node target passes the sql-mode cluster guard
    Given sql mode on a server that belongs to no multi-host cluster
    When the sql-mode cluster guard runs
    Then it passes and provisioning continues

  @unit
  Scenario: A multi-host cluster without replicated access storage aborts sql-mode provisioning
    Given sql mode on a server in a cluster with more than one host and no replicated user directory
    When the sql-mode cluster guard runs
    Then it aborts with a named error and logs the host and directory counts only

  @unit
  Scenario: A multi-host cluster with replicated access storage passes the sql-mode cluster guard
    Given sql mode on a server in a multi-host cluster with a replicated user directory
    When the sql-mode cluster guard runs
    Then it passes and provisioning continues

  @unit
  Scenario: The sql-mode cluster guard is bypassed by the single-node override
    Given sql mode with LWQL_ACCESS_MODEL_SQL_SINGLE_NODE set to "true"
    When the sql-mode cluster guard runs
    Then it passes regardless of the cluster topology

  # ---------------------------------------------------------------------------
  # AC10 — reconciliation is fail-closed and never leaks the password
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A failed access-model reconciliation aborts the deploy without leaking the password
    Given the self-provisioned ClickHouse access model whose DDL embeds the restricted user's password
    When reconciling it fails and the error echoes that DDL
    Then the deploy is aborted rather than continuing with the executor available
    And the password and the admin connection string are redacted from anything logged or re-thrown
