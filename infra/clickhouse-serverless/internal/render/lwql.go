package render

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

// lwqlSourceTables is the fixed set of tables the langwatch_lwql user may read,
// each behind the tenant row filter. Ported verbatim from the shipped SaaS
// access model (render-config.sh) which mirrors lwqlSourceTables() over the app
// repo's LWQL view catalog: the first eight are ClickHouse-native sources, the
// six *_pg entries are the PostgreSQL-engine bridge tables. A catalog addition
// needs a matching entry here and fails closed without one (the new view's
// source has no grant, so queries on it are refused rather than unbounded).
var lwqlSourceTables = []string{
	"trace_summaries",
	"stored_spans",
	"evaluation_runs",
	"simulation_runs",
	"trace_analytics",
	"trace_analytics_rollup",
	"evaluation_analytics",
	"evaluation_analytics_rollup",
	"annotations_pg",
	"experiments_pg",
	"batch_evaluations_pg",
	"projects_pg",
	"prompts_pg",
	"prompt_versions_pg",
}

// lwqlViewNames are the caller-facing views over those sources. They are NOT
// lwql_* prefixed, so the wildcard grant does not reach them and each needs its
// own SELECT grant. Grant only, no filter: the views are SQL SECURITY INVOKER,
// so every read through them hits the source tables' row filters above.
var lwqlViewNames = []string{
	"traces",
	"spans",
	"evaluations",
	"simulations",
	"trace_metrics",
	"trace_metrics_by_minute",
	"model_usage_by_minute",
	"evaluation_metrics",
	"evaluation_metrics_by_minute",
	"annotations",
	"experiments",
	"batch_evaluations",
	"projects",
	"prompts",
	"prompt_versions",
}

