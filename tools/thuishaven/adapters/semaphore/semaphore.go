// Package semaphore implements app.Semaphore as a machine-wide, file-lock counting
// semaphore under the thuishaven home dir. File locks (flock) are used instead of
// routing through the daemon so a slot is held for exactly as long as the holding
// process lives: if `haven typecheck` is killed, the OS drops its flock and the
// slot frees immediately — no daemon bookkeeping to leak. It works even while the
// daemon is restarting.
package semaphore

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// Semaphore is the file-lock-backed implementation of app.Semaphore.
type Semaphore struct{ home string }

// New builds a Semaphore rooted at the thuishaven home dir.
func New(home string) *Semaphore { return &Semaphore{home: home} }

// Acquire blocks until one of `slots` slots for `name` is free, then returns a
// release func and the 1-based slot index taken. It polls non-blocking flocks so
// ctx cancellation aborts a wait promptly.
func (s *Semaphore) Acquire(ctx context.Context, name string, slots int) (func(), int, error) {
	if slots < 1 {
		slots = 1
	}
	dir := filepath.Join(s.home, "locks", name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, 0, err
	}
	for {
		for i := 0; i < slots; i++ {
			f, err := os.OpenFile(filepath.Join(dir, fmt.Sprintf("slot-%d", i)), os.O_CREATE|os.O_RDWR, 0o644)
			if err != nil {
				continue
			}
			if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err == nil {
				release := func() {
					_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
					_ = f.Close()
				}
				return release, i + 1, nil
			}
			_ = f.Close()
		}
		select {
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}
