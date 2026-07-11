package workerpool

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/adapters/egress"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/telemetry"
)

// newTestPool wires a Pool without touching the filesystem-bound construction
// path — New wipes SESSIONS_ROOT, which we don't want in a unit test. We
// instantiate the struct fields directly and exercise the allocator/state
// machinery in isolation.
func newTestPool(maxWorkers int) *Pool {
	return &Pool{
		maxWorkers: maxWorkers,
		telemetry:  telemetry.New(),
		egress:     egress.NewPassThrough(),
		baseCtx:    context.Background(),
		workers:    make(map[string]*Worker),
		spawnLocks: make(map[string]chan struct{}),
		uidToConv:  make(map[uint32]string),
		stopCh:     make(chan struct{}),
	}
}

func withLocked(p *Pool, fn func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	fn()
}

// conversation_97 and conversation_110 both hash to the same UID. Without
// probing, both workers would share a kernel identity and the chmod 0700
// cross-tenant boundary would collapse.
func TestPool_UIDAllocator_AvoidsHashCollision(t *testing.T) {
	collidingA := "conversation_97"
	collidingB := "conversation_110"
	if workerUIDFor(collidingA) != workerUIDFor(collidingB) {
		t.Fatalf("test premise broken: expected deterministic hash to collide for %q and %q", collidingA, collidingB)
	}

	p := newTestPool(64)
	var firstUID, secondUID uint32
	var firstErr, secondErr error
	withLocked(p, func() { firstUID, firstErr = p.reserveUIDLocked(collidingA) })
	withLocked(p, func() { secondUID, secondErr = p.reserveUIDLocked(collidingB) })

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

func TestPool_UIDAllocator_PrefersDeterministicSlot(t *testing.T) {
	p := newTestPool(64)
	conv := "conv-x"
	preferred := workerUIDFor(conv)
	var got uint32
	withLocked(p, func() { got, _ = p.reserveUIDLocked(conv) })
	if got != preferred {
		t.Errorf("first reservation for free convId expected preferred slot %d, got %d", preferred, got)
	}
}

func TestPool_UIDAllocator_ReleaseFreesTheSlot(t *testing.T) {
	p := newTestPool(64)
	withLocked(p, func() {
		uid, _ := p.reserveUIDLocked("conv-a")
		// Releasing under a wrong convId is a no-op — protects against the
		// reaped-worker-deletes-replacement race.
		p.releaseUIDLocked(uid, "different-conv")
		if _, ok := p.uidToConv[uid]; !ok {
			t.Fatalf("releaseUIDLocked freed slot under wrong convId")
		}
		p.releaseUIDLocked(uid, "conv-a")
		if _, ok := p.uidToConv[uid]; ok {
			t.Fatalf("releaseUIDLocked failed to free slot")
		}
	})
}

func TestPool_UIDAllocator_ExhaustionSurfacesError(t *testing.T) {
	p := newTestPool(64)
	withLocked(p, func() {
		for slot := uint32(0); slot < workerUIDRange; slot++ {
			p.uidToConv[workerUIDBase+slot] = "occupied"
		}
		_, err := p.reserveUIDLocked("new-conv")
		if err == nil {
			t.Fatalf("expected ErrNoFreeUID when every slot is occupied, got nil")
		}
		if !herr.IsCode(err, domain.ErrNoFreeUID) {
			t.Errorf("expected herr(ErrNoFreeUID), got %v", err)
		}
	})
}

// kill() removes the registry entry and the old subprocess exits
// asynchronously; meanwhile a replacement worker can be spawned for the same
// conversationID — same home path. If the old exit watcher wipes the home
// unconditionally, it rm -rf's the replacement's freshly written config. Verify
// the wipe decision respects "did a replacement take our slot?".
func TestPool_OnWorkerExit_ReplacementHomeSurvives(t *testing.T) {
	sessionsRoot := t.TempDir()
	conv := "conv-respawn"
	homeDir := filepath.Join(sessionsRoot, conv)
	if err := os.MkdirAll(homeDir, 0o700); err != nil {
		t.Fatalf("setup tempdir: %v", err)
	}
	marker := filepath.Join(homeDir, "config.json")
	if err := os.WriteFile(marker, []byte("replacement-creds"), 0o600); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	p := newTestPool(64)
	p.sessionsRoot = sessionsRoot

	oldCmd := &exec.Cmd{}
	newCmd := &exec.Cmd{}

	withLocked(p, func() {
		uid, err := p.reserveUIDLocked(conv)
		if err != nil {
			t.Fatalf("reserve uid: %v", err)
		}
		p.workers[conv] = &Worker{cmd: newCmd, uid: uid}
		go p.onWorkerExit(conv, oldCmd, uid)
	})

	for i := 0; i < 50; i++ {
		p.mu.Lock()
		_, stillThere := p.workers[conv]
		p.mu.Unlock()
		if stillThere {
			break
		}
	}

	p.mu.Lock()
	w, ok := p.workers[conv]
	p.mu.Unlock()
	if !ok {
		t.Fatalf("registry entry for %q was deleted by old exit watcher; replacement was lost", conv)
	}
	if w.cmd != newCmd {
		t.Fatalf("registry entry is not the replacement (cmd mismatch)")
	}

	got, err := os.ReadFile(marker)
	if err != nil {
		t.Fatalf("replacement marker was wiped by old exit watcher: %v", err)
	}
	if string(got) != "replacement-creds" {
		t.Fatalf("replacement marker content was changed: %q", string(got))
	}
}

// kill() ran, no replacement spawned yet. The old worker's exit watcher SHOULD
// wipe its home (otherwise we leak credentials on disk across pod lifetimes).
func TestPool_OnWorkerExit_EmptySlotWipesHome(t *testing.T) {
	sessionsRoot := t.TempDir()
	conv := "conv-reaped"
	homeDir := filepath.Join(sessionsRoot, conv)
	if err := os.MkdirAll(homeDir, 0o700); err != nil {
		t.Fatalf("setup tempdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(homeDir, "config.json"), []byte("dead-creds"), 0o600); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	p := newTestPool(64)
	p.sessionsRoot = sessionsRoot

	oldCmd := &exec.Cmd{}
	var uid uint32
	withLocked(p, func() { uid, _ = p.reserveUIDLocked(conv) })

	p.onWorkerExit(conv, oldCmd, uid)

	if _, err := os.Stat(homeDir); !os.IsNotExist(err) {
		t.Fatalf("home dir %q should be wiped when slot is empty; stat err: %v", homeDir, err)
	}
}

// kill() removed the entry, a new spawn for the same conversationID begins
// (spawnLocks[X] set, setupWorkerHome writing into the home), but the new worker
// hasn't been committed to workers yet — so onWorkerExit sees an empty slot. The
// in-flight spawn must suppress the wipe.
func TestPool_OnWorkerExit_InflightSpawnSuppressesWipe(t *testing.T) {
	sessionsRoot := t.TempDir()
	conv := "conv-inflight"
	homeDir := filepath.Join(sessionsRoot, conv)
	if err := os.MkdirAll(homeDir, 0o700); err != nil {
		t.Fatalf("setup tempdir: %v", err)
	}
	marker := filepath.Join(homeDir, "credentials")
	if err := os.WriteFile(marker, []byte("new-creds-in-flight"), 0o600); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	p := newTestPool(64)
	p.sessionsRoot = sessionsRoot

	oldCmd := &exec.Cmd{}
	var uid uint32
	withLocked(p, func() {
		uid, _ = p.reserveUIDLocked(conv)
		p.spawnLocks[conv] = make(chan struct{})
	})

	p.onWorkerExit(conv, oldCmd, uid)

	got, err := os.ReadFile(marker)
	if err != nil {
		t.Fatalf("in-flight spawn's marker was wiped by old exit watcher: %v", err)
	}
	if string(got) != "new-creds-in-flight" {
		t.Fatalf("marker content was changed: %q", string(got))
	}
}

func TestWorker_Claim_SerialisesConcurrentTurns(t *testing.T) {
	// Two simultaneous /chat for the same conversation would both subscribe to
	// the worker's /event stream and each terminate on the other's terminal
	// event. Claim returns false for the second caller so the app can 409 it.
	w := &Worker{}
	if !w.Claim() {
		t.Fatalf("first claim on a fresh worker should succeed")
	}
	if w.Claim() {
		t.Fatalf("second claim while still in-flight should fail")
	}
	w.Release()
	if !w.Claim() {
		t.Fatalf("after release a fresh claim should succeed")
	}
}

func TestPool_Acquire_AtCapacityReturnsErrMaxWorkers(t *testing.T) {
	p := newTestPool(1)
	// One worker already occupies the single slot.
	p.workers["existing"] = &Worker{}
	_, err := p.Acquire(context.Background(), "new-conv", domain.Credentials{
		LangwatchAPIKey: "k", LLMVirtualKey: "vk", GatewayBaseURL: "g", LangwatchEndpoint: "e",
	})
	if err == nil {
		t.Fatalf("expected ErrMaxWorkers when the pool is full")
	}
	if !herr.IsCode(err, domain.ErrMaxWorkers) {
		t.Fatalf("expected herr(ErrMaxWorkers), got %v", err)
	}
}

func TestPool_Acquire_ReusesWorkerWithMatchingSignature(t *testing.T) {
	p := newTestPool(4)
	creds := domain.Credentials{
		Model: "openai/gpt-5-mini", LangwatchAPIKey: "k", LLMVirtualKey: "vk",
		GatewayBaseURL: "g", LangwatchEndpoint: "e",
	}
	existing := &Worker{conversationID: "c", credSig: domain.SignatureOf(creds)}
	p.workers["c"] = existing

	got, err := p.Acquire(context.Background(), "c", creds)
	if err != nil {
		t.Fatalf("Acquire on a matching existing worker should not error, got %v", err)
	}
	if got.(*Worker) != existing {
		t.Fatalf("Acquire should return the existing worker for a matching credential signature")
	}
	if active, _ := p.Status(); active != 1 {
		t.Fatalf("no new worker should have been spawned; active=%d", active)
	}
}
