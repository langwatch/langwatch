// Package atomicfile writes a file in one step, so no reader ever observes a
// half-written one. Shared by every adapter that publishes a file other
// processes read while it is being rewritten.
package atomicfile

import (
	"os"
	"path/filepath"
)

// Write creates the file's content in a temporary sibling and renames it into
// place. The rename is what makes it atomic, and the sibling is what makes the
// rename possible — a temp file on another filesystem could not be renamed
// across, only copied.
func Write(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }() // a no-op once the rename succeeds
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
