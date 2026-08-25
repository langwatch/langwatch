# clickhouse-serverless Helm Chart

Deploy ClickHouse with auto-tuning from CPU/RAM, tiered S3-compatible cold storage, and optional replication via embedded Keeper.

## Quick Start

The chart defaults to `autogen.enabled=false` (production-safe). Pick a credentials path before installing.

**Dev / stock install — chart materialises the password Secret:**

```bash
helm install clickhouse ./charts/clickhouse-serverless \
  --set autogen.enabled=true \
  --set cpu=4 \
  --set memory=16Gi
```

For a 3-node replicated cluster with Keeper:

```bash
helm install clickhouse ./charts/clickhouse-serverless \
  --set autogen.enabled=true \
  --set cpu=4 \
  --set memory=16Gi \
  --set replicas=3
```

**Production / GitOps install — operator owns the credentials Secret:**

```bash
# Pre-create the Secret (single-node needs only password; replicated also needs clusterSecret).
kubectl create secret generic my-ch-creds \
  --from-literal=password=$(openssl rand -hex 32) \
  --from-literal=clusterSecret=$(openssl rand -hex 24)

helm install clickhouse ./charts/clickhouse-serverless \
  --set auth.existingSecret=my-ch-creds \
  --set cpu=4 \
  --set memory=16Gi \
  --set replicas=3
```

