package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The api lane runs the production bundle, so `up` has to guarantee the bundle
// exists before the lane starts. These pin both directions: build the missing
// one, leave the present one alone.

// buildingSupervisor is a fakeSupervisor whose build actually writes the bundle,
// the way pnpm does. ensureAPIBundle checks for the file after the build, so a
// fake that reports success and emits nothing is — correctly — a failed build,
// and every test that wants a SUCCESSFUL build has to emit one.
type buildingSupervisor struct {
	*fakeSupervisor
	bundle string
}

func (b *buildingSupervisor) RunOnce(ctx context.Context, name, dir, shell string, env []string) error {
	if err := b.fakeSupervisor.RunOnce(ctx, name, dir, shell, env); err != nil {
		return err
	}
	if !strings.Contains(shell, "run build") {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(b.bundle), 0o755); err != nil {
		return err
	}
	return os.WriteFile(b.bundle, []byte("// built\n"), 0o644)
}

func TestEnsureAPIBundleBuildsWhenTheBundleIsMissing(t *testing.T) {
	lwDir := t.TempDir()
	inner := &fakeSupervisor{}
	sup := &buildingSupervisor{fakeSupervisor: inner, bundle: filepath.Join(lwDir, apiBundleRelPath)}
	o := &Orchestrator{sup: sup}

	if err := o.ensureAPIBundle(context.Background(), lwDir, nil); err != nil {
		t.Fatalf("expected the build to be attempted, got error: %v", err)
	}

	if len(inner.shells) != 1 {
		t.Fatalf("expected exactly one command, got %v", inner.shells)
	}
	if !strings.Contains(inner.shells[0], "run build") {
		t.Errorf("expected the app build, got %q", inner.shells[0])
	}
	if inner.dirs[0] != lwDir {
		t.Errorf("expected the build to run in %q, got %q", lwDir, inner.dirs[0])
	}
}

// A build that exits 0 without emitting the bundle is the failure mode an exit
// code cannot see: the lane would start on a file that is not there and
// crash-loop with no explanation. Returning nil here is the bug.
func TestEnsureAPIBundleFailsWhenTheBuildEmitsNoBundle(t *testing.T) {
	lwDir := t.TempDir()
	sup := &fakeSupervisor{} // reports success, writes nothing
	o := &Orchestrator{sup: sup}

	err := o.ensureAPIBundle(context.Background(), lwDir, nil)
	if err == nil {
		t.Fatal("expected a build that produced no bundle to stop the up")
	}
	if !strings.Contains(err.Error(), apiBundleRelPath) {
		t.Errorf("expected the error to name the bundle it wanted, got %q", err)
	}
}

// `node <a directory>` fails exactly like a missing file, so a directory parked
// at the bundle path must not count as "the bundle is already there".
func TestEnsureAPIBundleRejectsADirectoryAtTheBundlePath(t *testing.T) {
	lwDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(lwDir, apiBundleRelPath), 0o755); err != nil {
		t.Fatal(err)
	}
	sup := &fakeSupervisor{}
	o := &Orchestrator{sup: sup}

	if err := o.ensureAPIBundle(context.Background(), lwDir, nil); err == nil {
		t.Fatal("expected a directory at the bundle path to stop the up")
	}
}

func TestEnsureAPIBundleSkipsTheBuildWhenTheBundleIsPresent(t *testing.T) {
	lwDir := t.TempDir()
	bundle := filepath.Join(lwDir, apiBundleRelPath)
	if err := os.MkdirAll(filepath.Dir(bundle), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bundle, []byte("// built"), 0o644); err != nil {
		t.Fatal(err)
	}
	sup := &fakeSupervisor{}
	o := &Orchestrator{sup: sup}

	if err := o.ensureAPIBundle(context.Background(), lwDir, nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sup.shells) != 0 {
		t.Errorf("expected no rebuild for an existing bundle, ran %v", sup.shells)
	}
}

// A failed build must STOP the up. Continuing would start the api lane on a
// bundle that is not there, which crash-loops behind the app lane's ready
// probe and serves nothing — the silent failure this whole check exists for.
func TestEnsureAPIBundleFailsTheUpWhenTheBuildFails(t *testing.T) {
	lwDir := t.TempDir()
	sup := &fakeSupervisor{err: errors.New("vite exploded")}
	o := &Orchestrator{sup: sup}

	err := o.ensureAPIBundle(context.Background(), lwDir, nil)
	if err == nil {
		t.Fatal("expected a failed build to stop the up")
	}
	if !strings.Contains(err.Error(), apiBundleRelPath) {
		t.Errorf("expected the error to name the missing bundle, got %q", err)
	}
}

