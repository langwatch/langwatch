package render

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

// lwqlCatalogJSON is the manifest that is the single source of truth for the
// Go side of the LangWatchQL access model. It is embedded rather than read at
// runtime so the binary carries the lists it renders, and it is the same file a
// TypeScript CI test (catalog/__tests__/manifestParity.unit.test.ts) asserts
// equal to the application's LWQL view catalog — so the two below can no longer
// silently drift from the catalog they mirror.
//
//go:embed lwql_catalog.json
var lwqlCatalogJSON []byte

// lwqlCatalog is the parsed manifest. Named fields, not the bare slices, so the
// embed is unmarshalled exactly once at package init.
type lwqlCatalog struct {
	SourceTables []string `json:"sourceTables"`
	ViewNames    []string `json:"viewNames"`
}

// lwqlSourceTables is the fixed set of tables the langwatch_lwql user may read,
// each behind the tenant row filter — eight ClickHouse-native sources followed
// by the six *_pg PostgreSQL-engine bridge tables. A catalog addition needs a
// matching entry in lwql_catalog.json and fails closed without one (the new
// view's source has no grant, so queries on it are refused rather than
// unbounded). The manifest is the source of truth here; the SaaS
// render-config.sh is a third list in the langwatch-saas repo and cannot be
// checked from this repo.
//
// lwqlViewNames are the caller-facing views over those sources. They are NOT
// lwql_* prefixed, so the wildcard grant does not reach them and each needs its
// own SELECT grant. Grant only, no filter: the views are SQL SECURITY INVOKER,
// so every read through them hits the source tables' row filters above.
var (
	lwqlSourceTables []string
	lwqlViewNames    []string
)

func init() {
	var catalog lwqlCatalog
	if err := json.Unmarshal(lwqlCatalogJSON, &catalog); err != nil {
		// The manifest is embedded from a file in this package, so a parse
		// failure is a build-time defect, not a runtime condition to recover
		// from.
		panic(fmt.Sprintf("lwql: parsing embedded lwql_catalog.json: %v", err))
	}
	lwqlSourceTables = catalog.SourceTables
	lwqlViewNames = catalog.ViewNames
}

// lwqlUsersFile is users.d/lwql.yaml: the restricted profile beside its only
// consumer, the langwatch_lwql user.
type lwqlUsersFile struct {
	Profiles lwqlProfiles `yaml:"profiles"`
	Users    lwqlUsers    `yaml:"users"`
}

type lwqlProfiles struct {
	LWQLRestricted lwqlProfile `yaml:"lwql_restricted"`
}

type lwqlUsers struct {
	LangwatchLWQL lwqlUser `yaml:"langwatch_lwql"`
}

type lwqlUser struct {
	PasswordSHA256Hex string       `yaml:"password_sha256_hex"`
	Networks          lwqlNetworks `yaml:"networks"`
	Profile           string       `yaml:"profile"`
	Quota             string       `yaml:"quota"`
	Grants            lwqlGrants   `yaml:"grants"`
	// Databases is a db-name → table-name → row filter tree. The keys are data
	// (the configured database, and the source-table set above), not a fixed
	// config shape, so this stays a map rather than a struct per table.
	Databases map[string]map[string]lwqlRowFilter `yaml:"databases"`
}

type lwqlNetworks struct {
	IP string `yaml:"ip"`
}

type lwqlGrants struct {
	Query []string `yaml:"query"`
}

type lwqlRowFilter struct {
	Filter string `yaml:"filter"`
}

// lwqlServerConfig is config.d/lwql-server.yaml: the server-level prerequisites
// for the restricted profile plus the optional PostgreSQL bridge collection.
type lwqlServerConfig struct {
	AccessControlImprovements lwqlAccessControlImprovements `yaml:"access_control_improvements"`
	NamedCollections          *lwqlNamedCollections         `yaml:"named_collections,omitempty"`
}

type lwqlAccessControlImprovements struct {
	SettingsConstraintsReplacePrevious bool `yaml:"settings_constraints_replace_previous"`
}

