# langwatch-langyagent helm chart

Deploys the **Langy agent pod** — the "manager" (Go, `services/langyagent/`) that
backs the in-product Langy assistant. The manager spawns one isolated worker
subprocess per conversation and injects that request's credentials into the
subprocess env at spawn time, so sessions never share credentials. Workers are
driven over the anonymous stdio pipes they are spawned with; they open no port,
so there is nothing for a sibling to dial.

This is an **internal-only** service: it has no Ingress and a default-deny
NetworkPolicy that admits only the LangWatch control-plane pods. The control
plane reaches it over cluster DNS at `http://<release>-langyagent:80`.

The chart ships as a sub-chart of the umbrella `langwatch` chart (aliased
`langyagent`) and can also be installed standalone. Image:
`docker.io/langwatch/langyagent`, tag tracking the `langwatch` chart's
`appVersion`.

## Install

Preferred: via the umbrella `langwatch` chart, which deploys the agent by
default, wires the app and the workers to it, materialises the shared
`LANGY_INTERNAL_SECRET` into its own app Secret, and opens the assistant to
the people in the install:

```bash
helm install langwatch ./charts/langwatch -n langwatch \
  -f values.prod.yaml
```

There is nothing to create beforehand. If you supply your own app Secret
instead of letting the chart generate one (`autogen.enabled: false`), add a
`LANGY_INTERNAL_SECRET` key to it — the install tells you so and stops rather
than half-deploying. To run without the assistant, set
`langyagent.chartManaged=false`.

### The sandboxed runtime

The agent runs LLM-written shell, so a pod-to-host sandbox is worth having.
It is not required, and not the default: `runtimeClassName` ships empty with
`acceptUnsandboxedRuntime` true, so the agent installs and runs on any
cluster and hardening is a deliberate later step. GKE ships a sandboxed class
managed (GKE Sandbox), on AKS point `runtimeClassName` at your Kata VM
isolation class, on EKS install gVisor on the node group. To pin one:

```yaml
langyagent:
  runtimeClassName: "gvisor"
  acceptUnsandboxedRuntime: false
```

Blanking the class afterwards while `acceptUnsandboxedRuntime` stays false is
refused at render time, so a cluster that has hardened cannot quietly lose its
sandbox.

Pin a class the cluster does not define and no pod is created at all.
Kubernetes rejects it at admission (`pod rejected: RuntimeClass "..." not
found`), so `kubectl get pods` lists nothing rather than showing something
Pending, and the reason lands on the Deployment instead:

```bash
kubectl -n <namespace> get deploy <release>-langyagent \
  -o jsonpath='{.status.conditions[?(@.type=="ReplicaFailure")].message}'
```

Everything else in the install keeps running either way.

Unsandboxed, you keep per-worker UID isolation and the NetworkPolicy; you give
up the pod-to-host sandbox. A single-tenant install whose users are colleagues
carries a much smaller worker-versus-worker risk than a multi-tenant one; read
the trade that way, not as a formality.

### Clusters that refuse root

`runtimeClassName` governs the pod-to-node boundary. A separate, lower rung
governs the worker-to-worker one, and a cluster running Pod Security Admission
`restricted` — or a Gatekeeper / Kyverno rule requiring `runAsNonRoot: true` —
forces a choice about it, because per-worker UID isolation needs root plus five
capabilities and such a cluster admits no pod that holds them.

```yaml
workerIsolation: none
acceptWorkerIsolationDisabled: true
```

The render fails without the acknowledgement, so nobody arrives here by leaving
a field blank. What it costs is narrower than it sounds and still real: workers
keep no credentials on disk and have no listener, so a sibling cannot reach
another's control channel or steal a credential file at either setting. What a
shared identity opens is that one conversation's worker can read another's live
credentials from `/proc/<pid>/environ`, and another's conversation content from
its session directory. Take it for a single-tenant install whose users are
colleagues; do not take it if you serve mutually untrusted users. See ADR-130.

### Standalone

You bring your own control plane, set `OPENCODE_AGENT_URL` on it manually, and
create the shared Secret yourself so both sides hold the same value:

```bash
kubectl create secret generic langwatch-langyagent-auth \
  --namespace langwatch \
  --from-literal=LANGY_INTERNAL_SECRET="$(openssl rand -hex 32)"

helm install langyagent ./charts/langyagent -n langwatch -f values.prod.yaml
```

Override the Secret/key names via `secrets.existingSecretName` and
`secrets.internalSecretKey`.

## Values reference

| Path                          | Purpose                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| `chartManaged`                | Master on/off switch for the agent (umbrella: `langyagent.chartManaged`) |
| `enableForAllUsers`           | Umbrella-only. Opens Langy to everyone in the install as soon as the agent is deployed. `false` keeps the rollout flag authoritative so you open it per project/org from `/ops/feature-flags` |
| `runtimeClassName`            | Sandboxed runtime for the pod. Ships blank with `acceptUnsandboxedRuntime` true, so the agent installs anywhere; pin a class and set the acknowledgement false to harden |
| `acceptUnsandboxedRuntime`    | Accept running with no pod-to-host sandbox, on clusters that cannot offer one. Required for a blank `runtimeClassName`, so an unsandboxed deploy is always deliberate |
| `workerIsolation`             | Per-worker identity posture: `per-uid` (default, each worker gets its own uid; needs root + five capabilities) or `none` (shared identity; the pod needs neither root nor any capability, so it passes PSA `restricted`). See ADR-130 |
| `acceptWorkerIsolationDisabled` | Accept running workers under one shared identity. Required for `workerIsolation: none`, so the weaker posture is always deliberate |
| `environment`                 | Deployment environment reported as `ENVIRONMENT` (empty → inherits `global.env` → `production`). Read for telemetry and log labelling only — it gated the isolation bypass until ADR-130 and holds no boundary now |
| `image.tag`                   | Image tag override (defaults to `Chart.AppVersion`)                     |
| `replicaCount`                | **Keep at 1** — see Scaling below                                       |
| `manager.maxWorkers`          | Max concurrent worker subprocesses before the pod returns 503           |
| `manager.workerIdleMs`        | Idle worker reap timeout (default 10 min)                               |
| `secrets.existingSecretName`  | Name of the Secret created above                                        |
| `resources`                   | Pod CPU/memory requests + limits                                        |
| `networkPolicy.ingressFrom`   | Which pods may call the agent (default: `app.kubernetes.io/name: langwatch`) |
| `networkPolicy.allowExternalHttps` | Allow egress :443 to anywhere (worker tool traffic); tighten once pinned |
| `networkPolicy.privateExcept` / `privateExceptV6` | Private/link-local/CGNAT CIDRs carved out of the `:443`-to-anywhere rule so a worker cannot pivot to internal services. Includes `100.64.0.0/10` (EKS CGNAT). Append your cluster's CIDR if it lives outside RFC1918 |
| `egress.fqdnFloor` / `requireTls` / `enforceFloor` / `sniCrossCheck` / `egress.cilium.enabled` | ADR-076 per-worker L7 egress adapter: operator FQDN floor + enforcement toggles. Stock posture is monitor-only for destination decisions; `egress.cilium.enabled` ships a bypass-proof datapath `toFQDNs` policy |
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
worker (it still works, but loses the warm session and its agent session
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

**FQDN egress (ADR-076).** FQDN bounding ("only GitHub/npm/…") is enforced at L7
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