// A play sandbox supervises the same child plan as `up`, so it needs the same
// guarantee. This pins the wiring: remove the call and the sandbox goes back to
// serving nothing.
func TestPreparePlaySandboxBuildsTheAPIBundle(t *testing.T) {
	root := t.TempDir()
	lwDir := filepath.Join(root, "platform", "app")
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(lwDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// A lockfile older than the install stamp keeps ensureDeps a no-op, so the
	// test exercises the prep sequence and not pnpm.
	if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), []byte("lockfileVersion: '9.0'\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", ".modules.yaml"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	inner := &fakeSupervisor{}
	sup := &buildingSupervisor{fakeSupervisor: inner, bundle: filepath.Join(lwDir, apiBundleRelPath)}
	o := &Orchestrator{sup: sup, log: zap.NewNop()}

	if err := o.preparePlaySandbox(context.Background(), PlaySandbox{Checkout: root, LwDir: lwDir}, domain.Stack{}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	builds := 0
	for _, sh := range inner.shells {
		if strings.Contains(sh, "run build") {
			builds++
		}
	}
	if builds != 1 {
		t.Fatalf("expected the sandbox prep to build the api bundle exactly once, ran %v", inner.shells)
	}
}

// The build is fatal here, unlike the codegen and seed steps it sits between —
// a sandbox with stale generated files is still worth looking at, a sandbox
// whose api never starts is not. Nothing else pins that: flip play.go's
// ensureAPIBundle call to warn-and-continue, matching the steps around it, and
// the test above still passes. This is the one that notices — and, because prep
// must stop before the migrations that follow, it pins the order too.
func TestPreparePlaySandboxStopsWhenTheAPIBundleFails(t *testing.T) {
	root := t.TempDir()
	lwDir := filepath.Join(root, "platform", "app")
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(lwDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), []byte("lockfileVersion: '9.0'\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", ".modules.yaml"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Only the build fails, so a passing prep would have been free to continue.
	sup := &fakeSupervisor{err: errors.New("vite exploded"), errOn: "run build"}
	o := &Orchestrator{sup: sup, log: zap.NewNop()}

	err := o.preparePlaySandbox(context.Background(), PlaySandbox{Checkout: root, LwDir: lwDir}, domain.Stack{})
	if err == nil {
		t.Fatal("expected a failed api bundle build to stop the sandbox prep")
	}
	for _, sh := range sup.shells {
		if strings.Contains(sh, "start:prepare:db") {
			t.Errorf("expected prep to stop before migrations, ran %v", sup.shells)
		}
	}
}

// The CA-serial preflight. A root-owned ca.srl makes openssl emit ZERO-BYTE
// host certs, which presents as #7117's already-fixed SAN gap — so the check
// has to fire before the proxy starts and say what is actually wrong.

func TestPreflightPortlessCAPassesWhenThereIsNoSerialYet(t *testing.T) {
	home := t.TempDir() // no ~/.portless at all
	if err := preflightPortlessCAIn(home); err != nil {
		t.Fatalf("expected a clean pass before portless has ever run, got %v", err)
	}
}

func TestPreflightPortlessCAPassesWhenTheSerialIsWritable(t *testing.T) {
	home := t.TempDir()
	writeSerial(t, home, 0o644)

	if err := preflightPortlessCAIn(home); err != nil {
		t.Fatalf("expected a writable serial to pass, got %v", err)
	}
}

func TestPreflightPortlessCAStopsTheUpWhenTheSerialIsNotWritable(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can write any file, so the unwritable case cannot be staged")
	}
	home := t.TempDir()
	srl := writeSerial(t, home, 0o400)
	if err := os.Chmod(srl, 0o400); err != nil {
		t.Fatal(err)
	}

	err := preflightPortlessCAIn(home)
	if err == nil {
		t.Fatal("expected an unwritable CA serial to stop the up")
	}
	// The message is the entire value of this check: it must name the file and
	// steer away from #7117, or the reader re-debugs a fixed bug.
	msg := err.Error()
	if !strings.Contains(msg, srl) {
		t.Errorf("expected the error to name the serial path, got %q", msg)
	}
	if !strings.Contains(msg, "#7117") {
		t.Errorf("expected the error to rule out the SAN bug, got %q", msg)
	}
	if !strings.Contains(msg, "-size 0 -delete") {
		t.Errorf("expected the error to give the cleanup command, got %q", msg)
	}
}

func writeSerial(t *testing.T, home string, mode os.FileMode) string {
	t.Helper()
	srl := portlessCASerialPath(home)
	if err := os.MkdirAll(filepath.Dir(srl), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(srl, []byte("00\n"), mode); err != nil {
		t.Fatal(err)
	}
	return srl
}
