# Plan: Langy egress enforcement (PR4 of 4)

- **ADR:** `dev/docs/adr/043-langy-egress-enforcement.md`
- **Spec:** `specs/langy/langy-egress-enforcement.feature`
- **Branch (design):** `design/langy-pr4` (this doc + ADR + spec; docs-only)
- **Implementation branch (later):** `feat/langy-egress-enforcement`
- **BLOCKED ON PR3** — the egress instrumentation seam (PR1) and the monitor-only
  telemetry (PR3) must be merged and have observed real traffic first. Every rung
  below is defined relative to what PR3's monitoring proved legitimate. Do not
  implement until PR3 lands.

## Goal

Turn the always-on egress *monitoring* PR3 provides into an enforcement ladder,
climbed in the order monitoring earned, with the default posture staying
monitor-only:

1. **Require TLS + per-destination throttle** at the L7 adapter.
2. **Customer allow-list** — per-project, opt-in. Unset ⇒ monitor only; set ⇒
   restrict to it. This is the crux: enforcement is the customer's policy.
3. **FQDN floor** — always-on for the destinations Langy structurally needs
   (GitHub / gateway / control plane), once monitoring proved that set.
4. **Drop the legacy synchronous egress path** superseded by the seam.

## Target flow (config → envelope → adapter)

```
 Project settings                Chat time (langy.ts /chat)          Worker pod (Go adapter)
 ────────────────                ──────────────────────────          ───────────────────────
 customer sets                   getOrProvision()                    spawnWorker()
 egress allow-list  ──────┐       + getEgressAllowlist()  ───┐        + startEgressAdapter(
 (per-project, nullable)  │             │                    │            allowlist, floor)
                          │             ▼                    │              │
                          │      credentials.egressAllowlist │              ▼
                          │             │                    └──► worker env: HTTPS_PROXY
                          └─────────────┴──► /chat body ──────────► Credentials{egressAllowlist}
                                                                            │
   null/empty  = monitor only  ◄── presence of list IS the mode ──►  non-empty = enforce
                                                                            │
                                                                    per-CONNECT decision:
                                                                    require-TLS → throttle →
                                                                    allow-list ∪ floor → flag
```

## What already exists (reuse, don't reinvent)

| Thing | Where | Reuse for |
|---|---|---|
| Per-worker proxy pattern (inbound) | `services/langyagent/adapters/workerpool/authproxy.go` (`startAuthProxy`, per-worker listener + secret, `shutdown`) | The egress adapter is the **outbound** twin: per-worker forward proxy, constructed with that worker's policy, shut down with the worker. Mirror it — don't invent a new topology. |
| Credentials envelope | `services/langyagent/adapters/workerpool/worker.go` `Credentials` struct + `buildWorkerEnv`; TS `LangyCredentials` | Add `egressAllowlist` to both; inject `HTTPS_PROXY` (loopback adapter) into the worker env in `buildWorkerEnv`. |
| Capability-change worker recycle | `worker.go` `CredentialSignature` / `signatureOf` | Add `egressAllowlist` to the signature so a policy change recycles the worker (spec: "does not leave a live worker on the old policy"). |
| Model allow-list precedent | `LangyCredentialService.getModelsAllowed()` + defense-in-depth check in `langy.ts:389-409` | Copy the shape for `getEgressAllowlist()` (`string[] | null`, null = watch) and the envelope threading. |
| Envelope construction | `platform/app/src/server/routes/langy.ts:367,482-494` | Add `egressAllowlist` to the `/chat` body next to `modelOverride`. |
| NetworkPolicy egress + carve-outs | `charts/langyagent/templates/networkpolicy.yaml`, `values.yaml` `networkPolicy.allowExternalHttps` | Narrow the `0.0.0.0/0:443` rule to the adapter's upstream (rung 4); add the FQDN-floor values + optional Cilium template. |
| gVisor / netfilter constraint + netns fallback | ADR-033 | FQDN enforcement lives at L7 (no netfilter); Fix B netns is the non-Cilium bypass-proof floor. |

## Config schema

**Per-project setting (control plane).** Nullable; unset = monitor-only.