type lwqlNamedCollections struct {
	LWQLPostgres lwqlPostgresCollection `yaml:"lwql_postgres"`
}

type lwqlPostgresCollection struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Database string `yaml:"database"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
}

// renderLWQL writes the LangWatchQL access model as ClickHouse config when the
// chart mounts the langwatch_lwql password (issue langwatch-saas#1168, Design
// C): the whole model is static — one restricted user, one profile, a fixed
// grant/filter set — so it belongs in config the server re-reads at every boot,
// not in a keeper-backed SQL store. Ported from the SaaS render-config.sh LWQL
// block; the app's SQL self-provisioning is retained only as the external-BYO
// fallback, never for a chart-managed server.
//
// Self-gates on LWQLPassword: absent, nothing is written and the server carries
// no LWQL identity, exactly as before this feature existed.
func renderLWQL(input *config.Input, usersD, configD string) error {
	if input.LWQLPassword == "" {
		return nil
	}
	db := input.LWQLDatabase
	if db == "" {
		db = "langwatch"
	}
	// The database name is the only caller-controlled value interpolated into
	// the GRANT statements and the row-filter tag names below, so it is guarded
	// at the point of interpolation rather than only at config-load
	// (config.Validate also checks it). Anything but a plain identifier fails
	// the render rather than emitting a malformed grant or an unintended one.
	if !config.IsPlainIdentifier(db) {
		return fmt.Errorf("lwql: database name is not a plain identifier: %q", db)
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
	tableFilters := map[string]lwqlRowFilter{
		"lwql_api_key_tenant_map": {Filter: "KeyHash = getSetting('custom_api_key_hash')"},
	}
	for _, table := range lwqlSourceTables {
		grants = append(grants, fmt.Sprintf("GRANT SELECT ON %s.%s", db, table))
		tableFilters[table] = lwqlRowFilter{Filter: tenantFilter}
	}
	for _, view := range lwqlViewNames {
		grants = append(grants, fmt.Sprintf("GRANT SELECT ON %s.%s", db, view))
	}

	sum := sha256.Sum256([]byte(input.LWQLPassword))

	// users.d/lwql.yaml — the restricted profile and the user in one file.
	// ClickHouse merges users.d, so keeping the profile beside its only
	// consumer is fine and keeps the whole LWQL identity in one place.
	usersFile := lwqlUsersFile{
		Profiles: lwqlProfiles{LWQLRestricted: lwqlRestrictedProfile()},
		Users: lwqlUsers{
			LangwatchLWQL: lwqlUser{
				PasswordSHA256Hex: fmt.Sprintf("%x", sum),
				Networks:          lwqlNetworks{IP: "::/0"},
				Profile:           "lwql_restricted",
				Quota:             "default",
				Grants:            lwqlGrants{Query: grants},
				Databases:         map[string]map[string]lwqlRowFilter{db: tableFilters},
			},
		},
	}
	if err := writeYAML(filepath.Join(usersD, "lwql.yaml"), usersFile); err != nil {
		return err
	}

	// config.d/lwql-server.yaml — server-level prerequisites for the profile,
	// plus the PostgreSQL bridge named collection when configured.
	//
	// settings_constraints_replace_previous is what lets the lwql_restricted
	// profile mark custom_api_key_hash changeable_in_readonly under readonly=1;
	// without it the server rejects the profile. (The custom_ prefix itself is
	// declared unconditionally by renderCustomSettingsPrefixes.)
	serverConfig := lwqlServerConfig{
		AccessControlImprovements: lwqlAccessControlImprovements{
			SettingsConstraintsReplacePrevious: true,
		},
	}
	// lwql_postgres named collection: rendered only with both a host and the
	// plaintext reader password (ClickHouse must dial PostgreSQL with the real
	// value, so unlike every other rendered credential this one is NOT hashed —
	// the first plaintext secret on the pod's config disk, by necessity).
	if input.LWQLPgHost != "" && input.LWQLPgPassword != "" && input.LWQLPgDatabase != "" {
		// The SaaS render-config.sh hardcodes the reader role as lwql_ro; this
		// path parameterizes it via CLICKHOUSE_LWQL_PG_USER (input.LWQLPgUser) so
		// a BYO PostgreSQL can name the role whatever its own conventions require.
		// An unset user still defaults to lwql_ro, matching the bash renderer's
		// ${CLICKHOUSE_LWQL_PG_USER:-lwql_ro}.
		pgUser := input.LWQLPgUser
		if pgUser == "" {
			pgUser = "lwql_ro"
		}
		serverConfig.NamedCollections = &lwqlNamedCollections{
			LWQLPostgres: lwqlPostgresCollection{
				Host:     input.LWQLPgHost,
				Port:     input.LWQLPgPort,
				Database: input.LWQLPgDatabase,
				User:     pgUser,
				Password: input.LWQLPgPassword,
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
func lwqlRestrictedProfile() lwqlProfile {
	empty := ""
	constEmpty := lwqlConstraint{Const: &empty}
	return lwqlProfile{
		Readonly:                    1,
		CustomAPIKeyHash:            "''",
		MaxExecutionTime:            10,
		MaxMemoryUsage:              1_000_000_000,
		MaxThreads:                  4,
		MaxConcurrentQueriesForUser: 10,
		MaxRowsToRead:               1_000_000_000,
		MaxBytesToRead:              10_000_000_000,
		ReadOverflowMode:            "throw",
		Constraints: lwqlConstraints{
			CustomAPIKeyHash:            lwqlConstraint{ChangeableInReadonly: &empty},
			MaxExecutionTime:            constEmpty,
			MaxMemoryUsage:              constEmpty,
			MaxThreads:                  constEmpty,
			MaxConcurrentQueriesForUser: constEmpty,
			MaxRowsToRead:               constEmpty,
			MaxBytesToRead:              constEmpty,
			ReadOverflowMode:            constEmpty,
		},
	}
}

// lwqlProfile is the lwql_restricted settings profile.
type lwqlProfile struct {
	Readonly                    int             `yaml:"readonly"`
	CustomAPIKeyHash            string          `yaml:"custom_api_key_hash"`
	MaxExecutionTime            int             `yaml:"max_execution_time"`
	MaxMemoryUsage              int64           `yaml:"max_memory_usage"`
	MaxThreads                  int             `yaml:"max_threads"`
	MaxConcurrentQueriesForUser int             `yaml:"max_concurrent_queries_for_user"`
	MaxRowsToRead               int64           `yaml:"max_rows_to_read"`
	MaxBytesToRead              int64           `yaml:"max_bytes_to_read"`
	ReadOverflowMode            string          `yaml:"read_overflow_mode"`
	Constraints                 lwqlConstraints `yaml:"constraints"`
}

// lwqlConstraints pins each profile setting under readonly=1: every ceiling is
// const, and only custom_api_key_hash is changeable_in_readonly.
type lwqlConstraints struct {
	CustomAPIKeyHash            lwqlConstraint `yaml:"custom_api_key_hash"`
	MaxExecutionTime            lwqlConstraint `yaml:"max_execution_time"`
	MaxMemoryUsage              lwqlConstraint `yaml:"max_memory_usage"`
	MaxThreads                  lwqlConstraint `yaml:"max_threads"`
	MaxConcurrentQueriesForUser lwqlConstraint `yaml:"max_concurrent_queries_for_user"`
	MaxRowsToRead               lwqlConstraint `yaml:"max_rows_to_read"`
	MaxBytesToRead              lwqlConstraint `yaml:"max_bytes_to_read"`
	ReadOverflowMode            lwqlConstraint `yaml:"read_overflow_mode"`
}

// lwqlConstraint carries exactly one of const / changeable_in_readonly. The
// value is an empty string on purpose — it marshals to an empty XML element,
// the config equivalent of the SaaS <const/> / <changeable_in_readonly/> tags.
// The unused key stays nil (omitempty) so only the intended one is emitted.
type lwqlConstraint struct {
	Const                *string `yaml:"const,omitempty"`
	ChangeableInReadonly *string `yaml:"changeable_in_readonly,omitempty"`
}
