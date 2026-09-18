package render

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

// lwqlTenantPredicateTemplate and lwqlKeyMapSelfFilterTemplate are the tenant
// row filter and the key map's self-filter, single-sourced across languages
// (ADR-101). The same two files are mirrored as string constants in the app's
// accessModel.ts, and a TypeScript parity test fails when either side drifts —
// so this chart-rendered filter and the row policy the app self-provisions on a
// BYO server can never diverge into "zero rows" or "over-broad rows".
//
//go:embed lwqlTenantPredicate.sql
var lwqlTenantPredicateTemplate string

//go:embed lwqlKeyMapSelfFilter.sql
var lwqlKeyMapSelfFilterTemplate string

// renderLWQLPredicate substitutes the {placeholder} slots of a single-sourced
// predicate template. Every value is a fixed identifier or a validated database
// name, so it only assembles text and adds no escaping of its own.
func renderLWQLPredicate(template string, substitutions map[string]string) string {
	rendered := strings.TrimSpace(template)
	for name, value := range substitutions {
		rendered = strings.ReplaceAll(rendered, "{"+name+"}", value)
	}
	return rendered
}

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
	// TenantColumns overrides the project column a source table's row filter
	// is applied to, keyed by table name. Optional and sparse: only tables
	// whose column is not the default "TenantId" appear (stored_objects carries
	// "project_id"). An absent table, an absent map, and an empty value all
	// mean the default, so an older manifest renders exactly as before.
	TenantColumns map[string]string `json:"tenantColumns"`
	// SourceColumns is the exact column set the restricted identity is granted
	// on each source table, keyed by table name — mirroring the app's
	// column-scoped grants (catalogStatements.ts lwqlSourceColumnGrants) so the
	// chart-rendered SaaS role reads only the columns the catalog exposes, not
	// every column of the fact table. Sparse: a table absent here (every
	// PostgreSQL-engine *_pg bridge table, whose whole column list IS the
	// exposed surface) takes the whole-object GRANT SELECT instead, so an older
	// manifest with no map renders exactly as before.
	SourceColumns map[string][]string `json:"sourceColumns"`
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
	lwqlSourceTables  []string
	lwqlViewNames     []string
	lwqlTenantColumns map[string]string
	lwqlSourceColumns map[string][]string
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
	lwqlTenantColumns = catalog.TenantColumns
	lwqlSourceColumns = catalog.SourceColumns
}

// lwqlTenantColumnFor is the project column a source table's row filter applies
// to: the manifest override when one is set, and the default "TenantId"
// otherwise. Keeping the default here is what lets a manifest carry only the
// tables that differ and every other table render unchanged.
func lwqlTenantColumnFor(table string) string {
	if col, ok := lwqlTenantColumns[table]; ok && col != "" {
		return col
	}
	return "TenantId"
}

// lwqlSourceGrant is the SELECT grant for one source table: column-scoped
// (`GRANT SELECT(`col`, …) ON db.table`) when the manifest lists the columns
// the catalog exposes on it, and whole-object (`GRANT SELECT ON db.table`)
// otherwise. Absent from the map means "grant the whole object" — the shape the
// PostgreSQL-engine bridge tables need, whose whole column list is the exposed
// surface. Columns are backtick-quoted to match the app's grants and to carry
// any dotted nested-column name unambiguously.
func lwqlSourceGrant(db, table string) string {
	cols, ok := lwqlSourceColumns[table]
	if !ok || len(cols) == 0 {
		return fmt.Sprintf("GRANT SELECT ON %s.%s", db, table)
	}
	quoted := make([]string, len(cols))
	for i, col := range cols {
		quoted[i] = "`" + col + "`"
	}
	return fmt.Sprintf("GRANT SELECT(%s) ON %s.%s", strings.Join(quoted, ", "), db, table)
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
	// UserDefinedZooKeeperPath moves the SQL user-defined function store from
	// each replica's local disk into Keeper. Written in replicated mode only —
	// see renderLWQL for why, and why it is nil on a single node.
	UserDefinedZooKeeperPath *string               `yaml:"user_defined_zookeeper_path,omitempty"`
	NamedCollections         *lwqlNamedCollections `yaml:"named_collections,omitempty"`
}

