package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
)

// writeSecret writes content with the mode the Kubernetes secret mount uses.
func writeSecret(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o440); err != nil {
		t.Fatal(err)
	}
	return path
}

func setMinimalEnv(t *testing.T) {
	t.Helper()
	t.Setenv("CH_CPU", "2")
	t.Setenv("CH_RAM", "4Gi")
	t.Setenv("CLICKHOUSE_PASSWORD", "pw")
}

func TestLoad_ReadsClusterSecretAndInterserverPassword(t *testing.T) {
	setMinimalEnv(t)
	t.Setenv("CLICKHOUSE_CLUSTER_SECRET_FILE", writeSecret(t, "cluster-secret", "cluster-value\n"))
	t.Setenv("CLICKHOUSE_INTERSERVER_PASSWORD_FILE", writeSecret(t, "interserver", "  inter-value \n"))

	input, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if input.ClusterSecret != "cluster-value" {
		t.Errorf("ClusterSecret = %q, want %q", input.ClusterSecret, "cluster-value")
	}
	if input.InterserverPassword != "inter-value" {
		t.Errorf("InterserverPassword = %q, want %q", input.InterserverPassword, "inter-value")
	}
	if input.InterserverUser != "interserver" {
		t.Errorf("InterserverUser = %q, want the default %q", input.InterserverUser, "interserver")
	}
}

func TestLoad_RefusesEmptyOrMissingSecretFiles(t *testing.T) {
	for _, env := range []string{"CLICKHOUSE_CLUSTER_SECRET_FILE", "CLICKHOUSE_INTERSERVER_PASSWORD_FILE"} {
		t.Run(env+" empty", func(t *testing.T) {
			setMinimalEnv(t)
			t.Setenv(env, writeSecret(t, "empty", " \n"))
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), env) {
				t.Errorf("Load() error = %v, want one naming %s", err, env)
			}
		})
		t.Run(env+" missing", func(t *testing.T) {
			setMinimalEnv(t)
			t.Setenv(env, "/nonexistent/secret")
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), env) {
				t.Errorf("Load() error = %v, want one naming %s", err, env)
			}
		})
	}
}

func TestLoad_NewSwitchDefaults(t *testing.T) {
	setMinimalEnv(t)
	input, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if input.LogToFile {
		t.Error("LOG_TO_FILE should default to false")
	}
	if !input.GrantsDefaultAccessManagement() {
		t.Error("DEFAULT_USER_ACCESS_MANAGEMENT should default to true")
	}
	if input.InterserverPasswordFile != "" || input.InterserverPassword != "" {
		t.Error("interserver credentials should be unset by default")
	}

	t.Setenv("LOG_TO_FILE", "true")
	t.Setenv("DEFAULT_USER_ACCESS_MANAGEMENT", "false")
	input, err = Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if !input.LogToFile {
		t.Error("LOG_TO_FILE=true should be read")
	}
	if input.GrantsDefaultAccessManagement() {
		t.Error("DEFAULT_USER_ACCESS_MANAGEMENT=false should be read")
	}
}

func TestValidate_InterserverUserRequiredWithPasswordFile(t *testing.T) {
	i := validInput()
	i.InterserverPasswordFile = "/mnt/secrets/interserver"
	i.InterserverUser = " "
	if err := i.Validate(); err == nil || !strings.Contains(err.Error(), "CLICKHOUSE_INTERSERVER_USER") {
		t.Errorf("expected CLICKHOUSE_INTERSERVER_USER error, got: %v", err)
	}
}

func TestApplyOverrides_PoolEntriesFollowEffectivePoolSize(t *testing.T) {
	t.Setenv("BACKGROUND_POOL_SIZE", "12")
	t.Setenv("NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_EXECUTE_OPTIMIZE_ENTIRE_PARTITION", "5")
	t.Setenv("NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_LOWER_MAX_SIZE_OF_MERGE", "not-a-number")

	c := ComputeFromResources(4, 16*gb1, nil) // auto pool size 2
	ApplyOverrides(zap.NewNop(), c)

	if c.BackgroundPoolSize != 12 {
		t.Fatalf("BackgroundPoolSize = %d, want 12", c.BackgroundPoolSize)
	}
	if c.PoolFreeEntryMutation != 6 {
		t.Errorf("PoolFreeEntryMutation = %d, want 6 (12/2)", c.PoolFreeEntryMutation)
	}
	if c.PoolFreeEntryLowerMerge != 3 {
		t.Errorf("PoolFreeEntryLowerMerge = %d, want 3 (invalid env falls back to 12/4)", c.PoolFreeEntryLowerMerge)
	}
	if c.PoolFreeEntryOptimizePartition != 5 {
		t.Errorf("PoolFreeEntryOptimizePartition = %d, want the explicit 5", c.PoolFreeEntryOptimizePartition)
	}
}
