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

See the [Docker image README](../../clickhouse-serverless/README.md) for the full list of computed parameters and their formulas.

## Parameters

### Primary Inputs

| Name | Description | Default |
|------|-------------|---------|
| `cpu` | CPU cores (Kubernetes quantity, e.g. `2`, `500m`) | `2` |
| `memory` | Memory (Kubernetes quantity, e.g. `4Gi`, `16G`) | `4Gi` |
| `replicas` | Number of ClickHouse nodes. 1 = standalone MergeTree, 3+ = ReplicatedMergeTree + Keeper (must be odd) | `1` |
| `clusterName` | ClickHouse cluster name used in macros and remote_servers config | `langwatch` |

### Image

| Name | Description | Default |
|------|-------------|---------|
| `image.repository` | Image repository | `langwatch/clickhouse-serverless` |
| `image.tag` | Image tag | `0.1.0` |
| `image.pullPolicy` | Pull policy | `IfNotPresent` |

### Storage

| Name | Description | Default |
|------|-------------|---------|
| `storage.size` | PVC size for hot data | `50Gi` |
| `storage.storageClass` | StorageClass name (empty = cluster default) | `""` |

### Cold Storage

| Name | Description | Default |
|------|-------------|---------|
| `cold.enabled` | Enable tiered hot-to-cold data movement (requires `objectStorage`) | `false` |

### Object Storage (S3-compatible)

Shared by cold storage and backups. Required when either `cold.enabled` or `backup.enabled` is true.

| Name | Description | Default |
|------|-------------|---------|
| `objectStorage.bucket` | Bucket name | `""` |
| `objectStorage.region` | Region (used to build default AWS endpoint) | `""` |
| `objectStorage.endpoint` | Custom S3-compatible endpoint (MinIO, R2, etc.) | `""` |
| `objectStorage.useEnvironmentCredentials` | Use IRSA / workload identity / pod SA | `true` |
| `objectStorage.credentials.secretKeyRef.name` | Secret name for static S3 credentials | `""` |
| `objectStorage.credentials.secretKeyRef.accessKeyId` | Key for access key ID in secret | `accessKey` |
| `objectStorage.credentials.secretKeyRef.secretAccessKey` | Key for secret access key in secret | `secretKey` |

### Backups

| Name | Description | Default |
|------|-------------|---------|
| `backup.enabled` | Enable native ClickHouse BACKUP/RESTORE to S3 (requires `objectStorage`) | `false` |
| `backup.database` | Database to back up | `langwatch` |
| `backup.full.schedule` | Cron schedule for full backups | `0 */12 * * *` |
| `backup.incremental.schedule` | Cron schedule for incremental backups | `0 * * * *` |

### Authentication

| Name | Description | Default |
|------|-------------|---------|
| `autogen.enabled` | Chart materialises the credentials Secret via per-key `lookup-or-rand` (existing values reused on upgrade). Must be enabled unless `auth.existingSecret` is set. | `false` |
| `auth.password` | Seed value when `autogen.enabled=true` and you want a deterministic password instead of `randAlphaNum`. Ignored when `auth.existingSecret` is set. | `""` |
| `auth.clusterSecret` | Seed value for the Keeper inter-node cluster secret (only used when `replicas>1`). Ignored when `auth.existingSecret` is set. | `""` |
| `auth.existingSecret` | Name of an operator-owned Secret. When set, the chart skips its own Secret render and a preflight Job verifies the required keys exist before pods roll. | `""` |
| `auth.secretKeys.passwordKey` | Key name for the password in both autogen and existingSecret paths | `password` |
| `auth.secretKeys.clusterSecretKey` | Key name for the Keeper cluster secret | `clusterSecret` |
| `preflight.enabled` | Run the pre-install/pre-upgrade Secret-keys Job when `auth.existingSecret` is set | `true` |
| `preflight.image` | Container image (needs `sh` + `kubectl` + `jq`) | `alpine/k8s:1.30.0` |
| `preflight.activeDeadlineSeconds` | Hard timeout for the preflight Job | `60` |

### Users

| Name | Description | Default |
|------|-------------|---------|
| `users` | Custom users string: `user1:pass1:readwrite:db1,db2;user2:pass2:readonly:*` | `""` |

Example:

```yaml
users: "analyst:s3cret:readonly:*;etl_user:p4ssword:readwrite:default,analytics"
```

This creates two users: `analyst` with read-only access to all databases, and `etl_user` with read-write access to `default` and `analytics`.

### Advanced

| Name | Description | Default |
|------|-------------|---------|
| `env` | Override any auto-computed value (applied last). Example: `{ MAX_CONCURRENT_QUERIES: "200" }` | `{}` |

### Keeper (replicated mode only)

| Name | Description | Default |
|------|-------------|---------|
| `keeper.resources.requests.cpu` | Keeper CPU request | `250m` |
| `keeper.resources.requests.memory` | Keeper memory request | `512Mi` |
| `keeper.resources.limits.cpu` | Keeper CPU limit | `1` |
| `keeper.resources.limits.memory` | Keeper memory limit | `1Gi` |
| `keeper.storage.size` | Keeper PVC size | `10Gi` |

### Scheduling

| Name | Description | Default |
|------|-------------|---------|
| `scheduling.nodeSelector` | Node selector labels | `{}` |
| `scheduling.affinity` | Affinity rules | `{}` |
| `scheduling.tolerations` | Tolerations | `[]` |

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
