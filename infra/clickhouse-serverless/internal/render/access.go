package render

import (
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
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
// The `zz-` prefix is load-bearing: users.d files merge in lexicographic
// order and the later file wins, so this must sort after any file declaring
// `access_management: 0` for the same user.
func renderAccessManagement(usersD string) error {
	return writeYAML(filepath.Join(usersD, "zz-access-management.yaml"), map[string]any{
		"users": map[string]any{
			"default": map[string]any{
				"access_management":              1,
				"named_collection_control":       1,
				"show_named_collections":         1,
				"show_named_collections_secrets": 1,
			},
		},
	})
}

// userDirectory is one entry under `user_directories`. Only the field the
// entry's kind uses is set; the rest are omitted.
type userDirectory struct {
	Path          string `yaml:"path,omitempty"`
	ZooKeeperPath string `yaml:"zookeeper_path,omitempty"`
}

// userDirectories is a struct rather than a map because YAML mapping order is
// load-bearing here and `yaml.Marshal` sorts map keys alphabetically, which
// would emit `replicated` ahead of `users_xml`. Struct fields marshal in
// declaration order, so this type *is* the precedence order.
type userDirectories struct {
	// Replace carries XML's `replace="replace"` attribute through the YAML
	// dialect's `@`-prefixed key convention (the same mechanism as `@remove`
	// in renderDefaultPassword and `@from_file` in renderKeeper). It is
	// mandatory: without it this block *merges* with the server's built-in
	// default `user_directories`, which contains `local_directory`. The first
	// writable directory wins for SQL-created entities, so a merged config
	// keeps writing users, profiles, grants and row policies to node-local
	// disk — the config would look correct and be silently inert.
	Replace string `yaml:"@replace"`
	// UsersXML must be retained and must come first. It is what defines the
	// `default` admin user and anything in users.d; dropping it locks the
	// operator out on restart. First is also correct precedence-wise:
	// XML-defined users are not writable, so writes fall through to Replicated.
	UsersXML   userDirectory `yaml:"users_xml"`
	Replicated userDirectory `yaml:"replicated"`
}

// renderUserDirectories writes user-directories.yaml pointing SQL-created
// access entities at keeper-backed replicated storage. Replicated mode only:
// a single-replica install has no keeper to store them in, and a malformed
// file here prevents the server from starting on every node.
//
// This is what makes the LangWatchQL access model — the restricted user, its
// settings profile, grants and row policies — cluster-wide rather than
// per-node, without any `ON CLUSTER` in the application's SQL.
func renderUserDirectories(input *config.Input, configD string) error {
	return writeYAML(filepath.Join(configD, "user-directories.yaml"), map[string]any{
		"user_directories": userDirectories{
			Replace:    "replace",
			UsersXML:   userDirectory{Path: "/etc/clickhouse-server/users.xml"},
			Replicated: userDirectory{ZooKeeperPath: "/clickhouse/" + input.ClusterName + "/access/"},
		},
	})
}

// renderNamedCollectionsStorage writes named-collections-storage.yaml so the
// PostgreSQL-engine named collection the application creates at boot lands in
// keeper and is readable from every replica. Replicated mode only.
//
// The unencrypted `zookeeper` type is deliberate over `zookeeper_encrypted`:
// the encrypted variant needs a `key_hex` the chart would have to generate,
// store and rotate, and the collection's PostgreSQL password is already a
// Kubernetes Secret inside the same trust boundary as keeper.
//
// `update_timeout_ms` is set explicitly at its documented default because the
// application creates the collection and then immediately creates engine
// tables referencing it — the propagation window is on the hot path and
// belongs in config where an operator can see and raise it.
func renderNamedCollectionsStorage(input *config.Input, configD string) error {
	return writeYAML(filepath.Join(configD, "named-collections-storage.yaml"), map[string]any{
		"named_collections_storage": map[string]any{
			"type":              "zookeeper",
			"path":              "/clickhouse/" + input.ClusterName + "/named_collections/",
			"update_timeout_ms": 5000,
		},
	})
}
