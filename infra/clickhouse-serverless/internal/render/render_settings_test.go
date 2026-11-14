package render_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/render"
)

// renderInto runs RenderAll for input into dir with computed derived from it.
func renderInto(t *testing.T, input *config.Input, dir string) {
	t.Helper()
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)
	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}
}

// readYAML parses a rendered file under dir into a generic map.
func readYAML(t *testing.T, dir, rel string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	out := map[string]any{}
	if err := yaml.Unmarshal(data, &out); err != nil {
		t.Fatalf("parse %s: %v", rel, err)
	}
	return out
}

// section returns m[key] as a map, failing the test when it is not one.
func section(t *testing.T, m map[string]any, key string) map[string]any {
	t.Helper()
	sub, ok := m[key].(map[string]any)
	if !ok {
		t.Fatalf("%s is not a map: %#v", key, m[key])
	}
	return sub
}

func defaultProfile(t *testing.T, dir string) map[string]any {
	t.Helper()
	return section(t, section(t, readYAML(t, dir, "users.d/profiles.yaml"), "profiles"), "default")
}

func assertValue(t *testing.T, where string, m map[string]any, key string, want any) {
	t.Helper()
	got, ok := m[key]
	if !ok {
		t.Errorf("%s: %s missing, want %v", where, key, want)
		return
	}
	if got != want {
		t.Errorf("%s: %s = %#v, want %#v", where, key, got, want)
	}
}

func assertExists(t *testing.T, path string, want bool) {
	t.Helper()
	_, err := os.Stat(path)
	if exists := err == nil; exists != want {
		t.Errorf("%s exists = %v, want %v", path, exists, want)
	}
}

// @scenario "Server and profile settings render their defaults"
func TestRenderAll_SettingDefaults(t *testing.T) {
	dir := t.TempDir()
	renderInto(t, testInput(), dir)

	profile := defaultProfile(t, dir)
	for _, key := range []string{
		"network_compression_method",
		"network_zstd_compression_level",
		"cancel_http_readonly_queries_on_client_close",
	} {
		if _, ok := profile[key]; ok {
			t.Errorf("default profile: %s must be omitted (ClickHouse default) unless its env is set", key)
		}
	}

	limits := readYAML(t, dir, "config.d/limits.yaml")
	assertValue(t, "limits", limits, "max_concurrent_select_queries", 0)
	assertValue(t, "limits", limits, "memory_worker_dynamic_hard_limit", 0)
	if _, ok := section(t, limits, "merge_tree")["merge_max_block_size_bytes"]; ok {
		t.Error("merge_max_block_size_bytes must be omitted when MERGE_MAX_BLOCK_SIZE_BYTES is 0")
	}
}

// @scenario "Each server and profile setting follows its env var"
func TestRenderAll_SettingEnvOverrides(t *testing.T) {
	t.Setenv("MERGE_MAX_BLOCK_SIZE_BYTES", "268435456")
	t.Setenv("MAX_CONCURRENT_SELECT_QUERIES", "40")
	t.Setenv("NETWORK_COMPRESSION_METHOD", "lz4")
	t.Setenv("NETWORK_ZSTD_COMPRESSION_LEVEL", "1")
	t.Setenv("CANCEL_HTTP_READONLY_QUERIES_ON_CLIENT_CLOSE", "1")

	dir := t.TempDir()
	renderInto(t, testInput(), dir)

	profile := defaultProfile(t, dir)
	assertValue(t, "default profile", profile, "network_compression_method", "lz4")
	assertValue(t, "default profile", profile, "network_zstd_compression_level", 1)
	assertValue(t, "default profile", profile, "cancel_http_readonly_queries_on_client_close", 1)

	limits := readYAML(t, dir, "config.d/limits.yaml")
	assertValue(t, "limits", limits, "max_concurrent_select_queries", 40)
	assertValue(t, "merge_tree", section(t, limits, "merge_tree"), "merge_max_block_size_bytes", 268435456)
}

