package seed

import (
	"strings"
	"testing"
)

// @scenario "a step listed twice in coverage.json is refused"
func TestCoverageRefusesADuplicateStep(t *testing.T) {
	duplicated := []byte(`{"steps": {"a:b": {"status": "seeded", "seed": "x"}, "a:b": {"status": "pending", "seed": "unplanned"}}, "systemMigrations": {}}`)
	if _, err := parseCoverage(duplicated); err == nil || !strings.Contains(err.Error(), `"a:b"`) {
		t.Fatalf("a duplicated step id was accepted: %v", err)
	}
	unique := []byte(`{"steps": {"a:b": {"status": "seeded", "seed": "x"}}, "systemMigrations": {"a:b": {"status": "seeded", "seed": "x"}}}`)
	if _, err := parseCoverage(unique); err != nil {
		t.Fatalf("the same id in two sections was refused: %v", err)
	}
	if _, err := LoadCoverage(); err != nil {
		t.Fatalf("coverage.json: %v", err)
	}
}
