package diffkit

import (
	"os"
	"path/filepath"
	"syscall"
)

// LockOptions names a lock file and what to report while waiting for it.
type LockOptions struct {
	// Dir holds the lock file, created when missing.
	Dir string
	// Name is the lock file's name under Dir.
	Name string
	// Waiting is the line Progress receives when the lock is already held.
	Waiting string
	// Progress, when set, is called once with Waiting before blocking.
	Progress func(string)
}

// Lock holds a named flock under dir for one caller at a time, so lanes
// sharing a stack never boot or seed it twice at once. When it must wait, it
// calls progress(waiting) once. The lock goes with the process, or when the
// returned func runs.
func Lock(options LockOptions) (func(), error) {
	dir, name, waiting, progress := options.Dir, options.Name, options.Waiting, options.Progress
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_RDWR, 0o600) // #nosec G304 -- the tool's own run directory.
	if err != nil {
		return nil, err
	}
	if syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		if progress != nil {
			progress(waiting)
		}
		if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
			_ = file.Close()
			return nil, err
		}
	}
	return func() { _ = file.Close() }, nil
}
