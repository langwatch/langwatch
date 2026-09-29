package diffkit

import (
	"os"
	"path/filepath"
	"syscall"
)

// Lock holds a named flock under dir for one caller at a time, so lanes
// sharing a stack never boot or seed it twice at once. When it must wait, it
// calls progress(waiting) once. The lock goes with the process, or when the
// returned func runs.
func Lock(dir, name, waiting string, progress func(string)) (func(), error) {
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
