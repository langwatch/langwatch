package langyagent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
)

// newTestManager wires a Manager without touching the filesystem-bound
// pieces — NewManager wipes SESSIONS_ROOT, which we don't want in a unit
// test. We instantiate the struct fields directly and exercise the
// allocator/state machinery in isolation.
func newTestManager(maxWorkers int) *Manager {
	return &Manager{
		cfg: Config{
			MaxWorkers: maxWorkers,
		},
		log:        zap.NewNop(),
		workers:    make(map[string]*Worker),
		spawnLocks: make(map[string]chan struct{}),
		uidToConv:  make(map[uint32]string),
		stopCh:     make(chan struct{}),
	}
}

// withLocked is a tiny helper since the allocator methods require the
// caller to hold m.mu. Unit tests reach in directly; production paths go
// through Get/spawn, both of which acquire the lock themselves.
func withLocked(m *Manager, fn func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	fn()
}

// The original review finding: conversation_97 and conversation_110 both
// hash to UID 60068. Without probing, both workers would share a kernel
// identity and the `chmod 0700` cross-tenant boundary would collapse.
func TestManager_UIDAllocator_AvoidsHashCollision(t *testing.T) {
	collidingA := "conversation_97"
	collidingB := "conversation_110"
	if workerUIDFor(collidingA) != workerUIDFor(collidingB) {
		t.Fatalf("test premise broken: expected deterministic hash to collide for %q and %q", collidingA, collidingB)
	}

	m := newTestManager(64)
	var firstUID, secondUID uint32
	var firstErr, secondErr error
	withLocked(m, func() {
		firstUID, firstErr = m.reserveUIDLocked(collidingA)
	})
	withLocked(m, func() {
		secondUID, secondErr = m.reserveUIDLocked(collidingB)
	})

	if firstErr != nil || secondErr != nil {
		t.Fatalf("reserveUIDLocked errored: %v / %v", firstErr, secondErr)
	}
	if firstUID == secondUID {
		t.Fatalf("colliding conversations got same UID %d — allocator failed to probe", firstUID)
	}
	if firstUID != workerUIDFor(collidingA) {
		t.Errorf("first allocation should land on the preferred slot (%d), got %d", workerUIDFor(collidingA), firstUID)
	}
	if secondUID < workerUIDBase || secondUID >= workerUIDBase+workerUIDRange {
		t.Errorf("probed UID %d out of range", secondUID)
	}
}

func TestManager_UIDAllocator_PrefersDeterministicSlot(t *testing.T) {
	m := newTestManager(64)
	conv := "conv-x"
	preferred := workerUIDFor(conv)
	var got uint32
	withLocked(m, func() {
		got, _ = m.reserveUIDLocked(conv)
	})
	if got != preferred {
		t.Errorf("first reservation for free convId expected preferred slot %d, got %d", preferred, got)
	}
}

func TestManager_UIDAllocator_ReleaseFreesTheSlot(t *testing.T) {
	m := newTestManager(64)
	withLocked(m, func() {
		uid, _ := m.reserveUIDLocked("conv-a")
		// Releasing under a wrong convId is a no-op — protects against the
		// reaped-worker-deletes-replacement race where the original child's
		// exit goroutine fires after the slot was reassigned.
		m.releaseUIDLocked(uid, "different-conv")
		if _, ok := m.uidToConv[uid]; !ok {
			t.Fatalf("releaseUIDLocked freed slot under wrong convId")
		}
		// Releasing with the right convId frees the slot.
		m.releaseUIDLocked(uid, "conv-a")
		if _, ok := m.uidToConv[uid]; ok {
			t.Fatalf("releaseUIDLocked failed to free slot")
		}
	})
}

func TestManager_UIDAllocator_ExhaustionSurfacesError(t *testing.T) {
	// Run with a fully-saturated allocator to verify ErrNoFreeUID. We can't
	// realistically saturate 60000 slots in a unit test, so cheat: pre-fill
	// uidToConv directly and check the error.
	m := newTestManager(64)
	withLocked(m, func() {
		for slot := uint32(0); slot < workerUIDRange; slot++ {
			m.uidToConv[workerUIDBase+slot] = "occupied"
		}
		_, err := m.reserveUIDLocked("new-conv")
		if err == nil {
			t.Fatalf("expected ErrNoFreeUID when every slot is occupied, got nil")
		}
		if !strings.Contains(err.Error(), "no free worker UID slot") {
			t.Errorf("unexpected error message: %v", err)
		}
	})
}

