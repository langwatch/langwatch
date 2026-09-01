package render

import (
	"path/filepath"
)

// renderCustomSettingsPrefixes writes custom-settings-prefixes.yaml declaring
// the `custom_` settings prefix. A LangWatchQL deployment prerequisite: the
// per-query tenant capability travels as a `custom_`-prefixed setting, and
// without the declared prefix the server rejects the settings profile with
// UNKNOWN_SETTING (115) before any of the access model can be created.
// Unconditional — the prefix declaration alone changes nothing for a server
// that never uses such a setting.
func renderCustomSettingsPrefixes(configD string) error {
	return writeYAML(filepath.Join(configD, "custom-settings-prefixes.yaml"), map[string]any{
		"custom_settings_prefixes": "custom_",
	})
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
	return writeYAML(filepath.Join(usersD, "zz-access-management.yaml"), map[string]any{
		"users": map[string]any{
			"default": map[string]any{
				"access_management":        1,
				"named_collection_control": 1,
				"show_named_collections":   1,
			},
		},
	})
}

