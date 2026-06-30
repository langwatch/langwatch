package langyagent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// ErrMaxWorkers is returned from Get when MAX_WORKERS is reached. The HTTP
// handler converts it to a 200 with {type:"error",error:"at-capacity"} so
// the control plane can show a graceful "agent busy" instead of a 500.
var ErrMaxWorkers = errors.New("max-workers-reached")

// ErrNoFreeUID is returned when every UID slot in [base, base+range) is in
// use. With a default range of 60_000 slots and a default MAX_WORKERS=20,
// this can never happen in practice — but the allocator surfaces it rather
// than silently colliding when an operator raises MAX_WORKERS above the
// slot capacity.
var ErrNoFreeUID = errors.New("no free worker UID slot")

// Manager owns the per-conversation worker registry. It guarantees:
//
//   - One worker per conversationID (spawnLocks dedupe concurrent first turns).
//   - A hard cap at cfg.MaxWorkers using a synchronous pendingSpawns counter
//     so N distinct conversations arriving at once can't all observe an empty
//     registry and all spawn (mirrors the JS manager's `pendingSpawns++`
//     reservation fix).
//   - Unique kernel UIDs across all active workers. The deterministic
//     `workerUIDFor` is used as the preferred slot; collisions probe forward
//     in the slot range until a free one is found and the chosen UID is
//     registered until the worker exits. Without this probe two
//     conversations whose ids happened to hash to the same UID (~0.3%
//     chance with 20 active workers) would share kernel identity, breaking
//     the cross-tenant credential boundary `chmod 0700` is supposed to
//     enforce.
//   - Registry deletes guarded by *exec.Cmd identity. A killed-then-
//     respawned conversation must not have its replacement's entry deleted
//     by the original child's exit goroutine.
type Manager struct {
	cfg Config
	log *zap.Logger

	mu            sync.Mutex
	workers       map[string]*Worker
	spawnLocks    map[string]chan struct{}
	pendingSpawns int32
	// uidToConv tracks every UID currently held by an active worker.
	// reserveUIDLocked probes around the deterministic preferred slot until
	// it finds one absent from this map. releaseUIDLocked drops the entry
	// when a worker exits or is killed.
	uidToConv map[uint32]string

	reaperWG sync.WaitGroup
	stopCh   chan struct{}
}

// NewManager prepares SESSIONS_ROOT and returns a ready Manager.
//
// /workspace is an emptyDir that survives container restarts in the same pod,
// so plaintext per-session credentials and cloned repos could otherwise
// persist indefinitely if the prior manager crashed before its exit handler
// ran. Wipe before accepting traffic.
func NewManager(cfg Config, log *zap.Logger) (*Manager, error) {
	if err := os.RemoveAll(cfg.SessionsRoot); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("wipe sessions root: %w", err)
	}
	if err := os.MkdirAll(cfg.SessionsRoot, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir sessions root: %w", err)
	}
	return &Manager{
		cfg:        cfg,
		log:        log,
		workers:    make(map[string]*Worker),
		spawnLocks: make(map[string]chan struct{}),
		uidToConv:  make(map[uint32]string),
		stopCh:     make(chan struct{}),
	}, nil
}

// StartReaper begins the idle-worker sweep. Idempotent; safe to call once.
func (m *Manager) StartReaper() {
	m.reaperWG.Add(1)
	go func() {
		defer m.reaperWG.Done()
		t := time.NewTicker(m.cfg.ReaperInterval)
		defer t.Stop()
		for {
			select {
			case <-m.stopCh:
				return
			case <-t.C:
				m.reapIdle()
			}
		}
	}()
}

