# ADR-130: Per-worker identity isolation is the operator's choice

**Date:** 2026-08-31

**Status:** Proposed

## Context

Langy runs many conversation workers as subprocesses inside **one** pod. Each
worker holds a different user's live credentials — the project's LangWatch API
key, an AI-gateway virtual key, a GitHub user-to-server token — and each worker
executes LLM-written shell. A prompt-injected worker is a realistic attacker,
and its most valuable neighbour is the worker next to it.

The boundary between siblings is a **Unix identity**. Every worker is given a
distinct UID; its home, tmp dir and session store are `chown`ed to that UID and
`chmod`ed `0700`/`0600`; the worker process is `setuid`ed into that UID before
`exec`. That is enforced by `adapters/runner/sandboxed/sandboxed.go`, which sets
`syscall.Credential{Uid, Gid}` on the child, and by the `Chown` calls in
`adapters/pi/spawn.go:217-282`.

**What that identity actually protects, on the pi harness, is narrower than the
chart's comments suggest** — and the difference is what makes this decision
tractable. Two things are already closed by construction:

- **The control channel is unreachable by a sibling at any UID.** A pi worker is
  driven over anonymous `os.Pipe()` stdio (`adapters/pi/spawn.go:302-331`), with
  newline-delimited JSON framing. There is no listener, no port and no path, so
  there is nothing for a sibling to dial: holding the fd *is* the authorization.
  `app/workerpool/pool.go:845` records it — "A pi worker has no listener and no
  authproxy: the stdio pipes are its only control surface." This is categorically
  stronger than opencode's loopback HTTP port, which a same-netns sibling could
  always reach and which needed `OPENCODE_SERVER_PASSWORD` to defend.
- **No secret is written to disk.** The pi worker config holds env var *names*,
  never values — `BaseURLEnv`/`APIKeyEnv` carry the literal strings
  `"OPENAI_BASE_URL"` / `"OPENAI_API_KEY"` (`spawn.go:26-29,119-121`), and
  `spawn.go:213-214` states the invariant directly. Every live credential reaches
  the worker through its environment (`buildWorkerEnv`, `spawn.go:387-409`).

So on pi the UID wall is not defending a control port or a credential file. It is
defending two things: each worker's **process environment**, readable by a
same-UID sibling through `/proc/<pid>/environ`, and each conversation's
**session directory**, which holds conversation content at `0700`.

Holding that boundary costs the container **root plus five capabilities**:
`CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETUID`, `SETGID`
(`charts/langyagent/values.yaml:157-185`). The chart's own header calls this
"counter-intuitive but load-bearing" and records the review that produced it
(`values.yaml:126-134`). The hardening around it is deliberate and documented:
drop `ALL` then add back exactly five, `allowPrivilegeEscalation: false`,
`readOnlyRootFilesystem: true`, and `fsGroup` **intentionally omitted**, because
"setting it would group-share every worker's files and re-open the cross-worker
boundary" (`values.yaml:148-149`).

### Two claims in our own specs are false

`specs/langy/langy-selfhost-install.feature:96-99` states that the controls
which bound the real attack are on by default "at no cost and identically on
every cluster: per-worker UID isolation, the per-worker password, and a
NetworkPolicy with egress off." Line 107 promises: "A default install runs the
assistant on any cluster."

There is a class of cluster where both are untrue, and it is not exotic. A
cluster running Pod Security Admission `restricted`, or a Gatekeeper /
Kyverno policy that requires `runAsNonRoot: true`, **refuses the Langy pod
outright**. The isolation does not cost nothing there; it costs the entire
install.

### How it fails, precisely

A customer evaluating LangWatch hit this. Their platform policy required
`runAsUser: 1000`, `runAsNonRoot: true`, `capabilities.drop: [ALL]`, and they
set those in their values. Two things then happen, and the order matters:

1. **Helm merges maps, it does not replace them.** Their `drop: ["ALL"]` merged
   with the chart's `add: [...]`, so the rendered pod still *requests* all five
   capabilities. This is specified behaviour —
   `specs/security/helm-strict-admission.feature:129-137` pins it — but it reads
   as though the override did nothing.
2. **The capabilities are inert anyway.** On a UID transition the kernel clears
   the effective and permitted sets of a non-root process. A container running
   as UID 1000 holds `CAP_SETUID` on paper and cannot use it.

So the pod is admitted, reports healthy, and dies at the first `Chown` in
provisioning — a failure that looks like a Langy bug rather than a policy
outcome.

### The mechanism to run without the wall already exists

