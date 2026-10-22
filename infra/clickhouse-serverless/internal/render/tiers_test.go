package render_test

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
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

// @scenario "Every server carries the four tiers"
func TestRenderAll_Tiers(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
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
	input.ReadTierMaxExecutionTime = 60
	renderInto(t, input, dir)
	profile := section(t, section(t, readYAML(t, dir, "users.d/access-tiers.yaml"), "profiles"), "tier_read")
	assertValue(t, "tier_read", profile, "max_execution_time", 60)
}
