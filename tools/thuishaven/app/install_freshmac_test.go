package app

import (
	"bytes"
	"context"
	"runtime"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The fresh-Mac case, which is the whole point of the command and was its
// worst output: with no Homebrew, `--yes` printed the Homebrew line, then ran
// `brew install node`, then reported "could not install Node.js (exit status
// 127) — run `brew install node` by hand and try again" — blaming the tool
// that was fine for the absence of the one that was not.
// @scenario "A prerequisite haven cannot install itself is explained, not attempted"
func TestAMissingHomebrewStopsTheRunItWouldHaveBrokenAnyway(t *testing.T) {
	tools := &fakeTools{}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	var out bytes.Buffer

	manual, err := o.installPrereqsTo(context.Background(), &out, []domain.Chosen{
		{Key: "brew", Candidate: "brew"},
		{Key: "node", Candidate: "node"},
		{Key: "redis", Candidate: "redis"},
	})

	if err == nil {
		t.Fatal("with no brew, the formulae below it cannot be installed — the run must say so and stop")
	}
	if !strings.Contains(err.Error(), "Homebrew") {
		t.Errorf("error %q must name the tool that is actually missing", err)
	}
	if len(tools.ran) != 0 {
		t.Errorf("ran %v; nothing below Homebrew can succeed until it exists", tools.ran)
	}
	if len(manual) != 1 || !strings.Contains(manual[0].Command, "install.sh") {
		t.Errorf("the official command must still be handed back, got %+v", manual)
	}
}

// The same manual entry on its own is not a failure: there is nothing after
// it to break, and printing the command is all that was ever asked for.
// @scenario "A prerequisite haven cannot install itself is explained, not attempted"
func TestAManualEntryOnItsOwnIsNotAFailure(t *testing.T) {
	o := installOrchestrator(&fakeTools{}, &fakeStore{}, &fakeProxy{})
	var out bytes.Buffer
	manual, err := o.installPrereqsTo(context.Background(), &out, []domain.Chosen{{Key: "brew", Candidate: "brew"}})
	if err != nil {
		t.Fatalf("nothing depends on it here, so this is a clean run: %v", err)
	}
	if len(manual) != 1 || manual[0].Name != "Homebrew" || !strings.Contains(manual[0].Command, "install.sh") {
		t.Errorf("the step must name Homebrew and its command, got %+v", manual)
	}
}

// A redis-server built from source, or installed by something other than
// brew, is one `brew services start redis` cannot start. Reporting it
// installed leaves `haven up` to fail with "redis is not installed" — the
// report contradicting the very thing it was checking.
// @scenario "A brew-managed server is judged by the formula, not the binary"
func TestABinaryBrewDoesNotKnowAboutDoesNotCountForTheManagedServers(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the brew-managed servers are macOS only")
	}
	tools := &fakeTools{
		binaries: map[string]bool{"redis-server": true, "psql": true},
		formulae: nil, // brew knows about neither
	}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	report := o.CheckPrereqs(context.Background())
	for _, key := range []string{"redis", "postgres"} {
		if st := reportEntry(t, report, key); st.State != domain.PrereqMissing {
			t.Errorf("%s = %v, want missing — brew services has nothing to start", key, st.State)
		}
	}
}

// The mirror case, which is the common one: brew keeps postgresql@NN
// keg-only, so a machine with a perfectly good server often has no psql.
// @scenario "A keg-only formula counts even with no binary on PATH"
func TestAKegOnlyFormulaCountsWithNoBinaryOnPath(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the brew-managed servers are macOS only")
	}
	tools := &fakeTools{formulae: []string{"postgresql@15", "redis"}}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})
	report := o.CheckPrereqs(context.Background())
	for _, key := range []string{"redis", "postgres"} {
		if st := reportEntry(t, report, key); st.State != domain.PrereqSatisfied {
			t.Errorf("%s = %v, want satisfied — brew has it, which is what haven needs", key, st.State)
		}
	}
}
