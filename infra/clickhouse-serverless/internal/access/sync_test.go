package access

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
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
		if fx.logs.FilterMessage("password directory not applied, keeping the user's last good passwords").Len() == 0 {
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
		if fx.logs.FilterMessage("access file not applied, keeping the last good one").Len() == 0 {
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

// @scenario "A password past its valid_until expires while another user's directory is malformed"
func TestSyncer_ExpiresPasswordsPastABadDirectory(t *testing.T) {
	fx := newSyncFixture(t)
	other := filepath.Join(filepath.Dir(fx.secrets), "app")
	writeFiles(t, other, map[string]string{"current": "app-password-0123456"})
	writeFiles(t, fx.secrets, map[string]string{"current.valid_until": now.Add(time.Minute).Format(time.RFC3339)})
	fx.writeAccess("users:\n" +
		"  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: " + fx.secrets + "}}}\n" +
		"  - {name: app, tier: read, databases: [analytics], login: {rolling: {dir: " + other + "}}}\n")
	fx.syncer.Sync()
	if got := fx.rendered(); !strings.Contains(got, sha("current-password-0123")) {
		t.Fatalf("first sync did not render the expiring password:\n%s", got)
	}

	writeFiles(t, other, map[string]string{"current": "short"}) // malformed
	later := now.Add(2 * time.Minute)
	fx.syncer.Now = func() time.Time { return later }
	fx.syncer.Sync()
	got := fx.rendered()
	if strings.Contains(got, sha("current-password-0123")) {
		t.Errorf("a password past its valid_until survived a malformed directory:\n%s", got)
	}
	if !strings.Contains(got, sha("app-password-0123456")) {
		t.Errorf("the malformed user lost its last good password:\n%s", got)
	}
	if fx.logs.FilterMessage("password directory not applied, keeping the user's last good passwords").Len() == 0 {
		t.Error("the failure was not logged")
	}
}

// @scenario "After a restart a malformed password directory fails closed for its user only"
func TestSyncer_FreshSyncerIsolatesABadDirectory(t *testing.T) {
	fx := newSyncFixture(t)
	other := filepath.Join(filepath.Dir(fx.secrets), "app")
	writeFiles(t, fx.secrets, map[string]string{
		"old":             "expired-password-0123",
		"old.valid_until": now.Add(-time.Minute).Format(time.RFC3339),
	})
	writeFiles(t, other, map[string]string{"current": "short"}) // malformed
	fx.writeAccess("users:\n" +
		"  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: " + fx.secrets + "}}}\n" +
		"  - {name: app, tier: read, databases: [analytics], login: {rolling: {dir: " + other + "}}}\n")
	// users.d persists across a sidecar restart: the previous process
	// rendered both users, the expired password and app's old one included.
	writeFiles(t, fx.syncer.UsersD, map[string]string{UsersFileName: "users:\n" +
		"  metabase: {auth_methods: {password_1: {password_sha256_hex: " + sha("expired-password-0123") + "}}}\n" +
		"  app: {auth_methods: {password_1: {password_sha256_hex: " + sha("app-old-password-0123") + "}}}\n"})

	fx.syncer.Sync() // a fresh Syncer: no last good passwords in this process
	got := fx.rendered()
	if strings.Contains(got, sha("expired-password-0123")) {
		t.Errorf("a password past its valid_until survived the restart:\n%s", got)
	}
	if !strings.Contains(got, sha("current-password-0123")) {
		t.Errorf("the healthy user lost its valid password:\n%s", got)
	}
	if strings.Contains(got, sha("app-old-password-0123")) || strings.Contains(got, "app:") {
		t.Errorf("the malformed user kept file passwords with nothing good to keep:\n%s", got)
	}
	logged := fx.logs.FilterMessageSnippet("rendering the user with no file passwords").All()
	if len(logged) != 1 || logged[0].ContextMap()["user"] != "app" || logged[0].ContextMap()["dir"] != other {
		t.Errorf("want one error naming the user and directory, got %+v", logged)
	}
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

// @scenario "The sidecar never switches mode while the server runs"
func TestSyncer_KeepsTheServersMode(t *testing.T) {
	const tokenOnly = "mode: dynamic-only\nissuers: [{name: s, url: 'https://oidc.example.com'}]\n" +
		"users:\n  - {name: grafana, tier: inspect, login: {token: {issuer: s}}}\n"

	t.Run("a standard server ignores a file turning dynamic-only on", func(t *testing.T) {
		fx := newSyncFixture(t)
		fx.syncer.Sync()
		good := fx.rendered()
		fx.writeAccess(tokenOnly)
		loads := fx.loads
		fx.syncer.Sync()
		if fx.rendered() != good || fx.loads != loads {
			t.Error("a mode switch was applied without a restart")
		}
		if fx.logs.FilterMessageSnippet("its mode differs from the one the server started in").Len() == 0 {
			t.Error("the refusal was not logged")
		}
	})

	t.Run("a dynamic-only server ignores a file turning it off", func(t *testing.T) {
		fx := newSyncFixture(t)
		writeFiles(t, fx.syncer.UsersD, map[string]string{bootstrap.UsersFileName: "users: {}\n"})
		fx.writeAccess(tokenOnly)
		fx.syncer.Sync()
		good := fx.rendered()
		if strings.Contains(good, "password") {
			t.Fatalf("dynamic-only rendered a password:\n%s", good)
		}
		// Back to standard mode with a rolling user: its password must not appear.
		fx.writeAccess("users:\n  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: " + fx.secrets + "}}}\n")
		fx.syncer.Sync()
		if got := fx.rendered(); got != good || strings.Contains(got, sha("current-password-0123")) {
			t.Errorf("a dynamic-only server got a rolling password without a restart:\n%s", got)
		}
	})
}

// @scenario "A token user rebound to another identity logs in only once its new rights are loaded"
func TestSyncer_LoadsTheVerifierOnlyAfterTheWrite(t *testing.T) {
	fx := newSyncFixture(t)
	fx.syncer.Sync()
	if fx.loads != 1 {
		t.Fatalf("first sync loaded the verifier %d times, want 1", fx.loads)
	}

	usersD := filepath.Dir(fx.usersFile)
	if err := os.Chmod(usersD, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(usersD, 0o755) })
	fx.writeAccess("users:\n  - {name: metabase, tier: write, databases: [analytics], login: {rolling: {dir: " + fx.secrets + "}}}\n")
	fx.syncer.Sync()
	if fx.loads != 1 {
		t.Errorf("the verifier took a file whose users were never written (%d loads)", fx.loads)
	}

	if err := os.Chmod(usersD, 0o755); err != nil {
		t.Fatal(err)
	}
	fx.syncer.Sync()
	if fx.loads != 2 {
		t.Errorf("the verifier did not take the file once it was written (%d loads)", fx.loads)
	}
}

// @scenario "A password past its valid_until expires while the access file is broken"
func TestSyncer_ExpiresPasswordsWhileTheAccessFileIsBroken(t *testing.T) {
	fx := newSyncFixture(t)
	writeFiles(t, fx.secrets, map[string]string{
		"leaving":             "leaving-password-0123",
		"leaving.valid_until": now.Add(time.Minute).Format(time.RFC3339),
	})
	fx.syncer.Sync()
	if !strings.Contains(fx.rendered(), sha("leaving-password-0123")) {
		t.Fatal("the password was not rendered before its valid_until")
	}

	fx.writeAccess("users:\n  - {name: metabase, tier: owner}\n")
	fx.syncer.Now = func() time.Time { return now.Add(2 * time.Minute) }
	fx.syncer.Sync()
	got := fx.rendered()
	if strings.Contains(got, sha("leaving-password-0123")) {
		t.Error("a password past its valid_until stayed valid while the access file was broken")
	}
	if !strings.Contains(got, sha("current-password-0123")) {
		t.Error("the user lost its other password while the access file was broken")
	}
}