// renderLwql writes the LangWatchQL access model as ClickHouse config when the
// chart mounts the langwatch_lwql password (issue langwatch-saas#1168, Design
// C): the whole model is static — one restricted user, one profile, a fixed
// grant/filter set — so it belongs in config the server re-reads at every boot,
// not in a keeper-backed SQL store. Ported from the SaaS render-config.sh LWQL
// block; the app's SQL self-provisioning is retained only as the external-BYO
// fallback, never for a chart-managed server.
//
// Self-gates on LwqlPassword: absent, nothing is written and the server carries
// no LWQL identity, exactly as before this feature existed.
func renderLwql(input *config.Input, usersD, configD string) error {
	if input.LwqlPassword == "" {
		return nil
	}
	db := input.LwqlDatabase
	if db == "" {
		db = "langwatch"
	}

	// One fixed tenant filter for every source table. The tenant is supplied
	// per query by custom_api_key_hash, never baked in here — nothing is
	// per-tenant, so this string is identical on every node and every tenant.
	tenantFilter := fmt.Sprintf(
		"TenantId IN (SELECT any(TenantId) FROM %s.lwql_api_key_tenant_map "+
			"WHERE KeyHash = getSetting('custom_api_key_hash') HAVING uniqExact(TenantId) = 1)",
		db,
	)

	// Grants: the lwql_* wildcard (reaches the key map and any lwql_-prefixed
	// object), plus one explicit SELECT per source table and per view.
	grants := []string{fmt.Sprintf("GRANT SELECT ON %s.lwql_*", db)}
	// Row filters: the key map keyed directly on the query setting, then the
	// shared tenant filter on every source table.
	databaseFilters := map[string]any{
		"lwql_api_key_tenant_map": map[string]any{
			"filter": "KeyHash = getSetting('custom_api_key_hash')",
		},
	}
	for _, table := range lwqlSourceTables {
		grants = append(grants, fmt.Sprintf("GRANT SELECT ON %s.%s", db, table))
		databaseFilters[table] = map[string]any{"filter": tenantFilter}
	}
	for _, view := range lwqlViewNames {
		grants = append(grants, fmt.Sprintf("GRANT SELECT ON %s.%s", db, view))
	}

	sum := sha256.Sum256([]byte(input.LwqlPassword))

	// users.d/lwql.yaml — the restricted profile and the user in one file.
	// ClickHouse merges users.d, so keeping the profile beside its only
	// consumer is fine and keeps the whole LWQL identity in one place.
	if err := writeYAML(filepath.Join(usersD, "lwql.yaml"), map[string]any{
		"profiles": map[string]any{
			"lwql_restricted": lwqlRestrictedProfile(),
		},
		"users": map[string]any{
			"langwatch_lwql": map[string]any{
				"password_sha256_hex": fmt.Sprintf("%x", sum),
				"networks":            map[string]any{"ip": "::/0"},
				"profile":             "lwql_restricted",
				"quota":               "default",
				"grants":              map[string]any{"query": grants},
				"databases": map[string]any{
					db: databaseFilters,
				},
			},
		},
	}); err != nil {
		return err
	}

	// config.d/lwql-server.yaml — server-level prerequisites for the profile,
	// plus the PostgreSQL bridge named collection when configured.
	//
	// settings_constraints_replace_previous is what lets the lwql_restricted
	// profile mark custom_api_key_hash changeable_in_readonly under readonly=1;
	// without it the server rejects the profile. (The custom_ prefix itself is
	// declared unconditionally by renderCustomSettingsPrefixes.)
	serverConfig := map[string]any{
		"access_control_improvements": map[string]any{
			"settings_constraints_replace_previous": true,
		},
	}
	// lwql_postgres named collection: rendered only with both a host and the
	// plaintext reader password (ClickHouse must dial PostgreSQL with the real
	// value, so unlike every other rendered credential this one is NOT hashed —
	// the first plaintext secret on the pod's config disk, by necessity).
	if input.LwqlPgHost != "" && input.LwqlPgPassword != "" {
		// The SaaS render-config.sh hardcodes the reader role as lwql_ro; this
		// path parameterizes it via CLICKHOUSE_LWQL_PG_USER (input.LwqlPgUser) so
		// a BYO PostgreSQL can name the role whatever its own conventions require.
		serverConfig["named_collections"] = map[string]any{
			"lwql_postgres": map[string]any{
				"host":     input.LwqlPgHost,
				"port":     input.LwqlPgPort,
				"database": input.LwqlPgDatabase,
				"user":     input.LwqlPgUser,
				"password": input.LwqlPgPassword,
			},
		}
	}
	return writeYAML(filepath.Join(configD, "lwql-server.yaml"), serverConfig)
}

// lwqlRestrictedProfile is the settings profile the langwatch_lwql user runs
// under. readonly=1 (the strictest mode) because it executes customer-written
// SQL; custom_api_key_hash is the single setting kept writable via
// changeable_in_readonly so the app can supply the per-query tenant. Ceilings
// mirror DEFAULT_LWQL_RESOURCE_LIMITS in the app repo and are pinned const on
// top of readonly=1. An empty-string value marshals to an empty XML element,
// the config equivalent of the SaaS <changeable_in_readonly/> / <const/> tags.
func lwqlRestrictedProfile() map[string]any {
	const empty = ""
	return map[string]any{
		"readonly":                        1,
		"custom_api_key_hash":             "''",
		"max_execution_time":              10,
		"max_memory_usage":                1_000_000_000,
		"max_threads":                     4,
		"max_concurrent_queries_for_user": 10,
		"max_rows_to_read":                1_000_000_000,
		"max_bytes_to_read":               10_000_000_000,
		"read_overflow_mode":              "throw",
		"constraints": map[string]any{
			"custom_api_key_hash":             map[string]any{"changeable_in_readonly": empty},
			"max_execution_time":              map[string]any{"const": empty},
			"max_memory_usage":                map[string]any{"const": empty},
			"max_threads":                     map[string]any{"const": empty},
			"max_concurrent_queries_for_user": map[string]any{"const": empty},
			"max_rows_to_read":                map[string]any{"const": empty},
			"max_bytes_to_read":               map[string]any{"const": empty},
			"read_overflow_mode":              map[string]any{"const": empty},
		},
	}
}
