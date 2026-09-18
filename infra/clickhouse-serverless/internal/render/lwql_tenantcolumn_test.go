package render

// The LWQL row filter is applied to the project column a source table actually
// carries. Almost every source names it "TenantId"; one (stored_objects) carries
// "project_id" and its filter must name that column or it would police the wrong
// one. This is an internal test because it drives the render through injected
// catalog vars rather than the embedded manifest, which today lists no
// project_id-keyed table.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

func TestLwqlTenantColumnFor_DefaultsToTenantId(t *testing.T) {
	saved := lwqlTenantColumns
	defer func() { lwqlTenantColumns = saved }()

	lwqlTenantColumns = map[string]string{"stored_objects": "project_id", "empty_table": ""}

	if got := lwqlTenantColumnFor("trace_summaries"); got != "TenantId" {
		t.Errorf("unmapped table: got %q, want TenantId", got)
	}
	if got := lwqlTenantColumnFor("empty_table"); got != "TenantId" {
		t.Errorf("empty override: got %q, want TenantId", got)
	}
	if got := lwqlTenantColumnFor("stored_objects"); got != "project_id" {
		t.Errorf("overridden table: got %q, want project_id", got)
	}
}

func TestRenderLWQL_PerTableTenantColumn(t *testing.T) {
	savedTables, savedViews, savedCols := lwqlSourceTables, lwqlViewNames, lwqlTenantColumns
	defer func() {
		lwqlSourceTables, lwqlViewNames, lwqlTenantColumns = savedTables, savedViews, savedCols
	}()

	// A project_id-keyed source beside a default TenantId one, so the render
	// proves both the override and the preserved default in one pass.
	lwqlSourceTables = []string{"trace_summaries", "stored_objects"}
	lwqlViewNames = []string{}
	lwqlTenantColumns = map[string]string{"stored_objects": "project_id"}

	usersD := t.TempDir()
	configD := t.TempDir()
	input := &config.Input{LWQLPassword: "lwql-secret", LWQLDatabase: "langwatch"}

	if err := renderLWQL(input, usersD, configD); err != nil {
		t.Fatalf("renderLWQL: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(usersD, "lwql.yaml"))
	if err != nil {
		t.Fatalf("read lwql.yaml: %v", err)
	}
	users := string(data)

	wantProjectID := "project_id IN (SELECT any(TenantId) FROM langwatch.lwql_api_key_tenant_map"
	if !strings.Contains(users, wantProjectID) {
		t.Errorf("stored_objects filter missing per-table project_id predicate %q\n--- actual ---\n%s", wantProjectID, users)
	}
	wantDefault := "TenantId IN (SELECT any(TenantId) FROM langwatch.lwql_api_key_tenant_map"
	if !strings.Contains(users, wantDefault) {
		t.Errorf("trace_summaries filter missing default TenantId predicate %q\n--- actual ---\n%s", wantDefault, users)
	}
}

// The default render (embedded manifest, no overrides) filters every source
// on TenantId, except stored_objects (exposed as `objects`), whose physical
// column is project_id (#8085/#8116 Part B) — both the backwards-compatible
// default and the one per-table override the shipped catalog actually needs
// must render correctly straight from the embedded manifest.
func TestRenderLWQL_DefaultManifestFiltersTenantId(t *testing.T) {
	usersD := t.TempDir()
	configD := t.TempDir()
	input := &config.Input{LWQLPassword: "lwql-secret", LWQLDatabase: "langwatch"}

	if err := renderLWQL(input, usersD, configD); err != nil {
		t.Fatalf("renderLWQL: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(usersD, "lwql.yaml"))
	if err != nil {
		t.Fatalf("read lwql.yaml: %v", err)
	}
	users := string(data)
	if !strings.Contains(users, "project_id IN") {
		t.Errorf("default manifest should render stored_objects' project_id filter\n--- actual ---\n%s", users)
	}
	if !strings.Contains(users, "TenantId IN") {
		t.Errorf("default manifest should still render the default TenantId filter for every other source\n--- actual ---\n%s", users)
	}
}
