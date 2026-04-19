# lw-dev EKS smoke install runbook

Actionable runbook for installing the AI Gateway chart against the existing `lw-dev` EKS cluster. Each command is paste-able; read the annotations before running the destructive ones.

**Target cluster:** `arn:aws:eks:eu-central-1:381491922238:cluster/langwatch-dev-ekscluster-runtime`
**Target namespace:** `langwatch` (same as the existing `langwatch-app` deploy; gateway lands as an additive release)
**Release name:** `gateway-smoke` (distinct from the main `langwatch` release so it can be uninstalled cleanly)

## 0 — Prerequisites (one-time)

```bash
# AWS + kubectl
aws eks update-kubeconfig --profile lw-dev --region eu-central-1 \
  --name langwatch-dev-ekscluster-runtime
kubectl config current-context
# → arn:aws:eks:eu-central-1:381491922238:cluster/langwatch-dev-ekscluster-runtime

# Verify the existing langwatch deploy is healthy (we depend on its Services)
kubectl -n langwatch get deploy langwatch-app -o wide
kubectl -n langwatch get svc langwatch-app -o wide
# → ClusterIP on :5560 — this is what the gateway will dial for /api/internal/gateway/*
```

## 1 — Publish an image (first-time only)

The `gateway-ci` docker job only pushes to GHCR on merge to main (see `.github/workflows/gateway-ci.yaml`). Until the epic branch merges, you need to push a pre-release tag by hand.

Option A — **ECR** (preferred on this cluster; EKS nodes already have IRSA for pull access):

```bash
# Create the repo once
aws ecr create-repository --profile lw-dev --region eu-central-1 \
  --repository-name ai-gateway \
  --image-tag-mutability IMMUTABLE \
  --image-scanning-configuration scanOnPush=true

# Login + build + push
aws ecr get-login-password --profile lw-dev --region eu-central-1 \
  | docker login --username AWS --password-stdin \
    381491922238.dkr.ecr.eu-central-1.amazonaws.com

SHA=$(git rev-parse --short=12 HEAD)
docker build -t 381491922238.dkr.ecr.eu-central-1.amazonaws.com/ai-gateway:${SHA} \
  --build-arg VERSION=${SHA} \
  services/gateway/
docker push 381491922238.dkr.ecr.eu-central-1.amazonaws.com/ai-gateway:${SHA}
```

Option B — **GHCR** (same as CI on main; requires `gh auth token` with `write:packages`):

```bash
echo $(gh auth token) | docker login ghcr.io -u $(gh api user --jq .login) --password-stdin

SHA=$(git rev-parse --short=12 HEAD)
docker build -t ghcr.io/langwatch/ai-gateway:${SHA} \
  --build-arg VERSION=${SHA} services/gateway/
docker push ghcr.io/langwatch/ai-gateway:${SHA}
```

## 2 — Provision secrets (first-time only)

The chart expects an existing Kubernetes Secret — it never materialises secret values itself.

```bash
# Generate fresh secrets for this smoke install. Keep these in a
# password manager — NOT checked in anywhere, NOT shared in channels.
INTERNAL_SECRET=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_TOKEN=$(openssl rand -hex 32)

kubectl -n langwatch create secret generic gateway-runtime-secrets \
  --from-literal=LW_GATEWAY_INTERNAL_SECRET="${INTERNAL_SECRET}" \
  --from-literal=LW_GATEWAY_JWT_SECRET="${JWT_SECRET}"

kubectl -n langwatch create secret generic gateway-admin-secrets \
  --from-literal=token="${ADMIN_TOKEN}"
```

The same INTERNAL_SECRET and JWT_SECRET must be set on the control plane side (`langwatch-app-secrets`) under the `LW_GATEWAY_INTERNAL_SECRET` + `LW_GATEWAY_JWT_SECRET` keys. If not, the HMAC / JWT verification will fail on every request. Check with:

```bash
kubectl -n langwatch get secret langwatch-app-secrets \
  -o jsonpath='{.data.LW_GATEWAY_INTERNAL_SECRET}' | base64 -d
```

If empty, patch it (loops on the control-plane side — operator decision):

```bash
kubectl -n langwatch patch secret langwatch-app-secrets \
  -p "{\"stringData\":{\"LW_GATEWAY_INTERNAL_SECRET\":\"${INTERNAL_SECRET}\",\"LW_GATEWAY_JWT_SECRET\":\"${JWT_SECRET}\"}}"
# Roll langwatch-app so it picks up the new secret values
kubectl -n langwatch rollout restart deploy/langwatch-app
kubectl -n langwatch rollout status deploy/langwatch-app
```

## 3 — Dry run the chart one more time

Belt-and-suspenders — server-side validation catches cluster-specific issues before the real install:

```bash
cd services/gateway && make helm-e2e-smoke
# OK: chart renders cleanly against arn:aws:eks:...
```

## 4 — Install

```bash
SHA=$(git rev-parse --short=12 HEAD)

helm upgrade --install gateway-smoke ../../charts/gateway \
  --namespace langwatch \
  --set image.repository=381491922238.dkr.ecr.eu-central-1.amazonaws.com/ai-gateway \
  --set image.tag=${SHA} \
  --set replicaCount=1 \
  --set autoscaling.enabled=false \
  --set ingress.enabled=false \
  --set secrets.existingSecretName=gateway-runtime-secrets \
  --set admin.existingAuthSecretName=gateway-admin-secrets \
  --set admin.addr=127.0.0.1:6060 \
  --wait --timeout 3m
```

