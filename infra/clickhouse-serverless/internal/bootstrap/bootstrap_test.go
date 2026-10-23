package bootstrap

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// @scenario "Every server start gives the local admin a new password that never leaves the pod"
func TestGenerate_Lifecycle(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bootstrap")

	first, err := Generate(dir)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if first.User != User || len(first.Password) != 64 {
		t.Fatalf("credential = %q with a %d-character password", first.User, len(first.Password))
	}

	t.Run("the file is readable by the server's uid and group only", func(t *testing.T) {
		info, err := os.Stat(filepath.Join(dir, PasswordFile))
		if err != nil {
			t.Fatal(err)
		}
		if mode := info.Mode().Perm(); mode != 0o440 {
			t.Errorf("mode = %o, want 440", mode)
		}
		entries, _ := os.ReadDir(dir)
		if len(entries) != 1 {
			t.Errorf("directory holds %d entries, want only the password", len(entries))
		}
	})

	t.Run("Read returns what Generate wrote", func(t *testing.T) {
		got, err := Read(dir)
		if err != nil || got != first {
			t.Errorf("Read = %+v, %v; want %+v", got, err, first)
		}
	})

	t.Run("the next start replaces it", func(t *testing.T) {
		second, err := Generate(dir)
		if err != nil {
			t.Fatal(err)
		}
		if second.Password == first.Password {
			t.Fatal("two starts generated the same password")
		}
		if got, _ := Read(dir); got != second {
			t.Errorf("Read after a restart = %+v, want the new password", got)
		}
	})

	t.Run("Remove deletes it and is idempotent", func(t *testing.T) {
		for range 2 {
			if err := Remove(dir); err != nil {
				t.Fatalf("Remove: %v", err)
			}
		}
		if _, err := Read(dir); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("Read after Remove = %v, want not exist", err)
		}
	})
}

func TestRead_RefusesWhatGenerateDidNotWrite(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, PasswordFile), []byte("short\n"), 0o440); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(dir); err == nil {
		t.Error("Read accepted a short password")
	}
}

// @scenario "The local admin logs in from inside the server's network namespace only"
func TestUsersYAML_LoopbackOnly(t *testing.T) {
	c := Credential{User: User, Password: strings.Repeat("ab", 32)}
	data, err := UsersYAML(c)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), c.Password) {
		t.Fatal("users.d holds the plaintext password")
	}
	var doc struct {
		Users map[string]map[string]any `yaml:"users"`
	}
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Users) != 1 {
		t.Fatalf("users = %v, want only %s", doc.Users, User)
	}
	u := doc.Users[User]
	sum := sha256.Sum256([]byte(c.Password))
	if u["password_sha256_hex"] != hex.EncodeToString(sum[:]) {
		t.Errorf("password_sha256_hex = %v", u["password_sha256_hex"])
	}
	networks := u["networks"].(map[string]any)
	if networks["@replace"] != "replace" {
		t.Error("networks must replace, not merge into, any other definition")
	}
	if got := networks["ip"]; !reflect.DeepEqual(got, []any{"127.0.0.1", "::1"}) {
		t.Errorf("networks = %v, want loopback only", got)
	}
	if u["access_management"] != 1 {
		t.Error("the local admin needs access_management")
	}
}

// @scenario "Every server start gives the local admin a new password that never leaves the pod"
func TestClient_ReadsTheCredentialPerQuery(t *testing.T) {
	dir := t.TempDir()
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pw, _ := r.BasicAuth()
		body, _ := io.ReadAll(r.Body)
		want, err := Read(dir)
		if err != nil || user != want.User || pw != want.Password {
			http.Error(w, "Authentication failed", http.StatusUnauthorized)
			return
		}
		seen = append(seen, pw)
		_, _ = w.Write([]byte("ok:" + string(body)))
	}))
	defer server.Close()
	c := &Client{Dir: dir, URL: server.URL}

	if _, err := c.Query(context.Background(), "SELECT 1"); err == nil {
		t.Fatal("Query without a credential succeeded")
	}
	for range 2 {
		if _, err := Generate(dir); err != nil {
			t.Fatal(err)
		}
		out, err := c.Query(context.Background(), "SELECT 1")
		if err != nil || string(out) != "ok:SELECT 1" {
			t.Fatalf("Query = %q, %v", out, err)
		}
	}
	if len(seen) != 2 || seen[0] == seen[1] {
		t.Errorf("the client did not follow the rotated password: %d logins", len(seen))
	}

	denied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "Code: 497. ACCESS_DENIED", http.StatusForbidden)
	}))
	defer denied.Close()
	c.URL = denied.URL
	if _, err := c.Query(context.Background(), "DROP TABLE x"); err == nil || !strings.Contains(err.Error(), "ACCESS_DENIED") {
		t.Errorf("Query = %v, want the server's error", err)
	}
}