`adapters/runner/localunsafe/localunsafe.go` implements the `app.Runner`
interface with `Chown`/`Lchown` as no-ops and `SysProcAttr` returning
`Setpgid: true` and **no `Credential`** — every worker runs as the manager's own
UID. It is selected at `cmd/root.go:53-59` by
`LANGY_UNSAFE_DEV_DISABLE_ISOLATION`.

It is barricaded out of production by **two independent guards**: `config.go:293`
and `localunsafe.go:35-46` each separately refuse unless `ENVIRONMENT` is one of
`local|dev|development|test`. The chart documents `environment` as
"SECURITY-LOAD-BEARING" for exactly this reason (`values.yaml:27-35`).

That double barricade is a considered judgement by whoever wrote it, and this
ADR overturns it. The reason it is safe to overturn is not that the risk went
away — it did not — but that the *shape* of the choice was wrong. A build-time
refusal decides for every operator that no Langy is better than Langy without
the UID wall. For a single-tenant install whose users are all colleagues in one
GitHub org, that trade is not obviously right, and it is not ours to make.

The corpus already agrees about what the wall is worth. ADR-053:725-729 weighed
this exact mechanism and ruled on it:

> **Per-user Unix accounts inside one Langy gVisor pod.** Rejected as the tenant
> boundary. It remains useful defense in depth, but gVisor isolates a sandbox
> from the host; it does not make sibling processes inside one sandbox separate
> tenants.

That is the settled position: the UID wall is defence in depth, not a tenant
boundary, and nothing in the shipped architecture ever claimed otherwise. An
operator trading defence in depth for an install they can actually run is making
a smaller decision than the double barricade implies — and one this corpus had
already declined to treat as the thing standing between tenants.

### The precedent this follows exactly

We have made this call before, one rung up.
`specs/langy/langy-deploy-hardening.feature:44-49` records it:

> Most self-managed clusters cannot offer a sandboxed runtime, and refusing
> them outright made the assistant hosted-only in practice. The invariant that
> survives is narrower and still worth having: nobody runs this workload
> unsandboxed by ACCIDENT. Accepting the reduced isolation is a value the
> operator writes down, so it shows up in their own values file and in review,
> rather than being the silent consequence of leaving a field blank.

`acceptUnsandboxedRuntime` is that decision. This ADR is the same decision
applied to the rung below it.

## Decision

**Per-worker identity isolation becomes an operator-visible posture with two
settings, defaulting to on. Disabling it requires a written acknowledgement, and
is refused without one.**

### 1. The dev-only runner is promoted to a supported posture

`adapters/runner/localunsafe` is renamed to `adapters/runner/sharedidentity`.
The implementation is unchanged — no-op `Chown`/`Lchown`, `SysProcAttr` without
a `Credential`. What changes is its gate: the `ENVIRONMENT` allowlist in both
`config.go:293` and the runner's own constructor is replaced by the operator
acknowledgement below. `LANGY_UNSAFE_DEV_DISABLE_ISOLATION` is replaced by
`LANGY_WORKER_ISOLATION`, taking `per-uid` (default) or `none`; any other value
fails closed at boot.

Local development uses the same path as a customer would, which is the point:
the posture a customer runs is one we exercise every day, rather than a
production-only branch nobody develops against.

### 2. The chart carries the acknowledgement

```yaml
workerIsolation: per-uid              # per-uid | none
acceptWorkerIsolationDisabled: false  # must be true to render with `none`
```

`none` without the acknowledgement is a **render-time `fail`**, joining the
existing guard family in `charts/langyagent/templates/deployment.yaml`
(`replicaCount != 1` at :4-6, blank `runtimeClassName` at :21-23). The failure
names what is being given up and the value that accepts it.

Under `none` the chart emits `runAsNonRoot: true`, `runAsUser: 1000`, and
`capabilities.drop: ["ALL"]` with no `add` — a pod spec that satisfies PSA
`restricted` and the common Gatekeeper/Kyverno rules without an exemption.

### 3. This posture depends on ADR-131 (opencode harness removal)

`workerIsolation: none` is only coherent on a pi-only worker pool, and that
removal is a decision of its own with its own blast radius. It is **ADR-131**,
and this ADR does not restate it — it depends on it.

The dependency is hard, not stylistic. Opencode cannot run two instances under
one identity: they collide on `~/.config/opencode/`. With the opencode harness
still present, `none` would additionally have to pin the pod to a single worker,
which is a different and much worse product. Pi has no equivalent constraint —
its session store is per-conversation and lives outside the worker home
(`specs/langy/langy-pi-harness.feature:120-128`).

So ADR-131 lands first. Until it does, `workerIsolation: none` must not ship.

