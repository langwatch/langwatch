package workerpool

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// sessionsRootLockName is the file inside SESSIONS_ROOT whose advisory lock
// says which manager owns the tree.
//
// SESSIONS_ROOT holds every worker home and every conversation's pi session
// stash, and a manager wipes the whole tree at boot (a crashed predecessor can
// leave plaintext session credentials and cloned repositories behind, and the
// pod volume outlives the process). That wipe is only safe while one manager
// owns the tree. Two managers sharing one root is not a rare configuration
// mistake: on a developer machine every checkout resolves SESSIONS_ROOT to the
// same path under $HOME, so a second manager booting, or a manager that cannot
// bind its port and is restarted in a loop, deletes the live manager's worker
// homes and session stashes under running turns. The worker then fails its next
// session write with ENOENT and the turn dies far from the cause.
//
// The lock makes that state impossible: a manager that cannot take it refuses
// to boot and says why, instead of wiping somebody else's tree. The leading dot
// keeps the name outside the validated conversation-id charset, so it can never
// collide with a worker home.
const sessionsRootLockName = ".manager.lock"

// sessionsRootLock is the held lock. Release drops it; process exit drops it
// too, so a crashed manager never leaves the root unusable.
type sessionsRootLock struct {
	file *os.File
}

// lockSessionsRoot creates the root if needed and takes the exclusive advisory
// lock on it. It fails when another live manager holds the lock.
func lockSessionsRoot(root string) (*sessionsRootLock, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir sessions root: %w", err)
	}
	path := filepath.Join(root, sessionsRootLockName)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open sessions root lock: %w", err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf(
			"another langy manager is already using SESSIONS_ROOT %s; give this one its own directory: %w",
			root, err,
		)
	}
	return &sessionsRootLock{file: file}, nil
}

func (l *sessionsRootLock) Release() {
	if l == nil || l.file == nil {
		return
	}
	_ = syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
	_ = l.file.Close()
	l.file = nil
}

// wipeSessionsRoot empties the root of everything a previous manager left,
// keeping the lock file this manager holds open. Emptying rather than removing
// the directory itself also keeps a mounted volume mounted.
func wipeSessionsRoot(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read sessions root: %w", err)
	}
	for _, entry := range entries {
		if entry.Name() == sessionsRootLockName {
			continue
		}
		if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
			return fmt.Errorf("wipe sessions root entry %s: %w", entry.Name(), err)
		}
	}
	return nil
}
