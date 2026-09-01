# ADR-131: The opencode harness is removed; pi is the only harness

**Date:** 2026-08-31

**Status:** Proposed

## First, a name collision that will cause an accident

**"opencode" means two unrelated things in this repository, and only one of them
is being removed.** Anyone acting on this ADR must hold the distinction, because
a `grep -rl opencode` deletes a shipping product integration.

| | **(A) The worker harness** | **(B) The third-party CLI** |
|---|---|---|
| What it is | One of two coding-agent runtimes a Langy worker could run on | The `opencode` CLI our customers run, which LangWatch instruments, wraps and ingests traces from |
| Owned by | `services/langyagent/adapters/opencode/` | `sdks/typescript/src/cli/`, the AI gateway, trace processing |
| Customer-visible | No — an internal implementation choice | **Yes** — a documented supported integration |
| Docs | `docs/langy/**` | `docs/coding-agents/opencode.mdx`, `docs/ai-gateway/cli/opencode.mdx` |
| Specs | `specs/langy/**` | `specs/ai-gateway/wrapper-e2e/opencode.feature`, all nine `specs/ai-governance/**` |
| This ADR | **removes it** | **does not touch it** |

Env vars split the same way and do not follow a naming rule, so they have to be
read individually. `OPENCODE_SERVER_PASSWORD`, `OPENCODE_VERSION` and
`OPENCODE_SHA256_*` are (A) and die. `OPENCODE_TRACEPARENT`, `OPENCODE_SCOPE`,
`OPENCODE_TOOL_SPAN`, `OPENCODE_PLUGIN_*` and `OPENCODE_LLM_*` are (B) and stay.
`OPENCODE_AGENT_URL` is **neither** — see below.

## Context

A Langy worker runs on a coding-agent harness selected per turn by the control
plane. Two exist: `opencode` and `pi`.

**Pi is already the only harness anyone runs.** The control plane resolves the
harness on every turn (`app-layer/langy/langy-turn-base-dependencies.ts:123-128`,
wired unconditionally at `presets.ts:1451`) from a feature flag,
`release_langy_pi_harness` (`app-layer/langy/langyHarness.ts:12,42-47`). That flag
is registered `scope: "SYSTEM"`, `defaultValue: true`, `envOverridable: false`
(`featureFlag/registry.ts:321-324`), and every failure path lands on pi:

- no operator row → `store.get` returns null → registry default `true` → pi
- Postgres unreachable → `featureFlagStore.postgres.ts:125-130` catches, logs
  "falling back to registry default" → pi
- the flag service throws anyway → `langyHarness.ts:52-57` catches and returns
  `"pi"` explicitly

PostHog is never consulted — it is not in the resolution path for SYSTEM flags at
all. So a self-hosted install with no analytics backend, or an air-gapped one
with no flag store, runs pi.

There is a claim in the Go source that reads like a contradiction:
`domain/credentials.go:116-117` says `HarnessOpenCode` "is the opencode harness,
the default", and `NormalizeHarness` returns it for empty and unrecognised
values. Both things are true at once. The Go default fires only when the
credentials envelope carries **no** `harness` field, which happens for a control
plane predating `resolveHarness` and for minimal test compositions — not for any
shipped control plane.

**So opencode is reachable in exactly one supported way today: an operator
targeting rule in the staff-only flag store (`/ops/feature-flags`) ruling the
flag off for a project or organization.** There is no user-facing, project-facing
or API-facing harness selector; `envOverridable: false` means even the
environment cannot force it.

### What keeping it costs

A dormant second harness is not free.

- **It carries a whole attack surface pi does not have.** Opencode exposes an
  unauthenticated HTTP control server on a loopback port, reachable by any
  sibling in the pod netns. Closing that took a per-worker
  `OPENCODE_SERVER_PASSWORD` and a bearer-to-Basic auth proxy — the entire
  subject of ADR-033's Fix A′. Pi is driven over anonymous stdio pipes
  (`adapters/pi/spawn.go:302-331`); it has no listener, so there is nothing to
  authenticate and no proxy to run.
- **It cannot run two instances under one identity.** Concurrent opencode
  workers collide on `~/.config/opencode/`. This is what forecloses ADR-130's
  shared-identity posture while opencode is present.