### 4. The pool stops allocating UIDs it cannot apply

Today `app/workerpool/uid.go` and `pool.go:639` reserve a distinct
per-conversation UID unconditionally, even under the local runner that can never
apply it. Under `none` the allocation is skipped. Reserving an identity that
nothing enforces is a lie in the code that a future reader will believe.

### 5. The pod says so, loudly, at boot

Starting with isolation off logs a `WARN` naming the consequence — one
conversation's worker can read another's live credentials and conversation
content — so it appears in the first support bundle rather than being
reconstructed from a values file later.

## What the operator trades

| | `per-uid` (default) | `none` |
|---|---|---|
| Pod runs as | root, 5 capabilities | UID 1000, no capabilities |
| Admitted under PSA `restricted` | No | Yes |
| Sibling reaches sibling's control channel | Impossible (pipes) | **Impossible (pipes)** |
| Sibling reads sibling's credential file | No such file exists | **No such file exists** |
| Sibling reads sibling's `/proc/<pid>/environ` | Kernel refuses | **Possible** |
| Sibling reads sibling's session directory | Kernel refuses | **Possible** |
| Pod→host escape surface | `runtimeClassName` governs it, unchanged | same |
| Egress: NetworkPolicy + the L7 adapter (ADR-076, shipped) | unchanged | same |
| Egress: ADR-076's per-worker netns end state | reachable | **foreclosed** |

The two rows that change should be read at full strength. Under `none`, a
prompt injection in one conversation can read another conversation's live
LangWatch API key, gateway key and GitHub token out of that worker's process
environment, and can read the other conversation's content out of its session
directory. That is a real cross-tenant credential and data exposure, and no
amount of framing makes it small.

What is worth being equally precise about is that the first two rows do **not**
change. The sibling-to-sibling control-channel attack that ADR-033 was written to
close — worker A driving worker B's agent — stays structurally impossible,
because a pipe has no name to dial. Shared identity does not reopen it. And there
is no credential file to steal, because pi writes none. An operator weighing this
should be told what they are trading, not a worst case assembled from the
opencode era.

The last row is the one this ADR came closest to getting wrong. It is tempting
to write "egress is unchanged", and for everything ADR-076 actually **shipped**
— the NetworkPolicy, the L7 adapter, the allow-list, the SNI cross-check — that
is true. But ADR-076's own decided end state is per-worker network namespaces
(`076:338-348`, "the **true hard block for F1**"), and `076:365` records its
cost: "Adds **`CAP_SYS_ADMIN`** to the manager (for `unshare(CLONE_NEWNET)` +
veth setup)". A pod running `drop: ["ALL"]` as UID 1000 cannot ever climb that
rung. So `none` does not merely trade sibling identity — it **forecloses
ADR-076's mandatory-enforcement upgrade path** for as long as it is selected.
An operator who expects to need bypass-proof egress should stay on `per-uid`
and take the Cilium route ADR-076 names as its other option, which does not
depend on any capability in this pod.

## Honest limits

