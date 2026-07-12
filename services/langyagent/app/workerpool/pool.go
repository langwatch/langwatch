package workerpool

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"go.opentelemetry.io/otel/codes"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/adapters/egress"
	"github.com/langwatch/langwatch/services/langyagent/adapters/opencode"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/app/runner/sandboxed"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/telemetry"
)

// revokeTimeout bounds the revoke call to the control plane. Short on purpose:
// the worker is already dead, nothing is waiting on the answer, and a control
// plane that is slow or down must not leave revocation goroutines piling up. A
// revoke we abandon is one the reaper collects.
const revokeTimeout = 5 * time.Second

// Options configure a Pool. Constructed from the service Config in deps.go.
type Options struct {
	MaxWorkers         int
	WorkerIdle         time.Duration
	ReadinessTimeout   time.Duration
	ReaperInterval     time.Duration
	SessionsRoot       string
	WorkspaceRoot      string
	OpenCodeBinaryPath string
	OTelPluginVersion  string
	// Runner is the isolation substrate for worker subprocesses — the ADR-033
	// secure-vs-local seam (app/runner/sandboxed vs app/runner/localunsafe),
	// chosen once at the composition root. nil defaults to the sandboxed (secure)
	// runner, so a mis-wire fails closed rather than silently running without
	// per-worker UID isolation.
	Runner app.Runner
	// Telemetry and Egress are injected; nil falls back to a working default
	// (no-op instruments / pass-through guard) so tests and partial wiring boot.
	Telemetry *telemetry.Telemetry
	Egress    egress.Guard
	// Revoker asks the control plane to revoke a dead worker's session key. nil
	// disables revocation — the key then simply lives out its TTL and the control
	// plane's reaper collects it, which is the same backstop that covers a manager
	// killed outright. Optional, so tests and partial wiring boot unchanged.
	Revoker CredentialRevoker
}

// CredentialRevoker revokes the session key a dead worker was carrying.
//
// Consumer-side interface, deliberately one method wide: the pool must be able to
// destroy a credential and must NOT be able to create one. Anything broader here
// would let a future change quietly hand the manager minting power.
type CredentialRevoker interface {
	Revoke(ctx context.Context, endpoint, apiKeyID string) error
}

// Pool owns the per-conversation worker registry (the former Manager). It
// guarantees:
//
//   - One worker per conversationID (spawnLocks dedupe concurrent first turns).
//   - A hard cap at MaxWorkers using a synchronous pendingSpawns counter so N
//     distinct conversations arriving at once can't all observe an empty
//     registry and all spawn.
//   - Unique kernel UIDs across all active workers (workerUIDFor + linear
//     probe). Without this, two conversations whose ids hashed to the same UID
//     would share kernel identity, breaking the cross-tenant credential
//     boundary chmod 0700 enforces.
//   - Registry deletes guarded by *exec.Cmd identity. A killed-then-respawned
//     conversation must not have its replacement's entry deleted by the
//     original child's exit goroutine.
//
// It satisfies app.WorkerPool.
type Pool struct {
	maxWorkers         int
	workerIdle         time.Duration
	readinessTimeout   time.Duration
	reaperInterval     time.Duration
	sessionsRoot       string
	workspaceRoot      string
	openCodeBinaryPath string
	otelPluginVersion  string
	runner             app.Runner
	// agentsTemplate is the shared /workspace/AGENTS.md read ONCE at New; each
	// spawn only does the per-worker ${LANGWATCH_ENDPOINT} ReplaceAll and never a
	// disk read. Empty if the file was unreadable at startup — a spawn then fails
	// with a clear error rather than crash-looping the whole service at boot.
	agentsTemplate string

	telemetry *telemetry.Telemetry
	egress    egress.Guard
	revoker   CredentialRevoker

	// baseCtx is the pool-lifetime context (carries the logger; cancelled on
	// Shutdown). Worker subprocesses bind to it via spawnOpenCode so a pool
	// shutdown / deadline propagates to them — the flat manager used
	// context.Background here and dropped that propagation.
	baseCtx    context.Context
	baseCancel context.CancelFunc

	mu            sync.Mutex
	workers       map[string]*Worker
	spawnLocks    map[string]chan struct{}
	pendingSpawns int32
	// uidToConv tracks every UID currently held by an active worker.
	uidToConv map[uint32]string

	reaperWG sync.WaitGroup
	stopCh   chan struct{}
}

var _ app.WorkerPool = (*Pool)(nil)