- **It pins a binary.** `OPENCODE_VERSION` + `OPENCODE_SHA256_{AMD64,ARM64}` in
  `infra/docker/Dockerfile.langyagent:264-281`, plus a whole predep module at
  `packages/server/src/predeps/opencode.ts`, plus a doctor check that requires
  the binary on PATH for local dogfooding.
- **Four ADRs describe mechanisms built on it**, so the corpus documents an
  architecture nobody runs.

## Decision

**We remove the opencode harness. Pi becomes the only harness, and harness
selection stops being a concept.**

### 1. The harness goes

`services/langyagent/adapters/opencode/` is deleted. `domain/credentials.go`
loses `HarnessOpenCode` and the `Harness` field's meaning collapses; the switch
at `app/workerpool/pool.go:826` goes away, along with the opencode branches
threaded through `pool.go` and `worker.go`. `config.go` loses
`OpenCodeBinaryPath`. `app/ports.go` loses the opencode-shaped port methods.

### 2. The flag goes with it

`release_langy_pi_harness` and `resolveLangyHarness` are removed. A feature flag
with one reachable value is worse than no flag: it implies a rollback that does
not exist and invites an operator to try it.

**This is the ordering constraint.** The flag must be cleared *before* the code
is removed, not after. An operator targeting rule ruling the flag off for some
project is the one live configuration this change breaks, and it is invisible
from the code — it lives in the flag store. Removal therefore begins with
reading `/ops/feature-flags` for targeting rules on
`release_langy_pi_harness`, and clearing them.

### 3. What deliberately survives

**`OPENCODE_AGENT_URL` stays, under its legacy name.** It is the app→langyagent
base URL and has nothing to do with the harness. It is read by
`packages/server/src/shared/env.ts:100,175`, set by
`charts/langwatch/templates/{app,workers}/deployment.yaml`, asserted by
`charts/langwatch/tests/e2e-overlays.sh:583,592`, and modelled in
`tools/thuishaven/domain/overlay.go:151`. Renaming it is a separate change that
must move the chart, `.env.example`, the haven overlay, the tests and the docs
in one commit; doing it opportunistically inside this one is how the app loses
its agent. It is left alone, with a comment at its definition saying why the
name is what it is.

**Everything in column (B) stays**, untouched and unmentioned by the
implementation.

## Consequences for four ADRs

Removing the harness deletes the mechanism at the centre of four decisions. None
of them is *wrong*; each describes how something was done using a component that
stops existing.

| ADR | What it decided | What happens |
|---|---|---|
| **033** Langy worker network isolation | Fix A′ — a per-worker `OPENCODE_SERVER_PASSWORD` presented by the authProxy (`033:89-90`) | **Superseded.** The threat it closed — a sibling dialling worker B's control port — has no mechanism once workers are driven over pipes. Fix A′, the Fix B netns fallback and the acceptance criteria (`033:193-206`) all go. ADR-033 is still `Draft`; it should be marked `Superseded by ADR-131`. |
| **048** Langy shutdown handoff | `shutdown_imminent{deadline}` to each worker's opencode control API; "opencode authors/consumes" (`048:63,190,225-227`) | **Needs rewriting for pi's protocol** or marking `Superseded`. The handoff behaviour is still wanted; its transport is gone. |
| **077** Langy dual-stream | Multiplex one opencode `/event` subscription per turn (`077:68,95-99`) | **Needs rewriting.** Pi has its own event stream (`adapters/pi/reader.go`); the dual-stream *decision* survives, the subscription mechanism does not. |
| **078** Langy user turn controls | Stop calls opencode's `POST /session/{id}/abort` (`078:109-111,174-178`) | **Needs rewriting.** Pi has `AbortTurn` (`adapters/pi/agent.go:519`), and `langy-pi-harness.feature:74-86` already specifies the cancel semantics. |

ADR-050 (`050:15,89`) mentions `opencode.Provision` in passing and needs a
citation fix only.

**These four are the real size of this change.** Deleting a Go package is an
afternoon; leaving four accepted ADRs describing a component that no longer
exists is how a corpus stops being trustworthy.

## Honest limits

**Rollback stops being a flag flip and becomes a revert.** Today an operator can
move one project back to opencode from a staff screen. After this, recovering
from a pi-specific defect means shipping a release. We accept that because pi
has been the only served harness for long enough that a latent opencode-only
capability is unlikely, and because the fallback path is not actually exercised
— an untested rollback is a comfort, not a control.

