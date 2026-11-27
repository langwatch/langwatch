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

// lwqlDir writes the two files the app's access-render Job puts in its Secret.
func lwqlDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range map[string]string{
		"lwql-access.yaml":           "users: {}\n",
		"lwql-named-collection.yaml": "named_collections: {}\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func renderWith(t *testing.T, input *config.Input, out string) error {
	t.Helper()
	computed := config.ComputeFromResources(input.CPU, input.RAMBytes, input)
	return render.RenderAll(testLogger(), input, computed, out)
}

// @scenario "The LangWatchQL access model is linked from a directory mount"
func TestRenderAll_LinksLWQLAccessFromDirectory(t *testing.T) {
	src := lwqlDir(t)
	out := t.TempDir()
	input := testInput()
	input.LWQLAccessDir = src
	if err := renderWith(t, input, out); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}

	for link, target := range map[string]string{
		"users.d/lwql-access.yaml":            "lwql-access.yaml",
		"config.d/lwql-named-collection.yaml": "lwql-named-collection.yaml",
	} {
		got, err := os.Readlink(filepath.Join(out, link))
		if err != nil {
			t.Fatalf("%s is not a link: %v", link, err)
		}
		if want := filepath.Join(src, target); got != want {
			t.Errorf("%s -> %s, want %s", link, got, want)
		}
	}

	// The Secret is updated in place; the server reads the new content
	// through the link with nothing re-rendered.
	updated := "users: {langwatch_lwql: {}}\n"
	if err := os.WriteFile(filepath.Join(src, "lwql-access.yaml"), []byte(updated), 0o600); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(out, "users.d/lwql-access.yaml"))
	if err != nil || string(data) != updated {
		t.Errorf("read through link = %q, %v; want %q", data, err, updated)
	}

	// A second boot in the same pod replaces its own links.
	if err := renderWith(t, input, out); err != nil {
		t.Fatalf("second RenderAll: %v", err)
	}
}

// @scenario "A missing LangWatchQL access file stops the server starting"
func TestRenderAll_LWQLAccessDirMissingFileFails(t *testing.T) {
	src := lwqlDir(t)
	if err := os.Remove(filepath.Join(src, "lwql-named-collection.yaml")); err != nil {
		t.Fatal(err)
	}
	input := testInput()
	input.LWQLAccessDir = src
	err := renderWith(t, input, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "LWQL_ACCESS_DIR") {
		t.Fatalf("RenderAll error = %v, want one naming LWQL_ACCESS_DIR", err)
	}
}

// @scenario "Without LWQL_ACCESS_DIR a mounted access file is left alone"
func TestRenderAll_LWQLAccessUnsetLeavesMountedFile(t *testing.T) {
	out := t.TempDir()
	usersD := filepath.Join(out, "users.d")
	if err := os.MkdirAll(usersD, 0o755); err != nil {
		t.Fatal(err)
	}
	// What an older chart's subPath mount looks like: a regular file.
	mounted := filepath.Join(usersD, "lwql-access.yaml")
	if err := os.WriteFile(mounted, []byte("users: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A link an earlier boot made, now stale.
	stale := filepath.Join(out, "config.d", "lwql-named-collection.yaml")
	if err := os.MkdirAll(filepath.Dir(stale), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/nonexistent/lwql-named-collection.yaml", stale); err != nil {
		t.Fatal(err)
	}

	if err := renderWith(t, testInput(), out); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}
	if data, err := os.ReadFile(mounted); err != nil || string(data) != "users: {}\n" {
		t.Errorf("mounted file changed: %q, %v", data, err)
	}
	if _, err := os.Lstat(stale); !os.IsNotExist(err) {
		t.Errorf("stale link still present: %v", err)
	}
}

func limitsYAML(t *testing.T, input *config.Input) map[string]any {
	t.Helper()
	out := t.TempDir()
	if err := renderWith(t, input, out); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(out, "config.d/limits.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	return cfg
}

// @scenario "Every default system log can be given the system log TTL"
func TestRenderAll_SystemLogTTLAll(t *testing.T) {
	logs := []string{"error_log", "crash_log", "query_metric_log", "query_thread_log", "query_views_log"}

	off := limitsYAML(t, testInput())
	for _, key := range logs {
		if entry, ok := off[key].(map[string]any); ok && entry["ttl"] != nil {
			t.Errorf("%s has a TTL without SYSTEM_LOG_TTL_ALL", key)
		}
	}

	input := testInput()
	input.SystemLogTTLAll = true
	input.SystemLogTTLDays = 21
	on := limitsYAML(t, input)
	for _, key := range logs {
		entry, _ := on[key].(map[string]any)
		if entry["ttl"] != "event_date + INTERVAL 21 DAY DELETE" {
			t.Errorf("%s ttl = %v, want 21 days", key, entry["ttl"])
		}
	}
	if entry, ok := on["backup_log"].(map[string]any); ok && entry["ttl"] != nil {
		t.Error("backup_log must keep no TTL: the backup sidecar finds a backup's base there")
	}
}
