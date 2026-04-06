# Helm Chart Testing Guide

## Safety

**All commands below use `./helm-safe.sh`** which forces a local kubectl
context (`minikube` by default). It never touches your default context, so
there's no risk of accidentally hitting production.

```bash
# Uses minikube by default
./examples/helm-safe.sh install ...

# Or override for kind/k3d:
KUBE_CONTEXT=kind-langwatch ./examples/helm-safe.sh install ...
```

## Quick Start (minikube)

```bash
minikube start --cpus 4 --memory 8192 --disk-size 40g
cd charts/langwatch

# Install with dev defaults (namespace auto-read from values file header)
./examples/helm-safe.sh install lw . -f examples/values-local.yaml

# Watch pods come up
kubectl -n lw-local get pods -w

# Port-forward to access the app
kubectl -n lw-local port-forward svc/lw-app 5560:5560

# Tear down
./examples/helm-safe.sh uninstall lw -n lw-local
```

## Profiles

Each values file is a complete, runnable profile. Pick one and go.

| Profile | File | ClickHouse | PG / Redis | Use Case |
|---------|------|------------|------------|----------|
| **Dev** | `values-local.yaml` | 1 node, 1Gi | chart-managed | Local minikube |
| **Test** | `values-test.yaml` | 1 node, 512Mi | chart-managed | CI smoke test |
| **Hosted Dev** | `values-hosted-dev.yaml` | 1 node, 4Gi | chart-managed | Cloud dev (EKS/GKE) |
| **Hosted Prod** | `values-hosted-prod.yaml` | 1 node, 8Gi | **external** | Production, single CH |
| **Scalable Prod** | `values-scalable-prod.yaml` | 3 nodes, 16Gi, S3 cold | **external** | HA production |

## ClickHouse Overlays

Stack these on top of any base profile with `-f`:

| Overlay | File | What it does |
|---------|------|-------------|
| **External** | `values-clickhouse-external.yaml` | Point at your own ClickHouse |
| **Replicated** | `values-clickhouse-replicated.yaml` | 3-node + Keeper cluster |

```bash
# Dev with replicated ClickHouse (namespace from values-local.yaml)
./examples/helm-safe.sh install lw . \
  -f examples/values-local.yaml \
  -f examples/values-clickhouse-replicated.yaml

# Dev with external ClickHouse
./examples/helm-safe.sh install lw . \
  -f examples/values-local.yaml \
  -f examples/values-clickhouse-external.yaml
```

## What to Verify

### 1. Template rendering (no cluster needed)

```bash
# Single-node ClickHouse (default)
./examples/helm-safe.sh template lw . -f examples/values-local.yaml

# Replicated ClickHouse
./examples/helm-safe.sh template lw . \
  -f examples/values-local.yaml \
  -f examples/values-clickhouse-replicated.yaml

# External ClickHouse
./examples/helm-safe.sh template lw . \
  -f examples/values-local.yaml \
  -f examples/values-clickhouse-external.yaml

# Production (external PG/Redis)
./examples/helm-safe.sh template lw . -f examples/values-hosted-prod.yaml
```

### 2. Install on minikube

```bash
minikube start --cpus 4 --memory 8192 --disk-size 40g
./examples/helm-safe.sh install lw . -f examples/values-local.yaml --wait --timeout 10m
```

### 3. Verify pods

```bash
# All pods running
kubectl -n lw-local get pods

# Expected for dev profile:
#   lw-app-xxx              1/1  Running
#   lw-workers-xxx          1/1  Running
#   lw-langwatch-nlp-xxx    1/1  Running
#   lw-langevals-xxx        1/1  Running
#   lw-clickhouse-0         1/1  Running
#   lw-postgresql-0         1/1  Running
#   lw-redis-master-0       1/1  Running
#   lw-prometheus-server-xxx 1/1  Running

# Additional for replicated overlay:
#   lw-clickhouse-0/1/2           Running
#   lw-clickhouse-keeper-0/1/2    Running
```

### 4. Verify ClickHouse connectivity

```bash
# From a pod
kubectl -n lw-local exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SELECT version()"

# Check if migrations ran
kubectl -n lw-local exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SHOW DATABASES"

# For replicated mode, verify Keeper
kubectl -n lw-local exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SELECT * FROM system.zookeeper WHERE path='/'"
```

### 5. Verify app can reach ClickHouse

```bash
# Check app logs for ClickHouse connection
kubectl -n lw-local logs deploy/lw-app | grep -i clickhouse

# Check worker logs
kubectl -n lw-local logs deploy/lw-workers | grep -i clickhouse
```

### 6. Upgrade test

```bash
# Change a value and upgrade
./examples/helm-safe.sh upgrade lw . \
  -f examples/values-local.yaml \
  --set clickhouse.memory=2Gi

# Verify ClickHouse pod restarts with new memory
kubectl -n lw-local get pods -w
```

### 7. Clean up

```bash
./examples/helm-safe.sh uninstall lw -n lw-local

# PVCs persist after uninstall — delete if you want a fresh start
kubectl -n lw-local delete pvc --all
kubectl delete namespace lw-local
```

## Troubleshooting

```bash
# Pod stuck in Pending — usually insufficient resources
kubectl -n lw-local describe pod <pod-name>

# Pod in CrashLoopBackOff — check logs
kubectl -n lw-local logs <pod-name> --previous

# ClickHouse init container stuck — DNS not resolving (replicated mode)
kubectl -n lw-local logs lw-clickhouse-0 -c dns-wait

# Keeper not forming quorum — check raft
kubectl -n lw-local logs lw-clickhouse-keeper-0

# Helm install failed — check events
kubectl -n lw-local get events --sort-by='.lastTimestamp' | tail -20
```
