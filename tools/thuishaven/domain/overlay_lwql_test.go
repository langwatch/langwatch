package domain

import "testing"

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
}
