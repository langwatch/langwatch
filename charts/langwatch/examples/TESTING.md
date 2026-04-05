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
./examples/helm-safe.sh install lw . -f examples/values-dev.yaml

# Watch pods come up
kubectl -n langwatch-dev-dev get pods -w

# Port-forward to access the app
kubectl -n langwatch-dev-dev port-forward svc/lw-app 5560:5560

# Tear down
./examples/helm-safe.sh uninstall lw -n langwatch-dev
```

## Profiles

Each values file is a complete, runnable profile. Pick one and go.

| Profile | File | ClickHouse | PG / Redis | Use Case |
|---------|------|------------|------------|----------|
| **Dev** | `values-dev.yaml` | 1 node, 1Gi | chart-managed | Local minikube |
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
# Dev with replicated ClickHouse (namespace from values-dev.yaml)
./examples/helm-safe.sh install lw . \
  -f examples/values-dev.yaml \
  -f examples/values-clickhouse-replicated.yaml

# Dev with external ClickHouse
./examples/helm-safe.sh install lw . \
  -f examples/values-dev.yaml \
  -f examples/values-clickhouse-external.yaml
```

## What to Verify

### 1. Template rendering (no cluster needed)

```bash
# Single-node ClickHouse (default)
./examples/helm-safe.sh template lw . -f examples/values-dev.yaml

# Replicated ClickHouse
./examples/helm-safe.sh template lw . \
  -f examples/values-dev.yaml \
  -f examples/values-clickhouse-replicated.yaml

# External ClickHouse
./examples/helm-safe.sh template lw . \
  -f examples/values-dev.yaml \
  -f examples/values-clickhouse-external.yaml

# Production (external PG/Redis)
./examples/helm-safe.sh template lw . -f examples/values-hosted-prod.yaml
```

### 2. Install on minikube

```bash
minikube start --cpus 4 --memory 8192 --disk-size 40g
./examples/helm-safe.sh install lw . -f examples/values-dev.yaml --wait --timeout 10m
```

### 3. Verify pods

```bash
# All pods running
kubectl -n langwatch-dev get pods

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
kubectl -n langwatch-dev exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SELECT version()"

# Check if migrations ran
kubectl -n langwatch-dev exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SHOW DATABASES"

# For replicated mode, verify Keeper
kubectl -n langwatch-dev exec -it lw-clickhouse-0 -- \
  clickhouse-client --query "SELECT * FROM system.zookeeper WHERE path='/'"
```

### 5. Verify app can reach ClickHouse

```bash
# Check app logs for ClickHouse connection
kubectl -n langwatch-dev logs deploy/lw-app | grep -i clickhouse

# Check worker logs
kubectl -n langwatch-dev logs deploy/lw-workers | grep -i clickhouse
```

### 6. Upgrade test

```bash
# Change a value and upgrade
./examples/helm-safe.sh upgrade lw . \
  -f examples/values-dev.yaml \
  --set clickhouse.managed.memory=2Gi

# Verify ClickHouse pod restarts with new memory
kubectl -n langwatch-dev get pods -w
```

### 7. Clean up

```bash
./examples/helm-safe.sh uninstall lw -n langwatch-dev

# PVCs persist after uninstall — delete if you want a fresh start
kubectl -n langwatch-dev delete pvc --all
kubectl delete namespace langwatch-dev
```

## Troubleshooting

```bash
# Pod stuck in Pending — usually insufficient resources
kubectl -n langwatch-dev describe pod <pod-name>

# Pod in CrashLoopBackOff — check logs
kubectl -n langwatch-dev logs <pod-name> --previous

# ClickHouse init container stuck — DNS not resolving (replicated mode)
kubectl -n langwatch-dev logs lw-clickhouse-0 -c dns-wait

# Keeper not forming quorum — check raft
kubectl -n langwatch-dev logs lw-clickhouse-keeper-0

# Helm install failed — check events
kubectl -n langwatch-dev get events --sort-by='.lastTimestamp' | tail -20
```
