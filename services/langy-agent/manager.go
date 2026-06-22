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

// Manager owns the per-conversation worker registry. It guarantees:
//   - One worker per conversationID (spawnLocks dedupe concurrent first turns)
//   - A hard cap at cfg.MaxWorkers using a synchronous pendingSpawns counter
//     so N distinct conversations arriving at once can't all observe an
//     empty registry and all spawn (this is the race the JS manager's
//     `pendingSpawns++` reservation fixed; we mirror it).
type Manager struct {
	cfg Config
	log *zap.Logger

	mu             sync.Mutex
	workers        map[string]*Worker
	spawnLocks     map[string]chan struct{}
	pendingSpawns  int32

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
func (m *Manager) Get(ctx context.Context, conversationID string, creds Credentials) (*Worker, error) {
	m.mu.Lock()
	if w, ok := m.workers[conversationID]; ok {
		m.mu.Unlock()
		return w, nil
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
	if int(m.workers_size_locked())+int(atomic.LoadInt32(&m.pendingSpawns)) >= m.cfg.MaxWorkers {
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

	w, err := m.spawn(ctx, conversationID, creds)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.workers[conversationID] = w
	m.mu.Unlock()
	return w, nil
}

// workers_size_locked returns the registry size. Must be called with mu held.
func (m *Manager) workers_size_locked() int {
	return len(m.workers)
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

// spawn is the inner creator. Called from Get under spawn-lock; no
// double-spawn possible. Validates conversationID, builds the per-worker
// home, starts opencode, waits for readiness, and creates the session.
func (m *Manager) spawn(ctx context.Context, conversationID string, creds Credentials) (*Worker, error) {
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

	uid := workerUIDFor(conversationID)
	if err := os.MkdirAll(workerHome, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir worker home: %w", err)
	}
	if err := setupWorkerHome(workerHome, creds, uid, m.cfg.OTelPluginVersion); err != nil {
		_ = os.RemoveAll(workerHome)
		return nil, err
	}

	port, err := getFreePort()
	if err != nil {
		_ = os.RemoveAll(workerHome)
		return nil, err
	}

	// We pass context.Background() to the worker process — the per-request
	// context controls a single chat turn, but the worker stays alive across
	// turns and only dies on idle/shutdown.
	cmd, err := spawnOpenCode(context.Background(), m.cfg, conversationID, workerHome, uid, port, creds)
	if err != nil {
		_ = os.RemoveAll(workerHome)
		return nil, err
	}

	// Watch for the subprocess dying on its own (OpenCode crash, OOM, etc.).
	// When it does, drop the registry entry and clean up the home so the
	// next request spawns fresh.
	go func() {
		err := cmd.Wait()
		m.log.Info("worker exited",
			zap.String("conversation", conversationID),
			zap.Error(err),
		)
		m.mu.Lock()
		delete(m.workers, conversationID)
		m.mu.Unlock()
		removeWorkerHome(m.cfg.SessionsRoot, conversationID, m.log)
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
		lastSeen:          time.Now(),
	}, nil
}

// kill terminates a worker and cleans its home. The Wait goroutine fires
// the registry delete on exit, but we also delete here to make the call
// synchronous from the caller's perspective.
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
		_ = w.cmd.Process.Signal(os.Interrupt)
		// Best-effort hard kill if SIGINT didn't take.
		go func(p *os.Process) {
			time.Sleep(2 * time.Second)
			_ = p.Kill()
		}(w.cmd.Process)
	}
	removeWorkerHome(m.cfg.SessionsRoot, conversationID, m.log)
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
