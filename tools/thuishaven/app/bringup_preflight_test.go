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

func TestEnsureAPIBundleBuildsWhenTheBundleIsMissing(t *testing.T) {
	lwDir := t.TempDir()
	sup := &fakeSupervisor{}
	o := &Orchestrator{sup: sup}

	if err := o.ensureAPIBundle(context.Background(), lwDir, nil); err != nil {
		t.Fatalf("expected the build to be attempted, got error: %v", err)
	}

	if len(sup.shells) != 1 {
		t.Fatalf("expected exactly one command, got %v", sup.shells)
	}
	if !strings.Contains(sup.shells[0], "run build") {
		t.Errorf("expected the app build, got %q", sup.shells[0])
	}
	if sup.dirs[0] != lwDir {
		t.Errorf("expected the build to run in %q, got %q", lwDir, sup.dirs[0])
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

	sup := &fakeSupervisor{}
	o := &Orchestrator{sup: sup, log: zap.NewNop()}

	if err := o.preparePlaySandbox(context.Background(), PlaySandbox{Checkout: root, LwDir: lwDir}, domain.Stack{}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var built bool
	for _, sh := range sup.shells {
		if strings.Contains(sh, "run build") {
			built = true
		}
	}
	if !built {
		t.Fatalf("expected the sandbox prep to build the api bundle, ran %v", sup.shells)
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
