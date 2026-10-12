package visualdiff

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const worksCommit = "3333333333333333333333333333333333333333"

// worksFake answers rev-parse with the candidate, git grep with the screens
// two modules and the app declare, and git diff with changedUnder's paths.
type worksFake struct {
	changedUnder string
	diffs        int
}

func (fake *worksFake) run(_ context.Context, spec commandSpec, log io.Writer) error {
	switch spec.args[0] {
	case "rev-parse":
		_, err := io.WriteString(log, testBaseCommit+"\n")
		return err
	case "grep":
		_, err := io.WriteString(log, strings.Join([]string{
			testBaseCommit + ":modules/automation/browser/src/automation.web.ts\x00" + `    "pages/[project]/automations/alerts": {`,
			testBaseCommit + ":modules/automation/browser/src/automation.web.ts\x00" + `      path: "/:project/automations/alerts",`,
			testBaseCommit + ":enterprise/modules/billing/browser/src/billing.web.ts\x00" + `    "pages/settings/plans": {`,
			testBaseCommit + ":apps/ui/src/shell.web.ts\x00" + `    "pages/me": {`,
			testBaseCommit + ":packages/stray/src/stray.web.ts\x00" + `    "pages/stray": {`,
		}, "\n")+"\n")
		return err
	case "diff":
		fake.diffs++
		for _, path := range spec.args {
			if path == fake.changedUnder {
				_, err := io.WriteString(log, path+"/src/x.ts\n")
				return err
			}
		}
	}
	return nil
}

func worksConfig() *Config {
	return &Config{
		Routes: []string{"/{slug}/automations/alerts", "/settings/plans", "/me", "/stray", "/unowned"},
		Flows: []Flow{
			{ID: "alert", Steps: []Step{{Action: "createAutomation"}, {Action: "go", With: map[string]string{"path": "/{slug}/automations/alerts"}}}},
			{ID: "blind", Steps: []Step{{Action: "createPrompt"}}},
		},
	}
}

func workedLedger(config *Config) WorksLedger {
	ledger := WorksLedger{}
	steps := flowHashes(config.Flows)
	for _, route := range config.Routes {
		ledger[DoneKey(EditionEnterprise, "route", route)] = WorksEntry{Commit: worksCommit}
	}
	for _, flow := range config.Flows {
		ledger[DoneKey(EditionEnterprise, "flow", flow.ID)] = WorksEntry{Commit: worksCommit, Steps: steps[flow.ID]}
	}
	return ledger
}

func skippedSections(ledger DoneLedger) []string {
	var sections []string
	for index := range ledger {
		sections = append(sections, ledger[index].Kind+" "+ledger[index].Section)
	}
	return sections
}

// @scenario "A flow or route whose last verdict was works is skipped while nothing it touches changed"
func TestAWorkingSectionIsSkippedWhileNothingItTouchesChanged(t *testing.T) {
	config := worksConfig()
	var out bytes.Buffer
	fake := &worksFake{}
	inputs := worksInputs{run: fake.run, root: "/repo", candidateRef: "HEAD", config: config, editions: []Edition{EditionEnterprise}, works: workedLedger(config), out: &out}

	skipped := WorksSkips(context.Background(), inputs)

	got := strings.Join(skippedSections(skipped), ", ")
	if got != "route /{slug}/automations/alerts, route /settings/plans, route /me, flow alert" {
		t.Fatalf("skipped: %s", got)
	}
	if !skipped[0].Works || skipped[0].Note != "works at "+short(worksCommit)+", unchanged" {
		t.Fatalf("entry: %+v", skipped[0])
	}
	for _, why := range []string{"walking enterprise/route-%2Fstray, declared outside a module", "walking enterprise/route-%2Funowned, no module's screens declare", "walking enterprise/flow-blind, no go step"} {
		mustContain(t, out.String(), why)
	}
	if fake.diffs != 3 {
		t.Fatalf("one git diff per distinct commit and paths, got %d", fake.diffs)
	}

	fake.changedUnder = "modules/automation/process"
	inputs.config.Flows[0].Steps = append(inputs.config.Flows[0].Steps, Step{Action: "expect", With: map[string]string{"text": "x"}})
	got = strings.Join(skippedSections(WorksSkips(context.Background(), inputs)), ", ")
	if got != "route /settings/plans, route /me" {
		t.Fatalf("a change under the module or to the flow's steps walks it: %s", got)
	}
}

func TestARunRecordsWhatWorkedAndForgetsWhatFailed(t *testing.T) {
	root := t.TempDir()
	config := worksConfig()
	ledger := WorksLedger{DoneKey(EditionEnterprise, "route", "/untouched"): {Commit: "old"}, DoneKey(EditionEnterprise, "route", "/b"): {Commit: "old"}}
	rows := []Row{
		{Edition: EditionEnterprise, Kind: "route", Key: "/a", Class: ClassNoise},
		{Edition: EditionEnterprise, Kind: "route", Key: "/b", Class: ClassBlank},
		{Edition: EditionEnterprise, Kind: "flow", Key: "alert", Class: ClassNoise, Base: &Capture{Expect: "e"}, Candidate: &Capture{Expect: "e"}},
	}

	ledger.Record(rows, worksCommit, config.Flows)
	if err := SaveWorks(root, ledger); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadWorks(root)
	if err != nil {
		t.Fatal(err)
	}

	if loaded[DoneKey(EditionEnterprise, "route", "/a")].Commit != worksCommit || loaded[DoneKey(EditionEnterprise, "flow", "alert")].Steps == "" {
		t.Fatalf("worked sections are recorded: %+v", loaded)
	}
	if _, kept := loaded[DoneKey(EditionEnterprise, "route", "/b")]; kept {
		t.Fatal("a route with a finding is forgotten")
	}
	if loaded[DoneKey(EditionEnterprise, "route", "/untouched")].Commit != "old" {
		t.Fatal("a section the run did not capture keeps its entry")
	}
	if missing, err := LoadWorks(t.TempDir()); err != nil || len(missing) != 0 {
		t.Fatalf("no ledger is an empty one: %v %v", missing, err)
	}
}

func TestVerdictListsEachSkippedSection(t *testing.T) {
	dir := t.TempDir()
	config := worksConfig()
	ledger := DoneLedger{{Edition: EditionEnterprise, Kind: "route", Section: "/me", CandidateCommit: worksCommit, Works: true}}

	if err := WriteVerdictFile(dir, nil, ledger.skipLines(config, []Edition{EditionEnterprise})); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(dir, VerdictFile))
	if err != nil {
		t.Fatal(err)
	}
	mustContain(t, string(content), "- [enterprise] route /me: skipped (works at "+short(worksCommit)+", unchanged)")
	var out bytes.Buffer
	ledger.writeSkips(&out, config, []Edition{EditionEnterprise})
	mustContain(t, out.String(), "works     skipped 1, unchanged since they worked")
}