// New prepares SESSIONS_ROOT and returns a ready Pool.
//
// /workspace is an emptyDir that survives container restarts in the same pod, so
// plaintext per-session credentials and cloned repos could otherwise persist
// indefinitely if the prior manager crashed before its exit handler ran. Wipe
// before accepting traffic.
//
// ctx becomes the pool-lifetime context (carries the logger; a copy with
// cancellation is stored so Shutdown propagates to worker subprocesses).
func New(ctx context.Context, opts Options) (*Pool, error) {
	if err := os.RemoveAll(opts.SessionsRoot); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("wipe sessions root: %w", err)
	}
	if err := os.MkdirAll(opts.SessionsRoot, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir sessions root: %w", err)
	}
	// Read the shared AGENTS.md ONCE here so no per-worker spawn touches disk for
	// it — only the per-worker ${LANGWATCH_ENDPOINT} ReplaceAll runs at spawn. A
	// read failure is logged, not fatal: /workspace may not be mounted in every
	// dev preset, and a spawn then fails with a clear error instead of crash-
	// looping the manager at boot.
	var agentsTemplate string
	if raw, err := os.ReadFile(filepath.Join(opts.WorkspaceRoot, "AGENTS.md")); err != nil {
		clog.Get(ctx).Warn("read shared AGENTS.md at startup failed; worker spawns will fail until it is present",
			zap.String("workspace_root", opts.WorkspaceRoot),
			zap.Error(err),
		)
	} else {
		agentsTemplate = string(raw)
	}
	tel := opts.Telemetry
	if tel == nil {
		tel = telemetry.New()
	}
	var guard egress.Guard = opts.Egress
	if guard == nil {
		guard = egress.NewPassThrough()
	}
	// nil Runner fails CLOSED to the secure substrate: a mis-wire runs sandboxed
	// (per-worker setuid + chown), never accidentally without isolation.
	runner := opts.Runner
	if runner == nil {
		runner = sandboxed.New()
	}
	baseCtx, baseCancel := context.WithCancel(ctx)
	return &Pool{
		maxWorkers:         opts.MaxWorkers,
		workerIdle:         opts.WorkerIdle,
		readinessTimeout:   opts.ReadinessTimeout,
		reaperInterval:     opts.ReaperInterval,
		sessionsRoot:       opts.SessionsRoot,
		workspaceRoot:      opts.WorkspaceRoot,
		openCodeBinaryPath: opts.OpenCodeBinaryPath,
		otelPluginVersion:  opts.OTelPluginVersion,
		runner:             runner,
		agentsTemplate:     agentsTemplate,
		telemetry:          tel,
		egress:             guard,
		revoker:            opts.Revoker,
		baseCtx:            baseCtx,
		baseCancel:         baseCancel,
		workers:            make(map[string]*Worker),
		spawnLocks:         make(map[string]chan struct{}),
		uidToConv:          make(map[uint32]string),
		stopCh:             make(chan struct{}),
	}, nil
}

// StartReaper begins the idle-worker sweep. Idempotent; safe to call once.
func (p *Pool) StartReaper() {
	p.reaperWG.Add(1)
	go func() {
		defer p.reaperWG.Done()
		t := time.NewTicker(p.reaperInterval)
		defer t.Stop()
		for {
			select {
			case <-p.stopCh:
				return
			case <-t.C:
				// Per-iteration recovery: a panic in ONE sweep must not end idle
				// reaping forever (a whole-goroutine recover would). Log + continue.
				func() {
					defer clog.HandlePanic(p.baseCtx, false)
					p.reapIdle()
				}()
			}
		}
	}()
}

// Shutdown stops the reaper and tears down every active worker, then cancels
// the pool-lifetime context (which any surviving worker subprocess is bound
// to). Called from the lifecycle Closer; idempotent.
func (p *Pool) Shutdown() {
	select {
	case <-p.stopCh:
		p.baseCancel()
		return
	default:
		close(p.stopCh)
	}
	p.reaperWG.Wait()

	p.mu.Lock()
	ids := make([]string, 0, len(p.workers))
	for id := range p.workers {
		ids = append(ids, id)
	}
	p.mu.Unlock()

	for _, id := range ids {
		p.kill(id, "shutdown")
	}
	p.baseCancel()
}

