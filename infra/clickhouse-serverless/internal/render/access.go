package render

import (
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

// customSettingsPrefixesConfig maps to custom-settings-prefixes.yaml.
type customSettingsPrefixesConfig struct {
	CustomSettingsPrefixes string `yaml:"custom_settings_prefixes"`
}

// renderCustomSettingsPrefixes writes custom-settings-prefixes.yaml declaring
// the `custom_` settings prefix. A LangWatchQL deployment prerequisite: the
// per-query tenant capability travels as a `custom_`-prefixed setting, and
// without the declared prefix the server rejects the settings profile with
// UNKNOWN_SETTING (115) before any of the access model can be created.
// Unconditional — the prefix declaration alone changes nothing for a server
// that never uses such a setting.
func renderCustomSettingsPrefixes(configD string) error {
	return writeYAML(filepath.Join(configD, "custom-settings-prefixes.yaml"), customSettingsPrefixesConfig{
		CustomSettingsPrefixes: "custom_",
	})
}

// accessManagementConfig maps to zz-access-management.yaml: the access-DDL
// grants the `default` (admin) user needs to create the LangWatchQL access
// model through SQL.
type accessManagementConfig struct {
	Users accessManagementUsers `yaml:"users"`
}

type accessManagementUsers struct {
	Default accessManagementGrants `yaml:"default"`
}

type accessManagementGrants struct {
	AccessManagement       int `yaml:"access_management"`
	NamedCollectionControl int `yaml:"named_collection_control"`
	ShowNamedCollections   int `yaml:"show_named_collections"`
	// show_named_collections_secrets is deliberately absent — see the doc on
	// renderAccessManagement.
}

// renderAccessManagement writes zz-access-management.yaml granting the
// `default` (admin) user the right to create users, profiles, row policies and
// named collections through SQL — what the app's LangWatchQL self-provisioning
// runs at boot. Nothing here widens what any *other* user can do.
//
// show_named_collections_secrets is deliberately NOT granted: the
// lwql_postgres named collection the app provisions holds a plaintext
// PostgreSQL password (ClickHouse must dial PG with the real value), and that
// grant would expose it through SHOW CREATE NAMED COLLECTION. show_named_collections
// (existence, secrets redacted) is enough for administration.
//
// The `zz-` prefix is load-bearing: users.d files merge in lexicographic
// order and the later file wins, so this must sort after any file declaring
// `access_management: 0` for the same user.
func renderAccessManagement(usersD string) error {
	return writeYAML(filepath.Join(usersD, "zz-access-management.yaml"), accessManagementConfig{
		Users: accessManagementUsers{
			Default: accessManagementGrants{
				AccessManagement:       1,
				NamedCollectionControl: 1,
				ShowNamedCollections:   1,
			},
		},
	})
}

// serverSettingsConfig maps to zz-server-settings.yaml: two server-level
// prerequisites the app's self-provisioned LangWatchQL access model depends
// on, neither of which is itself part of that access model (so they survived
// the deletion of the rendered-LWQL path, issue #8258).
type serverSettingsConfig struct {
	AccessControlImprovements accessControlImprovements `yaml:"access_control_improvements"`
	// UserDefinedZooKeeperPath is a pointer so it is omitted (rather than
	// rendered empty) on a standalone server — see the doc on
	// serverUserDefinedZooKeeperPath.
	UserDefinedZooKeeperPath *string `yaml:"user_defined_zookeeper_path,omitempty"`
}

type accessControlImprovements struct {
	SettingsConstraintsReplacePrevious bool `yaml:"settings_constraints_replace_previous"`
}

// serverUserDefinedZooKeeperPath is where the SQL user-defined function store
// lives in Keeper when replicated. The app's LangWatchQL functions are SQL
// user-defined functions created by DDL — the one part of the access model
// that cannot be static config, because ClickHouse has no XML form of
// CREATE FUNCTION for a SQL UDF (the config-time form,
// user_defined_executable_functions_config, forks a process per call).
//
// A CREATE FUNCTION writes the server's local disk store, so on a
// multi-replica cluster it lands on the replica that ran it and nowhere
// else. Pointing the store at Keeper makes one create reach every replica,
// and makes a replica rebuilt or rejoined later pick the functions up at
// boot — which an ON CLUSTER broadcast, writing each local store at the
// moment it runs, would not. The app reads system.server_settings to confirm
// this path is set before relying on it.
const serverUserDefinedZooKeeperPath = "/clickhouse/user_defined"

// renderServerSettings writes zz-server-settings.yaml, unconditionally (no
// LWQL password gate — the app self-provisions the access model regardless of
// how this server is reached):
//
//   - access_control_improvements.settings_constraints_replace_previous is what
//     lets the app's `<database>_profile` settings profile (`langwatch_profile`
//     by default) mark custom_api_key_hash changeable_in_readonly under
//     readonly=1; without it the server rejects the profile.
//   - user_defined_zookeeper_path, written only in replicated mode: on a
//     single node there is no Keeper to reach, and declaring the path would
//     make the function store depend on an ensemble that is not there.
func renderServerSettings(input *config.Input, configD string) error {
	settings := serverSettingsConfig{
		AccessControlImprovements: accessControlImprovements{
			SettingsConstraintsReplacePrevious: true,
		},
	}
	if input.Replicated {
		path := serverUserDefinedZooKeeperPath
		settings.UserDefinedZooKeeperPath = &path
	}
	return writeYAML(filepath.Join(configD, "zz-server-settings.yaml"), settings)
}
