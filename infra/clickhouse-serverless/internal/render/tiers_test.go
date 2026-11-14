package render_test

import (
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
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

	t.Run("no tier can stop its queries reaching the query log", func(t *testing.T) {
		for _, name := range []string{"tier_inspect", "tier_read", "tier_write", "tier_admin"} {
			constraints := section(t, section(t, profiles, name), "constraints")
			for _, setting := range []string{"log_queries", "log_queries_min_type", "log_queries_min_query_duration_ms", "log_queries_probability"} {
				if _, ok := section(t, constraints, setting)["const"]; !ok {
					t.Errorf("%s: %s is not const", name, setting)
				}
			}
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
			// Zero is unlimited to ClickHouse, so a user setting 0 must be refused.
			assertValue(t, name, section(t, constraints, "max_execution_time"), "min", 1)
			assertValue(t, name, section(t, constraints, "max_memory_usage"), "min", 1)
		}
	})

	t.Run("write may change data but not raise its memory cap", func(t *testing.T) {
		profile := section(t, profiles, "tier_write")
		if _, ok := profile["readonly"]; ok {
			t.Error("tier_write must not be readonly")
		}
		assertValue(t, "tier_write", section(t, section(t, profile, "constraints"), "max_memory_usage"), "max", int(memoryCap))
		assertValue(t, "tier_write", section(t, section(t, profile, "constraints"), "max_memory_usage"), "min", 1)
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
	secrets := filepath.Join(root, "dashboards")
	if err := os.MkdirAll(secrets, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(secrets, "current"), []byte("current-password-0123"), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "access.yaml")
	body := "issuers: [{name: staff, url: 'https://idp.example'}]\nusers:\n" +
		"  - {name: dashboards, tier: read, databases: [analytics], login: {rolling: {dir: " + secrets + "}}}\n" +
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
	for _, name := range []string{"dashboards", "alice"} {
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
	if err := os.RemoveAll(filepath.Join(filepath.Dir(input.AccessFile), "dashboards")); err != nil {
		t.Fatal(err)
	}
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)
	err := render.RenderAll(testLogger(), input, computed, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), `user "dashboards"`) {
		t.Errorf("RenderAll = %v, want it to refuse the missing password directory", err)
	}
}

// @scenario "An install adds to or replaces the default policy in its access file"
func TestRenderAll_TierConstraintsFollowThePolicy(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.AccessFile = writeAccessFixture(t)
	input.AccessListen = "127.0.0.1:8124"
	raw, err := os.ReadFile(input.AccessFile)
	if err != nil {
		t.Fatal(err)
	}
	policy := "policy: {protected_settings: {replace: [log_queries], add: [max_threads]}}\n"
	if err := os.WriteFile(input.AccessFile, append([]byte(policy), raw...), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := access.Load(input.AccessFile)
	if err != nil {
		t.Fatal(err)
	}
	input.AccessPolicy = &f.Policy
	renderInto(t, input, dir)
	profile := section(t, section(t, readYAML(t, dir, "users.d/access-tiers.yaml"), "profiles"), "tier_read")
	constraints := section(t, profile, "constraints")
	for _, name := range []string{"log_queries", "max_threads"} {
		section(t, constraints, name)
	}
	if _, kept := constraints["log_queries_min_type"]; kept {
		t.Error("a replaced protected setting is still pinned on the tier")
	}
}

// @scenario "A cap looser than its tier is refused, naming the user"
func TestRenderAll_UserCapsAreCheckedAgainstTheRenderedTier(t *testing.T) {
	withCap := func(t *testing.T, caps string) *config.Input {
		input := testInput()
		input.AccessFile = writeAccessFixture(t)
		input.AccessListen = "127.0.0.1:8124"
		input.ReadTierMaxExecutionTime = 120
		raw, err := os.ReadFile(input.AccessFile)
		if err != nil {
			t.Fatal(err)
		}
		capped := strings.Replace(string(raw), "login: {rolling:", "caps: "+caps+", login: {rolling:", 1)
		if err := os.WriteFile(input.AccessFile, []byte(capped), 0o600); err != nil {
			t.Fatal(err)
		}
		return input
	}

	t.Run("a cap above the tier stops the server starting", func(t *testing.T) {
		input := withCap(t, "{max_execution_time: 121}")
		err := render.RenderAll(testLogger(), input, config.ComputeFromResources(input.CPU, input.RAMBytes, input), t.TempDir())
		if err == nil || !strings.Contains(err.Error(), `users "dashboards": caps.max_execution_time = 121 is above the limit of 120 in profile tier_read`) {
			t.Errorf("RenderAll = %v, want the cap refused naming the user, setting and limit", err)
		}
	})

	t.Run("a cap within the tier renders as the user's own constraint", func(t *testing.T) {
		dir := t.TempDir()
		renderInto(t, withCap(t, "{max_execution_time: 60}"), dir)
		profile := section(t, section(t, readYAML(t, dir, "users.d/access-users.yaml"), "profiles"), "access_dashboards")
		assertValue(t, "access_dashboards", profile, "max_execution_time", 60)
		constraint := section(t, section(t, profile, "constraints"), "max_execution_time")
		assertValue(t, "access_dashboards", constraint, "max", 60)
		assertValue(t, "access_dashboards", constraint, "min", 1)
	})
}

// @scenario "A user whose own settings break a rendered cap or pin is left out"
func TestRenderAll_ConstraintsThePlanChecksAreTheRenderedOnes(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.AccessTiers = true
	input.ReadTierMaxExecutionTime = 120
	input.AuditQueryLog = true
	input.MaxConcurrentQueriesForUser = 6
	renderInto(t, input, dir)
	got, err := access.LoadConstraints(filepath.Join(dir, "users.d"))
	if err != nil {
		t.Fatal(err)
	}
	if c := got["tier_read"]["max_execution_time"]; c.Max == nil || *c.Max != 120 {
		t.Errorf("tier_read max_execution_time cap = %+v, want 120", c)
	}
	if c := got["default"]["log_queries"]; !c.Const {
		t.Errorf("default log_queries = %+v, want pinned", c)
	}
	if c := got["default"]["max_concurrent_queries_for_user"]; c.Min == nil || *c.Min != 1 || c.Max == nil || *c.Max != 6 {
		t.Errorf("default share = %+v, want 1 to 6", c)
	}
}
