# Helm Chart Testing Guide

## Quick Start (Kind)

```bash
kind create cluster --config charts/lib/kind-config.yaml
cd charts/langwatch
make images-local      # build + load images
helm install lw . -f examples/values-local.yaml
open http://localhost:30560
```

## Overlays

Compose values files from `examples/overlays/`:

```bash
# Pick a size + access method + any extras:
helm install lw . \
  -f examples/overlays/size-dev.yaml \
  -f examples/overlays/access-nodeport.yaml \
  -f examples/overlays/local-images.yaml \
  --set autogen.enabled=true
```

| Category | File | Description |
|----------|------|-------------|
| **Size** | `size-minimal.yaml` | CI smoke test (50m CPU, 256Mi) |
| | `size-dev.yaml` | Local dev / small team |
| | `size-prod.yaml` | Production, single-node CH |
| | `size-ha.yaml` | HA, 3-node replicated CH |
| **Access** | `access-nodeport.yaml` | Kind: http://localhost:30560 |
| | `access-ingress.yaml` | Cloud: Ingress + TLS |
| **Infra** | `local-images.yaml` | Use `pullPolicy: Never` images |
| | `clickhouse-external.yaml` | External ClickHouse |
| | `clickhouse-replicated.yaml` | 3-node replicated CH |
| | `postgres-external.yaml` | External PostgreSQL |
| | `redis-external.yaml` | External Redis |
| | `cold-storage-s3.yaml` | S3 tiering + backups |

## Profile files

For common scenarios, use one of the all-in-one profiles:

| File | Equivalent overlays |
|------|-------------------|
| `values-local.yaml` | `size-dev` + `access-nodeport` + `local-images` + autogen |
| `values-hosted-prod.yaml` | `size-prod` + `access-ingress` + `postgres-external` + `redis-external` |
| `values-scalable-prod.yaml` | `size-ha` + `access-ingress` + `postgres-external` + `redis-external` + `cold-storage-s3` |

## Template rendering (no cluster needed)

```bash
# Overlay composition
helm template lw . --set autogen.enabled=true \
  -f examples/overlays/size-dev.yaml \
  -f examples/overlays/access-nodeport.yaml

# Profile
helm template lw . -f examples/values-local.yaml

# Replicated ClickHouse
helm template lw . --set autogen.enabled=true \
  -f examples/overlays/size-prod.yaml \
  -f examples/overlays/access-ingress.yaml \
  -f examples/overlays/clickhouse-replicated.yaml
```

## Verify pods

```bash
kubectl -n <namespace> get pods

# Expected for size-dev:
#   lw-app-xxx              1/1  Running
#   lw-workers-xxx          1/1  Running
#   lw-langwatch-nlp-xxx    1/1  Running
#   lw-langevals-xxx        1/1  Running
#   lw-clickhouse-0         1/1  Running
#   lw-postgresql-0         1/1  Running
#   lw-redis-master-0       1/1  Running

# Additional for clickhouse-replicated:
#   lw-clickhouse-0/1/2           Running
#   lw-clickhouse-keeper-0/1/2    Running
```

## Verify ClickHouse

```bash
kubectl exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SELECT version()"

# For replicated mode, verify Keeper:
kubectl exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SELECT * FROM system.zookeeper WHERE path='/'"
```

## Upgrade test

```bash
helm upgrade lw . -f examples/values-local.yaml --set clickhouse.memory=2Gi
kubectl get pods -w
```

## Clean up

```bash
helm uninstall lw
kubectl delete pvc --all -n <namespace>  # PVCs persist after uninstall
kind delete cluster                       # or: make clean
```

## Troubleshooting

```bash
# Pod stuck in Pending — check resources
kubectl describe pod <pod-name>

# CrashLoopBackOff — check logs
kubectl logs <pod-name> --previous

# Keeper not forming quorum
kubectl logs lw-clickhouse-keeper-0

# Recent events
kubectl get events --sort-by='.lastTimestamp' | tail -20
```