// @scenario "Pool-entry thresholds follow an overridden background pool size"
func TestRenderAll_PoolEntriesFollowEffectivePoolSize(t *testing.T) {
	t.Run("derived from the override", func(t *testing.T) {
		t.Setenv("BACKGROUND_POOL_SIZE", "16")
		dir := t.TempDir()
		renderInto(t, testInput(), dir) // 4 CPU would auto-size the pool to 2

		mt := section(t, readYAML(t, dir, "config.d/limits.yaml"), "merge_tree")
		assertValue(t, "merge_tree", mt, "number_of_free_entries_in_pool_to_execute_mutation", 8)
		assertValue(t, "merge_tree", mt, "number_of_free_entries_in_pool_to_lower_max_size_of_merge", 4)
		assertValue(t, "merge_tree", mt, "number_of_free_entries_in_pool_to_execute_optimize_entire_partition", 8)
	})

	t.Run("explicit value wins", func(t *testing.T) {
		t.Setenv("BACKGROUND_POOL_SIZE", "16")
		t.Setenv("NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_EXECUTE_MUTATION", "16")
		t.Setenv("NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_LOWER_MAX_SIZE_OF_MERGE", "16")
		dir := t.TempDir()
		renderInto(t, testInput(), dir)

		mt := section(t, readYAML(t, dir, "config.d/limits.yaml"), "merge_tree")
		assertValue(t, "merge_tree", mt, "number_of_free_entries_in_pool_to_execute_mutation", 16)
		assertValue(t, "merge_tree", mt, "number_of_free_entries_in_pool_to_lower_max_size_of_merge", 16)
		assertValue(t, "merge_tree", mt, "number_of_free_entries_in_pool_to_execute_optimize_entire_partition", 8)
	})
}

// @scenario "Interserver credentials are rendered only from a password file"
func TestRenderAll_InterserverCredentials(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.d", "interserver.yaml")

	renderInto(t, testInput(), dir)
	assertExists(t, path, false)

	input := replicatedInput()
	input.InterserverUser = "interserver"
	input.InterserverPasswordFile = "/mnt/secrets/interserver-password"
	input.InterserverPassword = "s3cret"
	renderInto(t, input, dir)

	creds := section(t, readYAML(t, dir, "config.d/interserver.yaml"), "interserver_http_credentials")
	assertValue(t, "interserver_http_credentials", creds, "user", "interserver")
	assertValue(t, "interserver_http_credentials", creds, "password", "s3cret")

	// A later run without the password file removes the copy the first one wrote.
	renderInto(t, testInput(), dir)
	assertExists(t, path, false)
}

// @scenario "The server keeps its log files unless console-only logging is asked for"
func TestRenderAll_LogToFile(t *testing.T) {
	for _, tc := range []struct {
		name       string
		logToFile  bool
		wantRemove bool
	}{
		{"file loggers kept by default", true, false},
		{"console only with LOG_TO_FILE=false", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := testInput()
			input.LogToFile = tc.logToFile
			dir := t.TempDir()
			renderInto(t, input, dir)

			logger := section(t, readYAML(t, dir, "config.d/logging.yaml"), "logger")
			assertValue(t, "logger", logger, "console", true)
			for _, key := range []string{"log", "errorlog"} {
				entry, present := logger[key].(map[string]any)
				removed := present && entry["@remove"] == "1"
				if removed != tc.wantRemove {
					t.Errorf("logger.%s removed = %v, want %v (%#v)", key, removed, tc.wantRemove, logger[key])
				}
			}
		})
	}
}