**This re-opens exactly the hole `fsGroup` was omitted to avoid.** The chart
declines to set `fsGroup` because it "would group-share every worker's files and
re-open the cross-worker boundary" (`values.yaml:148-149`). `workerIsolation:
none` does that deliberately and more completely — not a shared group, a shared
user. Anyone reading this ADR against that comment should see no contradiction:
the comment explains why it is not a *default*, and this ADR explains why it is
nonetheless a *choice*.

**A property in the pi spec changes meaning.**
`specs/langy/langy-pi-harness.feature:158-163` asserts the shared session stash
"stays unlistable, so sibling conversation ids stay hidden." That holds because
the stash is mode `0711` and owned by the manager while workers run as someone
else. Under `none` the worker *is* the manager's UID, so it can list the stash.
Conversation ids stop being hidden from siblings. The spec must say so rather
than continue to claim a property the posture removes.

**`sharedidentity` is not a sandbox.** It is the absence of one boundary, with
every other boundary intact. It should never be described as "still isolated."

**An Accepted ADR calls this exact pod shape known-unsafe, and it was right to.**
ADR-047:36-41 lists among the problems it was written to fix:

> The e2e pod manifest ships the **known-unsafe** `runAsUser: 1000` +
> all-caps-dropped config — the exact shape ADR-033 says re-opens cross-worker
> credential theft (and which also breaks per-worker UID isolation outright).

`none` emits that shape byte for byte, so the disagreement has to be met rather
than stepped around. What ADR-047 was fixing is named in its own sentence
before that one: "The chart's `values.yaml` *claims* it 'refuses to deploy'
without a sandboxed runtime, but **nothing enforces it**." The defect was a
manifest that drifted into the unsafe posture while the documentation said it
could not — the posture arrived by accident and no mechanism noticed. That is a
real bug and it stays fixed: the render-time `fail` in §2 is precisely the
enforcement ADR-047 found missing.

What this ADR adds is a second, guarded door to the same room, which ADR-047
never considered because in 2026-07 there was no customer who could not open the
first one. The shape is identical; the provenance is not, and provenance is what
the guard, the acknowledgement value and the boot `WARN` exist to establish. If
that distinction does not hold, this ADR is wrong — so it should be the first
thing a reviewer attacks.

**The exposure is the process environment, and that is not fixable by moving
files around.** Because pi keeps every secret in the worker's environment and
nothing on disk, the instinct to "just encrypt the config" or "keep credentials
out of files" buys nothing — they are already out of files. A same-UID sibling
reads `/proc/<pid>/environ` directly. The only designs that would close this
without a UID are handing the secret to the worker **over the pipe it is already
driven by**, so it never appears in the environment at all, or giving each worker
its own PID namespace. The first is genuinely attractive and would make this
posture substantially stronger; it is out of scope here because it is a change to
pi's protocol and to the wrapper that resolves the key
(`services/langyworker/src/models.ts:117`), not to the isolation decision. It is
recorded as the follow-up that would most improve `none`.

## Rejected alternatives

**User namespaces (`hostUsers: false`).** The pod appears non-root to the
cluster while the container keeps UID 0 and its capabilities inside. Rejected on
two grounds: it needs kernel 6.3+, containerd 2.0+ and runc 1.2+/crun 1.9+ (not
`runsc`, so it does not compose with our gVisor posture); and it does not
actually solve the customer's problem, because Gatekeeper and Kyverno lint the
**pod spec**, which still reads `runAsUser: 0`. It moves the constraint from the
kernel to the policy engine without satisfying either. Worse, containerd
silently ignores `hostUsers: false` when it cannot honour it, so a
misconfigured node reports success while running as host root.

**Ambient capabilities (KEP-2763).** Would let a non-root process hold
`CAP_SETUID` legitimately. Alpha, gated behind `AmbientCapabilities`, and the
safe-list may exclude `CAP_SETUID` precisely because it defeats the point of
`runAsNonRoot`. Not available to a customer on a managed control plane.

**File capabilities on the manager binary.** Killed by
`allowPrivilegeEscalation: false` setting `no_new_privs`, which we are not
giving up.

**gVisor plus a RuntimeClass-scoped policy exemption.** This works and is a
genuinely better posture where it is available: PSA supports
`exempt-runtime-classes` natively, and Gatekeeper/Kyverno can be written to
match. It is rejected as *the* answer only because it depends on the customer's
platform team installing a runtime and writing a policy rule. It composes with
this ADR rather than competing: an operator who can get that exemption should
take it and keep `per-uid`.

**Running Langy in a separate, exempted namespace.** Also viable, and a
different customer's answer. It needs the umbrella chart to wire the app to a
Langy it does not manage — today `langyagent.chartManaged: false` strips the
wiring too, a contract deliberately pinned by
`charts/langwatch/tests/e2e-overlays.sh:585-595`. That is a separate change with
its own design, not folded in here.

**ADR-053 Track D — one pod per conversation.** This is the real destination.
With one worker per pod there are no siblings, so there is no UID wall to
protect, no `setuid`, and no root. When Track D lands, `workerIsolation` is
**deleted, not migrated** — this ADR is explicitly a bridge, and it should not
outlive the thing it bridges to.

**Telling the customer to set `environment: dev`.** The existing escape hatch
reachable today without any code change. Rejected outright: `ENVIRONMENT` is
read by telemetry, logging and behaviour well beyond this guard, so it buys the
UID bypass by corrupting every other signal the install produces. A customer
following that advice would be lying to their own observability to work around
ours.

## Consequences

**Code.** `adapters/runner/localunsafe` → `adapters/runner/sharedidentity`, with
the environment allowlist removed from it and from `config.go:293`. UID
allocation in `app/workerpool/uid.go` becomes conditional. A boot `WARN` is
added. The opencode harness itself is ADR-131's change, not this one.

**The env-var rename reaches outside the service.**
`LANGY_UNSAFE_DEV_DISABLE_ISOLATION` → `LANGY_WORKER_ISOLATION` has two
independent producers and a tooling abstraction built on it, none of which is
optional: `tools/thuishaven/domain/langytier.go:7,25,60` models the dev tiers in
terms of this variable, `tools/thuishaven/app/plan_langy.go:147,166,231` sets it
(with `plan_langy_test.go:41,70` and `domain/overlay_langy_test.go:22-23`
asserting on the literal string), and
`packages/server/src/services/langyagent.ts:98` sets it independently when the
environment is local-like. `charts/langyagent/README.md:96` and
`templates/configmap.yaml:2` document the old refusal. A rename that misses any
of these leaves local development silently running the posture it did not ask
for, which is the one failure mode this ADR is least able to tolerate.

**Chart.** Two values in `charts/langyagent/values.yaml`, one `fail` guard and a
conditional security context in `templates/deployment.yaml`, both documented in
the umbrella's `charts/langwatch/values.yaml`. The root rationale header at
`values.yaml:126-155` is rewritten: it currently explains root as though it were
unconditional.

**Specs.** `langy-deploy-hardening.feature` gains the guard and acknowledgement
scenarios and updates both its e2e-manifest scenario (:156-165, which asserts
flatly that "the manager runs as root") and its Background (:14-26, which calls
root one of "two invariants"). `langy-selfhost-install.feature:96-107` is
corrected — the "no cost, every cluster" claim and the "any cluster" promise
both need the policy-locked case named. `langy-worker-isolation.feature` is
rewritten for pi. `langy-pi-harness.feature:158-163` records that the stash is
listable under shared identity.

**One spec has to be argued with, not just edited.**
`specs/security/helm-strict-admission.feature:118-127` is titled "The assistant
is removed rather than de-privileged" and asserts "the chart never quietly
relaxes the assistant to run as non-root", concluding "Removing the workload is
the safe answer, weakening it is not." Its `quietly` survives this ADR intact —
nothing here is quiet. Its conclusion does not. That scenario must be rewritten
to say the strict-admission **overlay** removes the assistant, while the
isolation trade exists as a separate posture an operator selects; and its
rationale, which claims siblings "read each other's credentials off disk",
is factually wrong for pi and should go.

**Docs.** `docs/self-hosting/langy/setup` gains the posture beside the existing
sandboxed-runtime hardening section. Two published claims stop being true and
both name the reasoning, not just the rule, so both need rewriting rather than
deleting: `docs/self-hosting/security.mdx:237` ("Don't force it non-root. Deploy
it on a cluster that allows it, or run without the assistant") and
`docs/langy/security/sandbox.mdx:32` ("The manager process runs as root in the
container").

**A support burden we are choosing.** Some operators will set `none` because it
makes an error go away, not because they weighed it. The acknowledgement value,
the render-time failure text and the boot `WARN` are three chances to notice;
none of them is a guarantee. We accept that, on the same reasoning
`acceptUnsandboxedRuntime` already accepts it.

## References

- Related ADRs: ADR-033 (per-worker UID isolation and the gVisor constraint —
  its Fix A′ is deleted by ADR-131, not made optional by this one; what this
  ADR makes optional is the per-worker UID wall `033:115` keeps as
  "load-bearing; guards `/proc/<pid>/environ`" — the same exposure this ADR
  reaches independently), **ADR-131** (opencode harness removal — a hard
  dependency; `workerIsolation: none` must not ship before it),
  ADR-047 (Langy foundations — `047:36-41` calls this pod shape known-unsafe;
  argued with under Honest limits), ADR-053 (tenant-aware egress and workload
  isolation; `053:725-729` already rejects the UID wall as the tenant boundary,
  and Track D is where this bridge ends), ADR-076 (egress enforcement — its
  shipped rungs are unchanged, its per-worker-netns end state is foreclosed
  under `none`; see the trade table).
- Specs: `specs/langy/langy-deploy-hardening.feature`,
  `specs/langy/langy-selfhost-install.feature`,
  `specs/langy/langy-worker-isolation.feature`,
  `specs/langy/langy-pi-harness.feature`,
  `specs/security/helm-strict-admission.feature`,
  `specs/langy/langy-opencode-harness-removal.feature` (ADR-131's contract).
- Code: `services/langyagent/app/runner.go` (the interface),
  `adapters/runner/sandboxed/sandboxed.go`,
  `adapters/runner/localunsafe/localunsafe.go`, `cmd/root.go:53-59`,
  `config.go:145,237,293`, `app/workerpool/uid.go`, `app/workerpool/pool.go:639,826`,
  `adapters/pi/spawn.go:217-282`, `domain/credentials.go:116-132`.
- Chart: `charts/langyagent/values.yaml:27-35,126-185`,
  `charts/langyagent/templates/deployment.yaml:4-6,21-23`,
  `charts/langwatch/tests/e2e-overlays.sh:585-595`.
