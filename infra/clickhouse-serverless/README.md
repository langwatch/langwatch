# ClickHouse Serverless

Auto-tuning ClickHouse Docker image. Pass CPU + RAM, get a fully configured server.

```bash
docker run -d \
  -e CLICKHOUSE_PASSWORD=mysecret \
  langwatch/clickhouse-serverless
```

CPU and RAM are auto-detected from cgroups. Override with `CH_CPU` and `CH_RAM` if needed.

## Configuration

| Variable                          | Default      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLICKHOUSE_PASSWORD`             | _(required)_ | Default user password (or `CLICKHOUSE_PASSWORD_FILE`)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CH_CPU`                          | auto-detect  | CPU cores                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CH_RAM`                          | auto-detect  | Memory (`4Gi`, `16G`, or bytes)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `COLD_STORAGE_ENABLED`            | `false`      | Enable hot→cold tiering to S3                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `BACKUP_ENABLED`                  | `false`      | Enable S3 disk for native `BACKUP`/`RESTORE` SQL                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `S3_ENDPOINT`                     | —            | S3-compatible endpoint (e.g. `https://s3.us-east-1.amazonaws.com/bucket/`)                                                                                                                                                                                                                                                                                                                                                                                                 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | —            | Static credentials (or use `USE_ENVIRONMENT_CREDENTIALS=true` for IRSA)                                                                                                                                                                                                                                                                                                                                                                                                    |
| `CH_REPLICATED`                   | `false`      | Enable Keeper-coordinated ReplicatedMergeTree replication (requires keeper + data node env vars). Keeper replicates table data only — the LangWatchQL access model (users, profiles, row policies) is never stored in Keeper: on chart-managed ClickHouse it is delivered to every pod as rendered `users.d`/`config.d` files, and on bring-your-own ClickHouse the app provisions it via SQL; see [ADR-159](../../dev/docs/adr/159-the-app-owns-the-lwql-access-model.md) |

Settings with a fixed default rather than one computed from CPU + RAM:

