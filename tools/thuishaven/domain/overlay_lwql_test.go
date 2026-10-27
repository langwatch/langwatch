package domain

import (
	"strings"
	"testing"
)

func TestOverlayProvisionsLangWatchQLOnlyWhenBothStoresAreManaged(t *testing.T) {
	base := Stack{Slug: "brave-otter", APIPort: 1, ClickHouseHTTPPort: 18123, ClickHouseDatabase: "lw_brave_otter"}
	if hasKey(base.OverlayEnv(), "LWQL_CLICKHOUSE_PASSWORD") {
		t.Fatal("without a managed Postgres the reader role has nowhere to live; LWQL must stay unset")
	}
	managed := base
	managed.PostgresPort = 5432
	managed.PostgresDatabase = "lw_brave_otter"
	env := managed.OverlayEnv()
	if got := valueOf(env, "LWQL_CLICKHOUSE_USER"); got != "lw_brave_otter_lwql" {
		t.Errorf("LWQL_CLICKHOUSE_USER = %q, want a per-stack user, since provisioning replaces it", got)
	}
	if valueOf(env, "LWQL_CLICKHOUSE_PASSWORD") == "" || valueOf(env, "LWQL_POSTGRES_READER_PASSWORD") == "" {
		t.Error("both LWQL passwords are needed, or lwql-provision skips as partially configured")
	}
	if got := valueOf(env, "LWQL_POSTGRES_HOST"); got != "host.lima.internal" {
		t.Errorf("LWQL_POSTGRES_HOST = %q, want the VM's route to the Mac, since ClickHouse dials Postgres from inside colima", got)
	}
	if got := valueOf(env, "LWQL_ACCESS_MODEL_MODE"); got != "sql" {
		t.Errorf("LWQL_ACCESS_MODEL_MODE = %q, want sql: no config store renders lwql_postgres, so rendered mode leaves every engine table and view over it uncreated", got)
	}
	if got := valueOf(env, "DATABASE_URL"); !strings.Contains(got, "@127.0.0.1:") {
		t.Errorf("DATABASE_URL = %q, want the app itself to keep dialing loopback", got)
	}
}