// lwqlUserDefinedZooKeeperPath is where the SQL user-defined function store
// lives in Keeper. The literal path the shipped config.xml documents for this
// setting; a Keeper ensemble shared by two ClickHouse clusters would need the
// cluster name in it, which LangWatch's topology (one ensemble per cluster)
// does not.
const lwqlUserDefinedZooKeeperPath = "/clickhouse/user_defined"

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

	// The tenant filter is rendered per source table because the project column
	// it filters on is per table: almost every source names it "TenantId", but
	// one (stored_objects) carries "project_id" and its filter must name that or
	// it would police the wrong column. The tenant SET itself is still supplied
	// per query by custom_api_key_hash (a comma-joined set of the caller's
	// per-project key hashes) and never baked in — only the column varies, and
	// only for the tables the manifest overrides. `tenantId` is the key map's
	// own column and stays "TenantId" regardless of the source column.
	tenantFilterFor := func(table string) string {
		return renderLWQLPredicate(lwqlTenantPredicateTemplate, map[string]string{
			"tenantColumn":  lwqlTenantColumnFor(table),
			"tenantId":      "TenantId",
			"keyHash":       "KeyHash",
			"keyMap":        fmt.Sprintf("%s.lwql_api_key_tenant_map", db),
			"tenantSetting": "custom_api_key_hash",
		})
	}
	keyMapSelfFilter := renderLWQLPredicate(lwqlKeyMapSelfFilterTemplate, map[string]string{
		"keyHash":       "KeyHash",
		"tenantSetting": "custom_api_key_hash",
	})

	// Grants: the lwql_* wildcard (reaches the key map and any lwql_-prefixed
	// object), plus one explicit SELECT per source table and per view.
	grants := []string{fmt.Sprintf("GRANT SELECT ON %s.lwql_*", db)}
	// Row filters: the key map keyed on set membership of the query setting (it
	// governs the very subquery the tenant filter runs against, so it must be
	// the same set test), then the shared tenant filter on every source table.
	tableFilters := map[string]lwqlRowFilter{
		"lwql_api_key_tenant_map": {Filter: keyMapSelfFilter},
	}
	for _, table := range lwqlSourceTables {
		grants = append(grants, lwqlSourceGrant(db, table))
		tableFilters[table] = lwqlRowFilter{Filter: tenantFilterFor(table)}
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
	// The LangWatchQL app functions are SQL user-defined functions, created by
	// DDL from the application's catalog — the one LangWatchQL object that
	// cannot be static config, because ClickHouse has no XML form of
	// CREATE FUNCTION for a SQL UDF (the config-time form,
	// user_defined_executable_functions_config, forks a process per call).
	//
	// A CREATE FUNCTION writes the server's local disk store, so on a
	// multi-replica cluster it lands on the replica that ran it and nowhere
	// else. Pointing the store at Keeper makes one create reach every replica,
	// and makes a replica rebuilt or rejoined later pick the functions up at
	// boot — which an ON CLUSTER broadcast, writing each local store at the
	// moment it runs, would not.
	//
	// Written only in replicated mode: on a single node there is no Keeper to
	// reach, and declaring the path would make the function store depend on an
	// ensemble that is not there.
	if input.Replicated {
		path := lwqlUserDefinedZooKeeperPath
		serverConfig.UserDefinedZooKeeperPath = &path
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
		// Backstop for the row cap the app's TypeScript validator and service
		// already enforce: a static LIMIT above 10,000 is refused there and a
		// bare statement gets it appended, but LIMIT {n:UInt64} (a bound
		// parameter) is not a value that check can read. Pinning the same
		// ceiling here means such a query still cannot return more rows/bytes
		// than the cap — mirrors LWQL_MAX_RESULT_ROWS / LWQL_MAX_RESULT_BYTES
		// in the app repo's limits.ts.
		MaxResultRows:      10_000,
		MaxResultBytes:     8_000_000,
		ResultOverflowMode: "throw",
		Constraints: lwqlConstraints{
			CustomAPIKeyHash:            lwqlConstraint{ChangeableInReadonly: &empty},
			MaxExecutionTime:            constEmpty,
			MaxMemoryUsage:              constEmpty,
			MaxThreads:                  constEmpty,
			MaxConcurrentQueriesForUser: constEmpty,
			MaxRowsToRead:               constEmpty,
			MaxBytesToRead:              constEmpty,
			ReadOverflowMode:            constEmpty,
			MaxResultRows:               constEmpty,
			MaxResultBytes:              constEmpty,
			ResultOverflowMode:          constEmpty,
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
	MaxResultRows               int64           `yaml:"max_result_rows"`
	MaxResultBytes              int64           `yaml:"max_result_bytes"`
	ResultOverflowMode          string          `yaml:"result_overflow_mode"`
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
	MaxResultRows               lwqlConstraint `yaml:"max_result_rows"`
	MaxResultBytes              lwqlConstraint `yaml:"max_result_bytes"`
	ResultOverflowMode          lwqlConstraint `yaml:"result_overflow_mode"`
}

// lwqlConstraint carries exactly one of const / changeable_in_readonly. The
// value is an empty string on purpose — it marshals to an empty XML element,
// the config equivalent of the SaaS <const/> / <changeable_in_readonly/> tags.
// The unused key stays nil (omitempty) so only the intended one is emitted.
type lwqlConstraint struct {
	Const                *string `yaml:"const,omitempty"`
	ChangeableInReadonly *string `yaml:"changeable_in_readonly,omitempty"`
}
