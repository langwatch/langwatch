// Package migrationorder checks that the migrations a branch adds are numbered
// above every migration already on the base branch.
//
// Migrations run in key order. Goose only runs ClickHouse migrations numbered
// above the version the database is on, so one numbered below a migration that
// already merged never runs there. Prisma runs it, but out of order.
//
// It also checks what a goose migration's Down section holds. A Down block is
// written commented out, with a note saying to roll back, uncomment and run
// manually, so that reverting is a decision an operator takes rather than
// something a tool can do by accident — a live DROP COLUMN in a Down block is
// one `goose down` away from deleting a column nothing can rebuild. The same
// pass checks that a StatementBegin block holds a single statement, which is
// all ClickHouse accepts per query.
package migrationorder

import (
	"fmt"
	"regexp"
)

// Set is a migration directory whose entries are ordered by a numeric key.
type Set struct {
	Name      string
	Directory string
	// PreviousDirectories are paths this set lived at before a repo
	// restructure. Entries found there on the base branch are merged history —
	// a branch that moves them is not adding them.
	PreviousDirectories []string
	// Key extracts the numeric ordering key from an entry name; its first
	// capture group must be the digits the entries sort by.
	Key *regexp.Regexp
	// Format is the entry name shape, for error messages.
	Format string
	// Render turns a free key into the name fragment the suggested rename uses.
	Render func(key int64) string
	// Goose marks a set whose entries are goose SQL files, split into an Up and
	// a Down section by `-- +goose` annotations. Only those are read as SQL.
	Goose bool
}

// Sets are the ordered migration directories in this repository.
var Sets = []Set{
	{
		Name:                "Prisma",
		Directory:           "platform/app/prisma/migrations",
		PreviousDirectories: []string{"langwatch/prisma/migrations"},
		Key:                 regexp.MustCompile(`^(\d{14})_`),
		Format:              "YYYYMMDDHHMMSS_name",
		// A literal key rather than a $(date) expansion: free keys count up from
		// the newest timestamp in play, so twins renamed from one comment get
		// distinct names instead of colliding on the same second.
		Render: func(key int64) string { return fmt.Sprintf("%014d", key) },
	},
	{
		Name:                "ClickHouse",
		Directory:           "platform/app/src/server/clickhouse/migrations",
		PreviousDirectories: []string{"langwatch/src/server/clickhouse/migrations"},
		Key:                 regexp.MustCompile(`^(\d{5})_.*\.sql$`),
		Format:              "NNNNN_name.sql",
		Render:              func(key int64) string { return fmt.Sprintf("%05d", key) },
		Goose:               true,
	},
}