// ShutdownHandoff is the ADR-048 pre-drain SIGTERM step. For each live worker it
// posts a shutdown-imminent notice (so opencode checkpoints the in-flight turn
// and emits a terminal `handoff` frame), then waits — bounded by deadline — for
// every in-flight turn to quiesce, so the frames flush to the control plane over
// the still-open /chat responses before Shutdown kills the process groups.
//
// It runs BEFORE Shutdown (registered as a lifecycle Closer after the
// worker-pool, so reverse-order stop fires it first). Best-effort by design: a
// worker that cannot be notified, or a turn that does not quiesce before the
// deadline, falls back to a cold restart on its next turn — the honest
// SIGKILL/OOM limit stated in ADR-048. The deadline caps the whole step so a
// slow/dead worker can never eat the drain budget out from under the kill.
func (p *Pool) ShutdownHandoff(ctx context.Context, deadline time.Time) {
	// Snapshot the live workers under the lock; do all network I/O outside it.
	p.mu.Lock()
	workers := make([]*Worker, 0, len(p.workers))
	for _, w := range p.workers {
		workers = append(workers, w)
	}
	p.mu.Unlock()
	if len(workers) == 0 {
		return
	}

	hctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()

	log := clog.Get(p.baseCtx)
	log.Info("shutdown handoff: notifying live workers",
		zap.Int("workers", len(workers)),
		zap.Time("deadline", deadline),
	)

	// Notify each worker in parallel. Bare goroutine guarded by HandlePanic so a
	// panic in one POST can never take the manager down mid-shutdown (PR4 has no
	// clog.Go yet; this is exactly what it would do — composes when it lands).
	var wg sync.WaitGroup
	for _, w := range workers {
		wg.Add(1)
		w := w
		// clog.Go panic-guards the goroutine so a panic in one notify can never
		// take the manager down mid-shutdown (PR3).
		clog.Go(hctx, "shutdown-handoff-notify", func() {
			defer wg.Done()
			// Cap a single hung notify so it cannot consume the whole budget.
			nctx, ncancel := context.WithTimeout(hctx, 2*time.Second)
			defer ncancel()
			if err := w.NotifyShutdownImminent(nctx, deadline); err != nil {
				log.Warn("shutdown handoff: notify failed",
					zap.String("conversation", w.conversationID),
					zap.Error(err),
				)
			}
		})
	}
	wg.Wait()

	// Wait for in-flight turns to drain (their StreamEvents saw the terminal
	// handoff frame and Released the worker) or the deadline. Polling keeps this
	// lock-light; the deadline caps it.
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		if p.countInFlight(workers) == 0 {
			log.Info("shutdown handoff: all in-flight turns quiesced")
			return
		}
		select {
		case <-hctx.Done():
			log.Warn("shutdown handoff: deadline reached with turns still in flight — falling back to cold restart",
				zap.Int("still_in_flight", p.countInFlight(workers)),
			)
			return
		case <-ticker.C:
		}
	}
}

// countInFlight reports how many of the given workers still have a turn in
// flight. Used by ShutdownHandoff to wait for the in-flight turns to quiesce.
func (p *Pool) countInFlight(workers []*Worker) int {
	n := 0
	for _, w := range workers {
		if w.isInFlight() {
			n++
		}
	}
	return n
}

// Acquire returns the worker for conversationID, spawning one if needed. Two
// concurrent callers for the same conversationID share the same spawn promise —
// only one subprocess is ever created.
//
// If an existing worker's CredentialSignature differs from the caller's (model
// changed, GitHub token added/removed) the existing worker is killed and a
// fresh one is spawned with the new capability set.
// HasLiveWorker reports whether a worker is already running for this
// conversation whose capabilities match `sig`.
//
// This is the pre-flight the control plane uses to decide whether it needs to
// mint a session key at all. It answers exactly the question Acquire would ask
// and nothing more — in particular the signature is computable WITHOUT a key
// (SignatureOf reads only model / GitHub-presence / egress allow-list), which is
// what makes "probe, then mint only if spawning" possible in the first place.
//
// Deliberately advisory: the worker can die immediately after we answer true.
// The control plane does not have to get this right, because Acquire refuses a
// keyless spawn with ErrCredentialsRequired and the caller mints and retries. A
// stale `true` costs one round trip; it can never boot a broken worker.
func (p *Pool) HasLiveWorker(conversationID string, sig domain.CredentialSignature) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	w, ok := p.workers[conversationID]
	return ok && w.credSig == sig
}

// revokeKeyOf asks the control plane to revoke a dead worker's session key.
//
// Fire-and-forget on the pool's base context, NOT the caller's: the caller is
// usually kill(), which may be running under a request that is about to return,
// and a revocation must not be cancelled just because the turn finished. It must
// also never block a kill — a dead worker's cleanup cannot wait on an HTTP call
// to a control plane that might be down.
//
// Best-effort by design. If it fails, the key still expires and the control
// plane's reaper collects it; this call only shortens the window. It has to be
// this way: a manager that is SIGKILLed (OOM, eviction, force-delete) runs no
// cleanup at all, so revocation can never be the guarantee — only the fast path.
func (p *Pool) revokeKeyOf(w *Worker, reason string) {
	if p.revoker == nil || w == nil || w.apiKeyID == "" {
		return
	}
	apiKeyID, endpoint, conversationID := w.apiKeyID, w.langwatchEndpoint, w.conversationID
	go func() {
		defer clog.HandlePanic(p.baseCtx, false)
		ctx, cancel := context.WithTimeout(p.baseCtx, revokeTimeout)
		defer cancel()
		if err := p.revoker.Revoke(ctx, endpoint, apiKeyID); err != nil {
			clog.Get(p.baseCtx).Warn("revoking worker session key failed — it will expire and be reaped instead",
				zap.String("conversation", conversationID),
				zap.String("reason", reason),
				zap.Error(err),
			)
			return
		}
		clog.Get(p.baseCtx).Debug("revoked worker session key",
			zap.String("conversation", conversationID),
			zap.String("reason", reason),
		)
	}()
}

