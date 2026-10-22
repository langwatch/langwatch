package access

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)

func sha(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func writeFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func mustParse(t *testing.T, raw string) *File {
	t.Helper()
	f, err := Parse([]byte(raw))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return f
}

func plannedUser(t *testing.T, p Planned, name string) map[string]any {
	t.Helper()
	u, ok := p.Users[name].(map[string]any)
	if !ok {
		t.Fatalf("user %s not planned: %#v", name, p.Users)
	}
	return u
}

func methods(t *testing.T, user map[string]any) []string {
	t.Helper()
	m, ok := user["auth_methods"].(map[string]any)
	if !ok {
		t.Fatalf("no auth_methods: %#v", user)
	}
	var hashes []string
	for i := 1; i <= len(m); i++ {
		method := m["password_"+string(rune('0'+i))].(map[string]any)
		hashes = append(hashes, method["password_sha256_hex"].(string))
	}
	return hashes
}

// @scenario "A user gets its tier's grants on its own databases only"
func TestPlan_TierGrantsOnListedDatabases(t *testing.T) {
	f := mustParse(t, `
issuers: [{name: staff, url: 'https://idp.example'}]
users:
  - {name: grafana, tier: read, databases: [analytics], networks: [10.0.0.0/8], login: {token: {issuer: staff}}}
  - {name: loader, tier: write, databases: [analytics, staging], login: {token: {issuer: staff}}}
  - {name: auditor, tier: inspect, login: {token: {issuer: staff}}}
`)
	p := Plan(f, Inputs{}, now)

	grafana := plannedUser(t, p, "grafana")
	wantRead := []string{"GRANT tier_read", "GRANT SELECT ON `analytics`.*"}
	if got := grafana["grants"].(map[string]any)["query"]; !reflect.DeepEqual(got, wantRead) {
		t.Errorf("read grants = %v, want %v", got, wantRead)
	}
	if grafana["profile"] != "tier_read" {
		t.Errorf("read profile = %v", grafana["profile"])
	}
	if got := grafana["networks"].(map[string]any)["ip"]; !reflect.DeepEqual(got, []string{"10.0.0.0/8"}) {
		t.Errorf("networks = %v", got)
	}

	loader := plannedUser(t, p, "loader")
	wantWrite := []string{
		"GRANT tier_write",
		"GRANT SELECT, INSERT, ALTER UPDATE, ALTER DELETE ON `analytics`.*",
		"GRANT SELECT, INSERT, ALTER UPDATE, ALTER DELETE ON `staging`.*",
	}
	if got := loader["grants"].(map[string]any)["query"]; !reflect.DeepEqual(got, wantWrite) {
		t.Errorf("write grants = %v, want %v", got, wantWrite)
	}
	for _, g := range wantWrite {
		if strings.Contains(g, "CREATE") || strings.Contains(g, "DROP") || strings.Contains(g, "ALL") {
			t.Errorf("write tier grants DDL: %s", g)
		}
	}

	auditor := plannedUser(t, p, "auditor")
	if got := auditor["grants"].(map[string]any)["query"]; !reflect.DeepEqual(got, []string{"GRANT tier_inspect"}) {
		t.Errorf("inspect grants = %v", got)
	}
	if auditor["http_authentication"].(map[string]any)["server"] != AuthServerName {
		t.Errorf("token user is not pointed at the sidecar: %#v", auditor)
	}
}

func rollingFile(dir string) *File {
	return &File{Users: []User{{Name: "metabase", Tier: TierRead, Databases: []string{"analytics"}, Networks: []string{"::/0"},
		Login: Login{Rolling: &RollingLogin{Dir: dir}}}}}
}

// @scenario "Two passwords in a rolling directory are valid at once"
func TestPlan_TwoRollingPasswords(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "metabase")
	writeFiles(t, dir, map[string]string{"2026-10": "october-password-0123\n", "2026-11": "november-password-0123"})
	f := rollingFile(dir)
	in, err := Gather(f)
	if err != nil {
		t.Fatal(err)
	}
	got := methods(t, plannedUser(t, Plan(f, in, now), "metabase"))
	want := []string{sha("october-password-0123"), sha("november-password-0123")}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("methods = %v, want %v", got, want)
	}
}

