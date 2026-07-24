# ADR-033: Langy worker network isolation under gVisor

**Date:** 2026-07-02 (revised 2026-07-07)

**Status:** Draft

> **2026-07-07 revision.** The original draft chose per-worker network
> namespaces ("Fix B") and left the connectivity mechanism open. Empirical
> testing on the gVisor node then found that the sibling-exfiltration hole
> exists **only because `opencode`'s control server is left unauthenticated** —
> not because loopback TCP is unfixable. `opencode` has a built-in
> `OPENCODE_SERVER_PASSWORD`. Setting it per worker closes the exact hole in
> ~10 lines with no new capability and no new network topology. The decision is
> now **Fix A′ (per-worker opencode password)**; Fix B is retained below as a
> validated fallback. See "Decision" and "What changed and why".

## Context

The `langy-agent` pod runs many `opencode` workers as subprocesses inside a
single pod. Each worker runs as a distinct UID and holds a different user's
live credentials (`LANGWATCH_API_KEY`, GitHub token, LLM virtual key) in its
environment. Workers execute LLM-generated shell, so a prompt-injected worker A
is a realistic attacker against sibling worker B.

Two walls separate siblings today:

1. **Filesystem** — per-worker UID + `0700` home. Stops A reading B's files.
2. **Network** — an `iptables` OUTPUT OWNER-match DROP rule on the shared pod
   loopback (`services/langy-agent/iptables.go`, PR #4913). Intended to stop A
   from `connect()`-ing to B's opencode TCP port after scanning
   `/proc/net/tcp`.

Issue langwatch-saas#620 requires this pod to run under gVisor
(`runtimeClassName: gvisor`) to harden the pod→host escape surface, because
this is the highest-risk workload on the cluster (arbitrary LLM-driven shell).

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

## The actual root cause (established 2026-07-07)

The iptables rule was treating the symptom. The disease is that **opencode's
HTTP control server has no authentication by default**. When
`OPENCODE_SERVER_PASSWORD` is unset, opencode prints
`Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured` and serves
every request — including `POST /session` and "run this shell" — to anyone who
can reach the port. On the shared pod loopback, sibling A can reach B's port
(scan `/proc/net/tcp`), so A can drive B's opencode to run shell as B and
exfiltrate B's live secrets.

The iptables rule tried to make the port unreachable. The port being reachable
is not the vulnerability; the port being **unauthenticated** is. Once opencode
requires a per-worker password, a sibling reaching the port gets `401` and
learns nothing — reachability stops mattering.

Empirically verified on the gVisor node (opencode-test pod, `octest2.sh`), with
opencode built on `@effect/platform` over Node's `http.Server`:

| Actor | Request | `OPENCODE_SERVER_PASSWORD` | Result |
|---|---|---|---|
| Sibling (attacker) | `GET /` | not sent | **401** |
| Sibling (attacker) | `POST /session` | wrong / none | **401** |
| authProxy (legit) | `GET /` | correct (Basic) | 200 |
| authProxy (legit) | `POST /session` | correct (Basic) | 200 |
| authProxy (legit) | `GET /session` | correct (Basic) | 200 |

Why the secret can't just be read back: the password is per-worker and lives
only in worker B's process environment. `/proc/<pid>/environ` is mode `0400`
owned by the process UID, so sibling A (a different UID) gets `EACCES` — this is
exactly the per-UID wall we already have and keep. Injecting via **env var, not
a CLI flag**, also keeps it out of the world-readable `/proc/<pid>/cmdline`.

## Decision

**Set a distinct random `OPENCODE_SERVER_PASSWORD` for every worker, and have
that worker's authProxy present it.** This is "Fix A′".

- Each worker gets a fresh random password (same generation path as the
  existing per-worker bearer token, `generateBearerToken` in `authproxy.go`).
- The password is injected into the worker's `opencode serve` environment
  (`worker.go`, alongside the existing `OPENCODE_*` env), so opencode requires
  HTTP Basic auth (user `opencode`, that password).
- The per-worker authProxy, which already terminates the external bearer token,
  swaps its current header-strip (`r.Header.Del("Authorization")`,
  `authproxy.go:81`) for a header-set: `Authorization: Basic
  base64("opencode:"+password)`. The legit control path keeps working; the
  sibling path — which never has the password — gets `401` from opencode
  itself.

This keeps the current dense architecture (one pod, many worker subprocesses)
and adds **no new capability, no network namespaces, no veth plumbing, and no
egress relay**. It is roughly a 10-line change across three files
(`manager.go` generates the password, `worker.go` injects it, `authproxy.go`
presents it).

### Layers kept vs dropped

| Layer | Fate under Fix A′ |
|---|---|
| gVisor sandbox (pod→host) | **Keep** — orthogonal, still the point of #620 |
| Per-worker UID (`uid.go`) | **Keep** — load-bearing; guards `/proc/<pid>/environ` |
| `0700` home + chown-before-secrets | **Keep** — filesystem wall |
| authProxy external bearer token | **Keep** — guards the pod's external port |
| env denylist (`filterSensitiveEnv`) | **Keep** |
| process-group kill (`Setpgid`) | **Keep** |
| **opencode password** (`OPENCODE_SERVER_PASSWORD`) | **Add** — closes sibling→control exfil |
| `iptables.go` + `serve.go` lockdown call | **Drop** — dead under gVisor, no longer needed |
| `getFreePortInRange` port-pinning | **Drop** — only existed to pin a port for the iptables rule |
| `NET_ADMIN` → `SYS_ADMIN` swap | **Drop** — not needed; keep the smaller cap set |
| per-worker netns + veth + egress relay | **Drop** — see fallback |

## What changed and why (vs the original Fix B draft)

The original draft reasoned "the iptables wall is dead under gVisor → replace
the *topology* so there's no shared loopback to filter." That is a correct fix
for an unauthenticated port, but an expensive one: `CLONE_NEWNET` needs
`CAP_SYS_ADMIN` (swapping the bounded `NET_ADMIN` for the kernel's broad
"junk-drawer" cap), and once opencode is in its own netns the authProxy→opencode
loopback and the worker's outward egress both break — requiring a userspace
egress relay (unproven at draft time).

Fix A′ removes the need for any of that by fixing the port's **authentication**
instead of its **reachability**. It is strictly less privileged (no cap swap),
less infrastructure (no netns/veth/relay), and smaller (no new subsystem), while
closing the same hole — verified above.

### Honest limits of Fix A′

The password closes **sibling → opencode-control exfiltration**, which is the
threat the iptables rule was for. It does **not** by itself defend against bugs
in opencode's own request handling, nor against a worker attacking the pod's
other loopback listeners. Those are covered by the layers we keep: the per-UID
+ `0700` filesystem wall, the env denylist, and the gVisor sandbox itself. Fix
A′ is the network-wall replacement, not a whole new security model.

## Fallback (validated, not chosen): Fix B — per-worker netns

If opencode ever removes `OPENCODE_SERVER_PASSWORD`, or a threat emerges that
authentication can't address (e.g. a pre-auth opencode RCE reachable over
loopback), the topology fix remains available and was validated on the gVisor
node:

