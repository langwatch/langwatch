package langyagent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
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
		// Capability mismatch: delete the registry entry NOW under the lock so
		// no concurrent Get sees the stale worker after we release. Then kill
		// the process outside the lock — the SIGINT is slow, and blocking
		// other conversations on it hurts throughput.
		delete(m.workers, conversationID)
		m.mu.Unlock()
		m.killWorker(w, conversationID, "credential capability changed")
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

	port, err := getFreePort()
	if err != nil {
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, err
	}

	// We pass context.Background() to the worker process — the per-request
	// context controls a single chat turn, but the worker stays alive across
	// turns and only dies on idle/shutdown.
	cmd, err := spawnOpenCode(context.Background(), m.cfg, conversationID, workerHome, uid, port, creds)
	if err != nil {
		_ = os.RemoveAll(workerHome)
		cleanupUID()
		return nil, err
	}

	// Watch for the subprocess dying on its own (crash, OOM, kill). The
	// registry delete is guarded by *exec.Cmd identity: if a replacement
	// worker (different *exec.Cmd) was spawned for the same conversation
	// after this one was killed, the prior child's exit must not clobber
	// the replacement's registry slot or its UID reservation.
	go func() {
		err := cmd.Wait()
		m.log.Info("worker exited",
			zap.String("conversation", conversationID),
			zap.Error(err),
		)
		m.mu.Lock()
		ownedEntry := false
		if w, ok := m.workers[conversationID]; ok && w.cmd == cmd {
			delete(m.workers, conversationID)
			ownedEntry = true
		}
		m.releaseUIDLocked(uid, conversationID)
		m.mu.Unlock()
		// Only remove the home if this goroutine owned the registry entry.
		// A replacement worker spawned for the same conversationID after this
		// one was killed (credential mismatch) shares the same path; removing
		// it unconditionally would wipe the replacement's home and credentials.
		if ownedEntry {
			removeWorkerHome(m.cfg.SessionsRoot, conversationID, m.log)
		}
	}()

	readinessCtx, cancel := context.WithTimeout(ctx, m.cfg.ReadinessTimeout)
	defer cancel()
	if err := waitForReadiness(readinessCtx, port, m.cfg.ReadinessTimeout); err != nil {
		_ = cmd.Process.Kill()
		return nil, err
	}

	sessionID, err := createOpenCodeSession(ctx, port)
	if err != nil {
		_ = cmd.Process.Kill()
		return nil, err
	}

	m.log.Info("worker ready",
		zap.String("conversation", conversationID),
		zap.Int("port", port),
		zap.String("session", sessionID),
		zap.Uint32("uid", uid),
	)

	return &Worker{
		conversationID:    conversationID,
		port:              port,
		openCodeSessionID: sessionID,
		cmd:               cmd,
		uid:               uid,
		credSig:           sig,
		lastSeen:          time.Now(),
	}, nil
}

// kill terminates a worker and removes it from the registry. The exit-watcher
// goroutine in spawn() fires the home-cleanup on actual process exit; this
// synchronous path drops the entry immediately so callers don't see a
// half-dead worker.
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
	m.killWorker(w, conversationID, reason)
}

// killWorker sends SIGINT to the worker process and schedules a hard SIGKILL
// after 2 s. Callers that have already removed the entry from the registry
// (e.g. Get's credential-mismatch path, which deletes under the lock) use
// this directly so they don't double-delete.
func (m *Manager) killWorker(w *Worker, conversationID, reason string) {
	m.log.Info("killing worker",
		zap.String("conversation", conversationID),
		zap.String("reason", reason),
	)
	if w.cmd != nil && w.cmd.Process != nil {
		_ = w.cmd.Process.Signal(os.Interrupt)
		go func(p *os.Process) {
			time.Sleep(2 * time.Second)
			_ = p.Kill()
		}(w.cmd.Process)
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
