// Package semaphore implements app.Semaphore as a machine-wide, file-lock counting
// semaphore under the thuishaven home dir. File locks (flock) are used instead of
// routing through the daemon so a slot is held for exactly as long as the holding
// process lives: if `haven machine typecheck` is killed, the OS drops its flock and the
// slot frees immediately — no daemon bookkeeping to leak. It works even while the
// daemon is restarting.
package semaphore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Semaphore is the file-lock-backed implementation of app.Semaphore.
type Semaphore struct{ home string }

// New builds a Semaphore rooted at the thuishaven home dir.
func New(home string) *Semaphore { return &Semaphore{home: home} }

// Acquire blocks until one of `slots` slots for `name` is free, then returns a
// release func and the 1-based slot index taken. It polls non-blocking flocks so
// ctx cancellation aborts a wait promptly.
func (s *Semaphore) Acquire(ctx context.Context, name string, slots int) (func(), int, error) {
	for {
		release, slot, ok, err := s.TryAcquire(name, slots)
		if err != nil {
			return nil, 0, err
		}
		if ok {
			return release, slot, nil
		}
		select {
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// TryAcquire takes a free slot for `name` if one exists right now, without
// waiting. ok=false means every slot is held — which is the fact a caller
// needs in order to tell its user "queued behind N others" instead of sitting
// silent the way a blocking Acquire would.
func (s *Semaphore) TryAcquire(name string, slots int) (release func(), slot int, ok bool, err error) {
	if slots < 1 {
		slots = 1
	}
	dir := filepath.Join(s.home, "locks", name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, 0, false, err
	}
	for i := 0; i < slots; i++ {
		f, err := os.OpenFile(filepath.Join(dir, fmt.Sprintf("slot-%d", i)), os.O_CREATE|os.O_RDWR, 0o600)
		if err != nil {
			return nil, 0, false, err
		}
		lockErr := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if lockErr == nil {
			// A unit holder killed outright leaves its claim behind; clear it so
			// Holders does not name the dead run as this one.
			_ = f.Truncate(0)
			return func() { unlock(f) }, i + 1, true, nil
		}
		_ = f.Close()
		if !isHeld(lockErr) {
			return nil, 0, false, lockErr
		}
	}
	return nil, 0, false, nil
}

// TryAcquireUnits takes claim.Units of the first `budget` lock files for
// `name` right now, all or none: a partial take is given back before it
// returns, so a run never sits on part of the budget while it waits for the
// rest. A weight over the budget takes the whole budget. Each file carries
// claim, which `Holders` reads back.
func (s *Semaphore) TryAcquireUnits(name string, budget int, claim domain.SlotClaim) (release func(), ok bool, err error) {
	budget = max(budget, 1)
	units := min(max(claim.Units, 1), budget)
	dir := filepath.Join(s.home, "locks", name)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, false, err
	}
	held, err := lockFree(dir, units, budget)
	giveBack := func() {
		for _, f := range held {
			unlock(f)
		}
	}
	if err != nil || len(held) < units {
		giveBack()
		return nil, false, err
	}
	claim.Units = units
	body, err := json.Marshal(claim)
	if err != nil {
		giveBack()
		return nil, false, err
	}
	for _, f := range held {
		_ = f.Truncate(0)
		_, _ = f.WriteAt(body, 0)
	}
	return giveBack, true, nil
}

// lockFree locks free files among the first budget, stopping at units. On an
// error the files locked so far are returned with it, for the caller to free.
func lockFree(dir string, units, budget int) ([]*os.File, error) {
	var held []*os.File
	for i := 0; i < budget && len(held) < units; i++ {
		f, err := os.OpenFile(filepath.Join(dir, fmt.Sprintf("slot-%d", i)), os.O_CREATE|os.O_RDWR, 0o600)
		if err != nil {
			return held, err
		}
		lockErr := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if lockErr == nil {
			held = append(held, f)
			continue
		}
		_ = f.Close()
		if !isHeld(lockErr) {
			return held, lockErr
		}
	}
	return held, nil
}

// Holders lists who holds `name`'s lock files right now, one entry per holder,
// oldest first. A file held by a run that wrote no claim (the gate and
// `haven machine typecheck` take one file each) is one unnamed unit, PID 0.
func (s *Semaphore) Holders(name string) []domain.SlotClaim {
	dir := filepath.Join(s.home, "locks", name)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var held []domain.SlotClaim
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "slot-") {
			continue
		}
		if claim, ok := readHeld(filepath.Join(dir, entry.Name())); ok {
			held = append(held, claim)
		}
	}
	out := groupByHolder(held)
	sort.SliceStable(out, func(a, b int) bool { return out[a].StartedAt.Before(out[b].StartedAt) })
	return out
}

// groupByHolder folds one claim per held file into one per holder, counting
// its files as units; a file with no claim is its own unnamed unit.
func groupByHolder(files []domain.SlotClaim) []domain.SlotClaim {
	var out []domain.SlotClaim
	index := map[int]int{}
	for _, claim := range files {
		if i, ok := index[claim.PID]; ok && claim.PID > 0 {
			out[i].Units++
			continue
		}
		if claim.PID > 0 {
			index[claim.PID] = len(out)
		}
		claim.Units = 1
		out = append(out, claim)
	}
	return out
}

// readHeld reports whether a lock file is held, and the claim in it. A shared
// probe that succeeds means nobody holds it; it is dropped at once.
func readHeld(path string) (domain.SlotClaim, bool) {
	f, err := os.Open(path)
	if err != nil {
		return domain.SlotClaim{}, false
	}
	defer func() { _ = f.Close() }()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_SH|syscall.LOCK_NB); err == nil {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		return domain.SlotClaim{}, false
	}
	var claim domain.SlotClaim
	body, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(body, &claim) != nil {
		return domain.SlotClaim{}, true
	}
	return claim, true
}

// unlock clears a file's claim, then drops its flock and closes it.
func unlock(f *os.File) {
	_ = f.Truncate(0)
	_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	_ = f.Close()
}

func isHeld(err error) bool {
	return errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN)
}