func (p *Pool) Acquire(ctx context.Context, conversationID string, creds domain.Credentials) (app.Worker, error) {
	wantedSig := domain.SignatureOf(creds)

	p.mu.Lock()
	if w, ok := p.workers[conversationID]; ok {
		if w.credSig == wantedSig {
			p.mu.Unlock()
			return w, nil
		}
		// Capability mismatch: kill the existing worker, then fall through to
		// the regular spawn path. We release the lock around kill so the exit
		// goroutine can land its cleanup without contending.
		p.mu.Unlock()
		p.kill(conversationID, "credential capability changed")
		p.mu.Lock()
	}
	if ch, ok := p.spawnLocks[conversationID]; ok {
		p.mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		p.mu.Lock()
		w := p.workers[conversationID]
		p.mu.Unlock()
		if w == nil {
			return nil, herr.New(ctx, domain.ErrWorkerSpawn, herr.M{
				"message": "the assistant worker could not be started, please try again",
			})
		}
		return w, nil
	}

	// A SPAWN is now committed: no live worker matched, and no other spawn is in
	// flight to piggyback on. A spawn needs a session key — and the control plane
	// deliberately sends none when its pre-flight probe told it we already had a
	// live worker (a reused worker keeps the key in its env, so a second key would
	// be minted, discarded unread, and left valid for hours).
	//
	// The worker can die in the gap between that probe and this call. THIS is that
	// race, and refusing here is how it is resolved: we answer
	// ErrCredentialsRequired, the control plane mints once and retries, and the
	// user sees a normal response. The alternative — booting a worker with no
	// LangWatch key — produces a worker that silently cannot call LangWatch at
	// all, which is far worse than one extra round trip on a rare race.
	//
	// Checked BEFORE the capacity reservation so a keyless request can never
	// consume a worker slot it was never going to fill.
	if !creds.Spawnable() {
		p.mu.Unlock()
		return nil, herr.New(ctx, domain.ErrCredentialsRequired, herr.M{
			"message": "a worker must be spawned for this conversation, but no session key was supplied",
		})
	}

	// Atomic capacity reservation. Increment BEFORE releasing the registry lock
	// so concurrent first-turns for N distinct conversations can't observe
	// len(workers)==0 and all pass the cap check.
	if len(p.workers)+int(atomic.LoadInt32(&p.pendingSpawns)) >= p.maxWorkers {
		p.mu.Unlock()
		return nil, herr.New(ctx, domain.ErrMaxWorkers, nil)
	}
	atomic.AddInt32(&p.pendingSpawns, 1)
	ch := make(chan struct{})
	p.spawnLocks[conversationID] = ch
	p.mu.Unlock()

	defer func() {
		atomic.AddInt32(&p.pendingSpawns, -1)
		p.mu.Lock()
		delete(p.spawnLocks, conversationID)
		p.mu.Unlock()
		close(ch)
	}()

	w, err := p.spawn(ctx, conversationID, creds, wantedSig)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	p.workers[conversationID] = w
	p.mu.Unlock()
	return w, nil
}

// Status returns a live worker count and the configured cap (used by /health).
func (p *Pool) Status() (active, max int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.workers), p.maxWorkers
}

// KillSessionVanished is called when opencode reports the internal session id no
// longer exists — recycle so the next turn spawns fresh.
func (p *Pool) KillSessionVanished(conversationID string) {
	p.kill(conversationID, "opencode session vanished")
}

