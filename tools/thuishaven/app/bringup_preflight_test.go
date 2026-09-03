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

// The sandbox prep's own ordering. `up` and `haven play` share one child plan,
// and neither builds anything before it: the three Node lanes run their own
// `dev` script through tsx/vite, so there is no production bundle to produce
// and no MODULE_NOT_FOUND to prevent. What is still load-bearing is that a
// failed migration stops the prep — a sandbox seeded onto a half-migrated
// schema reports itself ready and answers wrongly.

func TestPreparePlaySandboxStopsWhenTheMigrationsFail(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), []byte("lockfileVersion: '9.0'\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", ".modules.yaml"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Only the migration fails, so a passing prep would have been free to continue.
	sup := &fakeSupervisor{err: errors.New("migrate exploded"), errOn: "prisma:migrate"}
	o := &Orchestrator{sup: sup, log: zap.NewNop()}

	err := o.preparePlaySandbox(context.Background(), PlaySandbox{Checkout: root}, domain.Stack{})
	if err == nil {
		t.Fatal("expected failed migrations to stop the sandbox prep")
	}
	for _, sh := range sup.shells {
		if strings.Contains(sh, "prisma:seed") {
			t.Errorf("expected prep to stop before the seed, ran %v", sup.shells)
		}
		if strings.Contains(sh, "run build") {
			t.Errorf("nothing is built before a lane starts any more, ran %v", sup.shells)
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