// @scenario "A password past its valid_until stops working at the next sync"
func TestPlan_ExpiredPasswordIsRemoved(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "metabase")
	writeFiles(t, dir, map[string]string{
		"old": "old-password-0123456", "old.valid_until": now.Add(time.Minute).Format(time.RFC3339),
		"new": "new-password-0123456",
	})
	f := rollingFile(dir)
	in, err := Gather(f)
	if err != nil {
		t.Fatal(err)
	}

	before := Plan(f, in, now)
	if got := methods(t, plannedUser(t, before, "metabase")); len(got) != 2 {
		t.Fatalf("before expiry: %d methods, want 2", len(got))
	}
	if before.NextChange == nil || !before.NextChange.Equal(now.Add(time.Minute)) {
		t.Errorf("NextChange = %v, want the valid_until", before.NextChange)
	}
	if d := nextDelay(before, now); d != SyncInterval {
		t.Errorf("delay a minute out = %v, want the sync interval", d)
	}
	if d := nextDelay(before, now.Add(time.Minute-time.Second)); d != time.Second {
		t.Errorf("delay a second before expiry = %v, want 1s", d)
	}

	after := Plan(f, in, now.Add(time.Minute))
	if got := methods(t, plannedUser(t, after, "metabase")); !reflect.DeepEqual(got, []string{sha("new-password-0123456")}) {
		t.Errorf("after expiry methods = %v, want only the new password", got)
	}
	if after.NextChange != nil {
		t.Errorf("nothing left to expire, NextChange = %v", after.NextChange)
	}
}

// @scenario "A rolling user whose passwords have all expired cannot log in"
func TestPlan_AllPasswordsExpired(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "metabase")
	writeFiles(t, dir, map[string]string{"old": "old-password-0123456", "old.valid_until": now.Add(-time.Second).Format(time.RFC3339)})
	f := rollingFile(dir)
	in, err := Gather(f)
	if err != nil {
		t.Fatal(err)
	}
	p := Plan(f, in, now)
	if _, ok := p.Users["metabase"]; ok {
		t.Error("a user with no valid password must be left out")
	}
	if len(p.Warnings) != 1 || !strings.Contains(p.Warnings[0], `"metabase" has no valid password`) {
		t.Errorf("warnings = %v", p.Warnings)
	}
}

func TestPlan_IsDeterministic(t *testing.T) {
	f := mustParse(t, validFile)
	in := Inputs{Passwords: map[string][]Password{
		"metabase": {{File: "a", SHA256Hex: sha("a")}, {File: "b", SHA256Hex: sha("b")}},
		"auditor":  {{File: "a", SHA256Hex: sha("a")}, {File: "copy", SHA256Hex: sha("a")}},
	}}
	first, err := Plan(f, in, now).UsersYAML()
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		again, _ := Plan(f, in, now).UsersYAML()
		if string(again) != string(first) {
			t.Fatal("the same inputs planned two different documents")
		}
	}
	if got := methods(t, plannedUser(t, Plan(f, in, now), "auditor")); len(got) != 1 {
		t.Errorf("a password present twice renders %d methods, want 1", len(got))
	}
}

func TestReadPasswordDir(t *testing.T) {
	t.Run("given a Kubernetes Secret volume", func(t *testing.T) {
		dir := t.TempDir()
		data := filepath.Join(dir, "..2026_10_23")
		writeFiles(t, data, map[string]string{"current": "a-long-enough-password"})
		if err := os.Symlink("..2026_10_23", filepath.Join(dir, "..data")); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink("..data/current", filepath.Join(dir, "current")); err != nil {
			t.Fatal(err)
		}
		got, err := ReadPasswordDir(dir)
		if err != nil || len(got) != 1 || got[0].File != "current" || got[0].SHA256Hex != sha("a-long-enough-password") {
			t.Errorf("ReadPasswordDir = %+v, %v", got, err)
		}
	})

	refused := map[string]map[string]string{
		"a short password":             {"p": "short"},
		"an orphan valid_until":        {"p": "a-long-enough-password", "q.valid_until": "2026-11-01T00:00:00Z"},
		"an unparseable valid_until":   {"p": "a-long-enough-password", "p.valid_until": "next tuesday"},
		"more files than any rotation": {"1": strings.Repeat("a", 16), "2": strings.Repeat("b", 16), "3": strings.Repeat("c", 16), "4": strings.Repeat("d", 16), "5": strings.Repeat("e", 16), "6": strings.Repeat("f", 16), "7": strings.Repeat("g", 16), "8": strings.Repeat("h", 16), "9": strings.Repeat("i", 16)},
	}
	for name, files := range refused {
		t.Run("given "+name, func(t *testing.T) {
			dir := t.TempDir()
			writeFiles(t, dir, files)
			if _, err := ReadPasswordDir(dir); err == nil {
				t.Error("accepted")
			}
		})
	}

	t.Run("given a missing directory", func(t *testing.T) {
		if _, err := Gather(rollingFile(filepath.Join(t.TempDir(), "absent"))); err == nil || !strings.Contains(err.Error(), `user "metabase"`) {
			t.Errorf("Gather = %v, want an error naming the user", err)
		}
	})
}

func TestAuthServerYAML(t *testing.T) {
	data, err := AuthServerYAML("127.0.0.1:8124")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"http_authentication_servers:", "access:", "uri: http://127.0.0.1:8124/verify", "receive_timeout_ms: 5000"} {
		if !strings.Contains(string(data), want) {
			t.Errorf("auth server config lacks %q:\n%s", want, data)
		}
	}
}
