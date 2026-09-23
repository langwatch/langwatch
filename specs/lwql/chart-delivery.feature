Feature: LangWatchQL access-model delivery to every chart-managed ClickHouse replica

  Issue #8258 (epic tasks#889). The application owns the LangWatchQL access
  model once, in code. On chart-managed ClickHouse the model is DELIVERED to
  every replica as rendered `users.d` / `config.d` files carried in a Kubernetes
  Secret, not provisioned by SQL DDL against the one pod behind the Service.

  A deploy-time Job runs the application image, renders the two files
  (`renderLwqlAccessConfig`), and writes them into the Secret
  `<release>-lwql-clickhouse-access`. Every ClickHouse pod mounts that Secret at
  `/etc/clickhouse-server/users.d/lwql-access.yaml` and
  `/etc/clickhouse-server/config.d/lwql-named-collection.yaml`, so the restricted
  identity, its profile, grants, both row policies and the PostgreSQL named
  collection land in the `users_xml` store of every replica — install, upgrade,
  scale-up or disk rebuild alike, with no per-pod app action.

  SQL DDL is kept only for bring-your-own ClickHouse (`LWQL_ACCESS_MODEL_MODE=sql`),
  where the chart cannot write the server's config files. See ADR-141.

  # ── AC7: existing patterns, no new machinery ──────────────────────────────

  @e2e
  Scenario: The access model is delivered by one Job into one Secret, mounted once per pod
    Given the chart is rendered with chart-managed ClickHouse and lwql.enabled
    Then a pre-install and pre-upgrade hook Job runs the application image and renders the access files
    And the Job's ServiceAccount may only create the access Secret and get, update or patch it by name
    And every ClickHouse pod mounts the access Secret at the users.d and config.d paths
    And no chart template renders any part of the access model itself

  @e2e
  Scenario: The rendered access file never carries the password or any statement text
    Given the delivery Job has written the access Secret
    Then the Secret carries only the password_sha256_hex of the LangWatchQL identity, never the password
    And no Job log line, thrown error or rendered file is emitted to the Job's output

  # ── AC3: every replica carries the whole access set ───────────────────────

  @e2e
  Scenario: Every replica of a three-replica deployment carries the whole access set
    Given the chart is installed with chart-managed ClickHouse at three replicas
    When the ClickHouse pods are ready
    Then each pod reports the restricted identity in the users_xml store
    And each pod reports its settings profile, both row policies and the PostgreSQL named collection
    And a tenant-filtered query through the ClusterIP Service succeeds no matter which pod answers

  @e2e
  Scenario: A pod added by scaling up carries the access set with no application action
    Given a three-replica chart-managed ClickHouse deployment is running
    When the deployment is scaled to four replicas
    Then the new pod reports the restricted identity in the users_xml store with no application action

  @e2e
  Scenario: A chart upgrade that changes the access model rolls every ClickHouse pod
    Given the chart is rendered at one release version and then at the next
    Then the ClickHouse pod template's access-model annotation differs between the two renders

  # ── Rendered is the chart default; sql mode is opt-in for BYO ──────────────

  @e2e
  Scenario: Chart-managed ClickHouse leaves the access-model mode at its rendered default
    Given the chart is rendered with chart-managed ClickHouse
    Then the application deployment sets no LWQL_ACCESS_MODEL_MODE, so the app renders rather than runs DDL

  @e2e
  Scenario: The external-ClickHouse overlay selects sql mode
    Given the chart is rendered with the clickhouse-external overlay
    Then the application deployment sets LWQL_ACCESS_MODEL_MODE to sql
    And it acknowledges single-node scope with LWQL_ACCESS_MODEL_SQL_SINGLE_NODE
