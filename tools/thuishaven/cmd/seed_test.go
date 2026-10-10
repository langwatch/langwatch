package cmd

import (
	"errors"
	"os"
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

func TestSeedgenArgsPassFlagsThroughInSeedgensSpelling(t *testing.T) {
	inv, err := parse(seedSpec(), []string{"--persona", "startup,enterprise", "--size", "small", "--days", "30", "--seed", "7", "--dry-run"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []string{"--size", "small", "--days", "30", "--persona", "startup,enterprise", "--seed", "7", "--dry-run"}
	if got := seedgenArgs(inv); !slices.Equal(got, want) {
		t.Fatalf("args = %v, want %v", got, want)
	}
	inv, err = parse(seedSpec(), []string{"--org", "name=acme,users=3", "--org=name=globex", "--into", "o/p"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want = []string{"--into", "o/p", "--org", "name=acme,users=3", "--org", "name=globex"}
	if got := seedgenArgs(inv); !slices.Equal(got, want) {
		t.Fatalf("args = %v, want %v: every --org passes through", got, want)
	}
	if _, err := parse(seedSpec(), []string{"--nosuch"}); err == nil {
		t.Error("an undeclared flag was accepted")
	}
}

func TestSeedExitCodeFollowsTheRefusal(t *testing.T) {
	if got := seedExitCode(nil); got != 0 {
		t.Errorf("nil = %d", got)
	}
	if got := seedExitCode(errors.New("boom")); got != 1 {
		t.Errorf("plain error = %d", got)
	}
	if got := seedExitCode(&app.SeedExit{Code: 4, Err: errors.New("stalled")}); got != 4 {
		t.Errorf("stalled = %d", got)
	}
}

// @scenario "The auto-seed can be turned off"
func TestNoSeedFlagTurnsTheAutoSeedOff(t *testing.T) {
	t.Setenv("HAVEN_AUTO_SEED", "")
	disableAutoSeed()
	if got := os.Getenv("HAVEN_AUTO_SEED"); got != "0" {
		t.Errorf("HAVEN_AUTO_SEED = %q, want 0", got)
	}
}
