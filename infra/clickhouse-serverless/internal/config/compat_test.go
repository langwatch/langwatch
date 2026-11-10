package config

import (
	"os"
	"path/filepath"
	"testing"
)

func loadWithBasics(t *testing.T) *Input {
	t.Helper()
	t.Setenv("CH_CPU", "2")
	t.Setenv("CH_RAM", "1Gi")
	t.Setenv("CLICKHOUSE_PASSWORD", "pw-under-test")
	input, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	return input
}

// @scenario "The image reads the replica and shard names an older image read"
func TestLoad_ReadsOlderReplicaAndShardNames(t *testing.T) {
	t.Setenv("REPLICA_NAME", "replica-under-test")
	t.Setenv("SHARD_NAME", "shard-under-test")

	input := loadWithBasics(t)
	if input.Replica != "replica-under-test" || input.Shard != "shard-under-test" {
		t.Errorf("Replica, Shard = %q, %q; want the older names' values", input.Replica, input.Shard)
	}
}

func TestLoad_CurrentNameWinsOverItsAlias(t *testing.T) {
	t.Setenv("CH_REPLICA", "current-replica")
	t.Setenv("REPLICA_NAME", "older-replica")

	if got := loadWithBasics(t).Replica; got != "current-replica" {
		t.Errorf("Replica = %q, want CH_REPLICA's value", got)
	}
}

// @scenario "The image finds the access model at the conventional directory with no env"
func TestLoad_FindsTheAccessModelAtTheDefaultDirectory(t *testing.T) {
	dir := t.TempDir()
	prev := DefaultLWQLAccessDir
	DefaultLWQLAccessDir = dir
	t.Cleanup(func() { DefaultLWQLAccessDir = prev })

	if got := loadWithBasics(t).LWQLAccessDir; got != "" {
		t.Fatalf("LWQLAccessDir = %q with nothing mounted, want empty", got)
	}
	if err := os.WriteFile(filepath.Join(dir, LWQLAccessFile), []byte("users: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := loadWithBasics(t).LWQLAccessDir; got != dir {
		t.Errorf("LWQLAccessDir = %q, want the default directory %q", got, dir)
	}
	t.Setenv("LWQL_ACCESS_DIR", "/elsewhere-under-test")
	if got := loadWithBasics(t).LWQLAccessDir; got != "/elsewhere-under-test" {
		t.Errorf("LWQLAccessDir = %q, want LWQL_ACCESS_DIR's value", got)
	}
}

// @scenario "The default user's networks fail closed"
func TestLoad_RefusesAnEmptyDefaultNetworksList(t *testing.T) {
	t.Setenv("CH_CPU", "2")
	t.Setenv("CH_RAM", "1Gi")
	t.Setenv("CLICKHOUSE_PASSWORD", "pw-under-test")
	t.Setenv("CLICKHOUSE_DEFAULT_NETWORKS", " , ")
	if _, err := Load(); err == nil {
		t.Fatal("Load accepted a CLICKHOUSE_DEFAULT_NETWORKS that names no network")
	}
}

// @scenario "The default user's networks fail closed"
func TestLoad_RefusesADefaultNetworkThatIsNotOne(t *testing.T) {
	t.Setenv("CH_CPU", "2")
	t.Setenv("CH_RAM", "1Gi")
	t.Setenv("CLICKHOUSE_PASSWORD", "pw-under-test")
	for _, bad := range []string{"10.0.0.0/33", "10.0.0.0/8;", "office-vpn"} {
		t.Setenv("CLICKHOUSE_DEFAULT_NETWORKS", "10.0.0.0/8,"+bad)
		if _, err := Load(); err == nil {
			t.Errorf("Load accepted %q as a default network", bad)
		}
	}
	t.Setenv("CLICKHOUSE_DEFAULT_NETWORKS", "10.0.0.0/8, 192.168.1.4, fd00::/8")
	if _, err := Load(); err != nil {
		t.Errorf("Load refused valid networks: %v", err)
	}
}