// Shutdown stops the reaper and tears down every active worker. Called from
// the lifecycle Closer (serve.go); idempotent.
func (m *Manager) Shutdown() {
	select {
	case <-m.stopCh:
		return
	default:
		close(m.stopCh)
	}
	m.reaperWG.Wait()

	m.mu.Lock()
	ids := make([]string, 0, len(m.workers))
	for id := range m.workers {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, id := range ids {
		m.kill(id, "shutdown")
	}
}

// Get returns the worker for conversationID, spawning one if needed. Two
// concurrent callers for the same conversationID share the same spawn
// promise — only one subprocess is ever created.
//
// If an existing worker's CredentialSignature differs from the caller's
// (model changed, GitHub token added/removed) the existing worker is killed
// and a fresh one is spawned with the new capability set. Reusing an
// existing worker after capability change would otherwise let:
//   - A worker spawned with GH_TOKEN keep authenticated `gh` access across
//     later turns where the control plane denied the daily PR cap.
//   - A user switching the model picker mid-conversation appear to succeed
//     while execution stays on the originally-spawned model.
func (m *Manager) Get(ctx context.Context, conversationID string, creds Credentials) (*Worker, error) {
	wantedSig := signatureOf(creds)

	m.mu.Lock()
	if w, ok := m.workers[conversationID]; ok {
		if w.credSig == wantedSig {
			m.mu.Unlock()
			return w, nil
		}
		// Capability mismatch: kill the existing worker, then fall through to
		// the regular spawn path. We release the lock around kill so the
		// exit goroutine can land its cleanup without contending.
		m.mu.Unlock()
		m.kill(conversationID, "credential capability changed")
		m.mu.Lock()
	}
	if ch, ok := m.spawnLocks[conversationID]; ok {
		m.mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		m.mu.Lock()
		w := m.workers[conversationID]
		m.mu.Unlock()
		if w == nil {
			return nil, errors.New("worker spawn failed concurrently")
		}
		return w, nil
	}

	// Atomic capacity reservation. Increment BEFORE releasing the registry
	// lock so concurrent first-turns for N distinct conversations can't
	// observe `len(workers)==0` and all pass the cap check.
	if len(m.workers)+int(atomic.LoadInt32(&m.pendingSpawns)) >= m.cfg.MaxWorkers {
		m.mu.Unlock()
		return nil, ErrMaxWorkers
	}
	atomic.AddInt32(&m.pendingSpawns, 1)
	ch := make(chan struct{})
	m.spawnLocks[conversationID] = ch
	m.mu.Unlock()

	defer func() {
		atomic.AddInt32(&m.pendingSpawns, -1)
		m.mu.Lock()
		delete(m.spawnLocks, conversationID)
		m.mu.Unlock()
		close(ch)
	}()

	w, err := m.spawn(ctx, conversationID, creds, wantedSig)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.workers[conversationID] = w
	m.mu.Unlock()
	return w, nil
}

// Status returns a human-readable count used by the /health response.
func (m *Manager) Status() (active, max int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.workers), m.cfg.MaxWorkers
}

// KillSessionVanished is called by handler.go when opencode reports the
// internal session id no longer exists — recycle so the next turn spawns
// fresh.
func (m *Manager) KillSessionVanished(conversationID string) {
	m.kill(conversationID, "opencode session vanished")
}

// reserveUIDLocked finds a free UID for conversationID. Must be called with
// m.mu held. The deterministic seed (workerUIDFor) is tried first so the
// same conversation usually lands on the same UID across spawns; on
// collision we linear-probe forward through the slot range. The chosen UID
// is registered in uidToConv and must be released via releaseUIDLocked when
// the worker exits.
func (m *Manager) reserveUIDLocked(conversationID string) (uint32, error) {
	preferred := workerUIDFor(conversationID)
	for offset := uint32(0); offset < workerUIDRange; offset++ {
		// Wrap the slot offset around the range while keeping the absolute
		// UID inside [workerUIDBase, workerUIDBase+workerUIDRange).
		slot := (preferred-workerUIDBase+offset)%workerUIDRange + workerUIDBase
		if _, taken := m.uidToConv[slot]; !taken {
			m.uidToConv[slot] = conversationID
			return slot, nil
		}
	}
	return 0, ErrNoFreeUID
}

func (m *Manager) releaseUIDLocked(uid uint32, conversationID string) {
	// Defensive: only release if the slot still belongs to this conversation.
	// A killed-then-respawned conversation may have already taken a fresh
	// slot; the original child's exit goroutine must not release the new
	// reservation.
	if existing, ok := m.uidToConv[uid]; ok && existing == conversationID {
		delete(m.uidToConv, uid)
	}
}

