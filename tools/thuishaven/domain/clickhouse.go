package domain

import "strings"

// ClickHouseService is the routed name for a stack's ClickHouse: it always
// resolves (clickhouse.<slug>.langwatch.localhost), pointing at the one shared
// managed clickhouse-server. Per-worktree isolation is by database, not server —
// so the hostname is always defined even when this worktree runs no CH of its
// own, and a "wrong migration count" is impossible because each worktree reads
// and writes only its own database.
const ClickHouseService = "clickhouse"

// DatabaseForSlug maps a slug to this worktree's isolated ClickHouse database on
// the shared server. Slugs use '-' (invalid in a CH identifier); databases use
// '_' and an "lw_" prefix so the name always starts with a letter and matches
// ClickHouse's identifier grammar (the app's goose runner validates the same).
func DatabaseForSlug(slug string) string {
	return "lw_" + strings.ReplaceAll(slug, "-", "_")
}
