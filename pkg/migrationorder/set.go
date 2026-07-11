// Package migrationorder verifies that the migrations a pull request adds sort
// after every migration already on the base branch.
//
// Both migration sets are applied in key order: Prisma by timestamp, ClickHouse
// by goose sequence number. A branch that was opened before another migration
// merged can otherwise land a migration that sorts behind what is already
// applied, which goose skips outright and Prisma applies out of order.
package migrationorder

import "regexp"

// Set is an ordered migration directory: every entry in it carries a numeric key
// that decides when the migration runs relative to the others.
type Set struct {
	Name      string
	Directory string
	Key       *regexp.Regexp
	Format    string
}

// Sets are the ordered migration directories in this repository.
var Sets = []Set{
	{
		Name:      "Prisma",
		Directory: "langwatch/prisma/migrations",
		Key:       regexp.MustCompile(`^(\d{14})_`),
		Format:    "YYYYMMDDHHMMSS_name",
	},
	{
		Name:      "ClickHouse",
		Directory: "langwatch/src/server/clickhouse/migrations",
		Key:       regexp.MustCompile(`^(\d{5})_`),
		Format:    "NNNNN_name.sql",
	},
}
