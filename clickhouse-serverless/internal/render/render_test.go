package render_test

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/clickhouse-serverless/internal/render"
)

const gb1 int64 = 1 << 30

func testInput() *config.Input {
	return &config.Input{
		CPU:                  4,
		RAMBytes:             16 * gb1,
		Replicated:           false,
		ClusterName:          "default",
		Shard:                "shard_01",
		KeeperPort:           9181,
		DataNodePort:         9000,
		Password:             "testpass",
		ColdEnabled:          false,
		S3Endpoint:           "https://s3.us-east-1.amazonaws.com/mybucket/",
		S3Bucket:             "mybucket",
		S3Region:             "us-east-1",
		LogLevel:             "warning",
		LogFormat:            "json",
		SystemLogTTLDays:     30,
		EnableQueryLog:       true,
		QueryLogTTLDays:      7,
		QueryLogFlushMs:      7500,
		EnablePartLog:        true,
		PartLogTTLDays:       14,
		EnableMetricLog:      false,
		EnableTraceLog:       false,
		EnableTextLog:        false,
		EnableSessionLog:     false,
		EnableAsyncMetricLog: false,
		EnableOtelSpanLog:    false,
		EnableProfileLog:     false,
		EnableBlobLog:        false,
		EnablePrometheus:     false,
		GroupByOverflowMode:  "throw",
		MaxConnections:       4096,
		KeepAliveTimeout:     10,
		HTTPReceiveTimeout:   1800,
		HTTPSendTimeout:      1800,
		TCPKeepAliveTimeout:  10,
		ListenBacklog:        4096,
		MetricLogFlushMs:     30000,
		MetricLogCollectMs:   10000,
		TextLogLevel:         "warning",
	}
}

func testLogger() *zap.Logger {
	return zap.NewNop()
}

func TestRenderAll_CreatesExpectedFiles(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	expectedFiles := []string{
		"config.d/limits.yaml",
		"config.d/logging.yaml",
		"config.d/network.yaml",
		"users.d/profiles.yaml",
		"users.d/default-password.yaml",
	}

	for _, f := range expectedFiles {
		path := filepath.Join(dir, f)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("expected file %s to exist", f)
		}
	}

	// Keeper + interserver should NOT exist (Replicated=false).
	for _, f := range []string{"config.d/keeper.yaml", "config.d/interserver.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err == nil {
			t.Errorf("%s should not exist when Replicated=false", f)
		}
	}

	// Prometheus should NOT exist (disabled).
	promPath := filepath.Join(dir, "config.d/prometheus.yaml")
	if _, err := os.Stat(promPath); err == nil {
		t.Error("prometheus.yaml should not exist when disabled")
	}
}

func TestRenderAll_KeeperNotWrittenForStandalone(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	keeperPath := filepath.Join(dir, "config.d/keeper.yaml")
	if _, err := os.Stat(keeperPath); err == nil {
		t.Error("keeper.yaml should not exist for standalone mode")
	}
}

func TestRenderAll_KeeperWrittenForReplicated(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.Replicated = true
	input.ClusterName = "mycluster"
	input.Shard = "shard_01"
	input.Replica = "node-0"
	input.KeeperNodes = "keeper-0.keeper,keeper-1.keeper,keeper-2.keeper"
	input.KeeperPort = 9181
	input.DataNodes = "ch-0.ch-headless,ch-1.ch-headless,ch-2.ch-headless"
	input.DataNodePort = 9000
	input.ClusterSecretFile = "/mnt/secrets/cluster-secret"
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "config.d/keeper.yaml"))
	if err != nil {
		t.Fatalf("read keeper.yaml: %v", err)
	}
	content := string(data)

	for _, want := range []string{
		"keeper-0.keeper",
		"keeper-2.keeper",
		"ch-1.ch-headless",
		"mycluster",
		"shard_01",
		"node-0",
		"internal_replication: true",
		"from_file",
		"/mnt/secrets/cluster-secret",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("keeper.yaml missing %q\n--- actual content ---\n%s", want, content)
		}
	}
}

func TestRenderAll_PrometheusEnabled(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.EnablePrometheus = true
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "config.d/prometheus.yaml"))
	if err != nil {
		t.Fatalf("read prometheus.yaml: %v", err)
	}
	if !strings.Contains(string(data), "9363") {
		t.Error("prometheus.yaml should contain port 9363")
	}
}

func TestRenderAll_LimitsContainsMergeTreeSettings(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "config.d/limits.yaml"))
	if err != nil {
		t.Fatalf("read limits.yaml: %v", err)
	}

	content := string(data)
	checks := []string{
		"merge_tree:",
		"max_parts_to_merge_at_once: 8",   // 4 CPU -> 8
		"background_pool_size: 2",          // max(2, 4/2) = 2
		"max_server_memory_usage:",
		"query_log:",
		"INTERVAL 7 DAY DELETE", // query_log TTL
	}

	for _, check := range checks {
		if !strings.Contains(content, check) {
			t.Errorf("limits.yaml missing %q", check)
		}
	}
}

