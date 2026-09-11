package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// install is on the command table, so it is dispatchable, documented, and
// parses exactly the flags it reads — ADR-064's whole point.
// @scenario "A required prerequisite that is missing fails the check"
func TestInstallIsOnTheCommandTable(t *testing.T) {
	spec := specByName(t, "install")
	declared := map[string]bool{}
	for _, f := range spec.flags {
		declared[f.long] = true
	}
	for _, want := range []string{"--list", "--yes", "--reset-skips"} {
		if !declared[want] {
			t.Errorf("haven install must declare %s — an undeclared flag is an error, not a silent ignore", want)
		}
	}
	if spec.maxArgs != -1 {
		t.Error("haven install takes prerequisite names, so positionals must be allowed")
	}
	if spec.hidden {
		t.Error("install is a command a developer runs by hand; it belongs in help")
	}
}

// The two install-shaped commands answer to different scopes, and the help is
// where a developer works out which one they want.
// @scenario "A required prerequisite that is missing fails the check"
func TestInstallAndSetupSaySoWhichScopeTheyTouch(t *testing.T) {
	install := specByName(t, "install")
	if !strings.Contains(install.summary, "machine") {
		t.Errorf("install's summary %q should say it is about the machine", install.summary)
	}
	setup := specByName(t, "setup")
	if !strings.Contains(setup.summary, "checkout") {
		t.Errorf("setup's summary %q should say it is about the checkout", setup.summary)
	}
}

// @scenario "A required prerequisite that is missing fails the check"
func TestReportNamesTheCommandThatWouldFixAMissingEntry(t *testing.T) {
	var out bytes.Buffer
	printPrereqReport(&out, domain.PlanPrereqs(map[string]domain.Found{}, nil, "darwin"))
	got := out.String()
	if !strings.Contains(got, "npm install -g "+domain.PortlessPackage()) {
		t.Errorf("the report must name the command that installs portless, got:\n%s", got)
	}
	if !strings.Contains(got, "required") {
		t.Error("the report must mark how much each entry matters")
	}
	if !strings.Contains(got, "not ready") {
		t.Error("the report must end with the verdict")
	}
}

// A choice reported as a single command hides the alternative, and the plain
// report is the only place a pipe reader ever sees it.
// @scenario "A missing runtime offers the alternatives as one pick"
func TestReportOffersBothRuntimesOnOneLine(t *testing.T) {
	var out bytes.Buffer
	printPrereqReport(&out, domain.PlanPrereqs(map[string]domain.Found{}, nil, "darwin"))
	got := out.String()
	if !strings.Contains(got, "brew install colima docker") {
		t.Errorf("the report should name the default runtime command, got:\n%s", got)
	}
	if !strings.Contains(got, "haven install runtime=docker-desktop") {
		t.Errorf("the report should name the alternative, got:\n%s", got)
	}
}

// @scenario "Everything present reports ready and installs nothing"
func TestReportSaysReadyWhenEverythingIsThere(t *testing.T) {
	found := map[string]domain.Found{}
	for _, p := range domain.Prereqs {
		found[p.Candidates[0].Key] = domain.Found{Present: true, Detail: "installed"}
	}
	var out bytes.Buffer
	report := domain.PlanPrereqs(found, nil, "darwin")
	printPrereqReport(&out, report)
	if strings.Contains(out.String(), "not ready") {
		t.Errorf("verdict should be ready, got:\n%s", out.String())
	}
	// Every entry is still listed: a check that prints only problems leaves
	// "fine" and "not looked at" indistinguishable.
	for _, p := range domain.Prereqs {
		if !strings.Contains(out.String(), p.Key) {
			t.Errorf("the report omits %q", p.Key)
		}
	}
}

// @scenario "Declining with never is persisted"
func TestReportSaysWhatItIsNotAskingAboutAndHowToUndoIt(t *testing.T) {
	var out bytes.Buffer
	report := domain.PlanPrereqs(map[string]domain.Found{}, map[string]bool{"clickhouse-client": true}, "darwin")
	printPrereqReport(&out, report)
	if !strings.Contains(out.String(), "not asking about clickhouse-client") {
		t.Errorf("a skipped entry must be named, not silently absent, got:\n%s", out.String())
	}
	if !strings.Contains(out.String(), "--reset-skips") {
		t.Error("the way back must be printed with it")
	}
}

// The picker is shown only when someone is there to use it. An agent gets no
// prompt at all, and a pipe on either end is not a terminal — stdout alone
// says the question would be seen, not that anyone can answer it.
// @scenario "Agent mode reports instead of prompting"
func TestOnlyARealTerminalIsAskedAQuestion(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		isAgent, stdout, stdin bool
		wantAsk                bool
	}{
		{"a developer at a terminal", false, true, true, true},
		{"an agent, terminal or not", true, true, true, false},
		{"output piped to a file", false, false, true, false},
		{"input piped in", false, true, false, false},
	} {
		if got := installCanAsk(tc.isAgent, tc.stdout, tc.stdin); got != tc.wantAsk {
			t.Errorf("%s: installCanAsk = %v, want %v", tc.name, got, tc.wantAsk)
		}
	}
}

// @scenario "Agent mode reports instead of prompting"
func TestNonInteractiveHintNamesTheCommandsThatWouldAct(t *testing.T) {
	var out bytes.Buffer
	printNonInteractiveHint(&out, domain.PlanPrereqs(map[string]domain.Found{}, nil, "darwin"))
	got := out.String()
	if !strings.Contains(got, "haven install --yes") {
		t.Errorf("an agent must be told the non-interactive form, got:\n%s", got)
	}
	if !strings.Contains(got, "no terminal here") {
		t.Errorf("it must say why nothing happened, got:\n%s", got)
	}
}

// Nothing to act on means nothing to suggest: a hint printed under a clean
// report reads as though something is still wrong.
// @scenario "Everything present reports ready and installs nothing"
func TestNonInteractiveHintIsSilentWhenThereIsNothingToDo(t *testing.T) {
	found := map[string]domain.Found{}
	for _, p := range domain.Prereqs {
		found[p.Candidates[0].Key] = domain.Found{Present: true}
	}
	var out bytes.Buffer
	printNonInteractiveHint(&out, domain.PlanPrereqs(found, nil, "darwin"))
	if out.Len() != 0 {
		t.Errorf("expected no hint, got:\n%s", out.String())
	}
}

// @scenario "A non-interactive run with --yes installs what is needed"
func TestOptionalHintNamesWhatYesDeliberatelyLeftAlone(t *testing.T) {
	found := map[string]domain.Found{}
	for _, p := range domain.Prereqs {
		if p.Requirement == domain.PrereqOptional {
			continue
		}
		found[p.Candidates[0].Key] = domain.Found{Present: true}
	}
	var out bytes.Buffer
	printOptionalHint(&out, domain.PlanPrereqs(found, nil, "darwin"))
	if !strings.Contains(out.String(), "clickhouse-client") {
		t.Errorf("--yes must say which optional entries it skipped, got:\n%s", out.String())
	}
}
