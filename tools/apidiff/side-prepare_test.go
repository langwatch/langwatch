package apidiff

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func monolithTree(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "platform", "app"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "platform", "app", "package.json"), []byte(`{"name":"@langwatch/web"}`), 0o600); err != nil {
		t.Fatal(err)
	}
}

// prepareRecorder records every command it is asked to run, safe for both
// side pipelines at once.
type prepareRecorder struct {
	mu       sync.Mutex
	commands []commandSpec
}

func (recorder *prepareRecorder) run(_ context.Context, spec commandSpec, _ io.Writer) error {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	recorder.commands = append(recorder.commands, spec)
	return nil
}

func (recorder *prepareRecorder) in(dir string) []string {
	var got []string
	for _, spec := range recorder.commands {
		if spec.dir == dir {
			got = append(got, spec.name+" "+strings.Join(spec.args, " "))
		}
	}
	return got
}

func TestEachTreeIsPreparedOnceForItsOwnLayout(t *testing.T) {
	branchDir, mainDir := t.TempDir(), t.TempDir()
	modularWorktree(t, branchDir)
	monolithTree(t, mainDir)
	recorder := &prepareRecorder{}
	state := &bootState{cfg: BootConfig{BranchDir: branchDir}, mainDir: mainDir, stderr: &lockedWriter{out: io.Discard}, run: recorder.run}
	if err := state.prepareTrees(context.Background()); err != nil {
		t.Fatalf("prepareTrees: %v", err)
	}
	wantBranch := "env -u CI pnpm install --frozen-lockfile\npnpm run start:prepare:files\npnpm run ensure:built"
	if got := strings.Join(recorder.in(branchDir), "\n"); got != wantBranch {
		t.Errorf("branch prepare ran\n%s\nwant\n%s", got, wantBranch)
	}
	wantMain := "env -u CI pnpm install --frozen-lockfile\npnpm run start:prepare:files"
	if got := strings.Join(recorder.in(mainDir), "\n"); got != wantMain {
		t.Errorf("main prepare ran\n%s\nwant\n%s", got, wantMain)
	}
	if !state.prepared {
		t.Error("a prepared run must tell boot to skip its own install")
	}
	before := len(recorder.commands)
	if err := state.install(context.Background(), Instance{Name: "branch", Dir: branchDir, Profile: modularProfile}); err != nil {
		t.Fatal(err)
	}
	if len(recorder.commands) != before {
		t.Errorf("boot installed a tree the parity phase prepared: %v", recorder.commands[before:])
	}
}

func TestSkipInstallPreparesNothing(t *testing.T) {
	recorder := &prepareRecorder{}
	state := &bootState{cfg: BootConfig{BranchDir: t.TempDir(), SkipInstall: true}, mainDir: t.TempDir(), stderr: &lockedWriter{out: io.Discard}, run: recorder.run}
	if err := state.prepareTrees(context.Background()); err != nil {
		t.Fatalf("prepareTrees: %v", err)
	}
	if len(recorder.commands) != 0 || !state.prepared {
		t.Errorf("-skip-install ran %v, prepared=%t", recorder.commands, state.prepared)
	}
}

func TestLinePrefixerTagsWholeLinesOnly(t *testing.T) {
	var out bytes.Buffer
	writer := &linePrefixer{out: &out, prefix: "main | "}
	for _, chunk := range []string{"one\ntw", "o\n", "partial"} {
		if _, err := writer.Write([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
	}
	if got, want := out.String(), "main | one\nmain | two\n"; got != want {
		t.Errorf("prefixed %q, want %q", got, want)
	}
}

func TestInPoolRunsEveryIndexOnce(t *testing.T) {
	seen := make([]atomic.Int32, 20)
	inPool(len(seen), 4, func(index int) { seen[index].Add(1) })
	for index := range seen {
		if seen[index].Load() != 1 {
			t.Errorf("index %d ran %d times", index, seen[index].Load())
		}
	}
}

func TestMainSignsInWithItsOwnAdminFirst(t *testing.T) {
	engine := &probeEngine{options: ProbeOptions{A: "http://a", B: "http://b"}}
	if got := engine.adminEmailsFor("http://b")[0]; got != "admin@haven.localhost" {
		t.Errorf("main tries %s first", got)
	}
	if got := engine.adminEmailsFor("http://a")[0]; got != seededAdminEmails[0] {
		t.Errorf("branch tries %s first", got)
	}
}
