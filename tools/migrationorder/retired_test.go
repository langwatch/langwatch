package migrationorder_test

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/migrationorder"
)

// @scenario "A PR reuses a retired goose number"
func TestCheckRejectsRetiredKey(t *testing.T) {
	for _, entry := range []string{"00107_again.sql", "00108_again.sql"} {
		findings := migrationorder.Check(migrationorder.Input{
			Set:     setNamed(t, "ClickHouse"),
			BaseRef: "origin/main",
			Base:    []string{"00200_x.sql"},
			Head:    []string{"00200_x.sql", entry},
		})
		if len(findings) != 1 || !strings.Contains(findings[0].Problem, "retired") || findings[0].Fix == "" {
			t.Fatalf("%s: want one retired finding with a fix, got %+v", entry, findings)
		}
	}
}
