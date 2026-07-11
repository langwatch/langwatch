package workerpool

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"go.opentelemetry.io/otel/codes"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langy-agent/adapters/egress"
	"github.com/langwatch/langwatch/services/langy-agent/app"
	"github.com/langwatch/langwatch/services/langy-agent/domain"
	"github.com/langwatch/langwatch/services/langy-agent/telemetry"
)

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
	// DisableUIDIsolation turns off the ADR-033 per-worker UID sandbox (no chown,
	// no setuid Credential) so opencode can spawn as the manager's own user on a
	// non-root dev box. Sourced from Config.UnsafeDevDisableIsolation, which
	// LoadConfig refuses to set outside local-like environments. NEVER true in
	// production.
	DisableUIDIsolation bool
	// Telemetry and Egress are injected; nil falls back to a working default
	// (no-op instruments / pass-through guard) so tests and partial wiring boot.
	Telemetry *telemetry.Telemetry
	Egress    egress.Guard
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
	maxWorkers          int
	workerIdle          time.Duration
	readinessTimeout    time.Duration
	reaperInterval      time.Duration
	sessionsRoot        string
	workspaceRoot       string
	openCodeBinaryPath  string
	otelPluginVersion   string
	disableUIDIsolation bool

	telemetry *telemetry.Telemetry
	egress    egress.Guard

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
	tel := opts.Telemetry
	if tel == nil {
		tel = telemetry.New()
	}
	var guard egress.Guard = opts.Egress
	if guard == nil {
		guard = egress.NewPassThrough()
	}
	baseCtx, baseCancel := context.WithCancel(ctx)
	return &Pool{
		maxWorkers:          opts.MaxWorkers,
		workerIdle:          opts.WorkerIdle,
		readinessTimeout:    opts.ReadinessTimeout,
		reaperInterval:      opts.ReaperInterval,
		sessionsRoot:        opts.SessionsRoot,
		workspaceRoot:       opts.WorkspaceRoot,
		openCodeBinaryPath:  opts.OpenCodeBinaryPath,
		otelPluginVersion:   opts.OTelPluginVersion,
		disableUIDIsolation: opts.DisableUIDIsolation,
		telemetry:           tel,
		egress:              guard,
		baseCtx:             baseCtx,
		baseCancel:          baseCancel,
		workers:             make(map[string]*Worker),
		spawnLocks:          make(map[string]chan struct{}),
		uidToConv:           make(map[uint32]string),
		stopCh:              make(chan struct{}),
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
				p.reapIdle()
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

// Acquire returns the worker for conversationID, spawning one if needed. Two
// concurrent callers for the same conversationID share the same spawn promise —
// only one subprocess is ever created.
//
// If an existing worker's CredentialSignature differs from the caller's (model
// changed, GitHub token added/removed) the existing worker is killed and a
// fresh one is spawned with the new capability set.
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

	// Allocate a UID under the registry lock so two concurrent spawns can't both
	// observe the same slot as free.
	p.mu.Lock()
	uid, err := p.reserveUIDLocked(conversationID)
	p.mu.Unlock()
	if err != nil {
		return nil, err
	}

	cleanupUID := func() {
		p.mu.Lock()
		p.releaseUIDLocked(uid, conversationID)
		p.mu.Unlock()
	}

	// Egress seam (ADR-047): a real guard (PR4) may set up per-worker egress
	// monitoring here and fail the spawn closed. The default pass-through does
	// nothing.
	if err := p.egress.PrepareWorker(ctx, egress.WorkerContext{ConversationID: conversationID, UID: uid}); err != nil {
		// The guard's reason is an internal diagnostic — logged, not surfaced.
		// The rejection is deliberately handled, so the caller gets a herr with
		// an actionable message.
		log.Warn("egress guard rejected worker", zap.String("conversation", conversationID), zap.Error(err))
		cleanupUID()
		return nil, herr.New(ctx, domain.ErrWorkerSpawn, herr.M{"message": "the assistant worker could not be started, please try again"})
	}

	if err := os.MkdirAll(workerHome, 0o700); err != nil {
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, fmt.Errorf("mkdir worker home: %w", err)
	}
	if err := setupWorkerHome(workerHome, p.workspaceRoot, creds, uid, p.otelPluginVersion, p.disableUIDIsolation); err != nil {
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, err
	}

	// Two ports per worker:
	//   - externalPort: the authProxy listens here, requires Bearer auth.
	//     handlers always dial this one (worker.port).
	//   - internalPort: opencode's actual TCP listen, fronted by the proxy.
	//     Never exposed to callers; the proxy is the only consumer.
	externalPort, err := getFreePort()
	if err != nil {
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, err
	}
	// Any free port works: sibling isolation is enforced by opencode's own
	// per-worker password (ADR-033 Fix A′), not by pinning the internal listen
	// into an iptables-locked range. getFreePort closes its listener before
	// returning, so two independent calls can (rarely) hand back the SAME
	// ephemeral port — which would make the proxy bind externalPort first and
	// opencode then fail to listen, burning the whole readiness timeout. Re-roll
	// until the internal port differs from the external one.
	var internalPort int
	for attempt := 0; attempt < 8; attempt++ {
		internalPort, err = getFreePort()
		if err != nil {
			_ = os.RemoveAll(workerHome)
			p.egress.ReleaseWorker(ctx, conversationID)
			cleanupUID()
			return nil, err
		}
		if internalPort != externalPort {
			break
		}
	}
	if internalPort == externalPort {
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, fmt.Errorf("could not allocate a distinct internal port (kept colliding with external port %d)", externalPort)
	}

	bearerToken, err := generateBearerToken()
	if err != nil {
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, err
	}

	// Distinct per-worker secret opencode itself enforces (ADR-033 Fix A′) —
	// deliberately generated separately from bearerToken above: bearerToken
	// gates the external port (caller <-> authProxy), openCodePassword gates the
	// internal port (authProxy <-> opencode). Reusing one secret for both would
	// mean any caller holding the external bearer token could also derive the
	// internal credential.
	openCodePassword, err := generateBearerToken()
	if err != nil {
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, err
	}

	// authProxy binds the pool-lifetime context so its serve goroutine logs and
	// lifetime follow the pool, not a single request.
	proxy, err := startAuthProxy(p.baseCtx, externalPort, internalPort, bearerToken, openCodePassword)
	if err != nil {
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, fmt.Errorf("start authproxy: %w", err)
	}

	// The worker subprocess is bound to the POOL-lifetime context — the
	// per-request context controls a single chat turn, but the worker stays
	// alive across turns and only dies on idle/shutdown. Binding to baseCtx
	// (rather than context.Background, as the flat manager did) means a pool
	// Shutdown / deadline propagates to the subprocess.
	cmd, err := spawnOpenCode(p.baseCtx, p.openCodeBinaryPath, conversationID, workerHome, uid, internalPort, creds, openCodePassword, p.disableUIDIsolation)
	if err != nil {
		proxy.shutdown()
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return nil, err
	}

	// failSpawn is the cleanup path for readiness/session failures. The watcher
	// goroutine has NOT started yet at these call sites, so this function owns
	// cmd.Wait() without a race. It kills the process, drains its exit, shuts
	// down the auth proxy, removes the worker home (which may already hold
	// config.json with the project API key), releases the UID reservation, and
	// notifies the egress guard — leaving no sensitive material on the emptyDir.
	failSpawn := func(cause error) error {
		_ = cmd.Process.Kill()
		_ = cmd.Wait() // drain; goroutine not started yet, no race
		proxy.shutdown()
		_ = os.RemoveAll(workerHome)
		p.egress.ReleaseWorker(ctx, conversationID)
		cleanupUID()
		return cause
	}

	readyStart := time.Now()
	readinessCtx, cancel := context.WithTimeout(ctx, p.readinessTimeout)
	defer cancel()
	if err := waitForReadiness(readinessCtx, externalPort, internalPort, bearerToken, p.readinessTimeout); err != nil {
		p.telemetry.ReadinessObserved(ctx, time.Since(readyStart).Seconds(), false)
		return nil, failSpawn(err)
	}
	p.telemetry.ReadinessObserved(ctx, time.Since(readyStart).Seconds(), true)

	sessionID, err := createOpenCodeSession(ctx, externalPort, bearerToken)
	if err != nil {
		return nil, failSpawn(err)
	}

	// Process is healthy — transfer watch ownership to the goroutine. Started
	// AFTER readiness + session so the failSpawn path above owns cmd.Wait()
	// cleanly.
	go func() {
		err := cmd.Wait()
		clog.Get(p.baseCtx).Info("worker exited",
			zap.String("conversation", conversationID),
			zap.Error(err),
		)
		p.onWorkerExit(conversationID, cmd, uid)
	}()

	log.Info("worker ready",
		zap.String("conversation", conversationID),
		zap.Int("port", externalPort),
		zap.Int("internalPort", internalPort),
		zap.String("session", sessionID),
		zap.Uint32("uid", uid),
	)

	return &Worker{
		conversationID:    conversationID,
		port:              externalPort,
		internalPort:      internalPort,
		bearerToken:       bearerToken,
		authProxy:         proxy,
		openCodeSessionID: sessionID,
		cmd:               cmd,
		uid:               uid,
		credSig:           sig,
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
	p.mu.Lock()
	shouldWipe := false
	var proxyToShutdown *authProxy
	if w, ok := p.workers[conversationID]; ok {
		if w.cmd == cmd {
			proxyToShutdown = w.authProxy
			delete(p.workers, conversationID)
			shouldWipe = true
		}
		// else: replacement is in the slot; leave its home alone.
	} else if _, spawning := p.spawnLocks[conversationID]; !spawning {
		// Slot empty AND no spawn in flight — home is ours to wipe. (If a spawn
		// IS in flight, its setupWorkerHome is writing into the home dir right
		// now; wiping would corrupt the new worker.)
		shouldWipe = true
	}
	p.releaseUIDLocked(uid, conversationID)
	// The wipe MUST run while p.mu is held: releasing the lock first would let a
	// fresh Acquire for the same conversation take spawnLocks[X] and start
	// setupWorkerHome writing into the home dir between our decision and our
	// rm -rf, which would then delete the replacement's freshly written
	// credentials. Holding the lock blocks that Acquire until the wipe
	// completes. os.RemoveAll under the lock is the accepted cost until
	// generation-suffixed home paths make it lock-free.
	if shouldWipe {
		removeWorkerHome(p.baseCtx, p.sessionsRoot, conversationID)
	}
	// Launch the per-worker authproxy shutdown as a goroutine so we don't block
	// on its in-flight drain while holding p.mu; the goroutine takes no pool
	// lock so this is safe under the lock.
	if proxyToShutdown != nil {
		go proxyToShutdown.shutdown()
	}
	p.mu.Unlock()

	// Egress teardown runs OUTSIDE the pool lock: a real PR4 guard may perform
	// network/monitoring I/O here, which must never stall the pool. It is not
	// part of the home-dir race, so ordering after the unlock is correct.
	if shouldWipe {
		p.egress.ReleaseWorker(p.baseCtx, conversationID)
	}
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
		go func(pid int) {
			time.Sleep(2 * time.Second)
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		}(pid)
	}
	// Shut down the authproxy so its externally-advertised port frees up
	// immediately; otherwise a respawn picking the same port would fail with
	// EADDRINUSE on the listener bind.
	if w.authProxy != nil {
		go w.authProxy.shutdown()
	}
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