func TestRenderAll_SystemLogsTTL(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.EnableQueryLog = true
	input.QueryLogTTLDays = 14
	input.EnableTraceLog = false
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "config.d/limits.yaml"))
	if err != nil {
		t.Fatalf("read limits.yaml: %v", err)
	}

	content := string(data)

	// Query log should have 14-day TTL.
	if !strings.Contains(content, "INTERVAL 14 DAY DELETE") {
		t.Error("query_log should have 14-day TTL")
	}

	// Trace log should be removed (disabled logs get @remove directive).
	if !strings.Contains(content, "trace_log") {
		t.Error("trace_log entry should exist")
	}
	// Verify the @remove directive is present for the disabled trace_log.
	if !strings.Contains(content, "trace_log:") || !strings.Contains(content, "@remove") {
		t.Error("trace_log should have @remove directive when disabled")
	}
}

func TestRenderAll_PasswordHash(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.Password = "mysecret"
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "users.d/default-password.yaml"))
	if err != nil {
		t.Fatalf("read default-password.yaml: %v", err)
	}

	content := string(data)
	h := sha256.Sum256([]byte("mysecret"))
	expectedHash := fmt.Sprintf("%x", h)
	if !strings.Contains(content, expectedHash) {
		t.Errorf("default-password.yaml should contain hash %q", expectedHash)
	}
}

func TestRenderAll_EnvOverrideApplied(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	// Override via env var (reflection-based via ApplyEnvOverrides).
	t.Setenv("BACKGROUND_POOL_SIZE", "8")

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "config.d/limits.yaml"))
	if err != nil {
		t.Fatalf("read limits.yaml: %v", err)
	}

	if !strings.Contains(string(data), "background_pool_size: 8") {
		t.Error("limits.yaml should contain overridden BACKGROUND_POOL_SIZE")
	}
}

func TestRenderAll_ColdStorageCreatesFiles(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.ColdEnabled = true
	input.S3Endpoint = "https://s3.us-east-1.amazonaws.com/mybucket/"
	input.S3Bucket = "mybucket"
	input.S3Region = "us-east-1"
	input.UseEnvironmentCredentials = true
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	// storage.yaml should exist in config.d
	storageData, err := os.ReadFile(filepath.Join(dir, "config.d/storage.yaml"))
	if err != nil {
		t.Fatalf("read storage.yaml: %v", err)
	}
	content := string(storageData)
	if !strings.Contains(content, "local_primary") {
		t.Error("storage.yaml should contain local_primary policy")
	}
	if !strings.Contains(content, "mybucket") {
		t.Error("storage.yaml should contain bucket name")
	}
}

func TestRenderAll_BackupWithoutColdStorage(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.ColdEnabled = false
	input.BackupEnabled = true
	input.S3Endpoint = "https://s3.us-east-1.amazonaws.com/mybucket/"
	input.S3Bucket = "mybucket"
	input.S3Region = "us-east-1"
	input.UseEnvironmentCredentials = true
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	// storage.yaml should exist (backup disk is rendered into it)
	storageData, err := os.ReadFile(filepath.Join(dir, "config.d/storage.yaml"))
	if err != nil {
		t.Fatalf("read storage.yaml: %v", err)
	}
	content := string(storageData)
	if !strings.Contains(content, "s3_plain") {
		t.Error("storage.yaml should contain s3_plain backup disk")
	}
	if !strings.Contains(content, "- backups") {
		t.Error("storage.yaml should list backups in allowed_disk")
	}

	// Should NOT have cold storage policy (ColdEnabled not set)
	if strings.Contains(content, "local_primary") {
		t.Error("storage.yaml should not contain local_primary policy when only BackupEnabled is set")
	}
}

func TestRenderAll_NetworkSettings(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.MaxConnections = 8192
	input.KeepAliveTimeout = 30
	input.HTTPReceiveTimeout = 600
	input.TCPKeepAliveTimeout = 20
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)

	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	// Server-level settings go in network.yaml
	netData, err := os.ReadFile(filepath.Join(dir, "config.d/network.yaml"))
	if err != nil {
		t.Fatalf("read network.yaml: %v", err)
	}
	netContent := string(netData)
	if !strings.Contains(netContent, "max_connections: 8192") {
		t.Error("network.yaml should contain max_connections: 8192")
	}
	if !strings.Contains(netContent, "keep_alive_timeout: 30") {
		t.Error("network.yaml should contain keep_alive_timeout: 30")
	}

	// User-level timeout settings go in profiles.yaml
	profData, err := os.ReadFile(filepath.Join(dir, "users.d/profiles.yaml"))
	if err != nil {
		t.Fatalf("read profiles.yaml: %v", err)
	}
	profContent := string(profData)
	if !strings.Contains(profContent, "http_receive_timeout: 600") {
		t.Error("profiles.yaml should contain http_receive_timeout: 600")
	}
	if !strings.Contains(profContent, "tcp_keep_alive_timeout: 20") {
		t.Error("profiles.yaml should contain tcp_keep_alive_timeout: 20")
	}
}