| Variable                                       | Default       | Description                                                                                                                         |
| ---------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CLICKHOUSE_CLUSTER_SECRET_FILE`               | —             | File holding the `remote_servers` cluster secret (replicated mode). Read by `ch-config` only with `CLICKHOUSE_CLUSTER_SECRET_ENABLED` |
| `CLICKHOUSE_CLUSTER_SECRET_ENABLED`            | `false`       | Recommended. Applies the cluster secret; see [Cluster secret](#cluster-secret) before turning it on                                 |
| `CLICKHOUSE_INTERSERVER_PASSWORD_FILE`         | —             | File holding the interserver HTTP password. When set, `interserver_http_credentials` is rendered                                    |
| `CLICKHOUSE_INTERSERVER_USER`                  | `interserver` | Interserver HTTP user, used only with `CLICKHOUSE_INTERSERVER_PASSWORD_FILE`                                                        |
| `DEFAULT_USER_ACCESS_MANAGEMENT`               | `true`        | `false` leaves the `default` user without `access_management` and `named_collection_control` from `ch-config`                       |
| `LOG_TO_FILE`                                  | `true`        | `false` removes the server's file loggers, so it logs to the console only                                                           |
| `MERGE_MAX_BLOCK_SIZE_BYTES`                   | `0`           | `merge_tree.merge_max_block_size_bytes`; `0` leaves the ClickHouse default                                                          |
| `MAX_CONCURRENT_SELECT_QUERIES`                | `0`           | SELECTs' own admission cap inside `max_concurrent_queries`; `0` means none                                                          |
| `NETWORK_COMPRESSION_METHOD`                   | —             | Default profile `network_compression_method`; unset leaves the ClickHouse default. `zstd` suits replicated clusters                |
| `NETWORK_ZSTD_COMPRESSION_LEVEL`               | —             | Default profile `network_zstd_compression_level`; unset leaves the ClickHouse default                                              |
| `CANCEL_HTTP_READONLY_QUERIES_ON_CLIENT_CLOSE` | —             | Default profile; `1` stops a read whose HTTP client has gone (recommended), unset leaves the ClickHouse default (`0`)              |

The `NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_*` thresholds are derived from the
effective `background_pool_size`, including a `BACKGROUND_POOL_SIZE` override;
each one set explicitly wins.

### Cluster secret

Without `CLICKHOUSE_CLUSTER_SECRET_ENABLED`, `remote_servers` renders exactly as
earlier images did: a `from_file` attribute ClickHouse does not substitute, so
the cluster runs with no secret, and an empty or missing secret file fails
nothing. A replicated server logs a warning at every boot until it is on.

With it on, `ch-config` reads `CLICKHOUSE_CLUSTER_SECRET_FILE` (empty or missing
refuses to start) and renders the value, so distributed queries carry the
initiating user instead of logging in as `default` with no password. A pod
with the secret and one without cannot run distributed queries against each
other, so turn it on in one of two ways:

- restart every replica at once (Helm: `auth.clusterSecretEnabled=true`, then
  delete the pods together, or `kubectl rollout restart` with
  `podManagementPolicy: Parallel`), or
- roll as usual and accept that cross-replica queries fail until the last pod
  has restarted. Replicated inserts and part fetches are unaffected.

### Initialisation scripts and `CLICKHOUSE_DB`

`ch-config` owns the `default` user, so the entrypoint sets
`CLICKHOUSE_SKIP_USER_SETUP=1` and the official entrypoint never rewrites it.
When the official entrypoint initialises (container args are server flags such
as `--listen_host=...`, not the default `clickhouse-server` command) and
`/docker-entrypoint-initdb.d` holds files or `CLICKHOUSE_DB` is set, it receives
the password from `CLICKHOUSE_PASSWORD` or `CLICKHOUSE_PASSWORD_FILE`, so its
client can log in. `CLICKHOUSE_PASSWORD_FILE` is always unset before it runs.

`ch-config` only writes, and removes when disabled, the files it renders itself.
Any other file in `config.d/` or `users.d/` (for example a Kubernetes `subPath`
mount) is left alone, so a deployment can layer its own settings on top.

All other parameters (memory limits, pool sizes, merge settings, logging, network) are computed from CPU + RAM. See `internal/config/config.go` for the full list of overridable env vars.

For Kubernetes deployment with the [Helm chart](../../charts/clickhouse-serverless/), most of this is handled automatically via `values.yaml`.

## LangWatchQL (LWQL)

`ch-config` renders NO LangWatchQL access model — the application owns it (the
restricted `langwatch_lwql` user, the `<database>_profile` settings profile,
row policies, and the `lwql_postgres` PostgreSQL-bridge named collection). How
that model reaches this ClickHouse depends on the posture (see
[ADR-159](../../dev/docs/adr/159-the-app-owns-the-lwql-access-model.md)):

- **Chart-managed ClickHouse (rendered mode, the default).** The app renders the
  model to `users.d/lwql-access.yaml` and `config.d/lwql-named-collection.yaml`,
  and the umbrella chart's render Job delivers them to **every** pod as a mounted
  Secret. No access SQL DDL runs against this server. The user file carries only
  the identity's `password_sha256_hex`, never the password.
- **Bring-your-own ClickHouse (`sql` mode).** Where the chart cannot write the
  server's config files, the app self-provisions the same model via SQL DDL.

What `ch-config` renders in both cases is the server-level settings the model
needs: `custom-settings-prefixes.yaml` declares the `custom_` settings prefix the
per-query tenant capability rides on, and `access-control.yaml` sets
`access_control_improvements.settings_constraints_replace_previous` to `true`
(without it, ClickHouse rejects the `<database>_profile` settings profile's
`CHANGEABLE_IN_READONLY` constraint on `custom_api_key_hash`). The image also
grants its `default` user `access_management` + `named_collection_control`
(unless `DEFAULT_USER_ACCESS_MANAGEMENT=false`) — the
right to create users, profiles, row policies and named collections through SQL,
which **only `sql` mode uses**; rendered delivery runs no access DDL. See
`internal/render/access.go`.

## What Gets Computed

From 3 inputs (CPU, RAM, replicated), the Go binary derives ~40 parameters:

| Parameter          | Formula                  |
| ------------------ | ------------------------ |
| Server memory      | RAM * 85%                |
| Per-query memory   | min(RAM * 25%, 8GB)      |
| Background pool    | max(2, CPU/2)            |
| Concurrent queries | min(CPU*25, 200)         |
| Merge parts limit  | 5 / 8 / 15 (by CPU tier) |

Pods with 4 GiB of RAM or less also get an explicit memory budget, because
ClickHouse otherwise lets each cache grow to half of RAM. Larger pods keep the
ClickHouse defaults for all of these:

| Parameter (server setting)                                                                                                                                                | Small-pod value                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `mark_cache_size`                                                                                                                                                         | RAM / 16                                      |
| `index_mark_cache_size`, `primary_index_cache_size`, `query_condition_cache_size`, `compiled_expression_cache_size`                                                       | RAM / 64 each                                 |
| `mmap_cache_size`                                                                                                                                                         | 128 (regions, not bytes)                      |
| `merges_mutations_memory_usage_to_ram_ratio`                                                                                                                              | 0.25                                          |
| `background_merges_mutations_concurrency_ratio`                                                                                                                           | 1                                             |
| `background_schedule_pool_size` / `common` / `move`                                                                                                                       | 16 / 4 / 2                                    |
| `background_message_broker_schedule_pool_size`, `background_distributed_schedule_pool_size`, `background_buffer_flush_schedule_pool_size`, `background_fetches_pool_size` | 1 each                                        |
| `max_thread_pool_free_size`                                                                                                                                               | 8 (idle threads each keep an allocator cache) |
| System log queues (`max_size_rows` etc.)                                                                                                                                  | 16384 / 1024 reserved / 8192 flush            |
| `query_metric_log`, `query_thread_log`, `query_views_log`, `asynchronous_insert_log`                                                                                      | removed                                       |

Replicated pods (`CH_REPLICATED`) keep the ClickHouse default thread pools, because
replication fetches and schedules on them; they still get the cache and log budget.
Each value can be overridden by the env var named in `internal/config/compute.go`.

## Testing

```bash
make test            # Go unit tests
make e2e             # Basic: settings verification
make e2e-cold        # Cold storage config check
make e2e-cold-move   # Data moves from hot to cold S3 disk
make e2e-backup      # Full backup → restore → incremental → restore
```

## Architecture

```text
tini → entrypoint-wrapper.sh → ch-config generate → official entrypoint
```

`ch-config` reads env vars, auto-detects from cgroups, computes parameters, writes native ClickHouse YAML config to `config.d/` and `users.d/`, then execs the official ClickHouse entrypoint.
