package localunsafe

import (
	"path/filepath"
	"testing"
)

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

// New is a fail-closed guard, independent of the config layer: it constructs only
// for a local-like environment and refuses everything else.
func TestNew_RefusesNonLocalEnvironments(t *testing.T) {
	for _, env := range []string{"local", "dev", "development", "test", "TEST", " Local "} {
		if _, err := New(env); err != nil {
			t.Errorf("New(%q) = %v, want ok (local-like)", env, err)
		}
	}
	for _, env := range []string{"production", "prod", "staging", "prod-eu", "", "unknown"} {
		if _, err := New(env); err == nil {
			t.Errorf("New(%q) = nil error, want refusal (not local-like)", env)
		}
	}
}
