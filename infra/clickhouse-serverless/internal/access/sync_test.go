package access

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

type syncFixture struct {
	t          *testing.T
	syncer     *Syncer
	accessFile string
	secrets    string
	usersFile  string
	logs       *observer.ObservedLogs
	loads      int
}

func newSyncFixture(t *testing.T) *syncFixture {
	root := t.TempDir()
	core, logs := observer.New(zap.InfoLevel)
	fx := &syncFixture{
		t:          t,
		accessFile: filepath.Join(root, "access.yaml"),
		secrets:    filepath.Join(root, "secrets", "metabase"),
		usersFile:  filepath.Join(root, "users.d", UsersFileName),
		logs:       logs,
	}
	writeFiles(t, filepath.Join(root, "users.d"), nil)
	fx.syncer = &Syncer{
		AccessFile: fx.accessFile,
		UsersD:     filepath.Join(root, "users.d"),
		Log:        zap.New(core),
		Now:        func() time.Time { return now },
		OnLoad:     func(*File) { fx.loads++ },
	}
	fx.writeAccess("users:\n  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: " + fx.secrets + "}}}\n")
	writeFiles(t, fx.secrets, map[string]string{"current": "current-password-0123"})
	return fx
}

func (fx *syncFixture) writeAccess(content string) {
	writeFiles(fx.t, filepath.Dir(fx.accessFile), map[string]string{"access.yaml": content})
}

func (fx *syncFixture) rendered() string {
	data, err := os.ReadFile(fx.usersFile)
	if err != nil {
		fx.t.Fatalf("read rendered users: %v", err)
	}
	return string(data)
}

// @scenario "The sidecar keeps the last good file when an input cannot be read"
func TestSyncer_KeepsTheLastGoodFile(t *testing.T) {
	fx := newSyncFixture(t)
	fx.syncer.Sync()
	good := fx.rendered()
	if !strings.Contains(good, sha("current-password-0123")) {
		t.Fatalf("first sync did not render the password:\n%s", good)
	}

	t.Run("when a password directory disappears", func(t *testing.T) {
		if err := os.RemoveAll(fx.secrets); err != nil {
			t.Fatal(err)
		}
		fx.syncer.Sync()
		if fx.rendered() != good {
			t.Error("the rendered users changed although an input could not be read")
		}
		if fx.logs.FilterMessage("password files not applied, keeping the last rendered users").Len() == 0 {
			t.Error("the failure was not logged")
		}
	})

	t.Run("when the access file becomes invalid", func(t *testing.T) {
		fx.writeAccess("users:\n  - {name: metabase, tier: owner}\n")
		loads := fx.loads
		fx.syncer.Sync()
		if fx.rendered() != good {
			t.Error("the rendered users changed although the access file is invalid")
		}
		if fx.loads != loads {
			t.Error("an invalid access file reached the token verifier")
		}
		if fx.logs.FilterMessage("access file not applied, keeping the last rendered users").Len() == 0 {
			t.Error("the failure was not logged")
		}
	})

	t.Run("when the inputs are readable again", func(t *testing.T) {
		fx.writeAccess("users:\n  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: " + fx.secrets + "}}}\n")
		writeFiles(t, fx.secrets, map[string]string{"next": "next-password-0123456"})
		fx.syncer.Sync()
		if got := fx.rendered(); !strings.Contains(got, sha("next-password-0123456")) || strings.Contains(got, sha("current-password-0123")) {
			t.Errorf("the next sync did not apply the new password set:\n%s", got)
		}
	})
}

func TestSyncer_WritesOnlyOnChange(t *testing.T) {
	fx := newSyncFixture(t)
	fx.syncer.Sync()
	info, err := os.Stat(fx.usersFile)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("rendered users mode = %v, want 0600", info.Mode().Perm())
	}
	time.Sleep(10 * time.Millisecond)
	fx.syncer.Sync()
	again, _ := os.Stat(fx.usersFile)
	if !again.ModTime().Equal(info.ModTime()) {
		t.Error("an unchanged plan rewrote the file, which makes ClickHouse reload users for nothing")
	}
	if fx.loads != 1 {
		t.Errorf("an unchanged access file was handed to the verifier %d times, want once", fx.loads)
	}
	if n := fx.logs.FilterMessage("access users updated").Len(); n != 1 {
		t.Errorf("logged %d updates, want 1", n)
	}
	entries, _ := os.ReadDir(filepath.Dir(fx.usersFile))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("temporary file left behind: %s", e.Name())
		}
	}
}
