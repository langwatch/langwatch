# ADR-043: Langy egress enforcement — monitor first, enforce last

**Date:** 2026-07-10

**Status:** Draft

> **This is the PR4-of-4 design in the Langy egress-hardening series.** It is
> deliberately docs-only and **blocked on PR3**: it builds the enforcement rungs
> on top of the egress instrumentation seam (PR1) and the monitor-only telemetry
> (PR3). Nothing here should be implemented until PR3's seam is merged and has
> observed real traffic — the whole thesis is "let monitoring prove what's
> legitimate before anything blocks."

## Context

The `langyagent` pod runs many `opencode` workers as subprocesses. Each worker
holds a different user's **live** credentials in its environment — the project's
LangWatch API key, an AI-gateway virtual key, and (when connected) a GitHub
user-to-server token — and it executes LLM-generated shell. A prompt-injected
worker is therefore a realistic attacker, and the single highest-value action
that attacker can take is **outbound exfiltration**: `curl` the secrets it holds,
or the customer's trace/PII data it can read via MCP, to an attacker-controlled
host.

Two prior decisions bound the *pod* but not the *destination*:

- **ADR-033** closed sibling-to-sibling exfiltration (a worker driving another
  worker's `opencode` control port) with a per-worker `OPENCODE_SERVER_PASSWORD`,
  and established that **kernel netfilter is unavailable under gVisor** — the pod
  runs `runtimeClassName: gvisor`, whose Sentry implements no `iptables`/`nftables`
  in any backend. Any egress control that depends on `iptables` (transparent
  redirect, OWNER-match DROP, NAT) is off the table in this pod.
- The chart's NetworkPolicy (`charts/langyagent/templates/networkpolicy.yaml`)
  is deny-by-default at L3/L4. Its `allowExternalHttps` rule (default **off**;
  turned **on** for installs that need `git clone` / `gh` / package installs)
  opens `:443` to `0.0.0.0/0` with RFC-1918 and the cloud metadata service
  (`169.254.169.254`) carved out. That carve-out stops SSRF into internal
  services, but the moment `allowExternalHttps` is on, a worker may reach **any
  public host on :443** — this is the exfiltration hole this series closes.

NetworkPolicy cannot close it by itself: **L3/L4 policy cannot express FQDN
egress** ("allow github.com, deny everything else") without a CNI that adds a
DNS-aware datapath (Cilium). `docs/langy-github-app.md §4` already documents this
limitation. So the L7 controls have to live somewhere the pod actually controls.

The series splits the work so risk lands last:

| PR | Adds | Blocks anything? |
|----|------|------------------|
| PR1 | The **egress seam**: a per-worker forward proxy the worker's tools egress through (`HTTPS_PROXY` in the worker env), mirroring the existing per-worker `authProxy` inbound pattern. | No |
| PR2 | (series scaffolding — credential-envelope + config plumbing) | No |
| PR3 | **Monitoring** on the seam: every outbound `CONNECT` is observed, attributed to a worker/conversation, and emitted as telemetry; anomalies are flagged. Observe → detect → flag. | **No — nothing is denied.** |
| **PR4 (this ADR)** | **Enforcement** rungs on top: require-TLS + per-destination throttle, the **customer allow-list**, an always-on FQDN floor, and retirement of the superseded direct-egress path. | Yes — but default posture stays monitor-only. |

## Decision

We add an **enforcement ladder** to the egress adapter, climbed in the order
monitoring earned. Each rung is independently shippable behind config, and the
**default posture after PR4 is still monitor-only** — enforcement that could
break a customer's legitimate workflow is opt-in, and enforcement that is
always-on is scoped to destinations monitoring already proved are the only
legitimate ones.

### Rung 0 (inherited from PR3): always-on monitoring

Every outbound flow is observed and attributed. Nothing below removes this
floor; every deny/throttle/flag **also** emits the same telemetry, so an
enforced deny is a *monitored* deny. This is what makes "flag it" and "block it"
the same event with a different verb.

### Rung 1: require TLS + per-destination throttle

At the L7 adapter:

1. **Require TLS.** The adapter only proxies opaque `CONNECT host:443` tunnels.
   It refuses to forward cleartext `http://` requests to external hosts. A
   worker that tries to exfiltrate over plaintext HTTP to a public host is
   denied at the seam (the destination never sees the bytes). Loopback and the
   in-cluster control-plane/gateway paths are unaffected (they have their own
   explicit rules; see "Legitimate paths" below).
2. **Per-destination throttle.** The adapter cannot see inside TLS, so the
   throttle is on the *shape* of the flow, not its content: new-connection rate
   and bytes-transferred **per destination host, per worker**. A worker opening
   a burst of connections to a rare host, or streaming a large volume to one
   destination — the classic exfiltration signature — is throttled (slowed, then
   tar-pitted) rather than hard-denied. Throttle is a *soft* rung on purpose: it
   degrades a suspicious flow without a false-positive cliff, and it always
   flags (rung 0) so an operator sees it.

### Rung 2: customer-configurable allow-list (the crux)

**Enforcement is the customer's policy, not ours.** Each project may set an
optional allow-list of hosts Langy's workers may reach. The semantics are the
whole point:

- **No allow-list set → monitor only.** Every destination is *observed and
  flagged* (rung 0) but **nothing is blocked** on allow-list grounds. This is the
  default. A customer who does nothing gets watching, not breakage.
- **Allow-list set → restrict to it.** Every host on the list is allowed;
  **every other host is denied** and flagged. The customer has opted in to
  enforcement, and the enforcement is exactly the set they declared they trust.

An allow-list ("hosts I trust") is a cleaner mental model than a deny-list
("hosts I fear") — it is finite, it composes with the always-on monitoring
beneath (the monitor tells you what to *add* to the list), and its default of
"unset = watch" is safe. A deny-list's default of "unset = allow-all" is not,
and a deny-list can never be complete.

### Rung 3: FQDN-bounded floor (always-on, once proven)

Independently of the customer's allow-list, the adapter enforces a small,
operator-controlled **floor** of the destinations Langy structurally needs:
`github.com` / `api.github.com` / `codeload.github.com` (PR-opening), the AI
gateway, and the LangWatch control plane. This floor is the last rung because it
is only safe to make always-on **after monitoring (PR3) has proven this is
actually the complete set of legitimate destinations** — turning it on before
that risks silently breaking a real workflow nobody knew existed. The floor and
the customer allow-list compose: the effective allow set is `floor ∪
customer-list`; when the customer sets no list, the floor is still enforced but
everything else is monitor-only (the floor is a floor, not a ceiling).

### Rung 4: drop the legacy synchronous egress path

Once the seam is the sole egress path, the direct worker-to-internet path it
superseded is removed: the worker env no longer offers unproxied egress, and the
broad `allowExternalHttps` `0.0.0.0/0:443` NetworkPolicy rule is narrowed to
"the adapter's own upstream," so the L3/L4 backstop and the L7 adapter agree on
one chokepoint. This rung lands last because it is only safe once rungs 1-3 have
been observed working in production against real traffic.

## Where FQDN enforcement lives

**In the Go egress adapter, at L7 — not in NetworkPolicy, and not requiring a
particular CNI.** The adapter terminates the worker's `CONNECT github.com:443`
and reads the FQDN **directly out of the CONNECT authority** (and, as a
cross-check, the TLS SNI). That is the only place in this pod where an FQDN is
observable without netfilter, which ADR-033 established is dead under gVisor.
NetworkPolicy stays exactly as it is: the coarse L3/L4 backstop with the RFC-1918
+ metadata carve-out. It is not asked to do FQDN, because it cannot.

**Honest limit — the L7 adapter is cooperative, not mandatory, in the stock
pod.** Within one pod netns, nothing at L3/L4 forces a worker's traffic *through*
the loopback proxy: a prompt-injected worker can ignore `HTTPS_PROXY` and
`connect()` straight to an external `IP:443`, because the pod-level NetworkPolicy
still permits `:443` egress (it must — the proxy itself egresses there, and L4
can't tell proxy bytes from worker bytes). Under gVisor we cannot `iptables
REDIRECT` worker traffic into the proxy. So the adapter's FQDN/allow-list/TLS
enforcement is authoritative for **cooperating** clients and is the primary
mechanism; the **bypass path is not blocked but it is still *seen*** — PR3's
monitoring must be at the flow level (VPC flow logs / a CNI flow layer), not
only at the proxy, precisely so a direct-IP bypass is observed and flagged even
when it isn't blocked. Two optional floors make enforcement *mandatory* for
operators who need it, and the ADR recommends them without hard-requiring either:

- **Preferred: a Cilium FQDN egress policy at the CNI.** Where the operator runs
  Cilium, a `CiliumNetworkPolicy` with `toFQDNs` enforces the same allow set in
  the datapath, which a worker cannot bypass. The adapter and the CNI policy
  enforce the *same* list; the adapter is the CNI-agnostic default, the Cilium
  policy is the bypass-proof upgrade.
- **Fallback: the ADR-033 "Fix B" per-worker netns.** Put each worker in its own
  network namespace whose only route out is the adapter's veth. ADR-033 validated
  this works under gVisor (needs `CAP_SYS_ADMIN`) and named the missing piece —
  "egress without NAT needs a userspace forward proxy over the veth" — which *is*
  this adapter. So if a customer needs bypass-proof enforcement without Cilium,
  Fix B + this adapter is the combination, at the cost of the broader capability.

## Where the allow-list config lives

**A per-project setting, resolved by the control plane and threaded into the
existing per-request credentials envelope** — never a hardcoded list, never a
chart value (which would be per-install, not per-project).

This mirrors the model-allow-list precedent exactly. Today
`LangyCredentialService.getModelsAllowed()` reads a project's `modelsAllowed`
and `langy.ts` enforces it server-side as defense-in-depth before dispatch
(`platform/app/src/server/routes/langy.ts:389-409`). The egress allow-list follows
the same shape, with one deliberate divergence:

- **Home: a project-level Langy egress policy, not the virtual key's config.**
  `modelsAllowed` lives on the `VirtualKey` because the *gateway* is its
  enforcement point and the VK is the gateway's unit of policy. The egress
  allow-list's enforcement point is the *agent pod's egress adapter*, not the
  gateway — putting it on the VK would be a category error. It is a Langy
  project network policy, so it lives with the project (a nullable
  `Project.langyEgressAllowlist` JSON column, or a small `LangyEgressPolicy`
  row keyed by `projectId` — PR4 picks one; the plan proposes the column for
  parity with the existing per-project Langy fields).
- **Resolution: `LangyCredentialService.getEgressAllowlist({ projectId })`**,
  returning `string[] | null`. `null`/empty ⇒ monitor-only (rung 2 default);
  non-empty ⇒ the enforced set. Same `null-means-watch` convention as
  `getModelsAllowed`.
- **Transport: the credentials envelope.** `LangyCredentials` gains
  `egressAllowlist?: string[]`; the Go `Credentials` struct
  (`services/langyagent/adapters/workerpool/worker.go`) gains the matching `egressAllowlist` field.
  It rides the same per-`/chat` path every other capability rides — no second
  channel. Because a worker is per-conversation and capabilities are bound at
  spawn (the `CredentialSignature` pattern), the allow-list is bound at spawn
  too: a change to the project's list recycles the worker on its next turn, so a
  live worker never silently runs under a stale policy. The per-worker egress
  adapter is constructed with that worker's list, exactly as `startAuthProxy` is
  constructed with that worker's password.
- **The presence of the list is the mode.** No separate `egressMode` enum: an
  absent/empty list *is* monitor-only and a non-empty list *is* enforce. This is
  the whole "default watch, opt-in to restrict" decision expressed as one field,
  and it keeps the envelope minimal.

## Rationale / trade-offs

- **Why monitor-first, enforce-last.** The failure mode of premature egress
  enforcement is a silently broken customer workflow (a package registry, a
  private git host, an internal API the customer legitimately reaches) with no
  data to tell you it was legitimate. Monitoring first turns "I think this is
  the allow set" into "here is the observed allow set," so every block is a
  block of something we watched not being used. It also lets a customer read
  their own traffic before deciding to enforce, which is what makes the
  allow-list *theirs*.
- **Why customer-owned allow-list, not a LangWatch-owned deny-list.** We do not
  know a given customer's legitimate destinations — their internal hosts, their
  registries, their git remotes. A deny-list we maintain is both incomplete
  (misses their attacker) and wrong (blocks their internal host). An allow-list
  they own is complete *for their environment* by construction, and the default
  of "unset = watch" means we never break an install that hasn't opted in.
- **Trade-off accepted: cooperative L7 enforcement has a bypass in the stock
  pod.** We accept this because (a) the bypass is *monitored*, not invisible;
  (b) the honest alternative — mandatory enforcement — costs either a CNI
  dependency (Cilium) or the broader `CAP_SYS_ADMIN` + per-worker netns of
  ADR-033 Fix B, neither of which every operator wants; and (c) we surface both
  as documented upgrades. Pretending L3/L4 policy can FQDN-block, or that the
  loopback proxy is unbypassable, would be the worse outcome.
- **Trade-off accepted: throttle is heuristic.** Byte/connection-rate signatures
  are not proof of exfiltration; they can false-positive on a legitimate large
  clone. That is exactly why throttle *slows and flags* rather than hard-denies,
  and why the hard-deny rung (allow-list) is customer-scoped.

## Consequences

- **Config surface.** A new per-project `langyEgressAllowlist` (nullable) and a
  `LangyCredentialService.getEgressAllowlist` resolver; `LangyCredentials` and
  the Go `Credentials` struct each gain `egressAllowlist?: string[]`. `langy.ts`
  threads it into the envelope, alongside the existing model/GitHub plumbing.
- **Egress adapter.** The PR1 adapter gains, per rung: a TLS-required guard, a
  per-destination throttle, an allow-list matcher (host + the always-on floor),
  and the FQDN read from the CONNECT authority. All four *also* emit PR3's
  telemetry, so every enforcement action is a monitored event.
- **Chart.** `charts/langyagent`: the always-on floor becomes a values list
  (`networkPolicy.egressFqdnFloor` / adapter config), documented as "operator
  floor, not customer policy." The broad `allowExternalHttps: 0.0.0.0/0:443`
  rule is narrowed to the adapter's upstream once rung 4 lands. Optional Cilium
  `CiliumNetworkPolicy` with `toFQDNs` shipped as an opt-in template for
  bypass-proof installs; ADR-033 Fix B referenced as the non-Cilium bypass-proof
  fallback.
- **Docs.** `docs/langy-github-app.md §4` (which already flags the L3/L4 FQDN
  limitation and names Cilium) is updated to point at the adapter as the primary
  FQDN enforcement point and this ADR as the design.
- **No new user-facing breakage by default.** Because default posture stays
  monitor-only, an existing install upgrades into *watching*, not *blocking*.
  Blocking begins only when a customer sets an allow-list, or when an operator
  turns on the FQDN floor / rung 4 after reading their monitoring.
- **Hard dependency on PR3.** None of PR4 is safe to build or merge before PR3's
  monitoring seam exists and has observed real traffic — the enforcement rungs
  are defined *relative to* what monitoring proved legitimate. This ADR exists so
  PR4 is a fast-follow the moment PR3 lands.

## Decision: worker→manager hard network isolation (Fix B)

This section records the **enforcement target** for the one gap the L7 egress
adapter above cannot close by itself. It is a **design/decision, not implemented
in this PR** — the adapter + NetworkPolicy + the applied hardening are the
interim posture; this is the mandatory-enforcement end state.

### Finding (F1): same-netns loopback reachability

Workers are subprocesses inside the **manager's pod network namespace**. That
means `127.0.0.1:<manager-port>` (the `/chat` control listener) and the sibling
per-worker authproxy / opencode ports are **loopback-reachable from any worker**.
A NetworkPolicy operates at L3/L4 on pod-to-pod / pod-to-CIDR traffic; it **cannot
filter same-netns loopback**, so no NetworkPolicy (nor the Cilium `toFQDNs`
policy, nor the CGNAT carve-out) constrains a worker dialing the manager or a
sibling on `127.0.0.1` / the pod IP. Today the manager↔worker boundary is held
**by AUTH only** — the internal service secret is stripped from the worker's env
(`sensitiveEnvPattern` in
`services/langyagent/adapters/workerpool/worker.go`), so a worker that reaches
`/chat` gets a `401`. That is a real control, but it is a **single, fragile
layer**: any future code path that leaks the secret into the worker env, or any
manager endpoint that doesn't check it, re-opens the hole.

### Decision

Give each worker its **own network namespace** and route its egress through a
**manager-run CONNECT forward proxy**:

- **Per-worker netns.** `unshare(CLONE_NEWNET)` for the worker, joined to the
  manager by a **veth pair** configured so the manager can reach the worker's
  opencode control port, but the worker **has no route** to the manager's
  `/chat` port, the authproxy/opencode ports of siblings, or the pod IP. This
  makes F1's loopback reachability structurally impossible rather than
  auth-gated.
- **Egress via `HTTPS_PROXY`/`HTTP_PROXY`** pointed at a **manager-run CONNECT
  forward proxy** — the same proxy shape the L7 egress adapter already is. This
  is **gVisor-safe**: it needs no netfilter/NAT (there is none under gVisor), and
  `git` / `gh` / `npm` / `opencode` already honour `*_PROXY`. That forward proxy
  becomes the **central egress enforcement chokepoint**: because the worker has
  no other route out of its netns, it **cannot** ignore `*_PROXY` and `connect()`
  straight to an external IP the way it can in the shared-netns model. This is
  the **true hard block for F1** and it **subsumes the NetworkPolicy CIDR
  allow/deny list** (it is CGNAT-proof — enforcement is by route, not by CIDR
  match).

### Rejected alternatives

- **iptables/nftables `OUTPUT` owner-match.** The gVisor Sentry has **no
  netfilter backend** — the owner-match approach was removed in commit
  `9d5265745`, and re-adding it regresses gVisor compatibility. Kernel-firewall
  egress control is simply unavailable in this sandbox; this is the root reason
  enforcement lives at L7 in the first place.
- **Any bind-address trick** (binding `/chat` to a non-loopback address, or to
  the pod IP only). A same-netns peer can dial `127.0.0.1` **or** the pod IP
  identically — there is no bind address that hides a listener from a peer in the
  same netns. No bind hard-blocks a same-netns worker.

### Cost / consequences

- Adds **`CAP_SYS_ADMIN`** to the manager (for `unshare(CLONE_NEWNET)` + veth
  setup), **per-worker veth + IPAM**, and their **teardown**, plus some **spawn
  latency**. Per-worker netns creation under gVisor is **validated feasible per
  ADR-033**.
- **Interim residual risk (until Fix B ships):** the worker→manager boundary is
  **auth-only** isolation (secret stripped from worker env → `401`). This is
  mitigated — not closed — by the hardening already applied alongside PR4: the
  CGNAT (`100.64.0.0/10`) egress deny, the dropped default-ServiceAccount token
  (`automountServiceAccountToken: false`), and the opt-in public-subnet node
  placement. Fix B is the item that upgrades this from *mitigated* to *closed*.

Marked here as the **enforcement target**; not implemented in code in this PR.

## References

- Related ADRs: ADR-033 (Langy worker network isolation under gVisor — the
  netfilter-is-dead constraint and the Fix B netns fallback this builds on).
- Spec: `specs/langy/langy-egress-enforcement.feature`
- Plan: `specs/langy/langy-pr4-plan.md`
- Code seams: `services/langyagent/adapters/workerpool/authproxy.go` (per-worker proxy pattern the
  egress adapter mirrors), `services/langyagent/adapters/workerpool/worker.go` (`Credentials`
  envelope + `buildWorkerEnv`), `services/langyagent/adapters/httpapi/handlers.go` (`/chat`
  dispatch), `platform/app/src/server/routes/langy.ts` (envelope construction +
  defense-in-depth allow-list check), `platform/app/src/server/services/langy/
  LangyCredentialService.ts` (`getModelsAllowed` precedent).
- Chart: `charts/langyagent/templates/networkpolicy.yaml`,
  `charts/langyagent/values.yaml` (`networkPolicy.allowExternalHttps`).
- Docs: `docs/langy-github-app.md §4` (NetworkPolicy / egress; existing FQDN /
  Cilium note).
