package sandboxed

import (
	"path/filepath"
	"testing"
)

// SysProcAttr must drop the child into the per-conversation UID (setuid
// Credential + empty supplementary groups) and keep Setpgid so the manager can
// signal the whole process group on shutdown.
func TestSysProcAttr_SetuidAndProcessGroup(t *testing.T) {
	const uid = uint32(2345)
	attr := Runner{}.SysProcAttr(uid)
	if attr.Credential == nil {
		t.Fatalf("Credential = nil, want a setuid credential")
	}
	if attr.Credential.Uid != uid || attr.Credential.Gid != uid {
		t.Errorf("Credential Uid/Gid = %d/%d, want %d/%d", attr.Credential.Uid, attr.Credential.Gid, uid, uid)
	}
	if attr.Credential.Groups == nil || len(attr.Credential.Groups) != 0 {
		t.Errorf("Credential.Groups = %v, want empty non-nil slice to force setgroups([])", attr.Credential.Groups)
	}
	if !attr.Setpgid {
		t.Errorf("Setpgid = false, want true")
	}
}

// Chown runs the real syscall (unlike the local runner's no-op): pointed at a
// path that does not exist it must surface the ENOENT rather than swallow it.
func TestChown_RunsSyscall(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "definitely-absent")
	if err := (Runner{}).Chown(missing, 2345); err == nil {
		t.Errorf("Chown on a missing path = nil, want an error (the syscall must run)")
	}
}
