# langwatch-langyagent helm chart

Deploys the **Langy agent pod** — the OpenCode "manager" (Go, `services/langyagent/`) that
backs the in-product Langy assistant. The manager spawns one isolated
OpenCode subprocess per conversation and injects that request's credentials
into the subprocess env at spawn time, so sessions never share credentials.

This is an **internal-only** service: it has no Ingress and a default-deny
NetworkPolicy that admits only the LangWatch control-plane pods. The control
plane reaches it over cluster DNS at `http://<release>-langyagent:80`.

The chart ships as a sub-chart of the umbrella `langwatch` chart (aliased
`langyagent`) and can also be installed standalone. Image:
`docker.io/langwatch/langyagent`, tag tracking the `langwatch` chart's
`appVersion`.

## Pre-install: create the shared auth Secret

**Read this before `helm install`.** The chart references a Kubernetes
`Secret` (default name `langwatch-langyagent-auth`) holding the
service-to-service token. The control plane sends this token as a Bearer
header; the agent verifies it. If the Secret is missing at install time the
pod loops with `secret "langwatch-langyagent-auth" not found`.

The **same value** must be present on both the agent pod and the
`langwatch-app` env (`LANGY_INTERNAL_SECRET`). When you deploy both via the
umbrella chart, both pods read it from this one Secret:

```bash
kubectl create secret generic langwatch-langyagent-auth \
  --namespace langwatch \
  --from-literal=LANGY_INTERNAL_SECRET="$(openssl rand -hex 32)"
```

Override the Secret/key names via `secrets.existingSecretName` and
`secrets.internalSecretKey`.

## Install

Preferred — via the umbrella `langwatch` chart, which also wires the app's
`OPENCODE_AGENT_URL` + `LANGY_INTERNAL_SECRET` for you:

```bash
helm install langwatch ./charts/langwatch -n langwatch \
  -f values.prod.yaml \
  --set langyagent.chartManaged=true
```

Standalone (you bring your own control plane and set `OPENCODE_AGENT_URL`
on it manually):

```bash
helm install langyagent ./charts/langyagent -n langwatch -f values.prod.yaml
```

## Values reference

| Path                          | Purpose                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| `chartManaged`                | Master on/off switch for the agent (umbrella: `langyagent.chartManaged`) |
| `environment`                 | Deployment environment reported as `ENVIRONMENT` (empty → inherits `global.env` → `production`). Security-load-bearing: prod pods must report a production environment so the manager refuses `LANGY_UNSAFE_DEV_DISABLE_ISOLATION` |
| `image.tag`                   | Image tag override (defaults to `Chart.AppVersion`)                     |
| `replicaCount`                | **Keep at 1** — see Scaling below                                       |
| `manager.maxWorkers`          | Max concurrent OpenCode subprocesses before the pod returns 503         |
| `manager.workerIdleMs`        | Idle worker reap timeout (default 10 min)                               |
| `secrets.existingSecretName`  | Name of the Secret created above                                        |
| `resources`                   | Pod CPU/memory requests + limits                                        |
| `networkPolicy.ingressFrom`   | Which pods may call the agent (default: `app.kubernetes.io/name: langwatch`) |
| `networkPolicy.allowExternalHttps` | Allow egress :443 to anywhere (OpenCode update/telemetry); tighten once pinned |
| `networkPolicy.privateExcept` / `privateExceptV6` | Private/link-local/CGNAT CIDRs carved out of the `:443`-to-anywhere rule so a worker cannot pivot to internal services. Includes `100.64.0.0/10` (EKS CGNAT). Append your cluster's CIDR if it lives outside RFC1918 |
| `egress.fqdnFloor` / `requireTls` / `enforceFloor` / `sniCrossCheck` / `cilium.enabled` | ADR-043 per-worker L7 egress adapter: operator FQDN floor + enforcement toggles. Stock posture is monitor-only; `cilium.enabled` ships a bypass-proof datapath `toFQDNs` policy |
| `nodeSelector` / `affinity` / `tolerations` | Node placement. Opt-in **public-subnet** pinning is a defence-in-depth wall (a node with no route to private RDS/ElastiCache). Needs a Terraform-side node group; see Network policy below |

## Probes

Both probes hit the manager's HTTP listener (port `8080`, named `http`):

| Probe            | Endpoint  | Validates                                  |
|------------------|-----------|--------------------------------------------|
| `readinessProbe` | `/health` | Manager is accepting requests              |
| `livenessProbe`  | `/health` | Manager process is responsive              |

## Scaling

**Single replica, on purpose. Do not add an HPA or raise `replicaCount`
without first adding conversation-sticky routing.** The manager keeps
per-conversation workers in memory keyed by `conversationId`. With a second
replica, a follow-up turn that lands on the other pod cold-starts a fresh
worker (it still works, but loses the warm session and its OpenCode session
id). Scale **vertically** instead — raise `resources` and
`manager.maxWorkers`.

The Deployment uses `strategy: Recreate` (not RollingUpdate) for the same
reason: a second pod briefly running alongside the old one provides no
benefit (in-memory sessions don't migrate) and doubles the worker footprint
during a deploy.

## PodDisruptionBudget

Disabled by default. With a single replica, a PDB of `minAvailable: 1`
blocks **all** voluntary evictions — node drains and cluster-autoscaler
scale-downs would hang forever. Only enable it after you have raised
`replicaCount` and added sticky routing.

## Network policy

`networkPolicy.enabled: true` by default. Ingress admits only pods matching
`networkPolicy.ingressFrom` (the control plane). Egress is default-deny and
allows only: DNS, the control plane (`controlPlanePort`), the AI gateway
(`gatewayPort`), and — only when `allowExternalHttps: true` — `:443` to
anywhere. Adjust the selectors if your `langwatch-app` pod labels differ.

**`:443` public egress and the private carve-outs.** `allowExternalHttps` is
`false` by default; enable it only when workers must `git clone` / call `gh` /
`npm install`. When enabled, the `:443` rule denies `networkPolicy.privateExcept`
(v4) and `networkPolicy.privateExceptV6` (v6) so a compromised worker cannot use
public egress to reach internal services on `:443`. The v4 defaults include
`100.64.0.0/10` (RFC 6598 CGNAT) because EKS *custom networking* / secondary
CIDRs place pods — and sometimes nodes and the apiserver ENI — in that range,
which the RFC1918 ranges do NOT cover. **If your service CIDR or a VPC CIDR lives
outside RFC1918, append it to `privateExcept`.** The metadata service over plain
`:80` (IMDSv2) is denied by default-deny — there is no `:80` egress rule at all.

**FQDN egress (ADR-043).** FQDN bounding ("only github/npm/…") is enforced at L7
by the per-worker egress adapter (worker tools egress via `HTTPS_PROXY`), tuned
by `egress.*`. For bypass-proof datapath FQDN egress on a Cilium CNI, set
`egress.cilium.enabled: true` (renders a `CiliumNetworkPolicy` enforcing the same
`egress.fqdnFloor`); the non-Cilium equivalent is the ADR-033 Fix B per-worker
netns.

**Defence-in-depth: public-subnet placement (opt-in).** Because workers run
LLM-driven arbitrary shell, you can pin the pod to a node group whose subnet has
no route to the private data tier (RDS/ElastiCache/internal ALBs) via
`nodeSelector` + `tolerations`. Then even a full NetworkPolicy + gVisor bypass
leaves the node unable to reach private services. This needs a matching public
node group provisioned in the Terraform/EKS repo (labelled + tainted); the chart
only selects and tolerates it. See the commented example in `values.yaml`.
