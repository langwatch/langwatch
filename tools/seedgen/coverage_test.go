package seedgen

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/readmegen"
)

const fixtureSchema = `model Grant {
  id        String    @id
  revokedAt DateTime?
  // deletedAt in a comment is not a column
  @@index([revokedAt])
}

enum TeamUserRole {
  ADMIN
  CUSTOM
}
`

const fixtureMigrationUp = `-- +goose Up
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries (id String) ENGINE = Memory;
CREATE TABLE ${CLICKHOUSE_DATABASE}.old_spend (id String) ENGINE = Memory;
-- CREATE TABLE commented_out (id String)
-- +goose Down
-- DROP TABLE trace_summaries;
`

const fixtureMigrationDrop = `-- +goose Up
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.old_spend;
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.spend_mv TO x AS SELECT 1;
`

func fixtureTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	write := func(rel, content string) {
		path := filepath.Join(root, filepath.FromSlash(rel))
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
		require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
	}
	write(prismaSchema, fixtureSchema)
	write(clickhouseMigration+"/00001_create.sql", fixtureMigrationUp)
	write(clickhouseMigration+"/00002_drop.sql", fixtureMigrationDrop)
	return root
}

func fixtureManifest() readmegen.Manifest {
	resolved := func(value string) readmegen.Scalar { return readmegen.Scalar{Value: value, Resolved: true} }
	return readmegen.Manifest{Modules: []readmegen.ModuleFacts{{
		ID: "alpha",
		Process: readmegen.ProcessFacts{Pipelines: []readmegen.Pipeline{{
			Name:            resolved("alpha_items"),
			Events:          []string{"alphaItemAddedEventSchema"},
			ProcessManagers: []readmegen.ProcessManager{{Name: resolved("alphaSweep")}},
		}}},
	}}}
}

func fixtureInventory(t *testing.T) []string {
	t.Helper()
	inventory, err := Inventory(fixtureTree(t), fixtureManifest())
	require.NoError(t, err)
	return inventory
}

func TestInventoryReadsEveryCategoryFromTheTree(t *testing.T) {
	assert.Equal(t, []string{
		"enum:TeamUserRole.ADMIN",
		"enum:TeamUserRole.CUSTOM",
		"event:alpha_items/alphaItemAddedEventSchema",
		"lifecycle:Grant.revokedAt",
		"pm:alpha_items/alphaSweep",
		"table:spend_mv",
		"table:trace_summaries",
	}, fixtureInventory(t))
}

// @scenario "The static coverage check names an item with no generator"
func TestStaticCheckNamesAnItemWithNoGenerator(t *testing.T) {
	inventory := fixtureInventory(t)
	full := CoverageMap{
		Generators: map[string][]string{},
		Exemptions: map[string]string{"enum:TeamUserRole.CUSTOM": "enterprise shape only"},
	}
	for _, item := range inventory {
		if item != "enum:TeamUserRole.CUSTOM" {
			full.Generators[item] = []string{"some.kind"}
		}
	}
	require.False(t, CheckStatic(inventory, full).Failed())

	for _, item := range inventory {
		without := CoverageMap{Generators: map[string][]string{}, Exemptions: full.Exemptions}
		for other, kinds := range full.Generators {
			if other != item {
				without.Generators[other] = kinds
			}
		}
		if item == "enum:TeamUserRole.CUSTOM" {
			without.Exemptions = nil
		}
		report := CheckStatic(inventory, without)
		assert.Equal(t, []string{item}, report.Gaps, "removing %s", item)
		assert.Empty(t, report.Stale)
	}
}

// @scenario "The static coverage check names a stale entry"
func TestStaticCheckNamesAStaleEntry(t *testing.T) {
	inventory := fixtureInventory(t)
	coverage := CoverageMap{
		Generators: map[string][]string{"table:gateway_spend": {"gateway.request"}},
		Exemptions: map[string]string{"enum:TeamUserRole.VIEWER": "unheld"},
	}
	report := CheckStatic(inventory, coverage)
	assert.Equal(t, []string{"enum:TeamUserRole.VIEWER", "table:gateway_spend"}, report.Stale)
	assert.Len(t, report.Gaps, len(inventory))
}

func TestStaticCheckRefusesAnExemptionWithoutAReason(t *testing.T) {
	report := CheckStatic([]string{"table:a"}, CoverageMap{Exemptions: map[string]string{"table:a": " "}})
	assert.Equal(t, []string{"table:a"}, report.Unexplained)
	assert.True(t, report.Failed())
}

func TestStaticCheckNamesAKindThePlanDoesNotDeclare(t *testing.T) {
	previous := actionKinds
	t.Cleanup(func() { actionKinds = previous })
	actionKinds = func() []string { return []string{"prompt.create"} }
	report := CheckStatic([]string{"table:a", "table:b"}, CoverageMap{Generators: map[string][]string{
		"table:a": {"prompt.create"},
		"table:b": {"prompt.craete"},
	}})
	assert.Equal(t, []string{"table:b -> prompt.craete"}, report.UnknownKinds)
}

func TestCommittedCoverageMapDecodes(t *testing.T) {
	_, err := readCoverageMap("coverage.json")
	require.NoError(t, err)
}
