package deployimpact

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	configFile = "modules/demo/contract/src/demo.config.ts"
	schemas    = "packages/config/src/env-schemas.ts"
	chartFile  = "charts/langwatch/templates/app.yaml"
	valuesFile = "charts/langwatch/values.yaml"
)

func leaf(schema string) string {
	return "export const { demo } = Config.define((c) => ({\n  demo: c.env(\"DEMO_TOKEN\", " + schema + "),\n}));\n"
}

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

// @scenario "A new environment variable with no default blocks"
func TestNewRequiredSettingBlocks(t *testing.T) {
	report := compute(t, MapTree{}, MapTree{configFile: leaf("z.string().min(1)")})

	fact := factAbout(t, report, "DEMO_TOKEN")
	assert.Equal(t, "required setting", fact.Kind)
	assert.True(t, report.Blocked())
}

// @scenario "A setting that becomes required blocks"
func TestSettingThatBecomesRequiredBlocks(t *testing.T) {
	base := MapTree{configFile: leaf("z.string().optional()")}
	head := MapTree{configFile: leaf("z.string()")}

	report := compute(t, base, head)

	assert.Contains(t, factAbout(t, report, "DEMO_TOKEN").Detail, "now required")
	assert.True(t, report.Blocked())
}

// @scenario "A required variable the chart sets does not block"
func TestRequiredSettingTheChartSetsDoesNotBlock(t *testing.T) {
	head := MapTree{
		configFile: leaf("z.string()"),
		chartFile:  "env:\n  - name: DEMO_TOKEN\n    value: x\n",
	}

	report := compute(t, MapTree{}, head)

	assert.Contains(t, factAbout(t, report, "DEMO_TOKEN").Detail, chartFile)
	assert.False(t, report.Blocked())
}

// @scenario "A required Go service setting blocks"
func TestRequiredGoSettingBlocks(t *testing.T) {
	head := MapTree{"services/demo/config.go": "type Config struct {\n\tToken string `env:\"TOKEN\" validate:\"required\"`\n}\n"}

	report := compute(t, MapTree{}, head)

	assert.Equal(t, "required setting", factAbout(t, report, "TOKEN").Kind)
	assert.True(t, report.Blocked())
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

// @scenario "A variable the code stopped reading but the chart still sets blocks"
func TestDroppedSettingStillSetBlocks(t *testing.T) {
	base := MapTree{configFile: leaf("z.string().optional()"), ".env.example": "DEMO_TOKEN=\n"}
	head := MapTree{".env.example": "DEMO_TOKEN=\n"}

	report := compute(t, base, head)

	fact := factAbout(t, report, "DEMO_TOKEN")
	assert.Contains(t, fact.Detail, ".env.example")
	assert.True(t, report.Blocked())
}

// @scenario "A variable still read somewhere else does not block"
func TestDroppedSettingStillReadDoesNotBlock(t *testing.T) {
	base := MapTree{configFile: leaf("z.string().optional()"), chartFile: "DEMO_TOKEN"}
	head := MapTree{"dev/scripts/demo.ts": "const token = env.DEMO_TOKEN;\n", chartFile: "DEMO_TOKEN"}

	report := compute(t, base, head)

	assert.False(t, report.Blocked())
}

// @scenario "The operator-action label clears a block"
func TestTheLabelClearsABlock(t *testing.T) {
	report := compute(t, MapTree{}, MapTree{configFile: leaf("z.string()")})

	assert.Contains(t, Render(report, true), "acknowledged with the `operator-action` label")
	assert.Contains(t, Render(report, false), "**Breaks an existing install.**")
}

// @scenario "Optional settings, new values and migrations are listed without blocking"
func TestNonBreakingFactsAreListed(t *testing.T) {
	head := MapTree{
		schemas:    "export const environmentPresenceSchema = z\n  .string()\n  .optional();\n",
		configFile: leaf("environmentPresenceSchema"),
		valuesFile: "app:\n  port: 1\n",
	}
	migration := "packages/clickhouse-migrations/migrations/00099_demo.sql"

	report := compute(t, MapTree{}, head, Change{Status: "A", Path: migration},
		Change{Status: "A", Path: "modules/ops/contract/src/features/migrations/ops.errors.ts"})

	assert.False(t, report.Blocked())
	assert.Equal(t, "setting", factAbout(t, report, "DEMO_TOKEN").Kind, "a named optional schema is followed")
	assert.Equal(t, "helm value", factAbout(t, report, valuesFile+": app").Kind)
	assert.Equal(t, "migration", factAbout(t, report, migration).Kind)
	assert.Len(t, report.Facts, 3, "an errors file under a migrations folder is not a migration")
}

// @scenario "A pull request with no deployment facts says so"
func TestNoFactsSaysSo(t *testing.T) {
	report := compute(t, MapTree{"README.md": "a"}, MapTree{"README.md": "b"}, Change{Status: "M", Path: "README.md"})

	assert.Contains(t, Render(report, false), "No deployment impact")
}

func TestTestCodeIsNotProductConfig(t *testing.T) {
	head := MapTree{"packages/process/tests/supply.fixtures.ts": leaf("z.string()")}

	assert.False(t, compute(t, MapTree{}, head).Blocked())
}