- `Project.langyEgressAllowlist Json?` — an array of host patterns
  (`["registry.npmjs.org", "*.internal.acme.com"]`), validated through a Zod
  schema at read time (mirror `parseVirtualKeyConfig`). Chosen over a VK-config
  field because the *adapter*, not the gateway, enforces it — the VK is a
  category mismatch (ADR §"Where the allow-list config lives"). A dedicated
  `LangyEgressPolicy` row keyed by `projectId` is the alternative if we want an
  audit trail on policy changes; the column is proposed for parity with the
  existing per-project Langy fields.
- Resolver: `LangyCredentialService.getEgressAllowlist({ projectId }): Promise<string[] | null>`.
  `null`/empty ⇒ monitor-only; non-empty ⇒ enforced set.

**Envelope (both sides).**

- TS `LangyCredentials` gains `egressAllowlist?: string[]`.
- Go `Credentials` gains `EgressAllowlist []string \`json:"egressAllowlist,omitempty"\``.

**Operator floor (chart, not per-project).**

- `charts/langyagent/values.yaml`: `networkPolicy.egressFqdnFloor: [github.com,
  api.github.com, codeload.github.com, <gateway>, <control-plane>]` — the
  always-on rung 3 set, documented as "operator floor, not customer policy."
- Effective allow set at the adapter = `floor ∪ customerAllowlist`.

## Enforcement points (file by file)

Control plane (TypeScript):

- [ ] `prisma/schema.prisma` — add `langyEgressAllowlist Json?` to `Project`
      (+ migration). Include `projectId` in every read (multitenancy).
- [ ] `platform/app/src/server/services/langy/LangyCredentialService.ts` — add
      `getEgressAllowlist({ projectId })`, Zod-validated, `string[] | null`,
      `null` = watch. Mirror `getModelsAllowed` (tenancy in the WHERE, parse
      through Zod so a drifted value fails closed rather than disabling
      enforcement).
- [ ] `platform/app/src/server/routes/langy.ts` — resolve the allow-list and add
      `egressAllowlist` to the `credentials` object built at ~L367; it then
      rides the existing `/chat` body at L482-494. No new channel.
