package render_test

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/render"
)

func roleGrants(t *testing.T, tiers map[string]any, role string) []any {
	t.Helper()
	grants := section(t, section(t, section(t, tiers, "roles"), role), "grants")
	queries, ok := grants["query"].([]any)
	if !ok {
		t.Fatalf("%s grants: %#v", role, grants)
	}
	return queries
}

// @scenario "A server without access renders no tiers"
func TestRenderAll_NoTiersByDefault(t *testing.T) {
	dir := t.TempDir()
	renderInto(t, testInput(), dir)
	for _, rel := range []string{"users.d/access-tiers.yaml", "users.d/access-users.yaml", "config.d/access-auth.yaml"} {
		assertExists(t, filepath.Join(dir, rel), false)
	}
}

// @scenario "Tiers are rendered with an access file or CLICKHOUSE_ACCESS_TIERS"
func TestRenderAll_Tiers(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.AccessTiers = true
	renderInto(t, input, dir)
	memoryCap := config.ComputeFromResources(input.CPU, input.RAMBytes, input).MaxMemoryUsagePerQuery

	tiers := readYAML(t, dir, "users.d/access-tiers.yaml")
	profiles := section(t, tiers, "profiles")

	t.Run("each tier is a role and a profile inheriting default", func(t *testing.T) {
		for _, name := range []string{"tier_inspect", "tier_read", "tier_write", "tier_admin"} {
			assertValue(t, name, section(t, profiles, name), "profile", "default")
			roleGrants(t, tiers, name)
		}
	})

	t.Run("inspect and read see names, never rows", func(t *testing.T) {
		want := []any{"GRANT SHOW ON *.*", "GRANT SELECT ON information_schema.*", "GRANT SELECT ON INFORMATION_SCHEMA.*"}
		for _, name := range []string{"tier_inspect", "tier_read", "tier_write"} {
			if got := roleGrants(t, tiers, name); !reflect.DeepEqual(got, want) {
				t.Errorf("%s grants = %v, want %v", name, got, want)
			}
		}
		if got := roleGrants(t, tiers, "tier_admin"); !reflect.DeepEqual(got, []any{"GRANT ALL ON *.* WITH GRANT OPTION"}) {
			t.Errorf("tier_admin grants = %v", got)
		}
	})

	t.Run("read tiers are readonly=2 and cannot raise their caps", func(t *testing.T) {
		for _, name := range []string{"tier_inspect", "tier_read"} {
			profile := section(t, profiles, name)
			assertValue(t, name, profile, "readonly", 2)
			assertValue(t, name, profile, "max_execution_time", 300)
			constraints := section(t, profile, "constraints")
			assertValue(t, name, section(t, constraints, "max_execution_time"), "max", 300)
			assertValue(t, name, section(t, constraints, "max_memory_usage"), "max", int(memoryCap))
		}
	})

	t.Run("write may change data but not raise its memory cap", func(t *testing.T) {
		profile := section(t, profiles, "tier_write")
		if _, ok := profile["readonly"]; ok {
			t.Error("tier_write must not be readonly")
		}
		assertValue(t, "tier_write", section(t, section(t, profile, "constraints"), "max_memory_usage"), "max", int(memoryCap))
	})

	t.Run("without an access file no access users or token server are rendered", func(t *testing.T) {
		assertExists(t, filepath.Join(dir, "users.d", "access-users.yaml"), false)
		assertExists(t, filepath.Join(dir, "config.d", "access-auth.yaml"), false)
	})
}

func TestRenderAll_TierExecutionTimeFollowsEnv(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.AccessTiers = true
	input.ReadTierMaxExecutionTime = 60
	renderInto(t, input, dir)
	profile := section(t, section(t, readYAML(t, dir, "users.d/access-tiers.yaml"), "profiles"), "tier_read")
	assertValue(t, "tier_read", profile, "max_execution_time", 60)
}

func writeAccessFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	secrets := filepath.Join(root, "metabase")
	if err := os.MkdirAll(secrets, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(secrets, "current"), []byte("current-password-0123"), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "access.yaml")
	body := "issuers: [{name: staff, url: 'https://idp.example'}]\nusers:\n" +
		"  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: " + secrets + "}}}\n" +
		"  - {name: alice, tier: inspect, login: {token: {issuer: staff}}}\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// @scenario "Turning the access file off removes what it rendered"
func TestRenderAll_AccessFileOnThenOff(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.AccessFile = writeAccessFixture(t)
	input.AccessListen = "127.0.0.1:8124"
	renderInto(t, input, dir)

	assertExists(t, filepath.Join(dir, "users.d", "access-tiers.yaml"), true)
	users := section(t, readYAML(t, dir, "users.d/access-users.yaml"), "users")
	for _, name := range []string{"metabase", "alice"} {
		section(t, users, name)
	}
	server := section(t, section(t, readYAML(t, dir, "config.d/access-auth.yaml"), "http_authentication_servers"), "access")
	assertValue(t, "auth server", server, "uri", "http://127.0.0.1:8124/verify")

	input.AccessFile = ""
	renderInto(t, input, dir)
	assertExists(t, filepath.Join(dir, "users.d", "access-users.yaml"), false)
	assertExists(t, filepath.Join(dir, "config.d", "access-auth.yaml"), false)
	assertExists(t, filepath.Join(dir, "users.d", "access-tiers.yaml"), false)
}

func TestRenderAll_InvalidAccessFileFails(t *testing.T) {
	input := testInput()
	input.AccessFile = writeAccessFixture(t)
	input.AccessListen = "127.0.0.1:8124"
	if err := os.RemoveAll(filepath.Join(filepath.Dir(input.AccessFile), "metabase")); err != nil {
		t.Fatal(err)
	}
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)
	err := render.RenderAll(testLogger(), input, computed, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), `user "metabase"`) {
		t.Errorf("RenderAll = %v, want it to refuse the missing password directory", err)
	}
}
