# langwatch-gateway helm chart

Deploys the LangWatch AI Gateway (Go service) into a Kubernetes cluster.

The chart is published as a sub-chart of the umbrella `langwatch` chart and
can also be installed standalone (you bring your own LangWatch control
plane). Image: `docker.io/langwatch/ai-gateway`, tag tracking the
`langwatch` Helm chart's `appVersion` (lockstep with the langwatch app
release — see [release process](https://github.com/langwatch/langwatch/blob/main/RELEASING.md)).

For the full self-hosting story (DNS + TLS, env vars, scaling, health
probes, troubleshooting), read the [AI Gateway self-hosting docs](https://docs.langwatch.ai/ai-gateway/self-hosting/helm).

## Pre-install: create the runtime secrets Kubernetes Secret

**Read this before `helm install`.** The chart references a Kubernetes
`Secret` (default name: `gateway-runtime-secrets`) for the gateway's
HMAC signing material. If the Secret doesn't exist when you `helm
install`, the gateway pod will loop with `secret "gateway-runtime-secrets"
not found` until the install times out.

Create the Secret first. Both keys must match byte-for-byte the values
your LangWatch control plane uses (the control plane signs JWTs that
the gateway verifies, and signs internal RPC envelopes the gateway
authenticates):

```bash
kubectl create secret generic gateway-runtime-secrets \
  --namespace langwatch \
  --from-literal=LW_GATEWAY_INTERNAL_SECRET="$(openssl rand -hex 32)" \
  --from-literal=LW_GATEWAY_JWT_SECRET="$(openssl rand -hex 32)"
```

Override the Secret name and key names via `secrets.existingSecretName`,
`secrets.internalSecretKey`, `secrets.jwtSecretKey`. The umbrella
`langwatch` chart can create + share the Secret automatically when
deploying both the app and the gateway together.

For zero-downtime rotation of the JWT signing secret, set
`secrets.jwtSecretPreviousKey` to a key in the same Secret holding the
prior value. The gateway accepts JWTs signed by either key during the
overlap window; remove the previous-key entry once the longest-lived
JWT pre-rotation has expired (default ~15 min).

## Install

The gateway sub-chart is shipped as a dependency of the umbrella
`langwatch` chart, not as a standalone published OCI artifact. Installing
the umbrella chart installs the gateway too (`gateway.chartManaged`
defaults to `true`):

```bash
helm install langwatch oci://ghcr.io/langwatch/charts/langwatch \
  -n langwatch -f values.prod.yaml
```

Or, for development against the chart in this repo, render this
sub-chart directly from the local checkout:

```bash
helm install gateway ./charts/gateway -n langwatch -f values.prod.yaml
```

## Values reference

The defaults in `values.yaml` are tuned for typical production
self-hosting. The values you most often override:

| Path                          | Purpose                                                              |
|-------------------------------|----------------------------------------------------------------------|
| `image.tag`                   | Image tag override (defaults to `Chart.AppVersion`)                  |
| `controlPlane.baseUrl`        | URL of your LangWatch app. Empty resolves to `<release>-app:5560`     |
| `secrets.existingSecretName`  | Name of the Secret created above (default `gateway-runtime-secrets`) |
| `ingress.enabled`             | Render an Ingress (default `false`)                                  |
| `ingress.className`           | IngressClass; empty uses the cluster default                         |
| `ingress.host`                | Customer-facing hostname for the gateway, required when enabled      |
| `ingress.tls.secretName`      | TLS Secret managed by cert-manager (or BYO)                          |
| `replicaCount`                | Static replicas if `autoscaling.enabled: false`                      |
| `autoscaling.minReplicas` / `maxReplicas` | HPA bounds                                              |
| `resources`                   | Pod CPU/memory requests + limits                                     |
| `otel.endpoint`               | Optional OTLP HTTP exporter URL (gateway emits its own spans)        |
| `spend.enabled`               | Kill switch for spend emission (default `true`). Off means no budget debits are ever written |

The pod ships hardened (`podSecurityContext` / `containerSecurityContext` in
`values.yaml`): non-root at both pod and container level, read-only root,
dropped capabilities, `RuntimeDefault` seccomp, and resource requests+limits.
It clears Pod Security Admission `restricted` and Gatekeeper / Kyverno
policies as-is.

The ServiceAccount token is never mounted. That is hardcoded in the pod spec
rather than exposed as a value: the gateway makes no Kubernetes API calls, and
it is a public-facing, tenant-controlled egress workload, so there is no
configuration under which projecting a cluster credential into it is correct.

Many `values.yaml` knobs are exposed as forward-compat for v1.1 and
have no effect in v1 (e.g. `cache.lruSize`,
`bifrost.poolSize`, `admin.addr`, `guardrails.*`). They are
intentionally kept in the values surface so operator runbooks built
today survive v1.1 without re-pinning. See
[Scaling — Future tunables](https://docs.langwatch.ai/ai-gateway/self-hosting/scaling#future-tunables-forward-compat-in-valuesyaml).

## Probes

The chart wires three Kubernetes probes against the gateway's HTTP
listener (port `5563`, named `http`):

| Probe        | Endpoint    | Validates                                                  |
|--------------|-------------|------------------------------------------------------------|
| `livenessProbe` | `/healthz`  | Process is responsive (cheap; never does network I/O)      |
| `readinessProbe`| `/readyz`   | Pod is not draining; OK to receive new traffic             |
| `startupProbe`  | `/startupz` | Auth-cache bootstrap completed; gives ~60 s of boot room   |

Response shape and tuning are documented in
[Health Checks](https://docs.langwatch.ai/ai-gateway/self-hosting/health-checks).

## Status-page endpoint

`GET /health` (also `HEAD`) is the public status-page surface, exposed
through the ingress as an Exact path when `ingress.healthPath.enabled`
(default `true`) and the Ingress is enabled; point an uptime monitor at `https://<ingress.host>/health`.
It reports the gateway process plus the control-plane connectivity
verdict that a background probe refreshes every 15 s over the signed
internal channel: HTTP 200 healthy, 503 once the control plane has been
unreachable for over 60 s. It never contacts a model provider, so an
OpenAI or Anthropic outage cannot turn it red, and a poll never fans
out anywhere. Distinct from the k8s probes above, which stay in-cluster.

## Streaming / SSE

The Ingress is off by default (`ingress.enabled: false`). When you enable
it with `ingress.className: nginx`, the chart adds the annotations under
`ingress.controllerAnnotations.nginx`: proxy buffering off, one-hour
read/send timeouts so SSE chunks reach clients promptly, and a 32m body
size to match `security.maxRequestBodyBytes`. Keys in `ingress.annotations`
win over them. Any other class gets only `ingress.annotations`:

```yaml
ingress:
  enabled: true
  className: nginx
  host: gateway.acme.com
```

For `alb` or another controller, set the equivalent streaming knobs in
`ingress.annotations` (ALB needs
`load-balancer-attributes: idle_timeout.timeout_seconds=3600`). For
Envoy Gateway and other Gateway API implementations, leave the Ingress off
and follow
[Routing and ingress controllers](https://docs.langwatch.ai/self-hosting/deployment/routing).

## Scaling

Custom-metric autoscaling on `lw_gateway_rps` requires
prometheus-adapter; without it the HPA falls back to the CPU target.
See [Scaling](https://docs.langwatch.ai/ai-gateway/self-hosting/scaling).

## Network policy

`networkPolicy.enabled: false` by default. Switch to `true` once your
namespace selectors match the cluster's actual labels (the chart's
defaults assume `kubernetes.io/metadata.name: ingress-nginx` / `monitoring`,
which is correct for upstream nginx-ingress and kube-prometheus-stack
but may differ on managed clusters).
