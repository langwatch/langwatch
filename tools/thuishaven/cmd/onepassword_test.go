package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

// TestMain puts an op that always refuses first on PATH and clears the
// account, so no command test can reach a developer's real 1Password vault.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "haven-no-op-")
	if err != nil {
		panic(err)
	}
	script := "#!/bin/sh\necho 'op is stubbed out in tests' >&2\nexit 1\n"
	if err := os.WriteFile(filepath.Join(dir, "op"), []byte(script), 0o700); err != nil { //nolint:gosec // an executable stub
		panic(err)
	}
	_ = os.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	_ = os.Unsetenv("LANGWATCH_OP_ACCOUNT")
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}
