# ADR-043: Langy Foundations — hexagonal Go service, caller-scoped session key, deploy hardening

**Date:** 2026-07-10

**Status:** Accepted

**Supersedes/extends:** builds on ADR-033 (Langy worker network isolation under
gVisor). Does **not** change ADR-033's isolation model — it re-homes it.

## Context

Langy (the in-product AI coding agent) works, but its backend does not yet match
the platform's engineering standards. This ADR captures the first of a four-PR
stack that re-homes it. **PR1 = "make the current thing right", with no
event-sourcing yet.** Behaviour must stay identical and the ADR-033 isolation
model must survive verbatim; later PRs in the stack depend on the seams this PR
lays down.

Three problems this PR fixes:

1. **The Go `services/langy-agent/` does not follow house conventions.** It is a
   single flat `langyagent` package: hand-rolled config (`os.Getenv` +
   `strconv`, no tags), sentinel errors (`errors.New`), a plain `net/http` mux,
   a `manager.go` that mixes transport + business + process + filesystem
   concerns, and **zero OpenTelemetry**. The two reference Go services
   (`services/nlpgo/`, `services/aigateway/`) are hexagonal and share the
   `pkg/` toolkit (`herr`, `config`, `clog`, `otelsetup`, `lifecycle`, `health`,
   `httpmiddleware`, `contexts`). langy-agent should mirror them.

2. **Every Langy chat runs through one shared, admin-equivalent service key.**
   The dedicated "Langy" `ApiKey` grants view/create/update on nine resource
   families to *anyone* who passes the route's coarse permission gate. Any
   editor-or-above therefore acts with the full authority of that shared key,
   not their own. A bug in the gate is a full privilege escalation.

3. **The deploy story lets the unsafe posture slip through.** The chart's
   `values.yaml` *claims* it "refuses to deploy" without a sandboxed runtime,
   but nothing enforces it. The e2e pod manifest ships the known-unsafe
   `runAsUser: 1000` + all-caps-dropped config — the exact shape ADR-033 says
   re-opens cross-worker credential theft (and which also breaks per-worker UID
   isolation outright).

## Decision

### A. Rewrite `services/langy-agent/` to the hexagonal house layout

Mirror `nlpgo`/`aigateway`:

```
services/langy-agent/
  config.go            # pkg/config: env+validate tags, defaults → Hydrate → Validate
  deps.go              # Deps: clog logger, otelsetup provider, health registry, telemetry
  serve.go             # pkg/lifecycle group (health probes + graceful drain)
  cmd/root.go          # entrypoint: LoadConfig → NewDeps → wire adapters → Serve
  domain/              # value objects (Credentials, CredentialSignature) + errors.go (herr.Code)
  app/                 # ports.go (consumer interfaces) + app.go (orchestrator, functional options)
  adapters/
    httpapi/           # driving adapter: chi router + middleware, auth/validate only
    workerpool/        # driven adapter: the ADR-033 isolation logic, wrapped in herr/otel
    egress/            # stub seam (interface + pass-through impl) for PR3 egress monitoring
  telemetry/           # otel span + metric instruments shared by app + workerpool
```

Concretely:

- **Config** uses `pkg/config` (`config.Hydrate` over `env:` tags,
  `config.Validate` over `validate:` tags) and composes `config.Server`,
  `config.OTel`, `clog.Config`. **Every existing env var name is preserved**
  (`LANGY_INTERNAL_SECRET`, `LANGY_MAX_WORKERS`, `LANGY_WORKER_IDLE_MS`,
  `LANGY_READINESS_TIMEOUT_MS`, `PORT`, `SESSIONS_ROOT`,
  `OPENCODE_OTEL_PLUGIN_VERSION`).
- **Errors** are `herr.Code` consts in `domain/errors.go`, registered to HTTP
  statuses, and written via `herr.WriteHTTP`. The ad-hoc
  `writeJSON(...map[string]string{"error":...})` is gone.
- **Logging** is `pkg/clog` (context-carried, ServiceInfo-stamped, honours
  `LOG_LEVEL`/`LOG_FORMAT`). `*zap.Logger` is no longer threaded as a function
  parameter.
- **Telemetry** is `pkg/otelsetup` plus a `telemetry` package that emits spans
  and metrics on the manager: worker spawn/kill, at-capacity, per-turn latency,
  readiness. The manager previously emitted **zero** OTel. *This is a
  load-bearing seam: PR3's egress monitoring depends on it.* The global
  `TracerProvider` is installed by `otelsetup`, so spans export today; the
  metric instruments are created against the global `Meter` (a no-op until a
  `MeterProvider` is wired) so the call sites exist and light up the moment PR3
  installs one — no restructuring required.
- **`context.Context` is threaded everywhere.** The spawn path no longer drops
  the caller's context via `context.Background()`. The worker subprocess is now
  bound to a **pool-lifetime** context (cancelled on `Shutdown`) rather than
  `context.Background()` — so shutdown/deadlines propagate to worker processes
  **without** a single chat turn's context ending the long-lived worker.