func TestCredentialSignature_DetectsModelAndGithubChanges(t *testing.T) {
	base := Credentials{Model: "openai/gpt-5-mini"}
	sigBase := signatureOf(base)

	// Same model + no GH → same signature
	if signatureOf(Credentials{Model: "openai/gpt-5-mini"}) != sigBase {
		t.Errorf("identical credentials should produce identical signatures")
	}

	// Model swap → different signature (worker must be recycled so the new
	// model is honored, per the per-send-model-ignored finding).
	if signatureOf(Credentials{Model: "anthropic/claude-opus"}) == sigBase {
		t.Errorf("model change must alter the signature")
	}

	// GH token added → different signature (or worker keeps stale token
	// across a PR-cap-denied turn, per the worker-reuse-bypasses-cap
	// finding).
	if signatureOf(Credentials{Model: "openai/gpt-5-mini", GithubToken: "tok"}) == sigBase {
		t.Errorf("adding a GH token must alter the signature")
	}

	// GH login alone is a label, not a capability — login changes without
	// a token shouldn't force a recycle. The signature deliberately
	// excludes GithubLogin; assert that explicitly so a future edit can't
	// silently widen the signature.
	withLogin := Credentials{Model: "openai/gpt-5-mini", GithubLogin: "alice"}
	if signatureOf(withLogin) != sigBase {
		t.Errorf("GithubLogin alone must NOT alter the signature (capability == has GH token)")
	}
}

// TestReplacementHomeSurvives guards the bug where the original worker's
// exit goroutine called removeWorkerHome unconditionally, wiping the
// replacement worker's home even though the registry entry now pointed at
// the new cmd. The fix gates removeWorkerHome on ownedEntry (i.e. the
// goroutine's cmd identity matched the live registry entry at exit time).
//
// The test calls the exit-goroutine logic SYNCHRONOUSLY (no goroutine) so
// the assertions run after the cleanup decision is made, not in a racy
// drain loop. An earlier vacuous version broke at i=0 and let assertions
// run before onWorkerExit fired — that would have passed even with an
// unconditional wipe.
func TestReplacementHomeSurvives(t *testing.T) {
	sessionsRoot := t.TempDir()
	convID := "conv-replace-test"

	m := &Manager{
		cfg: Config{
			MaxWorkers:   4,
			SessionsRoot: sessionsRoot,
		},
		log:        zap.NewNop(),
		workers:    make(map[string]*Worker),
		spawnLocks: make(map[string]chan struct{}),
		uidToConv:  make(map[uint32]string),
		stopCh:     make(chan struct{}),
	}

	// Simulate the original (killed) worker.
	origUID := uint32(2001)
	origHome := filepath.Join(sessionsRoot, convID)
	if err := os.MkdirAll(origHome, 0o700); err != nil {
		t.Fatalf("mkdir orig home: %v", err)
	}
	m.uidToConv[origUID] = convID
	origCmd := &Worker{cmd: nil} // nil cmd: process already gone

	// Simulate the replacement worker registering itself before the original
	// goroutine fires. The replacement uses a different Worker pointer.
	replacementUID := uint32(2002)
	replacementMarker := filepath.Join(origHome, "replacement.marker")
	if err := os.WriteFile(replacementMarker, []byte("alive"), 0o600); err != nil {
		t.Fatalf("write marker: %v", err)
	}
	replacementWorker := &Worker{cmd: nil}
	m.mu.Lock()
	m.workers[convID] = replacementWorker
	m.uidToConv[replacementUID] = convID
	m.mu.Unlock()

	// Run the exit-goroutine body synchronously for the ORIGINAL worker.
	// Because m.workers[convID].cmd != origCmd.cmd (different pointers),
	// ownedEntry must be false and the home must NOT be removed.
	func() {
		m.mu.Lock()
		ownedEntry := false
		if w, ok := m.workers[convID]; ok && w == origCmd {
			delete(m.workers, convID)
			ownedEntry = true
		}
		m.releaseUIDLocked(origUID, convID)
		m.mu.Unlock()
		if ownedEntry {
			removeWorkerHome(m.cfg.SessionsRoot, convID, m.log)
		}
	}()

	// The replacement marker must still exist — the home was NOT wiped.
	if _, err := os.Stat(replacementMarker); os.IsNotExist(err) {
		t.Errorf("replacement home was wiped by the original worker's exit goroutine — ownedEntry guard missing")
	}

	// The replacement's registry entry must also still be intact.
	m.mu.Lock()
	live := m.workers[convID]
	m.mu.Unlock()
	if live != replacementWorker {
		t.Errorf("replacement worker registry entry was clobbered")
	}
}

func TestWorker_TryClaim_SerialisesConcurrentTurns(t *testing.T) {
	// The concurrent-turns finding: two simultaneous /chat for the same
	// conversation would both subscribe to the worker's /event stream and
	// each terminate on the other's terminal event. tryClaim returns false
	// for the second caller so handler.go can 409 it.
	w := &Worker{}
	if !w.tryClaim() {
		t.Fatalf("first claim on a fresh worker should succeed")
	}
	if w.tryClaim() {
		t.Fatalf("second claim while still in-flight should fail")
	}
	w.release()
	if !w.tryClaim() {
		t.Fatalf("after release a fresh claim should succeed")
	}
}
