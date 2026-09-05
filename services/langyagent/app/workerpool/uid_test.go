package workerpool

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

func TestWorkerUIDFor_Deterministic(t *testing.T) {
	// Same conversation id always maps to the same UID — the property the
	// chmod 0700 + spawn(uid) isolation relies on. If this drifts, an existing
	// per-session dir is no longer readable by its second turn.
	a := workerUIDFor("conv-abc")
	b := workerUIDFor("conv-abc")
	if a != b {
		t.Fatalf("expected same UID for same convId, got %d vs %d", a, b)
	}
}

func TestWorkerUIDFor_RangeBoundedAndAboveSystemReserved(t *testing.T) {
	// Spot-check a broad sample stays within [2000, 62000).
	for _, id := range []string{
		"a", "b", "conv-1", "conv-2", "conv-3",
		strings.Repeat("x", 64), strings.Repeat("y", 128),
		"cmaktest_abc", "x-y-z",
	} {
		u := workerUIDFor(id)
		if u < workerUIDBase || u >= workerUIDBase+workerUIDRange {
			t.Fatalf("uid %d for %q outside [%d, %d)", u, id, workerUIDBase, workerUIDBase+workerUIDRange)
		}
	}
}

func TestWorkerUIDFor_DifferentInputsSpread(t *testing.T) {
	// Two distinct conversation ids should almost-never collide. This is not a
	// uniformity proof; it's a smoke test that the hash is being used at all (a
	// bug that returned a constant would fail here).
	seen := map[uint32]bool{}
	for i := 0; i < 1024; i++ {
		id := "conv-" + string(rune('a'+i%26)) + "-" + strings.Repeat("z", i%17)
		seen[workerUIDFor(id)] = true
	}
	if len(seen) < 256 {
		t.Fatalf("expected wide UID spread, only %d distinct UIDs in 1024 samples", len(seen))
	}
}

// nonApplyingRunner mirrors adapters/runner/sharedidentity: it reports that it
// applies no identity, so the pool must not reserve one. Only AppliesIdentity is
// exercised — reserveUIDLocked is reached long before any other method, which is
// exactly why the embedded port can stay nil.
type nonApplyingRunner struct{ app.Runner }

func (nonApplyingRunner) AppliesIdentity() bool { return false }

type applyingRunner struct{ app.Runner }

func (applyingRunner) AppliesIdentity() bool { return true }

// ADR-130 §4. Under shared identity every Chown is a no-op and SysProcAttr
// ignores the uid, so a reservation would register a number describing no
// running process, and could fail a spawn closed on a resource nothing is
// enforcing.
//
// This asserts against the POOL's decision rather than the runner's syscall
// arguments. A runner-level test ("SysProcAttr sets no Credential") passes
// whether or not the reservation happens, which is how this scenario read as
// covered while the pool still reserved a uid on every spawn.
//
// @scenario "The manager does not reserve worker identities it cannot enforce"
func TestPool_ReservesNoIdentityWhenTheRunnerCannotApplyOne(t *testing.T) {
	t.Run("given a runner that applies no identity", func(t *testing.T) {
		p := newTestPool(4)
		p.runner = nonApplyingRunner{}

		if p.appliesIdentity() {
			t.Fatal("a runner reporting AppliesIdentity()=false must not have an identity reserved for it")
		}
		if len(p.uidToConv) != 0 {
			t.Fatalf("uidToConv = %v, want empty — nothing may be reserved under shared identity", p.uidToConv)
		}
	})

	t.Run("when the runner does apply one", func(t *testing.T) {
		p := newTestPool(4)
		p.runner = applyingRunner{}
		if !p.appliesIdentity() {
			t.Fatal("a runner reporting AppliesIdentity()=true must reserve")
		}
	})

	// The negative control that makes the two above mean something: a Pool built
	// by hand with no runner must still reserve, matching New's documented
	// fail-closed defaulting to the sandboxed substrate. A mis-wire runs
	// isolated, never accidentally shared.
	t.Run("when no runner is wired at all", func(t *testing.T) {
		p := newTestPool(4)
		if !p.appliesIdentity() {
			t.Fatal("a nil runner must fail CLOSED to reserving an identity")
		}
	})
}
