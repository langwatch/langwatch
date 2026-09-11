package domain

import (
	"strings"
	"testing"
)

// A required entry present at the wrong version is not missing, and saying so
// puts the verdict at odds with the line above it in its own report: `haven
// up` upgrades a stale portless in place, so the machine is usable.
// @scenario "A prerequisite present at the wrong version is not called missing"
func TestOutdatedIsNotReportedAsMissing(t *testing.T) {
	report := PlanPrereqs(presentExceptWith("portless", Found{Present: true, Outdated: true, Detail: "0.0.1"}), nil, "darwin")
	verdict := ReadyLine(report)
	if strings.Contains(verdict, "missing") {
		t.Errorf("verdict = %q; portless is installed, just not the pinned version", verdict)
	}
	if !strings.HasPrefix(verdict, "ready") {
		t.Errorf("verdict = %q, want it to read as ready", verdict)
	}
	if !strings.Contains(verdict, "portless") {
		t.Errorf("verdict = %q must still name what is stale", verdict)
	}
	if got := MissingRequired(report); len(got) != 0 {
		t.Errorf("MissingRequired = %v, want empty", got)
	}
	if got := OutdatedRequired(report); len(got) != 1 {
		t.Errorf("OutdatedRequired = %v, want portless", got)
	}
}

// Both at once still has to read correctly: the absent one decides the
// verdict, and the stale one is a note on it.
// @scenario "A prerequisite present at the wrong version is not called missing"
func TestMissingAndOutdatedTogetherReadAsNotReady(t *testing.T) {
	found := presentExceptWith("portless", Found{Present: true, Outdated: true})
	delete(found, "node")
	verdict := ReadyLine(PlanPrereqs(found, nil, "darwin"))
	if !strings.HasPrefix(verdict, "not ready") {
		t.Errorf("verdict = %q, want not ready — Node.js is absent", verdict)
	}
	if !strings.Contains(verdict, "Node.js") || !strings.Contains(verdict, "portless") {
		t.Errorf("verdict = %q must name both", verdict)
	}
}

// haven starts Postgres and Redis with `brew services`, so what brew knows
// about is the only thing that predicts whether it can. The catalogue says so
// by declaring the formula the authority and no binary at all.
// @scenario "A brew-managed server is judged by the formula, not the binary"
func TestTheBrewManagedServersAreJudgedByFormulaAlone(t *testing.T) {
	for _, key := range []string{"postgres", "redis"} {
		p, ok := LookupPrereq(key)
		if !ok {
			t.Fatalf("no %q in the catalogue", key)
		}
		c := p.Candidates[0]
		if !c.FormulaIsAuthority {
			t.Errorf("%s is started with `brew services` — the formula has to be the authority", key)
		}
		if len(c.Binaries) != 0 {
			t.Errorf("%s declares binaries %v; a client on PATH says nothing about what brew can start", key, c.Binaries)
		}
		if c.Formula == "" {
			t.Errorf("%s declares no formula to probe", key)
		}
	}
}

// Every install command haven knows is npm or Homebrew. Off macOS the brew
// ones are not advice, they are commands that exit 127 — so there they become
// words, and the developer's own package manager does the work.
// @scenario "A brew command is not offered where there is no brew"
func TestBrewCommandsAreNotOfferedOffMacOS(t *testing.T) {
	node, ok := LookupPrereq("node")
	if !ok {
		t.Fatal("no node in the catalogue")
	}
	c := node.Candidates[0]

	if command, _ := c.InstallOn("darwin"); command != "brew install node" {
		t.Errorf("on macOS the command is %q, want the brew one", command)
	}

	command, manual := c.InstallOn("linux")
	if command != "" {
		t.Errorf("on linux the command is %q; brew is reported not-applicable there, so running it would exit 127", command)
	}
	if !strings.Contains(manual, "package manager") {
		t.Errorf("manual text = %q, want it to point at the platform's own package manager", manual)
	}
}

// portless is the npm one, and npm runs wherever node does.
// @scenario "A brew command is not offered where there is no brew"
func TestTheNpmInstallIsOfferedEverywhere(t *testing.T) {
	portless, ok := LookupPrereq("portless")
	if !ok {
		t.Fatal("no portless in the catalogue")
	}
	for _, goos := range []string{"darwin", "linux"} {
		if command, _ := portless.Candidates[0].InstallOn(goos); command == "" {
			t.Errorf("on %s portless has no command; npm runs wherever node does", goos)
		}
	}
}

// presentExceptWith is presentExcept with one candidate's result replaced, for
// the states that are not simply "there" or "not there".
func presentExceptWith(key string, found Found) map[string]Found {
	all := presentExcept()
	all[key] = found
	return all
}
