package render_test

import (
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
	assertValue(t, "default profile", profile, "network_compression_method", "zstd")
	assertValue(t, "default profile", profile, "network_zstd_compression_level", 3)
	assertValue(t, "default profile", profile, "cancel_http_readonly_queries_on_client_close", 1)

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
	t.Setenv("CANCEL_HTTP_READONLY_QUERIES_ON_CLIENT_CLOSE", "0")

	dir := t.TempDir()
	renderInto(t, testInput(), dir)

	profile := defaultProfile(t, dir)
	assertValue(t, "default profile", profile, "network_compression_method", "lz4")
	assertValue(t, "default profile", profile, "network_zstd_compression_level", 1)
	assertValue(t, "default profile", profile, "cancel_http_readonly_queries_on_client_close", 0)

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

// @scenario "The server logs to the console only unless file logging is asked for"
func TestRenderAll_LogToFile(t *testing.T) {
	for _, tc := range []struct {
		name       string
		logToFile  bool
		wantRemove bool
	}{
		{"console only by default", false, true},
		{"file loggers kept with LOG_TO_FILE", true, false},
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
	renderInto(t, testInput(), dir)
	assertExists(t, filepath.Join(dir, "users.d", "zz-access-management.yaml"), true)

	off := false
	input := testInput()
	input.DefaultUserAccessManagement = &off
	renderInto(t, input, dir)

	entries, err := os.ReadDir(filepath.Join(dir, "users.d"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(dir, "users.d", e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		for _, grant := range []string{"access_management", "named_collection_control"} {
			if strings.Contains(string(data), grant) {
				t.Errorf("users.d/%s grants %s with DEFAULT_USER_ACCESS_MANAGEMENT=false", e.Name(), grant)
			}
		}
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
