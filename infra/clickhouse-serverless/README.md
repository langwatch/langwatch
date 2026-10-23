# ClickHouse Serverless

Auto-tuning ClickHouse Docker image. Pass CPU + RAM, get a fully configured server.

```bash
docker run -d \
  -e CLICKHOUSE_PASSWORD="$(openssl rand -hex 24)" \
  langwatch/clickhouse-serverless
```

There is no default password: without `CLICKHOUSE_PASSWORD` or `CLICKHOUSE_PASSWORD_FILE` the container exits at startup. A published one (`langwatch`, `clickhouse`, `password`, `default`) or a blank-looking one starts with a warning at every boot.

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

| Variable                                       | Default                  | Description                                                                                                                           |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `CLICKHOUSE_CLUSTER_SECRET_FILE`               | —                        | File holding the `remote_servers` cluster secret (replicated mode). Read by `ch-config` only with `CLICKHOUSE_CLUSTER_SECRET_ENABLED` |
| `CLICKHOUSE_CLUSTER_SECRET_ENABLED`            | `false`                  | Recommended. Applies the cluster secret; see [Cluster secret](#cluster-secret) before turning it on                                   |
| `CLICKHOUSE_INTERSERVER_PASSWORD_FILE`         | —                        | File holding the interserver HTTP password. When set, `interserver_http_credentials` is rendered                                      |
| `CLICKHOUSE_INTERSERVER_USER`                  | `interserver`            | Interserver HTTP user, used only with `CLICKHOUSE_INTERSERVER_PASSWORD_FILE`                                                          |
| `DEFAULT_USER_ACCESS_MANAGEMENT`               | `true`                   | `false` leaves the `default` user without `access_management` and `named_collection_control` from `ch-config`                         |
| `CLICKHOUSE_ACCESS_FILE`                       | —                        | Access file declaring users, tiers and logins; see [Access](#access-tiers-rolling-passwords-and-token-logins)                         |
| `CLICKHOUSE_ACCESS_LISTEN`                     | `127.0.0.1:8124`         | Loopback address of the access sidecar's token check; anything else is refused                                                        |
| `CLICKHOUSE_ACCESS_SIDECAR`                    | `embedded`               | `embedded` runs the sidecar inside this container; `external` when it runs in its own (the chart does)                                |
| `CLICKHOUSE_ACCESS_BOOTSTRAP_DIR`              | `/run/clickhouse-access` | Dynamic-only mode: where the local admin's per-boot password is written; mount a tmpfs there                                          |
| `CLICKHOUSE_ACCESS_TIERS`                      | `false`                  | Render the tier roles and profiles without an access file, for users you write yourself                                               |
| `READ_TIER_MAX_EXECUTION_TIME`                 | `300`                    | Execution-time cap, in seconds, of the inspect and read tiers                                                                         |
| `LOG_TO_FILE`                                  | `true`                   | `false` removes the server's file loggers, so it logs to the console only                                                             |
| `MERGE_MAX_BLOCK_SIZE_BYTES`                   | `0`                      | `merge_tree.merge_max_block_size_bytes`; `0` leaves the ClickHouse default                                                            |
| `MAX_CONCURRENT_SELECT_QUERIES`                | `0`                      | SELECTs' own admission cap inside `max_concurrent_queries`; `0` means none                                                            |
| `NETWORK_COMPRESSION_METHOD`                   | —                        | Default profile `network_compression_method`; unset leaves the ClickHouse default. `zstd` suits replicated clusters                   |
| `NETWORK_ZSTD_COMPRESSION_LEVEL`               | —                        | Default profile `network_zstd_compression_level`; unset leaves the ClickHouse default                                                 |
| `CANCEL_HTTP_READONLY_QUERIES_ON_CLIENT_CLOSE` | —                        | Default profile; `1` stops a read whose HTTP client has gone (recommended), unset leaves the ClickHouse default (`0`)                 |

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

- restart every replica at once: set it (Helm: `auth.clusterSecretEnabled=true`),
  let the rollout start, then delete the remaining old pods together
  (`kubectl delete pod -l app.kubernetes.io/name=<release fullname>`, which spares
  the Keeper pods), or
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

## Access: tiers, rolling passwords and token logins

Design and limits: [ADR-190](../../dev/docs/adr/190-clickhouse-serverless-access-tiers-rolling-passwords-and-token-logins.md).

**Tiers.** With `CLICKHOUSE_ACCESS_FILE` set, or `CLICKHOUSE_ACCESS_TIERS=true`
for users you write yourself, the server renders `users.d/access-tiers.yaml` with
four roles and settings profiles of the same names (without either, none exists):

| Tier           | Can                                                                                    | Profile                                        |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `tier_inspect` | see database, table and column names; no rows                                          | `readonly=2`, capped execution time and memory |
| `tier_read`    | inspect, plus `SELECT` on its databases                                                | as inspect                                     |
| `tier_write`   | read, plus `INSERT`, `ALTER UPDATE`, `ALTER DELETE` (and lightweight `DELETE`); no DDL | capped memory                                  |
| `tier_admin`   | everything, including DDL and access management                                        | `default`                                      |

`system.query_log` and the other system tables holding query text stay closed to
every tier but admin (`select_from_system_db_requires_grant` is on in 26.8). Your
own `users.d` users are not changed; to move one onto a tier, render the tiers and give it
`profile: tier_read` and `grants: {query: ["GRANT tier_read", "GRANT SELECT ON db.*"]}`.

**Access file.** Set `CLICKHOUSE_ACCESS_FILE` to declare users. The file is
checked strictly at startup, and any error (an unknown key, tier or issuer, a
missing password directory) stops the container.

```yaml
issuers:
  - name: staff
    url: https://idp.example.com # exact `iss`; discovery at /.well-known/openid-configuration
    audience: clickhouse # default
    username_claim: email # default: sub
    required_claims: { email_verified: true }
users:
  - name: alice
    tier: read
    databases: [analytics]
    networks: [10.0.0.0/8] # default: anywhere
    login:
      token: { issuer: staff, subject: alice@example.com } # subject defaults to the user name
  - name: metabase
    tier: read
    databases: [analytics]
    login:
      rolling: { dir: /run/access/metabase }
```

Issuer keys: `name`, `url`, `audience`, `username_claim`, `required_claims`,
`jwks_url` (skip discovery), `ca_file` (a private CA), `allow_admin` (token users
of this issuer may hold `tier_admin`). User keys: `name`, `tier`, `databases`
(read and write only), `networks`, `login` with exactly one of `rolling` or
`token`.

**Rolling passwords.** Every regular, non-hidden file in a `rolling` directory is
a valid password of at least 16 characters, at most 8 per directory. A file
`<name>.valid_until` holding an RFC 3339 instant ends `<name>` then. Give each
user a directory of its own. To rotate:

1. Add a file with the new password. Both now work.
2. Move the client to the new password.
3. Delete the old file, or give it a `.valid_until`.

**Token logins.** A token user logs in with an OIDC JWT as its password, over
HTTP or the native protocol. ClickHouse asks the sidecar, which accepts only a
token signed by the user's issuer, with `aud` containing the audience, a live
`exp`, the `username_claim` equal to the user's `subject` and every
`required_claims` entry. Tokens up to 16 KiB are accepted.

**The sidecar.** `ch-config sidecar` re-reads the access file and the password
directories every 10 seconds (and at the next `valid_until`), rewrites
`users.d/access-users.yaml` only when it changes, and keeps the last good file
when an input cannot be read. ClickHouse reloads `users.d` within seconds. A
plain `docker run` starts it inside the container; the Helm chart runs it as its
own container. While it is down, token logins fail and an expired password
stays valid until it returns.

```bash
docker run -d \
  -e CLICKHOUSE_PASSWORD="$(openssl rand -hex 24)" \
  -e CLICKHOUSE_ACCESS_FILE=/run/access/access.yaml \
  -v "$PWD/access:/run/access:ro" \
  langwatch/clickhouse-serverless
```

### Dynamic-only mode

`mode: dynamic-only` at the top of the access file leaves ClickHouse with no
long-lived password. Every person and workload logs in with an OIDC token
([ADR-190](../../dev/docs/adr/190-clickhouse-serverless-access-tiers-rolling-passwords-and-token-logins.md), section 7).

- Leave `CLICKHOUSE_PASSWORD` and `CLICKHOUSE_PASSWORD_FILE` unset. `default`
  is locked: no network may log in as it.
- Declare token users only. A `rolling` user, or a `users.d`, `conf.d` or
  `users.xml` user with a password, `no_password` or `ssh_keys`, stops the
  start with a message naming it.
- With replicas, set `CLICKHOUSE_CLUSTER_SECRET_ENABLED=true`.
- `CREATE USER ... IDENTIFIED BY` is refused. The sidecar checks
  `system.users` every minute and logs any password login left.

The only password is `local_admin`'s. The image generates it at every start
into `CLICKHOUSE_ACCESS_BOOTSTRAP_DIR` (mode 0440), valid from `127.0.0.1` and
`::1` only. initdb scripts run as `local_admin`. In-pod tools read the file for
every connection, because a restart replaces it.

```bash
docker run -d \
  --tmpfs /run/clickhouse-access:uid=101,gid=101,mode=0750 \
  -e CLICKHOUSE_ACCESS_FILE=/run/access/access.yaml \
  -v "$PWD/access:/run/access:ro" \
  langwatch/clickhouse-serverless
```

Clients must read their token file for each connection or request, and never
use a token after its `exp`: the sidecar refuses it at that second. Every
login now depends on the sidecar; its `GET /readyz` answers 200 once it has the
access file and every issuer's keys. Changing mode needs a restart.

The remaining shared secret is the cluster secret (and the interserver HTTP
password, when set). Rotate it by replacing the file on every replica and
restarting them together (see [Cluster secret](#cluster-secret)).

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
make e2e-access      # Tiers, rolling passwords and token logins (Linux, host network)
```

## Architecture

```text
tini → entrypoint-wrapper.sh → ch-config generate → official entrypoint
                             └→ ch-config sidecar (with CLICKHOUSE_ACCESS_FILE, unless external)
```

`ch-config` reads env vars, auto-detects from cgroups, computes parameters, writes native ClickHouse YAML config to `config.d/` and `users.d/`, then execs the official ClickHouse entrypoint.
