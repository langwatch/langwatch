# ADR-033: Langy worker network isolation under gVisor

**Date:** 2026-07-02

**Status:** Draft

## Context

The `langy-agent` pod runs many `opencode` workers as subprocesses inside a
single pod. Each worker runs as a distinct UID and holds a different user's
live credentials (`LANGWATCH_API_KEY`, GitHub token) in its environment.
Workers execute LLM-generated shell, so a prompt-injected worker A is a
realistic attacker against sibling worker B.

Two walls separate siblings today:

1. **Filesystem** — per-worker UID + `0700` home. Stops A reading B's files.
2. **Network** — an `iptables` OUTPUT OWNER-match DROP rule on the shared pod
   loopback (`services/langy-agent/iptables.go`, PR #4913). Stops A from
   `connect()`-ing to B's opencode TCP port after scanning `/proc/net/tcp`.

Issue langwatch-saas#620 requires this pod to run under gVisor
(`runtimeClassName: gvisor`) to harden the pod→host escape surface, because
this is the highest-risk workload on the cluster (arbitrary LLM-driven shell
as root).

**The conflict:** a spike on dev EKS (ARM64, `runsc release-20260622.0`,
2026-07-02) confirmed that gVisor's Sentry does **not** implement the kernel
netfilter subsystem — `iptables` fails in every backend (`nft`, `legacy`) and
every network mode (default netstack, `--network=host`):

| Config | Result |
|---|---|
| netstack + nft | `Failed to initialize nft: Protocol not supported` |
| netstack + legacy | `can't initialize iptables table 'filter': Table does not exist` |
| host-network + nft | `Failed to initialize nft: Protocol not supported` |
| host-network + legacy | `Table does not exist` |

`serve.go` aborts startup when the rule fails to install (production path), so
`runtimeClassName: gvisor` on this pod today **crash-loops it on every boot**.
The filesystem wall (UID/CHOWN/SETUID/SETGID/DAC_OVERRIDE) was verified to work
fine under gVisor — only the network wall is broken.

## Decision

**Replace the netfilter-based network wall with per-worker Linux network
namespaces.** Each worker's `opencode` is spawned into its own network
namespace, so a sibling has no route to the worker's loopback port at all —
isolation becomes a property of the topology instead of a filtering rule over
a shared network. gVisor implements network namespaces (verified in the same
spike: cross-netns loopback connect was blocked; same-netns control succeeded).

This is "Fix B" in the langwatch-saas#620 discussion. It keeps the current
dense architecture (one pod, many worker subprocesses) rather than moving to
one pod per worker ("Fix C"), because pods are bounded to ~110/node on EKS and
this service must support many concurrent conversations — see Trade-offs.

## Rationale / Trade-offs

**Why not just disable the rule (`LANGY_LOOPBACK_LOCKDOWN_DISABLED=true`) in
prod?** That stops the crash loop by re-opening the exact exfiltration hole
PR #4913 closed. Not acceptable in production.

**Why per-worker netns (Fix B) over pod-per-worker (Fix C)?**

| | Fix B: per-worker netns | Fix C: pod-per-worker |
|---|---|---|
| Isolation quality | Strong | Strongest (platform-enforced) |
| Concurrency ceiling | High (subprocesses) | **~110 pods/node on EKS** |
| Startup latency/worker | ~ms | ~seconds |
| Netfilter dependency | None | None |
| Capability cost | **+`SYS_ADMIN`** (see below) | None on workers |
| Code change size | Medium | Large (k8s API, RBAC, lifecycle) |

Fix C's isolation is bought with pods, and pods are the resource EKS caps
hardest (IP-per-pod via the VPC CNI). For a service with many concurrent
conversations, Fix B preserves density and low latency while still closing the
hole. A pre-warmed worker-pod pool (a Fix C variant) softens latency but not
the per-node ceiling.

**The capability trade-off.** Creating a network namespace (`CLONE_NEWNET` /
`unshare -n`) requires `CAP_SYS_ADMIN`; the spike confirmed it fails with only
the current `NET_ADMIN`+4 set. So this swaps `NET_ADMIN` (bounded, network-only)
for `SYS_ADMIN` (the kernel's broad "junk drawer" capability). This is
acceptable **specifically because the pod runs under gVisor**: gVisor never
grants host capabilities regardless of `capabilities.add`, so in-sandbox
`SYS_ADMIN` is mediated by the Sentry rather than the host kernel. Under plain
`runc`, granting `SYS_ADMIN` would be a much harder sell.

## Open design question (must be resolved before implementation)

Isolating the worker's network cuts the **authProxy → opencode** path. Today
the per-worker authProxy (`authproxy.go`) listens on `127.0.0.1:externalPort`
in the shared pod netns and reverse-proxies to `opencode` on
`127.0.0.1:internalPort` — same loopback, so it "just works". Once opencode
moves into its own netns, that loopback no longer spans the two, and the worker
also loses its route to the control plane, gateway, and external egress
(git/gh/npm).

Candidate resolutions (to be decided in review, then validated on the gVisor
node — the acceptance bar is the "required connectivity is preserved"
scenarios in `specs/langy/langy-worker-isolation.feature`):

1. **veth pair per worker** — a virtual cable from each worker netns to the pod
   netns, with addressing/routing so the authProxy reaches `opencode` across it
   and the worker reaches outward. Most control; most plumbing.
2. **UNIX-domain socket for opencode** — sidesteps netns entirely: opencode
   listens on a socket in its `0700` home, reachable only by its own UID. Simpler
   and needs no `SYS_ADMIN`, but blocked upstream — opencode does not expose a
   `unix:` listen flag today (noted in `authproxy.go`).
3. **Fix C** — if the connectivity plumbing for (1) proves too costly, revisit
   pod-per-worker despite the density ceiling.

This ADR fixes the **direction** (topology-based isolation, not netfilter). The
connectivity mechanism is deliberately left to implementation review because it
is the load-bearing design choice and cannot be validated except on a live
gVisor node.

## Consequences

- `services/langy-agent/iptables.go` and its `serve.go` call site are retired
  once the netns path lands; the loopback port-range reservation in
  `manager.go` / `worker.go` is superseded by per-worker isolation.
- The chart's `containerSecurityContext.capabilities` swaps `NET_ADMIN` for
  `SYS_ADMIN`; the change is only safe under `runtimeClassName: gvisor`.
- Provisioning the gVisor RuntimeClass itself remains langwatch-saas#620 /
  #619; this ADR is the application-side half that unblocks it.
- Until this lands, `runtimeClassName: gvisor` must NOT be set on langy-agent
  in production (it would crash-loop). The langwatch-saas Terraform
  `lifecycle.precondition` gate correctly keeps prod from deploying meanwhile.

## References

- Issue: langwatch/langwatch-saas#620 (provision gVisor RuntimeClass; capability matrix)
- PR: langwatch/langwatch-saas#619 (langy-agent production backend)
- PR: langwatch/langwatch#4913 (the NET_ADMIN loopback rule this replaces)
- Spec: `specs/langy/langy-worker-isolation.feature`
- Code: `services/langy-agent/iptables.go`, `authproxy.go`, `worker.go`, `serve.go`