// reserveUIDLocked finds a free UID for conversationID. Must be called with
// p.mu held. The deterministic seed (workerUIDFor) is tried first so the same
// conversation usually lands on the same UID across spawns; on collision we
// linear-probe forward through the slot range. The chosen UID is registered in
// uidToConv and must be released via releaseUIDLocked when the worker exits.
func (p *Pool) reserveUIDLocked(conversationID string) (uint32, error) {
	preferred := workerUIDFor(conversationID)
	for offset := uint32(0); offset < workerUIDRange; offset++ {
		// Wrap the slot offset around the range while keeping the absolute UID
		// inside [workerUIDBase, workerUIDBase+workerUIDRange).
		slot := (preferred-workerUIDBase+offset)%workerUIDRange + workerUIDBase
		if _, taken := p.uidToConv[slot]; !taken {
			p.uidToConv[slot] = conversationID
			return slot, nil
		}
	}
	return 0, herr.New(p.baseCtx, domain.ErrNoFreeUID, herr.M{"message": "the assistant is at capacity, please try again"})
}

func (p *Pool) releaseUIDLocked(uid uint32, conversationID string) {
	// Defensive: only release if the slot still belongs to this conversation. A
	// killed-then-respawned conversation may have already taken a fresh slot;
	// the original child's exit goroutine must not release the new reservation.
	if existing, ok := p.uidToConv[uid]; ok && existing == conversationID {
		delete(p.uidToConv, uid)
	}
}

// spawn is the inner creator. Called from Acquire under spawn-lock; no
// double-spawn possible. Wrapped with an OTel span + spawn/readiness metrics.
func (p *Pool) spawn(ctx context.Context, conversationID string, creds domain.Credentials, sig domain.CredentialSignature) (*Worker, error) {
	ctx, span := p.telemetry.StartSpawn(ctx, conversationID)
	defer span.End()
	start := time.Now()

	w, err := p.spawnInner(ctx, conversationID, creds, sig)
	p.telemetry.WorkerSpawned(ctx, time.Since(start).Seconds(), err == nil)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "spawn failed")
	}
	return w, err
}

