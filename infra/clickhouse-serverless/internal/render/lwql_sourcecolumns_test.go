package render

// The LWQL SELECT grant on a source table must be column-scoped to exactly the
// columns the catalog exposes, mirroring the app's self-hosted grants (#8085
// security finding 1). A table the manifest lists columns for renders
// `GRANT SELECT(`col`, …)`; a table it omits (the PostgreSQL-engine *_pg bridge
// tables) keeps the whole-object grant. Driven through injected catalog vars so
// both shapes are proved from one render.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

func TestLwqlSourceGrant_ColumnScopedAndWholeObject(t *testing.T) {
	savedTables, savedViews, savedCols, savedSrcCols :=
		lwqlSourceTables, lwqlViewNames, lwqlTenantColumns, lwqlSourceColumns
	defer func() {
		lwqlSourceTables, lwqlViewNames, lwqlTenantColumns, lwqlSourceColumns =
			savedTables, savedViews, savedCols, savedSrcCols
	}()

	// A fact table with an explicit exposed column set beside a bridge table the
	// map omits, so one render proves both the column-scoped and whole-object
	// shapes.
	lwqlSourceTables = []string{"trace_summaries", "annotations_pg"}
	lwqlViewNames = []string{}
	lwqlTenantColumns = map[string]string{}
	lwqlSourceColumns = map[string][]string{
		"trace_summaries": {"TenantId", "TraceId", "TotalCost"},
	}

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

	// The listed table gets exactly its columns, backtick-quoted, in order.
	wantScoped := "GRANT SELECT(`TenantId`, `TraceId`, `TotalCost`) ON langwatch.trace_summaries"
	if !strings.Contains(users, wantScoped) {
		t.Errorf("column-scoped grant missing %q\n--- actual ---\n%s", wantScoped, users)
	}
	// It must NOT also carry the whole-object grant on that table.
	if strings.Contains(users, "GRANT SELECT ON langwatch.trace_summaries") {
		t.Errorf("trace_summaries still granted whole-object\n--- actual ---\n%s", users)
	}
	// A table absent from the map keeps the whole-object grant.
	wantWhole := "GRANT SELECT ON langwatch.annotations_pg"
	if !strings.Contains(users, wantWhole) {
		t.Errorf("bridge table missing whole-object grant %q\n--- actual ---\n%s", wantWhole, users)
	}
}

// The default render straight from the embedded manifest column-scopes every
// fact table and leaves the *_pg bridge tables whole-object — the shipped
// shape, proved with no injection.
func TestRenderLWQL_DefaultManifestColumnScopesFactTables(t *testing.T) {
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

	if !strings.Contains(users, "GRANT SELECT(`") {
		t.Errorf("default manifest should column-scope fact-table grants\n--- actual ---\n%s", users)
	}
	if strings.Contains(users, "GRANT SELECT ON langwatch.trace_summaries") {
		t.Errorf("trace_summaries must be column-scoped, not whole-object\n--- actual ---\n%s", users)
	}
	if !strings.Contains(users, "GRANT SELECT ON langwatch.annotations_pg") {
		t.Errorf("*_pg bridge tables should keep the whole-object grant\n--- actual ---\n%s", users)
	}
}
