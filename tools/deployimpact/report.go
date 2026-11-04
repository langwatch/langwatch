package deployimpact

import (
	"fmt"
	"path"
	"strings"
)

// Label is what a maintainer adds to a pull request to clear its blocking facts.
const Label = "operator-action"

// Fact is one thing an operator meets when they upgrade to the pull request.
type Fact struct {
	Kind    string
	Subject string
	Detail  string
	// Blocks is set when the fact breaks an existing install.
	Blocks bool
}

// Report is a pull request's deployment impact.
type Report struct {
	Facts []Fact
}

// Blocked is whether any fact breaks an existing install.
func (r Report) Blocked() bool {
	for _, fact := range r.Facts {
		if fact.Blocks {
			return true
		}
	}
	return false
}

// Change is one file the pull request adds (A), modifies (M) or deletes (D).
type Change struct {
	Status string
	Path   string
}

// Compute reads the facts between base, where the pull request branched, and head.
func Compute(base, head Tree, changes []Change) (Report, error) {
	var report Report
	steps := []func() ([]Fact, error){
		func() ([]Fact, error) { return valueFacts(base, head) },
		func() ([]Fact, error) { return changeFacts(changes), nil },
	}
	for _, step := range steps {
		facts, err := step()
		if err != nil {
			return Report{}, err
		}
		report.Facts = append(report.Facts, facts...)
	}
	return report, nil
}

func valueFacts(base, head Tree) ([]Fact, error) {
	before, err := valueKeys(base)
	if err != nil {
		return nil, err
	}
	after, err := valueKeys(head)
	if err != nil {
		return nil, err
	}
	var facts []Fact
	for _, key := range missingFrom(before, after) {
		facts = append(facts, Fact{Kind: "removed helm value", Subject: key, Blocks: true,
			Detail: "an operator's override of it is now silently ignored"})
	}
	for _, key := range missingFrom(after, before) {
		facts = append(facts, Fact{Kind: "helm value", Subject: key, Detail: "new"})
	}
	return facts, nil
}

func changeFacts(changes []Change) []Fact {
	var facts []Fact
	for _, change := range changes {
		switch {
		case change.Status == "A" && isMigration(change.Path):
			facts = append(facts, Fact{Kind: "migration", Subject: change.Path, Detail: "runs on upgrade"})
		case strings.HasPrefix(path.Base(change.Path), "Dockerfile"):
			facts = append(facts, Fact{Kind: "image", Subject: change.Path, Detail: imageChange[change.Status]})
		}
	}
	return facts
}

// imageChange says what a Dockerfile change does to the image it builds.
var imageChange = map[string]string{"A": "new image build", "M": "image build changed", "D": "image build removed"}

// isSource is whether path is product code in one of exts, not a test or fixture.
func isSource(path string, exts ...string) bool {
	for _, skip := range []string{"node_modules/", "__tests__/", "__fixtures__/", "testdata/", "tests/", "e2e/", ".test.", ".spec.", ".fixtures.", "_test.go"} {
		if strings.Contains(path, skip) {
			return false
		}
	}
	for _, ext := range exts {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}

// isMigration is whether path is a Postgres, ClickHouse or module migration.
func isMigration(path string) bool {
	return isSource(path, ".sql", ".ts") && (strings.Contains(path, "/prisma/migrations/") ||
		strings.HasPrefix(path, "packages/clickhouse-migrations/migrations/") ||
		strings.Contains(path, "/process/src/migrations/"))
}

// Render writes the report as the impact map's deployment section.
func Render(report Report, acknowledged bool) string {
	var b strings.Builder
	b.WriteString("### Deployment impact\n\n")
	if len(report.Facts) == 0 {
		b.WriteString("No deployment impact: this pull request touches no helm value, migration or image.\n")
		return b.String()
	}
	b.WriteString(verdict(report.Blocked(), acknowledged))
	b.WriteString("\n\n")
	b.WriteString("| | Fact | What | Detail |\n|---|---|---|---|\n")
	for _, fact := range report.Facts {
		mark := ""
		if fact.Blocks {
			mark = "blocks"
		}
		fmt.Fprintf(&b, "| %s | %s | `%s` | %s |\n", mark, fact.Kind, fact.Subject, fact.Detail)
	}
	return b.String()
}

func verdict(blocked, acknowledged bool) string {
	switch {
	case blocked && acknowledged:
		return "Breaks an existing install, acknowledged with the `" + Label + "` label: the release notes must tell operators what to do."
	case blocked:
		return "**Breaks an existing install.** Change the code, or have a maintainer add the `" + Label +
			"` label so the release notes tell operators what to do."
	default:
		return "Nothing here breaks an existing install."
	}
}
