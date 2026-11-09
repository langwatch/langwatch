package render_test

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/render"
)

// dynamicOnlyInput renders a dynamic-only server with a token user and its
// bootstrap tmpfs under a temporary directory.
func dynamicOnlyInput(t *testing.T) *config.Input {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "access.yaml")
	body := "mode: dynamic-only\nissuers: [{name: cluster, url: 'https://oidc.example.com'}]\nusers:\n" +
		"  - {name: app, tier: write, databases: [langwatch], login: {token: {issuer: cluster, subject: 'system:serviceaccount:langwatch:app'}}}\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	input := testInput()
	input.Password = ""
	input.DynamicOnly = true
	input.AccessFile = path
	input.AccessListen = "127.0.0.1:8124"
	input.AccessBootstrapDir = filepath.Join(root, "run")
	return input
}

// passwordUsers lists "<file>: user <name> ..." for every rendered users.d file.
func passwordUsers(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(dir, "users.d"))
	if err != nil {
		t.Fatal(err)
	}
	var found []string
	for _, e := range entries {
		f, err := access.StaticCredentials(filepath.Join(dir, "users.d", e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range f {
			found = append(found, strings.TrimPrefix(line, filepath.Join(dir, "users.d")+"/"))
		}
	}
	sort.Strings(found)
	return found
}

// @scenario "Dynamic-only mode renders no password a client could hold"
func TestRenderAll_DynamicOnly(t *testing.T) {
	dir := t.TempDir()
	input := dynamicOnlyInput(t)
	renderInto(t, input, dir)

	t.Run("only default and the local admin carry a password, and only a hash", func(t *testing.T) {
		want := []string{
			"access-bootstrap.yaml: user local_admin logs in with password_sha256_hex",
			"default-password.yaml: user default logs in with password_sha256_hex",
		}
		if got := passwordUsers(t, dir); !reflect.DeepEqual(got, want) {
			t.Errorf("password users = %v, want %v", got, want)
		}
		app := section(t, section(t, readYAML(t, dir, "users.d/access-users.yaml"), "users"), "app")
		if _, ok := app["http_authentication"]; !ok {
			t.Errorf("token user rendered without http_authentication: %v", app)
		}
	})

	t.Run("default is locked: no network, a hash of nothing anyone holds", func(t *testing.T) {
		def := section(t, section(t, readYAML(t, dir, "users.d/default-password.yaml"), "users"), "default")
		if !reflect.DeepEqual(def["networks"], map[string]any{"@replace": "replace"}) {
			t.Errorf("default networks = %v, want an empty list replacing the image's ::/0", def["networks"])
		}
		for _, guess := range []string{"", "default", "clickhouse", "langwatch"} {
			sum := sha256.Sum256([]byte(guess))
			if def["password_sha256_hex"] == hex.EncodeToString(sum[:]) {
				t.Errorf("default's password is %q", guess)
			}
		}
		first := def["password_sha256_hex"]
		renderInto(t, input, dir)
		again := section(t, section(t, readYAML(t, dir, "users.d/default-password.yaml"), "users"), "default")
		if again["password_sha256_hex"] == first {
			t.Error("default's discarded hash repeats across starts")
		}
	})

	t.Run("passwordless, plaintext and new SQL passwords are refused server-wide", func(t *testing.T) {
		server := readYAML(t, dir, "config.d/access-dynamic-only.yaml")
		assertValue(t, "server", server, "allow_no_password", 0)
		assertValue(t, "server", server, "allow_plaintext_password", 0)
		rule := section(t, section(t, server, "password_complexity"), "rule")
		if !strings.Contains(rule["message"].(string), "dynamic-only") {
			t.Errorf("password rule message = %v", rule["message"])
		}
	})
}

// @scenario "Every server start gives the local admin a new password that never leaves the pod"
func TestRenderAll_LocalAdminLifecycle(t *testing.T) {
	dir := t.TempDir()
	input := dynamicOnlyInput(t)
	hashOf := func() string {
		admin := section(t, section(t, readYAML(t, dir, "users.d/access-bootstrap.yaml"), "users"), bootstrap.User)
		return admin["password_sha256_hex"].(string)
	}

	renderInto(t, input, dir)
	first, err := bootstrap.Read(input.AccessBootstrapDir)
	if err != nil {
		t.Fatalf("no local admin password: %v", err)
	}
	sum := sha256.Sum256([]byte(first.Password))
	if hashOf() != hex.EncodeToString(sum[:]) {
		t.Fatal("users.d does not match the password in the tmpfs")
	}
	for _, rel := range []string{"users.d", "config.d"} {
		_ = filepath.WalkDir(filepath.Join(dir, rel), func(path string, d os.DirEntry, _ error) error {
			if data, _ := os.ReadFile(path); !d.IsDir() && strings.Contains(string(data), first.Password) {
				t.Errorf("%s holds the plaintext password", path)
			}
			return nil
		})
	}

	renderInto(t, input, dir)
	second, _ := bootstrap.Read(input.AccessBootstrapDir)
	if second.Password == first.Password {
		t.Error("a restart kept the local admin password")
	}
	sum = sha256.Sum256([]byte(first.Password))
	if hashOf() == hex.EncodeToString(sum[:]) {
		t.Error("the old password still matches users.d after a restart")
	}

	t.Run("leaving dynamic-only removes the local admin and its password", func(t *testing.T) {
		std := testInput()
		std.AccessBootstrapDir = input.AccessBootstrapDir
		renderInto(t, std, dir)
		assertExists(t, filepath.Join(dir, "users.d", bootstrap.UsersFileName), false)
		assertExists(t, filepath.Join(dir, "config.d", "access-dynamic-only.yaml"), false)
		assertExists(t, filepath.Join(input.AccessBootstrapDir, bootstrap.PasswordFile), false)
	})
}

// @scenario "Dynamic-only mode refuses a users.d file with a long-lived password"
func TestRenderAll_DynamicOnlyRefusesOperatorPasswords(t *testing.T) {
	for _, tc := range []struct {
		name, file, content, want string
	}{
		{"a rendered LangWatchQL user", "users.d/lwql-access.yaml",
			"users:\n  langwatch_lwql: {password_sha256_hex: abc, profile: default}\n",
			"lwql-access.yaml: user langwatch_lwql logs in with password_sha256_hex"},
		{"a password for default", "users.d/ops.xml",
			"<clickhouse><users><default><password>pw</password></default></users></clickhouse>",
			"ops.xml: user default logs in with password"},
		{"a passwordless user in users.xml", "users.xml",
			"<clickhouse><users><default><password/></default><ops><no_password/></ops></users></clickhouse>",
			"users.xml: user ops logs in with no_password"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, tc.file)
			_ = os.MkdirAll(filepath.Dir(path), 0o755)
			if err := os.WriteFile(path, []byte(tc.content), 0o600); err != nil {
				t.Fatal(err)
			}
			input := dynamicOnlyInput(t)
			computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)
			err := render.RenderAll(testLogger(), input, computed, dir)
			if err == nil || !strings.Contains(err.Error(), "dynamic-only mode") || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("RenderAll = %v, want %q", err, tc.want)
			}
		})
	}

	t.Run("token and LDAP users in operator files are fine", func(t *testing.T) {
		dir := t.TempDir()
		_ = os.MkdirAll(filepath.Join(dir, "users.d"), 0o755)
		_ = os.WriteFile(filepath.Join(dir, "users.d", "corp.yaml"),
			[]byte("users:\n  analyst: {ldap: {server: corp}}\n  grafana: {profile: tier_read}\n"), 0o600)
		renderInto(t, dynamicOnlyInput(t), dir)
	})

	t.Run("the same files start a standard server", func(t *testing.T) {
		dir := t.TempDir()
		_ = os.MkdirAll(filepath.Join(dir, "users.d"), 0o755)
		_ = os.WriteFile(filepath.Join(dir, "users.d", "lwql-access.yaml"), []byte("users:\n  langwatch_lwql: {password_sha256_hex: abc}\n"), 0o600)
		renderInto(t, testInput(), dir)
	})
}

func TestRenderAll_DynamicOnlyModeMustMatchTheFile(t *testing.T) {
	input := dynamicOnlyInput(t)
	input.DynamicOnly = false
	input.Password = "testpass"
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)
	if err := render.RenderAll(testLogger(), input, computed, t.TempDir()); err == nil || !strings.Contains(err.Error(), "mode changed") {
		t.Errorf("RenderAll = %v, want a mode mismatch", err)
	}
}
