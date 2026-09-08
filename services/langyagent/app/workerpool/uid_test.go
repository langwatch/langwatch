package workerpool

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/sharedidentity"
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

// The pool's reservation is tested separately from privileged syscalls, which
// the sandboxed runner tests cover. Delegating execution to shared identity
// lets the spawn run on an unprivileged development machine.
type applyingRunner struct{ app.Runner }

func (applyingRunner) AppliesIdentity() bool { return true }

// @scenario "The manager does not reserve worker identities it cannot enforce"
func TestPool_ReservesNoIdentityWhenTheRunnerCannotApplyOne(t *testing.T) {
	for _, tc := range []struct {
		name         string
		runner       app.Runner
		wantUID      uint32
		wantReserved bool
	}{
		{name: "shared identity", runner: sharedidentity.New()},
		{
			name:         "per-worker identity",
			runner:       applyingRunner{Runner: sharedidentity.New()},
			wantUID:      workerUIDFor("conv-identity"),
			wantReserved: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := newHarnessPool(t, stubPiBinary(t), nil)
			p.runner = tc.runner
			got, err := p.Acquire(context.Background(), "conv-identity", spawnableCreds())
			require.NoError(t, err)
			worker := got.(*Worker)
			require.Equal(t, tc.wantUID, worker.uid)

			p.mu.Lock()
			conversation, reserved := p.uidToConv[worker.uid]
			reservationCount := len(p.uidToConv)
			p.mu.Unlock()

			require.Equal(t, tc.wantReserved, reserved)
			if tc.wantReserved {
				require.Equal(t, "conv-identity", conversation)
				require.Equal(t, 1, reservationCount)
			} else {
				require.Zero(t, reservationCount)
			}
		})
	}

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