- **Health/lifecycle** use `pkg/health` (`/healthz`, `/readyz`, `/startupz`)
  and `pkg/lifecycle` closers, matching nlpgo/aigateway. `/health` is kept as a
  back-compat alias because the control plane's preflight
  (`langy.ts::isAgentHealthy`) and the chart probes still call it.

**ADR-033 isolation is preserved EXACTLY**, re-homed behind
`adapters/workerpool/` and wrapped (not rewritten) in herr/otel:
per-worker UID (`workerUIDFor = 2000 + sha256(convId)%60000` + collision
probe), 0700 chown-before-secrets home, per-worker `OPENCODE_SERVER_PASSWORD`
(env, not flag), authProxy per-worker bearer + upstream Basic-auth swap,
`filterSensitiveEnv` denylist, `Setpgid` + process-group kill, orphan reaper,
and the fail-closed `requireOpenCodeAuthEnforced` guard (a worker refuses to
start unless opencode answers `401` to an unauthenticated `POST /session`).
The known `filterSensitiveEnv` suffix-gap is left as a code comment only — **not
widened in this PR** (out of scope).

An `adapters/egress/` package is added as a **thin stub seam** (interface +
pass-through impl) so PR3 can add egress monitoring without restructuring. No
monitoring logic lands here.

### B. Per-session, caller-scoped LangWatch key (replaces the shared service key)

At chat time, instead of handing the worker the shared admin-equivalent "Langy"
service key, mint a **per-session `ApiKey` owned by the requesting user**,
restricted to the intersection of the Langy permission set and what that user
actually holds in the project, PROJECT-scoped, and short-lived (auto-expiring).
Because the key is *owned by the user*, `ApiKeyService`'s ceiling check clamps
it to the user's own authority — **a Langy tool call can never exceed what that
user could do by hand.** The held-subset intersection guarantees the mint never
throws for a legitimately-gated caller. The change lives in the langy service
layer (`langyApiKey.ts` `mintLangySessionApiKey`, consumed by
`LangyCredentialService`).

The route's coarse permission gate is **relaxed** to a single baseline
project-read check (`evaluations:view`, consistent with the other `/langy/*`
routes) rather than the previous "`:update` on all nine resource families".
That old all-or-nothing gate 403'd a legitimate partial-permission user (someone
who can edit prompts but not create triggers) out of Langy entirely; with the
per-session key as the real least-privilege enforcement, the coarse gate only
needs to answer "can this user see this project at all?" — the key then scopes
every tool call to exactly what they hold. The `langy.ts` edit is otherwise kept
minimal (PR2 also edits that file).

**Known follow-up (not fixed in PR1):** the key is minted per chat POST, and the
worker's credential signature does not include the key, so a reused
(same-conversation) worker keeps its first key and later mints are orphaned.
They are hidden from the API-keys UI (by name, at the repository list layer) and
carry a short expiry, but a cleanup job (or minting once per conversation) is a
clean follow-up to stop them accumulating in Postgres.

### C. Deploy hardening

- **Chart render-time guard:** `charts/langy-agent/templates/deployment.yaml`
  gains a `fail` guard — when `chartManaged` is true and `runtimeClassName` is
  empty, the chart refuses to render (mirrors the existing `replicaCount` guard
  and the `service.type` guard in `service.yaml`). This makes the values.yaml
  "refuses to deploy without gVisor" claim real.
- **e2e manifest regen:** `langwatch/e2e/langy/k8s/pod.yaml` is regenerated from
  the production chart's securityContext (root + the five per-UID caps
  `CHOWN/DAC_OVERRIDE/FOWNER/SETUID/SETGID`), so per-worker UID isolation
  actually functions, behind a prominent "LOCAL E2E ONLY — DO NOT USE IN PROD"
  banner documenting the two intentional local divergences (no gVisor
  RuntimeClass, no NetworkPolicy).

## Durability, restart, and scaling (explicit, because it is easy to get wrong)

PR1 does **not** change any of the following — it documents and preserves them.
These are load-bearing invariants the later stack PRs (event-sourcing) will
revisit.

- **Concurrency primitives.** The pool is a classic Go concurrent registry:
  `sync.Mutex` guards the worker/uid/spawn maps, `sync/atomic` reserves capacity
  across the lock boundary (so N simultaneous first-turns can't all pass the cap
  check), per-worker `chan struct{}` spawn-locks dedupe concurrent first turns, a
  `sync.WaitGroup` joins the reaper, and the per-turn stream runs on a goroutine
  joined by a buffered `chan error`. The home-wipe on worker exit runs **under
  the pool mutex** on purpose — releasing it first would let a replacement spawn
  interleave and get its freshly-written credentials `rm -rf`'d (regression-
  tested in `pool_test.go`).

- **If the manager is killed, its workers die with it.** The opencode workers
  are child processes of the manager, which is **PID 1** in the pod. Killing the
  manager ⇒ the pod restarts ⇒ every worker is torn down. There is no scenario
  where the manager restarts but the workers keep running — they share the pod
  lifecycle. (PR1 additionally binds each worker subprocess to a pool-lifetime
  context so a `Shutdown` propagates even if the explicit process-group kill is
  missed.)

