# langwatch-gateway helm chart

Deploys the LangWatch AI Gateway (Go service) into a Kubernetes cluster.

## Install

```
helm install gateway ./charts/gateway -f values.prod.yaml
```

## Secrets

Expected Kubernetes Secret (`existingSecretName: gateway-runtime-secrets`):

| Key | Purpose |
|---|---|
| `LW_GATEWAY_INTERNAL_SECRET` | HMAC signing for internal calls to the LangWatch control plane |
| `LW_GATEWAY_JWT_SECRET` | HS256 signing secret for per-request JWTs issued by the control plane |

Create once via Terraform / external-secrets, never via helm.

## Probes

- `/startupz` — gates readiness until the auth cache has observed the first revision. `bootstrapAllKeys=true` extends this to include a full pull.
- `/readyz` — flips to 503 as soon as any dependency becomes unhealthy (control plane unreachable or redis down). Pod is removed from the LB but NOT killed.
- `/healthz` — pure process liveness. Never 503 unless the process is wedged.

## SSE / streaming

The ingress annotations in `values.yaml` disable nginx proxy buffering so SSE chunks reach clients promptly. Raising `proxy-read-timeout` to an hour allows long-running streamed generations.

## Scaling

HPA uses CPU + an optional custom metric `lw_gateway_rps` emitted by the gateway's Prometheus endpoint (`/metrics`). Requires Prometheus + prometheus-adapter for the custom metric. Drop the customMetrics block in values if unused.