// spawn is the inner creator. Called from Get under spawn-lock; no
// double-spawn possible. Validates conversationID, allocates a unique UID,
// builds the per-worker home, starts opencode, waits for readiness, and
// creates the session.
func (m *Manager) spawn(ctx context.Context, conversationID string, creds Credentials, sig CredentialSignature) (*Worker, error) {
	workerHome := filepath.Join(m.cfg.SessionsRoot, conversationID)
	// Defense in depth: even with isValidConversationID at the edge, assert
	// the resolved path stays under SESSIONS_ROOT before we mkdir/spawn into
	// it. A symlink could otherwise escape.
	resolvedRoot, err := filepath.Abs(m.cfg.SessionsRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve sessions root: %w", err)
	}
	resolvedHome, err := filepath.Abs(workerHome)
	if err != nil {
		return nil, fmt.Errorf("resolve worker home: %w", err)
	}
	if !strings.HasPrefix(resolvedHome, resolvedRoot+string(filepath.Separator)) {
		return nil, errors.New("invalid conversationId")
	}

	// Allocate a UID under the registry lock so two concurrent spawns can't
	// both observe the same slot as free.
	m.mu.Lock()
	uid, err := m.reserveUIDLocked(conversationID)
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}

	cleanupUID := func() {
		m.mu.Lock()
		m.releaseUIDLocked(uid, conversationID)
		m.mu.Unlock()
	}

	if err := os.MkdirAll(workerHome, 0o700); err != nil {
		cleanupUID()
		return nil, fmt.Errorf("mkdir worker home: %w", err)
	}
	if err := setupWorkerHome(workerHome, creds, uid, m.cfg.OTelPluginVersion); err != nil {
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, err
	}

	// Two ports per worker:
	//   - externalPort: the authProxy listens here, requires Bearer auth.
	//     handler.go always dials this one (worker.port).
	//   - internalPort: opencode's actual TCP listen, fronted by the proxy.
	//     Never exposed to handler.go; the proxy is the only consumer.
	externalPort, err := getFreePort()
	if err != nil {
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, err
	}
	// Internal opencode listen lives in the iptables-locked port range so
	// the kernel drops connect() attempts from non-root UIDs at the OUTPUT
	// chain. See iptables.go::LockdownLoopbackPortRange for the rule and
	// Sergio's 2026-06-30 P1 for the threat (worker A scans /proc/net/tcp,
	// connects to worker B's opencode TCP as B's UID, exfiltrates B's env).
	internalPort, err := getFreePortInRange(InternalPortRangeMin, InternalPortRangeMax)
	if err != nil {
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, err
	}

	bearerToken, err := generateBearerToken()
	if err != nil {
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, err
	}

	proxy, err := startAuthProxy(externalPort, internalPort, bearerToken, m.log)
	if err != nil {
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, fmt.Errorf("start authproxy: %w", err)
	}

	// We pass context.Background() to the worker process — the per-request
	// context controls a single chat turn, but the worker stays alive across
	// turns and only dies on idle/shutdown.
	cmd, err := spawnOpenCode(context.Background(), m.cfg, conversationID, workerHome, uid, internalPort, creds)
	if err != nil {
		proxy.shutdown()
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, err
	}

	// Watch for the subprocess dying on its own (crash, OOM, kill). See
	// onWorkerExit for the registry / UID / home-dir teardown logic and
	// the replacement-race invariants it preserves.
	go func() {
		err := cmd.Wait()
		m.log.Info("worker exited",
			zap.String("conversation", conversationID),
			zap.Error(err),
		)
		m.onWorkerExit(conversationID, cmd, uid)
	}()

	readinessCtx, cancel := context.WithTimeout(ctx, m.cfg.ReadinessTimeout)
	defer cancel()
	if err := waitForReadiness(readinessCtx, externalPort, bearerToken, m.cfg.ReadinessTimeout); err != nil {
		_ = cmd.Process.Kill()
		proxy.shutdown()
		return nil, err
	}

	sessionID, err := createOpenCodeSession(ctx, externalPort, bearerToken)
	if err != nil {
		_ = cmd.Process.Kill()
		proxy.shutdown()
		return nil, err
	}

	m.log.Info("worker ready",
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

// onWorkerExit is the teardown decision the exit watcher in spawn() fires
// when a worker subprocess returns from cmd.Wait(). It runs under m.mu so
// a concurrent spawn() trying to reserve the same UID or set up the same
// home path blocks until the decision (and any wipe) completes.
//
// Replacement-race invariants the decision preserves:
//
//  1. **Wipe iff we still own the slot AND no replacement is in flight.**
//     If the slot holds a different *exec.Cmd, a replacement is already
//     committed. If the slot is empty but spawnLocks[X] is set, a
//     replacement's setupWorkerHome is writing into our home path right
//     now — its registry commit happens at Get() line ~199 only after
//     setupWorkerHome returns. Either way, wiping would rm -rf live data
//     under the replacement.
//  2. **Registry delete is identity-guarded.** Only delete m.workers[X]
//     if we're still the entry there. A racing kill() may already have
//     dropped us; a racing spawn() may have replaced us — both cases mean
//     the entry is not ours to delete.
//  3. **UID release is convId-guarded** inside releaseUIDLocked: it's a
//     no-op if the UID was reassigned to a different conversation since
//     this worker reserved it.
//
// Follow-up: switch to generation-suffixed home paths
// (/workspace/sessions/<convID>-<gen>/) so the wipe can happen lock-free
// outside this critical section.
func (m *Manager) onWorkerExit(conversationID string, cmd *exec.Cmd, uid uint32) {
	m.mu.Lock()
	defer m.mu.Unlock()
	shouldWipe := false
	var proxyToShutdown *authProxy
	if w, ok := m.workers[conversationID]; ok {
		if w.cmd == cmd {
			proxyToShutdown = w.authProxy
			delete(m.workers, conversationID)
			shouldWipe = true
		}
		// else: replacement is in the slot; leave its home alone.
	} else if _, spawning := m.spawnLocks[conversationID]; !spawning {
		// Slot empty AND no spawn in flight — home is ours to wipe.
		// (If a spawn IS in flight, its setupWorkerHome is writing into
		// the home dir right now; wiping would corrupt the new worker.)
		shouldWipe = true
	}
	m.releaseUIDLocked(uid, conversationID)
	if shouldWipe {
		removeWorkerHome(m.cfg.SessionsRoot, conversationID, m.log)
	}
	// Shutdown the per-worker authproxy after releasing the registry lock —
	// Shutdown drains in-flight requests and we don't want to hold m.mu
	// across that wait.
	if proxyToShutdown != nil {
		go proxyToShutdown.shutdown()
	}
}

// kill terminates a worker and cleans its home. The exit-watcher goroutine
// in spawn() ultimately fires the registry delete on the actual process
// exit; this synchronous path drops the entry immediately so callers don't
// see a half-dead worker. UID release stays with the exit watcher so the
// slot isn't reusable until the kernel has fully torn down the prior
// process (a fresh worker getting the same UID before the old one's
// process-table entry is gone could find leftover files owned by the
// same UID).
func (m *Manager) kill(conversationID, reason string) {
	m.mu.Lock()
	w, ok := m.workers[conversationID]
	if ok {
		delete(m.workers, conversationID)
	}
	m.mu.Unlock()
	if !ok {
		return
	}
	m.log.Info("killing worker",
		zap.String("conversation", conversationID),
		zap.String("reason", reason),
	)
	if w.cmd != nil && w.cmd.Process != nil {
		// Signal the WHOLE process group, not just opencode's leader pid.
		// spawnOpenCode sets Setpgid: true (worker.go), so opencode + every
		// child it shelled out to (`gh`, `git`, `npm`, `gh auth git-credential
		// fill`) share one pgid == leader pid. Without `-pgid`, a `kill()`
		// against the leader leaves the children reparented to PID 1 (the
		// manager) holding the user's `GH_TOKEN`/`OPENAI_API_KEY`/
		// `LANGWATCH_API_KEY` in env, on the network, until they finish.
		// That breaks the per-conversation isolation guarantee on the
		// temporal axis. Adversarial review F1.
		pid := w.cmd.Process.Pid
		_ = syscall.Kill(-pid, syscall.SIGINT)
		// Best-effort hard kill if SIGINT didn't take. Negative pid sends
		// to the whole group; opencode's `defer` cleanup gets SIGINT first
		// for a chance to flush, then SIGKILL nukes the tree.
		go func(pid int) {
			time.Sleep(2 * time.Second)
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		}(pid)
	}
	// Shut down the authproxy so its externally-advertised port frees
	// up immediately; otherwise a respawn picking the same port would
	// fail with EADDRINUSE on the listener bind.
	if w.authProxy != nil {
		go w.authProxy.shutdown()
	}
}

// reapIdle scans the registry and kills workers idle longer than WorkerIdle.
func (m *Manager) reapIdle() {
	cutoff := m.cfg.WorkerIdle
	m.mu.Lock()
	candidates := make([]string, 0)
	for id, w := range m.workers {
		if w.idleSince() > cutoff {
			candidates = append(candidates, id)
		}
	}
	m.mu.Unlock()
	for _, id := range candidates {
		m.kill(id, "idle timeout")
	}
}
