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
  where the chart cannot write the server's config files. See ADR-142.

  # ── AC7: existing patterns, no new machinery ──────────────────────────────

  @e2e
  Scenario: The access model is delivered by one Job into one Secret, mounted once per pod
    Given the chart is rendered with chart-managed ClickHouse and lwql.enabled
    Then a deploy-time Job runs the application image and renders the access files
    And the Job's ServiceAccount may only create the access Secret and get, update or patch it by name
    And every ClickHouse pod mounts the access Secret at the users.d and config.d paths
    And no chart template renders any part of the access model itself

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

  @e2e
  Scenario: A first upgrade from a pre-LWQL release provisions the access model on every pod
    Given a chart-managed release with no render RBAC and no LangWatchQL password Secret
    When the chart is upgraded to the rendered LangWatchQL delivery
    Then the pre-upgrade hook recreates the RBAC and passwords, the render succeeds, and every ClickHouse pod serves a tenant-filtered query

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

  # ── AC9: sql mode is fail-closed on clusters, permitted on one node ─────────
  # The chart never selects sql mode for chart-managed ClickHouse, but an
  # operator can, so both branches of the AC9 cluster guard are exercised live
  # against a chart-managed deployment. See ADR-142 and
  # platform/app/src/server/analytics/lwql/provisioning/sqlModeClusterGuard.ts.

  # This asserts permit + DDL-path-ran + config-store yield, not a SQL-store
  # user: rendered delivery owns langwatch_lwql in users_xml, so sql mode yields
  # (495). See ADR-142, the AC8 deviation "The AC9 'one node provisions' e2e half".
  @e2e
  Scenario: On a single node, sql mode is permitted and provisions the access model
    Given the single-replica chart-managed release is upgraded to LWQL_ACCESS_MODEL_MODE=sql
    When the application pod boots in sql mode
    Then the AC9 cluster guard permits provisioning and logs no refusal
    And the sql-mode DDL path runs and yields to the mounted users_xml access model
    And a tenant-filtered query through the ClusterIP Service still succeeds

  @e2e
  Scenario: On a multi-host cluster, sql mode is refused and provisions nothing
    Given a three-host chart-managed ClickHouse cluster with no replicated access storage
    When the release is upgraded to LWQL_ACCESS_MODEL_MODE=sql without acknowledging single-node scope
    Then the application pod stays Ready because the refusal is non-fatal
    And the app logs the AC9 refusal with its host and replicated-directory counts
    And no SQL-store copy of the restricted user appears on any replica