- [ ] Settings UI (optional, can trail the enforcement): a per-project "Langy
      egress allow-list" editor. Follow `dev/docs/best_practices/` (scope
      selector, drawers). Copy per `copywriting.md`: say what it does for the
      customer ("hosts Langy may reach for this project — leave empty to watch
      without blocking"), not how it's built. **Not required for PR4 to
      enforce** — the resolver + envelope are the enforcement path; UI is how a
      customer sets the value (a tRPC mutation writing the column is the minimum).

Agent pod (Go, `services/langyagent/`):

- [ ] `egressadapter.go` (new) — per-worker forward proxy mirroring
      `authproxy.go`: `startEgressAdapter({ allowlist, floor, throttle }) ->
      *egressAdapter` with `shutdown()`. Per-`CONNECT` decision pipeline:
      1. **require-TLS** — accept only `CONNECT host:443` tunnels; refuse
         cleartext forward to external hosts.
      2. **throttle** — per-destination-host, per-worker new-connection-rate +
         byte-rate limiter; slow + tar-pit, never a hard cliff.
      3. **allow-list ∪ floor** — read FQDN from the CONNECT authority (SNI as
         cross-check); if the effective set is non-empty and the host is not in
         it, deny; if the customer set is empty, allow (monitor-only) but the
         floor still applies.
      4. **flag** — every decision (allow / throttle / deny) emits PR3's
         telemetry, attributed to the conversation. Enforcement = a monitored
         event with a verb.
- [ ] `worker.go` — `Credentials` gains `EgressAllowlist`; `signatureOf` folds
      it in (policy change → recycle); `buildWorkerEnv` injects
      `HTTPS_PROXY=http://127.0.0.1:<egressPort>` (and `HTTP_PROXY`, `NO_PROXY`
      for loopback + in-cluster) so worker tools egress through the adapter.
- [ ] `manager.go` — allocate the per-worker egress port, start/stop the adapter
      alongside the existing authProxy in the worker lifecycle.
- [ ] `handler.go` — thread `req.Credentials.EgressAllowlist` through to
      `mgr.Get` (already carries `creds`); no schema surprise, it's on
      `Credentials`.
- [ ] `egressadapter_test.go` (new) — the security-critical Go tests: cleartext
      refused; non-listed host denied (bytes never sent); listed host allowed;
      empty list = allow + flag; floor always allowed; throttle slows one
      destination without slowing others; policy-change recycles the worker.
      These are the executable acceptance bar (not string assertions).

Chart:

- [ ] `charts/langyagent/values.yaml` + `templates/` — add
      `networkPolicy.egressFqdnFloor` (adapter config) and a documented "floor,
      not policy" note. **Rung 4:** narrow `allowExternalHttps`'s
      `0.0.0.0/0:443` to the adapter's upstream once the adapter is the sole
      egress path. Optional `templates/ciliumnetworkpolicy.yaml` (guarded by a
      values flag) with `toFQDNs` for bypass-proof installs; reference ADR-033
      Fix B (per-worker netns) as the non-Cilium bypass-proof fallback in the
      values comment.

Docs:

- [ ] `docs/langy-github-app.md §4` — update the existing L3/L4-FQDN note to
      point at the egress adapter as the primary FQDN enforcement point and
      ADR-043 as the design; keep the Cilium option, add the netns fallback.

## Safe rollout order (monitor → throttle → block)

Each step is independently shippable and observable before the next. **The
default posture never blocks until a customer or operator opts in.**

1. **PR3 (dependency), monitor-only.** Adapter observes + attributes + flags.
   Nothing denied. Bake in prod; read the traffic.
2. **Rung 1a — require TLS.** Turn on cleartext refusal. Low false-positive risk
   (worker egress is HTTPS already); watch the flag stream for any legitimate
   plaintext flow first.
3. **Rung 1b — throttle.** Enable per-destination throttle. Soft by design;
   tune thresholds against the monitored byte/connection distributions from
   step 1. Still no hard denies.
4. **Rung 2 — customer allow-list.** Ship the resolver + envelope + adapter
   matcher. Default stays monitor-only (unset list). Customers opt in per
   project after reading their own monitored traffic. First hard-deny rung, but
   customer-scoped.
5. **Rung 3 — FQDN floor.** Only after monitoring across installs confirms the
   structural set (GitHub / gateway / control plane) is complete, make the floor
   always-on. Operator flag; off by default until proven per install.
6. **Rung 4 — drop the legacy path.** Once rungs 1-3 are observed working,
   remove unproxied worker egress and narrow the `0.0.0.0/0:443` NetworkPolicy
   rule to the adapter upstream. Last, because it's the irreversible one.

## Acceptance

The bar is `specs/langy/langy-egress-enforcement.feature`, bound to executable
Go tests in `egressadapter_test.go` (deny/allow/throttle/require-TLS/floor/
recycle) plus a control-plane integration test that `getEgressAllowlist` returns
`null` = watch and a set list = enforce, and that the envelope carries it.
Scenarios stay `@unimplemented` until bound to those tests. The honest-limit
scenario (direct-IP bypass observed-but-not-blocked in the stock pod) is asserted
against the monitoring layer, and the Cilium / netns floors are the documented
bypass-proof upgrades.

## Open questions

1. **Host-pattern syntax for the allow-list.** Exact hosts only, or wildcards
   (`*.internal.acme.com`)? Wildcards are more usable but widen the matcher's
   attack surface. Proposal: start exact-host + a single leading-label wildcard;
   validate through Zod.
2. **Adapter config home for the column vs a `LangyEgressPolicy` row.** Column is
   simplest and matches existing per-project Langy fields; a row gives a change
   audit trail. Proposal: column now, revisit if customers ask for policy
   history.
3. **Throttle thresholds.** Must be derived from PR3's observed distributions,
   not guessed — so the numbers are a step-3 tuning task, not a design constant.
4. **Does the customer allow-list also gate the FQDN floor?** No — floor is
   operator-owned and always-on once enabled; the customer list is additive
   (`floor ∪ list`). Confirmed in ADR §Rung 3.
5. **Bypass-proofing default.** Do we ship Cilium `toFQDNs` on by default where
   Cilium is present, or leave it opt-in? Proposal: opt-in template; the stock
   default is cooperative-adapter + monitored-bypass, upgradable per install.