func (p *Pool) spawnInner(ctx context.Context, conversationID string, creds domain.Credentials, sig domain.CredentialSignature) (*Worker, error) {
	log := clog.Get(ctx)
	workerHome := filepath.Join(p.sessionsRoot, conversationID)
	// Defense in depth: even with IsValidConversationID at the edge, assert the
	// resolved path stays under SESSIONS_ROOT before we mkdir/spawn into it. A
	// symlink could otherwise escape.
	resolvedRoot, err := filepath.Abs(p.sessionsRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve sessions root: %w", err)
	}
	resolvedHome, err := filepath.Abs(workerHome)
	if err != nil {
		return nil, fmt.Errorf("resolve worker home: %w", err)
	}
	if !strings.HasPrefix(resolvedHome, resolvedRoot+string(filepath.Separator)) {
		return nil, herr.New(ctx, domain.ErrInvalidConversationID, herr.M{"message": "invalid conversationId"})
	}

	// Stacked rollback: each acquired resource registers a deferred undo guarded
	// by `success`. On ANY early return OR panic before success is set, the undos
	// unwind in reverse acquisition order — no leaked UID (→ eventual capacity
	// exhaustion), home dir with plaintext creds, listener, egress reservation, or
	// opencode process. On success the guard flips and every undo becomes a no-op:
	// the live worker owns these resources for its lifetime.
	success := false

	// Allocate a UID under the registry lock so two concurrent spawns can't both
	// observe the same slot as free.
	p.mu.Lock()
	uid, err := p.reserveUIDLocked(conversationID)
	p.mu.Unlock()
	if err != nil {
		return nil, err
	}
	defer func() {
		if !success {
			p.mu.Lock()
			p.releaseUIDLocked(uid, conversationID)
			p.mu.Unlock()
		}
	}()

	// Egress seam (ADR-043 / ADR-047): the enforcing guard stands up THIS
	// worker's outbound forward proxy here and returns its loopback port (which
	// buildWorkerEnv points HTTPS_PROXY at); it can fail the spawn closed. The
	// observe-only / pass-through guards run no proxy (ProxyPort 0).
	we, err := p.egress.PrepareWorker(ctx, egress.WorkerContext{
		ConversationID:  conversationID,
		UID:             uid,
		EgressAllowlist: creds.EgressAllowlist,
	})
	if err != nil {
		// The guard's reason is an internal diagnostic — logged, not surfaced.
		// The rejection is deliberately handled, so the caller gets a herr with
		// an actionable message.
		log.Warn("egress guard rejected worker", zap.String("conversation", conversationID), zap.Error(err))
		return nil, herr.New(ctx, domain.ErrWorkerSpawn, herr.M{"message": "the assistant worker could not be started, please try again"})
	}
	defer func() {
		if !success {
			// we.Close tears down THIS worker's forward proxy. Nil-safe /
			// idempotent and only run on a failed spawn — on success the live
			// Worker owns `we`.
			we.Close()
		}
	}()

	if err := os.MkdirAll(workerHome, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir worker home: %w", err)
	}
	// Register the home undo right after MkdirAll so a failure inside
	// setupWorkerHome (which writes config.json with the project API key) still
	// wipes the partial home.
	defer func() {
		if !success {
			_ = os.RemoveAll(workerHome)
		}
	}()
	if err := setupWorkerHome(workerHome, p.workspaceRoot, creds, uid, p.otelPluginVersion, p.agentsTemplate, p.runner); err != nil {
		return nil, err
	}

	// Two ports per worker:
	//   - externalPort: the authProxy listens here, requires Bearer auth.
	//     handlers always dial this one (worker.port).
	//   - internalPort: opencode's actual TCP listen, fronted by the proxy.
	//     Never exposed to callers; the proxy is the only consumer.
	externalPort, err := opencode.GetFreePort()
	if err != nil {
		return nil, err
	}
	// Any free port works: sibling isolation is enforced by opencode's own
	// per-worker password (ADR-033 Fix A′), not by pinning the internal listen
	// into an iptables-locked range. opencode.GetFreePort closes its listener before
	// returning, so two independent calls can (rarely) hand back the SAME
	// ephemeral port — which would make the proxy bind externalPort first and
	// opencode then fail to listen, burning the whole readiness timeout. Re-roll
	// until the internal port differs from the external one.
	var internalPort int
	for attempt := 0; attempt < 8; attempt++ {
		internalPort, err = opencode.GetFreePort()
		if err != nil {
			return nil, err
		}
		if internalPort != externalPort {
			break
		}
	}
	if internalPort == externalPort {
		return nil, fmt.Errorf("could not allocate a distinct internal port (kept colliding with external port %d)", externalPort)
	}

	bearerToken, err := opencode.GenerateBearerToken()
	if err != nil {
		return nil, err
	}

	// Distinct per-worker secret opencode itself enforces (ADR-033 Fix A′) —
	// deliberately generated separately from bearerToken above: bearerToken
	// gates the external port (caller <-> authProxy), openCodePassword gates the
	// internal port (authProxy <-> opencode). Reusing one secret for both would
	// mean any caller holding the external bearer token could also derive the
	// internal credential.
	openCodePassword, err := opencode.GenerateBearerToken()
	if err != nil {
		return nil, err
	}

	// The endpoint the sandbox exposes for this worker's coding-agent process:
	// the authproxy-fronted external port callers dial, opencode's own internal
	// control port (checked directly by the readiness probe, never exposed), and
	// the per-worker bearer. agent (adapters/opencode) drives readiness, session,
	// and every turn through it — the pool never speaks the agent's wire protocol.
	endpoint := app.Endpoint{
		BaseURL:      "http://127.0.0.1:" + strconv.Itoa(externalPort),
		ExternalPort: externalPort,
		InternalPort: internalPort,
		BearerToken:  bearerToken,
	}
	agent := opencode.NewAgent(p.readinessTimeout)

	// authProxy binds the pool-lifetime context so its serve goroutine logs and
	// lifetime follow the pool, not a single request.
	proxy, err := opencode.StartAuthProxy(p.baseCtx, externalPort, internalPort, bearerToken, openCodePassword)
	if err != nil {
		return nil, fmt.Errorf("start authproxy: %w", err)
	}
	defer func() {
		if !success {
			proxy.Shutdown()
		}
	}()

	// The worker subprocess is bound to the POOL-lifetime context — the
	// per-request context controls a single chat turn, but the worker stays
	// alive across turns and only dies on idle/shutdown. Binding to baseCtx
	// (rather than context.Background, as the flat manager did) means a pool
	// Shutdown / deadline propagates to the subprocess.
	cmd, err := spawnOpenCode(p.baseCtx, p.openCodeBinaryPath, conversationID, workerHome, uid, internalPort, creds, openCodePassword, we.ProxyPort, p.runner)
	if err != nil {
		return nil, err
	}
	// The exit watcher goroutine is NOT started until success below, so this undo
	// owns cmd.Wait() without a race: on a readiness/session failure it kills the
	// process and drains its exit, and the rollbacks above shut the proxy, wipe
	// the home (config.json with the project API key), release the UID, and notify
	// the egress guard — leaving no sensitive material on the emptyDir.
	defer func() {
		if !success {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()

	readyStart := time.Now()
	readinessCtx, cancel := context.WithTimeout(ctx, p.readinessTimeout)
	defer cancel()
	if err := agent.WaitReady(readinessCtx, endpoint); err != nil {
		p.telemetry.ReadinessObserved(ctx, time.Since(readyStart).Seconds(), false)
		return nil, err
	}
	p.telemetry.ReadinessObserved(ctx, time.Since(readyStart).Seconds(), true)

	sessionID, err := agent.OpenSession(ctx, endpoint)
	if err != nil {
		return nil, err
	}

	// Healthy. Commit: flip the guard so the deferred rollbacks become no-ops,
	// THEN transfer watch ownership to the exit goroutine (started AFTER success
	// so the cmd rollback above never double-Wait()s the process). clog.Go guards
	// the watcher so a panic in teardown can't crash the manager.
	success = true
	clog.Go(p.baseCtx, "worker-exit-watcher", func() {
		err := cmd.Wait()
		clog.Get(p.baseCtx).Info("worker exited",
			zap.String("conversation", conversationID),
			zap.Error(err),
		)
		p.onWorkerExit(conversationID, cmd, uid)
	})

	log.Info("worker ready",
		zap.String("conversation", conversationID),
		zap.Int("port", externalPort),
		zap.Int("internalPort", internalPort),
		zap.String("session", sessionID),
		zap.Uint32("uid", uid),
	)

	return &Worker{
		conversationID:    conversationID,
		agent:             agent,
		endpoint:          endpoint,
		authProxy:         proxy,
		egress:            we,
		openCodeSessionID: sessionID,
		cmd:               cmd,
		uid:               uid,
		credSig:           sig,
		apiKeyID:          creds.LangwatchAPIKeyID,
		langwatchEndpoint: creds.LangwatchEndpoint,
		lastSeen:          time.Now(),
	}, nil
}

// onWorkerExit is the teardown decision the exit watcher in spawnInner fires
// when a worker subprocess returns from cmd.Wait(). It runs under p.mu so a
// concurrent spawn trying to reserve the same UID or set up the same home path
// blocks until the decision (and any wipe) completes.
//
// Replacement-race invariants the decision preserves:
//
//  1. Wipe iff we still own the slot AND no replacement is in flight. If the
//     slot holds a different *exec.Cmd, a replacement is already committed. If
//     the slot is empty but spawnLocks[X] is set, a replacement's
//     setupWorkerHome is writing into our home path right now. Either way,
//     wiping would rm -rf live data under the replacement.
//  2. Registry delete is identity-guarded. Only delete workers[X] if we're
//     still the entry there.
//  3. UID release is convId-guarded inside releaseUIDLocked.
func (p *Pool) onWorkerExit(conversationID string, cmd *exec.Cmd, uid uint32) {
	var tombstone string
	var proxyToShutdown *opencode.AuthProxy
	shouldWipe := false
	deletedOwnEntry := false
	var egressToClose egress.WorkerEgress
	// The worker that exited, captured under the lock so its session key can be
	// revoked after we release it. Only set when we still owned the slot — a
	// worker that kill() already removed had its key revoked there, and revoking
	// twice would race the reaper for no gain.
	var exitedWorker *Worker

	// The decision runs under the lock (defer-unlocked so a panic can't leave it
	// held); the slow RemoveAll + egress I/O run AFTER the unlock.
	func() {
		p.mu.Lock()
		defer p.mu.Unlock()

		if w, ok := p.workers[conversationID]; ok {
			if w.cmd == cmd {
				proxyToShutdown = w.authProxy
				egressToClose = w.egress
				exitedWorker = w
				delete(p.workers, conversationID)
				shouldWipe = true
				deletedOwnEntry = true
			}
			// else: replacement is in the slot; leave its home alone.
		} else if _, spawning := p.spawnLocks[conversationID]; !spawning {
			// Slot empty AND no spawn in flight — the home is ours to reclaim. (If
			// a spawn IS in flight, its setupWorkerHome is writing into the home dir
			// right now; reclaiming would corrupt the new worker.) This is a worker
			// kill() already removed from the registry, so the gauge was decremented
			// there — do NOT decrement again below.
			shouldWipe = true
		}
		p.releaseUIDLocked(uid, conversationID)
		if shouldWipe {
			// Rename the canonical home to a unique tombstone WHILE the lock is
			// held — a microsecond metadata op that frees the canonical path so a
			// fresh Acquire for the same conversation can't collide with our
			// teardown — then RemoveAll the tombstone AFTER unlock, off the pool-
			// wide hot path (every Acquire/kill/reap/Status blocks on this lock, so
			// the old in-lock tree-walk unlink stalled them all).
			tombstone = tombstoneWorkerHome(p.baseCtx, p.sessionsRoot, conversationID)
		}
		// Only the identity-owned delete decrements the active gauge: that worker
		// exited on its own (crash / self-exit) and never went through kill(),
		// which is the only other place the gauge is decremented. Without this the
		// gauge drifts upward on every self-exit.
		if deletedOwnEntry {
			p.telemetry.WorkerExited(p.baseCtx)
		}
	}()

	// Everything below runs WITHOUT the pool lock.

	// The worker exited on its own (crash or self-exit) and never went through
	// kill(), so this is the one place its session key gets revoked. Its lifetime
	// was this worker's — it lived in the subprocess env — and the process is gone,
	// so the key is now pure liability: nothing can use it, and it would otherwise
	// stay valid for hours.
	if deletedOwnEntry {
		p.revokeKeyOf(exitedWorker, "worker exited")
	}

	if proxyToShutdown != nil {
		// The authproxy shutdown drains in-flight turns; run it off the lock as a
		// panic-guarded goroutine so the pool never blocks on it.
		clog.Go(p.baseCtx, "authproxy-shutdown", proxyToShutdown.Shutdown)
	}
	if tombstone != "" {
		if err := os.RemoveAll(tombstone); err != nil {
			clog.Get(p.baseCtx).Warn("remove worker home tombstone failed",
				zap.String("conversation", conversationID),
				zap.Error(err),
			)
		}
	}
	// Egress teardown runs OUTSIDE the pool lock: tearing down a forward proxy
	// may perform network I/O, which must never stall the pool. It is not part
	// of the home-dir race, so ordering after the unlock is correct. Close is the
	// per-worker forward-proxy teardown (identity-guarded above so a
	// replacement's proxy is never closed); idempotent / nil-safe.
	egressToClose.Close()
}

// kill terminates a worker and cleans its home. The exit-watcher goroutine in
// spawnInner ultimately fires the registry delete on the actual process exit;
// this synchronous path drops the entry immediately so callers don't see a
// half-dead worker. UID release stays with the exit watcher so the slot isn't
// reusable until the kernel has fully torn down the prior process.
func (p *Pool) kill(conversationID, reason string) {
	p.mu.Lock()
	w, ok := p.workers[conversationID]
	if ok {
		delete(p.workers, conversationID)
	}
	p.mu.Unlock()
	if !ok {
		return
	}
	p.telemetry.WorkerKilled(p.baseCtx, reason)
	// The key's lifetime is the worker's. kill() is the funnel for EVERY
	// deliberate death — capability change, idle reap, shutdown — so revoking here
	// covers all three at once. Self-exit and crash are the other path, handled in
	// the exit goroutine below.
	p.revokeKeyOf(w, reason)
	clog.Get(p.baseCtx).Info("killing worker",
		zap.String("conversation", conversationID),
		zap.String("reason", reason),
	)
	if w.cmd != nil && w.cmd.Process != nil {
		// Signal the WHOLE process group, not just opencode's leader pid.
		// spawnOpenCode sets Setpgid: true, so opencode + every child it shelled
		// out to (`gh`, `git`, `npm`, `gh auth git-credential fill`) share one
		// pgid == leader pid. Without `-pgid`, a kill against the leader leaves
		// the children reparented to PID 1 (the manager) holding the user's
		// GH_TOKEN / OPENAI_API_KEY / LANGWATCH_API_KEY in env, on the network,
		// until they finish. That breaks the per-conversation isolation
		// guarantee on the temporal axis.
		pid := w.cmd.Process.Pid
		_ = syscall.Kill(-pid, syscall.SIGINT)
		// Best-effort hard kill if SIGINT didn't take. Negative pid sends to the
		// whole group; opencode's `defer` cleanup gets SIGINT first for a chance
		// to flush, then SIGKILL nukes the tree.
		clog.Go(p.baseCtx, "worker-hard-kill", func() {
			time.Sleep(2 * time.Second)
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		})
	}
	// Shut down the authproxy so its externally-advertised port frees up
	// immediately; otherwise a respawn picking the same port would fail with
	// EADDRINUSE on the listener bind.
	if w.authProxy != nil {
		clog.Go(p.baseCtx, "authproxy-shutdown", w.authProxy.Shutdown)
	}
	// Same for the per-worker egress forward proxy's loopback port. Closed HERE
	// (synchronously with the kill, before the exit watcher's onWorkerExit runs)
	// so a kill-then-respawn on the same conversation frees the port promptly and
	// never leaves the old worker's proxy bound. Idempotent + nil-safe.
	go w.egress.Close()
}

// reapIdle scans the registry and kills workers idle longer than WorkerIdle.
func (p *Pool) reapIdle() {
	cutoff := p.workerIdle
	p.mu.Lock()
	candidates := make([]string, 0)
	for id, w := range p.workers {
		if w.idleSince() > cutoff {
			candidates = append(candidates, id)
		}
	}
	p.mu.Unlock()
	for _, id := range candidates {
		p.kill(id, "idle timeout")
	}
}