// @scenario "The default user can be left without access management"
func TestRenderAll_DefaultUserAccessManagementOff(t *testing.T) {
	dir := t.TempDir()
	off := false
	input := testInput()
	input.DefaultUserAccessManagement = &off
	renderInto(t, input, dir)

	// The stock users.xml grants both flags, so leaving the file out would keep them.
	user := section(t, section(t, readYAML(t, dir, "users.d/zz-access-management.yaml"), "users"), "default")
	for _, flag := range []string{"access_management", "named_collection_control"} {
		if user[flag] != 0 {
			t.Errorf("%s = %v with DEFAULT_USER_ACCESS_MANAGEMENT=false, want 0", flag, user[flag])
		}
	}
	if _, ok := user["grants"]; ok {
		t.Error("an opted-out default user must get no grants list")
	}
}

// @scenario "Rendered mode keeps the default user to the LangWatchQL collections"
func TestRenderAll_RenderedModeGrantsOnlyTheLWQLCollections(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.LWQLAccessDir = lwqlDir(t)
	renderInto(t, input, dir)

	user := section(t, section(t, readYAML(t, dir, "users.d/zz-access-management.yaml"), "users"), "default")
	// ClickHouse refuses a grants list beside any access flag, so each is removed.
	for _, flag := range []string{"access_management", "named_collection_control", "show_named_collections"} {
		if got := section(t, user, flag)["@remove"]; got != "1" {
			t.Errorf("%s must be removed in rendered mode, got %v", flag, user[flag])
		}
	}
	queries, _ := section(t, user, "grants")["query"].([]any)
	got := make([]string, len(queries))
	for i, q := range queries {
		got[i], _ = q.(string)
	}
	want := []string{
		"GRANT ALL ON *.*",
		"REVOKE ACCESS MANAGEMENT, NAMED COLLECTION ADMIN ON *.*",
		"GRANT NAMED COLLECTION, SHOW NAMED COLLECTIONS ON lwql_postgres*",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("rendered-mode grants = %q, want %q", got, want)
	}
}

// @scenario "Files a deployment mounts next to the rendered ones are left alone"
func TestRenderAll_LeavesForeignFilesAlone(t *testing.T) {
	dir := t.TempDir()
	foreign := map[string]string{
		"config.d/zzz-saas.xml":               "<clickhouse><max_table_size_to_drop>0</max_table_size_to_drop></clickhouse>\n",
		"users.d/zzz-saas-users.xml":          "<clickhouse><users><default><access_management>0</access_management></default></users></clickhouse>\n",
		"users.d/lwql-access.yaml":            "users: {}\n",
		"config.d/lwql-named-collection.yaml": "named_collections: {}\n",
	}
	for rel, content := range foreign {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o440); err != nil {
			t.Fatal(err)
		}
	}

	// Disabled conditional files exercise the stale-file removal path too.
	off := false
	input := testInput()
	input.DefaultUserAccessManagement = &off
	renderInto(t, input, dir)
	renderInto(t, replicatedInput(), dir)

	for rel, want := range foreign {
		got, err := os.ReadFile(filepath.Join(dir, rel))
		if err != nil {
			t.Errorf("%s was removed: %v", rel, err)
			continue
		}
		if string(got) != want {
			t.Errorf("%s was rewritten: %q", rel, got)
		}
	}
}

// @scenario "An explicit opt-in keeps the default user's access DDL in rendered mode"
func TestRenderAll_ExplicitOptInWinsOverRenderedMode(t *testing.T) {
	dir := t.TempDir()
	on := true
	input := testInput()
	input.LWQLAccessDir = lwqlDir(t)
	input.DefaultUserAccessManagement = &on
	renderInto(t, input, dir)

	user := section(t, section(t, readYAML(t, dir, "users.d/zz-access-management.yaml"), "users"), "default")
	for _, flag := range []string{"access_management", "named_collection_control"} {
		if user[flag] != 1 {
			t.Errorf("%s = %v with DEFAULT_USER_ACCESS_MANAGEMENT=true in rendered mode, want 1", flag, user[flag])
		}
	}
	if _, ok := user["grants"]; ok {
		t.Error("an opted-in default user must keep the flags, not a grants list")
	}
}

