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
| `CH_REPLICATED` | `false` | Enable ReplicatedMergeTree (requires keeper + data node env vars) |

All other parameters (memory limits, pool sizes, merge settings, logging, network) are computed from CPU + RAM. See `internal/config/config.go` for the full list of overridable env vars.

For Kubernetes deployment with the [Helm chart](../charts/clickhouse-serverless/), most of this is handled automatically via `values.yaml`.

## What Gets Computed

From 3 inputs (CPU, RAM, replicated), the Go binary derives ~40 parameters:

| Parameter | Formula |
|-----------|---------|
| Server memory | RAM * 85% |
| Per-query memory | min(RAM * 25%, 4GB) |
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
