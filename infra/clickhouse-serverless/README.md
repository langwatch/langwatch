# ClickHouse Serverless

Auto-tuning ClickHouse Docker image. Pass CPU + RAM, get a fully configured server.

```bash
docker run -d \
  -e CLICKHOUSE_PASSWORD=mysecret \
  langwatch/clickhouse-serverless
```

CPU and RAM are auto-detected from cgroups. Override with `CH_CPU` and `CH_RAM` if needed.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CLICKHOUSE_PASSWORD` | *(required)* | Default user password (or `CLICKHOUSE_PASSWORD_FILE`) |
| `CH_CPU` | auto-detect | CPU cores |
| `CH_RAM` | auto-detect | Memory (`4Gi`, `16G`, or bytes) |
| `COLD_STORAGE_ENABLED` | `false` | Enable hot→cold tiering to S3 |
| `BACKUP_ENABLED` | `false` | Enable S3 disk for native `BACKUP`/`RESTORE` SQL |
| `S3_ENDPOINT` | — | S3-compatible endpoint (e.g. `https://s3.us-east-1.amazonaws.com/bucket/`) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | Static credentials (or use `USE_ENVIRONMENT_CREDENTIALS=true` for IRSA) |
| `CH_REPLICATED` | `false` | Enable Keeper-coordinated ReplicatedMergeTree replication (requires keeper + data node env vars). Keeper replicates table data only — the LangWatchQL access model (users, profiles, row policies) is never stored in Keeper: on chart-managed ClickHouse it is delivered to every pod as rendered `users.d`/`config.d` files, and on bring-your-own ClickHouse the app provisions it via SQL; see [ADR-142](../../dev/docs/adr/142-the-app-owns-the-lwql-access-model.md) |

All other parameters (memory limits, pool sizes, merge settings, logging, network) are computed from CPU + RAM. See `internal/config/config.go` for the full list of overridable env vars.

For Kubernetes deployment with the [Helm chart](../../charts/clickhouse-serverless/), most of this is handled automatically via `values.yaml`.

## LangWatchQL (LWQL)

`ch-config` renders NO LangWatchQL access model — the application owns it (the
restricted `langwatch_lwql` user, the `<database>_profile` settings profile,
row policies, and the `lwql_postgres` PostgreSQL-bridge named collection). How
that model reaches this ClickHouse depends on the posture (see
[ADR-142](../../dev/docs/adr/142-the-app-owns-the-lwql-access-model.md)):

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
grants its `default` user `access_management` + `named_collection_control` — the
right to create users, profiles, row policies and named collections through SQL,
which **only `sql` mode uses**; rendered delivery runs no access DDL. See
`internal/render/access.go`.

## What Gets Computed

From 3 inputs (CPU, RAM, replicated), the Go binary derives ~40 parameters:

| Parameter | Formula |
|-----------|---------|
| Server memory | RAM * 85% |
| Per-query memory | min(RAM * 25%, 8GB) |
| Background pool | max(2, CPU/2) |
| Concurrent queries | min(CPU*25, 200) |
| Merge parts limit | 5 / 8 / 15 (by CPU tier) |
| S3 cache | RAM * 25% |

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
