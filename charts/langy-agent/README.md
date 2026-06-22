# langwatch-langy-agent helm chart

Deploys the **Langy agent pod** — the OpenCode "manager" (Go, `services/langy-agent/`) that
backs the in-product Langy assistant. The manager spawns one isolated
OpenCode subprocess per conversation and injects that request's credentials
into the subprocess env at spawn time, so sessions never share credentials.

This is an **internal-only** service: it has no Ingress and a default-deny
NetworkPolicy that admits only the LangWatch control-plane pods. The control
plane reaches it over cluster DNS at `http://<release>-langy-agent:80`.

The chart ships as a sub-chart of the umbrella `langwatch` chart (aliased
`langy-agent`) and can also be installed standalone. Image:
`docker.io/langwatch/langy-agent`, tag tracking the `langwatch` chart's
`appVersion`.

## Pre-install: create the shared auth Secret

**Read this before `helm install`.** The chart references a Kubernetes
`Secret` (default name `langwatch-langy-agent-auth`) holding the
service-to-service token. The control plane sends this token as a Bearer
header; the agent verifies it. If the Secret is missing at install time the
pod loops with `secret "langwatch-langy-agent-auth" not found`.

The **same value** must be present on both the agent pod and the
`langwatch-app` env (`LANGY_INTERNAL_SECRET`). When you deploy both via the
umbrella chart, both pods read it from this one Secret:

```bash
kubectl create secret generic langwatch-langy-agent-auth \
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
  --set langy-agent.chartManaged=true
```

Standalone (you bring your own control plane and set `OPENCODE_AGENT_URL`
on it manually):

```bash
helm install langy-agent ./charts/langy-agent -n langwatch -f values.prod.yaml
```

## Values reference

| Path                          | Purpose                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| `chartManaged`                | Master on/off switch for the agent (umbrella: `langy-agent.chartManaged`) |
| `image.tag`                   | Image tag override (defaults to `Chart.AppVersion`)                     |
| `replicaCount`                | **Keep at 1** — see Scaling below                                       |
| `manager.maxWorkers`          | Max concurrent OpenCode subprocesses before the pod returns 503         |
| `manager.workerIdleMs`        | Idle worker reap timeout (default 10 min)                               |
| `secrets.existingSecretName`  | Name of the Secret created above                                        |
| `resources`                   | Pod CPU/memory requests + limits                                        |
| `networkPolicy.ingressFrom`   | Which pods may call the agent (default: `app.kubernetes.io/name: langwatch`) |
| `networkPolicy.allowExternalHttps` | Allow egress :443 to anywhere (OpenCode update/telemetry); tighten once pinned |

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
`networkPolicy.ingressFrom` (the control plane). Egress allows DNS, the
control plane (`controlPlanePort`), the AI gateway (`gatewayPort`), and —
unless you set `allowExternalHttps: false` — `:443` to anywhere. Adjust the
selectors if your `langwatch-app` pod labels differ from the defaults.
