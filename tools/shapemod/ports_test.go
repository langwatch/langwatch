package shapemod

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// fakeRunner is a Runner double for ports_test.go. RenameFile performs a
// real move on disk (relative to dir) so a rename retry can read the moved
// file's content; Rename and RenameAtLine only record calls and return
// canned results.
type fakeRunner struct {
	renameFileCalls   int
	renameCalls       []struct{ symbol, newName string }
	renameAtLineCalls []struct {
		file   string
		line   int
		symbol string
		name   string
	}
	diagnosticsCalls int

	renameOut string
	renameErr error
}

func (f *fakeRunner) RenameFile(dir, oldPath, newPath string) (string, error) {
	f.renameFileCalls++
	src := filepath.Join(dir, oldPath)
	dst := filepath.Join(dir, newPath)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(src, dst); err != nil {
		return "", err
	}
	return "", nil
}

func (f *fakeRunner) Rename(dir, symbol, newName string) (string, error) {
	f.renameCalls = append(f.renameCalls, struct{ symbol, newName string }{symbol, newName})
	if f.renameErr != nil {
		return f.renameOut, f.renameErr
	}
	return "", nil
}

func (f *fakeRunner) RenameAtLine(dir, path string, line int, symbol, newName string) (string, error) {
	f.renameAtLineCalls = append(f.renameAtLineCalls, struct {
		file   string
		line   int
		symbol string
		name   string
	}{path, line, symbol, newName})
	return "", nil
}

func (f *fakeRunner) Diagnostics(dir, path string) (string, error) {
	f.diagnosticsCalls++
	return "", nil
}

func writeFixture(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPortsApplyAbortsOnDuplicateDestination(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"

	// Two files both classify to subject "thing" (the store/port suffix is
	// stripped), so both plan the same destination path and symbol.
	writeFixture(t, root, filepath.Join(moduleDir, "server/src/ports/thing.port.ts"), `
export interface ThingPort {
  findById(id: string): Promise<unknown>;
}
`)
	writeFixture(t, root, filepath.Join(moduleDir, "server/src/ports/thing.store.ts"), `
export interface ThingStore {
  save(thing: unknown): Promise<void>;
}
`)

	runner := &fakeRunner{}
	var stdout, stderr bytes.Buffer
	result, code := Ports(root, moduleDir, true, runner, &stdout, &stderr)

	if code != 1 {
		t.Fatalf("code = %d, want 1", code)
	}
	if !result.Aborted {
		t.Fatal("result.Aborted = false, want true")
	}
	if result.Applied {
		t.Fatal("result.Applied = true, want false: nothing should have been written")
	}
	if runner.renameFileCalls != 0 || len(runner.renameCalls) != 0 || runner.diagnosticsCalls != 0 {
		t.Fatalf("runner was called: renameFile=%d rename=%d diagnostics=%d, want all zero",
			runner.renameFileCalls, len(runner.renameCalls), runner.diagnosticsCalls)
	}
	if !bytes.Contains(stdout.Bytes(), []byte("collision")) {
		t.Fatalf("stdout does not mention collisions:\n%s", stdout.String())
	}
}

func TestPortsApplyAbortsOnExistingDestinationFile(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"

	writeFixture(t, root, filepath.Join(moduleDir, "server/src/ports/thing.port.ts"), `
export interface ThingPort {
  findById(id: string): Promise<unknown>;
}
`)
	// Pre-existing file already sitting at the planned destination.
	writeFixture(t, root, filepath.Join(moduleDir, "server/src/repositories/thing.repository.ts"), `
export interface ThingRepository {
  findById(id: string): Promise<unknown>;
}
`)

	runner := &fakeRunner{}
	var stdout, stderr bytes.Buffer
	result, code := Ports(root, moduleDir, true, runner, &stdout, &stderr)

	if code != 1 || !result.Aborted {
		t.Fatalf("code = %d, aborted = %v, want 1/true", code, result.Aborted)
	}
	if runner.renameFileCalls != 0 {
		t.Fatalf("renameFileCalls = %d, want 0", runner.renameFileCalls)
	}
	if !bytes.Contains(stdout.Bytes(), []byte("already exists on disk")) {
		t.Fatalf("stdout does not report the existing-file collision:\n%s", stdout.String())
	}
}

func TestPortsApplyRetriesAmbiguousRenameByLine(t *testing.T) {
	root := t.TempDir()
	moduleDir := "modules/thing"

	writeFixture(t, root, filepath.Join(moduleDir, "server/src/ports/thing.port.ts"), `// wire the thing
export interface ThingPort {
  findById(id: string): Promise<unknown>;
}
`)

	runner := &fakeRunner{
		renameErr: errAmbiguous,
		renameOut: `ambiguous symbol "ThingPort" -- 2 matches. Pass { file, line } to disambiguate.`,
	}
	var stdout, stderr bytes.Buffer
	result, code := Ports(root, moduleDir, true, runner, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("code = %d, want 0; stderr:\n%s", code, stderr.String())
	}
	if !result.Applied || result.Aborted {
		t.Fatalf("applied = %v aborted = %v, want true/false", result.Applied, result.Aborted)
	}
	if len(runner.renameCalls) != 1 {
		t.Fatalf("renameCalls = %d, want 1", len(runner.renameCalls))
	}
	if len(runner.renameAtLineCalls) != 1 {
		t.Fatalf("renameAtLineCalls = %d, want 1", len(runner.renameAtLineCalls))
	}
	retry := runner.renameAtLineCalls[0]
	// "export interface ThingPort" is the second line (index 1, zero-based)
	// of the moved file - line 0 is the leading comment - found by regexp on
	// the moved file itself, not parsed out of tslsp-cli's error text.
	if retry.line != 1 {
		t.Fatalf("retry line = %d, want 1", retry.line)
	}
	if retry.name != "ThingRepository" {
		t.Fatalf("retry newName = %q, want ThingRepository", retry.name)
	}
	if retry.symbol != "ThingPort" {
		t.Fatalf("retry symbol = %q, want ThingPort", retry.symbol)
	}
	if retry.file != filepath.Join("src/repositories", "thing.repository.ts") {
		t.Fatalf("retry file = %q", retry.file)
	}
}

// errAmbiguous is a stand-in tslsp-cli exit error; its text is irrelevant,
// only the out string ports.go inspects matters.
var errAmbiguous = &fakeError{"tslsp-cli rename: ambiguous"}

type fakeError struct{ msg string }

func (e *fakeError) Error() string { return e.msg }