- **What is recovered after a restart, and what is lost.** On boot the manager
  **wipes `SESSIONS_ROOT`** (so no stale plaintext credentials or repo clones
  survive a crash) and starts with an empty registry. A conversation resumes by
  **lazily respawning a fresh worker on its next turn** — the durable state
  (chat history, the per-session key, the credentials the control plane re-sends
  each turn) lives **outside** this process, in the control plane, not in the
  worker. What is genuinely lost is a **single turn that was mid-flight when the
  pod died**: there is no idempotency key yet, so the control plane surfaces that
  failure to the user rather than silently replaying it (replaying risks a
  duplicate side effect, e.g. a second PR). Durable, resumable in-flight turns
  are the job of the **event-sourcing PR later in this stack**, not PR1.

- **Horizontal scalability: NO, by design (today).** The manager keys workers by
  `conversationId` in **in-process memory**, so a second replica would cold-start
  a fresh worker whenever a follow-up turn landed on the other pod (losing the
  warm session). The chart therefore pins `replicaCount: 1` with a render-time
  `fail` guard and uses `strategy: Recreate` + no HPA. Langy scales **vertically**
  (`resources`, `LANGY_MAX_WORKERS`) until conversation-sticky routing (or the
  event-sourced session store) exists — also a later-stack concern. PR1 keeps this
  invariant intact; it does not attempt to make Langy horizontally scalable.

## Consequences

- The four services now share one toolkit; a change to `pkg/herr`/`pkg/config`/
  `pkg/otelsetup` benefits all of them, and langy-agent's operational telemetry
  becomes visible in the same tracing pipeline as the rest of the platform.
- Leaked-key blast radius shrinks from "admin-equivalent service key for the
  whole project" to "one user's own permissions, for a few hours."
- A managed deploy without a sandboxed runtime now fails fast at `helm template`
  time instead of silently shipping an unsafe pod.
- The `telemetry` metric instruments are no-ops until a `MeterProvider` is wired
  (a deliberate PR3 seam); spans export immediately.

## Future directions (explicitly deferred to the later stack PRs)

These are desirable and were discussed, but are architectural changes that
belong to the event-sourcing PRs later in this stack — **not** PR1, which must
stay a behaviour-preserving foundation. PR1 leaves clean seams for them (the
`pkg/lifecycle` graceful-drain window, the `telemetry` and `egress` seams, the
pool-lifetime context):

- **Cooperative graceful shutdown.** Today `SIGTERM` marks the pod draining
  (`/readyz` → 503), waits a drain delay for the load balancer to remove it,
  then process-group-kills each worker within the graceful budget
  (`SERVER_GRACEFUL_SECONDS`). A richer version would *signal each worker* to
  checkpoint into a recoverable state (e.g. flush its session) within a few
  seconds before the kill.
- **Horizontal scaling + zero-downtime rollouts.** Langy is single-replica by
  design (in-memory worker registry). Running ≥2 replicas for rolling deploys
  without dropping conversations needs either conversation-sticky routing or a
  **shared session store** (e.g. Redis) so a follow-up turn can rehydrate a
  session on another pod. That shared-state substrate is the natural home of the
  event-sourcing PR; until it exists, the `replicaCount: 1` guard (Theme C)
  stays and rollouts use `strategy: Recreate` with a short drain.

## Acceptance

- Go: `go build ./...` and `go test ./...` under `services/langy-agent/` pass;
  the migrated isolation tests (`workerpool` package) stay green, proving the
  ADR-033 guarantees survived the re-home.
- Behaviour: the `/chat` ndjson stream, `/health` alias, at-capacity, and
  conversation-busy responses are unchanged from the caller's perspective.
- Specs:
  - `specs/langy/langy-agent-service-conventions.feature` (this PR) — the
    manager's operational telemetry, health probes, herr envelopes, context
    propagation, and preservation of the isolation guarantees.
  - `specs/langy/langy-worker-isolation.feature` (ADR-033) — unchanged
    guarantees, now satisfied by the `workerpool` adapter's tests.
  - `specs/langy/langy-api-key-provisioning.feature` — the caller-scoped
    per-session key.
  - `specs/langy/langy-deploy-hardening.feature` — the chart guard + e2e posture.

## References

- ADR-033: `dev/docs/adr/033-langy-worker-network-isolation-under-gvisor.md`
- Reference services: `services/nlpgo/`, `services/aigateway/`
- Shared toolkit: `pkg/herr`, `pkg/config`, `pkg/clog`, `pkg/otelsetup`,
  `pkg/lifecycle`, `pkg/health`, `pkg/httpmiddleware`, `pkg/contexts`
- Specs: `specs/langy/langy-agent-service-conventions.feature`,
  `specs/langy/langy-worker-isolation.feature`,
  `specs/langy/langy-api-key-provisioning.feature`,
  `specs/langy/langy-deploy-hardening.feature`