- `replicaCount=1` + `autoscaling.enabled=false` — keeps node footprint minimal for a smoke install.
- `ingress.enabled=false` — no public TLS / DNS touched. Reach the pod via port-forward in step 5.

Watch rollout:

```bash
kubectl -n langwatch rollout status deploy/gateway-smoke-langwatch-gateway --timeout=3m
kubectl -n langwatch get pod -l app.kubernetes.io/instance=gateway-smoke -o wide
kubectl -n langwatch logs -l app.kubernetes.io/instance=gateway-smoke --tail=100
```

Look for:
- `gateway_effective_config` log line with your config echo (iter 27)
- `startup_netcheck_ok` or `startup_netcheck_probing` (iter 20) — empty by default, so should just skip to MarkStarted
- `gateway_listening addr=:5563 version=...` (iter 30)
- `admin_listening addr=127.0.0.1:6060 auth_required=true loopback_only=true` (iter 22)

## 5 — Smoke test

```bash
# Port-forward the gateway's public listener
kubectl -n langwatch port-forward svc/gateway-smoke-langwatch-gateway 5563:80 &
FWD_PID=$!
trap "kill ${FWD_PID} 2>/dev/null" EXIT

# /healthz — always 200 once the process is up
curl -sSf http://localhost:5563/healthz | jq .
# → {"status":"ok","version":"<sha>","uptime_s":...}

# /startupz — 200 once MarkStarted; 503 before
curl -sSf http://localhost:5563/startupz | jq .

# /readyz — 200 only when all registered readiness checks pass
curl -sSf http://localhost:5563/readyz | jq .
# → Note: `auth_cache_warm` will be failing until at least one VK resolves

# /v1/models — 401 without auth, 200 with a valid VK
curl -si http://localhost:5563/v1/models
# → HTTP/1.1 401 + X-LangWatch-Request-Id + X-LangWatch-Gateway-Version

# /metrics — Prometheus scrape
curl -sSf http://localhost:5563/metrics | head -30

# Admin listener via port-forward on a second tunnel
kubectl -n langwatch port-forward deploy/gateway-smoke-langwatch-gateway 6060:6060 &
curl -sSf http://localhost:6060/debug/pprof/goroutine \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" -o /tmp/goroutine.pprof
go tool pprof -top /tmp/goroutine.pprof | head -20
```

### Cutting a real VK and completing a round-trip

To exercise the full dispatch path (auth → budget → dispatch → upstream), the control plane needs a VK configured with real provider creds. Use the UI on the control plane (whichever port-forward you've got for `langwatch-app`):

```bash
kubectl -n langwatch port-forward svc/langwatch-app 5560:5560 &
open http://localhost:5560
# Create a VK via /<project>/gateway/virtual-keys UI
# Bind a provider (OpenAI or Anthropic) with a real API key
```

Then the money shot:

```bash
VK=lw_vk_live_01JXXX...  # from the UI
curl -sSf http://localhost:5563/v1/chat/completions \
  -H "Authorization: Bearer ${VK}" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"ping — reply ok"}]}' | jq .
```

A successful response completes the end-to-end smoke. Check the control-plane budget view to see the debit event propagated through the outbox.

## 6 — Cleanup

When done:

```bash
helm uninstall gateway-smoke -n langwatch

# Secrets stay unless you explicitly delete
kubectl -n langwatch delete secret gateway-runtime-secrets gateway-admin-secrets

# PDBs aren't always cleaned by helm uninstall on older helm
kubectl -n langwatch delete pdb gateway-smoke-langwatch-gateway --ignore-not-found

# ECR image stays — cheap, and keeps the smoke install reproducible
```

## Troubleshooting

- **ImagePullBackOff**: EKS node role needs ECR pull permission. The `lw-dev` cluster's node role already has `AmazonEC2ContainerRegistryReadOnly` attached; if a new node group lacks it, `kubectl describe pod` will show the auth error and the fix is to extend the role policy.
- **CrashLoopBackOff with `LW_GATEWAY_INTERNAL_SECRET is required`**: step 2 secret is missing or the env var key in the Secret doesn't match `secrets.internalSecretKey` (default `LW_GATEWAY_INTERNAL_SECRET`).
- **401 `invalid_api_key` on every /v1/* request**: INTERNAL_SECRET on the gateway side doesn't match the control plane's. Re-run step 2 and roll both deploys.
- **503 on `/readyz` with `auth_cache_warm: cache has not observed any revision yet`**: normal until the first VK resolves. Hit `/v1/models` once with a valid VK.
- **503 on `/readyz` with `control_plane_reachable`**: the gateway can't reach `http://langwatch-app:5560/api/internal/gateway/health`. Check `kubectl -n langwatch get svc langwatch-app` is on `:5560`. NetworkPolicy off by default so this shouldn't be kube-level.

## Not covered

- Ingress / DNS / TLS on a real hostname — see `docs/ai-gateway/self-hosting/dns-and-tls.mdx` (iter 32).
- Horizontal scaling with the `lw_gateway_rps` custom metric — requires Prometheus Adapter + a ServiceMonitor; out of scope for a single-pod smoke.
- Long-term production deploy — this runbook is the "prove it works" path, not the "keep it running" path.
