package access

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// WriteIfChanged replaces path with data atomically, only when the content
// differs, and reports whether it wrote. The temporary file is hidden and has
// no .yaml/.xml extension, so ClickHouse never merges a half-written file.
func WriteIfChanged(path string, data []byte) (bool, error) {
	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, data) {
		return false, nil
	}
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".access-*.tmp")
	if err != nil {
		return false, err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return false, err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return false, err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return false, err
	}
	if err := tmp.Close(); err != nil {
		return false, err
	}
	return true, os.Rename(tmp.Name(), path)
}