A pre-install / pre-upgrade preflight Job verifies the required keys exist in the operator-owned Secret before pods roll. See [Secret Management](#secret-management) for the rationale.

## How It Works

The chart deploys the `langwatch/clickhouse-serverless` Docker image, which contains a Go binary (`ch-config`) that:

1. Reads `cpu`, `memory`, and `replicas` from pod environment
2. Auto-tunes ~40 ClickHouse parameters (memory limits, thread pools, merge settings, etc.)
3. Generates native ClickHouse YAML config into `config.d/` and `users.d/`

You set CPU + RAM, everything else is computed. Any computed value can be overridden via the `env` map.

See the [Docker image README](../../infra/clickhouse-serverless/README.md) for the full list of computed parameters and their formulas.

## Parameters

### Primary Inputs

| Name          | Description                                                                                           | Default     |
| ------------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| `cpu`         | CPU cores (Kubernetes quantity, e.g. `2`, `500m`)                                                     | `2`         |
| `memory`      | Memory (Kubernetes quantity, e.g. `4Gi`, `16G`)                                                       | `4Gi`       |
| `replicas`    | Number of ClickHouse nodes. 1 = standalone MergeTree, 3+ = ReplicatedMergeTree + Keeper (must be odd) | `1`         |
| `clusterName` | ClickHouse cluster name used in macros and remote_servers config                                      | `langwatch` |

> **`memory` scales with ingest, not just stored size.** The image auto-tunes
> `max_server_memory_usage` (~85% of the limit) and per-query limits from
> `memory`, and large/concurrent inserts plus background merges spike well above
> idle. Sub-2Gi values are fine for smoke or light local use, but raise `memory`
> (and `cpu`) before pushing real trace throughput or a big ingest burst will
> OOM the pod.

### Image

| Name               | Description      | Default                           |
| ------------------ | ---------------- | --------------------------------- |
| `image.repository` | Image repository | `langwatch/clickhouse-serverless` |
| `image.tag`        | Image tag        | `0.2.0`                           |
| `image.pullPolicy` | Pull policy      | `IfNotPresent`                    |

### Storage

| Name                   | Description                                 | Default |
| ---------------------- | ------------------------------------------- | ------- |
| `storage.size`         | PVC size for hot data                       | `50Gi`  |
| `storage.storageClass` | StorageClass name (empty = cluster default) | `""`    |

### Cold Storage

| Name           | Description                                                        | Default |
| -------------- | ------------------------------------------------------------------ | ------- |
| `cold.enabled` | Enable tiered hot-to-cold data movement (requires `objectStorage`) | `false` |

### Object Storage (S3-compatible)

Shared by cold storage and backups. Required when either `cold.enabled` or `backup.enabled` is true.

| Name                                                     | Description                                     | Default     |
| -------------------------------------------------------- | ----------------------------------------------- | ----------- |
| `objectStorage.bucket`                                   | Bucket name                                     | `""`        |
| `objectStorage.region`                                   | Region (used to build default AWS endpoint)     | `""`        |
| `objectStorage.endpoint`                                 | Custom S3-compatible endpoint (MinIO, R2, etc.) | `""`        |
| `objectStorage.useEnvironmentCredentials`                | Use IRSA / workload identity / pod SA           | `true`      |
| `objectStorage.credentials.secretKeyRef.name`            | Secret name for static S3 credentials           | `""`        |
| `objectStorage.credentials.secretKeyRef.accessKeyId`     | Key for access key ID in secret                 | `accessKey` |
| `objectStorage.credentials.secretKeyRef.secretAccessKey` | Key for secret access key in secret             | `secretKey` |

### Backups

| Name                          | Description                                                              | Default                                        |
| ----------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `backup.enabled`              | Enable native ClickHouse BACKUP/RESTORE to S3 (requires `objectStorage`) | `false`                                        |
| `backup.database`             | Database to back up                                                      | `langwatch`                                    |
| `backup.user`                 | ClickHouse user for backup/restore operations                            | `default`                                      |
| `backup.resources`            | CPU/memory requests + limits for the backup/restore Job containers       | requests `100m`/`128Mi`, limits `500m`/`512Mi` |
| `backup.full.schedule`        | Cron schedule for full backups                                           | `0 */12 * * *`                                 |
| `backup.incremental.schedule` | Cron schedule for incremental backups                                    | `0 * * * *`                                    |

### Backup alerting

Off by default. When enabled, the chart renders Prometheus alerting rules that
watch the backup CronJobs through kube-state-metrics, so a Prometheus that
scrapes kube-state-metrics is the only prerequisite.

The alert to care about is `ClickHouseBackupStale`, which fires when a backup
has no successful run inside its window. That is a different condition from "a
job failed", and a stricter one: a CronJob that is suspended, deleted, or
silently rescheduled never fails, it just stops producing backups. It also
covers the case of a backup that has never succeeded even once, which has no
`kube_cronjob_status_last_successful_time` series at all and so is invisible to
the obvious form of the query.

Each target additionally gets `ClickHouseBackupJobFailed` (faster, fires on a
bad run rather than waiting out the window), `ClickHouseBackupCronJobSuspended`,
and `ClickHouseBackupCronJobMissing` (the CronJob or kube-state-metrics itself
has gone away, which would otherwise resolve every other rule into silence).

Runbook: [`dev/docs/runbooks/clickhouse-backup-alerts.md`](../../dev/docs/runbooks/clickhouse-backup-alerts.md).

| Name                                       | Description                                                                     | Default                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `backup.monitoring.enabled`                | Render the backup alerting rules (also requires `backup.enabled`)               | `false`                                   |
| `backup.monitoring.runbookUrl`             | Value for the `runbook_url` annotation on every alert                           | `""`                                      |
| `backup.monitoring.additionalLabels`       | Labels merged into every alert, for Alertmanager or Grafana routing             | `{}`                                      |
| `backup.monitoring.for`                    | How long a backup may look broken before the alert fires                        | `15m`                                     |
| `backup.monitoring.absentFor`              | How long the CronJob's metrics may be missing before alerting                   | `30m`                                     |
| `backup.monitoring.prometheusRule.enabled` | Emit a `PrometheusRule` instead of a ConfigMap (needs prometheus-operator CRDs) | `false`                                   |
| `backup.monitoring.prometheusRule.labels`  | Extra labels on the `PrometheusRule`, for the operator's `ruleSelector`         | `{}`                                      |
| `backup.monitoring.configMapLabels`        | Labels on the rules ConfigMap, for a rules sidecar to discover it               | `{langwatch.ai/prometheus-rules: "true"}` |
| `backup.monitoring.targets`                | Backups to watch: `name`, `cronjob` or `cronjobName`, `staleAfterHours`         | full at 26h, incremental at 3h            |

Add an entry to `backup.monitoring.targets` for any other backup CronJob in the
same namespace, including ones this chart does not create. Name it either way:

```yaml
targets:
  # CronJob created by this chart: give the suffix, the release fullname is
  # prepended, so this matches <release>-clickhouse-backup-full.
  - name: full
    cronjob: backup-full
    staleAfterHours: 26
  # CronJob managed outside this chart: give the exact name, no prefix is added.
  - name: ebs-snapshot
    cronjobName: acme-ebs-snapshotter
    staleAfterHours: 26
```

`cronjob` and `cronjobName` are mutually exclusive, and the render fails if a
target sets both or neither. A backup mechanism that is not a Kubernetes CronJob
has no kube-state-metrics series and cannot be watched from here.

### Authentication

| Name                               | Description                                                                                                                                                      | Default             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `autogen.enabled`                  | Chart materialises the credentials Secret via per-key `lookup-or-rand` (existing values reused on upgrade). Must be enabled unless `auth.existingSecret` is set. | `false`             |
| `auth.password`                    | Seed value when `autogen.enabled=true` and you want a deterministic password instead of `randAlphaNum`. Ignored when `auth.existingSecret` is set.               | `""`                |
| `auth.clusterSecret`               | Seed value for the Keeper inter-node cluster secret (only used when `replicas>1`). Ignored when `auth.existingSecret` is set.                                    | `""`                |
| `auth.existingSecret`              | Name of an operator-owned Secret. When set, the chart skips its own Secret render and a preflight Job verifies the required keys exist before pods roll.         | `""`                |
| `auth.secretKeys.passwordKey`      | Key name for the password in both autogen and existingSecret paths                                                                                               | `password`          |
| `auth.secretKeys.clusterSecretKey` | Key name for the Keeper cluster secret                                                                                                                           | `clusterSecret`     |
| `preflight.enabled`                | Run the pre-install/pre-upgrade Secret-keys Job when `auth.existingSecret` is set                                                                                | `true`              |
| `preflight.image`                  | Container image (needs `sh` + `kubectl` + `jq`; the Job fails fast if `jq` is missing)                                                                           | `alpine/k8s:1.30.0` |
| `preflight.activeDeadlineSeconds`  | Hard timeout for the preflight Job                                                                                                                               | `60`                |

### Users

| Name    | Description                                                                 | Default |
| ------- | --------------------------------------------------------------------------- | ------- |
| `users` | Custom users string: `user1:pass1:readwrite:db1,db2;user2:pass2:readonly:*` | `""`    |

Example:

```yaml
users: "analyst:s3cret:readonly:*;etl_user:p4ssword:readwrite:default,analytics"
```

This creates two users: `analyst` with read-only access to all databases, and `etl_user` with read-write access to `default` and `analytics`.

### Advanced

| Name  | Description                                                                                   | Default |
| ----- | --------------------------------------------------------------------------------------------- | ------- |
| `env` | Override any auto-computed value (applied last). Example: `{ MAX_CONCURRENT_QUERIES: "200" }` | `{}`    |

### Keeper (replicated mode only)

| Name                               | Description           | Default |
| ---------------------------------- | --------------------- | ------- |
| `keeper.resources.requests.cpu`    | Keeper CPU request    | `250m`  |
| `keeper.resources.requests.memory` | Keeper memory request | `512Mi` |
| `keeper.resources.limits.cpu`      | Keeper CPU limit      | `1`     |
| `keeper.resources.limits.memory`   | Keeper memory limit   | `1Gi`   |
| `keeper.storage.size`              | Keeper PVC size       | `10Gi`  |

### Scheduling

| Name                      | Description          | Default |
| ------------------------- | -------------------- | ------- |
| `scheduling.nodeSelector` | Node selector labels | `{}`    |
| `scheduling.affinity`     | Affinity rules       | `{}`    |
| `scheduling.tolerations`  | Tolerations          | `[]`    |

### ServiceAccount

| Name                                          | Description                                                                                                                                             | Default |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `serviceAccount.create`                       | Create a dedicated ServiceAccount                                                                                                                       | `true`  |
| `serviceAccount.name`                         | ServiceAccount name (defaults to the chart fullname)                                                                                                    | `""`    |
| `serviceAccount.automountServiceAccountToken` | Mount the SA token; ClickHouse/Keeper need no Kubernetes API access. Also set on the pod specs so policies that inspect the pod (not the SA) accept it. | `false` |
| `serviceAccount.annotations`                  | ServiceAccount annotations (e.g. IRSA role ARN)                                                                                                         | `{}`    |

### Scratch volumes

Writable `emptyDir`s for the paths touched outside the data PVC, so the pods can
run with a read-only root filesystem. Bounded so a runaway pod is evicted on its
own quota instead of filling the node.

| Name                    | Description                                                                | Default |
| ----------------------- | -------------------------------------------------------------------------- | ------- |
| `scratch.logsSizeLimit` | Size cap for `/var/log/clickhouse-server` and `/var/log/clickhouse-keeper` | `2Gi`   |
| `scratch.tmpSizeLimit`  | Size cap for `/tmp` on the server, Keeper, and the backup/restore Jobs     | `1Gi`   |

## Pod Security

ClickHouse, Keeper, and the backup/restore Jobs run non-root (uid 101; Keeper's
init container runs 65534) with a read-only root filesystem, `RuntimeDefault`
seccomp, dropped capabilities, no privilege escalation, and no mounted
ServiceAccount token. A `MustRunAs` constraint has to allow both uids, or it
denies the Keeper pod on its init container. The paths written at
runtime outside the data volume — server logs, `/tmp`, and the rendered
`config.d`/`users.d` — are `emptyDir` volumes; everything else ClickHouse
writes (`preprocessed_configs`, `status`, `uuid`, `format_schemas`,
`user_files`, `tmp`, `access`) lives under `/var/lib/clickhouse` on the PVC, so
the image layer is never writable. Keeper is the same: its state, raft log and
preprocessed configs derive from `log_storage_path` and land on its PVC.

The log and `/tmp` scratch volumes are size-bounded (`scratch.logsSizeLimit`,
`scratch.tmpSizeLimit`) so a pod in an error loop is evicted on its own quota
rather than filling the node's ephemeral storage.

Under the LangWatch umbrella chart this clears Pod Security Admission
`restricted` and the equivalent Gatekeeper / Kyverno policies, including
"read-only root on every container".

**Installing this chart standalone:** the preflight Secret-check Job is enabled
by default and deliberately runs without `readOnlyRootFilesystem`, because
`kubectl` writes a discovery cache. A cluster with a no-exceptions read-only-root
constraint will deny it — set `preflight.enabled: false`. The umbrella chart
already disables it (`clickhouse.preflight.enabled: false`).

## Deployment Modes

### Single Node (replicas: 1)

- Plain `MergeTree` engine
- No Keeper pods
- Suitable for development and small-to-medium production workloads

### Replicated (replicas: 3+)

- `ReplicatedMergeTree` engine with automatic `ON CLUSTER` DDL
- Embedded Keeper StatefulSet (same replica count) for consensus
- PodDisruptionBudget maintains quorum (majority available)

> **Important:** Replicas must be an odd number (3, 5, 7, ...) because Keeper uses Raft consensus, which requires a strict majority for quorum. With an even number (e.g. 2 or 4), losing a single node can break quorum and halt writes.

## Secret Management

Two explicit paths, picked at install time:

**Autogen (`autogen.enabled=true`)**

The chart materialises a `<release>-clickhouse` Secret on first install via `randAlphaNum` (or the values you supply for `auth.password` / `auth.clusterSecret`). On every subsequent `helm upgrade`, each required key is independently `lookup`-ed and the existing value reused verbatim — no rotation, no roll. A partially-populated Secret (e.g. an operator imported `password` but not `clusterSecret` during a single→replicated migration) is healed in place. The Secret carries `helm.sh/resource-policy: keep` so a `helm uninstall` does not drop the credentials.

> **Important:** `helm lookup` returns empty for any renderer that lacks cluster access — most notably the ArgoCD repo-server. If your install runs under such a renderer, **do not use the autogen path**: the chart will render a fresh random password on every reconcile and rotate the credentials underneath your running pods. Use the operator-owned path below instead.

**Operator-owned (`autogen.enabled=false`, the default)**

You pre-create a Secret in the namespace with the required keys (`password`, plus `clusterSecret` when `replicas>1`), point `auth.existingSecret` at its name, and the chart skips materialising its own Secret entirely. A pre-install / pre-upgrade preflight Job runs as a Helm hook and verifies the required keys exist before the StatefulSet rolls — catches the trap where a chart bump adds a new required key or the operator imported the Secret without all the keys.

This is the drift-safe path under GitOps controllers.

**Neither set**

Chart-render hard-fails with an actionable error naming both opt-ins. The chart never silently materialises a Secret it could later rotate.

## Examples

See [`examples/terraform/`](examples/terraform/) for Terraform integration examples.