// @scenario "The default user's networks fail closed"
func TestRenderAll_DefaultNetworksKeepLoopback(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.DefaultNetworks = "10.0.0.0/16, 10.1.0.0/16"
	renderInto(t, input, dir)

	networks := section(t, section(t, section(t, readYAML(t, dir, "users.d/default-password.yaml"), "users"), "default"), "networks")
	if networks["@replace"] != "replace" {
		t.Error("the networks list must replace the stock ::/0, not merge with it")
	}
	got := fmt.Sprint(networks["ip"])
	if got != "[127.0.0.1 ::1 10.0.0.0/16 10.1.0.0/16]" {
		t.Errorf("default networks = %s, want loopback then the listed networks", got)
	}

	renderInto(t, testInput(), dir)
	if _, ok := section(t, section(t, readYAML(t, dir, "users.d/default-password.yaml"), "users"), "default")["networks"]; ok {
		t.Error("without CLICKHOUSE_DEFAULT_NETWORKS the default user's networks must stay as they are")
	}
}

// @scenario "Query-log auditing and a per-user query share are opt-in"
func TestRenderAll_AuditQueryLogAndConcurrencyShare(t *testing.T) {
	dir := t.TempDir()
	renderInto(t, testInput(), dir)
	plain := section(t, section(t, readYAML(t, dir, "users.d/profiles.yaml"), "profiles"), "default")
	for _, name := range []string{"log_queries_cut_to_length", "max_concurrent_queries_for_user", "constraints"} {
		if _, ok := plain[name]; ok {
			t.Errorf("%s rendered without opting in", name)
		}
	}

	input := testInput()
	input.AuditQueryLog = true
	input.MaxConcurrentQueriesForUser = 120
	renderInto(t, input, dir)
	profile := section(t, section(t, readYAML(t, dir, "users.d/profiles.yaml"), "profiles"), "default")
	if profile["max_concurrent_queries_for_user"] != 120 {
		t.Errorf("max_concurrent_queries_for_user = %v, want 120", profile["max_concurrent_queries_for_user"])
	}
	constraints := section(t, profile, "constraints")
	for name, want := range map[string]any{
		"log_queries": 1, "log_queries_min_type": "QUERY_START", "log_queries_min_query_duration_ms": 0,
		"log_queries_probability": 1, "log_queries_cut_to_length": 0, "log_profile_events": 1,
	} {
		if profile[name] != want {
			t.Errorf("%s = %v, want %v", name, profile[name], want)
		}
		if _, ok := constraints[name]; !ok {
			t.Errorf("%s is not const", name)
		}
	}
	// Left to each user: the LangWatchQL user turns it off so its capability stays out of query_log.
	if _, pinned := constraints["log_query_settings"]; pinned {
		t.Error("log_query_settings is pinned, so no user's profile can keep its settings out of query_log")
	}
}

// @scenario "A masked setting's value never reaches a log"
func TestRenderAll_QueryMaskingFollowsMaskedSettings(t *testing.T) {
	dir := t.TempDir()
	input := testInput()
	input.MaskedSettings = []string{"custom_api_key_hash"}
	input.MaskSHA256Hex = true
	renderInto(t, input, dir)
	raw, err := os.ReadFile(filepath.Join(dir, "config.d", "query-masking.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"hide custom_api_key_hash in a statement", "hide custom_api_key_hash in a URL", "hide custom_api_key_hash in an encoded URL", `replace: \1 = '[HIDDEN]'`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("query-masking.yaml lacks %q:\n%s", want, raw)
		}
	}
	if !strings.Contains(string(raw), "hide sha256 hex values") {
		t.Errorf("query-masking.yaml lacks the sha256 rule:\n%s", raw)
	}
	input.MaskedSettings = nil
	input.MaskSHA256Hex = false
	renderInto(t, input, dir)
	assertExists(t, filepath.Join(dir, "config.d", "query-masking.yaml"), false)
}
