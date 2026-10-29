package deployimpact

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const valuesFile = "charts/langwatch/values.yaml"

func compute(t *testing.T, base, head MapTree, changes ...Change) Report {
	t.Helper()
	report, err := Compute(base, head, changes)
	require.NoError(t, err)
	return report
}

func factAbout(t *testing.T, report Report, subject string) Fact {
	t.Helper()
	for _, fact := range report.Facts {
		if fact.Subject == subject {
			return fact
		}
	}
	t.Fatalf("no fact about %s in %+v", subject, report.Facts)
	return Fact{}
}

// @scenario "A removed helm value blocks"
func TestRemovedHelmValueBlocks(t *testing.T) {
	base := MapTree{valuesFile: "app:\n  cron:\n    key: a\n    schedule: b\n  port: 1\n"}
	head := MapTree{valuesFile: "app:\n  port: 1\n"}

	report := compute(t, base, head)

	fact := factAbout(t, report, valuesFile+": app.cron")
	assert.True(t, fact.Blocks)
	assert.Len(t, report.Facts, 1, "the keys under a removed key are not listed again")
}

// @scenario "The operator-action label clears a block"
func TestTheLabelClearsABlock(t *testing.T) {
	report := compute(t, MapTree{valuesFile: "app:\n  port: 1\n"}, MapTree{valuesFile: "{}\n"})

	assert.True(t, report.Blocked())
	assert.Contains(t, Render(report, true), "acknowledged with the `operator-action` label")
	assert.Contains(t, Render(report, false), "**Breaks an existing install.**")
}

// @scenario "New helm values, migrations and image changes are listed without blocking"
func TestNonBreakingFactsAreListed(t *testing.T) {
	head := MapTree{valuesFile: "app:\n  port: 1\n"}
	migration := "packages/clickhouse-migrations/migrations/00099_demo.sql"

	report := compute(t, MapTree{}, head, Change{Status: "A", Path: migration},
		Change{Status: "A", Path: "modules/ops/contract/src/features/migrations/ops.errors.ts"},
		Change{Status: "M", Path: "apps/api/Dockerfile"})

	assert.False(t, report.Blocked())
	assert.Equal(t, "helm value", factAbout(t, report, valuesFile+": app").Kind)
	assert.Equal(t, "migration", factAbout(t, report, migration).Kind)
	assert.Equal(t, "image build changed", factAbout(t, report, "apps/api/Dockerfile").Detail)
	assert.Len(t, report.Facts, 3, "an errors file under a migrations folder is not a migration")
}

// @scenario "A pull request with no deployment facts says so"
func TestNoFactsSaysSo(t *testing.T) {
	report := compute(t, MapTree{"README.md": "a"}, MapTree{"README.md": "b"}, Change{Status: "M", Path: "README.md"})

	assert.Contains(t, Render(report, false), "No deployment impact")
}
