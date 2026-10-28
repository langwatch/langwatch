package deployimpact

import (
	"fmt"
	"path"
	"sort"
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
		func() ([]Fact, error) { return settingFacts(base, head) },
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

func settingFacts(base, head Tree) ([]Fact, error) {
	before, err := settings(base)
	if err != nil {
		return nil, err
	}
	after, err := settings(head)
	if err != nil {
		return nil, err
	}
	var facts []Fact
	for _, name := range sortedNames(after) {
		fact, err := newSettingFact(head, name, settingChange{before: before[name], after: after[name]})
		if err != nil {
			return nil, err
		}
		facts = append(facts, fact...)
	}
	for _, name := range sortedNames(before) {
		if _, kept := after[name]; kept {
			continue
		}
		fact, err := droppedSettingFact(head, name)
		if err != nil {
			return nil, err
		}
		facts = append(facts, fact)
	}
	return facts, nil
}

// settingChange is one variable's reading before and after the pull request.
type settingChange struct {
	before, after setting
}

func newSettingFact(head Tree, name string, change settingChange) ([]Fact, error) {
	before, after := change.before, change.after
	existed := len(before.Paths) > 0
	if !after.Required || before.Required {
		if existed {
			return nil, nil
		}
		return []Fact{{Kind: "setting", Subject: name, Detail: "new, optional: read in " + after.Paths[0]}}, nil
	}
	setBy, err := setIn(head, name, "charts/")
	if err != nil {
		return nil, err
	}
	detail := "new and required: read in " + after.Paths[0]
	if existed {
		detail = "now required: read in " + after.Paths[0]
	}
	if len(setBy) > 0 {
		return []Fact{{Kind: "required setting", Subject: name, Detail: detail + "; set by " + strings.Join(setBy, ", ")}}, nil
	}
	return []Fact{{Kind: "required setting", Subject: name, Blocks: true,
		Detail: detail + "; no chart sets it, so an install upgraded without it fails to start"}}, nil
}

func droppedSettingFact(head Tree, name string) (Fact, error) {
	stillRead, err := readElsewhere(head, name)
	if err != nil || stillRead {
		return Fact{Kind: "setting", Subject: name, Detail: "no longer a config leaf; other code still reads it"}, err
	}
	setBy, err := setIn(head, name, "charts/", ".env.example")
	if err != nil {
		return Fact{}, err
	}
	if len(setBy) == 0 {
		return Fact{Kind: "setting", Subject: name, Detail: "no longer read"}, nil
	}
	return Fact{Kind: "dropped setting", Subject: name, Blocks: true,
		Detail: "no longer read, but still set by " + strings.Join(setBy, ", ") + "; an operator setting it changes nothing"}, nil
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
			facts = append(facts, Fact{Kind: "image", Subject: change.Path, Detail: "image build changed"})
		}
	}
	return facts
}

// isMigration is whether path is a Postgres, ClickHouse or module migration.
func isMigration(path string) bool {
	return isSource(path, ".sql", ".ts") && (strings.Contains(path, "/prisma/migrations/") ||
		strings.HasPrefix(path, "packages/clickhouse-migrations/migrations/") ||
		strings.Contains(path, "/process/src/migrations/"))
}

// setIn lists the files under any of places that set name.
func setIn(tree Tree, name string, places ...string) ([]string, error) {
	files, err := mentions(tree, name)
	if err != nil {
		return nil, err
	}
	var found []string
	for _, file := range files {
		for _, place := range places {
			if strings.HasPrefix(file, place) {
				found = append(found, file)
				break
			}
		}
	}
	return found, nil
}

// readElsewhere is whether code outside the charts and env files still names the variable.
func readElsewhere(tree Tree, name string) (bool, error) {
	files, err := mentions(tree, name)
	if err != nil {
		return false, err
	}
	for _, file := range files {
		if isSource(file, ".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".go", ".py", ".sh") && !strings.HasPrefix(file, "charts/") {
			return true, nil
		}
	}
	return false, nil
}

// mentions lists the files naming the variable whole, or as the suffix of a prefixed one.
func mentions(tree Tree, name string) ([]string, error) {
	return tree.Grep(`(^|[^A-Za-z0-9_])([A-Z0-9_]*_)?` + name + `([^A-Za-z0-9_]|$)`)
}

func sortedNames(found readings) []string {
	names := make([]string, 0, len(found))
	for name := range found {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Render writes the report as the impact map's deployment section.
func Render(report Report, acknowledged bool) string {
	var b strings.Builder
	b.WriteString("### Deployment impact\n\n")
	if len(report.Facts) == 0 {
		b.WriteString("No deployment impact: this pull request touches no setting, helm value, migration or image.\n")
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
