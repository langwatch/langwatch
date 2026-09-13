package render

import (
	"path/filepath"
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
// show_named_collections_secrets is deliberately NOT granted, for parity with
// the SaaS renderer: the lwql_postgres named collection holds a plaintext
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