- iptables is confirmed dead in **both** backends under gVisor (table above).
- `unshare -n` / `CLONE_NEWNET` **works** inside the gVisor sandbox once
  `SYS_ADMIN` is granted; cross-netns loopback connect is blocked, same-netns
  control succeeds.
- A **veth pair** across the worker netns carries TCP end-to-end (an initial
  "connection refused" was a listener-startup timing artifact under netstack —
  gVisor's bind needs a few seconds — not a datapath failure; confirmed with
  `ss` + a longer wait).

The unresolved cost of Fix B is worker **egress without NAT** (NAT = netfilter =
blocked), which would need a userspace forward-proxy over the veth. That plumbing
is why Fix B is the fallback, not the default. "Fix C" (pod-per-worker) is
rejected for the same reason as before: EKS caps pods at ~110/node via the VPC
CNI, and this service must support many concurrent conversations.

## Consequences

- `services/langy-agent/iptables.go` and its `serve.go` call site are retired;
  the loopback port-range reservation (`getFreePortInRange`) in `opencode.go` /
  `worker.go` is removed with them.
- `authproxy.go` changes its post-auth behavior from *strip* to *set* the
  `Authorization` header (Basic, per-worker password). `manager.go` generates
  the password; `worker.go` injects `OPENCODE_SERVER_PASSWORD` into the worker
  env.
- The chart's `containerSecurityContext.capabilities` **keeps** the current
  `NET_ADMIN`+set — there is no `SYS_ADMIN` swap. (`NET_ADMIN` may itself be
  droppable once `iptables.go` is gone; audit separately.)
- `runtimeClassName: gvisor` becomes safe to set on langy-agent once this lands,
  because nothing at startup depends on netfilter anymore. Until it lands, the
  langwatch-saas Terraform `lifecycle.precondition` gate correctly keeps prod
  from deploying gVisor on this pod.
- Provisioning the gVisor RuntimeClass itself remains langwatch-saas#620 / #619;
  this ADR is the application-side half that unblocks it.

## Acceptance

The bar is the scenarios in `specs/langy/langy-worker-isolation.feature`:
sibling isolation (a worker cannot drive another worker's opencode) **and**
required connectivity preserved (authProxy → opencode still works, worker egress
to control plane / gateway / git still works). Under Fix A′ the connectivity
scenarios are satisfied by construction (no topology change). The isolation
scenario is covered by automated Go tests: `authproxy_test.go`
(`TestWorkerIsolation_SiblingCannotAuthenticateWithoutPassword`,
`TestAuthProxy_*`) proves a sibling with no/incorrect credential is rejected
`401`, and `opencode_test.go` (`TestRequireOpenCodeAuthEnforced_*`,
`TestWaitForReadiness_*`) proves the fail-closed guard refuses to start a worker
whose opencode isn't enforcing the password on its control API. It was also
reproduced live against a running gVisor worker on the dev cluster (the `401`
results above). A full two-real-worker integration harness remains follow-up;
the feature scenarios stay `@unimplemented` until bound to it.

## References

- Issue: langwatch/langwatch-saas#620 (provision gVisor RuntimeClass; capability matrix)
- PR: langwatch/langwatch-saas#619 (langy-agent production backend)
- PR: langwatch/langwatch#4913 (the NET_ADMIN loopback rule this replaces)
- PR: langwatch/langwatch#5311 (this work; handoff notes + spike evidence)
- Spec: `specs/langy/langy-worker-isolation.feature`
- Code: `services/langy-agent/authproxy.go`, `worker.go`, `manager.go`,
  `iptables.go` (to retire), `serve.go`, `opencode.go`
