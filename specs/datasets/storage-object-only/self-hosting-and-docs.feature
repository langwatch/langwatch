# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds (see write-paths.feature
# in this folder for the convention). Docs and chart text are already bound this way elsewhere
# (modules/stored-object/process/src/__tests__/stored-object-helm-and-docs-shape.unit.test.ts).
#
# With no object storage configured, every install writes datasets under
# LANGWATCH_LOCAL_STORAGE_PATH, default /var/lib/langwatch/objects
# (packages/process-stores/src/open-stores.ts:61-90). Once Postgres stops holding a copy, that
# folder is the only copy:
#   - docker compose mounts no volume there for app or workers (infra/compose.yml:4-69, :147-150),
#     so each container has its own folder, lost when the container is recreated;
#   - the chart falls back to the container layer when neither dataplane nor the local volume is
#     enabled (charts/langwatch/templates/_helpers.tpl:210-218);
#   - the chart still names a dataset migration Job that no template creates
#     (_helpers.tpl:1177, :1543, :1550, :1742; templates/NOTES.txt:173-187, :241-244);
#   - .env.example:102-104 offers SKIP_DATASET_S3_MIGRATE, which nothing reads;
#   - docs/self-hosting/upgrade-dataset-storage.mdx:6-9, :116-152 promise rows kept in PostgreSQL as
#     a fallback; docs/platform/data-retention.mdx:26 places datasets in Postgres;
#     docs/self-hosting/infrastructure/architecture.mdx:57 calls dataset storage optional;
#     docs/api-reference/query/overview.mdx:194 documents LWQL dataset_records.
#   - the upgrade lab's A3 verdict requires records-table rows to survive the upgrade
#     (tools/upgradelab/cell/tenant_oddities.go:298-308) and its coverage keeps the move pending
#     (tools/upgradelab/seed/coverage.json:74-79).

Feature: Self-hosted installs keep dataset files safe once Postgres holds no copy
  As a self-hosting operator
  I want my install and its docs to keep dataset files on durable storage and to say so
  So that an upgrade or a restart never loses dataset rows that now live only in object storage

  Rule: Every install keeps dataset files on storage that survives a restart

    # becomes @integration
    @unimplemented
    Scenario: Docker compose keeps dataset files on one volume shared by the app and the workers
      Given the docker compose install with no object storage configured
      When a dataset is created through the app and the app and workers containers are recreated
      Then the workers and the app both read the dataset's rows from the same volume

    # becomes @unit
    @unimplemented
    Scenario: The chart says plainly when dataset files would be lost on restart
      Given chart values with neither a dataplane bucket nor the local storage volume enabled
      When the chart is rendered
      Then its notes warn that datasets are kept in the container and lost on restart
      And they name the values that keep them

    # becomes @unit
    @unimplemented
    Scenario: The chart no longer mentions a dataset migration job
      When the chart's notes and helpers are rendered
      Then they mention no dataset migration job or hook

  Rule: Docs and examples describe object storage as the only home of dataset rows

    # becomes @unit
    @unimplemented
    Scenario: The dataset storage upgrade guide says Postgres keeps metadata only
      When the self-hosting dataset storage guide is read
      Then it says dataset rows live only in object storage and Postgres keeps dataset metadata
      And it describes the remaining-content move, the records-table cleanup an operator confirms and the dataset storage audit
      And it no longer promises that rows are kept in PostgreSQL as a fallback

    # becomes @unit
    @unimplemented
    Scenario: The environment example no longer offers the dead dataset migration opt-out
      When the environment example is read
      Then it does not mention SKIP_DATASET_S3_MIGRATE
      And it says datasets need either object storage or a persistent local storage path

  Rule: The upgrade lab proves the move, the conversion and the cleanup

    # becomes @integration
    @unimplemented
    Scenario: The upgrade lab finds planted records-table rows in object storage after the upgrade
      Given the upgrade lab plants a dataset with 3 rows in the records table on the previous release
      When it upgrades to head, runs the background steps and confirms the records-table cleanup
      Then the dataset reads its 3 rows through the REST API
      And the records table holds no row for it

    # becomes @integration
    @unimplemented
    Scenario: The upgrade lab finds a planted single-file dataset converted after the upgrade
      Given the upgrade lab plants a single-file dataset with 2 records on the previous release
      When it upgrades to head and runs the background steps
      Then the dataset reads its 2 records through the REST API from its chunks
