package sharedidentity

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

func TestCommandContext_ExecutesBinaryDirectly(t *testing.T) {
	cmd := Runner{}.CommandContext(context.Background(), "/tmp/opencode", "serve")
	if cmd.Path != "/tmp/opencode" {
		t.Fatalf("command path = %q, want direct binary", cmd.Path)
	}
	if want := []string{"/tmp/opencode", "serve"}; !reflect.DeepEqual(cmd.Args, want) {
		t.Fatalf("command args = %#v, want %#v", cmd.Args, want)
	}
}

// SysProcAttr must omit the setuid Credential (opencode runs as the manager's own
// user) but keep Setpgid so the manager can group-signal it on shutdown.
func TestSysProcAttr_NoCredentialButProcessGroup(t *testing.T) {
	attr := Runner{}.SysProcAttr(2345)
	if attr.Credential != nil {
		t.Errorf("Credential = %+v, want nil (opencode runs as the manager's own user)", attr.Credential)
	}
	if !attr.Setpgid {
		t.Errorf("Setpgid = false, want true even with isolation disabled")
	}
}

// Chown / Lchown must skip the syscall entirely: pointed at a path that does not
// exist, a nil return proves the filesystem was never touched.
func TestChownLchown_NoOp(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "definitely-absent")
	if err := (Runner{}).Chown(missing, 2345); err != nil {
		t.Errorf("Chown = %v, want nil (must not touch the filesystem)", err)
	}
	if err := (Runner{}).Lchown(missing, 2345); err != nil {
		t.Errorf("Lchown = %v, want nil (must not touch the filesystem)", err)
	}
}

// New refused to construct outside a local-like ENVIRONMENT until ADR-130, as a
// second guard beyond the config layer. That is gone, and the test with it: the
// posture is now the operator's to select, gated by an acknowledgement in their
// values file and refused at chart render time without one. A guard here would
// only have made the supported posture reachable by lying about ENVIRONMENT,
// which telemetry and logging read too.
//
// What replaces it is asserted where it now lives: config rejects an
// unrecognised LANGY_WORKER_ISOLATION rather than defaulting (config_test.go),
// and the chart refuses `none` without the acknowledgement
// (charts/langwatch/tests/e2e-overlays.sh).

// The runner's whole contract is what it does NOT do: no setuid credential on
// the child, and no filesystem ownership change. Both are what make the pod
// runnable without root.
//
// @scenario "The manager does not reserve worker identities it cannot enforce"
func TestRunner_AppliesNoIdentity(t *testing.T) {
	attr := (Runner{}).SysProcAttr(4321)
	if attr == nil {
		t.Fatal("SysProcAttr must still return a process group for the reaper")
	}
	if attr.Credential != nil {
		t.Errorf("SysProcAttr set a Credential (%+v) — the child must inherit the manager's identity", attr.Credential)
	}
	if !attr.Setpgid {
		t.Error("Setpgid must stay on: the orphan reaper and shutdown signal the worker's process group")
	}
}