**We lose the ability to A/B two harnesses.** If a future harness is worth
evaluating, the selection mechanism is easy to reintroduce; keeping a dead one
alive to preserve the shape of a comparison is not a reason.

**One claim in this ADR is not verifiable from the code.** Whether any operator
targeting rule currently rules `release_langy_pi_harness` off for a project lives
in a database, not the repository. If one exists, that project is running
opencode today and this change moves it. Reading the flag store is step one of
the work, not an assumption of it.

## Consequences

**Specs that assert opencode behaviour and must be rewritten or deleted:**

- `langy-agent-service-conventions.feature:121-123` — hard blocker; asserts "the
  per-worker `OPENCODE_SERVER_PASSWORD`, the authProxy bearer-to-Basic swap …
  the fail-closed opencode auth guard all still hold"
- `langy-otel-tracing.feature:38,41,46,243` — three scenarios spawn an opencode
  subprocess; `:41` asserts the generated opencode config enables native OTel
- `langy-dual-stream.feature:31,39,46,99` — four scenarios on the opencode stream
- `specs/setup/langy-local-dogfood.feature:19` — "opencode is on PATH"
- `langy-worker-isolation.feature` — already rewritten for pi under ADR-130

**Specs mentioning it in prose only** (`langy-shutdown-handoff.feature:7`,
`langy-deploy-hardening.feature:14`, `langy-cli-tool-envelope.feature:6`,
`langy-stop-and-resume.feature:111`, `specs/security/api-endpoint-authorization.feature:315`)
need a comment pass, not a behaviour change.

**Docs that go stale** — `docs/langy/how-langy-works.mdx:3,8,11,26,44,45`,
`docs/langy/overview.mdx:29`, `docs/langy/security/sandbox.mdx:12,26` (which
publishes `OPENCODE_SERVER_PASSWORD` as *the* worker-to-worker mitigation),
`docs/self-hosting/langy/overview.mdx:18,61,69`,
`docs/self-hosting/langy/setup.mdx:39`,
`docs/self-hosting/langy/environment-variables.mdx:11,26,37,39`. Regenerate
`docs/llms.txt` and `docs/llms-full.txt` afterwards. The sandbox page **improves**
rather than merely changing: "a sibling cannot dial a pipe" is a stronger
statement than "a sibling gets a 401".

**Chart** — `charts/langyagent/Chart.yaml:4,5,14` (an `opencode` keyword),
`README.md`, `values.yaml` (the security-context header at `:132-142` and the
capability rationale at `:166-180` both argue from opencode),
`templates/deployment.yaml`, `templates/networkpolicy.yaml:14,16-17,79,113,124`
(the opencode port range), `charts/langwatch/values.yaml:2117,2133`,
`examples/overlays/strict-admission.yaml:47`.

**Build** — `infra/docker/Dockerfile.langyagent:233,264-281` loses the binary
fetch and pin; `packages/server/src/predeps/opencode.ts` is deleted whole.

**Comments referencing `OPENCODE_RESOURCE_ATTRIBUTES`** in
`trace-attribute-accumulation.service.ts:297` and two tests go stale; the label
path itself is generic and unaffected.

## References

- Related ADRs: **ADR-130** (per-worker identity isolation — depends on this
  removal and must not ship before it), ADR-033 (superseded by this),
  ADR-048 / ADR-077 / ADR-078 (mechanism removed, decisions need re-expressing
  on pi), ADR-047 (Langy foundations), ADR-050 (citation fix).
- Spec: `specs/langy/langy-opencode-harness-removal.feature`
- Harness resolution: `platform/app/src/server/app-layer/langy/langyHarness.ts`,
  `.../langy-turn-base-dependencies.ts:123-128`,
  `platform/app/src/server/featureFlag/registry.ts:321-324`,
  `platform/app/src/server/featureFlag/featureFlag.service.ts:107-114`,
  `platform/app/src/server/featureFlag/featureFlagStore.postgres.ts:125-130`.
- Go side: `services/langyagent/domain/credentials.go:80,116-132`,
  `app/workerpool/pool.go:826`, `adapters/pi/spawn.go:302-331`,
  `adapters/pi/agent.go:519`, `adapters/pi/reader.go`.
